import { createStore } from 'zustand/vanilla';
import { runEventSchema, runSnapshotSchema } from '../../shared/schemas/run';
import type { RunEvent, RunSnapshot } from '../../shared/types/run';

export type RendererCommand = 'create' | 'start' | 'pause' | 'stop' | 'step' | 'resumeRun';
export type SyncStatus = 'idle' | 'syncing' | 'ready' | 'error';

export interface RendererState {
  generation: number;
  roomId?: string;
  runId?: string;
  snapshot?: RunSnapshot;
  draft: string;
  roomTask?: string;
  syncStatus: SyncStatus;
  error?: string;
  pending?: { id: number; command: RendererCommand; generation: number; sequence: number };
  setDraft(value: string): void;
  selectRoom(roomId?: string, task?: string): void;
  selectRun(runId: string): void;
  applySnapshot(snapshot: RunSnapshot, generation: number): boolean;
  applyDeltas(events: RunEvent[], generation: number): boolean;
  setSyncStatus(status: SyncStatus, generation: number): void;
  setError(message: string | undefined, generation: number): void;
  beginCommand(command: RendererCommand): number | undefined;
  endCommand(id: number): void;
}

export function canCommand(state: RendererState, command: RendererCommand): boolean {
  if (state.pending || state.syncStatus === 'syncing' || state.syncStatus === 'error') return false;
  const status = state.snapshot?.status;
  if (command === 'create' || command === 'start') {
    return Boolean(state.draft.trim()) && !(state.runId && !state.snapshot)
      && !['running', 'pausing', 'paused', 'cancelling'].includes(status ?? '');
  }
  if (!state.runId || !state.snapshot) return false;
  if (command === 'pause') return status === 'running';
  if (command === 'stop') return status === 'running' || status === 'pausing' || status === 'paused';
  return status === 'paused';
}

export function selectTaskTitle(state: RendererState): string {
  if (state.snapshot) return state.snapshot.execution?.task?.trim() || '历史任务（目标未记录）';
  return state.roomTask?.trim() || '新任务';
}

export function createRendererStore() {
  let nextCommandId = 0;
  return createStore<RendererState>((set, get) => ({
    generation: 0, draft: '设计一个校园跑腿平台', syncStatus: 'idle',
    setDraft: (draft) => set({ draft }),
    selectRoom: (roomId, roomTask) => set((state) => ({
      generation: state.generation + 1, roomId, roomTask, runId: undefined,
      snapshot: undefined, pending: undefined, error: undefined, syncStatus: 'idle',
    })),
    selectRun: (runId) => set((state) => ({
      generation: state.generation + 1, runId, roomId: undefined, roomTask: undefined,
      snapshot: undefined, pending: undefined, error: undefined, syncStatus: 'syncing',
    })),
    applySnapshot: (input, generation) => {
      const state = get();
      if (generation !== state.generation) return false;
      const parsed = runSnapshotSchema.safeParse(input);
      if (!parsed.success) return false;
      const snapshot = parsed.data;
      if (state.runId && snapshot.runId !== state.runId
        || state.roomId && snapshot.roomId !== state.roomId
        || state.snapshot && snapshot.sequence < state.snapshot.sequence) return false;
      const pending = state.pending;
      const acknowledged = pending && snapshot.sequence > pending.sequence && (
        pending.command === 'pause' && snapshot.status !== 'running'
        || (pending.command === 'step' || pending.command === 'resumeRun') && snapshot.status !== 'paused'
        || pending.command === 'stop' && ['cancelling', 'cancelled', 'completed', 'error', 'interrupted'].includes(snapshot.status)
      );
      set({ snapshot, roomId: snapshot.roomId, runId: snapshot.runId, pending: acknowledged ? undefined : pending });
      return true;
    },
    applyDeltas: (events, generation) => {
      const state = get();
      if (generation !== state.generation || !state.snapshot || !state.runId) return false;
      let snapshot = state.snapshot;
      for (const input of events) {
        const parsed = runEventSchema.safeParse(input);
        if (!parsed.success) return false;
        const event = parsed.data;
        if (event.runId !== state.runId || event.sequence !== snapshot.sequence + 1
          || event.type !== 'text_delta' && event.type !== 'reasoning_summary_delta' && event.type !== 'usage_updated') return false;
        const turnIndex = snapshot.turns.findIndex((turn) => turn.turnId === event.turnId);
        const turn = snapshot.turns[turnIndex];
        const messageIndex = snapshot.messages.findIndex((message) => message.id === turn?.messageId);
        const message = snapshot.messages[messageIndex];
        const attempt = snapshot.attempts?.find((item) => item.requestId === event.requestId);
        if (!turn || !message || turn.runId !== event.runId || turn.requestId !== event.requestId
          || turn.status !== 'running' || message.status !== 'streaming'
          || snapshot.currentTurnId !== undefined && snapshot.currentTurnId !== turn.turnId
          || snapshot.attempts !== undefined && (!attempt || attempt.runId !== event.runId
            || attempt.turnId !== turn.turnId || attempt.messageId !== message.id)
          || event.type !== 'usage_updated' && (event.payload.messageId !== message.id || event.payload.senderName !== message.senderName)) return false;
        if (event.type === 'text_delta') {
          const turns = [...snapshot.turns];
          const messages = [...snapshot.messages];
          turns[turnIndex] = { ...turn, outputText: (turn.outputText ?? message.content) + event.payload.text };
          messages[messageIndex] = { ...message, content: message.content + event.payload.text };
          snapshot = { ...snapshot, turns, messages };
        }
        snapshot = { ...snapshot, sequence: event.sequence, updatedAt: event.timestamp };
      }
      if (events.length) set({ snapshot });
      return true;
    },
    setSyncStatus: (syncStatus, generation) => { if (generation === get().generation) set({ syncStatus }); },
    setError: (error, generation) => { if (generation === get().generation) set({ error }); },
    beginCommand: (command) => {
      const state = get();
      if (!canCommand(state, command)) return undefined;
      const id = ++nextCommandId;
      set({ pending: { id, command, generation: state.generation, sequence: state.snapshot?.sequence ?? 0 }, error: undefined });
      return id;
    },
    endCommand: (id) => { if (get().pending?.id === id) set({ pending: undefined }); },
  }));
}
