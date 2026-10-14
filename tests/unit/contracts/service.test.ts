// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { runEventSchema, runSubscriptionSchema } from '../../../src/shared/schemas/run';
import type { NormalizedChunk, StreamChatInput } from '../../../src/shared/contracts/provider';
import { publicError } from '../../../src/shared/schemas/error';
import { ContractError } from '../../../src/shared/contracts/errors';
import type { StartRunInput } from '../../../src/shared/contracts/run';

describe('Main persistence and Provider contract wiring', () => {
  it('rejects workflow credential fields before any run is persisted', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider());
    try {
      const roomId = service.createDemoRoom('fixture');
      const workflowSnapshots: StartRunInput['workflowSnapshot'][] = [{ apiKey: 'fixture-secret' }, { steps: [{ provider: { access_token: 'fixture-secret' } }] }];
      for (const workflowSnapshot of workflowSnapshots) {
        await expect(service.start({ roomId, task: 'fixture', workflowSnapshot })).rejects.toMatchObject({ code: 'invalid_input' });
      }
      expect(db['db'].prepare('SELECT COUNT(*) AS count FROM workflow_runs').get()).toEqual({ count: 0 });
      expect(db.listMessages(roomId)).toEqual([]);
      expect(service.hasActiveRuns()).toBe(false);
    } finally { await service.shutdown(); db.close(); }
  });
  it('rejects legacy credential configuration in snapshots without rewriting the stored record', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider());
    try {
      const roomId = service.createDemoRoom('fixture');
      db.insertRun({ id: 'legacy-run', roomId, status: 'interrupted', workflowSnapshot: { provider: { apiKey: 'fixture-secret' } } });
      const stored = db.getRun('legacy-run');
      expect(() => service.getSnapshot('legacy-run')).toThrow();
      expect(() => service.subscribe('legacy-run', 0)).toThrow();
      expect(db.getRun('legacy-run')).toEqual(stored);
      expect(db.listRunEvents('legacy-run', 0)).toEqual([]);
    } finally { await service.shutdown(); db.close(); }
  });
  it('correlates every streamed event with the persisted Main request and message', async () => {
    const db = new Database(':memory:'); db.initialize();
    const inputs: StreamChatInput[] = [];
    class InspectProvider extends MockProvider {
      override async *streamChat(input: StreamChatInput) {
        inputs.push(input);
        yield* super.streamChat(input);
      }
    }
    const service = new RunService(db, new InspectProvider());
    try {
      const roomId = service.createDemoRoom('fixture');
      const run = await service.start({ roomId, task: 'fixture', workflowSnapshot: {}, mode: 'step', outputTokenLimit: 64 });
      await service.waitForIdle(run.runId);
      const subscription = service.subscribe(run.runId, 0);
      expect(runSubscriptionSchema.safeParse(subscription).success).toBe(true);
      const turn = subscription.snapshot.turns[0];
      expect(inputs[0]).toMatchObject({ requestId: turn.requestId, modelId: 'mock', outputTokenLimit: 64 });
      expect(inputs[0].signal).toBeInstanceOf(AbortSignal);
      for (const event of subscription.events) {
        expect(runEventSchema.safeParse(event).success).toBe(true);
        if (event.type !== 'run_state_changed' && event.type !== 'snapshot_required') expect(event).toMatchObject({ turnId: turn.turnId, requestId: turn.requestId });
      }
    } finally { await service.shutdown(); db.close(); }
  });
  it('adapts v0 events without rewriting stored evidence and requests resync on unknown events', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider());
    try {
      const roomId = service.createDemoRoom('fixture');
      db.insertRun({ id: 'r', roomId, status: 'running', workflowSnapshot: {} });
      db.insertTurn({ id: 't', runId: 'r', agentId: `${roomId}-agent-drafter`, requestId: 'q', status: 'running', turnIndex: 0 });
      db.insertMessage({ id: 'm', roomId, runId: 'r', turnId: 't', senderType: 'agent', senderName: '起草者', content: 'a', status: 'streaming' });
      db.appendRunEvent({ runId: 'r', type: 'text_delta', payload: { turnId: 't', messageId: 'm', senderName: '起草者', text: 'a' } });
      const stored = db.listRunEvents('r', 0);
      expect(service.subscribe('r', 0).events[0]).toMatchObject({ version: 1, turnId: 't', requestId: 'q' });
      expect(db.listRunEvents('r', 0)).toEqual(stored);
      db.appendRunEvent({ runId: 'r', type: 'turn_failed', payload: { turnId: 't', messageId: 'm', error: 'fixture-secret' } });
      expect(service.subscribe('r', 0).events.at(-1)).toMatchObject({ payload: { error: { code: 'internal_error', message: 'Operation failed', retryable: false } } });
      expect(db.listRunEvents('r', 0).at(-1)?.payload).toMatchObject({ error: 'fixture-secret' });
      db.appendRunEvent({ runId: 'r', type: 'future_event', payload: { private: 'fixture-secret' } });
      expect(service.subscribe('r', 0)).toMatchObject({ resyncRequired: true, events: [], nextCursor: 3 });
    } finally { await service.shutdown(); db.close(); }
  });
  it('returns explicit unsupported for recovery resume/retry and generation placeholders', async () => {
    const db = new Database(':memory:'); db.initialize();
    const service = new RunService(db, new MockProvider());
    try {
      const roomId = service.createDemoRoom('fixture');
      db.insertRun({ id: 'r', roomId, status: 'interrupted', workflowSnapshot: {} });
      await expect(service.recoverInterruptedRun('r', 'inspect')).resolves.toBeUndefined();
      for (const decision of ['resume', 'retry'] as const) await expect(service.recoverInterruptedRun('r', decision)).rejects.toMatchObject({ code: 'unsupported' });
      await expect(service.retryTurn('r', 't')).rejects.toMatchObject({ code: 'unsupported' });
      await expect(service.continueMessage('r', 'm')).rejects.toMatchObject({ code: 'unsupported' });
      await service.recoverInterruptedRun('r', 'discard');
      expect(service.getSnapshot('r').status).toBe('cancelled');
    } finally { await service.shutdown(); db.close(); }
  });
  it('rejects cross-request Provider chunks and never persists raw error text', async () => {
    const db = new Database(':memory:'); db.initialize();
    class BadProvider extends MockProvider {
      override async *streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk> {
        yield { type: 'start', requestId: input.requestId };
        yield { type: 'text_delta', requestId: 'other-request', text: 'must not persist' };
        throw new Error('fixture-secret');
      }
    }
    const service = new RunService(db, new BadProvider());
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'fixture', workflowSnapshot: {} });
      await service.waitForIdle(run.runId);
      const after = service.getSnapshot(run.runId);
      expect(after.status).toBe('error');
      expect(after.messages[0].content).toBe('');
      expect(JSON.stringify(db.listRunEvents(run.runId, 0))).not.toMatch(/fixture-secret|must not persist/);
      expect(service.subscribe(run.runId, 0).events.find((event) => event.type === 'turn_failed')).toMatchObject({ payload: { error: { code: 'invalid_response' } } });
    } finally { await service.shutdown(); db.close(); }
  });
  it.each(['missing_start', 'duplicate_start', 'missing_finish', 'after_finish', 'provider_error', 'raw_exception', 'structured_exception'] as const)('handles %s without losing evidence or automatically retrying', async (scenario) => {
    const db = new Database(':memory:'); db.initialize();
    let calls = 0;
    class FixtureProvider extends MockProvider {
      override async *streamChat({ requestId }: StreamChatInput): AsyncIterable<NormalizedChunk> {
        calls++;
        if (scenario === 'provider_error') { yield { type: 'error', requestId, error: publicError('rate_limited') }; return; }
        if (scenario !== 'missing_start') yield { type: 'start', requestId };
        if (scenario === 'duplicate_start') yield { type: 'start', requestId };
        if (scenario === 'after_finish') yield { type: 'finish', requestId, reason: 'stop' };
        yield { type: 'text_delta', requestId, text: 'partial' };
        if (scenario === 'raw_exception') throw new Error('fixture-secret');
        if (scenario === 'structured_exception') {
          const error = new ContractError('internal_error');
          error.detail.message = 'fixture-secret';
          throw error;
        }
        if (scenario !== 'missing_finish') yield { type: 'finish', requestId, reason: 'stop' };
      }
    }
    const service = new RunService(db, new FixtureProvider());
    try {
      const run = await service.start({ roomId: service.createDemoRoom('fixture'), task: 'fixture', workflowSnapshot: {} });
      await service.waitForIdle(run.runId);
      const after = service.getSnapshot(run.runId);
      expect(after.status).toBe('error');
      expect(calls).toBe(1);
      expect(after.turns[0]).toMatchObject({ status: 'failed' });
      expect(after.messages[0].content).toBe(['missing_finish', 'raw_exception', 'structured_exception'].includes(scenario) ? 'partial' : '');
      const events = service.subscribe(run.runId, 0).events;
      const code = scenario === 'provider_error' ? 'rate_limited' : ['raw_exception', 'structured_exception'].includes(scenario) ? 'internal_error' : 'invalid_response';
      expect(events.find((event) => event.type === 'turn_failed')).toMatchObject({ payload: { error: { code } } });
      expect(JSON.stringify(db.listRunEvents(run.runId, 0))).not.toContain('fixture-secret');
    } finally { await service.shutdown(); db.close(); }
  });
});
