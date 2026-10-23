import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { createMemoryKeyBackend, KeyService } from '../../../src/main/security/KeyService';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import type { RunSnapshot, RunSubscription } from '../../../src/shared/types/run';
import { bridge, deferred, snapshot, subscription, time } from '../../unit/rendererSubscriptions/fixtures';

const databases: Database[] = [];
afterEach(() => { cleanup(); localStorage.clear(); delete document.documentElement.dataset.theme; databases.splice(0).forEach(db => db.close()); vi.restoreAllMocks(); });
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  const fake = bridge();
  const api = { ...fake.api, host: { command: vi.fn(async () => { throw new Error('Host command not configured in fixture'); }) },
    summary: { preview: vi.fn(), generate: vi.fn(), confirm: vi.fn() }, usage: { getReport: vi.fn(), writeOff: vi.fn(), exportCsv: vi.fn() }, rooms: new RoomService(db), settings: new ProviderSettingsService(db, new KeyService(db, createMemoryKeyBackend())) };
  window.roundtable = api;
  return { ...fake, db, api };
}
function completed(runId = 'saved', roomId = 'r2'): RunSnapshot {
  const value = snapshot(runId, 4, '持久历史正文');
  value.roomId = roomId; value.status = 'completed'; value.currentTurnId = undefined; value.activeAgentId = undefined;
  value.turns[0].status = 'completed'; value.messages[0].status = 'completed'; value.attempts![0].status = 'completed';
  value.execution!.currentTurnId = null; value.execution!.currentAgentId = null;
  return value;
}
function openRooms() { fireEvent.click(screen.getByRole('button', { name: '房间与成员' })); }

it('keeps start disabled with no room and never creates an implicit Demo', async () => {
  const f = fixture(); render(<App />);
  await waitFor(() => expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(true));
  fireEvent.click(screen.getByRole('button', { name: '开始协作' }));
  expect(f.api.room.createDemo).not.toHaveBeenCalled(); expect(f.api.run.start).not.toHaveBeenCalled();
  const session = createRendererSession(f.api, undefined, { requireRoom: true }); const dispose = session.mount();
  await session.startRun();
  expect(f.api.room.createDemo).not.toHaveBeenCalled(); expect(f.api.run.start).not.toHaveBeenCalled(); dispose();
});

it.each([false, true])('restores the saved Run in its own room without switching to the first room (archived=%s)', async archived => {
  const f = fixture(); f.db.createRoom({ id: 'r1', name: '首个房间' }); f.db.createRoom({ id: 'r2', name: '历史所在房间' });
  if (archived) f.db.archiveRoom('r2');
  const saved = completed(); vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved));
  localStorage.setItem('roundtable.runId', 'saved'); render(<App />);
  await screen.findByText('持久历史正文'); openRooms();
  await screen.findByRole('heading', { name: '历史所在房间' });
  expect((screen.getByLabelText('显示归档房间') as HTMLInputElement).checked).toBe(archived);
  fireEvent.click(screen.getByRole('button', { name: '讨论' }));
  expect(screen.getByText('持久历史正文')).toBeTruthy(); expect(localStorage.getItem('roundtable.runId')).toBe('saved');
});

it('rejects an old subscription and its deltas after selecting a different room in the actual feature', async () => {
  const f = fixture(); f.db.createRoom({ id: 'r1', name: '原房间' }); f.db.createRoom({ id: 'r2', name: '新房间' });
  const late = deferred<RunSubscription>(); vi.mocked(f.api.run.subscribe).mockReturnValue(late.promise);
  vi.spyOn(f.api.rooms, 'listRoomRuns').mockResolvedValue({ items: [{ id: 'old', roomId: 'r1', task: '旧 Run', status: 'completed', createdAt: time, updatedAt: time }], nextCursor: null, hasMore: false });
  render(<App />); openRooms(); await screen.findByRole('heading', { name: '原房间' });
  fireEvent.click(screen.getByRole('button', { name: '历史记录' })); fireEvent.click(await screen.findByRole('button', { name: '旧 Run' }));
  openRooms(); fireEvent.click(screen.getByRole('button', { name: '新房间' }));
  await act(async () => late.resolve(subscription(completed('old', 'r1'))));
  f.emit({ version: 1, runId: 'old', turnId: 'old-turn', requestId: 'old-request', sequence: 5, type: 'text_delta', timestamp: time, payload: { turnId: 'old-turn', messageId: 'old-message', senderName: '起草者', text: '迟到秘密正文' } });
  fireEvent.click(screen.getByRole('button', { name: '讨论' }));
  expect(screen.queryByText('持久历史正文')).toBeNull(); expect(screen.queryByText('迟到秘密正文')).toBeNull();
  expect(localStorage.getItem('roundtable.runId')).toBeNull();
});

it('renders each message with its frozen member, including earlier Attempts and duplicate names', async () => {
  const f = fixture(); f.db.createRoom({ id: 'r2', name: '历史房间' }); const saved = completed();
  f.db.createProvider({ id: 'provider-one', name: '第一服务商', kind: 'mock' }); f.db.createProvider({ id: 'provider-two', name: '第二服务商', kind: 'mock' });
  saved.execution!.membersSnapshot = [
    { agentId: 'agent', displayName: '同名成员', roleTemplateId: '旧起草角色', systemPrompt: '', providerId: 'provider-one', modelId: 'model-one', displayOrder: 0 },
    { agentId: 'agent-two', displayName: '同名成员', roleTemplateId: '旧审查角色', systemPrompt: '', providerId: 'provider-two', modelId: 'model-two', displayOrder: 1 },
  ];
  saved.messages[0].senderName = '同名成员';
  saved.messages.unshift({ id: 'earlier-message', senderName: '同名成员', content: '旧尝试部分正文', status: 'aborted' });
  saved.messages.push({ id: 'second-message', senderName: '同名成员', content: '第二成员正文', status: 'completed' });
  saved.turns.push({ turnId: 'second-turn', runId: 'saved', agentId: 'agent-two', requestId: 'second-request', messageId: 'second-message', status: 'completed', outputText: '第二成员正文' });
  saved.attempts!.unshift({ ...saved.attempts![0], requestId: 'earlier-request', messageId: 'earlier-message', status: 'aborted' });
  saved.attempts![1].attemptIndex = 1;
  saved.attempts!.push({ ...saved.attempts![1], requestId: 'second-request', turnId: 'second-turn', messageId: 'second-message', attemptIndex: 0 });
  vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved)); localStorage.setItem('roundtable.runId', 'saved');
  render(<App />);
  const earlier = (await screen.findByText('旧尝试部分正文')).closest('article')!;
  // D101: the frozen Provider id is shown by its name, never as the id itself.
  await waitFor(() => expect(earlier.textContent).toContain('Provider：第一服务商'));
  expect(earlier.textContent).toContain('旧起草角色'); expect(earlier.textContent).toContain('model-one'); expect(earlier.textContent).not.toContain('provider-one');
  const second = screen.getByText('第二成员正文').closest('article')!;
  expect(second.textContent).toContain('旧审查角色'); expect(second.textContent).toContain('model-two'); expect(second.textContent).not.toContain('model-one');
  expect(second.textContent).toContain('Provider：第二服务商'); expect(second.textContent).not.toContain('第一服务商'); expect(second.textContent).not.toContain('provider-two');
});

it('refreshes member Provider summaries when a settings mutation settles after leaving settings', async () => {
  const f = fixture(); f.db.createRoom({ id: 'r1', name: '房间' }); f.db.createProvider({ id: 'p', name: '旧 Provider', kind: 'mock' });
  f.db.createAgent({ id: 'agent', roomId: 'r1', displayName: '成员', roleTemplateId: '角色', providerId: 'p', modelId: 'mock' });
  const gate = deferred<void>(); const update = f.api.settings.updateProvider.bind(f.api.settings);
  vi.spyOn(f.api.settings, 'updateProvider').mockImplementation(async input => { await gate.promise; return update(input); });
  render(<App />); fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
  await screen.findByLabelText('Provider 名称'); fireEvent.change(screen.getByLabelText('Provider 名称'), { target: { value: '新 Provider' } });
  fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  fireEvent.click(screen.getByRole('button', { name: '返回讨论' })); openRooms();
  fireEvent.click(await screen.findByRole('button', { name: '编辑 成员' }));
  expect(within(screen.getByRole('dialog')).getByRole('option', { name: '旧 Provider · Mock' })).toBeTruthy();
  await act(async () => gate.resolve());
  await within(screen.getByRole('dialog')).findByRole('option', { name: '新 Provider · Mock' });
});

it('persists explicit theme preference and can return to following the system', async () => {
  fixture(); const view = render(<App />);
  await act(async () => {});
  fireEvent.change(screen.getByLabelText('外观'), { target: { value: 'dark' } });
  expect(document.documentElement.dataset.theme).toBe('dark'); view.unmount();
  render(<App />); await act(async () => {}); expect((screen.getByLabelText('外观') as HTMLSelectElement).value).toBe('dark');
  fireEvent.change(screen.getByLabelText('外观'), { target: { value: 'system' } });
  expect(document.documentElement.dataset.theme).toBe('system');
});

it.each(['archive', 'delete', 'filter'] as const)('clears restored messages and rejects late deltas when the final room is removed by %s', async action => {
  const f = fixture(); f.db.createRoom({ id: 'r2', name: '唯一房间' });
  if (action === 'filter') f.db.archiveRoom('r2');
  vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(completed()));
  localStorage.setItem('roundtable.runId', 'saved'); render(<App />);
  await screen.findByText('持久历史正文'); openRooms();
  await screen.findByRole('heading', { name: '唯一房间' });
  if (action === 'filter') fireEvent.click(screen.getByLabelText('显示归档房间'));
  else {
    fireEvent.click(screen.getByRole('button', { name: action === 'archive' ? '归档房间' : '删除房间' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: action === 'archive' ? '确认归档' : '确认删除' }));
  }
  await screen.findByRole('heading', { name: '你的下一场圆桌' });
  act(() => f.emit({ version: 1, runId: 'saved', turnId: 'saved-turn', requestId: 'saved-request', sequence: 5, type: 'text_delta', timestamp: time, payload: { turnId: 'saved-turn', messageId: 'saved-message', senderName: '起草者', text: '旧选择的迟到内容' } }));
  fireEvent.click(screen.getByRole('button', { name: '讨论' }));
  expect(screen.queryByText('持久历史正文')).toBeNull(); expect(screen.queryByText('旧选择的迟到内容')).toBeNull();
  expect(localStorage.getItem('roundtable.runId')).toBeNull();
  expect((screen.getByRole('button', { name: '开始协作' }) as HTMLButtonElement).disabled).toBe(true);
});

it('shows unrecorded metadata for old Runs without using live member configuration', async () => {
  const f = fixture(); f.db.createRoom({ id: 'r2', name: '历史房间' });
  f.db.createAgent({ id: 'agent', roomId: 'r2', displayName: '当前改名', roleTemplateId: '当前角色' });
  const saved = completed(); saved.execution!.membersSnapshot = null;
  vi.mocked(f.api.run.subscribe).mockResolvedValue(subscription(saved)); localStorage.setItem('roundtable.runId', 'saved');
  render(<App />); const article = (await screen.findByText('持久历史正文')).closest('article')!;
  expect(article.textContent).toContain('未记录'); expect(article.textContent).not.toContain('当前改名'); expect(article.textContent).not.toContain('当前角色');
});

it.each(['createProvider', 'deleteProvider', 'setKey', 'deleteKey'] as const)('refreshes Provider summaries after %s settles outside settings', async operation => {
  const f = fixture(); f.db.createRoom({ id: 'r1', name: '房间' });
  f.db.createProvider({ id: 'p', name: '原 Provider', kind: operation.includes('Key') ? 'openai' : 'mock' });
  if (operation === 'deleteKey') await f.api.settings.setKey({ providerId: 'p', apiKey: 'fixture-key' });
  const summaries = vi.spyOn(f.api.settings, 'listProviderSummaries');
  const gate = deferred<void>();
  const original = {
    createProvider: f.api.settings.createProvider.bind(f.api.settings), deleteProvider: f.api.settings.deleteProvider.bind(f.api.settings),
    setKey: f.api.settings.setKey.bind(f.api.settings), deleteKey: f.api.settings.deleteKey.bind(f.api.settings),
  };
  const mutation = operation === 'createProvider' ? vi.spyOn(f.api.settings, 'createProvider').mockImplementation(async input => { await gate.promise; return original.createProvider(input); })
    : operation === 'deleteProvider' ? vi.spyOn(f.api.settings, 'deleteProvider').mockImplementation(async input => { await gate.promise; return original.deleteProvider(input); })
    : operation === 'setKey' ? vi.spyOn(f.api.settings, 'setKey').mockImplementation(async input => { await gate.promise; return original.setKey(input); })
    : vi.spyOn(f.api.settings, 'deleteKey').mockImplementation(async input => { await gate.promise; return original.deleteKey(input); });
  render(<App />); fireEvent.click(screen.getByRole('button', { name: '模型设置' }));
  await screen.findByLabelText('Provider 名称');
  if (operation === 'createProvider') {
    fireEvent.click(screen.getByRole('button', { name: '新增 Provider' }));
    fireEvent.change(screen.getByLabelText('Provider 名称'), { target: { value: '新增 Provider' } });
    fireEvent.change(screen.getByLabelText('Provider 类型'), { target: { value: 'mock' } });
    fireEvent.click(screen.getByRole('button', { name: '保存配置' }));
  } else if (operation === 'deleteProvider') {
    fireEvent.click(screen.getByRole('button', { name: '删除 Provider' })); fireEvent.click(screen.getByRole('button', { name: '确认删除 Provider' }));
  } else {
    fireEvent.click(screen.getByLabelText('我已核对请求目标'));
    if (operation === 'setKey') { fireEvent.change(screen.getByLabelText('API Key', { selector: 'input' }), { target: { value: 'fixture-key' } }); fireEvent.submit(screen.getByLabelText('API Key', { selector: 'input' }).closest('form')!); }
    else { fireEvent.click(screen.getByRole('button', { name: '删除 Key' })); fireEvent.click(screen.getByRole('button', { name: '确认删除 Key' })); }
  }
  await waitFor(() => expect(mutation).toHaveBeenCalledOnce());
  fireEvent.click(screen.getByRole('button', { name: '返回讨论' }));
  const callsBeforeSettling = summaries.mock.calls.length;
  await act(async () => gate.resolve());
  await waitFor(() => expect(summaries.mock.calls.length).toBeGreaterThan(callsBeforeSettling));
  if (operation === 'createProvider') expect((await f.api.settings.listProviderSummaries()).some(p => p.name === '新增 Provider')).toBe(true);
  if (operation === 'deleteProvider') expect(f.db.getProviderConfiguration('p')).toBeUndefined();
  if (operation === 'setKey' || operation === 'deleteKey') expect((await f.api.settings.getProviderKeyState({ providerId: 'p' })).state).toBe(operation === 'setKey' ? 'session' : 'missing');
});
