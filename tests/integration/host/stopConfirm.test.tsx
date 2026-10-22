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

describe('D098 Stop is set apart from Pause and asks once', () => {
  it('keeps Stop outside the Pause/Step/Resume group and only stops after an explicit confirmation', async () => {
    const db = new Database(':memory:'); db.initialize();
    const provider = new ScriptedProvider();
    const service = new RunService(db, provider, createPublicMessagesBuilder());
    window.roundtable = appApiFor(service, db);
    service.createDemoRoom('停止确认');
    provider.hold.add(0);
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
      await act(async () => { await provider.started(0); });
      const group = screen.getByRole('group', { name: '运行控制' });
      expect(within(group).getAllByRole('button').map(button => button.textContent)).toEqual(['暂停', '下一步', '继续']);
      expect(within(group).queryByRole('button', { name: '停止' })).toBeNull();
      const stop = screen.getByRole('button', { name: '停止' });
      expect(stop.className).toContain('danger');
      expect(stop.getAttribute('aria-describedby')).toBe('stop-help');

      // First click only asks; nothing is sent to Main.
      fireEvent.click(stop);
      const confirm = screen.getByRole('group', { name: '确认停止运行' });
      expect(confirm.textContent).toContain('已生成的部分文字会保留');
      expect(confirm.textContent).toContain('可能已经计费');
      expect(document.activeElement).toBe(within(confirm).getByRole('button', { name: '确认停止' }));
      expect(service.getSnapshot(db.getAttempt(provider.inputs[0].requestId)!.runId).status).toBe('running');

      // Declining (button or Escape) keeps the Run going.
      fireEvent.click(within(confirm).getByRole('button', { name: '不停止' }));
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.keyDown(screen.getByRole('button', { name: '确认停止' }), { key: 'Escape' });
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
      expect(status()).toContain('运行中');

      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      fireEvent.click(screen.getByRole('button', { name: '确认停止' }));
      await waitFor(() => expect(status()).toContain('已停止'));
      const runId = db.getAttempt(provider.inputs[0].requestId)!.runId;
      expect(service.getSnapshot(runId).status).toBe('cancelled');
      expect(service.getSnapshot(runId).messages[0]).toMatchObject({ status: 'aborted', content: 'answer 0 @Override 成员 b @Stop' });
      expect(screen.queryByRole('group', { name: '确认停止运行' })).toBeNull();
      // After stopping, the Pause/Stop explanation goes away and the repeat actions say they may bill again.
      expect(document.getElementById('stop-help')).toBeNull();
      await screen.findByText('重试和续写会重新发送请求，可能再次计费。');
    } finally {
      cleanup();
      await service.shutdown(); db.close();
    }
  });

  it('words the confirmation for a paused Run without claiming a request is in flight', async () => {
    const db = new Database(':memory:'); db.initialize();
    const provider = new ScriptedProvider();
    const service = new RunService(db, provider, createPublicMessagesBuilder());
    window.roundtable = appApiFor(service, db);
    service.createDemoRoom('暂停后停止');
    provider.hold.add(0);
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
      await act(async () => { await provider.started(0); });
      fireEvent.click(screen.getByRole('button', { name: '暂停' }));
      await act(async () => { provider.release(0); });
      await waitFor(() => expect(status()).toContain('已暂停'));
      fireEvent.click(screen.getByRole('button', { name: '停止' }));
      const confirm = screen.getByRole('group', { name: '确认停止运行' });
      expect(confirm.textContent).toContain('后续回合不再执行');
      expect(confirm.textContent).not.toContain('计费');
    } finally {
      cleanup();
      await service.shutdown(); db.close();
    }
  });
});
