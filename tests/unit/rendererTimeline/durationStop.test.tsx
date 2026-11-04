import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { WaitingText } from '../../../src/renderer/features/timeline/MessageItem';
import { RunNotices } from '../../../src/renderer/features/timeline/RunNotices';
import { createWorkflowDraft } from '../../../src/renderer/features/workflows/model';
import { readRoomWorkflow, writeRoomWorkflow } from '../../../src/renderer/features/workflows/storage';
import { durationStopText, durationText, runStatusLabel } from '../../../src/renderer/locales/zhCN';
import { requestFailureText } from '../../../src/renderer/features/timeline/failure';
import type { RunSnapshot } from '../../../src/shared/types/run';

afterEach(() => { cleanup(); localStorage.clear(); });
const off = { enabled: false, run: () => {} };
const stopped = { runId: 'r', roomId: 'room', status: 'error', sequence: 3, workflowSnapshot: {}, turns: [], messages: [], updatedAt: '2026-11-05T00:00:00.000Z',
  durationStop: { limitMs: 300_000, nextAllowanceMs: 7_200_000 } } as unknown as RunSnapshot;
const notices = (snapshot: RunSnapshot, carryOn = { enabled: true, run: vi.fn() }, retry = off) => {
  render(<RunNotices snapshot={snapshot} error="这场讨论达到了时长上限（5 分钟）。" syncFailed={false} onRetrySync={() => {}} retry={retry} resume={off} carryOn={carryOn}
    recover={{ inspect: off, resume: off, discard: off }} onSummarize={() => {}} summaryOpen={false} />);
  return carryOn;
};

describe('the duration limit, in words', () => {
  it('says the discussion reached its limit, gives one way on, and names no timeout or network', () => {
    const carryOn = notices(stopped);
    const text = document.body.textContent!;
    expect(text).toContain('这场讨论达到了时长上限（5 分钟）。');
    expect(text).toContain('继续后最多再运行 2 小时');
    expect(text).toContain('下一位成员接着发言');
    for (const word of ['超时', '网络', '运行失败', '重试当前回合']) expect(text).not.toContain(word);
    fireEvent.click(screen.getByRole('button', { name: '继续讨论' }));
    expect(carryOn.run).toHaveBeenCalledOnce();
  });
  it('says the unfinished member answers again when a turn was cut', () => {
    notices(stopped, undefined, { enabled: true, run: () => {} });
    expect(document.body.textContent).toContain('没说完的这位成员会重新回复');
  });
  it('a failure that is not the limit stays a failure', () => {
    notices({ ...stopped, durationStop: undefined });
    expect(screen.getByText('运行失败')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '继续讨论' })).toBeNull();
  });
  it('reads a length plainly', () => {
    expect(durationText(45_000)).toBe('45 秒');
    expect(durationText(60_000)).toBe('1 分钟');
    expect(durationText(7_500_000)).toBe('125 分钟');
    expect(durationText(7_200_000)).toBe('2 小时');
    expect(durationText(50)).toBe('1 秒');
    expect(durationStopText(60_000)).toBe('这场讨论达到了时长上限（1 分钟）。');
    expect(runStatusLabel(stopped)).toBe('已到时长上限');
    expect(runStatusLabel({ status: 'error' })).toBe('运行失败');
  });
  it('a request timing out says the model never answered, and blames no network; the limit says the limit', () => {
    const own = requestFailureText({ status: 'failed', errorCode: 'timeout' });
    expect(own).toContain('模型一直没有返回完整的回复');
    expect(own).not.toContain('网络');
    expect(requestFailureText({ status: 'aborted', errorCode: 'timeout' })).toContain('达到了时长上限');
  });
});

describe('a model that takes its time', () => {
  it('shows it is still waiting and for how long, and after a minute how to leave', () => {
    vi.useFakeTimers({ now: new Date('2026-11-05T00:00:30.000Z') });
    try {
      render(<WaitingText since="2026-11-05T00:00:00.000Z" />);
      expect(document.body.textContent).toBe('正在思考或生成，还没有输出文字… 已等待 30 秒');
      act(() => { vi.advanceTimersByTime(149_000); });
      expect(document.body.textContent).toContain('已等待 2 分 59 秒');
      expect(document.body.textContent).toContain('不想等可以点“停止”');
    } finally { vi.useRealTimers(); }
  });
});

describe('the default', () => {
  const members = [{ id: 'a', name: 'A', role: '', enabled: true }, { id: 'b', name: 'B', role: '', enabled: true }];
  it('is two hours in every mode', () => {
    for (const template of ['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const) expect(createWorkflowDraft(template, members as never).durationMinutes).toBe('120');
  });
  it('replaces the old default a room remembered, keeps a number the host chose, and only reads the old format that way', () => {
    const draft = createWorkflowDraft('free-chat', members as never);
    localStorage.setItem('roundtable.workflow.r1', JSON.stringify({ version: 1, draft: { ...draft, durationMinutes: '5' } }));
    expect(readRoomWorkflow('r1').draft?.durationMinutes).toBe('120');
    localStorage.setItem('roundtable.workflow.r2', JSON.stringify({ version: 1, draft: { ...draft, durationMinutes: '30' } }));
    expect(readRoomWorkflow('r2').draft?.durationMinutes).toBe('30');
    writeRoomWorkflow('r3', { ...draft, durationMinutes: '5' });
    expect(readRoomWorkflow('r3').draft?.durationMinutes).toBe('5');
  });
});
