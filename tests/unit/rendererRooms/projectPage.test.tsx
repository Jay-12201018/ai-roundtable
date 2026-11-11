import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomPage } from '../../../src/renderer/features/rooms';
import { PROJECT_BRIEF_MAX_CHARS } from '../../../src/shared/schemas/configuration';
import type { RoomConfiguration } from '../../../src/shared/contracts/configuration';
import { agent, props as roomProps, providers, room } from './fixtures';

afterEach(cleanup);
function show(value: Partial<RoomConfiguration> = {}, extra: Partial<Parameters<typeof RoomPage>[0]> = {}) {
  const api = roomProps().api;
  const on = { onNewDiscussion: vi.fn(), onOpenRun: vi.fn(), onOpenSettings: vi.fn(), onChanged: vi.fn(), onDeleted: vi.fn(), onPick: vi.fn(), onCustomize: vi.fn() };
  const view = render(<RoomPage api={api} room={{ ...room('r1', '跑腿项目'), ...value }} providers={providers} readiness={undefined} runs={[]}
    mode={{ value: 'group-chat', detail: '像同事群聊。', onPick: on.onPick, onCustomize: on.onCustomize }} {...on} {...extra} />);
  return { api, view, ...on };
}
const section = (name: string) => screen.getByRole('heading', { name: new RegExp(`^${name}`, 'u') }).closest('section')!;

describe('项目页 › 项目说明 (D168)', () => {
  it('says what it is for and what it costs before anything is written', async () => {
    show();
    const brief = section('项目说明');
    expect(brief.textContent).toContain('每位成员每次发言前都会读到这段话，当作背景材料，不是给成员下的指令');
    expect(brief.textContent).toContain('它会算进每次发言的输入用量');
    expect(brief.textContent).toContain('还没有写。不写也能讨论');
    expect(within(brief).queryByRole('textbox')).toBeNull();
  });

  it('is saved only when the host says so, and says that discussions under way get it too', async () => {
    const { api, onChanged } = show();
    fireEvent.click(within(section('项目说明')).getByRole('button', { name: '写项目说明' }));
    const box = within(section('项目说明')).getByRole('textbox');
    expect((within(section('项目说明')).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: '  我们在做校园跑腿平台。\n试点两所学校。  ' } });
    expect(section('项目说明').textContent).toContain(`${'  我们在做校园跑腿平台。\n试点两所学校。  '.length} / ${PROJECT_BRIEF_MAX_CHARS} 字`);
    expect(api.updateRoom).not.toHaveBeenCalled();
    fireEvent.click(within(section('项目说明')).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.updateRoom).toHaveBeenCalledWith({ id: 'r1', name: '跑腿项目', objective: '检验证据', brief: '我们在做校园跑腿平台。\n试点两所学校。' }));
    await screen.findByText('已保存项目说明。之后每次发言都会带上它，正在进行的讨论也一样。');
    expect(onChanged).toHaveBeenCalled();
  });

  it('shows a saved brief as it was written, and cancelling an edit changes nothing', async () => {
    const { api } = show({ brief: '第一行\n第二行' });
    expect(section('项目说明').querySelector('.brief-text')!.textContent).toBe('第一行\n第二行');
    fireEvent.click(within(section('项目说明')).getByRole('button', { name: '修改' }));
    fireEvent.change(within(section('项目说明')).getByRole('textbox'), { target: { value: '改了' } });
    fireEvent.click(within(section('项目说明')).getByRole('button', { name: '取消' }));
    expect(section('项目说明').querySelector('.brief-text')!.textContent).toBe('第一行\n第二行');
    expect(api.updateRoom).not.toHaveBeenCalled();
  });

  it('refuses a brief over the limit in words, without sending it', async () => {
    const { api } = show();
    fireEvent.click(within(section('项目说明')).getByRole('button', { name: '写项目说明' }));
    fireEvent.change(within(section('项目说明')).getByRole('textbox'), { target: { value: '长'.repeat(PROJECT_BRIEF_MAX_CHARS + 1) } });
    expect(within(section('项目说明')).getByRole('alert').textContent).toContain('超出了上限，请删减');
    expect((within(section('项目说明')).getByRole('button', { name: '保存' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(section('项目说明').querySelector('form')!);
    expect(api.updateRoom).not.toHaveBeenCalled();
  });

  it('an archived project shows its brief but offers no change', () => {
    show({ brief: '背景', archivedAt: '2026-11-11T00:00:00.000Z' });
    expect(within(section('项目说明')).queryByRole('button')).toBeNull();
  });
});

describe('项目页 › 默认讨论方式 (D169)', () => {
  it('offers the group chat and the four stricter flows, and hands the choice on', () => {
    const { onPick, onCustomize } = show();
    const mode = section('默认讨论方式');
    expect(mode.textContent).toContain('这个项目里的新讨论默认用它');
    expect(within(mode).getAllByRole('button').map(button => [button.textContent, button.getAttribute('aria-pressed')])).toEqual([['群聊', 'true'], ['自由讨论', 'false'], ['双人对话', 'false'], ['审查修订链', 'false'], ['深度辩论', 'false']]);
    fireEvent.click(within(mode).getByRole('button', { name: '审查修订链' }));
    expect(onPick).toHaveBeenCalledWith('review-revision');
    // The group chat has no flow to fine-tune.
    expect(within(mode).queryByRole('button', { name: '自定义流程' })).toBeNull();
    cleanup();
    const again = show({}, { mode: { value: 'deep-debate', detail: '立论 → 交锋 → 总结', onPick, onCustomize } });
    fireEvent.click(within(section('默认讨论方式')).getByRole('button', { name: '自定义流程' }));
    expect(again.onCustomize).not.toHaveBeenCalled(); expect(onCustomize).toHaveBeenCalledTimes(1);
  });
});

describe('常用阵容 in 设置 is the same member list with nothing else around it (D167)', () => {
  it('shows only the members, and a member without a model is not a fault there', async () => {
    const api = roomProps().api;
    vi.mocked(api.listAgentConfigurations).mockResolvedValue([{ ...agent('m1', '林舟'), providerId: null, modelId: null }, agent('m2', '阿哲')]);
    render(<RoomPage variant="lineup" api={api} room={{ ...room('roundtable-lineup', '常用阵容'), kind: 'lineup' }} providers={providers} readiness={undefined} runs={[]}
      unsetModelText="没有指定模型 · 新讨论时用默认模型（DeepSeek Flash）" onNewDiscussion={vi.fn()} onOpenRun={vi.fn()} onOpenSettings={vi.fn()} onChanged={vi.fn()} onDeleted={vi.fn()} />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('常用阵容');
    expect(document.body.textContent).toContain('换了只影响那一场；项目有自己的成员，不用这套阵容');
    const row = (await screen.findByRole('switch', { name: '林舟 参与讨论' })).closest('li')!;
    expect(row.textContent).toContain('没有指定模型 · 新讨论时用默认模型（DeepSeek Flash）');
    expect(row.querySelector('.warn-text')).toBeNull();
    expect(within(row).queryByRole('button', { name: '去选择' })).toBeNull();
    for (const name of ['项目说明', '默认讨论方式', '讨论', '归档或删除']) expect(screen.queryByRole('heading', { name })).toBeNull();
    expect(screen.queryByRole('button', { name: '新讨论' })).toBeNull();
    expect(screen.getByRole('button', { name: '添加成员' })).toBeTruthy();
  });
});
