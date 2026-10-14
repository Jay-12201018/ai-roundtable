import { ContractError } from '../../../shared/contracts/errors';
import { listModelsInputSchema, testConnectionInputSchema, streamChatInputSchema } from '../../../shared/schemas/provider';
import { publicError } from '../../../shared/schemas/error';
import type { NormalizedChunk, ProviderAdapter, StreamChatInput, ListModelsInput, TestConnectionInput, ConnectionTestResult } from '../types';

export class MockProvider implements ProviderAdapter {
  constructor(private readonly options: { tokenDelayMs?: number } = {}) {}

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
    let outputTokens = 0;
    for (const token of tokenize(text)) {
      if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
      await delay(this.options.tokenDelayMs ?? 0);
      if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
      outputTokens += 1;
      if (outputTokens > (parsed.outputTokenLimit ?? Infinity)) break;
      yield { type: 'text_delta', requestId, text: token };
    }
    if (signal?.aborted) { yield { type: 'error', requestId, error: publicError('cancelled') }; return; }
    const limited = outputTokens > (parsed.outputTokenLimit ?? Infinity);
    outputTokens = Math.min(outputTokens, parsed.outputTokenLimit ?? Infinity);
    yield { type: 'usage', requestId, inputTokens: parsed.messages.reduce((total, message) => total + message.content.length, 0), outputTokens };
    yield { type: 'finish', requestId, reason: limited ? 'length' : 'stop' };
  }
}

function responseFor(role: string, turnIndex: number): string {
  if (/critic|审查/i.test(role)) return `Mock 审查：第 ${turnIndex + 1} 轮发现需要补充证据，并建议由起草者修订。`;
  if (/synth|定稿|综合/i.test(role)) return `Mock 定稿：已整合起草和审查意见，形成可执行的最终方案。`;
  return `Mock 起草：这是第 ${turnIndex + 1} 轮的初步方案，包含目标、步骤和验证标准。`;
}

function tokenize(text: string): string[] {
  return text.match(/.{1,4}/gu) ?? [text];
}

function delay(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}
