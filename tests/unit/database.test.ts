import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';

describe('Database', () => {
  it('runs migrations and persists a room, run, message, and event atomically', () => {
    const database = new Database(':memory:');

    database.initialize();
    database.transaction(() => {
      database.insertRoom({ id: 'room-1', name: 'Demo', objective: 'Draft a plan' });
      database.insertRun({ id: 'run-1', roomId: 'room-1', status: 'running', workflowSnapshot: { templateId: 'draft-review-finalize' } });
      database.insertMessage({ id: 'message-1', roomId: 'room-1', runId: 'run-1', senderType: 'agent', senderName: 'A', content: 'Draft' });
      database.appendRunEvent({ runId: 'run-1', type: 'run_state_changed', payload: { status: 'running' } });
    });

    expect(database.getRoom('room-1')?.name).toBe('Demo');
    expect(database.getRun('run-1')?.workflowSnapshot).toEqual({ templateId: 'draft-review-finalize' });
    expect(database.listMessages('room-1')).toHaveLength(1);
    expect(database.listRunEvents('run-1', 0)[0]?.sequence).toBe(1);
    database.close();
  });

  it('rolls back all writes when a transaction fails', () => {
    const database = new Database(':memory:');
    database.initialize();

    expect(() => database.transaction(() => {
      database.insertRoom({ id: 'room-1', name: 'Demo', objective: 'Draft a plan' });
      throw new Error('abort');
    })).toThrow('abort');

    expect(database.getRoom('room-1')).toBeUndefined();
    database.close();
  });
});
