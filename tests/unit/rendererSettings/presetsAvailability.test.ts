// @vitest-environment node
import { expect, it } from 'vitest';
import { availabilityText, presets } from '../../../src/renderer/features/settings/presets';
import { modelIdSchema } from '../../../src/shared/schemas/common';

it('builds the welcome sentence from the presets, and says nothing about prices', () => {
  expect(availabilityText()).toBe('支持 DeepSeek、Kimi、通义千问、智谱 GLM、豆包、MiniMax，也可以添加其他 OpenAI 兼容或自定义接口。几位成员可以各用一家。');
  for (const preset of presets) expect(`${preset.description}${preset.models.map(model => model.hint ?? '').join('')}`).not.toMatch(/价格|便宜|¥|审核/u);
});

it('every built-in model ID passes the same check a typed one does (D096)', () => {
  for (const preset of presets) for (const model of preset.models) expect(modelIdSchema.safeParse(model.id).success).toBe(true);
});
