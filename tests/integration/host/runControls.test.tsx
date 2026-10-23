import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { appApiFor } from '../joint/fixtures';
import { ScriptedProvider } from './fixtures';

afterEach(() => { cleanup(); localStorage.clear(); });
const status = () => document.querySelector('.timeline .status')!.textContent!;
const firstAction = () => document.querySelector('.composer-actions')!.querySelector('button')!;

function setup(name: string) {
  const db = new Database(':memory:'); db.initialize();
  const provider = new ScriptedProvider();
  const service = new RunService(db, provider, createPublicMessagesBuilder());
  window.roundtable = appApiFor(service, db);
  service.createDemoRoom(name);
  const runId = () => db.getAttempt(provider.inputs[0].requestId)!.runId;
  return { db, provider, service, runId, close: async () => { cleanup(); await service.shutdown(); db.close(); } };
}
async function start() {
  render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
}

describe('D098 run controls sit where the host just clicked', () => {
  it('turns 开始协作 into Pause at the same slot, with Step and a set-apart Stop, and no second set in the side panel', async () => {
    const f = setup('原地控制');
    f.provider.hold.add(0);
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
      expect(firstAction().textContent).toBe('开始协作');
      expect(screen.queryByRole('group', { name: '运行控制' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
      await act(async () => { await f.provider.started(0); });
      // The first control of the composer action row is now 暂停: a click without moving the pointer pauses.
      expect(firstAction().textContent).toBe('暂停');
      expect(firstAction().className).toContain('composer-primary');
      const bar = screen.getByRole('group', { name: '运行控制' });
      expect(within(bar).getAllByRole('button').map(button => button.textContent)).toEqual(['暂停', '下一步', '停止']);
      expect(within(bar).getByRole('button', { name: '停止' }).className).toContain('danger');
      const panel = document.getElementById('host-controls')!;
      for (const name of ['暂停', '继续', '下一步', '停止']) expect(within(panel).queryByRole('button', { name })).toBeNull();

      fireEvent.click(firstAction());
      await waitFor(() => expect(status()).toContain('正在暂停'));
      await act(async () => { f.provider.release(0); });
      await waitFor(() => expect(status()).toContain('已暂停'));
      // Paused: the same slot offers 继续.
      expect(firstAction().textContent).toBe('继续');
      expect(screen.getByText(/然后点“下一步”让下一位发言/u)).toBeTruthy();
    } finally { await f.close(); }
  });

  it('asks once before stopping, without covering Pause, and only then stops', async () => {
    const f = setup('停止确认');
    f.provider.hold.add(0);
    try {
      await start();
      await act(async () => { await f.provider.started(0); });
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      const confirm = screen.getByRole('group', { name: '确认停止运行' });
      expect(confirm.textContent).toContain('已生成的部分文字会保留');
      expect(confirm.textContent).toContain('可能已经计费');
      // The safe choice holds focus; Pause stays usable while the question is open.
      expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: '不停止' }));
      expect((screen.getByRole('button', { name: '暂停' }) as HTMLButtonElement).disabled).toBe(false);
      expect(f.service.getSnapshot(f.runId()).status).toBe('running');

      fireEvent.click(within(confirm).getByRole('button', { name: '不停止' }));
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.keyDown(screen.getByRole('button', { name: '确认停止' }), { key: 'Escape' });
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
      expect(status()).toContain('运行中');

      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.click(screen.getByRole('button', { name: '确认停止' }));
      await waitFor(() => expect(status()).toContain('已停止'));
      expect(f.service.getSnapshot(f.runId()).status).toBe('cancelled');
      expect(f.service.getSnapshot(f.runId()).messages[0]).toMatchObject({ status: 'aborted', content: 'answer 0 @Override 成员 b @Stop' });
      // Settled: 开始协作 is back in the slot; retry warns that it may bill again.
      await waitFor(() => expect(firstAction().textContent).toBe('开始协作'));
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
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
      const confirm = screen.getByRole('group', { name: '确认停止运行' });
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
      const option = await screen.findByLabelText('每个回合结束后暂停，方便插话或点名') as HTMLInputElement;
      expect(option.checked).toBe(false);
      fireEvent.click(option);
      expect(localStorage.getItem('roundtable.stepMode')).toBe('true');
      await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
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
  it('keeps the limit folded under 更多设置 with the 4096 default, validates it and starts with the chosen value', async () => {
    const f = setup('输出上限');
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
      const more = screen.getByText('更多设置').closest('details')!;
      expect(more.open).toBe(false);
      const field = screen.getByLabelText('单次输出上限（token）') as HTMLInputElement;
      expect(field.value).toBe('4096');
      expect(document.getElementById('output-limit-help')!.textContent).toContain('每次请求按这个上限预留费用');
      fireEvent.change(field, { target: { value: '0' } });
      expect(screen.getByText('单次输出上限请输入 1 到 65536 之间的整数。')).toBeTruthy();
      expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(true);
      expect(more.open).toBe(true);
      fireEvent.change(field, { target: { value: '6000' } });
      fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
      await waitFor(() => expect(f.provider.inputs.length).toBeGreaterThan(0));
      expect(f.provider.inputs[0].outputTokenLimit).toBe(6000);
      expect(f.db.getRun(f.runId())!.outputTokenLimit).toBe(6000);
    } finally { await f.close(); }
  });
});
