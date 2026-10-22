// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { looksLikeApiKey, modelIdSchema } from '../../../src/shared/schemas/common';
import { agentInputSchema, createAgentInputSchema, createProviderInputSchema, providerConnectionTestInputSchema } from '../../../src/shared/schemas/configuration';
import { streamChatInputSchema } from '../../../src/shared/schemas/provider';

// Synthetic look-alikes only; none of these is a real credential.
const keyLike = [
  'sk-0123456789abcdef0123456789abcdef', 'sk-ant-api03-AbCdEfGhIjKlMnOp', 'sk_live_AbCdEf123456',
  'AIzaSyA1b2C3d4E5f6G7h8I9j0KlMnOpQrStUv', 'ghp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789', 'xai-AbCdEfGhIjKlMnOpQrSt',
  'gsk_AbCdEfGhIjKlMnOpQrSt', 'hf_AbCdEfGhIjKlMnOpQrSt', 'AKIAABCDEFGHIJKLMNOP', 'Zk3mQ9xT2vB7nL4pR8sW1yC6dF5gH0jK',
  'a3f9c2e17b4d8a6f0e5c1b9d7a2f4e6c8b0d3a5f',
];
const modelIds = [
  'deepseek-flash', 'deepseek-v4-pro', 'gpt-4o-mini', 'claude-sonnet-4-5', 'models/gemini-2.5-flash', 'mock',
  'qwen2.5-72b-instruct', 'meta-llama/Llama-3.1-8B-Instruct', 'accounts/fireworks/models/llama-v3p1-70b-instruct',
  'anthropic.claude-3-5-sonnet-20241022-v2:0', '@cf/meta/llama-3-8b-instruct', 'ft:gpt-4o-mini:org:custom:9qLb2xYz', 'sky-chat', 'skill',
];

describe('D096 model IDs refuse API-key-like text', () => {
  it.each(keyLike)('flags %s as an API key', value => {
    expect(looksLikeApiKey(value)).toBe(true);
    expect(modelIdSchema.safeParse(value).success).toBe(false);
  });

  it.each(modelIds)('accepts the model ID %s', value => {
    expect(looksLikeApiKey(value)).toBe(false);
    expect(modelIdSchema.safeParse(value).success).toBe(true);
  });

  it('applies to every user-entered model field and to the request that would carry it', () => {
    const key = keyLike[0];
    expect(createProviderInputSchema.safeParse({ name: 'D', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: key }).success).toBe(false);
    expect(createProviderInputSchema.safeParse({ name: 'D', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', customModels: [{ id: key, name: 'x' }] }).success).toBe(false);
    expect(createProviderInputSchema.safeParse({ name: 'D', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash' }).success).toBe(true);
    expect(createAgentInputSchema.safeParse({ roomId: 'r', displayName: 'A', roleTemplateId: 'x', providerId: 'p', modelId: key }).success).toBe(false);
    expect(agentInputSchema.safeParse({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'x', providerId: 'p', modelId: key }).success).toBe(false);
    expect(providerConnectionTestInputSchema.safeParse({ providerId: 'p', level: 'generation', modelId: key, allowGeneration: true }).success).toBe(false);
    expect(streamChatInputSchema.safeParse({ requestId: 'r', modelId: key, messages: [{ role: 'user', content: 'x' }] }).success).toBe(false);
  });
});

describe('D096 stored legacy values are withheld on read and refused on use', () => {
  const opened: Database[] = [];
  afterEach(() => { for (const db of opened.splice(0)) db.close(); });
  function legacy() {
    const db = new Database(':memory:'); db.initialize(); opened.push(db);
    db.createRoom({ id: 'r', name: 'Room' });
    db.createProvider({ id: 'p', name: 'DeepSeek', kind: 'openai-compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'flash' }] });
    db.createAgent({ id: 'a', roomId: 'r', displayName: 'A', roleTemplateId: 'Drafter', providerId: 'p', modelId: 'deepseek-flash' });
    // Rows written before D096, when the key was typed into the model fields.
    const raw = (db as unknown as { db: import('better-sqlite3').Database }).db;
    raw.prepare('UPDATE providers SET default_model_id=?, custom_models_json=? WHERE id=?')
      .run(keyLike[0], JSON.stringify([{ id: 'deepseek-flash', name: 'flash' }, { id: keyLike[0], name: 'oops' }]), 'p');
    raw.prepare('UPDATE agents SET model_id=? WHERE id=?').run(keyLike[0], 'a');
    return { db, raw };
  }

  it('never returns the key-like value to the Renderer and says it was withheld', () => {
    const { db } = legacy();
    const provider = db.getProviderConfiguration('p')!;
    expect(provider).toMatchObject({ defaultModelId: null, customModels: [{ id: 'deepseek-flash', name: 'flash' }], withheldModelIds: true });
    expect(db.listProviderSummaries()[0]).toMatchObject({ configurationValid: true, defaultModelId: null });
    expect(db.getAgentConfiguration('a')).toMatchObject({ providerId: 'p', modelId: null, withheldModelId: true });
    const everything = JSON.stringify([provider, db.listProviderSummaries(), db.listAgentConfigurations('r')]);
    expect(everything).not.toContain(keyLike[0]);
  });

  it('refuses to use it for a Run and clears it on the next save', () => {
    const { db, raw } = legacy();
    expect(() => db.validateModelSelection('p', keyLike[0])).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(() => db.listAgents('r', () => {})).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    const { withheldModelIds: _flag, keyReference: _ref, createdAt: _c, updatedAt: _u, ...draft } = db.getProviderConfiguration('p')!;
    db.updateProvider({ ...draft, defaultModelId: 'deepseek-flash' });
    expect(raw.prepare('SELECT default_model_id, custom_models_json FROM providers WHERE id=?').get('p')).toEqual({
      default_model_id: 'deepseek-flash', custom_models_json: JSON.stringify([{ id: 'deepseek-flash', name: 'flash' }]) });
    expect(db.getProviderConfiguration('p')).not.toHaveProperty('withheldModelIds');
  });
});
