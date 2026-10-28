import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, FlaskConical, Info, Lock, Plus, Trash2, X } from 'lucide-react';
import type { ProviderConfiguration, ProviderKeyState, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema } from '../../../shared/schemas/configuration';
import { Button, Field, IconButton, Pill, Switch, Tag, cx } from '../../components/ui';
import { presetOf, targetOf } from './presets';
import { errorMessage, modelBlockText, modelIdProblem, serviceStatus, shortDate } from './model';

type Props = {
  api: ProviderSettingsApiContract; providers: readonly ProviderSummary[]; loadState: 'loading' | 'ready' | 'error';
  readiness: ProviderReadiness[] | undefined; onChanged: () => void; onAdd: () => void; onRekey: (provider: ProviderConfiguration) => void;
};

/** 设置 › 模型服务: one card per service, its status at a glance, details and the dangerous actions folded away. */
export function ServicesPanel({ api, providers, loadState, readiness, onChanged, onAdd, onRekey }: Props) {
  const [open, setOpen] = useState<string | undefined>(() => providers.find(provider => provider.kind !== 'mock')?.id);
  // A service connected while this page is open (or loaded after it) shows its details without another click.
  const known = useRef(new Set(providers.map(provider => provider.id)));
  useEffect(() => {
    const added = providers.find(provider => !known.current.has(provider.id) && provider.kind !== 'mock');
    for (const provider of providers) known.current.add(provider.id);
    if (added) setOpen(added.id); else if (open === undefined) setOpen(providers.find(provider => provider.kind !== 'mock')?.id);
  }, [providers]);
  return <>
    <div className="page-head"><div className="grow"><h1>模型服务</h1><p>成员用哪个服务、哪个模型，在房间里为每位成员选。这里管理连接和 Key。</p></div>
      <div className="actions"><Button variant="primary" icon={Plus} onClick={onAdd}>添加服务</Button></div></div>
    {loadState === 'loading' && providers.length === 0 && <p role="status" className="muted">正在读取…</p>}
    {loadState === 'error' && <p role="alert" className="field-error">服务列表没有读出来，请稍后重试。<button type="button" className="link-btn" onClick={onChanged}>重试</button></p>}
    {loadState === 'ready' && providers.length === 0 && <div className="card"><div className="card-row"><span className="grow"><b>还没有服务</b><small>点「添加服务」，选 DeepSeek 并粘贴 Key，就能开始真实的讨论。</small></span></div></div>}
    {providers.map(provider => <ServiceCard key={provider.id} api={api} summary={provider} readiness={readiness?.find(row => row.providerId === provider.id)}
      expanded={open === provider.id} onToggle={() => setOpen(value => value === provider.id ? undefined : provider.id)} onChanged={onChanged} onRekey={onRekey} />)}
  </>;
}

function ServiceCard({ api, summary, readiness, expanded, onToggle, onChanged, onRekey }: {
  api: ProviderSettingsApiContract; summary: ProviderSummary; readiness: ProviderReadiness | undefined; expanded: boolean; onToggle: () => void; onChanged: () => void; onRekey: (provider: ProviderConfiguration) => void;
}) {
  const [config, setConfig] = useState<ProviderConfiguration>(); const [loadFailed, setLoadFailed] = useState(false);
  const [keyState, setKeyState] = useState<ProviderKeyState>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [check, setCheck] = useState<{ tone: 'ok' | 'warn' | 'info'; text: string; at: string }>();
  const [trial, setTrial] = useState<{ tone: 'ok' | 'warn'; text: string }>();
  const [adding, setAdding] = useState<'manual' | 'listed'>(); const [newModel, setNewModel] = useState('');
  const [listed, setListed] = useState<Array<{ id: string; name: string }>>();
  const [draft, setDraft] = useState<{ name: string; baseUrl: string }>({ name: summary.name, baseUrl: '' });
  const [confirming, setConfirming] = useState<'key' | 'service'>();
  const alive = useRef(true); const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    try { const value = await api.getProviderConfiguration({ id: summary.id }); if (alive.current) { setConfig(value); setDraft({ name: value.name, baseUrl: value.baseUrl ?? '' }); setLoadFailed(false); } }
    catch { if (alive.current) setLoadFailed(true); }
    // Main's own Key state, used when readiness is unavailable; it never contains the Key.
    if (summary.kind !== 'mock') try { const state = await api.getProviderKeyState({ providerId: summary.id }); if (alive.current) setKeyState(state); } catch { /* readiness still speaks for it */ }
  }, [api, summary.id]);
  useEffect(() => { if (expanded) void load(); }, [expanded, load, summary]);

  async function act(work: () => Promise<string | void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try { const done = await work(); if (alive.current && done) setNotice(done); }
    catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const save = (next: Partial<ProviderConfiguration>, done: string) => act(async () => {
    if (!config) return;
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, withheldModelIds: _withheld, ...input } = { ...config, ...next };
    const value = await api.updateProvider(input);
    if (!alive.current) return;
    setConfig(value); setDraft({ name: value.name, baseUrl: value.baseUrl ?? '' }); onChanged(); return done;
  });

  const status = serviceStatus(summary, readiness);
  const preset = presetOf({ kind: summary.kind, baseUrl: config?.baseUrl });
  const mock = summary.kind === 'mock';
  const target = config ? targetOf(config) : null;
  const userAddress = summary.kind === 'openai-compatible' && config && !presetOf(config);
  const keyNow = readiness?.keyState ?? keyState?.state;
  const keySaved = keyNow === 'configured' || keyNow === 'session';
  const models = config ? [...new Map([...(config.defaultModelId ? [{ id: config.defaultModelId, name: config.customModels.find(model => model.id === config.defaultModelId)?.name ?? config.defaultModelId }] : []), ...config.customModels].map(model => [model.id, model])).values()] : [];
  const pendingAddress = Boolean(userAddress) && draft.baseUrl.trim() !== (config?.baseUrl ?? '');
  const typedAddress = userAddress && pendingAddress ? providerBaseUrlSchema.safeParse(draft.baseUrl) : undefined;
  const subline = mock ? status.detail : [models.length ? `${models.length} 个模型` : undefined,
    keySaved ? keyNow === 'session' ? 'Key 只在这次运行有效' : 'Key 在钥匙串' : undefined, status.detail || undefined].filter(Boolean).join(' · ');

  function runCheck() {
    if (!config) return;
    void act(async () => {
      const configuration = (await api.testConnection({ providerId: config.id, level: 'configuration' })).result;
      const at = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      if (!configuration.ok) { setCheck({ tone: 'warn', text: `配置有问题：${errorMessage(configuration.error)}`, at }); return; }
      if (mock) { setCheck({ tone: 'ok', text: '演示服务可以使用', at }); return; }
      const auth = (await api.testConnection({ providerId: config.id, level: 'authentication' })).result;
      if (!alive.current) return;
      setCheck(auth.ok ? { tone: 'ok', text: 'Key 有效', at }
        : auth.error.code === 'unsupported' ? { tone: 'info', text: '地址和配置没问题；这个服务没有免费检查 Key 的接口，可以试发一条确认', at }
          : { tone: 'warn', text: errorMessage(auth.error), at });
    });
  }
  function tryGeneration() {
    const model = readiness?.models.find(item => item.usable);
    if (!config || !model) return;
    void act(async () => {
      const result = (await api.testConnection({ providerId: config.id, level: 'generation', modelId: model.modelId, ...(mock ? {} : { allowGeneration: true }) })).result;
      if (alive.current) setTrial(result.ok ? { tone: 'ok', text: '已收到回复，可以生成' } : { tone: 'warn', text: errorMessage(result.error) });
    });
  }
  function addModel(id: string, name = id) {
    const value = id.trim();
    const problem = modelIdProblem(value);
    if (problem) { setError(problem); return; }
    if (!value || !config || models.some(model => model.id === value)) { setError(value ? '这个模型已经在列表里了。' : '请填写模型名。'); return; }
    void save({ customModels: [...config.customModels, { id: value, name: name.trim() || value }], defaultModelId: config.defaultModelId ?? value }, `已添加 ${value}`).then(() => { if (alive.current) { setNewModel(''); setAdding(undefined); setListed(undefined); } });
  }
  function fetchList() {
    if (!config) return;
    setAdding('listed');
    void act(async () => {
      const result = await api.listModels({ providerId: config.id });
      if (alive.current) setListed(result.models);
      return result.models.length ? undefined : '服务商没有返回模型；可以手动添加。';
    });
  }
  function confirmAddress() {
    if (!config || !target) return;
    void act(async () => { await api.confirmTarget({ providerId: config.id, baseUrl: target, confirmed: true }); onChanged(); return '地址已确认，之后不再询问；更换 Key 或地址时会再请你确认。'; });
  }
  function remove() {
    const which = confirming;
    if (!config && which !== 'service') return;
    void act(async () => {
      if (which === 'key') { await api.deleteKey({ providerId: summary.id }); setConfirming(undefined); onChanged(); void load(); return 'Key 已删除。'; }
      await api.deleteProvider({ id: summary.id }); onChanged();
    });
  }

  return <section className="card svc-card" aria-label={summary.name}>
    <div className="card-row svc-head">
      <span className="svc-logo" aria-hidden>{mock ? <FlaskConical /> : preset?.logo ?? summary.name.slice(0, 2)}</span>
      <div className="grow"><b>{summary.name}</b> <Pill tone={status.tone === 'ok' ? 'ok' : status.tone === 'warn' ? 'warn' : status.tone === 'danger' ? 'danger' : 'neutral'} icon={status.tone === 'ok' ? Check : undefined}>{status.label}</Pill>
        {summary.isDefault && <Tag tone="accent">默认服务</Tag>}<small>{subline}</small></div>
      {!expanded && status.label === '还没填写 Key' && <Button size="sm" onClick={onToggle}>填写 Key</Button>}
      <IconButton icon={expanded ? ChevronDown : ChevronRight} label={expanded ? `收起 ${summary.name}` : `展开 ${summary.name}`} aria-expanded={expanded} onClick={onToggle} />
    </div>
    {expanded && <div className="svc-body" aria-busy={busy}>
      {loadFailed && <p role="alert" className="field-error svc-pad">这个服务的配置读不出来。<button type="button" className="link-btn" onClick={() => void load()}>重试</button></p>}
      {config?.withheldModelIds && <div className="callout is-danger svc-pad-callout"><CircleAlert aria-hidden /><span className="grow">之前保存的模型名里有看起来像 API Key 的内容，已经隐藏，不会显示也不会使用。请重新添加正确的模型名。这把 Key 曾以明文存在本机数据库里，建议到服务商控制台更换。</span></div>}
      {config && !mock && <dl className="kv">
        <dt>请求地址</dt><dd><code className="mono-inline">{target ?? '未填写'}</code>{readiness?.targetConfirmed ? <span className="small muted"> · {userAddress ? '你填写的地址' : '官方地址'}，保存 Key 时已确认</span> : null}</dd>
        <dt>API Key</dt><dd>{keySaved ? <>已保存（不显示）{keyNow === 'session' && <span className="small muted"> · 只在这次运行有效</span>} <button type="button" className="link-btn" onClick={() => onRekey(config)}>更换</button></>
          : keyNow === 'unavailable' ? <>读不出来 <button type="button" className="link-btn" onClick={() => onRekey(config)}>重新填写</button></>
            : <>还没填写 <Button size="sm" variant="primary" onClick={() => onRekey(config)}>填写 Key</Button></>}</dd>
      </dl>}
      {config && !mock && keySaved && readiness && !readiness.targetConfirmed && target && <div className="target svc-pad-callout" role="note"><Lock aria-hidden /><span className="grow">这把 Key 只会发往 <code>{target}</code>。确认一次，之后启动不再询问；更换 Key 或地址时会再请你确认。</span>
        <Button size="sm" variant="primary" disabled={busy} onClick={confirmAddress}>确认地址</Button></div>}
      {config && !mock && <div className="svc-models">
        {models.map(model => {
          const state = readiness?.models.find(item => item.modelId === model.id);
          return <div className="model-row" key={model.id}><b>{model.name}</b><code>{model.id}</code>{config.defaultModelId === model.id && <Tag tone="accent">默认</Tag>}
            <span className="push small muted">{state?.price === 'reviewed' ? `价格已核对 · ${shortDate(state.priceReviewedAt)}` : '价格尚未审核 · 暂时不能用于讨论'}</span>
            {config.defaultModelId !== model.id && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void save({ defaultModelId: model.id }, `默认模型改为 ${model.name}`)}>设为默认</Button>}
            {config.defaultModelId !== model.id && <IconButton size="sm" icon={X} label={`移除 ${model.name}`} disabled={busy} onClick={() => void save({ customModels: config.customModels.filter(item => item.id !== model.id) }, `已移除 ${model.name}`)} />}
            {state && !state.usable && state.blockedBy !== 'price' && <span className="sr-only">{modelBlockText(state)}</span>}
          </div>;
        })}
        <div className="model-row">
          {adding === 'manual' ? <form className="inline-fields grow-form" onSubmit={event => { event.preventDefault(); addModel(newModel); }}>
            <input className="input mono" aria-label="模型名" placeholder="照服务商文档填写，例如 deepseek-flash" value={newModel} autoFocus autoComplete="off" spellCheck={false}
              aria-invalid={Boolean(modelIdProblem(newModel)) || undefined} onChange={event => { setNewModel(event.target.value); setError(''); }} />
            <Button size="sm" type="submit" variant="primary" disabled={busy || !newModel.trim()}>添加</Button><Button size="sm" variant="quiet" onClick={() => { setAdding(undefined); setNewModel(''); }}>取消</Button>
          </form> : <>
            <Button size="sm" variant="quiet" icon={Plus} disabled={busy} onClick={() => setAdding('manual')}>手动添加模型</Button>
            {(summary.kind === 'openai' || summary.kind === 'anthropic' || summary.kind === 'gemini' || userAddress) && <Button size="sm" variant="quiet" disabled={busy || !readiness?.targetConfirmed} title={readiness?.targetConfirmed ? '向服务商要一份模型列表；不生成内容' : '先填写 Key 并确认地址'} onClick={fetchList}>从服务商获取列表</Button>}
            <span className="small muted">名字照服务商文档填写；列表里没有的也可以手动加。</span></>}
        </div>
        {modelIdProblem(newModel) && <p className="field-error svc-pad" role="alert">{modelIdProblem(newModel)}</p>}
        {adding === 'listed' && listed && listed.length > 0 && <div className="svc-listed"><p className="small muted">服务商返回的模型（列在这里不代表价格已审核、可以用于讨论）：</p>
          <ul>{listed.filter(model => !models.some(item => item.id === model.id)).slice(0, 60).map(model => <li key={model.id}><code>{model.id}</code><Button size="sm" variant="quiet" disabled={busy} onClick={() => addModel(model.id, model.name)}>添加</Button></li>)}</ul>
          <Button size="sm" variant="quiet" onClick={() => { setAdding(undefined); setListed(undefined); }}>收起</Button></div>}
      </div>}
      {config && <div className="model-row svc-checks">
        <Button size="sm" disabled={busy || !config.enabled} onClick={runCheck}>检查连接</Button><span className="small muted">免费，不生成内容</span>
        {readiness?.models.some(item => item.usable) && <><Button size="sm" disabled={busy} onClick={tryGeneration}>试发一条</Button><span className="small muted">{mock ? '演示，不花钱' : '约 ¥0.0001，不计入用量页'}</span></>}
        <span className="push" role="status" aria-live="polite">
          {check && <span className={cx('status-text', check.tone === 'ok' ? 'ok-text' : check.tone === 'warn' ? 'warn-text' : 'muted')}>{check.tone === 'ok' ? <Check aria-hidden /> : check.tone === 'warn' ? <CircleAlert aria-hidden /> : <Info aria-hidden />}上次检查：{check.text} · {check.at}</span>}
          {trial && <span className={cx('status-text', trial.tone === 'ok' ? 'ok-text' : 'warn-text')}> 试发：{trial.text}</span>}</span>
      </div>}
      {notice && <p role="status" className="ok-text small svc-pad">{notice}</p>}
      {error && <p role="alert" className="field-error svc-pad">{error}</p>}
      {(config || loadFailed) && <details className="adv svc-adv"><summary>高级与删除</summary><div className="form-stack">
        {config && <>
          <div className="form-grid">
            <Field label="服务名称">{props => <input {...props} className="input" value={draft.name} disabled={busy} onChange={event => setDraft(value => ({ ...value, name: event.target.value }))} />}</Field>
            {userAddress && <Field label="请求地址" error={typedAddress && !typedAddress.success ? '地址必须以 https:// 开头（本机服务可以用 http://localhost），不能带账号、问号参数或 # 片段。' : undefined}
              help="一般不用改。改了地址，已保存的 Key 会被删除，需要重新填写，防止 Key 被发到别处。">
              {props => <input {...props} className="input mono" value={draft.baseUrl} disabled={busy} autoComplete="off" spellCheck={false} aria-invalid={typedAddress && !typedAddress.success || undefined}
                onChange={event => setDraft(value => ({ ...value, baseUrl: event.target.value }))} />}</Field>}
          </div>
          <div className="inline-fields"><Button size="sm" disabled={busy || !draft.name.trim() || (draft.name === config.name && !pendingAddress) || typedAddress && !typedAddress.success}
            onClick={() => void save({ name: draft.name.trim(), ...(userAddress && pendingAddress ? { baseUrl: draft.baseUrl.trim() } : {}) }, pendingAddress ? '地址已更改；原来的 Key 已删除，请重新填写。' : '已保存。')}>{pendingAddress ? '保存（会删除已保存的 Key）' : '保存名称'}</Button></div>
          <div className="card-row svc-switch"><span className="grow"><b>启用这个服务</b><small>停用后不会发送任何请求，成员也不能选用它。</small></span>
            <Switch label="启用这个服务" checked={config.enabled} disabled={busy} onChange={value => void save({ enabled: value, ...(value ? {} : { isDefault: false }) }, value ? '已启用。' : '已停用。')} /></div>
          {!mock && <div className="card-row svc-switch"><span className="grow"><b>设为默认服务</b><small>新房间的成员默认用它的默认模型；已有成员的选择不变。</small></span>
            <Switch label="设为默认服务" checked={config.isDefault} disabled={busy || !config.enabled} onChange={value => void save({ isDefault: value }, value ? '已设为默认服务。' : '已取消默认。')} /></div>}
        </>}
        {!mock && config && <div className="danger-zone"><div className="grow"><b>删除 Key</b><small>删除后这个服务不能再发请求，直到重新填写；地址确认也会一起作废。</small></div>
          {confirming === 'key' ? <><Button size="sm" variant="danger" solid disabled={busy} onClick={remove}>确认删除 Key</Button><Button size="sm" disabled={busy} onClick={() => setConfirming(undefined)}>不删除</Button></>
            : <Button size="sm" variant="danger" icon={Trash2} disabled={busy || !keySaved && keyNow !== 'unavailable'} onClick={() => setConfirming('key')}>删除 Key…</Button>}</div>}
        <div className="danger-zone"><div className="grow"><b>删除这个服务</b><small>不可撤销。还有成员在用它、或已有讨论记录用过它时不能删除：先给这些成员改选模型；有记录的服务可以停用。</small></div>
          {confirming === 'service' ? <><Button size="sm" variant="danger" solid disabled={busy} onClick={remove}>确认删除服务</Button><Button size="sm" disabled={busy} onClick={() => setConfirming(undefined)}>不删除</Button></>
            : <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirming('service')}>删除服务…</Button>}</div>
      </div></details>}
    </div>}
  </section>;
}
