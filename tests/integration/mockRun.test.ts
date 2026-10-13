import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';
import { MockProvider } from '../../src/main/providers/mock/MockProvider';
import { RunService } from '../../src/main/services/RunService';
import type { RunSnapshot } from '../../src/shared/types/run';

describe('Mock multi-agent run', () => {
  it('drafts, reviews, finalizes, streams events, and persists history', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 0 }));
    const roomId = service.createDemoRoom('设计一个校园跑腿平台');
    const events: string[] = [];
    const unsubscribe = service.onEvent((event) => events.push(event.type));

    const run = await service.start({ roomId, task: '设计一个校园跑腿平台', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    await service.waitForIdle(run.runId);
    unsubscribe();

    expect(service.getSnapshot(run.runId).status).toBe('completed');
    expect(database.listMessages(roomId).map((message) => message.senderName)).toEqual(['起草者', '审查者', '综合者']);
    expect(events).toContain('text_delta');
    expect(events).toContain('turn_completed');
    expect(service.subscribe(run.runId, 0).events.length).toBeGreaterThan(0);
    database.close();
  });

  it('does not start a second active run in the same room', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 1 }));
    const roomId = service.createDemoRoom('demo');
    const first = service.start({ roomId, task: 'demo', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });

    await expect(service.start({ roomId, task: 'demo', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } })).rejects.toThrow(/active run/i);
    await service.waitForIdle((await first).runId);
    database.close();
  });

  it('rejects a concurrent run in another room and releases the lock when completed', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 1 }));
    const firstRoomId = service.createDemoRoom('first');
    const secondRoomId = service.createDemoRoom('second');

    try {
      const first = await service.start({ roomId: firstRoomId, task: 'first', maxTurns: 1, workflowSnapshot: {} });
      await expect(service.start({ roomId: secondRoomId, task: 'second', workflowSnapshot: {} })).rejects.toThrow(/active run/i);
      expect(database.listMessages(secondRoomId)).toHaveLength(0);
      await service.waitForIdle(first.runId);
      expect(service.getSnapshot(first.runId).status).toBe('completed');

      const second = await service.start({ roomId: secondRoomId, task: 'second', maxTurns: 1, workflowSnapshot: {} });
      await service.waitForIdle(second.runId);
      expect(service.getSnapshot(second.runId).status).toBe('completed');
    } finally {
      await service.shutdown();
      database.close();
    }
  });

  it.each(['stop', 'shutdown'] as const)('holds the global lock while paused and releases it after %s', async (action) => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 0 }));
    const firstRoomId = service.createDemoRoom('paused');
    const secondRoomId = service.createDemoRoom('next');

    try {
      const first = await service.start({ roomId: firstRoomId, task: 'paused', mode: 'step', workflowSnapshot: {} });
      await service.waitForIdle(first.runId);
      expect(service.getSnapshot(first.runId).status).toBe('paused');
      await expect(service.start({ roomId: secondRoomId, task: 'next', workflowSnapshot: {} })).rejects.toThrow(/active run/i);

      if (action === 'stop') {
        await service.stop(first.runId);
        expect(service.getSnapshot(first.runId).status).toBe('cancelled');
      } else await service.shutdown();

      const next = await service.start({ roomId: secondRoomId, task: 'next', maxTurns: 1, workflowSnapshot: {} });
      await service.waitForIdle(next.runId);
      expect(service.getSnapshot(next.runId).status).toBe('completed');
    } finally {
      await service.shutdown();
      database.close();
    }
  });

  it('snapshots include current run messages at the event cursor and exclude previous runs', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 0 }));
    const roomId = service.createDemoRoom('snapshot');
    database.insertRun({ id: 'previous-run', roomId, status: 'completed', workflowSnapshot: {} });
    database.insertMessage({ id: 'previous-message', roomId, runId: 'previous-run', senderType: 'agent', senderName: '旧消息', content: 'previous content' });
    const textByMessage = new Map<string, string>();
    const checkpoints: Array<{ snapshot: RunSnapshot; sequence: number; messageId: string; text: string }> = [];
    const unsubscribe = service.onEvent((event) => {
      if (event.type !== 'text_delta') return;
      const payload = event.payload as { messageId: string; text: string };
      const text = (textByMessage.get(payload.messageId) ?? '') + payload.text;
      textByMessage.set(payload.messageId, text);
      checkpoints.push({ snapshot: service.getSnapshot(event.runId), sequence: event.sequence, messageId: payload.messageId, text });
    });

    try {
      const run = await service.start({ roomId, task: 'snapshot', workflowSnapshot: { templateId: 'draft-review-finalize' } });
      await service.waitForIdle(run.runId);

      expect(checkpoints.length).toBeGreaterThan(0);
      for (const checkpoint of checkpoints) {
        expect(checkpoint.snapshot.sequence).toBe(checkpoint.sequence);
        expect(checkpoint.snapshot.messages.find((message) => message.id === checkpoint.messageId)?.content).toBe(checkpoint.text);
        expect(checkpoint.snapshot.messages.some((message) => message.id === 'previous-message')).toBe(false);
      }
      expect(service.getSnapshot(run.runId).messages).toHaveLength(3);
    } finally {
      unsubscribe();
      await service.shutdown();
      database.close();
    }
  });
});
