import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NewDiscussionSetup, memberBlocked, type NewDiscussionSetupProps } from '../../../src/renderer/features/rooms';
import { createWorkflowDraft, draftProblems, nextDraft, participantsFor, speakersOf, type WorkflowDraft } from '../../../src/renderer/features/workflows/model';
import { readRoomCount } from '../../../src/renderer/features/workflows/storage';
import type { AgentConfiguration, CreateAgentInput, ProviderReadiness, ProviderSummary } from '../../../src/shared/contracts/configuration';
import { publicError } from '../../../src/shared/schemas/error';

afterEach(() => { cleanup(); localStorage.clear(); });
const at = '2026-11-04T00:00:00.000Z';
const service = (id: string, name: string, models: string[]): ProviderSummary => ({ id, name, kind: 'compatible', enabled: true, isDefault: id === 'ds', defaultModelId: models[0]!, customModels: models.map(model => ({ id: model, name: model })), configurationValid: true, hasStoredKey: true } as ProviderSummary);
const ds = service('ds', 'DeepSeek', ['deepseek-flash', 'deepseek-v4-pro']);
const km = service('km', 'Kimi', ['kimi-k3', 'kimi-k9']);
const row = (providerId: string, baseUrl: string, models: string[], extra: Partial<ProviderReadiness> = {}): ProviderReadiness => ({ providerId, keyState: 'configured', supported: true, baseUrl,
  models: models.map(modelId => ({ modelId, contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null })), ...extra });
const readiness = [row('ds', 'https://api.deepseek.com', ['deepseek-flash', 'deepseek-v4-pro']), row('km', 'https://api.moonshot.cn/v1', ['kimi-k3', 'kimi-k9'])];
const member = (id: string, displayName: string, role: string, order: number, extra: Partial<AgentConfiguration> = {}): AgentConfiguration => ({ id, roomId: 'r', displayName, roleTemplateId: role, systemPrompt: `${role}设定`, providerId: 'ds', modelId: 'deepseek-flash', enabled: true, displayOrder: order, archivedAt: null, createdAt: at, updatedAt: at, ...extra } as AgentConfiguration);
const starters = () => [member('a', '起草者', '起草', 0), member('b', '审查者', '审查', 1), member('c', '综合者', '综合', 2)];

/** The page with a room that really changes: what is written is what the next read returns. */
function Room({ initial, initialDraft, fail, spy, providers, rows, onDraft }: { initial: AgentConfiguration[]; initialDraft?: WorkflowDraft; fail?: () => boolean; spy: { update: (input: unknown) => void; create: (input: unknown) => void }; providers?: ProviderSummary[]; rows?: ProviderReadiness[]; onDraft?: NewDiscussionSetupProps['onDraft'] }) {
  const [members, setMembers] = useState(initial); const [draft, setDraft] = useState(initialDraft);
  const store = { current: members };
  const api: NewDiscussionSetupProps['api'] = {
    updateAgent: async input => { spy.update(input); if (fail?.()) throw publicError('invalid_state'); store.current = store.current.map(item => item.id === input.id ? { ...item, ...input } as AgentConfiguration : item); setMembers(store.current); return store.current.find(item => item.id === input.id)!; },
    createAgent: async (input: CreateAgentInput) => { spy.create(input); const made = { ...input, id: `new-${store.current.length}`, archivedAt: null, createdAt: at, updatedAt: at } as AgentConfiguration; store.current = [...store.current, made]; setMembers(store.current); return made; },
  };
  return <NewDiscussionSetup api={api} roomId="r" members={members} draft={draft} providers={providers ?? [ds, km]} readiness={rows ?? readiness} reload={async () => store.current}
    onDraft={value => { setDraft(value ?? undefined); onDraft?.(value); return true; }} onOpenSettings={vi.fn()} onConnectMore={vi.fn()} onCustomFlow={vi.fn()} />;
}
function show(props: Partial<Parameters<typeof Room>[0]> = {}) {
  const spy = { update: vi.fn(), create: vi.fn() };
  render(<Room initial={starters()} spy={spy} {...props} />);
  return spy;
}
const rowsShown = () => [...document.querySelectorAll('.setup-row b')].map(item => item.textContent);
const plus = () => screen.getByRole('button', { name: '增加一位成员' });
const minus = () => screen.getByRole('button', { name: '减少一位成员' });
const mode = (name: string) => screen.getByRole('button', { name });

describe('新讨论 › 三步', () => {
  it('opens on free discussion with three, one row each, and no switch to take anyone out', () => {
    show();
    expect(mode('自由讨论').getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.stepper-value')?.textContent).toBe('3');
    expect(rowsShown()).toEqual(['起草者', '审查者', '综合者']);
    expect(screen.queryByRole('switch')).toBeNull();
    expect(screen.getByRole('button', { name: '编辑「审查者」' })).toBeTruthy();
    expect(document.body.textContent).toContain('每位成员可以用不同的模型。改动对这场和之后的讨论生效，已有讨论不变。');
  });
  it('fewer members steps the last out and keeps its settings; coming back restores them', async () => {
    const spy = show({ initial: [...starters().slice(0, 2), member('c', '综合者', '综合', 2, { modelId: 'deepseek-v4-pro', systemPrompt: '我的设定' })] });
    fireEvent.click(minus());
    await waitFor(() => expect(rowsShown()).toEqual(['起草者', '审查者']));
    expect(spy.update).toHaveBeenCalledTimes(1);
    expect(spy.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'c', enabled: false, modelId: 'deepseek-v4-pro', systemPrompt: '我的设定' }));
    expect(minus().hasAttribute('disabled')).toBe(true);
    fireEvent.click(plus());
    await waitFor(() => expect(rowsShown()).toEqual(['起草者', '审查者', '综合者']));
    expect(spy.update).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c', enabled: true, modelId: 'deepseek-v4-pro', systemPrompt: '我的设定' }));
    expect(spy.create).not.toHaveBeenCalled();
  });
  it('more members than the room has are made from the role templates, on the default model, then with plain names', async () => {
    const spy = show();
    for (let count = 4; count <= 8; count++) {
      fireEvent.click(plus());
      await waitFor(() => expect(document.querySelector('.stepper-value')?.textContent).toBe(String(count)));
    }
    expect(rowsShown()).toEqual(['起草者', '审查者', '综合者', '反方', '核查员', '成员 6', '成员 7', '成员 8']);
    expect(spy.create).toHaveBeenCalledTimes(5);
    expect(spy.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ displayName: '反方', roleTemplateId: '反方', providerId: 'ds', modelId: 'deepseek-flash', displayOrder: 3 }));
    expect(plus().hasAttribute('disabled')).toBe(true);
  });
  it.each([['双人对话', ['起草者', '审查者']], ['审查修订链', ['起草者', '审查者']]])('%s is two: only they show, and the flow has no problems', async (name, shown) => {
    const onDraft = vi.fn();
    const spy = show({ onDraft });
    fireEvent.click(mode(name));
    await waitFor(() => expect(rowsShown()).toEqual(shown));
    expect(document.body.textContent).toContain('固定 2 人');
    expect(screen.queryByRole('button', { name: '增加一位成员' })).toBeNull();
    expect(spy.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'c', enabled: false }));
    const draft = onDraft.mock.calls.at(-1)![0] as WorkflowDraft;
    const members = starters().map(item => ({ id: item.id, name: item.displayName, role: item.roleTemplateId, enabled: item.id !== 'c' }));
    expect(draftProblems(draft, members)).toEqual([]);
  });
  it('the review chain takes members by their roles, shows who really speaks, and says who does what', async () => {
    show({ initial: [member('x', '老周', '反方', 0), member('r', '小审', '审查', 1), member('d', '小起', '起草', 2)] });
    fireEvent.click(mode('审查修订链'));
    await waitFor(() => expect(rowsShown()).toEqual(['小起', '小审']));
    expect(document.body.textContent).toContain('小起写、小审挑错');
  });
  it('coming back from a mode of two restores the number it had', async () => {
    show();
    fireEvent.click(plus());
    await waitFor(() => expect(rowsShown()).toHaveLength(4));
    fireEvent.click(mode('双人对话'));
    await waitFor(() => expect(rowsShown()).toHaveLength(2));
    expect(readRoomCount('r')).toBe(4);
    fireEvent.click(mode('自由讨论'));
    await waitFor(() => expect(rowsShown()).toHaveLength(4));
  });
  it('a default deep debate of eight still fits its own limits', () => {
    const members = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, name: `m${index}`, enabled: true }));
    const draft = createWorkflowDraft('deep-debate', members);
    expect(Number(draft.turnLimit)).toBeGreaterThanOrEqual(32);
    expect(draftProblems(draft, members)).toEqual([]);
  });
  it('changes one member\'s model alone, and goes back when saving fails', async () => {
    let failing = false;
    const spy = show({ fail: () => failing });
    const list = screen.getByLabelText('审查者 的模型') as HTMLSelectElement;
    expect([...list.querySelectorAll('optgroup')].map(group => group.label)).toEqual(['DeepSeek', 'Kimi']);
    fireEvent.change(list, { target: { value: 'km\u0000kimi-k3' } });
    await waitFor(() => expect(spy.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', providerId: 'km', modelId: 'kimi-k3', enabled: true })));
    await waitFor(() => expect(list.disabled).toBe(false));
    expect(list.value).toBe('km\u0000kimi-k3');
    failing = true;
    fireEvent.change(list, { target: { value: 'ds\u0000deepseek-v4-pro' } });
    expect((await screen.findByRole('alert')).textContent).toContain('没有保存，还是原来的选择。');
    expect(list.value).toBe('km\u0000kimi-k3');
  });
  it('when a change of number fails it says so and shows what is true now', async () => {
    show({ fail: () => true });
    fireEvent.click(minus());
    expect((await screen.findByRole('alert')).textContent).toContain('没有全部改好');
    expect(rowsShown()).toHaveLength(3);
  });
  it.each([
    ['no model', member('a', '起草者', '起草', 0, { providerId: null, modelId: null }), readiness, '还没选模型'],
    ['no Key', member('a', '起草者', '起草', 0), [row('ds', 'https://api.deepseek.com', [], { keyState: 'missing', models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: false, blockedBy: 'key' }] })], '还没填写 Key'],
    ['a model out of the catalog', member('a', '起草者', '起草', 0, { modelId: 'gone-model' }), readiness, '这个模型已不再支持'],
  ] as const)('says why on the row for %s, keeps the list there, and counts as in the way', (_name, agent, rows, words) => {
    show({ initial: [agent, member('b', '审查者', '审查', 1)], rows: [...rows] });
    const line = screen.getByLabelText('起草者 的模型').closest('li')!;
    expect(line.textContent).toContain(words);
    expect((within(line).getByLabelText('起草者 的模型') as HTMLSelectElement).disabled).toBe(false);
    expect(memberBlocked(agent, [ds, km], [...rows])).toBe(true);
  });
  it('a member the demo runs for is not asked for a model, and does not stand in the way', () => {
    const agent = member('a', '起草者', '起草', 0, { providerId: null, modelId: null, builtInDemo: true } as Partial<AgentConfiguration>);
    show({ initial: [agent] });
    const list = screen.getByLabelText('起草者 的模型') as HTMLSelectElement;
    expect(list.selectedOptions[0]!.textContent).toBe('内置演示（不联网）');
    expect(list.closest('li')!.textContent).not.toContain('还没选模型');
    expect(memberBlocked(agent, [ds], readiness)).toBe(false);
  });
  it('a model the service no longer lists says so without standing in the way', () => {
    const rows = [row('ds', 'https://api.deepseek.com', [], { models: [{ modelId: 'deepseek-flash', contextWindowTokens: 128000, maxOutputTokens: 8192, usable: true, blockedBy: null, delisted: true }] })];
    show({ rows });
    expect(screen.getByLabelText('起草者 的模型').closest('li')!.textContent).toContain('可能已下线');
    expect(memberBlocked(starters()[0]!, [ds], rows)).toBe(false);
  });
  it('a model the service\'s list added shows just its ID, after the built-in ones', () => {
    show({ initial: [member('a', '起草者', '起草', 0, { providerId: 'km', modelId: 'kimi-k3' })] });
    const labels = [...(screen.getByLabelText('起草者 的模型') as HTMLSelectElement).options].map(option => option.textContent);
    expect(labels.at(-2)).toContain('多模态');
    expect(labels.at(-1)).toBe('kimi-k9');
  });
  it('offers more services only while there is one', () => {
    show({ providers: [ds] });
    expect(screen.getByRole('button', { name: '连接更多模型服务' })).toBeTruthy();
    cleanup();
    show();
    expect(screen.queryByRole('button', { name: '连接更多模型服务' })).toBeNull();
  });
});

describe('the flow that goes with the members', () => {
  const plain = (ids: string[], off: string[] = []) => [...ids, ...off].map(id => ({ id, name: id, role: id, enabled: ids.includes(id) }));
  it('a default flow is simply made again', () => {
    const before = plain(['a', 'b', 'c']); const after = plain(['a', 'b', 'c', 'd']);
    const { draft, notice } = nextDraft({ template: 'deep-debate', previous: createWorkflowDraft('deep-debate', before), previousMembers: before, members: after });
    expect(draft!.phases[0]!.participants).toEqual(['a', 'b', 'c', 'd']);
    expect(notice).toBeUndefined();
  });
  it('free discussion needs no flow of its own', () => {
    const members = plain(['a', 'b']);
    expect(nextDraft({ template: 'free-chat', previous: createWorkflowDraft('two-model-dialogue', members), previousMembers: members, members }).draft).toBeNull();
  });
  it('an adjusted flow keeps its limits and takes the new member where everyone speaks', () => {
    const before = plain(['a', 'b', 'c']); const after = plain(['a', 'b', 'c', 'd']);
    const adjusted = { ...createWorkflowDraft('deep-debate', before), turnLimit: '40', durationMinutes: '30' };
    const { draft, notice } = nextDraft({ template: 'deep-debate', previous: adjusted, previousMembers: before, members: after });
    expect(draft).toMatchObject({ turnLimit: '40', durationMinutes: '30' });
    expect(draft!.phases.every(phase => phase.participants.includes('d'))).toBe(true);
    expect(notice).toBeUndefined();
    expect(draftProblems(draft!, after)).toEqual([]);
  });
  it('one member leaving an adjusted flow just leaves it', () => {
    const before = plain(['a', 'b', 'c']); const after = plain(['a', 'b'], ['c']);
    const adjusted = { ...createWorkflowDraft('free-chat', before), turnLimit: '40' };
    const { draft } = nextDraft({ template: 'free-chat', previous: adjusted, previousMembers: before, members: after });
    expect(draft!.phases[0]!.participants).toEqual(['a', 'b']);
    expect(draft!.turnLimit).toBe('40');
  });
  it('an adjusted flow that cannot hold the new members starts over and says so', () => {
    const before = plain(['a', 'b']); const after = plain(['a', 'b', 'c']);
    const adjusted = { ...createWorkflowDraft('two-model-dialogue', before), turnLimit: '40' };
    const { draft, notice } = nextDraft({ template: 'two-model-dialogue', previous: adjusted, previousMembers: before, members: after });
    expect(notice).toContain('已换回默认流程');
    expect(draftProblems(draft!, after)).toEqual([]);
  });
  it('another mode cannot keep an adjusted flow, and says so', () => {
    const members = plain(['a', 'b']);
    const adjusted = { ...createWorkflowDraft('deep-debate', members), turnLimit: '40' };
    expect(nextDraft({ template: 'two-model-dialogue', previous: adjusted, previousMembers: members, members }).notice).toContain('已换成它的默认流程');
  });
  it('every mode with every number of members has a flow with no problems', () => {
    for (const template of ['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate'] as const) for (let count = 2; count <= 8; count++) {
      const all = Array.from({ length: 8 }, (_, index) => ({ id: `m${index}`, name: `m${index}`, role: index === 1 ? '审查' : index === 0 ? '起草' : '综合', enabled: false }));
      const taking = new Set(participantsFor(template, all, count));
      const members = all.map(item => ({ ...item, enabled: taking.has(item.id) }));
      const draft = createWorkflowDraft(template, members);
      expect(draftProblems(draft, members), `${template} ${count}`).toEqual([]);
      expect(speakersOf(draft, members).map(item => item.id).sort()).toEqual([...taking].sort());
    }
  });
});
