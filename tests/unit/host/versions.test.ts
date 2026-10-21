import { describe, expect, it } from 'vitest';
import { affectedVersions, basisBefore, effectiveInstructions, slotPositions } from '../../../src/main/host/versions';
import type { InstructionRevisionRecord, MessageRecord, VersionRecord } from '../../../src/main/database/Database';
import { hostCommandSchema, hostStateSchema } from '../../../src/shared/schemas/host';
import { ipcContracts, parseIpcOutput } from '../../../src/shared/contracts/ipc';
import { runEventSchema, runSubscriptionSchema } from '../../../src/shared/schemas/run';

const message = (id: string, status = 'completed', turnId?: string): MessageRecord =>
  ({ id, roomId: 'room', runId: 'run', senderType: turnId ? 'agent' : 'user', senderName: 'x', content: id, status, ...(turnId ? { turnId } : {}) });
const version = (messageId: string, slotId: string, versionNumber: number, extra: Partial<VersionRecord> = {}): VersionRecord =>
  ({ messageId, runId: 'run', slotId, versionNumber, origin: versionNumber === 1 ? 'original' : 'regenerate', active: true, basis: null, turnId: slotId.startsWith('t') ? slotId : undefined, ...extra });

describe('R12 version basis and affected marks', () => {
  // t1: m1 (old) → m5 (regenerated, active); h: host message; t2: m3 based on m1; t3: m4 based on m1,h,m3.
  const messages = [message('m1', 'completed', 't1'), message('h'), message('m3', 'completed', 't2'), message('m4', 'completed', 't3'), message('m5', 'completed', 't1'), message('m6', 'streaming', 't3')];
  const versions = [
    version('m1', 't1', 1, { active: false }), version('h', 'h', 1), version('m3', 't2', 1, { basis: ['m1', 'h'] }),
    version('m4', 't3', 1, { basis: ['m1', 'h', 'm3'] }), version('m5', 't1', 2, { basis: [] }), version('m6', 't3', 2, { active: false, basis: ['m5', 'h', 'm3'] }),
  ];

  it('orders slots by their original position, never by a later version', () => {
    expect([...slotPositions(messages, versions)]).toEqual([['t1', 0], ['h', 1], ['t2', 2], ['t3', 3]]);
  });

  it('bases a request on active completed versions before its slot', () => {
    expect(basisBefore(messages, versions)).toEqual(['m5', 'h', 'm3', 'm4']);
    expect(basisBefore(messages, versions, 't3')).toEqual(['m5', 'h', 'm3']);
    expect(basisBefore(messages, versions, 't1')).toEqual([]);
  });

  it('marks inactive basis entries directly and affected entries transitively; host text is never affected', () => {
    const affected = affectedVersions(messages, versions);
    expect(affected.get('m3')).toEqual(['m1']);
    expect(affected.get('m4')).toEqual(['m1', 'm3']);
    expect(affected.get('m6')).toEqual(['m3']);
    expect(affected.get('h')).toEqual([]);
    expect(affected.get('m5')).toEqual([]);
  });

  it('derives the basis of pre-R12 versions from the latest completed versions created before them', () => {
    const legacy = [version('m1', 't1', 1), version('h', 'h', 1), version('m3', 't2', 1), version('m4', 't3', 1), version('m5', 't1', 2, { active: false }), version('m6', 't3', 2, { active: false })];
    legacy[0].active = true;
    expect(affectedVersions(messages, legacy).get('m4')).toEqual([]);
    legacy[0].active = false; legacy[4].active = true;
    expect(affectedVersions(messages, legacy).get('m4')).toEqual(['m1', 'm3']);
  });

  it('uses the latest revision of each instruction and drops cleared ones', () => {
    const revision = (instructionId: string, revision: number, content: string | null): InstructionRevisionRecord =>
      ({ id: `${instructionId}-${revision}`, runId: 'run', instructionId, revision, content, actionId: `a-${instructionId}-${revision}`, createdAt: '2026-10-21T00:00:00.000Z' });
    expect(effectiveInstructions([revision('i1', 1, 'one'), revision('i2', 1, 'two'), revision('i1', 2, 'one+'), revision('i2', 2, null)]).map(item => item.content)).toEqual(['one+']);
  });
});

describe('R12 host contract', () => {
  it('accepts only strict, non-blank host commands and keeps text verbatim', () => {
    expect(hostCommandSchema.parse({ runId: 'r', clientRequestId: 'c', kind: 'interject', content: '  保留空格 ' })).toMatchObject({ content: '  保留空格 ' });
    for (const invalid of [
      { runId: 'r', clientRequestId: 'c', kind: 'interject', content: ' \n ' },
      { runId: 'r', clientRequestId: 'c', kind: 'setOverride' },
      { runId: 'r', clientRequestId: 'c', kind: 'setOverride', agentId: 'a', scheduleNow: true },
      { runId: 'r', kind: 'cancelOverride' },
      { runId: 'r', clientRequestId: 'c', kind: 'pause' },
      { runId: 'r', clientRequestId: 'c', kind: 'setInstruction', content: 'x'.repeat(4001) },
    ]) expect(hostCommandSchema.safeParse(invalid).success).toBe(false);
  });

  it('matches IPC results to the requested Run and command kind', () => {
    const input = { runId: 'r', clientRequestId: 'c', kind: 'interject' as const, content: 'x' };
    expect(parseIpcOutput('host.command', input, { runId: 'r', actionId: 'a', kind: 'interject', duplicate: false })).toMatchObject({ actionId: 'a' });
    expect(() => parseIpcOutput('host.command', input, { runId: 'other', actionId: 'a', kind: 'interject', duplicate: false })).toThrow();
    expect(() => parseIpcOutput('host.command', input, { runId: 'r', actionId: 'a', kind: 'setOverride', duplicate: false })).toThrow();
    expect(ipcContracts['host.command'].input.safeParse({ ...input, extra: true }).success).toBe(false);
  });

  it('validates host state and the run-level host event', () => {
    expect(hostStateSchema.safeParse({ instructions: [], actions: [], override: { actionId: 'a', agentId: 'b', status: 'consumed', createdAt: '2026-10-21T00:00:00.000Z' } }).success).toBe(false);
    const event = { version: 1, runId: 'r', sequence: 3, timestamp: '2026-10-21T00:00:00.000Z', type: 'host_updated', payload: { actionId: 'a', kind: 'setOverride' } };
    expect(runEventSchema.safeParse(event).success).toBe(true);
    expect(runEventSchema.safeParse({ ...event, turnId: 't', requestId: 'q' }).success).toBe(false);
    expect(runEventSchema.safeParse({ ...event, payload: { actionId: 'a', kind: 'pause' } }).success).toBe(false);
    const snapshot = { runId: 'r', roomId: 'room', status: 'paused', sequence: 3, workflowSnapshot: {}, turns: [], messages: [], updatedAt: '2026-10-21T00:00:00.000Z' };
    expect(runSubscriptionSchema.safeParse({ snapshot, events: [event], nextCursor: 3, resyncRequired: false }).success).toBe(true);
  });
});
