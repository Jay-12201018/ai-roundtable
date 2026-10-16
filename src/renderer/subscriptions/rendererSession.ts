import type { RunSessionApiContract } from '../../shared/contracts/app';
import { idSchema } from '../../shared/schemas/common';
import { runEventSchema, runSnapshotSchema, runSubscriptionSchema } from '../../shared/schemas/run';
import type { RunEvent,InterruptedRunDecision } from '../../shared/types/run';
import { createRendererStore,canRecover, type RendererCommand } from '../store/rendererStore';

type RunControl = 'pause' | 'stop' | 'step' | 'resumeRun';
type IdentityStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
const savedRunKey = 'roundtable.runId';

export function createRendererSession(api: RunSessionApiContract, storage?: IdentityStorage, options: { requireRoom?: boolean } = {}) {
  const store = createRendererStore();
  let mounted = false;
  let disposeMount: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let flight: { generation: number; promise: Promise<void> } | undefined;
  const buffered = new Map<number, RunEvent>();
  let resyncRequested = false;
  let publicFailure:{sequence:number;message:string}|undefined;
  let lastRunningSequence=0;
  function rememberFailure(event:RunEvent){
    if(event.type==='run_state_changed'&&event.payload.status==='running'){
      lastRunningSequence=Math.max(lastRunningSequence,event.sequence);
      if(publicFailure&&publicFailure.sequence<=lastRunningSequence)publicFailure=undefined;
    }
    if((event.type==='turn_failed'||event.type==='turn_aborted')&&event.sequence>lastRunningSequence&&(!publicFailure||event.sequence>publicFailure.sequence)){
      const code=event.payload.error.code;
      publicFailure={sequence:event.sequence,message:code==='invalid_response'?'模型未完整完成响应，部分输出已保留。':code==='timeout'?'请求已超时，部分输出已保留。':code==='cancelled'?'请求已停止，部分输出已保留。':'模型请求失败，部分输出已保留。'};
    }
  }

  const current = (generation: number) => mounted && store.getState().generation === generation;
  function clearBuffer() {
    clearTimeout(timer);
    timer = undefined;
    buffered.clear();
    resyncRequested = false;
    flight = undefined;
    publicFailure=undefined;
    lastRunningSequence=0;
  }
  function saveIdentity(id?: string) {
    try {
      if (id) storage?.setItem(savedRunKey, id);
      else storage?.removeItem(savedRunKey);
    } catch {
      store.getState().setError('无法保存任务位置，刷新后请重新选择历史任务。', store.getState().generation);
    }
  }
  function selectRoom(id?: string, task?: string) {
    clearBuffer();
    store.getState().selectRoom(id, task);
    saveIdentity();
  }
  async function selectRun(id: string) {
    clearBuffer();
    store.getState().selectRun(id);
    if (!idSchema.safeParse(id).success) {
      store.getState().setSyncStatus('error', store.getState().generation);
      store.getState().setError('无法同步任务，请重新选择历史任务。', store.getState().generation);
      return;
    }
    await synchronize();
    if (store.getState().runId === id && store.getState().snapshot) saveIdentity(id);
  }

  // Control markers have synthetic sequences: never put them in the delta map or advance the cursor.
  function queueEvent(value: RunEvent) {
    const state = store.getState();
    if (!mounted || value?.runId !== state.runId) return;
    if (state.syncStatus === 'error') return;
    const parsed = runEventSchema.safeParse(value);
    if (!parsed.success || parsed.data.type === 'snapshot_required') resyncRequested = true;
    else if (parsed.data.sequence > (state.snapshot?.sequence ?? 0)) {
      rememberFailure(parsed.data);
      const previous = buffered.get(parsed.data.sequence);
      if (previous && JSON.stringify(previous) !== JSON.stringify(parsed.data)) { resyncRequested = true; publicFailure = undefined; }
      else buffered.set(parsed.data.sequence, parsed.data);
      if (buffered.size > 500) { buffered.clear(); resyncRequested = true; }
    } else return;
    if (!flight && !timer) timer = setTimeout(flush, 32);
  }
  function applyBuffered(): boolean {
    const state = store.getState();
    const cursor = state.snapshot?.sequence ?? 0;
    for (const sequence of buffered.keys()) if (sequence <= cursor) buffered.delete(sequence);
    if (resyncRequested) return false;
    const events = [...buffered.values()].sort((a, b) => a.sequence - b.sequence);
    if (!events.length) return true;
    if (!state.applyDeltas(events, state.generation)) return false;
    buffered.clear();
    return true;
  }
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (!mounted || flight) return;
    if (!applyBuffered()) void synchronize();
  }
  async function synchronize() {
    const { generation, runId } = store.getState();
    if (!mounted || !runId) return;
    if (flight?.generation === generation) return flight.promise;
    clearTimeout(timer);
    timer = undefined;
    store.getState().setSyncStatus('syncing', generation);
    store.getState().setError(undefined, generation);
    let finished = false;
    const operation = (async () => {
      try {
        let stalled = 0;
        while (true) {
          resyncRequested = false;
          const cursor = store.getState().snapshot?.sequence ?? 0;
          const result = await api.run.subscribe(runId, cursor);
          if (!current(generation)) return;
          const parsed = runSubscriptionSchema.safeParse(result);
          if (!parsed.success || parsed.data.snapshot.runId !== runId || !store.getState().applySnapshot(parsed.data.snapshot, generation)) throw new Error('Invalid snapshot');
          for(const event of parsed.data.events)rememberFailure(event);
          if(parsed.data.snapshot.status==='running'){
            lastRunningSequence=Math.max(lastRunningSequence,parsed.data.snapshot.sequence);
            if(publicFailure&&publicFailure.sequence<=lastRunningSequence)publicFailure=undefined;
          }
          if(parsed.data.snapshot.status==='error')store.getState().setError(publicFailure&&publicFailure.sequence<=parsed.data.snapshot.sequence?publicFailure.message:'运行失败，请检查输入预算、模型配置或响应限制。历史输出已保留。',generation);
          // The subscription snapshot already includes its replay events.
          if (applyBuffered()) {
            store.getState().setSyncStatus('ready', generation);
            return;
          }
          // Only a non-advancing gap spends the retry budget; live structural events can keep arriving.
          stalled = parsed.data.nextCursor > cursor ? 0 : stalled + 1;
          if (stalled >= 2) throw new Error('Unresolved sequence gap');
        }
      } catch {
        if (current(generation)) {
          store.getState().setSyncStatus('error', generation);
          store.getState().setError('同步运行状态失败，已保留当前文本。请重试同步。', generation);
        }
      } finally {
        finished = true;
        if (flight?.generation === generation) flight = undefined;
      }
    })();
    if (!finished) flight = { generation, promise: operation };
    return operation;
  }

  const ownsCommand = (id: number, generation: number) => current(generation) && store.getState().pending?.id === id;
  async function createRoom() {
    if (!mounted) return;
    const token = store.getState().beginCommand('create');
    if (token === undefined) return;
    const { generation, draft } = store.getState();
    try {
      const result = await api.room.createDemo(draft.trim());
      if (ownsCommand(token, generation)) selectRoom(result.roomId, draft.trim());
    } catch {
      if (ownsCommand(token, generation)) store.getState().setError('创建任务失败，请稍后重试。', generation);
    } finally { store.getState().endCommand(token); }
  }
  async function startRun() {
    if (!mounted || options.requireRoom && !store.getState().roomId) return;
    const token = store.getState().beginCommand('start');
    if (token === undefined) return;
    const { generation, draft, roomId } = store.getState();
    const task = draft.trim();
    try {
      const selectedRoom = roomId ?? (await api.room.createDemo(task)).roomId;
      if (!ownsCommand(token, generation)) return;
      const result = await api.run.start({ roomId: selectedRoom, task, workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
      if (!ownsCommand(token, generation)) return;
      const parsed = runSnapshotSchema.safeParse(result);
      if (!parsed.success || parsed.data.roomId !== selectedRoom) throw new Error('Invalid start response');
      clearBuffer();
      store.getState().selectRun(result.runId);
      store.getState().applySnapshot(parsed.data, store.getState().generation);
      saveIdentity(result.runId);
      await synchronize();
    } catch {
      if (ownsCommand(token, generation)) store.getState().setError('启动协作失败，请检查当前任务状态。', generation);
    } finally { store.getState().endCommand(token); }
  }
  async function perform(command:RendererCommand,invoke:(runId:string)=>Promise<void>){
    if (!mounted) return;
    const token = store.getState().beginCommand(command);
    if (token === undefined) return;
    const { generation, runId } = store.getState();
    try {
      await invoke(runId!);
      // A newer Main state may have acknowledged this long-running command already.
      if (current(generation) && (!store.getState().pending || ownsCommand(token, generation))) await synchronize();
    } catch {
      if (ownsCommand(token, generation)) store.getState().setError('操作失败，请检查当前运行状态后再试。', generation);
    } finally { store.getState().endCommand(token); }
  }
  function control(command:RunControl){return perform(command,id=>api.run[command](id));}
  function repeat(command:'retryTurn'|'continueMessage'){
    const snapshot=store.getState().snapshot;const turn=snapshot?.turns.at(-1);const attempt=snapshot?.attempts?.filter(a=>a.turnId===turn?.turnId).at(-1);
    return perform(command,id=>command==='retryTurn'?api.run.retryTurn(id,turn!.turnId):api.run.continueMessage(id,attempt!.messageId));
  }
  function recover(decision:InterruptedRunDecision){
    if(!canRecover(store.getState(),decision))return Promise.resolve();
    return perform('recoverInterruptedRun',id=>api.run.recoverInterruptedRun(id,decision));
  }
  function mount() {
    if (disposeMount) return disposeMount;
    mounted = true;
    let unsubscribe: () => void;
    try { unsubscribe = api.run.onEvent(queueEvent); }
    catch {
      store.getState().setSyncStatus('error', store.getState().generation);
      store.getState().setError('无法订阅运行状态，请刷新窗口。', store.getState().generation);
      return () => { mounted = false; clearBuffer(); store.getState().selectRoom(); };
    }
    try {
      const saved = storage?.getItem(savedRunKey);
      if (saved) void selectRun(saved);
    } catch { store.getState().setError('无法读取任务位置，请重新选择历史任务。', store.getState().generation); }
    let disposed = false;
    disposeMount = () => {
      if (disposed) return;
      disposed = true;
      mounted = false;
      unsubscribe();
      clearBuffer();
      store.getState().selectRoom();
      disposeMount = undefined;
    };
    return disposeMount;
  }
  return { store, mount, selectRun, selectRoom, synchronize, createRoom, startRun, control,repeat,recover };
}
