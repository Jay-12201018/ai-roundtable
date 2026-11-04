// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';

const databases: Database[] = [];
const services: RunService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map(service => service.shutdown()));
  databases.splice(0).forEach(database => database.close());
});
function fixture(options = {}) {
  const database = new Database(':memory:'); database.initialize(); databases.push(database);
  database.createRoom({ id: 'room', name: 'Room' });
  database.createProvider({ id: 'provider', name: 'Explicit Mock', kind: 'mock' });
  database.createAgent({ id: 'agent', roomId: 'room', displayName: 'Original', roleTemplateId: 'Drafter', providerId: 'provider', modelId: 'mock' });
  const provider = new MockProvider(options);
  const service = new RunService(database, provider); services.push(service);
  return { database, provider, service };
}
function changeProvider(database: Database, change: 'kind' | 'disabled') {
  database.updateProvider({ id: 'provider', name: 'Updated', kind: change === 'kind' ? 'compatible' : 'mock', baseUrl: change === 'kind' ? 'https://service.example/v1' : null, enabled: change !== 'disabled' });
}
const start = { roomId: 'room', task: 'Preserve evidence', workflowSnapshot: {}, maxTurns: 2 };

describe('R07/R08 Provider admission for historical Run commands', () => {
  it.each(['kind', 'disabled'] as const)('rejects retry after Provider %s changes without rewriting history or creating an Attempt', async change => {
    const f = fixture({ errorAfterDeltas: 1 });
    const run = await f.service.start(start); await f.service.waitForIdle(run.runId);
    const before = f.database.readRunSnapshot(run.runId);
    expect(before.run.status).toBe('error'); expect(before.messages[0].content).not.toBe('');
    changeProvider(f.database, change);
    const calls = vi.spyOn(f.provider, 'streamChat');
    await expect(f.service.retryTurn(run.runId, before.turns[0].id)).rejects.toMatchObject({ code: change === 'kind' ? 'unsupported' : 'invalid_state' });
    expect(calls).not.toHaveBeenCalled(); expect(f.database.readRunSnapshot(run.runId)).toEqual(before);
    expect(f.service.hasActiveRuns()).toBe(false);
  });
  it.each(['kind', 'disabled'] as const)('rejects continuation after Provider %s changes before it mutates the old partial output', async change => {
    const f = fixture({ errorAfterDeltas: 1 });
    const run = await f.service.start(start); await f.service.waitForIdle(run.runId);
    const before = f.database.readRunSnapshot(run.runId);
    changeProvider(f.database, change); const calls = vi.spyOn(f.provider, 'streamChat');
    await expect(f.service.continueMessage(run.runId, before.messages[0].id)).rejects.toMatchObject({ code: change === 'kind' ? 'unsupported' : 'invalid_state' });
    expect(calls).not.toHaveBeenCalled(); expect(f.database.readRunSnapshot(run.runId)).toEqual(before);
  });
  it.each(['kind', 'disabled'] as const)('rejects explicit interrupted recovery after Provider %s changes without a Mock fallback', async change => {
    const f = fixture();
    f.database.insertRun({ id: 'interrupted', roomId: 'room', status: 'interrupted', workflowSnapshot: {}, task: 'Frozen task', nextTurnIndex: 0, elapsedExecutionMs: 0,
      membersSnapshot: [{ agentId: 'agent', displayName: 'Original', roleTemplateId: 'Drafter', systemPrompt: '', providerId: 'provider', modelId: 'mock', displayOrder: 0 }], maxTurns: 2 });
    changeProvider(f.database, change); const before = f.database.readRunSnapshot('interrupted');
    const calls = vi.spyOn(f.provider, 'streamChat');
    await expect(f.service.recoverInterruptedRun('interrupted', 'resume')).rejects.toMatchObject({ code: change === 'kind' ? 'unsupported' : 'invalid_state' });
    expect(calls).not.toHaveBeenCalled(); expect(f.database.readRunSnapshot('interrupted')).toEqual(before);
  });
  it('preserves explicit Mock retry after a harmless rename and continues using the frozen member', async () => {
    const f = fixture({ errorAfterDeltas: 1 });
    const run = await f.service.start(start); await f.service.waitForIdle(run.runId);
    const before = f.database.readRunSnapshot(run.runId);
    f.database.updateProvider({ id: 'provider', name: 'Renamed', kind: 'mock' });
    f.database.updateAgent({ id: 'agent', roomId: 'room', displayName: 'Future name', roleTemplateId: 'Critic', providerId: null, modelId: null });
    const calls = vi.spyOn(f.provider, 'streamChat');
    await f.service.retryTurn(run.runId, before.turns[0].id);
    expect(calls).toHaveBeenCalledOnce(); expect(calls.mock.calls[0][0]).toMatchObject({ modelId: 'mock', agentRole: 'Drafter' });
    const after = f.database.readRunSnapshot(run.runId);
    expect(after.run.membersSnapshot).toEqual(before.run.membersSnapshot);
    expect(after.messages[0]).toEqual(before.messages[0]); expect(after.messages[1].senderName).toBe('Original');
  });
  it('keeps untouched legacy Demo members runnable without creating an invented Provider', async () => {
    const f = fixture(); const roomId = f.service.createDemoRoom('Legacy compatibility');
    const run = await f.service.start({ ...start, roomId, maxTurns: 3 }); await f.service.waitForIdle(run.runId);
    expect(f.service.getSnapshot(run.runId).status).toBe('completed');
    expect(f.database.getRun(run.runId)?.membersSnapshot?.every(member => member.providerId === null && member.modelId === 'mock')).toBe(true);
  });
});
