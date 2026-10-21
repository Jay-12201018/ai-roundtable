import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from 'react';
import type { CreateProviderInput, KeyStorageStatus, ProviderConfiguration, ProviderKeyState, ProviderKind, ProviderSettingsApiContract, ProviderSummary, SettingsFeatureProps } from '../../../shared/contracts/configuration';
import { ContractError } from '../../../shared/contracts/errors';
import { createProviderInputSchema, providerBaseUrlSchema } from '../../../shared/schemas/configuration';
import { apiErrorSchema, type ErrorCode } from '../../../shared/schemas/error';
import type { z } from 'zod';
import type { providerModelSchema, connectionLevelSchema } from '../../../shared/schemas/provider';
import './settings.css';

type Model = z.infer<typeof providerModelSchema>;
type TestLevel = z.infer<typeof connectionLevelSchema>;
type Draft = { name: string; kind: ProviderKind; baseUrl: string; enabled: boolean; isDefault: boolean; defaultModelId: string; customModels: Model[] };
const emptyDraft = (): Draft => ({ name: '', kind: 'openai-compatible', baseUrl: '', enabled: true, isDefault: false, defaultModelId: '', customModels: [] });
const toDraft = (value: ProviderConfiguration): Draft => ({ name: value.name, kind: value.kind, baseUrl: value.baseUrl ?? '', enabled: value.enabled, isDefault: value.isDefault, defaultModelId: value.defaultModelId ?? '', customModels: value.customModels });
const defaultTargets: Partial<Record<ProviderKind, string>> = { openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta' };
const kinds: Record<ProviderKind, string> = { mock: 'Mock（离线演示）', openai: 'OpenAI', 'openai-compatible': 'OpenAI-Compatible', anthropic: 'Anthropic', gemini: 'Gemini' };
const messages: Record<ErrorCode, string> = {
  invalid_input: '配置无效，请检查名称、模型与请求地址。', invalid_response: '返回结果无效，请重新加载。',
  forbidden: '此操作没有权限。', unsupported: '当前目标或模型缺少已确认的能力、计数或预算信息。', not_found: '配置已不存在，请重新加载。',
  invalid_state: '当前状态不允许此操作；请先结束相关运行或检查引用。', internal_error: '操作失败，请重试。',
  transport_error: '连接中断，请重新加载后重试。', authentication_failed: '鉴权失败，请检查 Key。', rate_limited: '请求过于频繁，请稍后重试。',
  timeout: '请求超时，请稍后重试。', cancelled: '请求已取消。', network_error: '无法连接 Provider，请检查请求地址。',
};
function safeError(error: unknown): string {
  const parsed = apiErrorSchema.safeParse(error instanceof ContractError ? error.detail : error);
  return messages[parsed.success ? parsed.data.code : 'internal_error'];
}

export function SettingsFeature(props: SettingsFeatureProps) {
  const previousApi = useRef(props.api);
  const session = useRef(0);
  if (previousApi.current !== props.api) { previousApi.current = props.api; ++session.current; }
  return <SettingsSession key={session.current} {...props} />;
}

function SettingsSession({ api, onClose }: SettingsFeatureProps) {
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [storage, setStorage] = useState<KeyStorageStatus | null>(null);
  const [selection, setSelection] = useState<{ id: string | null; revision: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [closed, setClosed] = useState(false);
  const revision = useRef(0);
  const loadVersion = useRef(0);
  const alive = useRef(true);
  const secret = useRef<HTMLInputElement>(null);

  async function reload(selectFirst = false) {
    const version = ++loadVersion.current;
    const selectionRevision = revision.current;
    setLoading(true); setError('');
    try {
      const [list, status] = await Promise.all([api.listProviderSummaries(), api.getKeyStorageStatus()]);
      if (!alive.current || version !== loadVersion.current) return;
      setProviders(list); setStorage(status);
      if (selectFirst && list[0] && revision.current === selectionRevision) setSelection({ id: list[0].id, revision: ++revision.current });
    } catch (cause) {
      if (alive.current && version === loadVersion.current) setError(safeError(cause));
    } finally {
      if (alive.current && version === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    alive.current = true;
    void reload(true);
    return () => { alive.current = false; ++loadVersion.current; if (secret.current) secret.current.value = ''; };
  }, [api]);

  function close() {
    if (secret.current) secret.current.value = '';
    alive.current = false; ++loadVersion.current; setClosed(true); onClose();
  }

  if (closed) return null;
  return <section className="settings-feature" aria-labelledby="settings-title">
    <header className="settings-header"><div><h1 id="settings-title">模型与密钥设置</h1><p>每个 Provider 实例独立保存模型、请求目标与 Key。</p></div><button type="button" onClick={close}>返回讨论</button></header>
    <div className="settings-layout">
      <aside aria-label="Provider 实例" className="settings-navigation">
        <button type="button" onClick={() => setSelection({ id: null, revision: ++revision.current })}>新增 Provider</button>
        {loading && <p role="status">正在加载配置…</p>}
        {error && <div><p role="alert">{error}</p><button type="button" onClick={() => void reload(true)}>重新加载</button></div>}
        {!loading && !error && providers.length === 0 && <p>还没有 Provider，添加一个配置开始。</p>}
        <ul>{providers.map(provider => <li key={provider.id}><button type="button" aria-current={selection?.id === provider.id ? 'page' : undefined} onClick={() => setSelection({ id: provider.id, revision: ++revision.current })}>
          {provider.name} · {provider.kind ? kinds[provider.kind] : '无效配置'} · {provider.enabled ? '已启用' : '已禁用'}{provider.isDefault ? ' · 默认' : ''}{!provider.configurationValid ? ' · 需要修复' : ''}
        </button></li>)}</ul>
      </aside>
      <main className="settings-content">
        {selection ? <ProviderEditor key={`${selection.id ?? 'new'}-${selection.revision}`} id={selection.id} api={api} storage={storage} secret={secret}
          onSaved={provider => { if (!alive.current) return; if (selection.id === null) setSelection({ id: provider.id, revision: ++revision.current }); void reload(); }}
          onDeleted={() => { if (!alive.current) return; setSelection(null); void reload(true); }} />
          : <p>选择一个 Provider 查看配置，或新增独立实例。</p>}
      </main>
    </div>
  </section>;
}

function ProviderEditor({ id, api, storage, secret, onSaved, onDeleted }: {
  id: string | null; api: ProviderSettingsApiContract; storage: KeyStorageStatus | null;
  secret: RefObject<HTMLInputElement | null>; onSaved: (provider: ProviderConfiguration) => void; onDeleted: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [saved, setSaved] = useState<ProviderConfiguration | null>(null);
  const [keyState, setKeyState] = useState<ProviderKeyState | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [targetConfirmed, setTargetConfirmed] = useState(false);
  const [generationConfirmed, setGenerationConfirmed] = useState(false);
  const [generationModel, setGenerationModel] = useState('');
  const [hasSecret, setHasSecret] = useState(false);
  const [deleting, setDeleting] = useState<'provider' | 'key' | null>(null);
  const [newModel, setNewModel] = useState<Model>({ id: '', name: '' });
  const [listedModels, setListedModels] = useState<Model[] | null>(null);
  const [listResult, setListResult] = useState('');
  const [results, setResults] = useState<Partial<Record<TestLevel, string>>>({});
  const alive = useRef(true);
  const pending = useRef(false);
  const loadVersion = useRef(0);
  const ownSecret = useRef<HTMLInputElement | null>(null);
  const bindSecret = useCallback((input: HTMLInputElement | null) => {
    const previous = ownSecret.current;
    if (previous && previous !== input) previous.value = '';
    ownSecret.current = input;
    if (input || secret.current === previous) secret.current = input;
  }, [secret]);

  function clearSecret() { if (ownSecret.current) ownSecret.current.value = ''; setHasSecret(false); }
  async function load() {
    if (id === null) return;
    const version = ++loadVersion.current;
    setLoading(true); setError(''); setLoadFailed(false);
    try {
      const [provider, state] = await Promise.all([api.getProviderConfiguration({ id }), api.getProviderKeyState({ providerId: id })]);
      if (!alive.current || version !== loadVersion.current) return;
      setSaved(provider); setDraft(toDraft(provider)); setKeyState(state); setGenerationModel(provider.defaultModelId ?? (provider.kind === 'mock' ? 'mock' : ''));
    } catch (cause) { if (alive.current && version === loadVersion.current) { setError(safeError(cause)); setLoadFailed(true); } }
    finally { if (alive.current && version === loadVersion.current) setLoading(false); }
  }

  useEffect(() => {
    alive.current = true; void load();
    return () => { alive.current = false; ++loadVersion.current; if (ownSecret.current) ownSecret.current.value = ''; };
  }, [id, api]);

  // The ref closes the interval before React renders disabled controls.
  async function perform(action: () => Promise<void>) {
    if (pending.current || !alive.current) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); }
    catch (cause) { if (alive.current) setError(safeError(cause)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  }

  const endpoint = draft.kind === 'mock' || draft.baseUrl.trim() === '' ? null : providerBaseUrlSchema.safeParse(draft.baseUrl);
  const endpointInvalid = endpoint !== null && !endpoint.success;
  const normalizedEndpoint = endpoint?.success ? endpoint.data : null;
  const effectiveTarget = normalizedEndpoint ?? defaultTargets[draft.kind] ?? null;
  const target = draft.kind === 'mock' ? 'Mock 离线演示，不发送网络请求。' : effectiveTarget ?? '请填写并核对实际请求地址；此类型的默认目标尚未配置。';
  const targetChanged = !saved || saved.kind !== draft.kind || saved.baseUrl !== normalizedEndpoint;
  const dirty = saved === null || JSON.stringify(toDraft(saved)) !== JSON.stringify(draft);
  const canUseSaved = saved !== null && !dirty && !busy;
  const targetReady = draft.kind === 'mock' || targetConfirmed;
  const currentStorage = keyState?.storage ?? storage;

  function change<K extends keyof Draft>(field: K, value: Draft[K]) {
    clearSecret(); setNotice(''); setError(''); setDeleting(null);
    if (field === 'kind' || field === 'baseUrl') { setTargetConfirmed(false); setGenerationConfirmed(false); }
    setDraft(previous => ({ ...previous, [field]: value }));
  }

  function save(event: FormEvent) {
    event.preventDefault(); clearSecret();
    const input: CreateProviderInput = { ...draft, baseUrl: draft.kind === 'mock' || draft.baseUrl.trim() === '' ? null : draft.baseUrl, defaultModelId: draft.defaultModelId.trim() || null };
    const parsed = createProviderInputSchema.safeParse(input);
    if (!parsed.success) { setError(messages.invalid_input); return; }
    if (draft.kind !== 'mock' && targetChanged && !targetConfirmed) { setError('请先核对并确认请求目标；更换目标后需重新输入 Key。'); return; }
    void perform(async () => {
      const value = saved ? await api.updateProvider({ ...parsed.data, id: saved.id }) : await api.createProvider(parsed.data);
      if (!alive.current) return;
      setSaved(value); setDraft(toDraft(value)); setTargetConfirmed(false); setGenerationConfirmed(false); setResults({}); setListResult(''); setListedModels(null); setGenerationModel(value.defaultModelId ?? (value.kind === 'mock' ? 'mock' : ''));
      setNotice('配置已保存。'); onSaved(value);
      if (!alive.current) return;
      const state = await api.getProviderKeyState({ providerId: value.id });
      if (alive.current) setKeyState(state);
    });
  }

  function saveKey(event: FormEvent) {
    event.preventDefault();
    if (pending.current || !saved || dirty || !targetReady || draft.kind === 'mock') { clearSecret(); return; }
    const apiKey = ownSecret.current?.value ?? '';
    clearSecret();
    if (apiKey.trim() === '') { setError('请输入 API Key；离开输入框会清除输入。'); return; }
    void perform(async () => {
      const state = await api.setKey({ providerId: saved.id, apiKey });
      if (alive.current) { setKeyState(state); setNotice('Key 已保存。'); setResults({}); setTargetConfirmed(false); setGenerationConfirmed(false); }
    });
  }

  function deleteConfirmed() {
    const providerId = saved?.id ?? id;
    if (!providerId) return;
    const operation = deleting; clearSecret();
    void perform(async () => {
      if (operation === 'provider') {
        await api.deleteProvider({ id: providerId }); if (alive.current) onDeleted();
      } else if (operation === 'key') {
        await api.deleteKey({ providerId });
        const state = await api.getProviderKeyState({ providerId });
        if (alive.current) { setKeyState(state); setDeleting(null); setNotice('Key 已删除。'); setResults({}); setTargetConfirmed(false); setGenerationConfirmed(false); }
      }
    });
  }

  async function confirmSavedTarget(): Promise<boolean> {
    if (!saved || dirty || !targetReady) throw new ContractError('invalid_state');
    if (saved.kind === 'mock') return true;
    const baseUrl = saved.baseUrl ?? defaultTargets[saved.kind] ?? null;
    if (!baseUrl) throw new ContractError('invalid_input');
    const response = await api.confirmTarget({ providerId: saved.id, baseUrl, confirmed: true });
    if (!alive.current) return false;
    if (response.providerId !== saved.id) throw new ContractError('invalid_response');
    return true;
  }

  function confirmSessionTarget() {
    clearSecret();
    if (!canUseSaved || !targetReady) return;
    void perform(async () => {
      if (await confirmSavedTarget()) setNotice('本次会话请求目标已确认；更换 Key 或目标后需重新确认。');
    });
  }

  function test(level: TestLevel) {
    clearSecret();
    if (!canUseSaved || !saved || level !== 'configuration' && !targetReady || level === 'generation' && (!generationConfirmed || generationModel.trim() === '')) return;
    void perform(async () => {
      if (level !== 'configuration' && !await confirmSavedTarget()) return;
      const response = await api.testConnection({ providerId: saved.id, level, ...(level === 'generation' ? { modelId: generationModel.trim(), ...(saved.kind === 'mock' ? {} : { allowGeneration: true }) } : {}) });
      if (!alive.current) return;
      if (response.providerId !== saved.id || response.result.level !== level) throw new ContractError('invalid_response');
      const result = response.result;
      setResults(previous => ({ ...previous, [level]: result.ok ? (level === 'configuration' ? '通过（仅本地配置）' : saved.kind === 'mock' ? '通过（Mock）' : '通过') : safeError(result.error) }));
    });
  }

  function listModels() {
    clearSecret(); if (!canUseSaved || !saved || !targetReady) return;
    void perform(async () => {
      try {
        if (!await confirmSavedTarget()) return;
        const response = await api.listModels({ providerId: saved.id });
        if (!alive.current) return;
        if (response.providerId !== saved.id) throw new ContractError('invalid_response');
        setListedModels(response.models); setListResult(response.models.length ? '模型列表：已获取；不代表可以生成。' : '模型列表：没有返回模型；仍可手动添加。');
      } catch (cause) { if (alive.current) { setListedModels(null); setListResult(`模型列表：${safeError(cause)}`); } }
    });
  }

  const deletionConfirmation = deleting && <div className="settings-confirm" role="group" aria-label={deleting === 'key' ? '删除 Key 确认' : '删除 Provider 确认'}><p>{deleting === 'key' ? '确认删除当前 Key？删除后需重新输入，旧引用将失效。' : '确认删除此 Provider？有关联成员或运行时会被拒绝，请先修复引用。'}</p><div className="settings-actions"><button type="button" disabled={busy} onClick={deleteConfirmed}>{deleting === 'key' ? '确认删除 Key' : '确认删除 Provider'}</button><button type="button" disabled={busy} onClick={() => setDeleting(null)}>取消删除</button></div></div>;
  if (loading) return <p role="status">正在加载 Provider…</p>;
  if (loadFailed) return <div aria-busy={busy}>{error && <p role="alert">{error}</p>}<p>无法读取此配置。可重试加载；需要移除此实例时，删除仍受成员与运行引用保护。</p><div className="settings-actions"><button type="button" disabled={busy} onClick={() => void load()}>重新加载</button><button type="button" disabled={busy} onClick={() => setDeleting('provider')}>删除 Provider</button></div>{deletionConfirmation}</div>;
  return <div className="settings-editor" aria-busy={busy}>
    <h2>{saved ? '编辑 Provider' : '新增 Provider'}</h2>
    <p>Mock 是离线演示。保存配置与 Key 不代表鉴权或生成成功；真实请求需要确认目标，生成还需已审核的模型能力与预算。</p>
    {error && <p role="alert">{error}</p>}{notice && <p role="status" className="settings-success">{notice}</p>}
    {busy && <p role="status">正在处理，请等待结果…</p>}
    <form onSubmit={save} noValidate>
      <fieldset disabled={busy}><legend>Provider 配置</legend>
        <label>Provider 名称<input value={draft.name} onChange={event => change('name', event.target.value)} /></label>
        <label>Provider 类型<select value={draft.kind} onChange={event => {
          const kind = event.target.value as ProviderKind;
          change('kind', kind);
          if (kind === 'mock') setDraft(previous => ({ ...previous, baseUrl: '', customModels: [], defaultModelId: 'mock' }));
        }}>{Object.entries(kinds).map(([kind, name]) => <option key={kind} value={kind}>{name}</option>)}</select></label>
        {draft.kind !== 'mock' && <label>Base URL<input type="url" value={draft.baseUrl} placeholder="https://example.com/v1" autoComplete="off" onChange={event => change('baseUrl', event.target.value)} aria-describedby="settings-endpoint-help" /></label>}
        <p id="settings-endpoint-help">仅允许 HTTPS 或明确的 localhost、127.0.0.1、[::1] HTTP；不得含凭据、查询参数或片段。留空使用厂商默认地址；兼容端点需填写才能通过配置检查。</p>
        <div className="settings-target"><strong>请求目标</strong><p>{endpointInvalid ? '地址无效，无法确认请求目标。' : target}</p>
          {draft.kind !== 'mock' && !endpointInvalid && <label className="settings-check"><input type="checkbox" checked={targetConfirmed} onChange={event => setTargetConfirmed(event.target.checked)} />我已核对请求目标</label>}
          {saved && draft.kind !== 'mock' && <button type="button" disabled={!canUseSaved || !targetReady || !effectiveTarget} onClick={confirmSessionTarget}>确认本次会话目标</button>}
          {saved && targetChanged && <p className="settings-warning">更换类型或请求目标会撤销旧 Key；保存后必须重新输入 Key。</p>}
        </div>
        <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={event => { change('enabled', event.target.checked); if (!event.target.checked) setDraft(previous => ({ ...previous, isDefault: false })); }} />启用此 Provider</label>
        <label className="settings-check"><input type="checkbox" checked={draft.isDefault} onChange={event => { change('isDefault', event.target.checked); if (event.target.checked) setDraft(previous => ({ ...previous, enabled: true })); }} />设为默认 Provider</label>
        <p>默认 Provider 必须启用；保存后会取消其他实例的默认标记，不会改动房间成员已保存的选择。</p>
        <label>默认模型 ID<input value={draft.defaultModelId} disabled={draft.kind === 'mock'} onChange={event => change('defaultModelId', event.target.value)} /></label>
        {draft.kind !== 'mock' && <div className="settings-models"><h3>自定义模型</h3><p>模型 ID 属于当前实例；允许手动输入，不以模型列表作为白名单。</p>
          {draft.customModels.map((model, index) => <div className="settings-model-row" key={index}>
            <label>模型 {index + 1} ID<input value={model.id} onChange={event => change('customModels', draft.customModels.map((value, i) => i === index ? { ...value, id: event.target.value } : value))} /></label>
            <label>模型 {index + 1} 名称<input value={model.name} onChange={event => change('customModels', draft.customModels.map((value, i) => i === index ? { ...value, name: event.target.value } : value))} /></label>
            <button type="button" onClick={() => change('customModels', draft.customModels.filter((_, i) => i !== index))}>移除模型 {index + 1}</button>
          </div>)}
          <div className="settings-model-row"><label>新增模型 ID<input value={newModel.id} onChange={event => setNewModel(previous => ({ ...previous, id: event.target.value }))} /></label><label>新增模型名称<input value={newModel.name} onChange={event => setNewModel(previous => ({ ...previous, name: event.target.value }))} /></label>
            <button type="button" onClick={() => {
              const model = { id: newModel.id.trim(), name: newModel.name.trim() };
              if (!model.id || !model.name || draft.customModels.some(value => value.id === model.id)) { setError('模型 ID 和名称不能为空，ID 不能重复。'); return; }
              change('customModels', [...draft.customModels, model]); setNewModel({ id: '', name: '' });
            }}>添加自定义模型</button>
          </div>
        </div>}
        <div className="settings-actions"><button type="submit" className="settings-primary">保存配置</button>{saved && <button type="button" onClick={() => { clearSecret(); setDraft(toDraft(saved)); setTargetConfirmed(false); setError(''); setNotice(''); setDeleting(null); }}>取消更改</button>}{saved && <button type="button" onClick={() => { clearSecret(); setDeleting('provider'); }}>删除 Provider</button>}</div>
      </fieldset>
    </form>
    {saved && <section className="settings-section" aria-labelledby="settings-key-title"><h3 id="settings-key-title">API Key</h3>
      {draft.kind === 'mock' ? <p>Mock 不使用端点或 API Key。</p> : <>
        <p>{keyState?.state === 'configured' ? '已配置；系统安全存储。' : keyState?.state === 'session' ? '本次会话有效；退出后需重新输入 Key。' : keyState?.state === 'unavailable' ? '已保存的 Key 当前无法读取；请重新输入。' : keyState?.state === 'missing' ? '未配置 Key。' : 'Key 状态尚未加载。'}</p>
        <p>{currentStorage?.mode === 'secure' ? '密钥将使用系统安全存储持久化。' : currentStorage?.mode === 'memory' ? '当前系统没有可靠的安全存储，密钥仅在本次会话有效。' : '安全存储状态未知；请重新加载。'}</p>
        <form onSubmit={saveKey}><label>API Key<input ref={bindSecret} type="password" autoComplete="off" spellCheck={false} onChange={event => setHasSecret(event.target.value.length > 0)} onBlur={clearSecret} disabled={!canUseSaved || !targetReady} aria-describedby="settings-key-help" /></label>
          <p id="settings-key-help">输入后按 Enter 保存或替换；离开输入框会清除输入。Key 不回显，保存后立即清除表单。</p>
          <div className="settings-actions"><button type="submit" disabled={!canUseSaved || !targetReady || !hasSecret} onMouseDown={event => event.preventDefault()}>保存或替换 Key</button><button type="button" onClick={clearSecret}>清除输入</button><button type="button" disabled={!canUseSaved || !keyState || keyState.state === 'missing'} onClick={() => { clearSecret(); setDeleting('key'); }}>删除 Key</button></div>
        </form>
      </>}
    </section>}
    {saved && <section className="settings-section" aria-labelledby="settings-tests-title"><h3 id="settings-tests-title">分级检查与测试</h3>
      <p>配置检查仅校验本地设置。获取模型列表、鉴权与真实生成相互独立；未知目标能力、模型计数或预算会拒绝生成。</p>
      {dirty && <p className="settings-warning">先保存或取消配置更改，再操作 Key 或运行检查。</p>}
      {!targetReady && <p className="settings-warning">请先勾选“我已核对请求目标”。</p>}
      {!saved.enabled && <p className="settings-warning">当前 Provider 已禁用；配置检查会报告不可用。</p>}
      <div className="settings-actions"><button type="button" disabled={!canUseSaved} onClick={() => test('configuration')}>检查配置</button><button type="button" disabled={!canUseSaved || !targetReady} onClick={listModels}>获取模型列表</button><button type="button" disabled={!canUseSaved || !targetReady} onClick={() => test('authentication')}>测试鉴权</button></div>
      <label>生成测试模型 ID<input value={generationModel} onChange={event => { setGenerationModel(event.target.value); setGenerationConfirmed(false); }} disabled={!canUseSaved} /></label>
      <label className="settings-check"><input type="checkbox" checked={generationConfirmed} onChange={event => setGenerationConfirmed(event.target.checked)} disabled={!canUseSaved} />我确认本次生成测试可能产生费用</label>
      <button type="button" disabled={!canUseSaved || !targetReady || !generationConfirmed || !generationModel.trim()} onClick={() => test('generation')}>发起生成测试</button>
      <div aria-live="polite">{results.configuration && <p>配置检查：{results.configuration}</p>}{listResult && <p>{listResult}</p>}{listedModels && <ul>{listedModels.map(model => <li key={model.id}>{model.name} · {model.id}</li>)}</ul>}{results.authentication && <p>鉴权测试：{results.authentication}</p>}{results.generation && <p>生成测试：{results.generation}</p>}</div>
    </section>}
    {deletionConfirmation}
  </div>;
}
