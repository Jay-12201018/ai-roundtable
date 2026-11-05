import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { appApiFor } from '../joint/fixtures';
import { publicHistory, ScriptedProvider } from './fixtures';

afterEach(() => { cleanup(); localStorage.clear(); });

describe('R12 App with the real Main services', () => {
  it('queues a trusted Override from the UI, then edits and regenerates versions with visible affected marks', async () => {
    const db = new Database(':memory:'); db.initialize();
    const provider = new ScriptedProvider();
    const service = new RunService(db, provider, createPublicMessagesBuilder());
    window.roundtable = appApiFor(service, db);
    localStorage.setItem(`roundtable.mode.${service.createDemoRoom('主持人联合测试')}`, 'free-chat');
    provider.hold.add(0);
    provider.answers.set(0, '开场观点 @Override 审查者');
    provider.answers.set(1, '综合者被点名发言');
    provider.answers.set(2, '审查者按计划发言');
    provider.answers.set(3, '综合者按计划综合');
    try {
      render(<App />);
      await waitFor(() => expect((screen.getByRole('button', { name: '开始讨论' }) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button', { name: '开始讨论' }));
      await screen.findByText('开场观点 @Override 审查者');
      // D4: in the interjection box, @ names the next speaker; sending it only names (no words follow).
      const box = screen.getByLabelText('主持人插话') as HTMLTextAreaElement;
      fireEvent.change(box, { target: { value: '@综', selectionStart: 2 } });
      fireEvent.click(await screen.findByRole('option', { name: /综合者/ }));
      expect(box.value).toBe('@综合者 ');
      fireEvent.keyDown(box, { key: 'Enter' });
      await screen.findByText(/已点名综合者，将在下一回合发言/);
      // D110: the named member is inserted; the plan's next speaker is not replaced.
      expect(screen.getByRole('status', { name: '下一位' }).textContent).toContain('下一位：综合者（主持人点名，插入一轮');
      expect(screen.getByRole('status', { name: '下一位' }).textContent).toContain('之后回到原计划：审查者');
      await act(async () => { provider.release(0); });
      await screen.findByText('综合者按计划综合');
      await waitFor(() => expect(screen.getByRole('status', { name: '运行状态' }).textContent).toContain('已完成'));
      const runId = db.getAttempt(provider.inputs[0].requestId)!.runId;
      expect(service.getSnapshot(runId).turns.map(turn => turn.agentId.split('-agent-')[1])).toEqual(['drafter', 'synthesizer', 'critic', 'synthesizer']);
      expect(screen.getByText('主持人点名')).toBeTruthy();

      // Edit the first message: a new version becomes effective and all three later answers are marked affected.
      fireEvent.click(screen.getAllByRole('button', { name: '修改' })[0]);
      fireEvent.change(screen.getByLabelText('修改消息内容'), { target: { value: '主持人修订后的开场' } });
      fireEvent.click(screen.getByRole('button', { name: '保存为新版本' }));
      await screen.findByText('主持人修订后的开场');
      await waitFor(() => expect(screen.getAllByRole('note').filter(note => note.textContent!.includes('受影响'))).toHaveLength(3));
      expect(screen.getByText('版本 2/2')).toBeTruthy();

      // Regenerate the last answer from the revised history: a version job in the completed Run.
      provider.answers.set(4, '依据修订重新生成');
      const regenerate = screen.getAllByRole('button', { name: '重新生成' });
      fireEvent.click(regenerate[regenerate.length - 1]);
      await screen.findByText('依据修订重新生成');
      // Still affected, transitively: its new basis includes the earlier answers, themselves based on the replaced opening.
      await waitFor(() => expect(screen.getAllByRole('button', { name: '查看上一个版本' })).toHaveLength(2));
      expect(screen.getAllByRole('note').filter(note => note.textContent!.includes('受影响'))).toHaveLength(3);
      expect(service.getSnapshot(runId).status).toBe('completed');
      const history = publicHistory(provider.inputs[4]).map(item => item.publicText);
      expect(history).toEqual(['主持人修订后的开场', '综合者被点名发言', '审查者按计划发言']);
      expect(provider.inputs).toHaveLength(5);
    } finally {
      cleanup();
      await service.shutdown(); db.close();
    }
  });
});
