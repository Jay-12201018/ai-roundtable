import { describe, expect, it } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { RunService } from '../../../src/main/services/RunService';
import type { RunSessionApiContract } from '../../../src/shared/contracts/app';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';

// Exercise the frozen Main API with an in-memory DB; no Electron entry, keys or network.
function setup(tokenDelayMs = 0) {
  const database = new Database(':memory:');
  database.initialize();
  const service = new RunService(database, new MockProvider({ tokenDelayMs }));
  const api: RunSessionApiContract = {
    room: { createDemo: async objective => ({ roomId: service.createDemoRoom(objective) }), getMessages: async id => service.getMessages(id) },
    run: {
      start: input => service.start(input), subscribe: async (id, cursor) => service.subscribe(id, cursor), getSnapshot: async id => service.getSnapshot(id),
      onEvent: listener => service.onEvent(listener), pause: async id => service.pause(id), stop: id => service.stop(id), step: id => service.step(id), resumeRun: id => service.resumeRun(id),
      retryTurn: (id, turn) => service.retryTurn(id, turn), continueMessage: (id, message) => service.continueMessage(id, message), recoverInterruptedRun: (id, decision) => service.recoverInterruptedRun(id, decision),
    },
  };
  const session = createRendererSession(api);
  const dispose = session.mount();
  return { database, service, session, dispose };
}

describe('Renderer projection against the merged R03 Main', () => {
  it('converges three completed Mock turns to the exact persisted final snapshot', async () => {
    const { database, service, session, dispose } = setup();
    try {
      session.store.getState().setDraft('真实的持久任务目标');
      await session.startRun();
      const runId = session.store.getState().runId!;
      await service.waitForIdle(runId);
      await new Promise(resolve => setTimeout(resolve, 40));
      expect(session.store.getState().syncStatus).toBe('ready');
      expect(session.store.getState().snapshot).toEqual(service.getSnapshot(runId));
      expect(session.store.getState().snapshot?.messages).toHaveLength(3);
      expect(session.store.getState().snapshot?.messages.every(message => message.status === 'completed')).toBe(true);
      expect(session.store.getState().snapshot?.execution?.task).toBe('真实的持久任务目标');
    } finally { dispose(); await service.shutdown(); database.close(); }
  });

  it('shows live text and retains partial aborted output after Stop', async () => {
    const { database, service, session, dispose } = setup(5);
    try {
      await session.startRun();
      const runId = session.store.getState().runId!;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => { unwatch(); reject(new Error('No live projection')); }, 2000);
        const unwatch = session.store.subscribe(state => {
          if (state.snapshot?.messages[0]?.content) { clearTimeout(timer); unwatch(); resolve(); }
        });
      });
      const partial = session.store.getState().snapshot!.messages[0].content;
      await session.control('stop');
      expect(session.store.getState().snapshot?.status).toBe('cancelled');
      expect(session.store.getState().snapshot?.messages[0].content.startsWith(partial)).toBe(true);
      expect(session.store.getState().snapshot?.messages[0].status).toBe('aborted');
      expect(session.store.getState().snapshot).toEqual(service.getSnapshot(runId));
    } finally { dispose(); await service.shutdown(); database.close(); }
  });
});
