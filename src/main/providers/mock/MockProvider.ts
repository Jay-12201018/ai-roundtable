import { ContractError } from '../../../shared/contracts/errors';
import { testConnectionInputSchema, streamChatInputSchema } from '../../../shared/schemas/provider';
import { publicError } from '../../../shared/schemas/error';
import type { NormalizedChunk, ProviderAdapter, StreamChatInput, TestConnectionInput, ConnectionTestResult } from '../types';
import { mockTextTokens,countMockInputTokens } from './tokenBudget';
import { mockArtifactText } from './artifactFixtures';

export class MockProvider implements ProviderAdapter {
  constructor(private readonly options: {
    tokenDelayMs?: number;
    stopAfterDeltas?: number;
    errorAfterDeltas?: number;
    stallAfterDeltas?: number;
  } = {}) {}

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
  const chat = /^chat:(short|medium|long):/u.exec(role);
  if (chat) return mockChatText(chat[1] as 'short' | 'medium' | 'long', turnIndex);
  const artifact = mockArtifactText(role);
  if (artifact) return artifact;
  if (role === 'summary') return 'Mock 摘要：起草者提出了初步方案，审查者要求补充证据，综合者整合了双方意见；待解决：验证标准的具体数值。';
  if (/critic|审查/i.test(role)) return `Mock 审查：第 ${turnIndex + 1} 轮发现需要补充证据，并建议由起草者修订。`;
  if (/synth|定稿|综合|总结/i.test(role)) return `Mock 定稿：已整合起草和审查意见，形成可执行的最终方案。`;
  return `Mock 起草：这是第 ${turnIndex + 1} 轮的初步方案，包含目标、步骤和验证标准。`;
}

// D149: the demo's group chat. Written in advance, like everything the demo says, and never the same line twice in a row.
const chatLines = {
  short: ['到！', '在呢，刚放下咖啡 ☕', '来了来了。', '收到，我听着。', '嗯，我也在。', '算我一个 🙋', '好，先听听大家的。', '我在，说吧。'],
  medium: ['我的想法是先把范围收窄，别一上来铺太大。你们觉得呢？', '这个方向可以，不过得先想清楚谁来用。我先去问两个真实用户。', '我有点担心时间，要不先做最小的一版，跑通了再加？', '同意前面的说法，再补一句：成本这块得算一下，不然后面容易翻车。'],
  long: ['我先出一版，大家再挑：\n\n1. **范围：**先选一个最小的场景试起来。\n2. **步骤：**这周定方案，下周做出来，再下周看效果。\n3. **怎么算成：**有人愿意持续用，就继续。\n\n哪里不对直接说。'],
};
const mockChatText = (length: keyof typeof chatLines, turnIndex: number) => chatLines[length][turnIndex % chatLines[length].length]!;

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
