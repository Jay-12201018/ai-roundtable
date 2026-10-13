import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';
import { MockProvider } from '../../src/main/providers/mock/MockProvider';
import { RunService } from '../../src/main/services/RunService';

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

describe('Run controls and recovery boundaries', () => {
  it('Step executes exactly one turn and leaves the run paused', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider());
    const roomId = service.createDemoRoom('step');
    const run = await service.start({ roomId, task: 'step', mode: 'step', workflowSnapshot: { templateId: 'draft-review-finalize' } });

    await service.waitForIdle(run.runId);

    expect(service.getSnapshot(run.runId).status).toBe('paused');
    expect(database.listMessages(roomId)).toHaveLength(1);
    database.close();
  });

  it('Pause prevents the next turn after the current turn finishes', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 2 }));
    const roomId = service.createDemoRoom('pause');
    const run = await service.start({ roomId, task: 'pause', workflowSnapshot: { templateId: 'draft-review-finalize' } });
    service.pause(run.runId);
    await service.waitForIdle(run.runId);

    expect(service.getSnapshot(run.runId).status).toBe('paused');
    expect(database.listMessages(roomId)).toHaveLength(1);
    database.close();
  });

  it('Stop aborts the active turn and preserves partial output', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider({ tokenDelayMs: 5 }));
    const roomId = service.createDemoRoom('stop');
    const run = await service.start({ roomId, task: 'stop', workflowSnapshot: { templateId: 'draft-review-finalize' } });
    await sleep(12);
    await service.stop(run.runId);

    const message = database.listMessages(roomId)[0];
    expect(service.getSnapshot(run.runId).status).toBe('cancelled');
    expect(message.status).toBe('aborted');
    expect(message.content.length).toBeGreaterThan(0);
    database.close();
  });

  it('requests a resync when the renderer cursor is ahead of the source snapshot', async () => {
    const database = new Database(':memory:');
    database.initialize();
    const service = new RunService(database, new MockProvider());
    const roomId = service.createDemoRoom('cursor');
    const run = await service.start({ roomId, task: 'cursor', workflowSnapshot: { templateId: 'draft-review-finalize' } });
    await service.waitForIdle(run.runId);

    expect(service.subscribe(run.runId, Number.MAX_SAFE_INTEGER).resyncRequired).toBe(true);
    database.close();
  });
});
