import { useCallback, useEffect, useRef, useState } from 'react';
import { Globe, Monitor, Moon, Plug, ShieldCheck, Sun, type LucideIcon } from 'lucide-react';
import type { AppLifecycleApiContract, NetworkApiContract } from '../../../shared/contracts/app';
import type { ProviderConfiguration, ProviderReadiness, ProviderSettingsApiContract, ProviderSummary } from '../../../shared/contracts/configuration';
import { Choice, cx } from '../../components/ui';
import { themeLabels, type Theme } from '../../theme/useTheme';
import { ConnectWizard, type ConnectWizardProps } from './ConnectWizard';
import { NetworkPanel } from './NetworkPanel';
import { ServicesPanel } from './ServicesPanel';
import './settings.css';

export type SettingsSection = 'services' | 'network' | 'appearance' | 'privacy';
const sections: Array<{ id: SettingsSection; label: string; icon: LucideIcon }> = [
  { id: 'services', label: '模型服务', icon: Plug }, { id: 'network', label: '网络与代理', icon: Globe },
  { id: 'appearance', label: '外观', icon: Sun }, { id: 'privacy', label: '数据与隐私', icon: ShieldCheck },
];
const themeIcons: Record<Theme, LucideIcon> = { system: Monitor, light: Sun, dark: Moon };

/** Per-model readiness as Main decides it (D114), reloaded whenever the services change. */
export function useReadiness(api: ProviderSettingsApiContract, key: unknown) {
  const [rows, setRows] = useState<ProviderReadiness[]>();
  const request = useRef(0);
  const reload = useCallback(async () => {
    const token = ++request.current;
    try { const next = await api.listModelReadiness?.(); if (token === request.current) setRows(next); } catch { if (token === request.current) setRows(undefined); }
  }, [api]);
  useEffect(() => { void reload(); }, [reload, key]);
  return { rows, reload };
}

export type SettingsPageProps = {
  api: ProviderSettingsApiContract; network?: NetworkApiContract; lifecycle?: AppLifecycleApiContract;
  providers: readonly ProviderSummary[]; providerLoadState: 'loading' | 'ready' | 'error'; onProvidersChanged: () => void;
  theme: Theme; setTheme: (theme: Theme) => void; section: SettingsSection; onSection: (section: SettingsSection) => void;
  onConnected?: ConnectWizardProps['onConnected']; onStart?: () => void;
};

/** 设置: a sub-navigation (horizontal tabs when narrow) and one section at a time. */
export function SettingsPage({ api, network, lifecycle, providers, providerLoadState, onProvidersChanged, theme, setTheme, section, onSection, onConnected, onStart }: SettingsPageProps) {
  const [wizard, setWizard] = useState<{ rekey?: ProviderConfiguration }>();
  const readiness = useReadiness(api, providers);
  const changed = () => { onProvidersChanged(); void readiness.reload(); };
  // Opening 设置 reads the services afresh, so a change made elsewhere (another window, a restart) is never stale here.
  useEffect(() => { onProvidersChanged(); }, []);
  return <div className="settings-shell">
    <nav className="settings-nav" aria-label="设置分类"><h1>设置</h1>
      {sections.map(item => <button key={item.id} type="button" className="sb-item" aria-current={section === item.id ? 'page' : undefined} onClick={() => onSection(item.id)}>
        <item.icon aria-hidden size={16} /><span className="t">{item.label}</span></button>)}</nav>
    <div className="page settings-content"><div className={cx('page-inner', 'settings-inner')}>
      {section === 'services' && <ServicesPanel api={api} providers={providers} loadState={providerLoadState} readiness={readiness.rows} onChanged={changed}
        onAdd={() => setWizard({})} onRekey={provider => setWizard({ rekey: provider })} />}
      {section === 'network' && <NetworkPanel network={network} lifecycle={lifecycle} />}
      {section === 'appearance' && <>
        <div className="page-head"><div className="grow"><h1>外观</h1><p>默认跟随系统，切换后立即生效，并记在这台电脑上。</p></div></div>
        <div className="choice-grid theme-choices" role="group" aria-label="外观">{(['system', 'light', 'dark'] as Theme[]).map(value => {
          const Icon = themeIcons[value];
          return <Choice key={value} selected={theme === value} onSelect={() => setTheme(value)} title={themeLabels[value]} icon={<Icon aria-hidden size={18} />} />;
        })}</div>
      </>}
      {section === 'privacy' && <>
        <div className="page-head"><div className="grow"><h1>数据与隐私</h1><p>AI 圆桌没有自己的服务器，也不收集使用数据。</p></div></div>
        <section className="card"><div className="card-row"><span className="grow"><b>讨论记录</b><small>房间、成员、讨论和用量都保存在这台电脑上的本地数据库里，不会上传。</small></span></div>
          <div className="card-row"><span className="grow"><b>API Key</b><small>存进系统钥匙串（没有可靠的安全存储时只留在这次运行的内存里）；不会出现在讨论记录、日志和导出文件里，页面上也不会再显示。</small></span></div>
          <div className="card-row"><span className="grow"><b>发给谁</b><small>只有讨论时，才把这场讨论的目标、发言和设定发给成员所用的服务；每把 Key 只会发往你确认过的地址，地址或 Key 一变就要重新确认。</small></span></div>
          <div className="card-row"><span className="grow"><b>演示成员</b><small>演示（Mock）不联网，回复是预先写好的示例。</small></span></div></section>
      </>}
    </div></div>
    {wizard && <ConnectWizard api={api} providers={providers} rekey={wizard.rekey} onClose={() => { setWizard(undefined); changed(); }}
      onConnected={async input => { changed(); return onConnected?.(input); }} onStart={onStart} />}
  </div>;
}
