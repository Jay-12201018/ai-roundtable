// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { compatibleCapabilities } from '../../../src/main/providers/serviceProfiles';

// D142: what each service's official documentation says, checked on 2026-11-03. A model name never decides any of this.
describe('compatible service profiles', () => {
  it.each([
    ['https://api.deepseek.com', { outputTokenParameter: 'max_tokens', streamUsage: true, disableThinking: true }],
    ['https://api.moonshot.cn/v1', { outputTokenParameter: 'max_completion_tokens', streamUsage: true }],
    ['https://dashscope.aliyuncs.com/compatible-mode/v1', { outputTokenParameter: 'max_tokens', streamUsage: true }],
    ['https://open.bigmodel.cn/api/paas/v4', { outputTokenParameter: 'max_tokens', streamUsage: false }],
    ['https://ark.cn-beijing.volces.com/api/v3', { outputTokenParameter: 'max_tokens', streamUsage: true, disableThinking: true }],
    ['https://api.minimax.cn/v1', { outputTokenParameter: 'max_completion_tokens', streamUsage: true, extraBody: { reasoning_split: true } }],
    ['https://api.openai.com/v1', { outputTokenParameter: 'max_completion_tokens' }],
  ])('%s uses its documented parameters', (baseUrl, expected) => {
    expect(compatibleCapabilities(baseUrl)).toMatchObject({ ...expected, listModels: true, authentication: 'models' });
  });

  it('gives any other address the common OpenAI-compatible shape and turns nothing extra on', () => {
    const capabilities = compatibleCapabilities('https://models.example/v1');
    expect(capabilities).toMatchObject({ outputTokenParameter: 'max_tokens', streamUsage: true });
    expect(capabilities.disableThinking).toBeUndefined();
    expect(capabilities.extraBody).toBeUndefined();
  });
});
