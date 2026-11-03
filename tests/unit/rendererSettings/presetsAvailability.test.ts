// @vitest-environment node
import { expect, it } from 'vitest';
import { availabilityText, presets } from '../../../src/renderer/features/settings/presets';
import { modelIdSchema } from '../../../src/shared/schemas/common';

it('builds the welcome sentence from the presets, and says nothing about prices', () => {
  expect(availabilityText()).toBe('支持 DeepSeek、OpenAI、Anthropic Claude、Google Gemini，以及其他兼容 OpenAI 接口的服务。三位成员可以各用一家。');
  for (const preset of presets) expect(`${preset.description}${preset.models.map(model => model.hint ?? '').join('')}`).not.toMatch(/价格|便宜|¥|审核/u);
});

it('every built-in model ID passes the same check a typed one does (D096)', () => {
  for (const preset of presets) for (const model of preset.models) expect(modelIdSchema.safeParse(model.id).success).toBe(true);
});
