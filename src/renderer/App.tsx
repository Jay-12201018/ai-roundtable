import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { ProviderSettingsApiContract, ProviderSummary } from '../shared/contracts/configuration';
import { RoomsFeature } from './features/rooms/RoomsFeature';
import { SettingsFeature } from './features/settings/SettingsFeature';
import { statusLabels } from './locales/zhCN';
import { canCommand, canRecover, selectTaskTitle } from './store/rendererStore';
import { createRendererSession } from './subscriptions/rendererSession';

type Theme = 'system' | 'light' | 'dark';

export function App() {
  const [api] = useState(() => window.roundtable);
  const [session] = useState(() => createRendererSession(api, localStorage, { requireRoom: true }));
  const [page, setPage] = useState<'discussion' | 'rooms' | 'settings'>('discussion');
  const [bootReady, setBootReady] = useState(false);
  const [roomsReady, setRoomsReady] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerLoadState, setProviderLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const providerRequest = useRef(0); const alive = useRef(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try { const saved = localStorage.getItem('roundtable.theme'); return saved === 'dark' || saved === 'light' ? saved : 'system'; }
    catch { return 'system'; }
  });
  const snapshot = useStore(session.store, state => state.snapshot);
  const roomId = useStore(session.store, state => state.roomId);
  const draft = useStore(session.store, state => state.draft);
  const title = useStore(session.store, selectTaskTitle);
  const error = useStore(session.store, state => state.error);
  const pending = useStore(session.store, state => state.pending);
  const syncStatus = useStore(session.store, state => state.syncStatus);
  const startEnabled = useStore(session.store, state => Boolean(state.roomId) && canCommand(state, 'start'));
  const pauseEnabled = useStore(session.store, state => canCommand(state, 'pause'));
  const stopEnabled = useStore(session.store, state => canCommand(state, 'stop'));
  const stepEnabled = useStore(session.store, state => canCommand(state, 'step'));
  const resumeEnabled = useStore(session.store, state => canCommand(state, 'resumeRun'));
  const retryEnabled = useStore(session.store, state => canCommand(state, 'retryTurn'));
  const continueEnabled = useStore(session.store, state => canCommand(state, 'continueMessage'));
  const recoverEnabled = useStore(session.store, state => canRecover(state, 'resume'));
  const inspectEnabled = useStore(session.store, state => canRecover(state, 'inspect'));
  const reloadProviders = useCallback(async () => {
    if (!alive.current) return;
    const request = ++providerRequest.current; setProviderLoadState('loading');
    try {
      const next = await api.settings.listProviderSummaries();
      if (alive.current && request === providerRequest.current) { setProviders(next); setProviderLoadState('ready'); }
    } catch { if (alive.current && request === providerRequest.current) setProviderLoadState('error'); }
  }, [api]);
  const settingsApi = useMemo<ProviderSettingsApiContract>(() => {
    async function refreshAfter<T>(work: () => Promise<T>): Promise<T> {
      try { return await work(); } finally { void reloadProviders(); }
    }
    return {
      confirmTarget: input => api.settings.confirmTarget(input),
      createProvider: input => refreshAfter(() => api.settings.createProvider(input)),
      updateProvider: input => refreshAfter(() => api.settings.updateProvider(input)),
      deleteProvider: input => refreshAfter(() => api.settings.deleteProvider(input)),
      setKey: input => refreshAfter(() => api.settings.setKey(input)),
      deleteKey: input => refreshAfter(() => api.settings.deleteKey(input)),
      getProviderConfiguration: input => api.settings.getProviderConfiguration(input),
      listProviderSummaries: () => api.settings.listProviderSummaries(),
      getProviderKeyState: input => api.settings.getProviderKeyState(input),
      getKeyStorageStatus: () => api.settings.getKeyStorageStatus(),
      listModels: input => api.settings.listModels(input),
      testConnection: input => api.settings.testConnection(input),
    };
  }, [api, reloadProviders]);
  useEffect(() => {
    const dispose = session.mount();
    const restore = () => {
      const state = session.store.getState();
      if (state.syncStatus === 'syncing') return;
      setBootReady(true);
      // Preserve a failed restoration until a retry or an explicit room selection.
      if (!state.runId || state.snapshot) setRoomsReady(true);
    };
    const unsubscribe = session.store.subscribe(restore); restore();
    return () => { unsubscribe(); dispose(); };
  }, [session]);
  useEffect(() => { alive.current = true; void reloadProviders(); return () => { alive.current = false; providerRequest.current++; }; }, [reloadProviders]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('roundtable.theme', theme); } catch { /* Appearance still applies for this window. */ }
  }, [theme]);
  const selectRoom = useCallback((id: string) => session.selectRoom(id), [session]);
  const clearRoom = useCallback(() => session.selectRoom(undefined), [session]);
  const selectRun = useCallback((id: string) => { setPage('discussion'); void session.selectRun(id); }, [session]);
  const openSettings = useCallback(() => setPage('settings'), []);
  const closeSettings = useCallback(() => setPage('discussion'), []);
  const activeTurn = snapshot?.turns.find(turn => turn.status === 'running');
  const messages = snapshot?.messages ?? [];

  return <div className="app-shell">
    <nav className="app-navigation" aria-label="应用导航">
      <div className="brand">AI 圆桌 <span>本地协作 · 用户自备 Key</span></div>
      <button type="button" aria-current={page === 'discussion' ? 'page' : undefined} onClick={() => setPage('discussion')}>讨论</button>
      <button type="button" aria-current={page === 'rooms' ? 'page' : undefined} disabled={!bootReady} onClick={() => { setRoomsReady(true); setPage('rooms'); }}>房间与成员</button>
      {page !== 'rooms' && <button type="button" aria-current={page === 'settings' ? 'page' : undefined} onClick={openSettings}>模型设置</button>}
      <label className="theme-control">外观<select value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    </nav>
    <div hidden={page !== 'discussion'} className="discussion-layout">
      <section className="timeline" aria-label="讨论时间线">
        <header>
          <div><small>当前任务</small><h1>{title}</h1></div>
          <div className="status" role="status">{statusLabels[snapshot?.status ?? 'idle']} {activeTurn ? `· 第 ${(snapshot?.turns.indexOf(activeTurn) ?? 0) + 1} 回合` : ''}</div>
          <button type="button" className="controls-toggle" aria-expanded={showControls} aria-controls="host-controls" onClick={() => setShowControls(value => !value)}>主持人控制</button>
        </header>
        <div className="messages">
          {messages.length === 0 && <div className="empty">{roomId ? '配置成员后，输入目标并开始协作。' : '请先在“房间与成员”中创建或选择房间。'}</div>}
          {messages.map(message => {
            const attempt = snapshot?.attempts?.find(value => value.messageId === message.id);
            const turn = snapshot?.turns.find(value => attempt ? value.turnId === attempt.turnId : value.messageId === message.id);
            const member = snapshot?.execution?.membersSnapshot?.find(value => value.agentId === turn?.agentId);
            return <article className="message" key={message.id}><strong>{member?.displayName ?? message.senderName}</strong><div className="message-identity">{member?.roleTemplateId ?? '角色未记录'} · Provider：{member?.providerId ?? '未记录'} · Model：{member?.modelId ?? '未记录'}</div><p>{message.content}</p><small>{statusLabels[message.status] ?? '未知状态'}</small></article>;
          })}
        </div>
        <div className="composer"><input aria-label="任务目标" value={draft} onChange={event => session.store.getState().setDraft(event.target.value)} /><button onClick={() => void session.startRun()} disabled={!startEnabled}>开始协作</button></div>
        {syncStatus === 'syncing' && <div role="status" className="sync-feedback">正在同步运行状态</div>}
        {pending && <div role="status" className="sync-feedback">操作已发送，等待确认</div>}
        {snapshot?.status === 'interrupted' && <div className="sync-feedback">执行已中断，部分输出已保留。请先检查历史记录。</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {syncStatus === 'error' && <button className="retry-sync" onClick={() => void session.synchronize()}>重试同步</button>}
      </section>
      <aside id="host-controls" className={`workbench${showControls ? ' is-open' : ''}`} aria-label="主持人控制">
        <h2>主持人控制</h2><p className="room-card">{roomId ? title : '还没有任务'}</p>
        <button onClick={() => void session.control('pause')} disabled={!pauseEnabled}>暂停</button>
        <button onClick={() => void session.control('step')} disabled={!stepEnabled}>下一步</button>
        <button onClick={() => void session.control('resumeRun')} disabled={!resumeEnabled}>继续</button>
        <button onClick={() => void session.control('stop')} disabled={!stopEnabled}>停止</button>
        {(snapshot?.status === 'error' || snapshot?.status === 'cancelled' || snapshot?.status === 'interrupted') && <>
          <button onClick={() => void session.repeat('retryTurn')} disabled={!retryEnabled}>重试当前回合</button>
          <button onClick={() => void session.repeat('continueMessage')} disabled={!continueEnabled}>续写部分回复</button>
        </>}
        {snapshot?.status === 'interrupted' && <>
          <button onClick={() => void session.recover('inspect')} disabled={!inspectEnabled}>检查中断记录</button>
          <button onClick={() => void session.recover('resume')} disabled={!recoverEnabled}>恢复后续回合</button>
          <button onClick={() => void session.recover('discard')} disabled={!inspectEnabled}>放弃中断执行</button>
        </>}
        <dl><dt>事件序列</dt><dd>{snapshot?.sequence ?? 0}</dd><dt>回合</dt><dd>{snapshot?.turns.length ?? 0}</dd></dl>
      </aside>
    </div>
    {roomsReady && <div hidden={page !== 'rooms'}><RoomsFeature api={api.rooms} initialRoomId={roomId} providers={providers} providerLoadState={providerLoadState} onReloadProviders={reloadProviders} onSelectRoom={selectRoom} onClearRoom={clearRoom} onSelectRun={selectRun} onOpenSettings={openSettings} /></div>}
    {page === 'settings' && <SettingsFeature api={settingsApi} onClose={closeSettings} />}
  </div>;
}
