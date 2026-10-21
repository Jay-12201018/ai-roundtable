import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import { bridge } from '../rendererSubscriptions/fixtures';

const config = { version: 1 as const, templateId: 'free-chat' as const,
  stages: [{ id: 'discussion', kind: 'discussion' as const, memberIds: ['a'], rounds: 1 }],
  limits: { maxTurns: 1, maxDurationMs: 30000, outputTokenLimit: 128 }, endCondition: { type: 'plan_complete' as const } };
afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
describe('workflow start through the existing Renderer session', () => {
  it('sends only the applied canonical config and Main preview proof, replacing the legacy template', async () => {
    const fake = bridge(); const session = createRendererSession(fake.api, localStorage, { requireRoom: true });
    const dispose = session.mount(); session.selectRoom('selected');
    await session.startRun({ workflowConfig: config, workflowPreviewId: 'main-preview' });
    expect(fake.api.run.start).toHaveBeenCalledExactlyOnceWith({ roomId: 'selected', task: '设计一个校园跑腿平台', workflowConfig: config, workflowPreviewId: 'main-preview' });
    dispose();
  });
  it('preserves the legacy Mock start when no new configuration was explicitly applied', async () => {
    const fake = bridge(); const session = createRendererSession(fake.api, localStorage, { requireRoom: true });
    const dispose = session.mount(); session.selectRoom('selected'); await session.startRun();
    expect(fake.api.run.start).toHaveBeenCalledExactlyOnceWith({ roomId: 'selected', task: '设计一个校园跑腿平台', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    dispose();
  });
});
