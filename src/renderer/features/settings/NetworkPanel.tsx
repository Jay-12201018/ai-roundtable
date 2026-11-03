import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert } from 'lucide-react';
import type { NetworkApiContract } from '../../../shared/contracts/app';
import type { NetworkSettings, ProxyStatus, ProxyTestResult } from '../../../shared/schemas/network';
import { Button, Switch } from '../../components/ui';
import { errorMessage } from './model';

const failures: Record<NonNullable<ProxyTestResult['failure']>, string> = {
  refused: '连接不上，请检查网络和地址。', rejected: '代理拒绝了连接，请检查代理设置。', timeout: '8 秒内没有回应，请检查网络和地址。',
  unsupported: '现在的代理类型不支持，可以在高级选项里手动填写 HTTP 代理地址。',
};
const schemeNames = { socks: 'SOCKS', https: 'HTTPS', other: '其他类型' } as const;
export function statusText(status: ProxyStatus): string {
  switch (status.state) {
    case 'off': return '未开启，直接连接。';
    case 'direct': return '系统没有设置代理，将直接连接。';
    case 'proxy': return status.source === 'system' ? `已检测到系统代理 ${status.host}:${status.port}` : `使用手动填写的代理 ${status.host}:${status.port}`;
    default: return `系统代理是 ${schemeNames[status.scheme]}，这个应用现在不支持，请求不会发出。可以在高级选项里手动填写 HTTP 代理地址。`;
  }
}

/** 设置 › 网络 (D137): one switch that reads the system's setting; an address by hand only for when that cannot be read. */
export function NetworkPanel({ network }: { network?: NetworkApiContract }) {
  const [settings, setSettings] = useState<NetworkSettings>(); const [failed, setFailed] = useState(false);
  const [host, setHost] = useState(''); const [port, setPort] = useState('');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [test, setTest] = useState<{ ok: boolean; text: string }>();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    if (network) void network.getSettings().then(value => {
      if (!alive.current) return;
      setSettings(value);
      if (value.saved.manual) { setHost(value.saved.manual.host); setPort(String(value.saved.manual.port)); }
    }, () => { if (alive.current) setFailed(true); });
    return () => { alive.current = false; };
  }, [network]);

  const portNumber = /^\d{1,5}$/u.test(port) ? Number(port) : NaN;
  const portValid = Number.isInteger(portNumber) && portNumber >= 1 && portNumber <= 65535;
  const hostValid = /^(?:[A-Za-z0-9.-]+|\[?[0-9A-Fa-f:]+\]?)$/u.test(host.trim());
  const manualProblem = (host.trim() || port) && !(hostValid && portValid) ? '填写代理的地址和端口，例如 127.0.0.1 和 7890。' : '';

  async function act(work: () => Promise<void>) {
    setBusy(true); setError(''); setTest(undefined);
    try { await work(); } catch (cause) { if (alive.current) setError(errorMessage(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  const save = (next: NetworkSettings['saved']) => network && act(async () => { const value = await network.saveSettings(next); if (alive.current) setSettings(value); });
  const check = () => network && settings && act(async () => {
    const result = await network.testProxy(settings.saved);
    if (alive.current) setTest(result.ok ? { ok: true, text: '连接正常。' } : { ok: false, text: failures[result.failure!] });
  });

  if (!network) return <p className="muted">这个窗口不能修改网络设置。</p>;
  return <>
    <div className="page-head"><div className="grow"><h1>网络</h1><p>如果你的网络环境需要通过代理连接，在这里打开。</p></div></div>
    {failed && <p role="alert" className="field-error">网络设置没有读出来，请重新打开设置。</p>}
    {settings && <section className="card net-card" aria-label="代理设置">
      <div className="card-row"><span className="grow"><b>使用系统代理</b><small role="status">{statusText(settings.status)}</small></span>
        <Switch label="使用系统代理" checked={settings.saved.enabled} disabled={busy} onChange={value => void save({ ...settings.saved, enabled: value })} /></div>
      <div className="net-body form-stack">
        <div className="inline-fields">
          <Button size="sm" disabled={busy} onClick={() => void check()}>测试连接</Button>
          {test ? <span role="status" className={test.ok ? 'status-text ok-text' : 'status-text warn-text'}>{test.ok ? <Check aria-hidden /> : <CircleAlert aria-hidden />}{test.text}</span>
            : <span className="small muted">只做一次连接握手，不发送 Key 或内容。</span>}
        </div>
        {error && <p role="alert" className="field-error">{error}</p>}
        <details className="adv" open={Boolean(settings.saved.manual) || undefined}><summary>高级：手动填写地址</summary><div className="form-stack">
          <p className="small muted">系统代理读不到时使用。填写后，开关打开时优先用这个地址。</p>
          <div className="inline-fields">
            <input className="input net-host" aria-label="代理地址" placeholder="127.0.0.1" value={host} disabled={busy} autoComplete="off" spellCheck={false} onChange={event => setHost(event.target.value.trim())} />
            <span className="muted" aria-hidden>:</span>
            <input className="input net-port" aria-label="端口" inputMode="numeric" placeholder="7890" value={port} disabled={busy} aria-invalid={Boolean(port) && !portValid || undefined} onChange={event => setPort(event.target.value.trim())} />
            <Button size="sm" disabled={busy || Boolean(manualProblem) || !host.trim()} onClick={() => void save({ ...settings.saved, manual: { host: host.trim(), port: portNumber } })}>保存</Button>
            {settings.saved.manual && <Button size="sm" variant="quiet" disabled={busy} onClick={() => { setHost(''); setPort(''); void save({ ...settings.saved, manual: null }); }}>清除</Button>}
          </div>
          {manualProblem && <p className="field-error" role="alert">{manualProblem}</p>}
        </div></details>
      </div>
    </section>}
  </>;
}
