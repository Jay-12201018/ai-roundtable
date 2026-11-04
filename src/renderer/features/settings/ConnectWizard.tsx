import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleAlert, FlaskConical, Info, Lock } from 'lucide-react';
import type { KeyStorageStatus, ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { Button, Choice, Field, Modal } from '../../components/ui';
import { presets, presetOf, targetOf, type ServicePreset } from './presets';
import { errorMessage, refreshStaleModels, testService, type ServiceTest } from './model';

/** What the app did after a connection: the room it created for the first real service, if any. */
export type ConnectedRoom = { roomId: string; roomName: string; memberNames: string[]; modelName: string | null };
export type ConnectWizardProps = {
  api: ProviderSettingsApiContract; providers: readonly ProviderSummary[];
  /** Replace the Key of a saved service: the wizard opens on the Key with the service fixed. */
  rekey?: ProviderConfiguration;
  onClose: () => void;
  /** Called once the service is saved; may create the first room. */
  onConnected?: (input: { provider: ProviderConfiguration; firstReal: boolean; readiness: ProviderReadiness | undefined }) => Promise<ConnectedRoom | undefined>;
  /** The first real service goes straight to a discussion, in the room just made for it. */
  onStart?: (roomId: string | undefined) => void;
};

const storageText = (storage: KeyStorageStatus | null) => storage?.mode === 'memory'
  ? '这台电脑没有可靠的安全存储，Key 只在这次运行期间有效，退出后需要重新填写；'
  : '保存后存进系统钥匙串；';

/**
 * Connect a service (D143): pick one from the catalog, paste the Key, pick one of its models, save. Saving is all it takes;
 * the address the Key goes to is written above it. 测试连接 is there for whoever wants it, and nothing waits for it.
 */
export function ConnectWizard({ api, providers, rekey, onClose, onConnected, onStart }: ConnectWizardProps) {
  const [picking, setPicking] = useState(!rekey);
  const [preset, setPreset] = useState<ServicePreset>(() => (rekey && presetOf(rekey)) || presets[0]!);
  const [modelId, setModelId] = useState(() => presets[0]!.models[0]?.id ?? '');
  const [hasKey, setHasKey] = useState(false);
  const [keySaved, setKeySaved] = useState(false);
  const [storage, setStorage] = useState<KeyStorageStatus | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState<ProviderConfiguration | undefined>(rekey);
  const [test, setTest] = useState<ServiceTest>();
  // D143: models the service's own list adds, once it has been asked with the saved Key.
  const [listed, setListed] = useState<string[]>([]);
  const secret = useRef<HTMLInputElement>(null); const alive = useRef(true); const lock = useRef(false);
  const existingReal = useRef(providers.some(provider => provider.kind !== null && provider.kind !== 'mock'));
  const clearSecret = () => { if (secret.current) secret.current.value = ''; setHasKey(false); };
  useEffect(() => { alive.current = true; void api.getKeyStorageStatus().then(value => { if (alive.current) setStorage(value); }, () => {}); return () => { alive.current = false; clearSecret(); }; }, [api]);
  useEffect(() => { refreshStaleModels(api, providers); }, [api]);

  const mock = !rekey && preset.id === 'mock';
  const target = rekey ? targetOf(rekey) : preset.baseUrl;
  const displayName = rekey?.name ?? preset.name;

  function choose(next: ServicePreset) {
    setPreset(next); setModelId(next.models[0]?.id ?? ''); setError(''); setTest(undefined); setListed([]); clearSecret();
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
    const models = mock ? [] : preset.models.map(model => ({ id: model.id, name: model.name }));
    const hasDefault = providers.some(provider => provider.isDefault && provider.enabled && provider.kind !== 'mock');
    const input = { name: displayName, kind: preset.kind, baseUrl: preset.baseUrl, enabled: true, isDefault: !mock && !hasDefault, defaultModelId: mock ? 'mock' : modelId, customModels: models };
    const value = saved ? await api.updateProvider({ ...input, id: saved.id, isDefault: saved.isDefault }) : await api.createProvider(input);
    if (alive.current) setSaved(value);
    return value;
  }

  /** What 保存 and 测试连接 share: the Key typed so far is stored. */
  async function store(): Promise<ProviderConfiguration | undefined> {
    const apiKey = secret.current?.value ?? '';
    if (!mock && !keySaved && apiKey.trim() === '') { setError('请粘贴 API Key。'); return; }
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
      if (provider.kind !== 'mock') void api.refreshModels?.({ providerId: provider.id, force: true })?.catch(() => {});
      let current: ProviderReadiness | undefined;
      try { current = (await api.listModelReadiness?.())?.find(row => row.providerId === provider.id); } catch { current = undefined; }
      const firstReal = provider.kind !== 'mock' && !existingReal.current && !rekey;
      let room: ConnectedRoom | undefined;
      if (!rekey && onConnected) {
        // A room that could not be made is a small thing: 新建房间 is one click away, and the service is saved.
        try { room = await onConnected({ provider, firstReal, readiness: current }); } catch { /* the sidebar still offers it */ }
      }
      if (!alive.current) return;
      close();
      if (firstReal) onStart?.(room?.roomId);
    });
  }

  function runTest() {
    void guarded(async () => {
      const provider = await store();
      if (!provider) return;
      const [result] = await Promise.all([testService(api, provider, modelId || provider.defaultModelId || provider.customModels[0]?.id), lookAtModelList(provider)]);
      if (alive.current) setTest(result);
    });
  }
  /** A saved Key is the moment to ask; what it adds goes after the built-in models. */
  async function lookAtModelList(provider: ProviderConfiguration) {
    try {
      await api.refreshModels?.({ providerId: provider.id, force: true });
      const current = await api.getProviderConfiguration({ id: provider.id });
      if (alive.current) setListed(current.customModels.map(model => model.id).filter(id => !preset.models.some(model => model.id === id)));
    } catch { /* The built-in list is still there. */ }
  }

  const title = picking ? '连接模型服务' : mock ? '添加演示服务' : rekey ? `更换 ${displayName} 的 API Key` : `连接 ${displayName}`;
  const description = picking ? '选一个你有账号的服务。之后可以在「设置 › 模型服务」里添加更多。'
    : mock ? '演示成员不联网，适合先熟悉怎么主持一场讨论。' : `费用由 ${displayName} 直接从你的账户收取；AI 圆桌不收费，也不估算费用。`;
  const footer = picking ? <><span className="is-left small muted">可以连接多个服务，让每位成员各用一家的模型，互相交叉审计。</span><Button onClick={close}>取消</Button></>
    : <>{!mock && <span className="is-left wizard-test"><Button size="sm" disabled={busy || (!hasKey && !keySaved)} onClick={runTest}>测试连接</Button>
      {test ? <span role="status" className={test.tone === 'ok' ? 'status-text ok-text' : 'status-text warn-text'}>{test.tone === 'ok' ? <Check aria-hidden /> : <CircleAlert aria-hidden />}{test.text}</span>
        : <span className="small muted">会发一条很短的消息，可能产生极少的费用</span>}</span>}
      {!rekey && !saved && <Button disabled={busy} onClick={back}>上一步</Button>}
      <Button variant="primary" type="submit" form="connect-form" disabled={busy || (!mock && !hasKey && !keySaved)}>{busy ? '正在保存…' : mock ? '添加演示服务' : '保存'}</Button></>;

  return <Modal title={title} description={description} onClose={close} busy={busy} wide footer={footer} className="wizard">
    {picking ? <div className="choice-grid" role="group" aria-label="服务">
      {presets.map(item => <Choice key={item.id} selected={false} onSelect={() => choose(item)} title={item.name}
        icon={<span className="svc-logo is-sm" aria-hidden>{item.id === 'mock' ? <FlaskConical /> : item.logo}</span>} badge={item.recommended ? '推荐' : undefined}>{item.description}</Choice>)}
    </div>
    : <form id="connect-form" className="form-stack" onSubmit={submit} onChange={() => { setError(''); setTest(undefined); }} noValidate>
      {!mock && target && <div className="target" role="note"><Lock aria-hidden /><span className="grow">Key 只会发往 <code>{target}</code></span></div>}
      {!mock && <Field label="API Key" help={`${rekey ? '' : preset.keyHelp}${storageText(storage)}不会出现在讨论记录、日志和导出文件里，也不会再显示出来。`}>
        {props => <input {...props} ref={secret} className="input mono" type="password" autoComplete="off" spellCheck={false} disabled={busy} autoFocus placeholder={keySaved ? '已保存；要更换就重新粘贴' : undefined}
          onChange={event => setHasKey(event.target.value.length > 0)} />}</Field>}
      {mock && <div className="callout"><Info aria-hidden /><span className="grow">演示服务没有地址，也不需要 Key。演示成员的回复是预先写好的示例，不代表真实模型的水平，也不会出现在用量统计里。</span></div>}
      {!rekey && !mock && <Field label="模型" help="这家服务的默认模型。第一次连接时，建好的三位成员都用它；每位成员可以单独换。">
        {props => <select {...props} className="select input" value={modelId} disabled={busy} onChange={event => setModelId(event.target.value)}>
          {preset.models.map(model => <option key={model.id} value={model.id}>{model.name}（{model.id}）{model.note ? ` · ${model.note}` : ''}</option>)}
          {listed.map(id => <option key={id} value={id}>{id}</option>)}</select>}</Field>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
  </Modal>;
}
