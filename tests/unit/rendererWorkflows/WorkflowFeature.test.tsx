import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkflowFeature, createWorkflowDraft, type WorkflowPreviewResult } from '../../../src/renderer/features/workflows';
import { deferred, members, preview, props } from './fixtures';

afterEach(cleanup);

async function requestPreview() {
  fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
  await screen.findByRole('heading', { name: '已验证的计划预览' });
}

describe('R11 standalone workflow configuration', () => {
  it('builds the four distinct editable templates with finite defaults and independent drafts', () => {
    const free = createWorkflowDraft('free-chat', members);
    expect(free.phases).toEqual([{ key: 'discussion', title: '讨论', participants: ['a', 'b', 'c'], repeat: '1' }]);
    expect(createWorkflowDraft('two-model-dialogue', members).phases).toEqual([{ key: 'dialogue', title: '对话', participants: ['a', 'b'], repeat: '1' }]);
    const review = createWorkflowDraft('review-revision', members);
    expect(review.phases.map(stage => [stage.key, stage.participants, stage.repeat])).toEqual([
      ['draft', ['a'], '1'], ['review', ['b'], '1'], ['revise', ['a'], '1'], ['rereview', ['b'], '1'], ['finalize', ['a'], '1'],
    ]);
    expect(createWorkflowDraft('deep-debate', members).phases.map(stage => [stage.key, stage.repeat])).toEqual([['opening', '1'], ['rebuttal', '2'], ['closing', '1']]);
    free.phases[0].participants.reverse();
    expect(createWorkflowDraft('free-chat', members).phases[0].participants).toEqual(['a', 'b', 'c']);
    expect(createWorkflowDraft('two-model-dialogue', []).phases[0].participants).toEqual(['', '']);
  });

  it('edits phase participants in order, rounds, limits and the explicit end condition', async () => {
    const p = props(); render(<WorkflowFeature {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '下移 讨论 成员 1' }));
    fireEvent.change(screen.getByLabelText('讨论 重复次数'), { target: { value: '2' } });
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('累计时长上限（毫秒）'), { target: { value: '40000' } });
    fireEvent.change(screen.getByLabelText('单次输出上限（Token）'), { target: { value: '128' } });
    fireEvent.change(screen.getByLabelText('结束条件'), { target: { value: 'discussion' } });
    await requestPreview();
    expect(p.onPreview).toHaveBeenLastCalledWith({
      template: 'free-chat', phases: [{ key: 'discussion', title: '讨论', participants: ['b', 'a', 'c'], repeat: '2' }],
      turnLimit: '7', durationMs: '40000', outputTokens: '128', finishAt: 'discussion',
    });
    expect(screen.getByText('预计 3 回合')).toBeTruthy();
    expect(screen.getByText(preview.limits)).toBeTruthy();
  });

  it('switches templates, fixes the review chain to one member/once and allows member reuse', async () => {
    const p = props(); render(<WorkflowFeature {...p} />);
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'review-revision' } });
    expect(screen.getAllByRole('group', { name: /阶段 / })).toHaveLength(5);
    expect((screen.getByLabelText('起草 重复次数') as HTMLInputElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('审查 成员 1'), { target: { value: 'a' } });
    await requestPreview();
    const draft = vi.mocked(p.onPreview!).mock.calls[0][0];
    expect(draft.phases.map(stage => stage.participants)).toEqual([['a'], ['a'], ['a'], ['b'], ['a']]);
  });

  it('offers ordered participant addition/removal for debate and exactly two slots for dialogue', () => {
    render(<WorkflowFeature {...props()} />);
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'deep-debate' } });
    fireEvent.click(screen.getByRole('button', { name: '移除 交锋 成员 2' }));
    expect((screen.getByLabelText('交锋 成员 2') as HTMLSelectElement).value).toBe('c');
    fireEvent.click(screen.getByRole('button', { name: '添加 交锋 成员' }));
    expect((screen.getByLabelText('交锋 成员 3') as HTMLSelectElement).value).toBe('b');
    fireEvent.change(screen.getByLabelText('工作流模板'), { target: { value: 'two-model-dialogue' } });
    expect(screen.getAllByLabelText(/对话 成员/)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: '添加 对话 成员' })).toBeNull();
  });

  it('requires parent actions and an authoritative preview before applying', () => {
    const p = props(); render(<WorkflowFeature {...p} onPreview={undefined} onApply={undefined} />);
    expect((screen.getByRole('button', { name: '验证并预览' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('工作流验证尚未接入，当前只能编辑草稿。')).toBeTruthy();
    expect(screen.getByText('配置应用尚未接入。')).toBeTruthy();
    expect(screen.queryByText('已保存')).toBeNull();
  });

  it('discards the preview on every edit and requires validation again before apply', async () => {
    const p = props(); render(<WorkflowFeature {...p} />); await requestPreview();
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '9' } });
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    expect(p.onApply).not.toHaveBeenCalled();
    await requestPreview(); fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    await screen.findByText('应用请求已提交，等待主界面确认。');
    expect(p.onApply).toHaveBeenCalledWith(expect.objectContaining({ previewId: 'authority-preview-1', draft: expect.objectContaining({ turnLimit: '9' }) }));
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('ignores late preview replies after editing or switching the configuration scope', async () => {
    const old = deferred<WorkflowPreviewResult>(); const p = props();
    vi.mocked(p.onPreview!).mockReturnValue(old.promise);
    const view = render(<WorkflowFeature {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '8' } });
    await act(async () => old.resolve({ ok: true, preview }));
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
    const other = deferred<WorkflowPreviewResult>(); vi.mocked(p.onPreview!).mockReturnValue(other.promise);
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    view.rerender(<WorkflowFeature {...p} scopeKey="room-2:revision-1" />);
    await act(async () => other.resolve({ ok: true, preview }));
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
    expect((screen.getByLabelText('最大回合数') as HTMLInputElement).value).toBe('12');
  });

  it('invalidates a pending preview when membership changes and shows unavailable selected members', async () => {
    const old = deferred<WorkflowPreviewResult>(); const p = props(); vi.mocked(p.onPreview!).mockReturnValue(old.promise);
    const view = render(<WorkflowFeature {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    view.rerender(<WorkflowFeature {...p} members={members.filter(member => member.id !== 'b')} />);
    await act(async () => old.resolve({ ok: true, preview }));
    expect(screen.getByText('成员不可用（b）')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('prevents duplicate preview/apply requests and never changes confirmed run progress on click', async () => {
    const p = props(); const pendingPreview = deferred<WorkflowPreviewResult>(); const pendingApply = deferred<void>();
    vi.mocked(p.onPreview!).mockReturnValue(pendingPreview.promise); vi.mocked(p.onApply!).mockReturnValue(pendingApply.promise);
    render(<WorkflowFeature {...p} />);
    const validate = screen.getByRole('button', { name: '验证并预览' });
    fireEvent.click(validate); fireEvent.click(validate); expect(p.onPreview).toHaveBeenCalledTimes(1);
    await act(async () => pendingPreview.resolve({ ok: true, preview }));
    const apply = screen.getByRole('button', { name: '应用配置' });
    fireEvent.click(apply); fireEvent.click(apply); expect(p.onApply).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('最大回合数').matches(':disabled')).toBe(true);
    expect(within(screen.getByRole('region', { name: '运行进度' })).getByText('已暂停')).toBeTruthy();
    await act(async () => pendingApply.resolve());
    expect(screen.queryByText('运行中')).toBeNull();
  });

  it('shows parent validation issues and safe generic failures without leaking exception text', async () => {
    const p = props(); vi.mocked(p.onPreview!).mockResolvedValueOnce({ ok: false, errors: ['所选成员已停用。', '回合上限小于计划。'] });
    render(<WorkflowFeature {...p} />); fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    expect(await screen.findByText('所选成员已停用。')).toBeTruthy();
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
    vi.mocked(p.onPreview!).mockRejectedValueOnce(new Error('/private/secret-Key.db'));
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    expect(await screen.findByText('验证失败，请检查配置后重试。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('/private/secret');
  });

  it('reports apply failure without claiming persistence and keeps the preview consumed', async () => {
    const p = props(); vi.mocked(p.onApply!).mockRejectedValueOnce(new Error('sensitive failure'));
    render(<WorkflowFeature {...p} />); await requestPreview();
    fireEvent.click(screen.getByRole('button', { name: '应用配置' }));
    expect(await screen.findByText('应用结果未确认，请先核对主界面配置；重新应用前需再次验证。')).toBeTruthy();
    expect(document.body.textContent).not.toContain('sensitive failure');
    expect((screen.getByRole('button', { name: '应用配置' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText('已保存')).toBeNull();
  });

  it('projects supplied progress changes and preserves historical stage/member text as escaped text', async () => {
    const p = props(); const view = render(<WorkflowFeature {...p} theme="dark" />);
    const region = screen.getByRole('region', { name: '运行进度' });
    expect(within(region).getByText('1 / 3 回合')).toBeTruthy();
    expect(within(region).getByText('累计用时 1200 毫秒')).toBeTruthy();
    view.rerender(<WorkflowFeature {...p} theme="light" progress={{ ...p.progress!, status: '已停止', currentStage: '<script>历史阶段</script>', limitReason: '累计时长到限' }} />);
    expect(within(region).getByText('已停止')).toBeTruthy(); expect(within(region).getByText('累计时长到限')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('.workflows-feature')?.getAttribute('data-theme')).toBe('light');
    view.rerender(<WorkflowFeature {...p} progress={null} />);
    expect(screen.getByText('当前没有可显示的运行进度。')).toBeTruthy();
  });

  it('does not submit incomplete numeric input or missing members and exposes accessible form controls', async () => {
    const p = props(); render(<WorkflowFeature {...p} />);
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    expect(p.onPreview).not.toHaveBeenCalled();
    expect(screen.getByText('请补全成员和正整数限制后再验证。')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('最大回合数'), { target: { value: '12' } });
    fireEvent.change(screen.getByLabelText('讨论 成员 1'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '验证并预览' }));
    expect(p.onPreview).not.toHaveBeenCalled();
    const stopped = within(screen.getByLabelText('讨论 成员 1')).getByRole('option', { name: '停用成员（已停用）' });
    expect((stopped as HTMLOptionElement).disabled).toBe(true);
    await waitFor(() => expect(screen.getByRole('heading', { name: '工作流配置' })).toBeTruthy());
  });

  it('adds, reorders and removes chat stages while invalidating the old terminal selection', async () => {
    const p = props(); render(<WorkflowFeature {...p} />);
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    fireEvent.change(screen.getByLabelText('结束条件'), { target: { value: 'discussion-2' } });
    const second = screen.getByRole('group', { name: '阶段 2 讨论 2' });
    fireEvent.click(within(second).getByRole('button', { name: '上移阶段' }));
    await requestPreview();
    expect(vi.mocked(p.onPreview!).mock.calls[0][0].phases.map(phase => phase.key)).toEqual(['discussion-2', 'discussion']);
    fireEvent.click(within(screen.getByRole('group', { name: '阶段 1 讨论 2' })).getByRole('button', { name: '移除阶段' }));
    expect((screen.getByLabelText('结束条件') as HTMLSelectElement).value).toBe('');
    expect(screen.queryByRole('heading', { name: '已验证的计划预览' })).toBeNull();
  });

  it('keeps stage labels distinct after deleting a middle stage and adding again', () => {
    render(<WorkflowFeature {...props()} />);
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    fireEvent.click(within(screen.getByRole('group', { name: '阶段 2 讨论 2' })).getByRole('button', { name: '移除阶段' }));
    fireEvent.click(screen.getByRole('button', { name: '添加阶段' }));
    expect(screen.getByRole('group', { name: '阶段 3 讨论 4' })).toBeTruthy();
    expect(screen.getAllByLabelText('讨论 3 成员 1')).toHaveLength(1);
  });
});
