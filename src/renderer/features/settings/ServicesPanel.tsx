import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, CircleAlert, FlaskConical, Plus, SlidersHorizontal, Trash2 } from 'lucide-react';
import type { ProviderConfiguration, ProviderKeyState, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS, DEFAULT_MODEL_MAX_OUTPUT_TOKENS, MAX_MODEL_LIMIT_TOKENS, MIN_MODEL_CONTEXT_WINDOW_TOKENS } from '../../../shared/schemas/provider';
import { Button, Field, IconButton, Pill, Switch, Tag, cx } from '../../components/ui';
import { presetOf, targetOf } from './presets';
import { errorMessage, modelBlockText, serviceStatus, testService, type ServiceTest } from './model';

/** D134: why these limits cannot be saved; Main's schema refuses the same values. */
function limitsError({ context, output }: { context: string; output: string }): string | undefined {
  const whole = (text: string) => /^\d{1,9}$/u.test(text.trim()) ? Number(text.trim()) : undefined;
  const window = whole(context); const max = whole(output);
  if (window === undefined || window < MIN_MODEL_CONTEXT_WINDOW_TOKENS || window > MAX_MODEL_LIMIT_TOKENS) return `上下文长度请输入 ${MIN_MODEL_CONTEXT_WINDOW_TOKENS} 到 ${MAX_MODEL_LIMIT_TOKENS} 之间的整数。`;
  if (max === undefined || max < 1) return '最大输出请输入正整数。';
  return max > window ? '最大输出不能超过上下文长度。' : undefined;
}

type Props = {
  api: ProviderSettingsApiContract; providers: readonly ProviderSummary[]; loadState: 'loading' | 'ready' | 'error';
  readiness: ProviderReadiness[] | undefined; onChanged: () => void; onAdd: () => void; onRekey: (provider: ProviderConfiguration) => void;
};

/** 设置 › 模型服务: one card per service, its status at a glance, details and the dangerous actions folded away. */
export function ServicesPanel({ api, providers, loadState, readiness, onChanged, onAdd, onRekey }: Props) {
  const [open, setOpen] = useState<string | undefined>(() => providers.find(provider => provider.kind !== 'mock' && provider.enabled)?.id);
  // A service connected while this page is open (or loaded after it) shows its details without another click.
  const known = useRef(new Set(providers.map(provider => provider.id)));
  useEffect(() => {
    const added = providers.find(provider => !known.current.has(provider.id) && provider.kind !== 'mock');
    for (const provider of providers) known.current.add(provider.id);
    if (added) setOpen(added.id); else if (open === undefined) setOpen(providers.find(provider => provider.kind !== 'mock' && provider.enabled)?.id);
  }, [providers]);
  return <>
    <div className="page-head"><div className="grow"><h1>模型服务</h1><p>成员用哪个服务、哪个模型，在房间里为每位成员选。这里管理连接和 Key。</p></div>
      <div className="actions"><Button variant="primary" icon={Plus} onClick={onAdd}>添加服务</Button></div></div>
    {loadState === 'loading' && providers.length === 0 && <p role="status" className="muted">正在读取…</p>}
    {loadState === 'error' && <p role="alert" className="field-error">服务列表没有读出来，请稍后重试。<button type="button" className="link-btn" onClick={onChanged}>重试</button></p>}
    {loadState === 'ready' && providers.length === 0 && <div className="card"><div className="card-row"><span className="grow"><b>还没有服务</b><small>点「添加服务」，选 DeepSeek 并粘贴 Key，就能开始真实的讨论。</small></span></div></div>}
    {[...providers].sort((a, b) => Number(b.enabled) - Number(a.enabled)).map(provider => <ServiceCard key={provider.id} api={api} summary={provider} readiness={readiness?.find(row => row.providerId === provider.id)}
      expanded={open === provider.id} onToggle={() => setOpen(value => value === provider.id ? undefined : provider.id)} onChanged={onChanged} onRekey={onRekey} />)}
  </>;
}

function ServiceCard({ api, summary, readiness, expanded, onToggle, onChanged, onRekey }: {
  api: ProviderSettingsApiContract; summary: ProviderSummary; readiness: ProviderReadiness | undefined; expanded: boolean; onToggle: () => void; onChanged: () => void; onRekey: (provider: ProviderConfiguration) => void;
}) {
  const [config, setConfig] = useState<ProviderConfiguration>(); const [loadFailed, setLoadFailed] = useState(false);
  const [keyState, setKeyState] = useState<ProviderKeyState>();
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [check, setCheck] = useState<ServiceTest & { at: string }>();
  const [draft, setDraft] = useState<{ name: string }>({ name: summary.name });
  const [limitsOf, setLimitsOf] = useState<string>(); const [limitsDraft, setLimitsDraft] = useState<{ context: string; output: string }>();
  const [confirming, setConfirming] = useState<'key' | 'service'>();
  const alive = useRef(true); const lock = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const load = useCallback(async () => {
    try { const value = await api.getProviderConfiguration({ id: summary.id }); if (alive.current) { setConfig(value); setDraft({ name: value.name }); setLoadFailed(false); } }
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
    setConfig(value); setDraft({ name: value.name }); onChanged(); return done;
  });

  const status = serviceStatus(summary, readiness);
  const preset = presetOf({ kind: summary.kind, baseUrl: config?.baseUrl ?? readiness?.baseUrl });
  const mock = summary.kind === 'mock';
  const target = config ? targetOf(config) : null;
  // D143: a service outside the catalog stays only for its history: it can be renamed or removed, with its Key.
  const outside = readiness?.supported === false;
  const keyNow = readiness?.keyState ?? keyState?.state;
  const keySaved = keyNow === 'configured' || keyNow === 'session';
  const models = config ? [...new Map([...(config.defaultModelId ? [{ id: config.defaultModelId, name: config.customModels.find(model => model.id === config.defaultModelId)?.name ?? config.defaultModelId }] : []), ...config.customModels].map(model => [model.id, model])).values()] : [];
  const modelCount = readiness?.models.length ?? models.length;
  const subline = mock || outside ? status.detail : [modelCount ? `${modelCount} 个模型` : undefined,
    keySaved ? keyNow === 'session' ? 'Key 只在这次运行有效' : 'Key 在钥匙串' : undefined, status.detail || undefined].filter(Boolean).join(' · ');

  function runCheck() {
    if (!config) return;
    void act(async () => {
      const at = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
      const configuration = (await api.testConnection({ providerId: config.id, level: 'configuration' })).result;
      if (!configuration.ok) { if (alive.current) setCheck({ tone: 'warn', text: `配置有问题：${errorMessage(configuration.error)}`, at }); return; }
      const result = await testService(api, config, config.defaultModelId ?? config.customModels[0]?.id);
      if (alive.current) setCheck({ ...result, at });
    });
  }
  function openLimits(id: string, state: { contextWindowTokens: number; maxOutputTokens: number } | undefined) {
    if (limitsOf === id) { setLimitsOf(undefined); return; }
    setLimitsOf(id); setLimitsDraft({ context: String(state?.contextWindowTokens ?? DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS), output: String(state?.maxOutputTokens ?? DEFAULT_MODEL_MAX_OUTPUT_TOKENS) });
  }
  const limitsProblem = limitsDraft ? limitsError(limitsDraft) : undefined;
  /** D134: limits live on the model's entry; a default model without an entry gets one here. */
  function saveLimits(model: { id: string; name: string }, reset = false) {
    if (!config || !limitsDraft || !reset && limitsProblem) return;
    const { contextWindowTokens: _context, maxOutputTokens: _output, ...plain } = config.customModels.find(item => item.id === model.id) ?? { id: model.id, name: model.name };
    const next = reset ? plain : { ...plain, contextWindowTokens: Number(limitsDraft.context), maxOutputTokens: Number(limitsDraft.output) };
    const others = config.customModels.filter(item => item.id !== model.id);
    void save({ customModels: config.customModels.some(item => item.id === model.id) ? config.customModels.map(item => item.id === model.id ? next : item) : [...others, next] },
      reset ? `${model.name} 已恢复默认上限。` : `${model.name} 的上限已保存。`).then(() => { if (alive.current) setLimitsOf(undefined); });
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
      {config?.withheldModelIds && <div className="callout is-danger svc-pad-callout"><CircleAlert aria-hidden /><span className="grow">之前保存的模型名里有看起来像 API Key 的内容，已经隐藏，不会显示也不会使用。请重新选择模型。这把 Key 曾以明文存在本机数据库里，建议到服务商控制台更换。</span></div>}
      {config && !mock && <dl className="kv">
        <dt>请求地址</dt><dd><code className="mono-inline">{target ?? '未填写'}</code>{target && !outside && <span className="small muted"> · 官方地址</span>}</dd>
        <dt>API Key</dt><dd>{outside ? keySaved ? '已保存（不显示，也不再使用）' : '没有保存'
          : keySaved ? <>已保存（不显示）{keyNow === 'session' && <span className="small muted"> · 只在这次运行有效</span>} <button type="button" className="link-btn" onClick={() => onRekey(config)}>更换</button></>
          : keyNow === 'unavailable' ? <>读不出来 <button type="button" className="link-btn" onClick={() => onRekey(config)}>重新填写</button></>
            : <>还没填写 <Button size="sm" variant="primary" onClick={() => onRekey(config)}>填写 Key</Button></>}</dd>
      </dl>}
      {config && !mock && !outside && <div className="svc-models">
        {models.map(model => {
          const state = readiness?.models.find(item => item.modelId === model.id);
          return <div className="model-row" key={model.id}><span className="model-name"><b>{model.name}{config.defaultModelId === model.id && <Tag tone="accent">默认</Tag>}</b><code>{model.id}</code></span>
            <span className="push small muted tabular">{state ? `上下文 ${state.contextWindowTokens.toLocaleString('zh-CN')} · 最大输出 ${state.maxOutputTokens.toLocaleString('zh-CN')}` : ''}</span>
            <IconButton size="sm" icon={SlidersHorizontal} label={`${model.name} 的上限`} aria-expanded={limitsOf === model.id} disabled={busy || !state} onClick={() => openLimits(model.id, state)} />
            {config.defaultModelId !== model.id && <Button size="sm" variant="quiet" disabled={busy} onClick={() => void save({ defaultModelId: model.id }, `默认模型改为 ${model.name}`)}>设为默认</Button>}
            {state && !state.usable && <span className="sr-only">{modelBlockText(state)}</span>}
            {limitsOf === model.id && limitsDraft && <form className="model-limits" aria-label={`${model.name} 的上限`} onSubmit={event => { event.preventDefault(); saveLimits(model); }}>
              <label className="field"><span>上下文长度</span><input className="input" inputMode="numeric" aria-label="上下文长度（token）" value={limitsDraft.context} aria-invalid={limitsProblem !== undefined} onChange={event => setLimitsDraft({ ...limitsDraft, context: event.target.value })} /></label>
              <label className="field"><span>最大输出</span><input className="input" inputMode="numeric" aria-label="最大输出（token）" value={limitsDraft.output} aria-invalid={limitsProblem !== undefined} onChange={event => setLimitsDraft({ ...limitsDraft, output: event.target.value })} /></label>
              <p className="small muted">照服务商文档填写。默认 {DEFAULT_MODEL_CONTEXT_WINDOW_TOKENS.toLocaleString('zh-CN')} / {DEFAULT_MODEL_MAX_OUTPUT_TOKENS.toLocaleString('zh-CN')}，比多数模型的真实上限保守：讨论放不下时会提示生成摘要，改大可以放下更多。</p>
              {limitsProblem && <p role="alert" className="field-error">{limitsProblem}</p>}
              <div className="inline-fields"><Button size="sm" type="submit" variant="primary" disabled={busy || limitsProblem !== undefined}>保存</Button>
                <Button size="sm" variant="quiet" disabled={busy} onClick={() => saveLimits(model, true)}>恢复默认</Button><Button size="sm" variant="quiet" onClick={() => setLimitsOf(undefined)}>取消</Button></div>
            </form>}
          </div>;
        })}
      </div>}
      {config && !outside && <div className="model-row svc-checks">
        <Button size="sm" disabled={busy || !config.enabled || !mock && !keySaved} onClick={runCheck}>测试连接</Button><span className="small muted">{mock ? '演示，不联网' : '可能产生极少的费用'}</span>
        <span className="push" role="status" aria-live="polite">
          {check && <span className={cx('status-text', check.tone === 'ok' ? 'ok-text' : 'warn-text')}>{check.tone === 'ok' ? <Check aria-hidden /> : <CircleAlert aria-hidden />}{check.text} · {check.at}</span>}</span>
      </div>}
      {notice && <p role="status" className="ok-text small svc-pad">{notice}</p>}
      {error && <p role="alert" className="field-error svc-pad">{error}</p>}
      {(config || loadFailed) && <details className="adv svc-adv" open={outside}><summary>{outside ? '删除' : '高级与删除'}</summary><div className="form-stack">
        {config && !outside && <>
          <Field label="服务名称">{props => <input {...props} className="input" value={draft.name} disabled={busy} onChange={event => setDraft({ name: event.target.value })} />}</Field>
          <div className="inline-fields"><Button size="sm" disabled={busy || !draft.name.trim() || draft.name === config.name} onClick={() => void save({ name: draft.name.trim() }, '已保存。')}>保存名称</Button></div>
          <div className="card-row svc-switch"><span className="grow"><b>启用这个服务</b><small>停用后不会发送任何请求，成员也不能选用它。</small></span>
            <Switch label="启用这个服务" checked={config.enabled} disabled={busy} onChange={value => void save({ enabled: value, ...(value ? {} : { isDefault: false }) }, value ? '已启用。' : '已停用。')} /></div>
          {!mock && <div className="card-row svc-switch"><span className="grow"><b>设为默认服务</b><small>新房间的成员默认用它的默认模型；已有成员的选择不变。</small></span>
            <Switch label="设为默认服务" checked={config.isDefault} disabled={busy || !config.enabled} onChange={value => void save({ isDefault: value }, value ? '已设为默认服务。' : '已取消默认。')} /></div>}
        </>}
        {!mock && config && (!outside || keySaved || keyNow === 'unavailable') && <div className="danger-zone"><div className="grow"><b>删除 Key</b><small>{outside ? '这个服务已不再使用，Key 留着也用不上。' : '删除后这个服务不能再发请求，直到重新填写。'}</small></div>
          {confirming === 'key' ? <><Button size="sm" variant="danger" solid disabled={busy} onClick={remove}>确认删除 Key</Button><Button size="sm" disabled={busy} onClick={() => setConfirming(undefined)}>不删除</Button></>
            : <Button size="sm" variant="danger" icon={Trash2} disabled={busy || !keySaved && keyNow !== 'unavailable'} onClick={() => setConfirming('key')}>删除 Key…</Button>}</div>}
        <div className="danger-zone"><div className="grow"><b>删除这个服务</b><small>{outside ? '不可撤销。还有成员在用它、或已有讨论记录用过它时不能删除，名称和记录会留着；Key 可以单独删除。' : '不可撤销。还有成员在用它、或已有讨论记录用过它时不能删除：先给这些成员改选模型；有记录的服务可以停用。'}</small></div>
          {confirming === 'service' ? <><Button size="sm" variant="danger" solid disabled={busy} onClick={remove}>确认删除服务</Button><Button size="sm" disabled={busy} onClick={() => setConfirming(undefined)}>不删除</Button></>
            : <Button size="sm" variant="danger" icon={Trash2} disabled={busy} onClick={() => setConfirming('service')}>删除服务…</Button>}</div>
      </div></details>}
    </div>}
  </section>;
}
