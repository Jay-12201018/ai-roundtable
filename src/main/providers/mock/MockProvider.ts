import { ContractError } from '../../../shared/contracts/errors';
import { listModelsInputSchema, testConnectionInputSchema, streamChatInputSchema } from '../../../shared/schemas/provider';
import { publicError } from '../../../shared/schemas/error';
import type { NormalizedChunk, ProviderAdapter, StreamChatInput, ListModelsInput, TestConnectionInput, ConnectionTestResult } from '../types';

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
    const deltas = splitMockText(text);
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
    // Mock usage estimates UTF-16 input length and output delta units, not real model tokens.
    yield { type: 'usage', requestId, inputTokens: parsed.messages.reduce((total, message) => total + message.content.length, 0), outputTokens: emittedDeltas };
    if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
    yield { type: 'finish', requestId, reason: limited ? 'length' : 'stop' };
  }
}

function responseFor(role: string, turnIndex: number): string {
  if (/critic|审查/i.test(role)) return `Mock 审查：第 ${turnIndex + 1} 轮发现需要补充证据，并建议由起草者修订。`;
  if (/synth|定稿|综合/i.test(role)) return `Mock 定稿：已整合起草和审查意见，形成可执行的最终方案。`;
  return `Mock 起草：这是第 ${turnIndex + 1} 轮的初步方案，包含目标、步骤和验证标准。`;
}

function splitMockText(text: string): string[] {
  return text.match(/.{1,4}/gu) ?? [text];
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
