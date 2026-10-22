import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { AgentConfiguration, AgentInput, CreateAgentInput, ProviderSummary, RoomConfiguration, RoomsFeatureProps } from '../../../shared/contracts/configuration';
import { createAgentInputSchema } from '../../../shared/schemas/configuration';
import { looksLikeApiKey } from '../../../shared/schemas/common';
import { Dialog, errorText } from './ui';

function agentInput(agent: AgentConfiguration): AgentInput {
  const { archivedAt: _archived, createdAt: _created, updatedAt: _updated, withheldModelId: _withheld, ...input } = agent; return input;
}
export function providerNotice(agent: Pick<AgentConfiguration, 'providerId' | 'modelId'> & { withheldModelId?: true }, providers: readonly ProviderSummary[], state: RoomsFeatureProps['providerLoadState']): string {
  if (agent.providerId === null && agent.modelId === null) return '尚未配置 Provider 与 Model';
  if (state === 'loading') return '正在加载 Provider 配置';
  if (state === 'error') return 'Provider 加载失败，配置可用性未知';
  const provider = providers.find(p => p.id === agent.providerId);
  if (!provider) return 'Provider 不存在';
  if (!provider.configurationValid || provider.kind === null) return 'Provider 配置失效';
  if (!provider.enabled) return 'Provider 已禁用';
  if (agent.withheldModelId) return '之前填写的 Model 看起来是 API Key，已隐藏且不会使用；请编辑成员，重新填写模型 ID';
  if (!agent.modelId) return 'Model 未配置：请编辑成员，填写模型 ID 后才能参与运行';
  if (provider.kind === 'mock') return agent.modelId === 'mock' ? '显式 Mock · 本地验证，不产生模型费用' : 'Mock 仅支持 mock 模型';
  return `真实 Provider · 生成能力尚未验证 · 密钥状态：${provider.hasStoredKey ? '存在存储记录，不代表可用' : '摘要未发现存储记录，会话密钥需在设置中确认'}`;
}
export function MembersPanel({ api, room, providers, providerLoadState, onReloadProviders, onOpenSettings }: RoomsFeatureProps & { room: RoomConfiguration }) {
  const [agents, setAgents] = useState<AgentConfiguration[]>([]); const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<AgentConfiguration | 'new'>(); const [confirmation, setConfirmation] = useState<{ agent: AgentConfiguration; action: 'archive' | 'delete' }>();
  const [busy, setBusy] = useState(false); const lock = useRef(false); const request = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const reload = useCallback(async () => {
    const token = ++request.current; setLoading(true); setError('');
    try { const next = await api.listAgentConfigurations({ roomId: room.id, includeArchived }); if (alive.current && token === request.current) setAgents(next); }
    catch (error) { if (alive.current && token === request.current) setError(errorText(error)); }
    finally { if (alive.current && token === request.current) setLoading(false); }
  }, [api, room.id, includeArchived]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);
  async function mutate(work: () => Promise<unknown>, success: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice(''); request.current++;
    try {
      await work(); if (!alive.current) return;
      setEditor(undefined); setConfirmation(undefined); setNotice(success); await reload();
    } catch (error) { if (alive.current) setError(errorText(error)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const active = agents.filter(a => a.archivedAt === null); const enabled = active.filter(a => a.enabled);
  function move(agent: AgentConfiguration, offset: number) {
    const ids = active.map(a => a.id); const index = ids.indexOf(agent.id); const target = index + offset;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void mutate(() => api.reorderAgents({ roomId: room.id, agentIds: ids }), '已保存成员顺序');
  }
  return <section aria-label="成员配置">
    <div className="rooms-toolbar"><div><h3>AI 成员</h3><p className="rooms-secondary">配置变更仅影响新 Run；已有 Run 保留冻结快照。</p></div><button type="button" className="rooms-primary" disabled={busy || loading || !!room.archivedAt} onClick={() => { setError(''); setEditor('new'); }}>新增成员</button></div>
    {room.archivedAt && <p>房间已归档。恢复房间后可编辑成员。</p>}
    {providerLoadState === 'loading' && <p role="status">正在加载 Provider…</p>}
    {providerLoadState === 'error' && <p className="rooms-error">Provider 加载失败。<button type="button" onClick={onReloadProviders}>重新加载 Provider</button></p>}
    <label className="rooms-check"><input type="checkbox" checked={includeArchived} disabled={busy} onChange={event => setIncludeArchived(event.target.checked)} />显示归档成员</label>
    {error && !editor && !confirmation && <p role="alert" className="rooms-error">{error}</p>}{notice && <p role="status" className="rooms-success">{notice}</p>}
    {loading ? <p role="status">正在加载成员…</p> : <>
      {!error && !enabled.length && <p className="rooms-warning">没有启用的成员，无法开始新 Run。</p>}
      {!error && !agents.length && <div className="rooms-empty"><h3>还没有成员</h3><p>添加成员并明确选择 Provider 与 Model，配置后即可交给主持人开始协作。</p></div>}
      <ol className="rooms-members">{agents.map(agent => {
        const index = active.findIndex(a => a.id === agent.id); const archived = !!agent.archivedAt;
        return <li key={agent.id} className="rooms-member"><div className="rooms-toolbar"><div><h4>{agent.displayName}</h4><p>{agent.roleTemplateId} · {archived ? '已归档' : agent.enabled ? '已启用' : '已禁用'}</p></div><span className="rooms-secondary">{agent.modelId || '未选择模型'}</span></div>
          <p className="rooms-secondary">{providerNotice(agent, providers, providerLoadState)}</p>
          {agent.systemPrompt && <details><summary>System prompt</summary><p className="rooms-prewrap">{agent.systemPrompt}</p></details>}
          <div className="rooms-actions">
            <button type="button" disabled={busy || !!room.archivedAt} aria-label={`编辑 ${agent.displayName}`} onClick={() => { setError(''); setEditor(agent); }}>编辑</button>
            {!archived && <><button type="button" disabled={busy || !!room.archivedAt} aria-label={`${agent.enabled ? '禁用' : '启用'} ${agent.displayName}`} onClick={() => void mutate(() => api.updateAgent({ ...agentInput(agent), enabled: !agent.enabled }), agent.enabled ? '已禁用成员' : '已启用成员')}>{agent.enabled ? '禁用' : '启用'}</button>
              <button type="button" disabled={busy || !!room.archivedAt || index <= 0} aria-label={`上移 ${agent.displayName}`} onClick={() => move(agent, -1)}>上移</button>
              <button type="button" disabled={busy || !!room.archivedAt || index === active.length - 1} aria-label={`下移 ${agent.displayName}`} onClick={() => move(agent, 1)}>下移</button></>}
            <button type="button" disabled={busy || !!room.archivedAt} aria-label={`${archived ? '恢复' : '归档'} ${agent.displayName}`} onClick={() => { setError(''); if (archived) void mutate(() => api.archiveAgent({ id: agent.id, archived: false }), '已恢复成员'); else setConfirmation({ agent, action: 'archive' }); }}>{archived ? '恢复' : '归档'}</button>
            <button type="button" disabled={busy || !!room.archivedAt} aria-label={`删除 ${agent.displayName}`} onClick={() => { setError(''); setConfirmation({ agent, action: 'delete' }); }}>删除</button>
          </div>
        </li>;
      })}</ol>
    </>}
    <button type="button" disabled={busy || loading} onClick={() => void reload()}>刷新成员</button>
    {editor && <MemberEditor key={editor === 'new' ? 'new' : editor.id} agent={editor === 'new' ? undefined : editor} roomId={room.id} order={active.length ? Math.max(...active.map(a => a.displayOrder)) + 1 : 0} busy={busy} serverError={error} providers={providers} providerLoadState={providerLoadState} onOpenSettings={onOpenSettings} onClose={() => setEditor(undefined)} onSave={value => void mutate(() => editor === 'new' ? api.createAgent(value) : api.updateAgent({ ...value, id: editor.id }), '已保存成员')} />}
    {confirmation && <Dialog title={`${confirmation.action === 'delete' ? '删除' : '归档'}「${confirmation.agent.displayName}」`} busy={busy} onClose={() => setConfirmation(undefined)}>
      <p>{confirmation.action === 'delete' ? '删除不可撤销。任何历史 Turn 或 Run 冻结快照引用都会阻止删除；保留历史的成员可归档。' : '归档后成员不参与新 Run；运行中、暂停或可恢复 Run 继续使用原快照，历史身份保留。'}</p>
      {error && <p role="alert" className="rooms-error">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void mutate(() => confirmation.action === 'delete' ? api.deleteAgent({ id: confirmation.agent.id }) : api.archiveAgent({ id: confirmation.agent.id }), confirmation.action === 'delete' ? '已删除成员' : '已归档成员')}>{busy ? '处理中…' : confirmation.action === 'delete' ? '确认删除' : '确认归档'}</button>
    </Dialog>}
  </section>;
}
// D096: shown when a pasted API Key lands in the Model field; the Key belongs to the Provider in model settings.
export const keyInMemberModelMessage = '这看起来是 API Key，不是模型 ID。Key 请到“模型设置”里对应 Provider 的“API Key”一栏填写；这里只填模型 ID。';
const memberModelExamples: Record<string, string> = { mock: 'mock', openai: 'gpt-4o-mini', 'openai-compatible': 'deepseek-flash', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-flash' };
function MemberEditor({ agent, roomId, order, busy, serverError, providers, providerLoadState, onOpenSettings, onSave, onClose }: {
  agent?: AgentConfiguration; roomId: string; order: number; busy: boolean; serverError: string; providers: readonly ProviderSummary[]; providerLoadState: RoomsFeatureProps['providerLoadState']; onOpenSettings: () => void; onSave: (input: CreateAgentInput) => void; onClose: () => void;
}) {
  const [name, setName] = useState(agent?.displayName ?? ''); const [role, setRole] = useState(agent?.roleTemplateId ?? ''); const [prompt, setPrompt] = useState(agent?.systemPrompt ?? '');
  const [providerId, setProviderId] = useState(agent?.providerId ?? ''); const [modelId, setModelId] = useState(agent?.modelId ?? ''); const [enabled, setEnabled] = useState(agent?.enabled ?? true); const [error, setError] = useState('');
  const listId = useId(); const provider = providers.find(p => p.id === providerId);
  function selectProvider(id: string) { setProviderId(id); const selected = providers.find(p => p.id === id); setModelId(selected?.kind === 'mock' ? 'mock' : selected?.defaultModelId ?? ''); }
  function submit(event: FormEvent) {
    event.preventDefault(); setError('');
    const value = { roomId, displayName: name, roleTemplateId: role, systemPrompt: prompt, providerId: providerId || null, modelId: modelId.trim() || null, enabled, displayOrder: agent?.displayOrder ?? order };
    if (looksLikeApiKey(modelId)) { setError(keyInMemberModelMessage); return; }
    const parsed = createAgentInputSchema.safeParse(value);
    if (!parsed.success) { setError('请填写成员名称与角色；Provider 与 Model 必须同时配置或同时留空。'); return; }
    if (providerId && (providerLoadState !== 'ready' || !provider || !provider.configurationValid || provider.kind === null)) { setError('Provider 不可用，请刷新设置或重新选择。'); return; }
    if (provider?.kind === 'mock' && modelId !== 'mock') { setError('显式 Mock 仅支持 mock 模型。'); return; }
    onSave(parsed.data);
  }
  return <Dialog title={agent ? '编辑成员' : '新增成员'} busy={busy} onClose={onClose}><form className="rooms-form" onSubmit={submit} onChange={() => setError('')} noValidate>
    <label>成员名称<input autoFocus value={name} disabled={busy} required onChange={event => setName(event.target.value)} /></label>
    <label>成员角色<input value={role} disabled={busy} required onChange={event => setRole(event.target.value)} placeholder="例如：起草者、Critic" /></label>
    <label>System prompt<textarea rows={4} value={prompt} disabled={busy} onChange={event => setPrompt(event.target.value)} /></label>
    <label>Provider<select value={providerId} disabled={busy || providerLoadState !== 'ready'} onChange={event => selectProvider(event.target.value)}><option value="">暂不配置</option>
      {providerId && !provider && <option value={providerId}>失效引用（需重新选择）</option>}
      {providers.map(p => <option key={p.id} value={p.id}>{p.name} · {p.kind === 'mock' ? 'Mock' : p.kind ?? '失效'}{!p.enabled ? ' · 已禁用' : ''}{!p.configurationValid ? ' · 配置失效' : ''}</option>)}
    </select></label>
    <label>Model<input list={listId} value={modelId} disabled={busy || (!providerId && !modelId) || provider?.kind === 'mock'} onChange={event => setModelId(event.target.value)} autoComplete="off" spellCheck={false}
      placeholder={`选择建议或输入模型 ID，例如 ${memberModelExamples[provider?.kind ?? 'openai-compatible']}`} aria-invalid={looksLikeApiKey(modelId) || undefined} aria-describedby={`${listId}-help`} /></label>
    {looksLikeApiKey(modelId) ? <p id={`${listId}-help`} role="alert" className="rooms-error">{keyInMemberModelMessage}</p>
      : <p id={`${listId}-help`} className="rooms-secondary">例如 {memberModelExamples[provider?.kind ?? 'openai-compatible']}{agent?.withheldModelId && !modelId ? '。之前填写的内容看起来是 API Key，已隐藏且不会使用，请重新填写。' : ''}</p>}
    <datalist id={listId}>{provider?.customModels.map(model => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
    <p className="rooms-secondary">{providerNotice({ providerId: providerId || null, modelId: modelId || null }, providers, providerLoadState)}</p>
    <p className="rooms-secondary">模型 ID 可自定义。未配置、禁用或失效配置不能执行，不会自动改用 Mock。</p>
    <button type="button" disabled={busy} onClick={onOpenSettings}>前往模型设置</button>
    <label className="rooms-check"><input type="checkbox" checked={enabled} disabled={busy} onChange={event => setEnabled(event.target.checked)} />启用成员</label>
    {(error || serverError) && <p role="alert" className="rooms-error">{error || serverError}</p>}<button type="submit" className="rooms-primary" disabled={busy}>{busy ? '正在保存…' : '保存成员'}</button>
  </form></Dialog>;
}
