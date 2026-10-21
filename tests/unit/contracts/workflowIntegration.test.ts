import { describe, expect, it } from 'vitest';
import { ipcContracts, parseIpcOutput } from '../../../src/shared/contracts/ipc';
import { startRunInputSchema } from '../../../src/shared/schemas/run';

const config = { version: 1, templateId: 'free-chat', stages: [{ id: 'discussion', kind: 'discussion', memberIds: ['a'], rounds: 1 }], limits: { maxTurns: 1, maxDurationMs: 1000, outputTokenLimit: 32 }, endCondition: { type: 'plan_complete' } };
describe('production workflow IPC contract', () => {
  it('accepts only configuration at the preview boundary and rejects injected authority', () => {
    expect(ipcContracts['run.previewWorkflow'].input.safeParse({ roomId: 'room', config }).success).toBe(true);
    expect(ipcContracts['run.previewWorkflow'].input.safeParse({ roomId: 'room', config, allowGeneration: true }).success).toBe(false);
    expect(startRunInputSchema.safeParse({ roomId: 'room', task: 'task', workflowConfig: config, workflowPreviewId: 'preview' }).success).toBe(true);
  });
  it('rejects a preview response for another room or a different requested config', () => {
    const response = { previewId: 'preview', snapshot: { version: 1, roomId: 'room', config, members: [{ agentId: 'a', displayName: 'A', roleTemplateId: 'role', systemPrompt: '', providerId: 'mock', modelId: 'mock', displayOrder: 0 }], steps: [{ index: 0, stageId: 'discussion', kind: 'discussion', agentId: 'a', round: 1 }] } };
    expect(parseIpcOutput('run.previewWorkflow', { roomId: 'room', config } as never, response)).toEqual(response);
    response.snapshot.roomId = 'other';
    expect(() => parseIpcOutput('run.previewWorkflow', { roomId: 'room', config } as never, response)).toThrow();
    response.snapshot.roomId = 'room';
    response.snapshot.config.limits.maxTurns = 2;
    expect(() => parseIpcOutput('run.previewWorkflow', { roomId: 'room', config: { ...config, limits: { ...config.limits, maxTurns: 1 } } } as never, response)).toThrow();
  });
});
