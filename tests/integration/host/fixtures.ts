import { messageTextOf } from '../../../src/shared/schemas/provider';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { HostService } from '../../../src/main/host/HostService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { NormalizedChunk, StreamChatInput } from '../../../src/main/providers/types';
import type { HostCommand } from '../../../src/shared/schemas/host';
import { publicError } from '../../../src/shared/schemas/error';
import { workflowConfigSchema } from '../../../src/main/workflow/definition';
import { config, members, roomId } from '../../unit/workflows/fixtures';
import { parseDiscussion } from '../../unit/context/discussion';

export { roomId, members };
export type Outcome = 'stop' | 'fail' | 'length' | { error: import('../../../src/shared/schemas/error').ErrorCode };

/** Records every request; individual calls can be held open, failed or answered with chosen text. */
export class ScriptedProvider extends MockProvider {
  readonly inputs: Omit<StreamChatInput, 'signal'>[] = [];
  readonly hold = new Set<number>();
  readonly outcomes = new Map<number, Outcome>();
  readonly answers = new Map<number, string>();
  private readonly gates = new Map<number, () => void>();
  private readonly waiting = new Map<number, () => void>();
  private readonly reached = new Set<number>();
  release(index: number) { this.hold.delete(index); this.gates.get(index)?.(); }
  /** Resolves once call `index` has streamed its first text and is waiting at its gate (or finished). */
  started(index: number): Promise<void> {
    return this.reached.has(index) ? Promise.resolve() : new Promise(resolve => this.waiting.set(index, resolve));
  }
  override async *streamChat({ signal, ...input }: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const index = this.inputs.length;
    this.inputs.push(structuredClone(input));
    yield { type: 'start', requestId: input.requestId };
    yield { type: 'text_delta', requestId: input.requestId, text: this.answers.get(index) ?? `answer ${index} @Override 成员 b @Stop` };
    // Resumed only after the consumer persisted the text above.
    this.reached.add(index);
    this.waiting.get(index)?.();
    if (this.hold.has(index)) await new Promise<void>(resolve => {
      this.gates.set(index, resolve);
      signal?.addEventListener('abort', () => resolve(), { once: true });
    });
    if (signal?.aborted) { yield { type: 'error', requestId: input.requestId, error: publicError('cancelled') }; return; }
    const outcome = this.outcomes.get(index) ?? 'stop';
    if (typeof outcome === 'object') yield { type: 'error', requestId: input.requestId, error: publicError(outcome.error) };
    else if (outcome === 'fail') yield { type: 'error', requestId: input.requestId, error: publicError('internal_error') };
    else yield { type: 'finish', requestId: input.requestId, reason: outcome };
  }
}

const open: Array<{ db: Database; run: RunService }> = [];
export async function closeFixtures(): Promise<void> {
  for (const item of open.splice(0)) { await item.run.shutdown(); item.db.close(); }
}

export function hostFixture(provider = new ScriptedProvider(), filename = ':memory:', seed = true) {
  const db = new Database(filename);
  const pending = db.initialize();
  if (pending) throw new Error('Use an initialized database for host fixtures');
  if (seed) {
    db.insertRoom({ id: roomId, name: 'Host fixture', objective: 'Host commands' });
    for (const member of members) db.insertAgent(member);
  }
  const run = new RunService(db, provider, createPublicMessagesBuilder());
  const host = new HostService(db, run);
  open.push({ db, run });
  let counter = 0;
  const command = (input: HostCommand extends infer C ? C extends HostCommand ? Omit<C, 'clientRequestId'> & { clientRequestId?: string } : never : never) =>
    host.command({ clientRequestId: `client-${++counter}`, ...input } as HostCommand);
  return { db, run, host, provider, command };
}

export async function startFree(f: ReturnType<typeof hostFixture>, extra: { mode?: 'automatic' | 'step'; maxTurns?: number } = {}) {
  return f.run.start({ roomId, task: 'Trusted task', workflowSnapshot: {}, mode: 'step', maxTurns: 6, ...extra });
}

export async function startWorkflow(f: ReturnType<typeof hostFixture>, template = 'review-revision', extra: { mode?: 'automatic' | 'step' } = {}) {
  const workflowConfig = workflowConfigSchema.parse(config(template));
  const preview = f.run.previewWorkflow({ roomId, config: workflowConfig });
  return f.run.start({ roomId, task: 'Trusted task', workflowSnapshot: {}, workflowConfig, workflowPreviewId: preview.previewId, mode: 'step', ...extra });
}

/** Public history texts (speaker + text) visible in a recorded provider input, in order. */
export function publicHistory(input: Omit<StreamChatInput, 'signal'>) {
  return parseDiscussion(input.messages).entries;
}
export const systemTexts = (input: Omit<StreamChatInput, 'signal'>) => input.messages.filter(message => message.role === 'system').map(message => messageTextOf(message.content));
