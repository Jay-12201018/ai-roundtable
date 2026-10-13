import { randomUUID } from 'node:crypto';
import type { RunEvent, RunSnapshot, RunSubscription, RunStatus } from '../../shared/types/run';
import { assertRunCommand } from '../orchestrator/stateMachine';
import type { Database } from '../database/Database';
import type { ProviderAdapter, StreamChatInput } from '../providers/types';

export type StartRunInput = {
  roomId: string;
  task: string;
  workflowSnapshot: Record<string, unknown>;
  mode?: 'automatic' | 'step';
  maxTurns?: number;
  maxDurationMs?: number;
  outputTokenLimit?: number;
};

type RunContext = {
  runId: string;
  roomId: string;
  task: string;
  mode: 'automatic' | 'step';
  maxTurns: number;
  maxDurationMs: number;
  outputTokenLimit: number;
  abortController: AbortController;
  pauseRequested: boolean;
  stopRequested: boolean;
  nextAgentIndex: number;
  promise: Promise<void>;
};

type EventListener = (event: RunEvent) => void;

const roles = [
  { id: 'agent-drafter', name: '起草者', role: 'Drafter' },
  { id: 'agent-critic', name: '审查者', role: 'Critic' },
  { id: 'agent-synthesizer', name: '综合者', role: 'Synthesizer' },
];

export class RunService {
  private readonly contexts = new Map<string, RunContext>();
  private readonly listeners = new Set<EventListener>();
  private readonly activeRooms = new Set<string>();

  constructor(private readonly database: Database, private readonly provider: ProviderAdapter) {}

  createDemoRoom(objective: string): string {
    const roomId = randomUUID();
    this.database.transaction(() => {
      this.database.insertRoom({ id: roomId, name: 'Mock 圆桌', objective });
      roles.forEach((role, index) => this.database.insertAgent({ id: `${roomId}-${role.id}`, roomId, displayName: role.name, roleTemplateId: role.role, displayOrder: index }));
    });
    return roomId;
  }

  async start(input: StartRunInput): Promise<RunSnapshot> {
    if (this.activeRooms.has(input.roomId)) throw new Error('Room already has an active run');
    if (this.activeRooms.size > 0) throw new Error('Another room already has an active run');
    if (!this.database.getRoom(input.roomId)) throw new Error('Room not found');
    const runId = randomUUID();
    const context: RunContext = {
      runId,
      roomId: input.roomId,
      task: input.task,
      mode: input.mode ?? 'automatic',
      maxTurns: input.maxTurns ?? 3,
      maxDurationMs: input.maxDurationMs ?? 300000,
      outputTokenLimit: input.outputTokenLimit ?? 1024,
      abortController: new AbortController(),
      pauseRequested: false,
      stopRequested: false,
      nextAgentIndex: 0,
      promise: Promise.resolve(),
    };
    this.database.transaction(() => {
      this.database.insertRun({ id: runId, roomId: input.roomId, status: 'idle', workflowSnapshot: input.workflowSnapshot, mode: context.mode, maxTurns: context.maxTurns, maxDurationMs: context.maxDurationMs, outputTokenLimit: context.outputTokenLimit });
      this.database.updateRun(runId, { status: 'running', startedAt: new Date().toISOString() });
      this.appendEvent(runId, 'run_state_changed', { status: 'running' });
    });
    this.contexts.set(runId, context);
    this.activeRooms.add(input.roomId);
    context.promise = this.runLoop(context);
    return this.getSnapshot(runId);
  }

  async waitForIdle(runId: string): Promise<void> {
    const context = this.contexts.get(runId);
    if (context) await context.promise;
  }

  getSnapshot(runId: string): RunSnapshot {
    return this.database.transaction(() => {
      const run = this.database.getRun(runId);
      if (!run) throw new Error('Run not found');
      const turns = this.database.listTurns(runId);
      const events = this.database.listRunEvents(runId, 0);
      const messages = this.database.listMessages(run.roomId).filter((message) => message.runId === runId);
      const lastEvent = events.at(-1);
      return {
        runId: run.id,
        roomId: run.roomId,
        status: run.status as RunSnapshot['status'],
        sequence: lastEvent?.sequence ?? 0,
        workflowSnapshot: run.workflowSnapshot,
        currentTurnId: turns.find((turn) => turn.status === 'running')?.id,
        activeAgentId: turns.find((turn) => turn.status === 'running')?.agentId,
        turns: turns.map((turn) => ({ turnId: turn.id, runId: turn.runId, agentId: turn.agentId, status: normalizeTurnStatus(turn.status), requestId: turn.requestId, outputText: turn.partialContent })),
        messages: messages.map((message) => ({ id: message.id, senderName: message.senderName, content: message.content, status: (message.status ?? 'completed') as RunSnapshot['messages'][number]['status'] })),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  getMessages(roomId: string) {
    return this.database.listMessages(roomId);
  }

  subscribe(runId: string, cursor: number): RunSubscription {
    const snapshot = this.getSnapshot(runId);
    const events = this.database.listRunEvents(runId, cursor) as RunEvent[];
    const firstSequence = events[0]?.sequence;
    const resyncRequired = cursor > snapshot.sequence || (firstSequence !== undefined && firstSequence > cursor + 1);
    return { snapshot, events: resyncRequired ? [] : events, nextCursor: snapshot.sequence, resyncRequired };
  }

  onEvent(listener: EventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hasActiveRuns(): boolean {
    return this.activeRooms.size > 0;
  }

  async shutdown(): Promise<void> {
    for (const context of this.contexts.values()) {
      context.stopRequested = true;
      context.abortController.abort();
    }
    await Promise.all([...this.contexts.values()].map((context) => context.promise));
    this.contexts.clear();
    this.activeRooms.clear();
  }

  pause(runId: string): void {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (!status) throw new Error('Run not found');
    assertRunCommand('pause', status as RunStatus);
    context.pauseRequested = true;
    this.database.updateRun(runId, { status: 'pausing' });
    this.appendAndNotify(runId, 'run_state_changed', { status: 'pausing' });
  }

  async stop(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (!status) throw new Error('Run not found');
    assertRunCommand('stop', status as RunStatus);
    context.stopRequested = true;
    context.abortController.abort();
    if (status === 'paused') {
      this.finishRun(context, 'cancelled');
      return;
    }
    this.database.updateRun(runId, { status: 'cancelling' });
    this.appendAndNotify(runId, 'run_state_changed', { status: 'cancelling' });
    await context.promise;
  }

  async step(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (status !== 'paused') throw new Error('Step requires a paused run');
    context.mode = 'step';
    context.pauseRequested = false;
    this.database.updateRun(runId, { status: 'running' });
    this.appendAndNotify(runId, 'run_state_changed', { status: 'running' });
    context.promise = this.runLoop(context);
    await context.promise;
  }

  async resumeRun(runId: string): Promise<void> {
    const context = this.requireContext(runId);
    const status = this.database.getRun(runId)?.status;
    if (status !== 'paused') throw new Error('resumeRun requires a paused run');
    context.mode = 'automatic';
    context.pauseRequested = false;
    this.database.updateRun(runId, { status: 'running' });
    this.appendAndNotify(runId, 'run_state_changed', { status: 'running' });
    context.promise = this.runLoop(context);
    await context.promise;
  }

  async retryTurn(runId: string, turnId: string): Promise<void> {
    const run = this.database.getRun(runId);
    const turn = this.database.getTurn(turnId);
    if (!run || !turn || turn.runId !== runId) throw new Error('Turn not found');
    if (!['error', 'cancelled'].includes(run.status)) throw new Error('retryTurn requires an error or cancelled run');
    if (!['failed', 'aborted'].includes(turn.status)) throw new Error('retryTurn requires a failed or aborted turn');
    throw new Error('retryTurn requires a new request context and is not available after process restart');
  }

  async continueMessage(runId: string, messageId: string): Promise<void> {
    const run = this.database.getRun(runId);
    const message = this.database.getMessage(messageId);
    if (!run || !message || message.runId !== runId) throw new Error('Message not found');
    if (!['aborted', 'failed'].includes(message.status ?? '')) throw new Error('continueMessage requires an aborted or failed message');
    throw new Error('continueMessage requires an explicit new generation request');
  }

  async recoverInterruptedRun(runId: string, decision: 'inspect' | 'retry' | 'discard'): Promise<void> {
    const run = this.database.getRun(runId);
    if (!run || run.status !== 'interrupted') throw new Error('recoverInterruptedRun requires an interrupted run');
    if (decision === 'inspect') return;
    if (decision === 'discard') {
      this.database.updateRun(runId, { status: 'cancelled', finishedAt: new Date().toISOString() });
      this.appendAndNotify(runId, 'run_state_changed', { status: 'cancelled', reason: 'discarded after interruption' });
      return;
    }
    throw new Error('Interrupted requests require a new explicit retry decision');
  }

  private async runLoop(context: RunContext): Promise<void> {
    const startedAt = Date.now();
    try {
      const agents = this.database.listAgents(context.roomId);
      while (context.nextAgentIndex < agents.length && context.nextAgentIndex < context.maxTurns) {
        if (Date.now() - startedAt > context.maxDurationMs) {
          this.finishRun(context, 'paused', 'Maximum run duration reached');
          return;
        }
        if (context.stopRequested) {
          this.finishRun(context, 'cancelled');
          return;
        }
        if (context.pauseRequested) {
          this.finishRun(context, 'paused');
          return;
        }
        await this.executeTurn(context, agents[context.nextAgentIndex], context.nextAgentIndex);
        context.nextAgentIndex += 1;
        if (context.mode === 'step') {
          this.finishRun(context, context.nextAgentIndex >= agents.length ? 'completed' : 'paused');
          return;
        }
      }
      this.finishRun(context, 'completed');
    } catch (error) {
      if (context.stopRequested || /cancel/i.test(String(error))) {
        this.finishRun(context, 'cancelled');
      } else {
        this.database.updateRun(context.runId, { status: 'error', lastError: error instanceof Error ? error.message : String(error), finishedAt: new Date().toISOString() });
        this.appendAndNotify(context.runId, 'run_state_changed', { status: 'error' });
      }
      this.activeRooms.delete(context.roomId);
    }
  }

  private async executeTurn(context: RunContext, agent: { id: string; displayName: string; roleTemplateId: string }, turnIndex: number): Promise<void> {
    const turnId = randomUUID();
    const messageId = randomUUID();
    const requestId = randomUUID();
    this.database.transaction(() => {
      this.database.insertTurn({ id: turnId, runId: context.runId, agentId: agent.id, status: 'running', requestId, turnIndex });
      this.database.insertMessage({ id: messageId, roomId: context.roomId, runId: context.runId, turnId, senderType: 'agent', senderName: agent.displayName, content: '', status: 'streaming' });
      this.database.updateRun(context.runId, { currentTurnId: turnId, currentAgentId: agent.id });
      this.appendEvent(context.runId, 'turn_started', { turnId, messageId, agentId: agent.id, requestId });
    });
    let content = '';
    try {
      const input: StreamChatInput = { agentRole: agent.roleTemplateId, turnIndex, messages: [{ role: 'user', content: context.task }], signal: context.abortController.signal };
      let outputTokens = 0;
      for await (const chunk of this.provider.streamChat(input)) {
        if (chunk.type === 'text_delta') {
          if (outputTokens >= context.outputTokenLimit) break;
          outputTokens += 1;
          content += chunk.text;
          this.database.transaction(() => {
            this.database.updateMessage(messageId, content, 'streaming');
            this.database.updateTurn(turnId, { partialContent: content });
            this.appendEvent(context.runId, 'text_delta', { turnId, messageId, senderName: agent.displayName, text: chunk.text });
          });
          this.notifyLastEvent(context.runId);
        } else if (chunk.type === 'usage') {
          this.appendAndNotify(context.runId, 'usage_updated', { turnId, inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens });
        }
      }
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, 'completed');
        this.database.updateTurn(turnId, { status: 'completed', partialContent: content });
        this.appendEvent(context.runId, 'turn_completed', { turnId, messageId });
      });
      this.notifyLastEvent(context.runId);
    } catch (error) {
      const cancelled = context.stopRequested || /cancel/i.test(String(error));
      this.database.transaction(() => {
        this.database.updateMessage(messageId, content, cancelled ? 'aborted' : 'failed');
        this.database.updateTurn(turnId, { status: cancelled ? 'aborted' : 'failed', partialContent: content });
        this.appendEvent(context.runId, cancelled ? 'turn_aborted' : 'turn_failed', { turnId, messageId, error: error instanceof Error ? error.message : String(error) });
      });
      this.notifyLastEvent(context.runId);
      throw error;
    }
  }

  private finishRun(context: RunContext, status: 'completed' | 'paused' | 'cancelled', reason?: string): void {
    this.database.updateRun(context.runId, { status, finishedAt: status === 'completed' || status === 'cancelled' ? new Date().toISOString() : null, lastError: reason ?? null });
    this.appendAndNotify(context.runId, 'run_state_changed', { status, reason });
    if (status !== 'paused') this.activeRooms.delete(context.roomId);
  }

  private appendAndNotify(runId: string, type: RunEvent['type'], payload: unknown): void {
    this.database.transaction(() => this.appendEvent(runId, type, payload));
    this.notifyLastEvent(runId);
  }

  private appendEvent(runId: string, type: RunEvent['type'], payload: unknown): void {
    this.database.appendRunEvent({ runId, type, payload });
  }

  private notifyLastEvent(runId: string): void {
    const event = this.database.listRunEvents(runId, 0).at(-1) as RunEvent | undefined;
    if (event) for (const listener of this.listeners) listener(event);
  }

  private requireContext(runId: string): RunContext {
    const context = this.contexts.get(runId);
    if (!context) throw new Error('Run is not active in this process');
    return context;
  }
}

function normalizeTurnStatus(status: string): 'pending' | 'running' | 'completed' | 'failed' | 'aborted' | 'interrupted' | 'cancelled' {
  return status as ReturnType<typeof normalizeTurnStatus>;
}
