import { createHash, randomUUID } from 'node:crypto';
import { ContractError } from '../../shared/contracts/errors';
import { hostCommandSchema, type HostCommand, type HostCommandResult } from '../../shared/schemas/host';
import type { Database, HostActionRecord } from '../database/Database';
import { turnSettled, type RunService } from '../services/RunService';

const hostSenderName = '主持人';
const writableStatuses = ['running', 'pausing', 'paused', 'error', 'cancelled', 'interrupted', 'completed'];

/**
 * R12 trusted host commands. Input arrives only through the typed IPC command; Agent text is never parsed.
 * Every command is recorded once per (runId, clientRequestId): a repeated delivery returns the original action.
 */
export class HostService {
  constructor(private readonly database: Database, private readonly runs: RunService) {}

  async command(input: HostCommand): Promise<HostCommandResult> {
    const parsed = hostCommandSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const command = parsed.data;
    const run = this.database.getRun(command.runId);
    if (!run) throw new ContractError('not_found');
    const fingerprint = createHash('sha256').update(JSON.stringify(command)).digest('hex');
    const previous = this.database.findHostAction(command.runId, command.clientRequestId);
    if (previous) {
      // The same delivery is idempotent; reusing an identity for a different command is refused.
      if (previous.fingerprint !== fingerprint) throw new ContractError('invalid_input', 'clientRequestId');
      return this.result(previous, true);
    }
    const record = (action: Omit<HostActionRecord, 'id' | 'runId' | 'clientRequestId' | 'fingerprint' | 'createdAt' | 'updatedAt' | 'turnId' | 'kind' | 'status'> & { status?: 'applied' | 'pending' }) =>
      this.database.insertHostAction({ id: randomUUID(), runId: command.runId, clientRequestId: command.clientRequestId, kind: command.kind, fingerprint, status: action.status ?? 'applied', ...action });
    switch (command.kind) {
      case 'interject': {
        this.assertWritable(run.status, false);
        return this.runs.applyHostChange(run.id, () => {
          const messageId = randomUUID();
          // A host interjection is public history attributed to the host, never to an Agent.
          this.database.insertMessage({ id: messageId, roomId: run.roomId, runId: run.id, senderType: 'user', senderName: hostSenderName, content: command.content, status: 'completed' });
          return this.result(record({ resultMessageId: messageId }));
        });
      }
      case 'setOverride': {
        return this.runs.applyHostChange(run.id, () => {
          this.runs.assertOverrideAllowed(run.id, command.agentId);
          const pending = this.database.getPendingOverride(run.id);
          // Repeated clicks naming the same member keep a single queued Override.
          if (pending?.agentId === command.agentId) return this.result(pending, true);
          if (pending) this.database.settleHostAction(pending.id, 'superseded');
          return this.result(record({ agentId: command.agentId, status: 'pending' }));
        });
      }
      case 'cancelOverride': {
        return this.runs.applyHostChange(run.id, () => {
          const pending = this.database.getPendingOverride(run.id);
          if (!pending) throw new ContractError('invalid_state');
          this.database.settleHostAction(pending.id, 'cancelled');
          return this.result(record({ agentId: pending.agentId }));
        });
      }
      case 'setInstruction':
      case 'clearInstruction': {
        this.assertWritable(run.status, true);
        return this.runs.applyHostChange(run.id, () => {
          const revisions = this.database.listInstructionRevisions(run.id);
          const instructionId = command.instructionId ?? randomUUID();
          const latest = revisions.filter(item => item.instructionId === instructionId).at(-1);
          if (command.instructionId !== undefined && !latest) throw new ContractError('not_found');
          if (command.kind === 'clearInstruction' && latest?.content === null) throw new ContractError('invalid_state');
          if (command.kind === 'setInstruction' && command.instructionId === undefined && new Set(revisions.map(item => item.instructionId)).size >= 64) throw new ContractError('invalid_state');
          const action = record({ instructionId });
          this.database.insertInstructionRevision({ id: randomUUID(), runId: run.id, instructionId, content: command.kind === 'setInstruction' ? command.content : null, actionId: action.id });
          return this.result(action);
        });
      }
      case 'editMessage':
      case 'selectVersion': {
        return this.runs.applyHostChange(run.id, () => {
          const snapshot = this.database.readRunSnapshot(run.id);
          const version = snapshot.versions.find(item => item.messageId === command.messageId);
          const message = snapshot.messages.find(item => item.id === command.messageId);
          if (!version || !message) throw new ContractError('not_found');
          const turn = snapshot.turns.find(item => item.id === version.turnId);
          // A slot with a request in flight, or a Turn that has not settled, keeps its current version.
          if (snapshot.messages.some(item => item.status === 'streaming' && snapshot.versions.find(v => v.messageId === item.id)?.slotId === version.slotId)
            || version.turnId !== undefined && (!turn || !turnSettled(snapshot, turn))) throw new ContractError('invalid_state');
          if (command.kind === 'selectVersion') {
            if ((message.status ?? 'completed') !== 'completed' || snapshot.attempts.find(a => a.messageId === message.id && a.status !== 'completed')) throw new ContractError('invalid_state');
            if (version.active) return this.result(record({ messageId: message.id, resultMessageId: message.id }));
            this.database.activateVersion(message.id);
            return this.result(record({ messageId: message.id, resultMessageId: message.id }));
          }
          if (message.status === 'streaming') throw new ContractError('invalid_state');
          const editedId = randomUUID();
          const action = record({ messageId: message.id, resultMessageId: editedId });
          this.database.insertMessage({ id: editedId, roomId: run.roomId, runId: run.id, turnId: message.turnId, senderType: message.senderType, senderName: message.senderName, content: command.content, status: 'completed' },
            { origin: 'edit', slotId: version.slotId, parentMessageId: message.id, actionId: action.id });
          return this.result(action);
        });
      }
      case 'regenerateMessage': {
        if (this.runs.isExecuting(run.id)) throw new ContractError('invalid_state');
        const message = this.database.getMessage(command.messageId);
        if (!message || message.runId !== run.id) throw new ContractError('not_found');
        if (message.senderType !== 'agent' || !message.turnId) throw new ContractError('invalid_state');
        // The action and the scheduled request share one decision: a refused regeneration records nothing.
        return this.database.transaction(() => {
          const action = record({ messageId: message.id });
          this.runs.regenerateMessage(run.id, message.id, action.id);
          return this.result(action);
        });
      }
      case 'abortGeneration': {
        if (!this.runs.isRegenerating(run.id)) throw new ContractError('invalid_state');
        const action = this.runs.applyHostChange(run.id, () => this.result(record({})));
        await this.runs.abortGeneration(run.id);
        return action;
      }
    }
  }

  private assertWritable(status: string, allowCompleted: boolean): void {
    if (!writableStatuses.includes(status) || status === 'completed' && !allowCompleted) throw new ContractError('invalid_state');
  }

  private result(action: HostActionRecord, duplicate = false): HostCommandResult {
    return { runId: action.runId, actionId: action.id, kind: action.kind as HostCommandResult['kind'], duplicate };
  }
}
