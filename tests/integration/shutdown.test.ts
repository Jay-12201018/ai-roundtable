// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/main/database/Database';
import { RunService } from '../../src/main/services/RunService';
import { MockProvider } from '../../src/main/providers/mock/MockProvider';
import type { ProviderAdapter } from '../../src/main/providers/types';

describe('normal shutdown', () => {
  it('cancels a step that finishes after shutdown begins without losing text or attempts', async () => {
    const database = new Database(':memory:');
    database.initialize();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const provider: ProviderAdapter = {
      listModels: (input) => new MockProvider().listModels(input),
      testConnection: (input) => new MockProvider().testConnection(input),
      async *streamChat(input) {
        yield { type: 'start', requestId: input.requestId };
        yield { type: 'text_delta', requestId: input.requestId, text: 'preserved output' };
        await pending;
        yield { type: 'finish', requestId: input.requestId, reason: 'stop' };
      },
    };
    const service = new RunService(database, provider);
    try {
      const roomId = service.createDemoRoom('isolated shutdown');
      const run = await service.start({ roomId, task: 'fixture', workflowSnapshot: {}, mode: 'step' });
      const shutdown = service.shutdown();
      release();
      await shutdown;
      const after = service.getSnapshot(run.runId);
      expect(after.status).toBe('cancelled');
      expect(after.messages[0]?.content).toBe('preserved output');
      expect(after.turns[0]?.requestId).toBeTruthy();
      expect(after.turns[0]?.outputText).toBe('preserved output');
      expect(service.hasActiveRuns()).toBe(false);
    } finally { release(); await service.shutdown(); database.close(); }
  });
});
