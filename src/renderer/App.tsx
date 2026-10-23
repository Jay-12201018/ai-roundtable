import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { AgentConfiguration, ProviderSettingsApiContract, ProviderSummary } from '../shared/contracts/configuration';
import { RoomsFeature } from './features/rooms/RoomsFeature';
import { WorkflowFeature, type WorkflowDraft, type WorkflowPreviewResult } from './features/workflows';
import { workflowConfigFromDraft, workflowPreviewForFeature, workflowProgressForFeature, workflowTemplateLabels } from './features/workflows/productionAdapter';
import type { WorkflowConfig, WorkflowSnapshot } from '../shared/schemas/workflow';
import { SettingsFeature } from './features/settings/SettingsFeature';
import { HostPanel, HostTimeline, nextSpeaker, useHostCommands, type ProviderNames } from './features/host';
import { RunBudgetBar, parseBudgetYuan } from './features/usage';
import { statusLabels } from './locales/zhCN';
import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../shared/schemas/run';

// D103: whole tokens within the workflow schema's ceiling; Main still refuses anything above the member's model limit.
export function parseOutputLimit(text: string): number | undefined {
  const value = /^\d{1,5}$/u.test(text.trim()) ? Number(text.trim()) : NaN;
  return Number.isSafeInteger(value) && value >= 1 && value <= 65536 ? value : undefined;
}
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
  const [confirmingStop, setConfirmingStop] = useState(false);
  // D098: a remembered per-viewer preference; the Run's own mode stays authoritative in Main.
  const [stepMode, setStepMode] = useState(() => { try { return localStorage.getItem('roundtable.stepMode') === 'true'; } catch { return false; } });
  const [budgetText, setBudgetText] = useState('1');
  const budgetMicroCny = parseBudgetYuan(budgetText);
  const [outputLimitText, setOutputLimitText] = useState(String(DEFAULT_OUTPUT_TOKEN_LIMIT));
  const outputTokenLimit = parseOutputLimit(outputLimitText);
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
  useEffect(() => { try { localStorage.setItem('roundtable.stepMode', String(stepMode)); } catch { /* The choice still applies to this window. */ } }, [stepMode]);
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
    if (budgetMicroCny === undefined || outputTokenLimit === undefined) return;
    void session.startRun(appliedWorkflow ? { workflowConfig: appliedWorkflow.config, workflowPreviewId: appliedWorkflow.previewId } : undefined, { budgetMicroCny, outputTokenLimit, mode: stepMode ? 'step' : 'automatic' });
  };
  const selectRoom = useCallback((id: string) => session.selectRoom(id), [session]);
  const clearRoom = useCallback(() => session.selectRoom(undefined), [session]);
  const selectRun = useCallback((id: string) => { setPage('discussion'); void session.selectRun(id); }, [session]);
  const openSettings = useCallback(() => setPage('settings'), []);
  const closeSettings = useCallback(() => setPage('discussion'), []);
  const activeTurn = snapshot?.turns.find(turn => turn.status === 'running');
  const messages = snapshot?.messages ?? [];
  const providerNames = useMemo<ProviderNames>(() => ({ state: providerLoadState, names: new Map(providers.map(provider => [provider.id, provider.name])) }), [providers, providerLoadState]);
  const synchronizeHost = useCallback(() => { void session.synchronize(); }, [session]);
  const hostCommands = useHostCommands(api.host, snapshot?.runId, synchronizeHost);
  const upcoming = snapshot && ['running', 'pausing', 'paused'].includes(snapshot.status) ? nextSpeaker(snapshot) : undefined;
  // A budget stop is a deliberate guard, not a model failure; say so in the header.
  const budgetStopped = snapshot?.status === 'error' && snapshot.budget?.blocked !== undefined;
  // D098: while a Run is live, the start button turns into its controls in place, so the host never chases them.
  const runStatus = snapshot?.status;
  const runActive = runStatus === 'running' || runStatus === 'pausing' || runStatus === 'paused' || runStatus === 'cancelling' || stopEnabled;
  // Stop ends the Run and may abort a request already billed; it asks once, without covering Pause.
  const requestInFlight = runStatus === 'running' || runStatus === 'pausing' || runStatus === 'cancelling' || Boolean(snapshot?.host?.generation);
  // The header carries the live status; this line only says what the host can do next.
  const runHint = runStatus === 'paused' ? '可以在“主持人控制”里插话或点名，然后点“下一步”让下一位发言，或点“继续”自动运行。'
    : runStatus === 'pausing' ? '当前回合说完后会停下。' : runStatus === 'cancelling' ? '等待当前请求中止，已生成的文字会保留。'
    : '暂停会等当前回合说完再停下；停止会立即结束本次运行。';
  useEffect(() => { if (!stopEnabled) setConfirmingStop(false); }, [stopEnabled]);
  const stopRun = () => { setConfirmingStop(false); void session.control('stop'); };

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
          <div className="status" role="status">{budgetStopped ? '已因预算停止' : statusLabels[snapshot?.status ?? 'idle']} {activeTurn ? `· 第 ${(snapshot?.turns.indexOf(activeTurn) ?? 0) + 1} 回合` : ''}{upcoming ? ` · 下一位：${upcoming.name}${upcoming.source === 'override' ? '（主持人点名）' : ''}` : ''}</div>
          <button type="button" className="controls-toggle" aria-expanded={showControls} aria-controls="host-controls" onClick={() => setShowControls(value => !value)}>主持人控制</button>
        </header>
        <RunBudgetBar snapshot={snapshot} />
        <div className="messages">
          {messages.length === 0 && !budgetStopped && <div className="empty">{roomId ? '配置成员后，输入目标并开始协作。' : '请先在“房间与成员”中创建或选择房间。'}</div>}
          <HostTimeline snapshot={snapshot} commands={hostCommands} providers={providerNames} />
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
          {/* Notices go above the action row, so 暂停 never moves when they appear (D098). */}
          {!runActive && budgetMicroCny === undefined && <p className="composer-budget-error" role="alert">请输入 0.000001 到 1000 之间的金额，最多 6 位小数。</p>}
          {!runActive && outputTokenLimit === undefined && <p className="composer-budget-error" role="alert">单次输出上限请输入 1 到 65536 之间的整数。</p>}
          {confirmingStop && stopEnabled && <div id="stop-confirm" className="stop-confirm" role="group" aria-label="确认停止运行" onKeyDown={event => { if (event.key === 'Escape') setConfirmingStop(false); }}>
            <p>{requestInFlight
              ? '停止会立即中止当前回合，并结束本次运行。已生成的部分文字会保留；这次请求已经发出，可能已经计费，无法确认用量时按预留上限计入本次花费。'
              : '停止会结束本次运行，后续回合不再执行。已有发言都会保留。'}</p>
            <button className="danger" onClick={stopRun}>确认停止</button>
            <button autoFocus onClick={() => setConfirmingStop(false)}>不停止</button>
          </div>}
          <div className="composer-actions">
            {runActive
              ? <div className="run-bar" role="group" aria-label="运行控制">
                {runStatus === 'paused'
                  ? <button className="composer-primary" onClick={() => void session.control('resumeRun')} disabled={!resumeEnabled}>继续</button>
                  : <button className="composer-primary" onClick={() => void session.control('pause')} disabled={!pauseEnabled}>暂停</button>}
                <button onClick={() => void session.control('step')} disabled={!stepEnabled}>下一步</button>
                <button className="danger" onClick={() => setConfirmingStop(true)} disabled={!stopEnabled || confirmingStop} aria-expanded={confirmingStop} aria-controls="stop-confirm">{runStatus === 'cancelling' ? '正在停止…' : '停止'}</button>
              </div>
              : <button className="composer-primary" onClick={startRun} disabled={!startEnabled || workflowInvalidated || budgetMicroCny === undefined || outputTokenLimit === undefined}>开始协作</button>}
            {runActive
              ? <p className="composer-hint">{runHint}</p>
              : <div className="composer-options">
                <label className="composer-step"><input type="checkbox" checked={stepMode} onChange={event => setStepMode(event.target.checked)} />每个回合结束后暂停，方便插话或点名</label>
                <label className="composer-budget">本次预算（元）<input aria-label="本次运行预算（元）" inputMode="decimal" value={budgetText} aria-invalid={budgetMicroCny === undefined} onChange={event => setBudgetText(event.target.value)} /></label>
                {/* D103: rarely changed, so folded away from the common path; opens by itself when its value is invalid. */}
                <details className="composer-more" open={outputTokenLimit === undefined || undefined}>
                  <summary>更多设置</summary>
                  <label className="composer-budget">单次输出上限（token）<input aria-label="单次输出上限（token）" inputMode="numeric" value={outputLimitText} aria-invalid={outputTokenLimit === undefined} aria-describedby="output-limit-help" onChange={event => setOutputLimitText(event.target.value)} /></label>
                  <p id="output-limit-help">每位成员每次发言最多生成这么多 token。每次请求按这个上限预留费用，实际按用量结算；回复写到上限会保留并标注，可以续写。不能超过成员所用模型允许的最大值（DeepSeek Flash 为 32768）。</p>
                </details>
              </div>}
          </div>
        </div>
      </section>
      <aside id="host-controls" className={`workbench${showControls ? ' is-open' : ''}`} aria-label="主持人控制">
        <h2>主持人控制</h2><p className="room-card">{roomId ? title : '还没有任务'}</p>
        {(snapshot?.status === 'error' || snapshot?.status === 'cancelled' || snapshot?.status === 'interrupted') && <>
          <button onClick={() => void session.repeat('retryTurn')} disabled={!retryEnabled}>重试当前回合</button>
          <button onClick={() => void session.repeat('continueMessage')} disabled={!continueEnabled}>续写部分回复</button>
          {(retryEnabled || continueEnabled) && <p className="control-help">重试和续写会重新发送请求，可能再次计费。</p>}
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
