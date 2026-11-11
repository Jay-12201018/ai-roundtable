import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { landInProject } from '../../support/landing';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { appApiFor } from '../joint/fixtures';
import { ScriptedProvider } from './fixtures';

afterEach(() => { cleanup(); localStorage.clear(); });
const status = () => screen.getByRole('status', { name: '运行状态' }).textContent!;
// D098: the primary slot is the last control of the composer row; 开始讨论, 暂停 and 继续 take turns in it.
const slot = () => document.querySelector('.composer .controls')!.lastElementChild as HTMLButtonElement;

function setup(name: string) {
  const db = new Database(':memory:'); db.initialize();
  const provider = new ScriptedProvider();
  const service = new RunService(db, provider, createPublicMessagesBuilder());
  window.roundtable = appApiFor(service, db);
  // These tests are about the stricter modes' controls; the group chat's are in tests/integration/groupChat.
  landInProject(window.roundtable, db, service.createDemoRoom(name));
  const runId = () => db.getAttempt(provider.inputs[0].requestId)!.runId;
  return { db, provider, service, runId, close: async () => { cleanup(); await service.shutdown(); db.close(); } };
}
async function start() {
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
}

describe('D098 run controls sit where the host just clicked', () => {
  it('turns 开始讨论 into Pause at the same slot, with Step and a set-apart Stop, and no second set in the side panel', async () => {
    const f = setup('原地控制');
    f.provider.hold.add(0);
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
      expect(slot().textContent).toBe('开始讨论');
      expect(slot().classList.contains('slot')).toBe(true);
      expect(screen.queryByRole('group', { name: '运行控制' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
      await act(async () => { await f.provider.started(0); });
      // The same slot now holds 暂停: a click without moving the pointer pauses. Stop sits apart, first and red.
      expect(slot().textContent).toBe('暂停');
      expect(slot().classList.contains('slot') && slot().classList.contains('is-primary')).toBe(true);
      const bar = screen.getByRole('group', { name: '运行控制' });
      expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['停止', '下一步', '暂停']);
      expect(within(bar).getByRole('button', { name: '停止' }).className).toContain('is-danger');
      expect(bar.querySelector('.controls-gap')).toBeTruthy();
      // One set of run controls only: 本场信息 is for looking things up.
      for (const name of ['暂停', '下一步', '停止']) expect(screen.getAllByRole('button', { name })).toHaveLength(1);

      fireEvent.click(slot());
      await waitFor(() => expect(status()).toContain('正在暂停'));
      await act(async () => { f.provider.release(0); });
      await waitFor(() => expect(status()).toContain('已暂停'));
      // Paused: the same slot offers 继续.
      expect(slot().textContent).toBe('继续');
      expect(screen.getByText('下一步：只让下一位说一次')).toBeTruthy();
    } finally { await f.close(); }
  });

  it('asks once before stopping, without covering Pause, and only then stops', async () => {
    const f = setup('停止确认');
    f.provider.hold.add(0);
    try {
      await start();
      await act(async () => { await f.provider.started(0); });
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      const confirm = screen.getByRole('dialog', { name: '确认停止运行' });
      expect(confirm.textContent).toContain('已生成的部分文字会保留');
      expect(confirm.textContent).toContain('服务商可能已经计入用量');
      // The safe choice holds focus; Pause stays usable while the question is open.
      expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: '不停止' }));
      expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(false);
      expect(f.service.getSnapshot(f.runId()).status).toBe('running');

      fireEvent.click(within(confirm).getByRole('button', { name: '不停止' }));
      expect(screen.queryByRole('dialog', { name: '确认停止运行' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.keyDown(screen.getByRole('button', { name: '停止讨论' }), { key: 'Escape' });
      expect(screen.queryByRole('dialog', { name: '确认停止运行' })).toBeNull();
      expect(status()).toContain('运行中');

      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.click(screen.getByRole('button', { name: '停止讨论' }));
      await waitFor(() => expect(status()).toContain('已停止'));
      expect(f.service.getSnapshot(f.runId()).status).toBe('cancelled');
      expect(f.service.getSnapshot(f.runId()).messages[0]).toMatchObject({ status: 'aborted', content: 'answer 0 @Override 成员 b @Stop' });
      // Settled: no run controls; the slot offers a new discussion, and retry warns that it may bill again.
      await waitFor(() => expect(slot().textContent).toBe('新讨论'));
      expect(screen.queryByRole('group', { name: '运行控制' })).toBeNull();
      expect(screen.queryByRole('dialog', { name: '确认停止运行' })).toBeNull();
      await screen.findByText('重试和续写会重新发送请求，可能再次计费。');
    } finally { await f.close(); }
  });

  it('words the confirmation for a paused Run without claiming a request is in flight', async () => {
    const f = setup('暂停后停止');
    f.provider.hold.add(0);
    try {
      await start();
      await act(async () => { await f.provider.started(0); });
      fireEvent.click(screen.getByRole('button', { name: '暂停' }));
      await act(async () => { f.provider.release(0); });
      await waitFor(() => expect(status()).toContain('已暂停'));
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      const confirm = screen.getByRole('dialog', { name: '确认停止运行' });
      expect(confirm.textContent).toContain('后续回合不再执行');
      expect(confirm.textContent).not.toContain('计费');
    } finally { await f.close(); }
  });
});

describe('D099 step-by-step from the start', () => {
  it('is off by default, remembered, and pauses after each turn so the host can interject before 下一步', async () => {
    const f = setup('逐回合推进');
    try {
      render(<App />);
      const option = await screen.findByLabelText('每回合后暂停') as HTMLInputElement;
      expect(option.checked).toBe(false);
      fireEvent.click(option);
      expect(localStorage.getItem('roundtable.stepMode')).toBe('true');
      await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
      await waitFor(() => expect(status()).toContain('已暂停'));
      expect(f.provider.inputs).toHaveLength(1);
      expect(f.service.getSnapshot(f.runId()).status).toBe('paused');
      expect(f.db.getRun(f.runId())?.mode).toBe('step');
      fireEvent.change(screen.getByLabelText('主持人插话'), { target: { value: '请重点看成本' } });
      fireEvent.click(screen.getByRole('button', { name: '发送插话' }));
      await screen.findByText('请重点看成本');
      fireEvent.click(screen.getByRole('button', { name: '下一步' }));
      await waitFor(() => expect(f.provider.inputs).toHaveLength(2));
      await waitFor(() => expect(status()).toContain('已暂停'));
      expect(f.provider.inputs[1].messages.at(-1)!.content).toContain('【主持人插话】\n> 请重点看成本');
      expect(f.provider.inputs).toHaveLength(2);
    } finally { await f.close(); }
  });
});

describe('D103 output limit before starting', () => {
  it('keeps the limit folded under 更多设置 with the 8192 default, stays open while invalid and starts with the chosen value', async () => {
    const f = setup('输出上限');
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
      const more = screen.getByRole('button', { name: '更多设置' });
      expect(more.getAttribute('aria-expanded')).toBe('false');
      expect(screen.queryByLabelText('单次输出上限（token）')).toBeNull();
      // The popover floats above the composer, outside its control row, so 开始讨论 keeps its place (and Pause later appears there).
      const start = slot();
      fireEvent.click(more);
      const panel = screen.getByRole('group', { name: '更多设置' });
      expect(document.querySelector('.composer')!.contains(panel)).toBe(false);
      expect(panel.compareDocumentPosition(document.querySelector('.composer')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(slot()).toBe(start);
      const field = screen.getByLabelText('单次输出上限（token）') as HTMLInputElement;
      expect(field.value).toBe('8192');
      expect(document.getElementById('output-limit-help')!.textContent).toContain('模型的思考也算在内');
      fireEvent.change(field, { target: { value: '0' } });
      expect(screen.getByRole('alert').textContent).toBe('单次输出上限请输入 1 到 65536 之间的整数。');
      expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(more);
      expect(screen.getByRole('group', { name: '更多设置' })).toBeTruthy();
      expect(more.getAttribute('aria-expanded')).toBe('true');
      fireEvent.change(field, { target: { value: '6000' } });
      fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
      await waitFor(() => expect(f.provider.inputs.length).toBeGreaterThan(0));
      expect(f.provider.inputs[0].outputTokenLimit).toBe(6000);
      expect(f.db.getRun(f.runId())!.outputTokenLimit).toBe(6000);
    } finally { await f.close(); }
  });
});
