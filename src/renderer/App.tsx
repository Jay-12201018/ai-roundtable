import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AgentConfiguration, ProviderSettingsApiContract, ProviderSummary } from '../shared/contracts/configuration';
import { RoomsFeature } from './features/rooms/RoomsFeature';
import { WorkflowFeature, type WorkflowDraft, type WorkflowPreviewResult } from './features/workflows';
import { workflowConfigFromDraft, workflowPreviewForFeature, workflowProgressForFeature, workflowTemplateLabels } from './features/workflows/productionAdapter';
import type { WorkflowConfig, WorkflowSnapshot } from '../shared/schemas/workflow';
import { SettingsFeature } from './features/settings/SettingsFeature';
import { HostPanel, HostTimeline, nextSpeaker, useHostCommands } from './features/host';
import { RunBudgetBar, parseBudgetYuan } from './features/usage';
import { statusLabels } from './locales/zhCN';
import { canCommand, canRecover, selectTaskTitle } from './store/rendererStore';
import { createRendererSession } from './subscriptions/rendererSession';

type Theme = 'system' | 'light' | 'dark';

export function App() {
  const [api] = useState(() => window.roundtable);
  const [session] = useState(() => createRendererSession(api, localStorage, { requireRoom: true }));
  const [page, setPage] = useState<'discussion' | 'rooms' | 'settings' | 'workflow'>('discussion');
  const [bootReady, setBootReady] = useState(false);
  const [roomsReady, setRoomsReady] = useState(false);
  const [showControls, setShowControls] = useState(false);
  const [budgetText, setBudgetText] = useState('1');
  const budgetMicroCny = parseBudgetYuan(budgetText);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerLoadState, setProviderLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const providerRequest = useRef(0); const alive = useRef(false);
  const [theme, setTheme] = useState<Theme>(() => {
    try { const saved = localStorage.getItem('roundtable.theme'); return saved === 'dark' || saved === 'light' ? saved : 'system'; }
    catch { return 'system'; }
  });
  const snapshot = useStore(session.store, state => state.snapshot);
  const roomId = useStore(session.store, state => state.roomId);
  const generation = useStore(session.store, state => state.generation);
  const [workflowMembers, setWorkflowMembers] = useState<{ roomId: string; members: AgentConfiguration[] }>();
  const [workflowMembersError, setWorkflowMembersError] = useState(false);
  const [appliedWorkflow, setAppliedWorkflow] = useState<{ roomId: string; scope: string; config: WorkflowConfig; previewId: string }>();
  const [workflowInvalidated, setWorkflowInvalidated] = useState(false);
  const workflowPreview = useRef<{ scope: string; config: WorkflowConfig; previewId: string; snapshot: WorkflowSnapshot } | undefined>(undefined);
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
  useEffect(() => {
    setAppliedWorkflow(undefined); setWorkflowInvalidated(false); workflowPreview.current = undefined;
  }, [generation]);
  useEffect(() => {
    if (!roomId) { setWorkflowMembers(undefined); return; }
    if (page !== 'workflow' && !(page === 'discussion' && appliedWorkflow)) return;
    let cancelled = false; setWorkflowMembersError(false);
    void api.rooms.listAgentConfigurations({ roomId }).then(members => {
      if (!cancelled) setWorkflowMembers({ roomId, members });
    }).catch(() => { if (!cancelled) { setWorkflowMembers(undefined); setWorkflowMembersError(true); } });
    return () => { cancelled = true; };
  }, [api, roomId, page, generation, appliedWorkflow]);
  const workflowScope = `${generation}:${roomId ?? ''}:${workflowMembers && workflowMembers.roomId === roomId ? JSON.stringify(workflowMembers.members) : 'loading'}`;
  const currentWorkflowScope = useRef(workflowScope); currentWorkflowScope.current = workflowScope;
  useEffect(() => {
    if (appliedWorkflow && appliedWorkflow.scope !== workflowScope) {
      setAppliedWorkflow(undefined);
      if (appliedWorkflow.scope.startsWith(`${generation}:`)) setWorkflowInvalidated(true);
    }
    workflowPreview.current = undefined;
  }, [workflowScope]);
  const previewWorkflow = useCallback(async (draft: WorkflowDraft): Promise<WorkflowPreviewResult> => {
    if (!roomId || workflowMembers?.roomId !== roomId) return { ok: false, errors: ['请先加载当前房间成员。'] };
    const config = workflowConfigFromDraft(draft);
    const result = await api.run.previewWorkflow({ roomId, config });
    if (currentWorkflowScope.current !== workflowScope || result.snapshot.roomId !== roomId) return { ok: false, errors: ['房间或成员已变化，请重新验证。'] };
    workflowPreview.current = { scope: workflowScope, config, ...result };
    return { ok: true, preview: workflowPreviewForFeature(result.previewId, result.snapshot) };
  }, [api, roomId, workflowScope]);
  const applyWorkflow = useCallback(async ({ previewId, draft }: { previewId: string; draft: WorkflowDraft }) => {
    const preview = workflowPreview.current;
    const config = workflowConfigFromDraft(draft);
    if (!roomId || !preview || preview.previewId !== previewId || preview.scope !== workflowScope || currentWorkflowScope.current !== workflowScope || JSON.stringify(preview.config) !== JSON.stringify(config)) throw new Error('Workflow preview expired');
    setAppliedWorkflow({ roomId, scope: workflowScope, config, previewId }); setWorkflowInvalidated(false);
    workflowPreview.current = undefined;
  }, [roomId, workflowScope]);
  const startRun = () => {
    if (workflowInvalidated || appliedWorkflow && (appliedWorkflow.roomId !== roomId || appliedWorkflow.scope !== workflowScope)) return;
    if (budgetMicroCny === undefined) return;
    void session.startRun(appliedWorkflow ? { workflowConfig: appliedWorkflow.config, workflowPreviewId: appliedWorkflow.previewId } : undefined, { budgetMicroCny });
  };
  const selectRoom = useCallback((id: string) => session.selectRoom(id), [session]);
  const clearRoom = useCallback(() => session.selectRoom(undefined), [session]);
  const selectRun = useCallback((id: string) => { setPage('discussion'); void session.selectRun(id); }, [session]);
  const openSettings = useCallback(() => setPage('settings'), []);
  const closeSettings = useCallback(() => setPage('discussion'), []);
  const activeTurn = snapshot?.turns.find(turn => turn.status === 'running');
  const messages = snapshot?.messages ?? [];
  const synchronizeHost = useCallback(() => { void session.synchronize(); }, [session]);
  const hostCommands = useHostCommands(api.host, snapshot?.runId, synchronizeHost);
  const upcoming = snapshot && ['running', 'pausing', 'paused'].includes(snapshot.status) ? nextSpeaker(snapshot) : undefined;

  return <div className="app-shell">
    <nav className="app-navigation" aria-label="应用导航">
      <div className="brand">AI 圆桌 <span>本地协作 · 用户自备 Key</span></div>
      <button type="button" aria-current={page === 'discussion' ? 'page' : undefined} onClick={() => setPage('discussion')}>讨论</button>
      <button type="button" aria-current={page === 'rooms' ? 'page' : undefined} disabled={!bootReady} onClick={() => { setRoomsReady(true); setPage('rooms'); }}>房间与成员</button>
      <button type="button" aria-current={page === 'workflow' ? 'page' : undefined} disabled={!roomId} onClick={() => setPage('workflow')}>工作流</button>
      {page !== 'rooms' && <button type="button" aria-current={page === 'settings' ? 'page' : undefined} onClick={openSettings}>模型设置</button>}
      <label className="theme-control">外观<select value={theme} onChange={event => setTheme(event.target.value as Theme)}><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
    </nav>
    <div hidden={page !== 'discussion'} className="discussion-layout">
      <section className="timeline" aria-label="讨论时间线">
        <header>
          <div><small>当前任务</small><h1>{title}</h1></div>
          <div className="status" role="status">{statusLabels[snapshot?.status ?? 'idle']} {activeTurn ? `· 第 ${(snapshot?.turns.indexOf(activeTurn) ?? 0) + 1} 回合` : ''}{upcoming ? ` · 下一位：${upcoming.name}${upcoming.source === 'override' ? '（主持人点名）' : ''}` : ''}</div>
          <button type="button" className="controls-toggle" aria-expanded={showControls} aria-controls="host-controls" onClick={() => setShowControls(value => !value)}>主持人控制</button>
        </header>
        <RunBudgetBar snapshot={snapshot} />
        <div className="messages">
          {messages.length === 0 && <div className="empty">{roomId ? '配置成员后，输入目标并开始协作。' : '请先在“房间与成员”中创建或选择房间。'}</div>}
          <HostTimeline snapshot={snapshot} commands={hostCommands} />
          {/* Run feedback sits right after the last message it describes, not below the composer. */}
          {snapshot?.status === 'interrupted' && <div className="sync-feedback run-feedback">执行已中断，部分输出已保留。请先检查历史记录。</div>}
          {error && <div className="error run-feedback" role="alert">{error}</div>}
        </div>
        {appliedWorkflow && <p role="status">下次开始将使用「{workflowTemplateLabels[appliedWorkflow.config.templateId]}」，此配置尚未启动。</p>}
        {workflowInvalidated && <p role="alert">房间成员已变化，请重新验证并应用工作流后再开始。</p>}
        {syncStatus === 'syncing' && <div role="status" className="sync-feedback">正在同步运行状态</div>}
        {pending && <div role="status" className="sync-feedback">操作已发送，等待确认</div>}
        {syncStatus === 'error' && <button className="retry-sync" onClick={() => void session.synchronize()}>重试同步</button>}
        <div className="composer"><input aria-label="任务目标" value={draft} onChange={event => session.store.getState().setDraft(event.target.value)} />
          <label className="composer-budget">本次预算（元）<input aria-label="本次运行预算（元）" inputMode="decimal" value={budgetText} aria-invalid={budgetMicroCny === undefined} onChange={event => setBudgetText(event.target.value)} /></label>
          <button onClick={startRun} disabled={!startEnabled || workflowInvalidated || budgetMicroCny === undefined}>开始协作</button>
          {budgetMicroCny === undefined && <p className="composer-budget-error" role="alert">请输入 0.000001 到 1000 之间的金额，最多 6 位小数。</p>}
        </div>
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
        <HostPanel snapshot={snapshot} commands={hostCommands} />
        <dl><dt>事件序列</dt><dd>{snapshot?.sequence ?? 0}</dd><dt>回合</dt><dd>{snapshot?.turns.length ?? 0}</dd></dl>
      </aside>
    </div>
    {roomsReady && <div hidden={page !== 'rooms'}><RoomsFeature api={api.rooms} initialRoomId={roomId} providers={providers} providerLoadState={providerLoadState} onReloadProviders={reloadProviders} onSelectRoom={selectRoom} onClearRoom={clearRoom} onSelectRun={selectRun} onOpenSettings={openSettings} /></div>}
    {page === 'workflow' && <main>
      {appliedWorkflow && <p role="status">下次开始将使用「{workflowTemplateLabels[appliedWorkflow.config.templateId]}」，此配置尚未启动。</p>}
      {workflowMembersError && <p role="alert">无法加载工作流成员，请返回讨论后重试。</p>}
      {roomId && workflowMembers?.roomId === roomId ? <WorkflowFeature scopeKey={workflowScope}
        members={workflowMembers.members.map(member => ({ id: member.id, name: member.displayName, enabled: member.enabled && !member.archivedAt }))}
        theme={theme} onPreview={previewWorkflow} onApply={applyWorkflow} progress={workflowProgressForFeature(snapshot)} />
        : <p role="status">正在加载工作流成员…</p>}
    </main>}
    {page === 'settings' && <SettingsFeature api={settingsApi} onClose={closeSettings} />}
  </div>;
}
