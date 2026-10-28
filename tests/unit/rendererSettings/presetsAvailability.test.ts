// @vitest-environment node
import { expect, it } from 'vitest';
import type { ProviderConfiguration } from '../../../src/shared/contracts/configuration';
import { deepSeekModelPolicy } from '../../../src/main/providers/modelPolicies/deepseek';
import { availabilityText, presets } from '../../../src/renderer/features/settings/presets';

it('says a preset can be used for discussions only when Main has a reviewed price for it (D114)', () => {
  for (const preset of presets.filter(value => value.kind !== 'mock')) {
    const configuration = { kind: preset.kind, baseUrl: preset.baseUrl } as unknown as ProviderConfiguration;
    const reviewed = preset.models.some(model => deepSeekModelPolicy(configuration, model.id) !== undefined);
    expect([preset.id, reviewed]).toEqual([preset.id, !preset.priceUnreviewed]);
  }
});

it('builds the welcome sentence from the presets instead of a fixed list', () => {
  expect(availabilityText()).toBe('目前可以用于讨论的是 DeepSeek；OpenAI、Anthropic Claude、Google Gemini 和其他兼容服务可以先连接，价格审核后开放讨论。');
});
