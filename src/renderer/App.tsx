import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';
import { Check, Plus, TriangleAlert } from 'lucide-react';
import type { AgentConfiguration, ProviderSettingsApiContract, ProviderSummary } from '../shared/contracts/configuration';
import { NewDiscussionSetup, memberBlocked, RoomDialog, RoomPage, createStarterRoom, defaultModelFor, starterTemplates } from './features/rooms';
import { defaultModeLabel, WorkflowDialog, draftProblems, groupChatMode, readRoomCount, readRoomMode, readRoomWorkflow, speakersOf, stageLabels, templateLabel, workflowConfigFromDraft, workflowPlanSummary, workflowTemplateLabels,
  writeRoomMode, writeRoomWorkflow, type DiscussionMode, type WorkflowCheck, type WorkflowDraft, type WorkflowMember } from './features/workflows';
import { errorCodeSchema } from '../shared/schemas/error';
import { ConnectWizard, SettingsPage, useReadiness, type ConnectedRoom, type SettingsSection } from './features/settings';
import { refreshStaleModels } from './features/settings/model';
import { Welcome, startDemo } from './features/onboarding';
import type { ProviderConfiguration, ProviderReadiness } from '../shared/contracts/configuration';
import { timelineSlots, useHostCommands, useSummaryCommands } from './features/host';
import { UsagePage } from './features/usage';
import { DiscussionTimeline, RunNotices, SummaryDialog, providerNamesFrom } from './features/timeline';
import { HostComposer, TaskComposer, interjectionBoxFor, type RunControls } from './features/composer/Composer';
import { RunPanel, type PanelTab } from './features/runPanel/RunPanel';
import { ArtifactReader, ArtifactsPanel, GenerateDialog, useArtifacts } from './features/artifacts';
import type { ArtifactKind } from '../shared/schemas/artifact';
import { Sidebar, useRoomDirectory } from './features/shell/Sidebar';
import { Topbar } from './features/shell/Topbar';
import { Avatar, Button, Drawer, Pill } from './components/ui';
import { useLayout, useTheme } from './theme/useTheme';
import { statusLabels, runStatusLabel } from './locales/zhCN';
import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../shared/schemas/run';
import { canCommand, canRecover, initialDraft, selectTaskTitle } from './store/rendererStore';
import { createRendererSession } from './subscriptions/rendererSession';
import { MessageImages } from './features/attachments/images';
import { useImageDraft } from './features/attachments/useImageDraft';
import { imageAudienceNotes, memberImageSupport } from './features/attachments/support';
import './features/shell/shell.css';

// D103: whole tokens within the workflow schema's ceiling; Main still refuses anything above the member's model limit.
export function parseOutputLimit(text: string): number | undefined {
  const value = /^\d{1,5}$/u.test(text.trim()) ? Number(text.trim()) : NaN;
  return Number.isSafeInteger(value) && value >= 1 && value <= 65536 ? value : undefined;
}

type Page = 'discussion' | 'rooms' | 'settings' | 'usage';
const pageTitles: Record<Exclude<Page, 'discussion'>, string> = { rooms: '房间', usage: '用量', settings: '设置' };
const codeOf = (error: unknown) => { const value = error && typeof error === 'object' ? error as { code?: unknown; detail?: { code?: unknown } } : undefined; const parsed = errorCodeSchema.safeParse(value?.detail?.code ?? value?.code); return parsed.success ? parsed.data : 'internal_error'; };
/** Why Main would not compile a discussion mode for the current members, in words (D116). */
const workflowRefusal = (error: unknown) => {
  const code = codeOf(error);
  return code === 'invalid_input' ? '按现在的成员和限制排不出这个流程：检查每个阶段的成员和轮数，总回合数不能超过“最多回合”。'
    : code === 'service_unsupported' || code === 'model_unsupported' ? '有成员用的模型已不再支持，请在房间里给 TA 换一个模型。'
    : code === 'invalid_state' || code === 'unsupported' || code === 'forbidden' ? '流程里有成员现在不能发言（可能还没选模型），到房间里看看成员。'
      : code === 'not_found' ? '这个房间已经不存在。' : '没能核对讨论方式，请稍后再试。';
};
const remembered = (key: string, fallback: boolean) => { try { const value = localStorage.getItem(key); return value === null ? fallback : value === 'true'; } catch { return fallback; } };
const remember = (key: string, value: boolean) => { try { localStorage.setItem(key, String(value)); } catch { /* The choice still applies to this window. */ } };
const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];
const starterNames = starterTemplates.map(template => template.name).join('、');

const readRoomModeMarked = (roomId: string) => { try { return localStorage.getItem(`roundtable.mode.${roomId}`) !== null; } catch { return false; } };

export function App() {
  const [api] = useState(() => window.roundtable);
  const [session] = useState(() => createRendererSession(api, localStorage, { requireRoom: true }));
  const [page, setPage] = useState<Page>('discussion');
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('services');
  const [bootReady, setBootReady] = useState(false);
  const [roomDialog, setRoomDialog] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  // Opened from the new-discussion page: the host comes back to the same room and the same draft.
  const [connectKeepsRoom, setConnectKeepsRoom] = useState(false);
  const [demo, setDemo] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const layout = useLayout();
  const [theme, setTheme] = useTheme();
  const [navOpen, setNavOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => remembered('roundtable.sidebarCollapsed', false));
  const [panelPinned, setPanelPinned] = useState(() => remembered('roundtable.panelOpen', true));
  const [panelDrawer, setPanelDrawer] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>('progress');
  // D099: a remembered per-viewer preference; the Run's own mode stays authoritative in Main.
  const [stepMode, setStepMode] = useState(() => remembered('roundtable.stepMode', false));
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
  // D116 (R16 D2-B): the room's discussion mode lives in this profile; Main checks it again at every start.
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [workflowVersion, setWorkflowVersion] = useState(0);
  const [workflowNotice, setWorkflowNotice] = useState<{ roomId: string; text: string }>();
  const [lostWorkflow, setLostWorkflow] = useState<{ roomId: string; label?: string }>();
  const [startChecking, setStartChecking] = useState(false);
  // D147: images going with the goal; like its words, they wait here until the discussion starts.
  const taskImages = useImageDraft(api.attachment);
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
      createProvider: input => refreshAfter(() => api.settings.createProvider(input)),
      updateProvider: input => refreshAfter(() => api.settings.updateProvider(input)),
      deleteProvider: input => refreshAfter(() => api.settings.deleteProvider(input)),
      setKey: input => refreshAfter(() => api.settings.setKey(input)),
      deleteKey: input => refreshAfter(() => api.settings.deleteKey(input)),
      getProviderConfiguration: input => api.settings.getProviderConfiguration(input),
      listProviderSummaries: () => api.settings.listProviderSummaries(),
      getProviderKeyState: input => api.settings.getProviderKeyState(input),
      getKeyStorageStatus: () => api.settings.getKeyStorageStatus(),
      testConnection: input => api.settings.testConnection(input),
      ...(api.settings.listModelReadiness ? { listModelReadiness: () => api.settings.listModelReadiness!() } : {}),
      ...(api.settings.refreshModels ? { refreshModels: async input => {
        const result = await api.settings.refreshModels!(input);
        if (result.outcome !== 'skipped') void reloadProviders();
        return result;
      } } : {}),
    };
  }, [api, reloadProviders]);
  useEffect(() => {
    const dispose = session.mount();
    const restore = () => {
      const state = session.store.getState();
      if (state.syncStatus === 'syncing') return;
      setBootReady(true);
    };
    const unsubscribe = session.store.subscribe(restore); restore();
    return () => { unsubscribe(); dispose(); };
  }, [session]);
  useEffect(() => { alive.current = true; void reloadProviders(); return () => { alive.current = false; providerRequest.current++; }; }, [reloadProviders]);
  useEffect(() => remember('roundtable.stepMode', stepMode), [stepMode]);
  useEffect(() => { setWorkflowNotice(undefined); }, [generation]);
  // Drawers belong to a layout: leaving it closes them. This happens while rendering, not in an effect: an effect runs a
  // task after the new layout is on screen and would cancel a click on its menu button that landed in between.
  const [drawersLayout, setDrawersLayout] = useState(layout);
  if (drawersLayout !== layout) { setDrawersLayout(layout); setNavOpen(false); setPanelDrawer(false); }

  // The room's current members: the new-discussion screen and title show them; the discussion mode is checked against them.
  const roomMembersNeeded = Boolean(roomId) && (page === 'rooms' || workflowOpen || page === 'discussion' && !snapshot);
  useEffect(() => {
    if (!roomId) { setWorkflowMembers(undefined); return; }
    if (!roomMembersNeeded) return;
    let cancelled = false; setWorkflowMembersError(false);
    void Promise.resolve().then(() => api.rooms.listAgentConfigurations({ roomId })).then(members => {
      if (!cancelled) setWorkflowMembers({ roomId, members: Array.isArray(members) ? members : [] });
    }).catch(() => { if (!cancelled) { setWorkflowMembers(undefined); setWorkflowMembersError(true); } });
    return () => { cancelled = true; };
  }, [api, roomId, page, generation, roomMembersNeeded, workflowVersion]);
  const reloadRoomMembers = useCallback(async () => {
    if (!roomId) return [];
    const members = await api.rooms.listAgentConfigurations({ roomId });
    const list = Array.isArray(members) ? members : [];
    setWorkflowMembers({ roomId, members: list });
    void directory.reload();
    return list.filter(member => !member.archivedAt);
  }, [api, roomId]);
  const modeMembers: WorkflowMember[] = roomId && workflowMembers?.roomId === roomId
    ? workflowMembers.members.filter(member => !member.archivedAt).map(member => ({ id: member.id, name: member.displayName, enabled: member.enabled, role: member.roleTemplateId })) : [];
  const stored = useMemo(() => roomId ? readRoomWorkflow(roomId) : { damaged: false }, [roomId, workflowVersion]);
  // A remembered mode is checked against the members as they are now, so starting waits until they have been read.
  const modeReady = !stored.draft || workflowMembers?.roomId === roomId;
  // D149: how this room talks when it has no flow of its own.
  const roomMode = useMemo<DiscussionMode>(() => roomId ? readRoomMode(roomId) : 'group-chat', [roomId, workflowVersion]);
  const chatting = Boolean(roomId) && roomMode === 'group-chat' && !stored.draft;
  useEffect(() => { if (chatting && !snapshot && session.store.getState().draft === initialDraft) session.store.getState().setDraft(''); }, [chatting, snapshot, session]);
  const checkWorkflow = useCallback(async (value: WorkflowDraft): Promise<WorkflowCheck> => {
    if (!roomId) return { ok: false, errors: ['先选一个房间。'] };
    try {
      const result = await api.run.previewWorkflow({ roomId, config: workflowConfigFromDraft(value) });
      return { ok: true, summary: workflowPlanSummary(result.snapshot) };
    } catch (cause) { return { ok: false, errors: [workflowRefusal(cause)] }; }
  }, [api, roomId]);
  // Going back to the default (恢复默认) is going back to the group chat.
  const saveWorkflow = (value: WorkflowDraft | null, mode: DiscussionMode = value?.template ?? 'group-chat') => {
    if (!roomId || !writeRoomWorkflow(roomId, value) || !writeRoomMode(roomId, mode)) return false;
    setWorkflowVersion(version => version + 1); setWorkflowNotice(undefined); setLostWorkflow(undefined); return true;
  };
  const startRun = async () => {
    if (!roomId || outputTokenLimit === undefined || startChecking) return;
    const task = draft.trim(); const room = roomId;
    setWorkflowNotice(undefined);
    let workflow: { workflowConfig: ReturnType<typeof workflowConfigFromDraft>; workflowPreviewId: string } | undefined;
    const saved = readRoomWorkflow(room).draft;
    if (saved && workflowMembers?.roomId !== room) return;
    if (saved) {
      // D116: the remembered mode is checked by Main against the members as they are now; if it no longer fits, say why here.
      const problems = draftProblems(saved, modeMembers);
      if (problems.length) { setWorkflowNotice({ roomId: room, text: `讨论方式「${templateLabel(saved.template)}」需要调整：${problems[0]}` }); return; }
      setStartChecking(true);
      try {
        const workflowConfig = workflowConfigFromDraft(saved);
        const preview = await api.run.previewWorkflow({ roomId: room, config: workflowConfig });
        workflow = { workflowConfig, workflowPreviewId: preview.previewId };
      } catch (cause) { setWorkflowNotice({ roomId: room, text: `讨论方式「${templateLabel(saved.template)}」现在不能用：${workflowRefusal(cause)}` }); return; }
      finally { setStartChecking(false); }
      if (session.store.getState().roomId !== room) return;
    }
    const groupChat = !saved && readRoomMode(room) === 'group-chat';
    void session.startRun(workflow, { outputTokenLimit, mode: stepMode && !groupChat ? 'step' : 'automatic', attachmentIds: taskImages.attachmentIds, groupChat })
      .then(() => {
        // Once the goal has become a Run, the box is empty for the next one, so a finished discussion is not restarted by accident.
        const state = session.store.getState();
        if (state.snapshot?.execution?.task === task && state.draft.trim() === task) { state.setDraft(''); taskImages.clear(); }
      });
  };

  const goDiscussion = useCallback(() => { setPage('discussion'); setNavOpen(false); }, []);
  const selectRun = useCallback((id: string) => { setPage('discussion'); setNavOpen(false); void session.selectRun(id); }, [session]);
  const openSettings = useCallback((section: SettingsSection = 'services') => { setSettingsSection(section); setPage('settings'); setNavOpen(false); }, []);
  const openRoom = (id: string) => { if (id !== roomId || snapshot) session.selectRoom(id); setPage('rooms'); setNavOpen(false); };
  const newDiscussion = (id = roomId, knownObjective?: string) => {
    if (id && (id !== roomId || snapshot)) session.selectRoom(id);
    // A room's default goal pre-fills an empty box; the host can change it before starting.
    const objective = (knownObjective ?? [...(directory.rooms ?? []), ...directory.archived].find(room => room.id === id)?.objective)?.trim();
    if (objective && (knownObjective !== undefined || !session.store.getState().draft.trim())) session.store.getState().setDraft(objective);
    setPage('discussion'); setNavOpen(false);
  };

  const providerNames = useMemo(() => providerNamesFrom(providers, providerLoadState), [providers, providerLoadState]);
  // D114: what Main would decide for each configured model now; D113: where each confirmed Key goes.
  const readiness = useReadiness(settingsApi, providers);
  const synchronizeHost = useCallback(() => { void session.synchronize(); }, [session]);
  const hostCommands = useHostCommands(api.host, snapshot?.runId, synchronizeHost);
  // Summaries of the selected Run (D107).
  const summaryCommands = useSummaryCommands(api, snapshot?.runId, synchronizeHost);
  const [summaryTarget, setSummaryTarget] = useState<{ summaryId?: string }>();
  useEffect(() => setSummaryTarget(undefined), [snapshot?.runId]);
  const openSummary = useCallback((summaryId?: string) => { setPanelDrawer(false); setSummaryTarget(summaryId ? { summaryId } : {}); }, []);
  // D140: one click generates with Main's defaults. Only what stands in the way, or asking for another writer, opens the dialog.
  const summarizeNow = useCallback(async (summaryId?: string) => {
    setPanelDrawer(false);
    try {
      const preview = await summaryCommands.preview(summaryId ? { summaryId } : {});
      if (preview.available && preview.agentId && preview.throughSlotId
        && await summaryCommands.generate({ agentId: preview.agentId, throughSlotId: preview.throughSlotId, ...(summaryId ? { summaryId } : {}) })) return;
    } catch { /* the dialog says what stands in the way */ }
    setSummaryTarget(summaryId ? { summaryId } : {});
  }, [summaryCommands]);
  // R14: artifacts of the selected Run — the generate dialog, the reader, and going back to a message it cites.
  const artifactCommands = useArtifacts(api.artifact, snapshot?.runId, snapshot?.sequence, api.codeExport);
  const [generateTarget, setGenerateTarget] = useState<{ kind: ArtifactKind; artifactId?: string }>();
  const [readerTarget, setReaderTarget] = useState<{ artifactId: string; versionId?: string }>();
  const [reveal, setReveal] = useState<{ key: string; nonce: number }>();
  useEffect(() => { setGenerateTarget(undefined); setReaderTarget(undefined); setReveal(undefined); }, [snapshot?.runId]);
  const generateNow = useCallback(async (kind: ArtifactKind, artifactId?: string) => {
    setPanelDrawer(false);
    try {
      const preview = await artifactCommands.preview({ kind, ...(artifactId ? { artifactId } : {}) });
      const started = preview.available && preview.agentId ? await artifactCommands.generate({ kind, agentId: preview.agentId, ...(artifactId ? { artifactId } : {}) }) : undefined;
      if (started) { setReaderTarget({ artifactId: started.artifactId, versionId: started.versionId }); return; }
    } catch { /* the dialog says what stands in the way */ }
    setGenerateTarget({ kind, ...(artifactId ? { artifactId } : {}) });
  }, [artifactCommands]);
  const readerArtifact = readerTarget ? artifactCommands.artifacts?.find(artifact => artifact.artifactId === readerTarget.artifactId) : undefined;
  const revealNumber = useCallback((number: number) => {
    const slotId = timelineSlots(snapshot)?.find(slot => slot.number === number)?.slotId;
    if (!slotId) return;
    setReaderTarget(undefined); setPanelDrawer(false); setReveal({ key: slotId, nonce: Date.now() });
  }, [snapshot]);

  const retryChatTurn = useCallback((turnId: string) => void session.retryChatTurn(turnId), [session]);
  const runStatus = snapshot?.status;
  // D098: while a Run is live, the start button turns into its controls in place, so the host never chases them.
  const runActive = liveStatuses.includes(runStatus ?? '') || stopEnabled;
  const activeTurn = snapshot?.turns.find(turn => turn.turnId === snapshot.currentTurnId) ?? snapshot?.turns.find(turn => turn.status === 'running');
  const speaker = snapshot?.execution?.membersSnapshot?.find(member => member.agentId === activeTurn?.agentId)?.displayName;
  // Stop ends the Run and may abort a request already sent; it asks once, without covering Pause.
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
  const room = [...(directory.rooms ?? []), ...directory.archived].find(item => item.id === roomId);
  // D116: a room whose last discussion used a workflow, with nothing remembered here, lost its saved mode: say so once.
  const latestRun = directory.runs[0]?.id;
  useEffect(() => {
    // Having chosen free discussion on the new-discussion page is a choice, not a lost mode.
    if (!roomId || stored.draft || stored.damaged || !latestRun || readRoomCount(roomId) !== undefined || readRoomModeMarked(roomId)) return;
    let current = true;
    void Promise.resolve().then(() => api.run.getSnapshot(latestRun)).then(last => {
      if (current && last?.roomId === roomId && last.workflow) setLostWorkflow({ roomId, label: templateLabel(last.workflow.templateId) });
    }).catch(() => {});
    return () => { current = false; };
  }, [api, roomId, latestRun, stored]);
  const [monthTokens, setMonthTokens] = useState<string>();
  const settledKey = liveStatuses.includes(runStatus ?? '') ? 'live' : `${snapshot?.runId ?? ''}:${runStatus ?? ''}:${page}`;
  useEffect(() => {
    let current = true;
    void Promise.resolve().then(() => api.usage.getReport()).then(report => {
      if (!current || !report?.byDate) return;
      const month = new Date().toLocaleDateString('sv-SE').slice(0, 7);
      const tokens = report.byDate.filter(row => row.date.startsWith(month)).reduce((total, row) => total + row.inputTokens + row.outputTokens, 0);
      setMonthTokens(tokens ? `${tokens.toLocaleString('zh-CN')} tokens` : undefined);
    }).catch(() => { if (current) setMonthTokens(undefined); });
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

  const roomName = room?.name;
  const roomMembers = roomId && workflowMembers && workflowMembers.roomId === roomId ? workflowMembers.members.filter(member => !member.archivedAt) : undefined;
  const enabledMembers = roomMembers?.filter(member => member.enabled);
  // Who stands in the way of starting; the list above the goal says why, on that member's row.
  const blockedMembers = snapshot || !roomMembers ? [] : speakersOf(stored.draft, roomMembers).filter(member => memberBlocked(member, providers, readiness.rows));
  const defaultMode = defaultModeLabel(enabledMembers?.length);
  const shownMode = chatting ? groupChatMode.label : defaultMode;
  const workflowLabel = stored.draft ? templateLabel(stored.draft.template) : shownMode;
  const runMembers = snapshot?.execution?.membersSnapshot?.map(member => member.displayName) ?? enabledMembers?.map(member => member.displayName);

  const statusPill = (() => {
    if (!snapshot) return undefined;
    const label = runStatusLabel(snapshot);
    const tone = ['running', 'pausing', 'cancelling'].includes(snapshot.status) ? 'live' : snapshot.status === 'completed' && snapshot.groupChat ? 'neutral' : snapshot.status === 'completed' ? 'ok' : snapshot.durationStop ? 'warn' : snapshot.status === 'error' ? 'danger' : snapshot.status === 'interrupted' ? 'warn' : 'neutral';
    return <Pill tone={tone} dot={tone !== 'ok'} icon={tone === 'ok' ? Check : undefined}>{label}</Pill>;
  })();
  // A workflow Run reads 第 3/5 步 · 修订 (the stage being spoken or next); other Runs count turns.
  const flow = snapshot?.workflow;
  const flowStage = flow ? flow.stages.find(stage => stage.id === flow.currentStage) : undefined;
  const flowStep = flow ? Math.min(flow.totalTurns, flow.completedTurns + (activeTurn && !activeTurn.overrideActionId ? 1 : 0)) : 0;
  const statusDetail = [
    snapshot?.groupChat ? undefined : flow ? `第 ${Math.max(1, flowStep)}/${flow.totalTurns} 步${flowStage ? ` · ${stageLabels[flowStage.kind]}` : ''}${activeTurn && speaker ? ` · ${speaker}正在发言` : ''}`
      : activeTurn && snapshot ? `第 ${snapshot.turns.indexOf(activeTurn) + 1} 回合${speaker ? ` · ${speaker}正在发言` : ''}` : undefined,
    flow ? workflowTemplateLabels[flow.templateId] : snapshot?.groupChat ? groupChatMode.label : undefined,
    syncStatus === 'syncing' ? '正在同步运行状态' : undefined,
    pending ? '操作已发送，等待确认' : undefined,
  ].filter(Boolean).join(' · ');

  const controls: RunControls | undefined = runActive && runStatus ? {
    status: runStatus, inFlight: requestInFlight, speaker,
    pause: { enabled: pauseEnabled, run: () => void session.control('pause') }, resume: { enabled: resumeEnabled, run: () => void session.control('resumeRun') },
    step: { enabled: stepEnabled, run: () => void session.control('step') }, stop: { enabled: stopEnabled, run: () => void session.control('stop') },
  } : undefined;
  const syncNotices = <>{syncStatus === 'syncing' && !snapshot && <p role="status" className="muted">正在同步运行状态…</p>}</>;
  const modeNotice = workflowNotice?.roomId === roomId ? workflowNotice?.text
    : stored.damaged ? `这个房间保存的讨论方式读不出来，这次按「${shownMode}」进行。`
      : lostWorkflow?.roomId === roomId && !stored.draft ? `这台电脑上没有找到这个房间的讨论方式（例如清理过浏览器数据），已退回「${shownMode}」${lostWorkflow?.label ? `；上次用的是「${lostWorkflow.label}」` : ''}。` : undefined;
  const taskNotices = (error && !snapshot && syncStatus !== 'error') || modeNotice || workflowMembersError || otherLive || blockedMembers.length > 0 ? <div className="composer-alerts">
    {blockedMembers.length > 0 && <p role="note" className="composer-blocked">还不能开始：{blockedMembers.map(member => member.displayName).join('、')}的模型要先处理，原因写在上面的成员那一行。</p>}
    {otherLive && <p role="alert" className="composer-blocked">「{otherLive.task}」还没有结束（{statusLabels[otherLive.status] ?? '进行中'}）。同一时间只能进行一场讨论：先回到那场讨论停止它，或等它结束，再开始或继续别的讨论。<button type="button" className="link-btn" onClick={() => selectRun(otherLive.runId)}>回到那场讨论</button></p>}
    {error && !snapshot && syncStatus !== 'error' && !otherLive && <p role="alert" className="field-error">{error}</p>}
    {modeNotice && <p role={workflowNotice ? 'alert' : 'note'} className={workflowNotice ? 'composer-blocked' : 'composer-target'}>{modeNotice}<button type="button" className="link-btn" onClick={() => setWorkflowOpen(true)}>更改讨论方式</button></p>}
    {workflowMembersError && <p role="alert" className="field-error">没有读出这个房间的成员，请稍后重试。</p>}
  </div> : undefined;

  const composer = (() => {
    if (page !== 'discussion') return null;
    if (snapshot && interjectionBoxFor(snapshot, runActive)) return <HostComposer key={snapshot.runId} snapshot={snapshot} commands={hostCommands} controls={controls}
      instructionsWritable={snapshot.status !== 'idle' && snapshot.status !== 'cancelling'} notices={<>{syncNotices}{otherLive && !runActive ? taskNotices : undefined}</>}
      continueApi={api.run} onContinued={synchronizeHost} attachmentApi={api.attachment} imageSupport={member => memberImageSupport(member, providers, readiness.rows)}
      settledSlot={<Button className="slot" icon={Plus} disabled={!bootReady} onClick={() => newDiscussion(snapshot.roomId)}>新讨论</Button>} />;
    return <TaskComposer draft={draft} setDraft={value => session.store.getState().setDraft(value)}
      canStart={startEnabled && modeReady && !otherLive && !startChecking && !room?.archivedAt && outputTokenLimit !== undefined && blockedMembers.length === 0}
      starting={pending?.command === 'start' || startChecking} onStart={() => void startRun()} notices={<>{syncNotices}{taskNotices}</>}
      placeholder={snapshot ? '在这个房间开始新的讨论，写下目标和约束…' : undefined}
      chat={!snapshot && chatting ? { members: speakersOf(undefined, roomMembers ?? []).map(member => ({ agentId: member.id, name: member.displayName })) } : undefined}
      images={taskImages} imageNotes={roomMembers ? imageAudienceNotes(speakersOf(stored.draft, roomMembers).map(member => ({ name: member.displayName, support: member.providerId || member.builtInDemo ? memberImageSupport(member, providers, readiness.rows) : undefined }))) : []}
      settings={{ outputLimitText, setOutputLimitText, outputLimitValid: outputTokenLimit !== undefined,
        stepMode, setStepMode, workflowLabel, onOpenWorkflow: roomId && snapshot ? () => setWorkflowOpen(true) : undefined }} />;
  })();

  const recentTasks = [...new Set(directory.runs.map(run => run.task).filter((task): task is string => Boolean(task?.trim())))].slice(0, 3);
  const discussionBody = (() => {
    if (snapshot) return <DiscussionTimeline snapshot={snapshot} commands={hostCommands} providers={providerNames} summaries={summaryCommands}
      onRegenerateSummary={summaryId => void summarizeNow(summaryId)} onChooseSummary={openSummary} reveal={reveal}
      onRetryTurn={snapshot.groupChat ? retryChatTurn : undefined}
      header={snapshot.groupChat ? <><div className="sys-line">{groupChatMode.label}{runMembers?.length ? ` · ${runMembers.join('、')}` : ''}</div>
        <article className="msg is-host" aria-label="主持人的第一条消息"><div className="host-label"><span>主持人</span></div><MessageImages images={snapshot.taskAttachments} /><div className="bubble">{snapshot.execution?.task}</div></article></>
        : <><div className="goal-card"><div className="label">讨论目标</div><p>{snapshot.execution?.task?.trim() || '历史任务（目标未记录）'}</p><MessageImages images={snapshot.taskAttachments} /></div>
        <div className="sys-line">{snapshot.workflow ? workflowTemplateLabels[snapshot.workflow.templateId] : '按顺序轮流发言'}{runMembers?.length ? ` · ${runMembers.join(' → ')}` : ''}</div></>}
      footer={<RunNotices snapshot={snapshot} error={error} syncFailed={syncStatus === 'error'} onRetrySync={synchronizeHost}
        retry={{ enabled: retryEnabled, run: () => void session.repeat('retryTurn') }} resume={{ enabled: continueEnabled, run: () => void session.repeat('continueMessage') }}
        carryOn={{ enabled: resumeEnabled, run: () => void session.control('resumeRun') }}
        recover={{ inspect: { enabled: inspectEnabled, run: () => void session.recover('inspect') }, resume: { enabled: recoverEnabled, run: () => void session.recover('resume') }, discard: { enabled: inspectEnabled, run: () => void session.recover('discard') } }}
        onSummarize={() => void summarizeNow()} summaryOpen={summaryTarget !== undefined} />} />;
    if (runId) return <div className="discussion-empty"><div className="empty-room">
      {syncStatus === 'error' ? <RunNotices snapshot={undefined} error={error} syncFailed onRetrySync={synchronizeHost}
        retry={{ enabled: false, run: () => {} }} resume={{ enabled: false, run: () => {} }} recover={{ inspect: { enabled: false, run: () => {} }, resume: { enabled: false, run: () => {} }, discard: { enabled: false, run: () => {} } }}
        onSummarize={() => {}} summaryOpen={false} /> : <p role="status">正在读取这场讨论…</p>}</div></div>;
    if (!roomId) return <div className="discussion-empty"><div className="empty-room">
      <h2>{directory.rooms?.length ? '选一个房间开始' : '先建一个房间'}</h2>
      <p>{directory.rooms?.length ? '在左侧点一个房间，就能在里面开始新的讨论。' : `房间里放着参加讨论的 AI 成员。新建的房间会带好三位同事（${starterNames}）。`}</p>
      {!directory.rooms?.length && <Button variant="primary" icon={Plus} disabled={!bootReady} onClick={() => setRoomDialog(true)}>新建房间</Button>}</div></div>;
    return <div className="discussion-empty is-new"><div className="empty-room">
      <h2>{chatting ? '想和大家聊点什么？' : '这场讨论要解决什么？'}</h2>
      {!roomMembers && <p>正在读取房间成员…</p>}
      {roomMembers && <NewDiscussionSetup api={api.rooms} roomId={roomId} members={roomMembers} draft={stored.draft} mode={roomMode} providers={providers} readiness={readiness.rows} readOnly={Boolean(room?.archivedAt)}
        reload={reloadRoomMembers} onDraft={saveWorkflow} onCustomFlow={() => setWorkflowOpen(true)} onOpenSettings={() => openSettings()} onConnectMore={() => { setConnectKeepsRoom(true); setConnectOpen(true); }}
        onShown={() => refreshStaleModels(settingsApi, providers)} />}
      {recentTasks.length > 0 && <div className="suggest" aria-label="最近的讨论目标">{recentTasks.map(task => <button key={task} type="button" title={`填入：${task}`} onClick={() => session.store.getState().setDraft(task)}>{task}</button>)}</div>}
    </div></div>;
  })();

  const pageTopbar = (name: Exclude<Page, 'discussion'>) => <Topbar title={pageTitles[name]} onMenu={layout === 'narrow' ? () => setNavOpen(true) : undefined}
    onExpandSidebar={layout !== 'narrow' && sidebarCollapsed ? () => collapseSidebar(false) : undefined}
    />;
  // D6-A: the first real service gets a room of its own; the demo gets 演示房间. Both open ready to start.
  const createFirstRoom = async ({ provider, firstReal, readiness: row }: { provider: ProviderConfiguration; firstReal: boolean; readiness: ProviderReadiness | undefined }): Promise<ConnectedRoom | undefined> => {
    await reloadProviders();
    if (!firstReal) return undefined;
    const model = row?.models.find(item => item.modelId === provider.defaultModelId);
    const usable = model?.usable ? { providerId: provider.id, modelId: model.modelId } : undefined;
    const created = await createStarterRoom(api.rooms, { name: '我的第一场讨论' }, usable);
    await directory.reload();
    return { roomId: created.id, roomName: created.name, memberNames: starterTemplates.map(template => template.name), modelName: usable ? provider.customModels.find(item => item.id === usable.modelId)?.name ?? usable.modelId : null };
  };
  const tryDemo = async () => {
    setDemo({ busy: true });
    try {
      const created = await startDemo(settingsApi, api.rooms, providers);
      await reloadProviders(); await directory.reload();
      setDemo({ busy: false }); newDiscussion(created.id, created.objective);
    } catch { setDemo({ busy: false, error: '没能建好演示房间，请重试。' }); }
  };
  // First use: no service and no room yet. Rooms without a service (an older demo room) still open normally.
  const firstUse = providerLoadState === 'ready' && providers.length === 0 && directory.rooms?.length === 0 && directory.archived.length === 0 && !snapshot && !runId && page === 'discussion';
  const modeDetail = stored.draft ? (() => {
    const names = (ids: string[]) => ids.map(id => modeMembers.find(member => member.id === id)?.name ?? '已不在房间').join('、');
    const limit = `最多 ${stored.draft.turnLimit} 回合 · ${stored.draft.durationMinutes} 分钟`;
    return `${stored.draft.phases.map(phase => `${phase.title}：${names(phase.participants)}`).join(' → ')} · ${limit}`;
  })() : chatting ? groupChatMode.description : `没有单独设置：参与讨论的成员按顺序轮流发言，共 ${Math.max(3, enabledMembers?.length ?? 0)} 回合。`;
  const pageBody: Record<Exclude<Page, 'discussion' | 'settings'>, () => ReactNode> = {
    rooms: () => room ? <RoomPage key={room.id} onEditMember={() => refreshStaleModels(settingsApi, providers)} api={api.rooms} room={room} providers={providers} readiness={readiness.rows} runs={directory.runs}
      workflow={{ label: workflowLabel, detail: modeDetail, onChange: () => setWorkflowOpen(true) }}
      onNewDiscussion={() => newDiscussion(room.id)} onOpenRun={selectRun} onOpenSettings={() => openSettings()}
      onChanged={() => { void directory.reload(); setWorkflowVersion(version => version + 1); }}
      onDeleted={() => { writeRoomWorkflow(room.id, null); setPage('discussion'); void directory.reload().then(() => session.selectRoom(undefined)); }} />
      : <p role="status" className="page-inner muted">{directory.rooms ? '这个房间已经不存在。' : '正在读取…'}</p>,
    usage: () => <UsagePage api={api} onOpenRun={selectRun} />,
  };

  const sidebar = (drawer: boolean) => <Sidebar rooms={directory.rooms} archived={directory.archived} counts={directory.counts} runs={directory.runs} failed={directory.failed} runsFailed={directory.runsFailed} onRetry={() => void directory.reload()}
    roomId={roomId} runId={snapshot?.runId ?? runId} page={page} ready={bootReady} monthTokens={monthTokens}
    emptyText={providers.length === 0 ? '还没有房间。连接模型或开始试玩后，会自动建好第一个房间。' : undefined}
    noRealProvider={providerLoadState === 'ready' && !providers.some(provider => provider.kind !== 'mock' && provider.kind !== null && provider.enabled)}
    onOpenRoom={openRoom} onSelectRun={selectRun} onNewDiscussion={() => newDiscussion()} onNewRoom={() => { setNavOpen(false); setRoomDialog(true); }}
    onOpenUsage={() => { setPage('usage'); setNavOpen(false); }} onOpenSettings={() => openSettings()} onHome={goDiscussion}
    onCollapse={drawer ? undefined : () => collapseSidebar(true)} onClose={drawer ? () => setNavOpen(false) : undefined} />;
  const panel = <RunPanel snapshot={snapshot} commands={hostCommands} providers={providerNames} tab={panelTab} onTab={setPanelTab}
    onClose={() => { if (layout === 'wide') { setPanelPinned(false); remember('roundtable.panelOpen', false); } else setPanelDrawer(false); }}
    onSummarize={() => void summarizeNow()} onChooseSummary={() => openSummary()} onOpenWorkflow={roomId && !snapshot?.groupChat ? () => { setPanelDrawer(false); setWorkflowOpen(true); } : undefined} syncLabel={syncStatus === 'ready' ? '主进程快照 · 已同步' : syncStatus === 'syncing' ? '正在同步' : syncStatus === 'error' ? '同步失败' : '未同步'}
    artifactCount={artifactCommands.artifacts?.length}
    artifacts={snapshot && artifactCommands.available ? <ArtifactsPanel snapshot={snapshot} commands={artifactCommands}
      onGenerate={kind => void generateNow(kind)} onChoose={kind => { setPanelDrawer(false); setGenerateTarget({ kind }); }} onOpen={artifactId => { setPanelDrawer(false); setReaderTarget({ artifactId }); }} /> : undefined} />;

  return <div className="app app-shell" data-layout={layout}>
    {sidebarInline && <div className="app-side" inert={anyDrawer || undefined}>{sidebar(false)}</div>}
    <main className="app-main" inert={anyDrawer || undefined}>
      {firstUse ? <>
        {layout === 'narrow' && <Topbar title="AI 圆桌" onMenu={() => setNavOpen(true)} />}
        <Welcome onConnect={() => setConnectOpen(true)} onDemo={() => void tryDemo()} demoBusy={demo.busy} demoError={demo.error} />
      </> : page === 'discussion' ? <>
        <Topbar title={snapshot ? title : roomId ? '新讨论' : 'AI 圆桌'} status={statusPill ?? (roomName ? <span>{roomName}</span> : undefined)}
          detail={statusDetail || (!snapshot && enabledMembers ? `${roomName ? '· ' : ''}${enabledMembers.length} 位成员` : undefined)}
          members={layout === 'narrow' ? undefined : runMembers}
          panel={panelAvailable ? { open: panelOpen, onToggle: togglePanel, controls: 'run-panel' } : undefined}
          onMenu={layout === 'narrow' ? () => setNavOpen(true) : undefined} onExpandSidebar={layout !== 'narrow' && sidebarCollapsed ? () => collapseSidebar(false) : undefined} />
        {discussionBody}
        {composer}
      </> : page === 'settings' ? <>
        {(layout === 'narrow' || sidebarCollapsed) && pageTopbar('settings')}
        <SettingsPage api={settingsApi} providers={providers} providerLoadState={providerLoadState} onProvidersChanged={() => { void reloadProviders(); void readiness.reload(); }}
          theme={theme} setTheme={setTheme} section={settingsSection} onSection={setSettingsSection} onConnected={createFirstRoom}
          onStart={made => { const target = made ?? roomId; if (target) newDiscussion(target); else goDiscussion(); }} />
      </> : page === 'rooms' ? <>
        <Topbar title={room?.name ?? '房间'} detail={room ? `房间设置 · ${directory.counts.get(room.id) ?? 0} 位参与讨论 · ${directory.runs.length} 次讨论` : undefined}
          members={layout === 'narrow' ? undefined : modeMembers.filter(member => member.enabled).map(member => member.name)}
          onMenu={layout === 'narrow' ? () => setNavOpen(true) : undefined} onExpandSidebar={layout !== 'narrow' && sidebarCollapsed ? () => collapseSidebar(false) : undefined} />
        {pageBody.rooms()}
      </> : <>{(layout === 'narrow' || sidebarCollapsed) && pageTopbar(page)}{pageBody[page]()}</>}
    </main>
    {panelInline && <div className="app-context" id="run-panel" inert={anyDrawer || undefined}>{panel}</div>}
    <Drawer side="left" label="应用导航" open={navOpen && layout === 'narrow'} onClose={() => setNavOpen(false)}>{sidebar(true)}</Drawer>
    <Drawer side="right" label="本场信息" open={panelDrawer && panelAvailable && layout !== 'wide'} onClose={() => setPanelDrawer(false)}><div id="run-panel" style={{ height: '100%' }}>{panel}</div></Drawer>
    {workflowOpen && roomId && <WorkflowDialog key={`${roomId}:${workflowVersion}`} roomName={roomName ?? '这个房间'} members={modeMembers} initial={stored.draft}
      onCheck={checkWorkflow} onSave={value => saveWorkflow(value)} onClose={() => setWorkflowOpen(false)} />}
    {connectOpen && <ConnectWizard api={settingsApi} providers={providers} onClose={() => { setConnectOpen(false); setConnectKeepsRoom(false); void reloadProviders(); void readiness.reload(); }}
      {...(connectKeepsRoom ? {} : { onConnected: createFirstRoom, onStart: (made: string | undefined) => { const target = made ?? roomId; if (target) newDiscussion(target); } })} />}
    {roomDialog && <RoomDialog note={`新房间会带好三位同事：${starterNames}，都可以再改。`} onClose={() => setRoomDialog(false)} onSave={async value => {
      const created = await createStarterRoom(api.rooms, value, defaultModelFor(providers, readiness.rows));
      setRoomDialog(false); void directory.reload(); openRoom(created.id);
    }} />}
    {snapshot && readerArtifact && <ArtifactReader key={readerArtifact.artifactId} snapshot={snapshot} artifact={readerArtifact} commands={artifactCommands} host={hostCommands}
      initialVersionId={readerTarget?.versionId} onClose={() => setReaderTarget(undefined)} onReveal={revealNumber}
      onRegenerate={() => void generateNow(readerArtifact.kind, readerArtifact.artifactId)} onChoose={() => setGenerateTarget({ kind: readerArtifact.kind, artifactId: readerArtifact.artifactId })} />}
    {snapshot && generateTarget && <GenerateDialog key={`${generateTarget.kind}:${generateTarget.artifactId ?? 'new'}`} snapshot={snapshot} kind={generateTarget.kind}
      artifactId={generateTarget.artifactId} commands={artifactCommands} onClose={() => setGenerateTarget(undefined)}
      onStarted={result => { setGenerateTarget(undefined); setReaderTarget({ artifactId: result.artifactId, versionId: result.versionId }); }} />}
    {snapshot && summaryTarget && <SummaryDialog key={summaryTarget.summaryId ?? 'new'} snapshot={snapshot} summaries={summaryCommands} summaryId={summaryTarget.summaryId} onClose={() => setSummaryTarget(undefined)} />}
  </div>;
}
