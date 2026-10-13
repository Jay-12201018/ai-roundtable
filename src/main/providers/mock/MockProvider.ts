import { randomUUID } from 'node:crypto';
import type { NormalizedChunk, ProviderAdapter, StreamChatInput } from '../types';

export class MockProvider implements ProviderAdapter {
  constructor(private readonly options: { tokenDelayMs?: number } = {}) {}

  async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
    const requestId = randomUUID();
    yield { type: 'start', requestId };
    const text = responseFor(input.agentRole, input.turnIndex);
    let outputTokens = 0;
    for (const token of tokenize(text)) {
      if (input.signal?.aborted) throw new Error('Request cancelled');
      await delay(this.options.tokenDelayMs ?? 0);
      if (input.signal?.aborted) throw new Error('Request cancelled');
      outputTokens += 1;
      yield { type: 'text_delta', text: token };
    }
    if (input.signal?.aborted) throw new Error('Request cancelled');
    yield { type: 'usage', inputTokens: input.messages.reduce((total, message) => total + message.content.length, 0), outputTokens };
    yield { type: 'finish', reason: 'stop' };
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
