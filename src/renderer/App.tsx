import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { ArrowLeft, Check, Lock, Plus, TriangleAlert } from 'lucide-react';
import type { AgentConfiguration, ProviderSettingsApiContract, ProviderSummary } from '../shared/contracts/configuration';
import { RoomsFeature } from './features/rooms/RoomsFeature';
import { WorkflowFeature, type WorkflowDraft, type WorkflowPreviewResult } from './features/workflows';
import { workflowConfigFromDraft, workflowPreviewForFeature, workflowProgressForFeature, workflowTemplateLabels } from './features/workflows/productionAdapter';
import type { WorkflowConfig, WorkflowSnapshot } from '../shared/schemas/workflow';
import { SettingsPage, isUserAddress, useReadiness, type SettingsSection } from './features/settings';
import { useHostCommands, useSummaryCommands } from './features/host';
import { UsagePage, chargeOfMessage, parseBudgetYuan, useLedgerCommands } from './features/usage';
import { DiscussionTimeline, RunNotices, SummaryDialog, providerNamesFrom } from './features/timeline';
import { HostComposer, TaskComposer, interjectionBoxFor, type RunControls } from './features/composer/Composer';
import { RunPanel, type PanelTab } from './features/runPanel/RunPanel';
import { Sidebar, useRoomDirectory } from './features/shell/Sidebar';
import { Topbar } from './features/shell/Topbar';
import { Avatar, Button, Drawer, Pill } from './components/ui';
import { useLayout, useTheme } from './theme/useTheme';
import { statusLabels } from './locales/zhCN';
import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../shared/schemas/run';
import { formatYuan } from '../shared/schemas/budget';
import { yuanShort } from './features/usage';
import { canCommand, canRecover, selectTaskTitle } from './store/rendererStore';
import { createRendererSession } from './subscriptions/rendererSession';
import './features/shell/shell.css';

// D103: whole tokens within the workflow schema's ceiling; Main still refuses anything above the member's model limit.
export function parseOutputLimit(text: string): number | undefined {
  const value = /^\d{1,5}$/u.test(text.trim()) ? Number(text.trim()) : NaN;
  return Number.isSafeInteger(value) && value >= 1 && value <= 65536 ? value : undefined;
}

type Page = 'discussion' | 'rooms' | 'settings' | 'workflow' | 'usage';
const pageTitles: Record<Exclude<Page, 'discussion'>, string> = { rooms: '房间与成员', workflow: '讨论方式', usage: '用量与花费', settings: '设置' };
const remembered = (key: string, fallback: boolean) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; } };
const remember = (key: string, value: boolean) => { try { localStorage.setItem(key, String(value)); } catch { /* The choice still applies to this window. */ } };
const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];

export function App() {
  const [api] = useState(() => window.roundtable);
  const [session] = useState(() => createRendererSession(api, localStorage, { requireRoom: true }));
  const [page, setPage] = useState<Page>('discussion');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('services');
  const [bootReady, setBootReady] = useState(false);
  const [roomsReady, setRoomsReady] = useState(false);
  const [roomsKey, setRoomsKey] = useState(0);
  const layout = useLayout();
  const [theme, setTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => remembered('roundtable.sidebarCollapsed', false));
  const [panelPinned, setPanelPinned] = useState(() => remembered('roundtable.panelOpen', true));
  const [panelDrawer, setPanelDrawer] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('progress');
  // D099: a remembered per-viewer preference; the Run's own mode stays authoritative in Main.
  const [stepMode, setStepMode] = useState(() => remembered('roundtable.stepMode', false));
  const [budgetText, setBudgetText] = useState('1');
  const budgetMicroCny = parseBudgetYuan(budgetText);
  const [outputLimitText, setOutputLimitText] = useState(String(DEFAULT_OUTPUT_TOKEN_LIMIT));
  const outputTokenLimit = parseOutputLimit(outputLimitText);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [providerLoadState, setProviderLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const providerRequest = useRef(0); const alive = useRef(false);
  const snapshot = useStore(session.store, state => state.snapshot);
  const roomId = useStore(session.store, state => state.roomId);
  const runId = useStore(session.store, state => state.runId);
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
      if (alive.current && request === providerRequest.current) { setProviders(Array.isArray(next) ? next : []); setProviderLoadState('ready'); }
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
      ...(api.settings.listModelReadiness ? { listModelReadiness: () => api.settings.listModelReadiness!() } : {}),
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
  useEffect(() => remember('roundtable.stepMode', stepMode), [stepMode]);
  useEffect(() => { setAppliedWorkflow(undefined); setWorkflowInvalidated(false); workflowPreview.current = undefined; }, [generation]);
  // Drawers belong to a layout: leaving it closes them.
  useEffect(() => { setNavOpen(false); setPanelDrawer(false); }, [layout]);

  // The room's current members: the empty state and title show them; the workflow page validates against them.
  const roomMembersNeeded = Boolean(roomId) && (page === 'workflow' || page === 'discussion' && (!snapshot || appliedWorkflow !== undefined));
  useEffect(() => {
    if (!roomId) { setWorkflowMembers(undefined); return; }
    if (!roomMembersNeeded) return;
    let cancelled = false; setWorkflowMembersError(false);
    void Promise.resolve().then(() => api.rooms.listAgentConfigurations({ roomId })).then(members => {
      if (!cancelled) setWorkflowMembers({ roomId, members: Array.isArray(members) ? members : [] });
    }).catch(() => { if (!cancelled) { setWorkflowMembers(undefined); setWorkflowMembersError(true); } });
    return () => { cancelled = true; };
  }, [api, roomId, page, generation, roomMembersNeeded]);
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
    const task = draft.trim();
    void session.startRun(appliedWorkflow ? { workflowConfig: appliedWorkflow.config, workflowPreviewId: appliedWorkflow.previewId } : undefined, { budgetMicroCny, outputTokenLimit, mode: stepMode ? 'step' : 'automatic' })
      .then(() => {
        // Once the goal has become a Run, the box is empty for the next one, so a finished discussion is not restarted by accident.
        const state = session.store.getState();
        if (state.snapshot?.execution?.task === task && state.draft.trim() === task) state.setDraft('');
      });
  };

  const goDiscussion = useCallback(() => { setPage('discussion'); setNavOpen(false); }, []);
  const selectRoom = useCallback((id: string) => session.selectRoom(id), [session]);
  const clearRoom = useCallback(() => session.selectRoom(undefined), [session]);
  const selectRun = useCallback((id: string) => { setPage('discussion'); setNavOpen(false); void session.selectRun(id); }, [session]);
  const openSettings = useCallback((section: SettingsSection = 'services') => { setSettingsSection(section); setPage('settings'); setNavOpen(false); }, []);
  const openRooms = () => { setRoomsReady(true); setRoomsKey(value => value + 1); setPage('rooms'); setNavOpen(false); };
  const newDiscussion = (id = roomId) => { if (id) session.selectRoom(id); setPage('discussion'); setNavOpen(false); };

  const providerNames = useMemo(() => providerNamesFrom(providers, providerLoadState), [providers, providerLoadState]);
  // D114: what Main would decide for each configured model now; D113: where each confirmed Key goes.
  const readiness = useReadiness(settingsApi, providers);
  const synchronizeHost = useCallback(() => { void session.synchronize(); }, [session]);
  const hostCommands = useHostCommands(api.host, snapshot?.runId, synchronizeHost);
  // R13B: budget top-ups, write-offs and summaries of the selected Run (D104/D105/D107).
  const ledger = useLedgerCommands(api, snapshot?.runId, synchronizeHost);
  const summaryCommands = useSummaryCommands(api, snapshot?.runId, synchronizeHost);
  const [summaryTarget, setSummaryTarget] = useState<{ summaryId?: string }>();
  useEffect(() => setSummaryTarget(undefined), [snapshot?.runId]);
  const openSummary = useCallback((summaryId?: string) => { setPanelDrawer(false); setSummaryTarget(summaryId ? { summaryId } : {}); }, []);

  const runStatus = snapshot?.status;
  // A budget stop is a deliberate guard, not a model failure; say so in the header.
  const budgetStopped = snapshot?.status === 'error' && snapshot.budget?.blocked !== undefined;
  // D098: while a Run is live, the start button turns into its controls in place, so the host never chases them.
  const runActive = liveStatuses.includes(runStatus ?? '') || stopEnabled;
  const activeTurn = snapshot?.turns.find(turn => turn.turnId === snapshot.currentTurnId) ?? snapshot?.turns.find(turn => turn.status === 'running');
  const speaker = snapshot?.execution?.membersSnapshot?.find(member => member.agentId === activeTurn?.agentId)?.displayName;
  const activeCharge = activeTurn?.messageId ? chargeOfMessage(snapshot, activeTurn.messageId) : undefined;
  // Stop ends the Run and may abort a request already billed; it asks once, without covering Pause.
  const requestInFlight = runStatus === 'running' || runStatus === 'pausing' || runStatus === 'cancelling' || Boolean(snapshot?.host?.generation);

  // Main runs one discussion at a time (a paused one included). Remember the live one while the host looks elsewhere,
  // ask Main whether it has ended, and say so before 开始讨论 instead of after a refused start.
  const [liveRun, setLiveRun] = useState<{ runId: string; task: string; status: string }>();
  useEffect(() => {
    if (!snapshot) return;
    if (liveStatuses.includes(snapshot.status)) setLiveRun({ runId: snapshot.runId, task: snapshot.execution?.task?.trim() || '上一场讨论', status: snapshot.status });
    else setLiveRun(previous => previous?.runId === snapshot.runId ? undefined : previous);
  }, [snapshot?.runId, snapshot?.status]);
  const watchedRun = liveRun && liveRun.runId !== snapshot?.runId ? liveRun.runId : undefined;
  useEffect(() => {
    if (!watchedRun) return;
    let current = true;
    const look = async () => {
      try {
        const other = await api.run.getSnapshot(watchedRun);
        if (!current || !other) return;
        if (liveStatuses.includes(other.status)) setLiveRun(previous => previous && previous.runId === watchedRun ? { ...previous, status: other.status } : previous);
        else setLiveRun(previous => previous?.runId === watchedRun ? undefined : previous);
      } catch { /* Keep the last known state; Main still refuses a second start. */ }
    };
    void look(); const timer = setInterval(() => void look(), 2000);
    return () => { current = false; clearInterval(timer); };
  }, [api, watchedRun]);
  const otherLive = watchedRun ? liveRun : undefined;

  // Sidebar data: rooms, the current room's discussions, and this month's spend.
  const directoryKey = `${generation}:${snapshot?.runId ?? ''}:${runStatus ?? ''}:${page}`;
  const directory = useRoomDirectory(api.rooms, roomId, directoryKey);
  // With nothing selected (first launch, or the selected room went away), open the first room, as the room list did.
  const firstRoom = directory.rooms?.[0]?.id;
  useEffect(() => { if (bootReady && !runId && !roomId && firstRoom && page !== 'rooms') session.selectRoom(firstRoom); }, [bootReady, runId, roomId, firstRoom, page, session]);
  const [monthSpend, setMonthSpend] = useState<string>();
  const settledKey = liveStatuses.includes(runStatus ?? '') ? 'live' : `${snapshot?.runId ?? ''}:${runStatus ?? ''}:${page}`;
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.usage.getReport()).then(report => {
      if (!current || !report?.byDate) return;
      const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
      setMonthSpend(formatYuan(report.byDate.filter(row => row.date.startsWith(month)).reduce((total, row) => total + row.totalMicro, 0)));
    }).catch(() => { if (current) setMonthSpend(undefined); });
    return () => { current = false; };
  }, [api, settledKey]);

  // Shown before the start too, so starting never narrows the column and moves 暂停 away from the pointer (D098).
  const panelAvailable = page === 'discussion' && Boolean(snapshot || roomId);
  const panelInline = layout === 'wide' && panelPinned && panelAvailable;
  const panelOpen = layout === 'wide' ? panelInline : panelDrawer && panelAvailable;
  const togglePanel = () => {
    if (layout === 'wide') { setPanelPinned(value => { remember('roundtable.panelOpen', !value); return !value; }); }
    else setPanelDrawer(value => !value);
  };
  const showPanel = (tab: PanelTab) => { setPanelTab(tab); if (layout === 'wide') { setPanelPinned(true); remember('roundtable.panelOpen', true); } else setPanelDrawer(true); };
  const sidebarInline = layout !== 'narrow' && !sidebarCollapsed;
  const collapseSidebar = (value: boolean) => { setSidebarCollapsed(value); remember('roundtable.sidebarCollapsed', value); };
  const anyDrawer = navOpen || panelDrawer && panelAvailable && layout !== 'wide';

  const workflowLabel = appliedWorkflow ? workflowTemplateLabels[appliedWorkflow.config.templateId] : '按顺序轮流 · 3 回合';
  const roomName = directory.rooms?.find(room => room.id === roomId)?.name;
  const enabledMembers = roomId && workflowMembers && workflowMembers.roomId === roomId ? workflowMembers.members.filter(member => member.enabled && !member.archivedAt) : undefined;
  const runMembers = snapshot?.execution?.membersSnapshot?.map(member => member.displayName) ?? enabledMembers?.map(member => member.displayName);

  const statusPill = (() => {
    if (!snapshot) return undefined;
    if (budgetStopped) return <Pill tone="warn" icon={TriangleAlert}>已因预算停止</Pill>;
    const label = statusLabels[snapshot.status] ?? '未知状态';
    const tone = ['running', 'pausing', 'cancelling'].includes(snapshot.status) ? 'live' : snapshot.status === 'completed' ? 'ok' : snapshot.status === 'error' ? 'danger' : snapshot.status === 'interrupted' ? 'warn' : 'neutral';
    return <Pill tone={tone} dot={tone !== 'ok'} icon={tone === 'ok' ? Check : undefined}>{label}</Pill>;
  })();
  const progress = workflowProgressForFeature(snapshot);
  const statusDetail = [
    activeTurn && snapshot ? `第 ${snapshot.turns.indexOf(activeTurn) + 1} 回合${speaker ? ` · ${speaker}正在发言` : ''}` : undefined,
    !activeTurn && snapshot && progress ? `第 ${Math.min(progress.completedTurns, progress.totalTurns)} / ${progress.totalTurns} 步` : undefined,
    snapshot?.workflow ? workflowTemplateLabels[snapshot.workflow.templateId] : undefined,
    syncStatus === 'syncing' ? '正在同步运行状态' : undefined,
    pending ? '操作已发送，等待确认' : undefined,
  ].filter(Boolean).join(' · ');
  const budget = snapshot?.budget;
  const spent = budget ? budget.settledMicro + budget.unknownMicro + (budget.writtenOffMicro ?? 0) : 0;
  const budgetChip = budget ? { spent: formatYuan(spent), limit: yuanShort(budget.limitMicro), percent: budget.limitMicro ? spent / budget.limitMicro * 100 : 0,
    warn: budget.blocked !== undefined || budget.overrunMicro > 0, title: `已花 ${formatYuan(spent)}，上限 ${formatYuan(budget.limitMicro)}，剩余 ${formatYuan(budget.remainingMicro)}`, onClick: () => showPanel('progress') } : undefined;

  const controls: RunControls | undefined = runActive && runStatus ? {
    status: runStatus, inFlight: requestInFlight, speaker,
    inFlightCost: activeCharge?.state === 'reserved' ? formatYuan(activeCharge.reservedMicro) : undefined,
    pause: { enabled: pauseEnabled, run: () => void session.control('pause') }, resume: { enabled: resumeEnabled, run: () => void session.control('resumeRun') },
    step: { enabled: stepEnabled, run: () => void session.control('step') }, stop: { enabled: stopEnabled, run: () => void session.control('stop') },
  } : undefined;
  const syncNotices = <>{syncStatus === 'syncing' && !snapshot && <p role="status" className="muted">正在同步运行状态…</p>}</>;
  // D113 (R16 D1-B): a service whose address the host typed says once, before the start, where this discussion goes.
  const userTargets = [...new Set((enabledMembers ?? []).map(member => providers.find(provider => provider.id === member.providerId))
    .filter((provider): provider is ProviderSummary => Boolean(provider) && isUserAddress({ kind: provider!.kind, baseUrl: readiness.rows?.find(row => row.providerId === provider!.id)?.confirmedBaseUrl ?? '' }))
    .map(provider => readiness.rows?.find(row => row.providerId === provider.id)?.confirmedBaseUrl).filter((url): url is string => Boolean(url)))];
  const targetNotice = !snapshot && userTargets.length > 0 ? <p className="composer-target" role="note"><Lock aria-hidden size={14} />这场讨论的目标和发言将发往 {userTargets.join('、')}（你在设置里填写并确认过的地址）。</p> : undefined;
  const taskNotices = (error && !snapshot && syncStatus !== 'error') || workflowInvalidated || workflowMembersError || otherLive || targetNotice ? <div className="composer-alerts">
    {targetNotice}
    {otherLive && <p role="alert" className="composer-blocked">「{otherLive.task}」还没有结束（{statusLabels[otherLive.status] ?? '进行中'}）。同一时间只能进行一场讨论：先回到那场讨论停止它，或等它结束，再开始或继续别的讨论。<button type="button" className="link-btn" onClick={() => selectRun(otherLive.runId)}>回到那场讨论</button></p>}
    {error && !snapshot && syncStatus !== 'error' && !otherLive && <p role="alert" className="field-error">{error}</p>}
    {workflowInvalidated && <p role="alert" className="field-error">房间成员已变化，请重新选择讨论方式后再开始。</p>}
    {workflowMembersError && <p role="alert" className="field-error">没有读出这个房间的成员，请稍后重试。</p>}
  </div> : undefined;

  const composer = (() => {
    if (page !== 'discussion') return null;
    if (snapshot && interjectionBoxFor(snapshot, runActive)) return <HostComposer key={snapshot.runId} snapshot={snapshot} commands={hostCommands} controls={controls}
      instructionsWritable={snapshot.status !== 'idle' && snapshot.status !== 'cancelling'} notices={<>{syncNotices}{otherLive && !runActive ? taskNotices : undefined}</>}
      continueApi={api.run} onContinued={synchronizeHost} onOpenBudget={() => showPanel('progress')}
      settledSlot={budgetStopped ? <Button variant="primary" className="slot" disabled title="预算不足，先在上方追加预算">继续</Button>
        : <Button className="slot" icon={Plus} disabled={!bootReady} onClick={() => newDiscussion(snapshot.roomId)}>新讨论</Button>} />;
    return <TaskComposer draft={draft} setDraft={value => session.store.getState().setDraft(value)}
      canStart={startEnabled && !otherLive && !workflowInvalidated && budgetMicroCny !== undefined && outputTokenLimit !== undefined}
      starting={pending?.command === 'start'} onStart={startRun} notices={<>{syncNotices}{taskNotices}</>}
      placeholder={snapshot ? '在这个房间开始新的讨论，写下目标和约束…' : undefined}
      settings={{ budgetText, setBudgetText, budgetValid: budgetMicroCny !== undefined, outputLimitText, setOutputLimitText, outputLimitValid: outputTokenLimit !== undefined,
        stepMode, setStepMode, workflowLabel, onOpenWorkflow: roomId ? () => setPage('workflow') : undefined }} />;
  })();

  const recentTasks = [...new Set(directory.runs.map(run => run.task).filter((task): task is string => Boolean(task?.trim())))].slice(0, 3);
  const discussionBody = (() => {
    if (snapshot) return <DiscussionTimeline snapshot={snapshot} commands={hostCommands} providers={providerNames} ledger={ledger} summaries={summaryCommands}
      onRegenerateSummary={openSummary}
      header={<><div className="goal-card"><div className="label">讨论目标</div><p>{snapshot.execution?.task?.trim() || '历史任务（目标未记录）'}</p></div>
        <div className="sys-line">{snapshot.workflow ? workflowTemplateLabels[snapshot.workflow.templateId] : '按顺序轮流发言'}{runMembers?.length ? ` · ${runMembers.join(' → ')}` : ''}{budget ? ` · 预算 ${yuanShort(budget.initialLimitMicro ?? budget.limitMicro)}` : ''}</div></>}
      footer={<RunNotices snapshot={snapshot} error={error} syncFailed={syncStatus === 'error'} onRetrySync={synchronizeHost} budgetStopped={budgetStopped}
        ledger={ledger} retry={{ enabled: retryEnabled, run: () => void session.repeat('retryTurn') }} resume={{ enabled: continueEnabled, run: () => void session.repeat('continueMessage') }}
        recover={{ inspect: { enabled: inspectEnabled, run: () => void session.recover('inspect') }, resume: { enabled: recoverEnabled, run: () => void session.recover('resume') }, discard: { enabled: inspectEnabled, run: () => void session.recover('discard') } }}
        onSummarize={() => openSummary()} summaryOpen={summaryTarget !== undefined} />} />;
    if (runId) return <div className="discussion-empty"><div className="empty-room">
      {syncStatus === 'error' ? <RunNotices snapshot={undefined} error={error} syncFailed onRetrySync={synchronizeHost} budgetStopped={false} ledger={ledger}
        retry={{ enabled: false, run: () => {} }} resume={{ enabled: false, run: () => {} }} recover={{ inspect: { enabled: false, run: () => {} }, resume: { enabled: false, run: () => {} }, discard: { enabled: false, run: () => {} } }}
        onSummarize={() => {}} summaryOpen={false} /> : <p role="status">正在读取这场讨论…</p>}</div></div>;
    if (!roomId) return <div className="discussion-empty"><div className="empty-room">
      <h2>{directory.rooms?.length ? '选一个房间开始' : '先建一个房间'}</h2>
      <p>{directory.rooms?.length ? '在左侧点一个房间，就能在里面开始新的讨论。' : '房间里放着参加讨论的 AI 成员。建好房间、选好成员和模型后，写下目标就能开始。'}</p>
      <Button variant="primary" disabled={!bootReady} onClick={openRooms}>{directory.rooms?.length ? '打开房间列表' : '新建房间'}</Button></div></div>;
    return <div className="discussion-empty"><div className="empty-room">
      {enabledMembers && enabledMembers.length > 0 && <span className="avatar-stack">{enabledMembers.slice(0, 6).map(member => <Avatar key={member.id} name={member.displayName} />)}</span>}
      <h2>这场讨论要解决什么？</h2>
      <p>{enabledMembers === undefined ? '正在读取房间成员…'
        : enabledMembers.length === 0 ? '这个房间还没有启用的成员，先去「管理房间与成员」添加，才能开始讨论。'
        : `${enabledMembers.map(member => member.displayName).join('、')}会按「${workflowLabel}」依次发言，不会同时生成。你随时可以暂停、插话或点名。`}</p>
      {recentTasks.length > 0 && <div className="suggest" aria-label="最近的讨论目标">{recentTasks.map(task => <button key={task} type="button" title={`填入：${task}`} onClick={() => session.store.getState().setDraft(task)}>{task}</button>)}</div>}
    </div></div>;
  })();

  const pageTopbar = (name: Exclude<Page, 'discussion'>) => <Topbar title={pageTitles[name]} onMenu={layout === 'narrow' ? () => setNavOpen(true) : undefined}
    onExpandSidebar={layout !== 'narrow' && sidebarCollapsed ? () => collapseSidebar(false) : undefined}
    actions={name === 'settings' ? undefined : <Button variant="quiet" icon={ArrowLeft} onClick={goDiscussion}>返回讨论</Button>} />;
  const pageBody: Record<Exclude<Page, 'discussion'>, () => ReactNode> = {
    rooms: () => roomsReady ? <RoomsFeature key={roomsKey} api={api.rooms} initialRoomId={roomId} providers={providers} providerLoadState={providerLoadState} onReloadProviders={reloadProviders}
      onSelectRoom={selectRoom} onClearRoom={clearRoom} onSelectRun={selectRun} onOpenSettings={() => openSettings()} /> : <p role="status" className="page-inner">正在读取…</p>,
    workflow: () => <div className="page-inner">
      {appliedWorkflow && <p role="status" className="appearance">下次开始将使用「{workflowTemplateLabels[appliedWorkflow.config.templateId]}」，此配置尚未启动。</p>}
      {workflowMembersError && <p role="alert" className="appearance">无法加载工作流成员，请返回讨论后重试。</p>}
      {roomId && workflowMembers && workflowMembers.roomId === roomId ? <WorkflowFeature scopeKey={workflowScope}
        members={workflowMembers.members.map(member => ({ id: member.id, name: member.displayName, enabled: member.enabled && !member.archivedAt }))}
        theme={theme} onPreview={previewWorkflow} onApply={applyWorkflow} progress={workflowProgressForFeature(snapshot)} />
        : <p role="status" className="appearance">正在加载工作流成员…</p>}</div>,
    usage: () => <UsagePage api={api} onOpenRun={selectRun} />,
    settings: () => null,
  };

  const sidebar = (drawer: boolean) => <Sidebar rooms={directory.rooms} runs={directory.runs} failed={directory.failed} onRetry={() => void directory.reload()}
    roomId={roomId} runId={snapshot?.runId ?? runId} page={page} ready={bootReady} monthSpend={monthSpend}
    noRealProvider={providerLoadState === 'ready' && !providers.some(provider => provider.kind !== 'mock' && provider.kind !== null && provider.enabled)}
    onSelectRoom={id => newDiscussion(id)} onSelectRun={selectRun} onNewDiscussion={() => newDiscussion()} onManageRooms={openRooms}
    onOpenUsage={() => { setPage('usage'); setNavOpen(false); }} onOpenSettings={() => openSettings()}
    onCollapse={drawer ? undefined : () => collapseSidebar(true)} onClose={drawer ? () => setNavOpen(false) : undefined} />;
  const panel = <RunPanel snapshot={snapshot} commands={hostCommands} ledger={ledger} providers={providerNames} tab={panelTab} onTab={setPanelTab}
    onClose={() => { if (layout === 'wide') { setPanelPinned(false); remember('roundtable.panelOpen', false); } else setPanelDrawer(false); }}
    onSummarize={() => openSummary()} onOpenWorkflow={roomId ? () => { setPanelDrawer(false); setPage('workflow'); } : undefined} syncLabel={syncStatus === 'ready' ? '主进程快照 · 已同步' : syncStatus === 'syncing' ? '正在同步' : syncStatus === 'error' ? '同步失败' : '未同步'} />;

  return <div className="app app-shell" data-layout={layout}>
    {sidebarInline && <div className="app-side" inert={anyDrawer || undefined}>{sidebar(false)}</div>}
    <main className="app-main" inert={anyDrawer || undefined}>
      {page === 'discussion' ? <>
        <Topbar title={snapshot ? title : roomId ? '新讨论' : 'AI 圆桌'} status={statusPill ?? (roomName ? <span>{roomName}</span> : undefined)}
          detail={statusDetail || (!snapshot && enabledMembers ? `${enabledMembers.length} 位成员` : undefined)}
          budget={budgetChip} members={layout === 'narrow' ? undefined : runMembers}
          panel={panelAvailable ? { open: panelOpen, onToggle: togglePanel, controls: 'run-panel' } : undefined}
          onMenu={layout === 'narrow' ? () => setNavOpen(true) : undefined} onExpandSidebar={layout !== 'narrow' && sidebarCollapsed ? () => collapseSidebar(false) : undefined} />
        {discussionBody}
        {composer}
      </> : page === 'settings' ? <>
        {(layout === 'narrow' || sidebarCollapsed) && pageTopbar('settings')}
        <SettingsPage api={settingsApi} network={api.network} lifecycle={api.app} providers={providers} providerLoadState={providerLoadState} onProvidersChanged={() => { void reloadProviders(); void readiness.reload(); }}
          theme={theme} setTheme={setTheme} section={settingsSection} onSection={setSettingsSection} onStart={roomId ? () => newDiscussion(roomId) : goDiscussion} />
      </> : <>{pageTopbar(page)}<div className="page legacy">{pageBody[page]()}</div></>}
    </main>
    {panelInline && <div className="app-context" id="run-panel" inert={anyDrawer || undefined}>{panel}</div>}
    <Drawer side="left" label="应用导航" open={navOpen && layout === 'narrow'} onClose={() => setNavOpen(false)}>{sidebar(true)}</Drawer>
    <Drawer side="right" label="本场信息" open={panelDrawer && panelAvailable && layout !== 'wide'} onClose={() => setPanelDrawer(false)}><div id="run-panel" style={{ height: '100%' }}>{panel}</div></Drawer>
    {snapshot && summaryTarget && <SummaryDialog key={summaryTarget.summaryId ?? 'new'} snapshot={snapshot} summaries={summaryCommands} ledger={ledger} summaryId={summaryTarget.summaryId} onClose={() => setSummaryTarget(undefined)} />}
  </div>;
}
