import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleAlert, FlaskConical, Info, Lock } from 'lucide-react';
import type { KeyStorageStatus, ProviderConfiguration, ProviderKind, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema } from '../../../shared/schemas/configuration';
import { Button, Choice, Field, Modal } from '../../components/ui';
import { interfaceTypes, presets, presetOf, targetOf, type ServicePreset } from './presets';
import { errorMessage, modelIdProblem, testService, type ServiceTest } from './model';

/** What the app did after a connection: the room it created for the first real service, if any. */
export type ConnectedRoom = { roomName: string; memberNames: string[]; modelName: string | null };
export type ConnectWizardProps = {
  api: ProviderSettingsApiContract; providers: readonly ProviderSummary[];
  /** Replace the Key of a saved service: the wizard opens on the Key with the service fixed. */
  rekey?: ProviderConfiguration;
  onClose: () => void;
  /** Called once the service is saved; may create the first room. */
  onConnected?: (input: { provider: ProviderConfiguration; firstReal: boolean; readiness: ProviderReadiness | undefined }) => Promise<ConnectedRoom | undefined>;
  /** The first real service goes straight to a discussion. */
  onStart?: () => void;
};

const storageText = (storage: KeyStorageStatus | null) => storage?.mode === 'memory'
  ? '这台电脑没有可靠的安全存储，Key 只在这次运行期间有效，退出后需要重新填写；'
  : '保存后存进系统钥匙串；';

/**
 * Connect a service (D136): pick one, paste the Key, pick a model, save. Saving is all it takes; the address the Key goes to
 * is written above it. 测试连接 is there for whoever wants it, and nothing waits for it.
 */
export function ConnectWizard({ api, providers, rekey, onClose, onConnected, onStart }: ConnectWizardProps) {
  const [picking, setPicking] = useState(!rekey);
  const [preset, setPreset] = useState<ServicePreset>(() => rekey ? presetOf(rekey) ?? presets.find(item => item.id === 'custom')! : presets[0]!);
  const [name, setName] = useState(() => rekey?.name ?? presets[0]!.name);
  const [address, setAddress] = useState('');
  const [kind, setKind] = useState<ProviderKind>('openai-compatible');
  const [modelId, setModelId] = useState(() => presets[0]!.models[0]?.id ?? '');
  const [extraModel, setExtraModel] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [storage, setStorage] = useState<KeyStorageStatus | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState<ProviderConfiguration | undefined>(rekey);
  const [test, setTest] = useState<ServiceTest>();
  const secret = useRef<HTMLInputElement>(null); const alive = useRef(true); const lock = useRef(false);
  const existingReal = useRef(providers.some(provider => provider.kind !== null && provider.kind !== 'mock'));
  const clearSecret = () => { if (secret.current) secret.current.value = ''; setHasKey(false); };
  useEffect(() => { alive.current = true; void api.getKeyStorageStatus().then(value => { if (alive.current) setStorage(value); }, () => {}); return () => { alive.current = false; clearSecret(); }; }, [api]);

  const custom = rekey ? !presetOf(rekey) : preset.id === 'custom';
  const mock = !rekey && preset.id === 'mock';
  const type = interfaceTypes.find(item => item.kind === kind)!;
  const typed = custom && !rekey && address.trim() ? providerBaseUrlSchema.safeParse(address) : undefined;
  const target = rekey ? targetOf(rekey) : custom ? (typed?.success ? typed.data.replace(/\/+$/u, '') : address.trim() ? null : targetOf({ kind, baseUrl: null })) : preset.baseUrl;
  const chosenModel = custom ? modelId.trim() : modelId;
  const modelProblem = modelIdProblem(chosenModel) ?? modelIdProblem(extraModel);
  const displayName = rekey?.name ?? (name.trim() || preset.name);

  function choose(next: ServicePreset) {
    setPreset(next); setName(next.id === 'custom' ? '' : next.name); setModelId(next.models[0]?.id ?? ''); setAddress(''); setKind('openai-compatible'); setExtraModel(''); setError(''); setTest(undefined);
    setPicking(false);
  }
  function close() { clearSecret(); onClose(); }
  function back() { clearSecret(); setError(''); setPicking(true); }

  async function guarded(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  /** Create (or, after a first attempt, update) the service; mock needs nothing else. */
  async function saveConfiguration(): Promise<ProviderConfiguration> {
    const models = mock ? [] : [...new Map([
      ...(custom ? [{ id: chosenModel, name: chosenModel }] : preset.models.map(model => ({ id: model.id, name: model.name }))),
      ...(extraModel.trim() ? [{ id: extraModel.trim(), name: extraModel.trim() }] : []),
    ].map(model => [model.id, model])).values()];
    const hasDefault = providers.some(provider => provider.isDefault && provider.enabled && provider.kind !== 'mock');
    const input = { name: displayName, kind: custom ? kind : preset.kind, baseUrl: mock ? null : custom ? (address.trim() || null) : preset.baseUrl,
      enabled: true, isDefault: !mock && !hasDefault, defaultModelId: mock ? 'mock' : chosenModel || null, customModels: models };
    const value = saved ? await api.updateProvider({ ...input, id: saved.id, isDefault: saved.isDefault }) : await api.createProvider(input);
    if (alive.current) setSaved(value);
    return value;
  }

  /** What 保存 and 测试连接 share: everything filled in is valid, and the Key typed so far is stored. */
  async function store(): Promise<ProviderConfiguration | undefined> {
    const apiKey = secret.current?.value ?? '';
    if (!mock && custom && !rekey && !name.trim()) { setError('请填写服务名称。'); return; }
    if (!mock && custom && !rekey && (!target || type.addressRequired && !address.trim())) { setError('先填写这个服务的地址，例如 https://api.example.com/v1。'); return; }
    if (!mock && !keySaved && apiKey.trim() === '') { setError('请粘贴 API Key。'); return; }
    if (!rekey && !mock && !chosenModel) { setError('请填写模型名，例如服务商文档里的模型 ID。'); return; }
    if (modelProblem) { setError(modelProblem); return; }
    clearSecret();
    const provider = rekey ?? await saveConfiguration();
    if (!mock && apiKey.trim()) { await api.setKey({ providerId: provider.id, apiKey }); if (alive.current) setKeySaved(true); }
    return provider;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void guarded(async () => {
      const provider = await store();
      if (!provider) return;
      let current: ProviderReadiness | undefined;
      try { current = (await api.listModelReadiness?.())?.find(row => row.providerId === provider.id); } catch { current = undefined; }
      const firstReal = provider.kind !== 'mock' && !existingReal.current && !rekey;
      if (!rekey && onConnected) {
        // A room that could not be made is a small thing: 新建房间 is one click away, and the service is saved.
        try { await onConnected({ provider, firstReal, readiness: current }); } catch { /* the sidebar still offers it */ }
      }
      if (!alive.current) return;
      close();
      if (firstReal) onStart?.();
    });
  }

  function runTest() {
    void guarded(async () => {
      const provider = await store();
      if (!provider) return;
      const result = await testService(api, provider, chosenModel || provider.defaultModelId || provider.customModels[0]?.id);
      if (alive.current) setTest(result);
    });
  }

  const title = picking ? '连接模型服务' : mock ? '添加演示服务' : rekey ? `更换 ${displayName} 的 API Key` : custom ? '添加自定义服务' : `连接 ${displayName}`;
  const description = picking ? '选一个你有账号的服务。之后可以在「设置 › 模型服务」里添加更多。'
    : mock ? '演示成员不联网，适合先熟悉怎么主持一场讨论。' : `费用由${custom ? '这个服务' : ` ${displayName} `}直接从你的账户收取；AI 圆桌不收费，也不估算费用。`;
  const footer = picking ? <><span className="is-left small muted">可以连接多个服务，让每位成员各用一家的模型，互相交叉审计。</span><Button onClick={close}>取消</Button></>
    : <>{!mock && <span className="is-left wizard-test"><Button size="sm" disabled={busy || (!hasKey && !keySaved)} onClick={runTest}>测试连接</Button>
      {test ? <span role="status" className={test.tone === 'ok' ? 'status-text ok-text' : 'status-text warn-text'}>{test.tone === 'ok' ? <Check aria-hidden /> : <CircleAlert aria-hidden />}{test.text}</span>
        : <span className="small muted">可能产生极少的费用</span>}</span>}
      {!rekey && !saved && <Button disabled={busy} onClick={back}>上一步</Button>}
      <Button variant="primary" type="submit" form="connect-form" disabled={busy || (!mock && !hasKey && !keySaved)}>{busy ? '正在保存…' : mock ? '添加演示服务' : '保存'}</Button></>;

  return <Modal title={title} description={description} onClose={close} busy={busy} wide footer={footer} className="wizard">
    {picking ? <div className="choice-grid" role="group" aria-label="服务">
      {presets.map(item => <Choice key={item.id} selected={false} onSelect={() => choose(item)} title={item.name}
        icon={<span className="svc-logo is-sm" aria-hidden>{item.id === 'mock' ? <FlaskConical /> : item.logo}</span>} badge={item.recommended ? '推荐' : undefined}>{item.description}</Choice>)}
    </div>
    : <form id="connect-form" className="form-stack" onSubmit={submit} onChange={() => { setError(''); setTest(undefined); }} noValidate>
      {custom && !rekey && <>
        <Field label="服务名称">{props => <input {...props} className="input" value={name} disabled={busy} autoFocus onChange={event => setName(event.target.value)} placeholder="例如：公司内部模型" />}</Field>
        <Field label="接口类型">{props => <select {...props} className="select input" value={kind} disabled={busy} onChange={event => setKind(event.target.value as ProviderKind)}>
          {interfaceTypes.map(item => <option key={item.kind} value={item.kind}>{item.label}</option>)}</select>}</Field>
        <Field label="地址" optional={!type.addressRequired} error={typed && !typed.success ? '地址必须以 https:// 开头（本机服务可以用 http://localhost），不能带账号、问号参数或 # 片段。' : undefined}
          help={type.addressRequired ? '照服务商文档填写，通常以 /v1 结尾。' : `照服务商文档填写；留空时用 ${targetOf({ kind, baseUrl: null })}。`}>
          {props => <input {...props} className="input mono" value={address} disabled={busy} onChange={event => setAddress(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false}
            aria-invalid={Boolean(typed && !typed.success) || undefined} />}</Field>
      </>}
      {!mock && target && <div className="target" role="note"><Lock aria-hidden /><span className="grow">Key 只会发往 <code>{target}</code></span></div>}
      {!mock && <Field label="API Key" help={`${rekey ? '' : preset.keyHelp}${storageText(storage)}不会出现在讨论记录、日志和导出文件里，也不会再显示出来。`}>
        {props => <input {...props} ref={secret} className="input mono" type="password" autoComplete="off" spellCheck={false} disabled={busy} autoFocus={!custom || Boolean(rekey)} placeholder={keySaved ? '已保存；要更换就重新粘贴' : undefined}
          onChange={event => setHasKey(event.target.value.length > 0)} />}</Field>}
      {mock && <div className="callout"><Info aria-hidden /><span className="grow">演示服务没有地址，也不需要 Key。演示成员的回复是预先写好的示例，不代表真实模型的水平，也不会出现在用量里。</span></div>}
      {!rekey && !mock && (custom
        ? <Field label="模型名" help="照服务商文档填写。">{props => <input {...props} className="input mono" value={modelId} disabled={busy} onChange={event => setModelId(event.target.value)} placeholder="服务商文档里的模型 ID" autoComplete="off" spellCheck={false} aria-invalid={Boolean(modelIdProblem(modelId)) || undefined} />}</Field>
        : <Field label="模型" help="每位成员可以单独换模型。">
          {props => <select {...props} className="select input" value={modelId} disabled={busy} onChange={event => setModelId(event.target.value)}>
            {preset.models.map(model => <option key={model.id} value={model.id}>{model.name}（{model.id}）{model.hint ? ` · ${model.hint}` : ''}</option>)}</select>}</Field>)}
      {!rekey && !mock && !custom && <details className="adv"><summary>更多：服务名称、其他模型</summary><div className="form-stack">
        <Field label="服务名称">{props => <input {...props} className="input" value={name} disabled={busy} onChange={event => setName(event.target.value)} />}</Field>
        <Field label="再加一个模型" optional help="名字照服务商文档填写；列表里没有的也可以以后在设置里加。">
          {props => <input {...props} className="input mono" value={extraModel} disabled={busy} onChange={event => setExtraModel(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={Boolean(modelIdProblem(extraModel)) || undefined} />}</Field>
      </div></details>}
      {modelProblem && <p className="field-error" role="alert">{modelProblem}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
  </Modal>;
}
