import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, CircleAlert, FlaskConical, Info, Lock, ShieldCheck, Users } from 'lucide-react';
import type { KeyStorageStatus, ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { providerBaseUrlSchema } from '../../../shared/schemas/configuration';
import { Button, Choice, Field, Modal, Stepper } from '../../components/ui';
import { presets, presetOf, targetOf, type ServicePreset } from './presets';
import { errorMessage, modelIdProblem } from './model';

/** What the app did after a connection (D6-A): the room it created for the first real service, if any. */
export type ConnectedRoom = { roomName: string; memberNames: string[]; modelName: string | null };
export type ConnectWizardProps = {
  api: ProviderSettingsApiContract; providers: readonly ProviderSummary[];
  /** Replace the Key of a saved service: the wizard starts at step 2 with the service fixed. */
  rekey?: ProviderConfiguration;
  onClose: () => void;
  /** Called once the Key is saved and the target confirmed; may create the first room (D6-A). */
  onConnected?: (input: { provider: ProviderConfiguration; firstReal: boolean; readiness: ProviderReadiness | undefined }) => Promise<ConnectedRoom | undefined>;
  onStart?: () => void;
};
type Check = { tone: 'ok' | 'warn' | 'info'; title: string; detail: string };

const steps = ['选择服务', '填写 Key', '检查连接'];
const storageText = (storage: KeyStorageStatus | null) => storage?.mode === 'memory'
  ? '这台电脑没有可靠的安全存储，Key 只在这次运行期间有效，退出后需要重新填写；'
  : '保存后存进系统钥匙串；';

/**
 * The three-step connect wizard (README 十个已知体验问题 1, D1-B / D113): the address is written right above the Key,
 * and 保存并连接 is the confirmation. Main remembers it for this Key, address and kind; nothing is asked at next launch.
 */
export function ConnectWizard({ api, providers, rekey, onClose, onConnected, onStart }: ConnectWizardProps) {
  const [step, setStep] = useState(rekey ? 1 : 0);
  const [preset, setPreset] = useState<ServicePreset>(() => rekey ? presetOf(rekey) ?? presets[4] : presets[0]);
  const [name, setName] = useState(() => rekey?.name ?? presets[0].name);
  const [address, setAddress] = useState('');
  const [modelId, setModelId] = useState(() => presets[0].models[0]?.id ?? '');
  const [modelName, setModelName] = useState('');
  const [extraModel, setExtraModel] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [storage, setStorage] = useState<KeyStorageStatus | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [saved, setSaved] = useState<ProviderConfiguration | undefined>(rekey);
  const [checks, setChecks] = useState<Check[]>([]); const [checking, setChecking] = useState(false);
  const [readiness, setReadiness] = useState<ProviderReadiness>();
  const [room, setRoom] = useState<ConnectedRoom>();
  const [trial, setTrial] = useState<{ state: 'idle' | 'sending' | 'ok' | 'failed'; text?: string }>({ state: 'idle' });
  const secret = useRef<HTMLInputElement>(null); const alive = useRef(true); const lock = useRef(false);
  const existingReal = useRef(providers.some(provider => provider.kind !== null && provider.kind !== 'mock'));
  const clearSecret = () => { if (secret.current) secret.current.value = ''; setHasKey(false); };
  useEffect(() => { alive.current = true; void api.getKeyStorageStatus().then(value => { if (alive.current) setStorage(value); }, () => {}); return () => { alive.current = false; clearSecret(); }; }, [api]);

  const compatible = rekey ? rekey.kind === 'openai-compatible' && !presetOf(rekey) : preset.id === 'compatible';
  const mock = !rekey && preset.id === 'mock';
  const typed = compatible && !rekey ? providerBaseUrlSchema.safeParse(address) : undefined;
  const target = rekey ? targetOf(rekey) : compatible ? (typed?.success ? typed.data.replace(/\/+$/u, '') : null) : preset.baseUrl;
  const chosenModel = compatible ? modelId.trim() : modelId;
  const modelProblem = modelIdProblem(chosenModel) ?? modelIdProblem(extraModel);
  const displayName = rekey?.name ?? (name.trim() || preset.name);

  function choose(next: ServicePreset) {
    setPreset(next); setName(next.name); setModelId(next.models[0]?.id ?? ''); setModelName(''); setAddress(''); setExtraModel(''); setError('');
  }
  function close() { clearSecret(); onClose(); }
  function back() { clearSecret(); setError(''); setStep(0); }

  async function guarded(work: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await work(); } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }

  /** Create (or, after a failed attempt, update) the service; mock needs nothing else. */
  async function saveConfiguration(): Promise<ProviderConfiguration> {
    const models = mock ? [] : [...new Map([
      ...(compatible ? [{ id: chosenModel, name: modelName.trim() || chosenModel }] : preset.models.map(model => ({ id: model.id, name: model.name }))),
      ...(extraModel.trim() ? [{ id: extraModel.trim(), name: extraModel.trim() }] : []),
    ].map(model => [model.id, model])).values()];
    const hasDefault = providers.some(provider => provider.isDefault && provider.enabled && provider.kind !== 'mock');
    const input = { name: displayName, kind: preset.kind, baseUrl: mock || !compatible ? (preset.kind === 'openai-compatible' ? preset.baseUrl : null) : address.trim(),
      enabled: true, isDefault: !mock && !hasDefault, defaultModelId: mock ? 'mock' : chosenModel || null, customModels: models };
    const value = saved ? await api.updateProvider({ ...input, id: saved.id, isDefault: saved.isDefault }) : await api.createProvider(input);
    if (alive.current) setSaved(value);
    return value;
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const apiKey = secret.current?.value ?? '';
    clearSecret();
    if (!mock && !target) { setError(compatible ? '先填写这个服务的地址，例如 https://api.example.com/v1。' : '这个服务没有可用的地址。'); return; }
    if (!mock && apiKey.trim() === '') { setError('请粘贴 API Key。'); return; }
    if (!rekey && !mock && !chosenModel) { setError('请填写模型名，例如服务商文档里的模型 ID。'); return; }
    if (modelProblem) { setError(modelProblem); return; }
    void guarded(async () => {
      const provider = rekey ?? await saveConfiguration();
      if (!mock) {
        await api.setKey({ providerId: provider.id, apiKey });
        // 保存并连接 is the confirmation of the address written above the Key (D113).
        await api.confirmTarget({ providerId: provider.id, baseUrl: target!, confirmed: true });
      }
      if (!alive.current) return;
      setStep(2); await runChecks(provider);
    });
  }

  async function runChecks(provider: ProviderConfiguration) {
    setChecking(true); setChecks([]); setTrial({ state: 'idle' });
    const next: Check[] = [];
    if (provider.kind === 'mock') next.push({ tone: 'ok', title: '演示服务已添加', detail: '不联网；回复是预先写好的示例，不代表真实模型的水平。' });
    else {
      next.push({ tone: 'ok', title: '已保存', detail: `${storage?.mode === 'memory' ? 'Key 只在这次运行期间有效' : 'Key 已存进系统钥匙串'}，请求地址 ${targetOf(provider)} 已确认。` });
      try {
        const result = (await api.testConnection({ providerId: provider.id, level: 'authentication' })).result;
        const code = result.ok ? undefined : result.error.code;
        next.push(result.ok ? { tone: 'ok', title: 'Key 有效', detail: '已用模型列表接口检查，没有生成内容。' }
          : code === 'unsupported' ? { tone: 'info', title: 'Key 还没有核对', detail: '这个服务没有提供模型列表接口。地址和配置没有问题；Key 是否有效，要等第一次讨论或“试发一条”时才知道。' }
            : { tone: 'warn', title: code === 'authentication_failed' ? 'Key 无效' : 'Key 没能核对', detail: errorMessage(result.error) });
      } catch (cause) { next.push({ tone: 'warn', title: 'Key 没能核对', detail: errorMessage(cause) }); }
    }
    let current: ProviderReadiness | undefined;
    try { current = (await api.listModelReadiness?.())?.find(row => row.providerId === provider.id); } catch { current = undefined; }
    const model = current?.models.find(item => item.modelId === provider.defaultModelId) ?? current?.models[0];
    const label = provider.customModels.find(item => item.id === model?.modelId)?.name ?? model?.modelId;
    if (model && provider.kind !== 'mock') next.push(model.usable
      ? { tone: 'ok', title: `${label} 可以用于讨论`, detail: '每位成员都可以单独换模型。调用模型的费用由服务商收取，这里不估算。' }
      : { tone: 'warn', title: `${label} 暂时不能用于讨论`, detail: errorMessage({ code: model.blockedBy === 'key' ? 'authentication_failed' : 'forbidden' }) });
    if (!alive.current) return;
    setChecks(next); setReadiness(current);
    if (!rekey && onConnected) {
      try { const created = await onConnected({ provider, firstReal: provider.kind !== 'mock' && !existingReal.current, readiness: current }); if (alive.current) setRoom(created); }
      catch { if (alive.current) setChecks(previous => [...previous, { tone: 'warn', title: '没能自动建好第一个房间', detail: '可以在左侧“房间”旁边点「+」自己新建。' }]); }
    }
    if (alive.current) setChecking(false);
  }

  function tryGeneration() {
    const provider = saved; const model = readiness?.models.find(item => item.usable);
    if (!provider || !model || trial.state === 'sending') return;
    setTrial({ state: 'sending' });
    void api.testConnection({ providerId: provider.id, level: 'generation', modelId: model.modelId, allowGeneration: true }).then(response => {
      if (!alive.current) return;
      setTrial(response.result.ok ? { state: 'ok', text: '已收到回复，可以生成。' } : { state: 'failed', text: errorMessage(response.result.error) });
    }, cause => { if (alive.current) setTrial({ state: 'failed', text: errorMessage(cause) }); });
  }

  const usable = readiness?.models.some(model => model.usable) || saved?.kind === 'mock';
  const title = step === 0 ? '连接模型服务' : step === 1 ? (mock ? '添加演示服务' : rekey ? `更换 ${displayName} 的 API Key` : compatible ? '连接兼容 OpenAI 接口的服务' : `填写 ${displayName} 的 API Key`)
    : checking ? '正在检查…' : usable ? `${displayName} 已连接` : `${displayName} 已保存`;
  const description = step === 0 ? '选一个你有账号的服务。只需要做一次。'
    : step === 1 ? (mock ? '演示成员不联网，适合先熟悉怎么主持一场讨论。' : `费用由 ${displayName} 直接从你的账户收取；AI 圆桌不收费，也不估算费用。`)
      : usable ? '可以开始讨论了。' : '还不能用于讨论，原因写在下面。';

  const footer = step === 0 ? <><span className="is-left">之后可以在「设置 → 模型服务」里添加更多。</span><Button onClick={close}>取消</Button><Button variant="primary" onClick={() => setStep(1)}>下一步</Button></>
    : step === 1 ? <>{!mock && <span className="is-left wizard-confirm"><ShieldCheck aria-hidden size={15} />保存即表示你确认了上面的地址</span>}
      {!rekey && <Button disabled={busy} onClick={back}>上一步</Button>}
      <Button variant="primary" type="submit" form="connect-form" disabled={busy || (!mock && !hasKey)}>{busy ? '正在保存…' : mock ? '添加演示服务' : '保存并连接'}</Button></>
      : <><Button disabled={checking} onClick={close}>{room || usable ? '稍后再说' : '关闭'}</Button>
        {checks.some(check => check.title === 'Key 无效') && <Button onClick={() => { setStep(1); setError(''); }}>重新填写 Key</Button>}
        {onStart && (room || usable) && <Button variant="primary" disabled={checking} onClick={() => { close(); onStart(); }}>去开始讨论</Button>}</>;

  return <Modal title={title} description={description} onClose={close} busy={busy} wide footer={footer} className="wizard"
    below={<Stepper label="连接进度" steps={steps} current={step} />}>
    {step === 0 && <>
      <div className="choice-grid" role="group" aria-label="服务">
        {presets.map(item => <Choice key={item.id} selected={preset.id === item.id} onSelect={() => choose(item)} title={item.name}
          icon={<span className="svc-logo is-sm" aria-hidden>{item.id === 'mock' ? <FlaskConical /> : item.logo}</span>} badge={item.recommended ? '推荐' : undefined}>{item.description}</Choice>)}
      </div>
      <p className="small muted wizard-foot-note">可以连接多个服务，让三位成员各用一家的模型，互相交叉审计。</p>
    </>}
    {step === 1 && <form id="connect-form" className="form-stack" onSubmit={submit} onChange={() => setError('')} noValidate>
      {compatible && !rekey && <>
        <Field label="服务名称">{props => <input {...props} className="input" value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：Kimi" />}</Field>
        <Field label="地址" error={address.trim() !== '' && !typed?.success ? '地址必须以 https:// 开头（本机服务可以用 http://localhost），不能带账号、问号参数或 # 片段。' : undefined} help="照服务商文档填写，通常以 /v1 结尾。">
          {props => <input {...props} className="input mono" value={address} disabled={busy} onChange={event => setAddress(event.target.value)} placeholder="https://api.example.com/v1" autoComplete="off" spellCheck={false}
            aria-invalid={address.trim() !== '' && !typed?.success || undefined} />}</Field>
      </>}
      {!mock && <div className="target" role="note"><Lock aria-hidden /><span className="grow">{target ? <>Key 只会发往 <code>{target}</code></> : '先填写上面的地址，这里会写明 Key 会发往哪里。'}</span></div>}
      {!mock && <Field label="API Key" help={`${rekey ? '' : preset.keyHelp}${storageText(storage)}不会出现在讨论记录、日志和导出文件里，也不会再显示出来。`}>
        {props => <input {...props} ref={secret} className="input mono" type="password" autoComplete="off" spellCheck={false} disabled={busy} autoFocus={!compatible}
          onChange={event => setHasKey(event.target.value.length > 0)} />}</Field>}
      {mock && <div className="callout"><Info aria-hidden /><span className="grow">演示服务没有地址，也不需要 Key。演示成员的回复是预先写好的示例，不代表真实模型的水平，也不会出现在用量里。</span></div>}
      {!rekey && !mock && (compatible
        ? <div className="form-grid">
          <Field label="模型名">{props => <input {...props} className="input mono" value={modelId} disabled={busy} onChange={event => setModelId(event.target.value)} placeholder="照服务商文档填写，例如 kimi-k2" autoComplete="off" spellCheck={false} aria-invalid={Boolean(modelIdProblem(modelId)) || undefined} />}</Field>
          <Field label="显示名" optional>{props => <input {...props} className="input" value={modelName} disabled={busy} onChange={event => setModelName(event.target.value)} />}</Field>
        </div>
        : <Field label="默认模型" help="新成员默认用这个模型，每位成员也可以单独换。">
          {props => <select {...props} className="select input" value={modelId} disabled={busy} onChange={event => setModelId(event.target.value)}>
            {preset.models.map(model => <option key={model.id} value={model.id}>{model.name}（{model.id}）{model.hint ? ` · ${model.hint}` : ''}</option>)}</select>}</Field>)}
      {!rekey && !mock && <details className="adv"><summary>高级：服务名称、更多模型</summary><div className="form-stack">
        {!compatible && <Field label="服务名称">{props => <input {...props} className="input" value={name} disabled={busy} onChange={event => setName(event.target.value)} />}</Field>}
        <Field label="再加一个模型" optional help="名字照服务商文档填写；列表里没有的也可以以后在设置里加。">
          {props => <input {...props} className="input mono" value={extraModel} disabled={busy} onChange={event => setExtraModel(event.target.value)} autoComplete="off" spellCheck={false} aria-invalid={Boolean(modelIdProblem(extraModel)) || undefined} />}</Field>
      </div></details>}
      {modelProblem && <p className="field-error" role="alert">{modelProblem}</p>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>}
    {step === 2 && <div className="form-stack" aria-busy={checking}>
      {checking && checks.length === 0 && <p role="status" className="muted">正在检查，不会生成内容…</p>}
      <ul className="check-list" aria-live="polite">{checks.map(check => <li key={check.title}>
        {check.tone === 'ok' ? <Check aria-hidden className="ok" /> : check.tone === 'warn' ? <CircleAlert aria-hidden className="warn" /> : <Info aria-hidden className="muted-icon" />}
        <span><b>{check.title}</b><small>{check.detail}</small></span></li>)}</ul>
      {!checking && readiness?.models.some(model => model.usable) && <div className="callout"><Info aria-hidden /><span className="grow">
        想确认真的能生成？可以试发一条很短的消息，费用由服务商收取，不计入用量页。{' '}
        <Button size="sm" disabled={trial.state === 'sending'} onClick={tryGeneration}>{trial.state === 'sending' ? '正在试发…' : '试发一条'}</Button>
        {trial.text && <span role="status" className={trial.state === 'ok' ? 'ok-text' : 'warn-text'}> {trial.text}</span>}</span></div>}
      {room && <div className="callout is-accent"><Users aria-hidden /><span className="grow">下一步：已为你建好房间「{room.roomName}」，{room.memberNames.length} 位成员（{room.memberNames.join('、')}）{room.modelName ? `都使用 ${room.modelName}` : '还没选模型，到房间里为他们选一个能用的模型'}。</span></div>}
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>}
  </Modal>;
}
