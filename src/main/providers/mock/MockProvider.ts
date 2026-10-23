import { ContractError } from '../../../shared/contracts/errors';
import { listModelsInputSchema, testConnectionInputSchema, streamChatInputSchema } from '../../../shared/schemas/provider';
import { publicError } from '../../../shared/schemas/error';
import type { NormalizedChunk, ProviderAdapter, StreamChatInput, ListModelsInput, TestConnectionInput, ConnectionTestResult } from '../types';
import { mockTextTokens,countMockInputTokens } from './tokenBudget';

export class MockProvider implements ProviderAdapter {
  constructor(private readonly options: {
    tokenDelayMs?: number;
    stopAfterDeltas?: number;
    errorAfterDeltas?: number;
    stallAfterDeltas?: number;
  } = {}) {}

  async listModels(input: ListModelsInput) {
    const { signal, ...parameters } = input;
    listModelsInputSchema.parse(parameters);
    if (signal?.aborted) throw new ContractError('cancelled');
    return [{ id: 'mock', name: 'Mock' }];
  }

  async testConnection(input: TestConnectionInput): Promise<ConnectionTestResult> {
    const { signal, ...parameters } = input;
    const parsed = testConnectionInputSchema.parse(parameters);
    if (signal?.aborted) return { requestId: parsed.requestId, level: parsed.level, ok: false, error: publicError('cancelled') };
    if (parsed.modelId !== undefined && parsed.modelId !== 'mock') return { requestId: parsed.requestId, level: parsed.level, ok: false, error: publicError('not_found') };
    return { requestId: parsed.requestId, level: parsed.level, ok: true };
  }

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const { signal, ...parameters } = input;
    const parsed = streamChatInputSchema.parse(parameters);
    const { requestId } = parsed;
    if (parsed.modelId !== 'mock') { yield { type: 'error', requestId, error: publicError('not_found') }; return; }
    yield { type: 'start', requestId };
    const text = responseFor(parsed.agentRole ?? 'Drafter', parsed.turnIndex ?? 0);
    const deltas = mockTextTokens(text);
    let emittedDeltas = 0;
    let limited = false;
    while (true) {
      if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
      if (emittedDeltas === this.options.errorAfterDeltas) { yield { type: 'error', requestId, error: publicError('internal_error') }; return; }
      if (emittedDeltas === this.options.stallAfterDeltas) await delay(undefined, signal);
      if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
      if (emittedDeltas >= deltas.length || emittedDeltas >= (this.options.stopAfterDeltas ?? Infinity)) break;
      if (emittedDeltas >= (parsed.outputTokenLimit ?? Infinity)) { limited = true; break; }
      await delay(this.options.tokenDelayMs ?? 0, signal);
      if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
      yield { type: 'text_delta', requestId, text: deltas[emittedDeltas] };
      emittedDeltas += 1;
    }
    // These are the explicit toy model's vocabulary units, never real Provider usage or billing.
    yield { type: 'usage', requestId, inputTokens: countMockInputTokens(parsed.messages), outputTokens: emittedDeltas };
    if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
    yield { type: 'finish', requestId, reason: limited ? 'length' : 'stop' };
  }
}

function responseFor(role: string, turnIndex: number): string {
  // R13B: a summary request (agentRole 'summary') gets a fixed toy summary, never a real model's output.
  if (role === 'summary') return 'Mock 摘要：起草者提出了初步方案，审查者要求补充证据，综合者整合了双方意见；待解决：验证标准的具体数值。';
  if (/critic|审查/i.test(role)) return `Mock 审查：第 ${turnIndex + 1} 轮发现需要补充证据，并建议由起草者修订。`;
  if (/synth|定稿|综合/i.test(role)) return `Mock 定稿：已整合起草和审查意见，形成可执行的最终方案。`;
  return `Mock 起草：这是第 ${turnIndex + 1} 轮的初步方案，包含目标、步骤和验证标准。`;
}

function delay(milliseconds: number | undefined, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted || (milliseconds !== undefined && milliseconds <= 0)) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = milliseconds === undefined ? undefined : setTimeout(done, milliseconds);
    function done() {
      if (timer !== undefined) clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    }
    signal?.addEventListener('abort', done, { once: true });
  });
}
