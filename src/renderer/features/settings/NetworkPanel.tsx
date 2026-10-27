import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Info, RotateCw } from 'lucide-react';
import type { NetworkApiContract, AppLifecycleApiContract } from '../../../shared/contracts/app';
import type { NetworkSettings, ProxySettings, ProxyTestResult } from '../../../shared/schemas/network';
import { Button, Switch } from '../../components/ui';
import { errorMessage } from './model';

const failures: Record<NonNullable<ProxyTestResult['failure']>, string> = {
  refused: '这个端口上没有代理在运行：请确认代理软件已打开，端口填的是“HTTP 代理端口”或“混合端口”。',
  rejected: '代理拒绝了连接：请在代理软件里检查规则，或换一个端口。',
  timeout: '代理没有在 8 秒内回应。',
};
const describe = (effective: NetworkSettings['effective']) => effective.proxy
  ? `已开启 ${effective.proxy.host === '::1' ? '[::1]' : effective.proxy.host}:${effective.proxy.port}${effective.source === 'environment' ? '（来自环境变量 ROUNDTABLE_CONNECT_PROXY）' : '（来自这个页面的设置）'}`
  : '直连，没有使用代理';

/**
 * 设置 › 网络与代理 (D3-B / D115): the choice is saved for the next launch; the launch that is running keeps what it
 * started with. Only a loopback proxy, only with "由代理解析域名" ticked, only for the fixed official targets (D093).
 */
export function NetworkPanel({ network, lifecycle }: { network?: NetworkApiContract; lifecycle?: AppLifecycleApiContract }) {
  const [settings, setSettings] = useState<NetworkSettings>(); const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<{ enabled: boolean; host: ProxySettings['host']; port: string; trustProxyDns: boolean }>({ enabled: false, host: '127.0.0.1', port: '7890', trustProxyDns: false });
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [test, setTest] = useState<{ ok: boolean; text: string }>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (network) void network.getSettings().then(value => {
      if (!alive.current) return;
      setSettings(value);
      const from = value.saved ?? (value.effective.source === 'environment' && value.effective.proxy ? { enabled: true, ...value.effective.proxy, trustProxyDns: true } : undefined);
      if (from) setDraft({ enabled: from.enabled, host: from.host, port: String(from.port), trustProxyDns: from.trustProxyDns });
    }, () => { if (alive.current) setFailed(true); });
    return () => { alive.current = false; };
  }, [network]);

  const port = /^\d{1,5}$/u.test(draft.port) ? Number(draft.port) : NaN;
  const portValid = Number.isInteger(port) && port >= 1 && port <= 65535;
  const environment = settings?.effective.source === 'environment';
  const normal = (value: { enabled: boolean; host: string; port: number; trustProxyDns: boolean } | null | undefined) => value?.enabled ? JSON.stringify([value.host, value.port, value.trustProxyDns]) : 'off';
  const dirty = settings !== undefined && normal(settings.saved) !== normal({ ...draft, port });
  const blocked = draft.enabled && (!portValid ? '端口是 1–65535 之间的数字。' : !draft.trustProxyDns ? '要使用代理，需要勾选“由代理解析域名”。' : '');

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  const save = () => network && !blocked && act(async () => {
    const value = await network.saveSettings({ enabled: draft.enabled, host: draft.host, port: portValid ? port : 7890, trustProxyDns: draft.trustProxyDns });
    if (alive.current) { setSettings(value); setNotice(value.restartRequired ? '已保存，重启应用后生效。' : '已保存。'); }
  });
  const check = () => network && portValid && act(async () => {
    const result = await network.testProxy({ host: draft.host, port });
    if (alive.current) setTest(result.ok ? { ok: true, text: `可以通过代理连到 ${result.target}` } : { ok: false, text: failures[result.failure!] });
  });
  const restart = () => lifecycle && act(async () => { await lifecycle.relaunch(); });

  if (!network) return <p className="muted">这个窗口不能修改网络设置。</p>;
  return <>
    <div className="page-head"><div className="grow"><h1>网络与代理</h1><p>在国内访问部分服务时需要通过代理。这里只支持你电脑上运行的代理软件（例如 Clash、Surge 的本机端口）。</p></div></div>
    {failed && <p role="alert" className="field-error">网络设置没有读出来，请重新打开设置。</p>}
    {settings && <section className="card net-card" aria-label="代理设置">
      <div className="card-row"><span className="grow"><b>通过本机代理连接</b><small>只用于 DeepSeek、Claude、Gemini 的官方地址，其他服务直连。</small></span>
        <Switch label="通过本机代理连接" checked={draft.enabled} disabled={busy} onChange={value => { setDraft(previous => ({ ...previous, enabled: value })); setTest(undefined); setNotice(''); }} /></div>
      <div className="net-body form-stack">
        <div className="field"><span id="net-address">代理地址</span>
          <div className="inline-fields" role="group" aria-labelledby="net-address">
            <select className="select input net-host" aria-label="代理主机" value={draft.host} disabled={busy} onChange={event => { setDraft(previous => ({ ...previous, host: event.target.value as ProxySettings['host'] })); setTest(undefined); }}>
              <option value="127.0.0.1">127.0.0.1</option><option value="::1">[::1]</option></select>
            <span className="muted" aria-hidden>:</span>
            <input className="input net-port" aria-label="端口" inputMode="numeric" value={draft.port} disabled={busy} aria-invalid={!portValid || undefined}
              onChange={event => { setDraft(previous => ({ ...previous, port: event.target.value.trim() })); setTest(undefined); }} />
          </div>
          <span className="field-help">在代理软件里找“HTTP 代理端口”或“混合端口”。只能填本机地址。</span></div>
        <label className="check-label net-trust"><input type="checkbox" checked={draft.trustProxyDns} disabled={busy} onChange={event => setDraft(previous => ({ ...previous, trustProxyDns: event.target.checked }))} />
          <span><b>由代理解析域名</b><span className="field-help">很多代理需要这样才能连通。代理会知道你访问了哪个服务，但看不到 Key 和讨论内容：连接仍然加密，并校验服务器证书。</span></span></label>
        <div className="inline-fields">
          <Button size="sm" disabled={busy || !portValid} onClick={() => void check()}>检测代理</Button>
          {test ? <span role="status" className={test.ok ? 'status-text ok-text' : 'status-text warn-text'}>{test.ok ? <Check aria-hidden /> : <CircleAlert aria-hidden />}{test.text}</span>
            : <span className="small muted">只做一次连接握手，不发送 Key 或内容。</span>}
        </div>
        {blocked && <p className="field-error" role="alert">{blocked}</p>}
        <div className="inline-fields"><Button variant="primary" size="sm" disabled={busy || !dirty || Boolean(blocked)} onClick={() => void save()}>保存设置</Button>
          {notice && <span role="status" className="small ok-text">{notice}</span>}{error && <span role="alert" className="field-error">{error}</span>}</div>
      </div>
      <div className="card-row net-effect"><Info aria-hidden size={16} /><div className="grow small">
        {environment ? <>当前生效：{describe(settings.effective)}。环境变量优先，这里保存的设置不会生效，直到去掉环境变量后重启。</>
          : <>改动在<b>重启应用</b>后生效。当前生效：{describe(settings.effective)}。{settings.savedInvalid ? '保存的设置文件无法读取，已按直连处理。' : ''}</>}</div>
        {!environment && settings.restartRequired && lifecycle && <Button size="sm" icon={RotateCw} disabled={busy} onClick={() => void restart()}>立即重启</Button>}</div>
    </section>}
  </>;
}
