import { useEffect, useMemo, useRef, useState } from 'react';
import type { RunEvent, RunSnapshot } from '../shared/types/run';
import { statusLabels } from './locales/zhCN';

type MessageView = { id: string; senderName: string; content: string; status: string };

export function App() {
  const [objective, setObjective] = useState('设计一个校园跑腿平台');
  const [roomId, setRoomId] = useState<string>();
  const [snapshot, setSnapshot] = useState<RunSnapshot>();
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [syncing, setSyncing] = useState(true);
  const selectedRun = useRef<string | undefined>(undefined);
  const lastSequence = useRef(0);
  const syncVersion = useRef(0);
  const synchronizing = useRef(false);
  const bufferedEvents = useRef(new Map<number, RunEvent>());
  const flushTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const startInFlight = useRef(false);

  const activeTurn = useMemo(() => snapshot?.turns.find((turn) => turn.status === 'running'), [snapshot]);
  const isActive = ['running', 'pausing', 'paused', 'cancelling'].includes(snapshot?.status ?? '');

  useEffect(() => {
    // Attach first, then buffer events while the authoritative snapshot is in flight.
    const unsubscribe = window.roundtable.run.onEvent(queueEvent);
    const savedRunId = localStorage.getItem('roundtable.runId');
    if (savedRunId) {
      resetRun(savedRunId);
      void syncRun(savedRunId);
    } else setSyncing(false);
    return () => { unsubscribe(); resetRun(); };
  }, []);

  function resetRun(id?: string) {
    selectedRun.current = id;
    lastSequence.current = 0;
    syncVersion.current += 1;
    synchronizing.current = false;
    bufferedEvents.current.clear();
    clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
  }

  async function syncRun(id: string) {
    const version = ++syncVersion.current;
    synchronizing.current = true;
    setSyncing(true);
    try {
      const subscription = await window.roundtable.run.subscribe(id, lastSequence.current);
      if (selectedRun.current !== id || version !== syncVersion.current) return;
      lastSequence.current = subscription.snapshot.sequence;
      setRoomId(subscription.snapshot.roomId);
      setSnapshot(subscription.snapshot);
      setMessages(subscription.snapshot.messages);
      for (const event of subscription.events) if (event.runId === id && event.sequence > lastSequence.current) bufferedEvents.current.set(event.sequence, event);
      synchronizing.current = false;
      setSyncing(false);
      flushEvents();
    } catch (cause) {
      if (selectedRun.current === id && version === syncVersion.current) {
        synchronizing.current = false;
        setSyncing(false);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    }
  }

  function queueEvent(event: RunEvent) {
    if (event.runId !== selectedRun.current || event.sequence <= lastSequence.current) return;
    bufferedEvents.current.set(event.sequence, event);
    if (!synchronizing.current && !flushTimer.current) flushTimer.current = setTimeout(flushEvents, 32);
  }

  function flushEvents() {
    clearTimeout(flushTimer.current);
    flushTimer.current = undefined;
    if (synchronizing.current) return;
    const events = [...bufferedEvents.current.values()].filter((event) => event.sequence > lastSequence.current).sort((a, b) => a.sequence - b.sequence);
    let cursor = lastSequence.current;
    for (const event of events) {
      if (event.sequence !== cursor + 1 || event.type === 'snapshot_required') {
        if (selectedRun.current) void syncRun(selectedRun.current);
        return;
      }
      cursor = event.sequence;
    }
    bufferedEvents.current.clear();
    lastSequence.current = cursor;
    if (!events.length) return;
    setMessages((current) => {
      let next = [...current];
      for (const event of events) {
        if (event.type === 'text_delta') {
          const payload = event.payload as { messageId: string; text: string; senderName?: string };
          const index = next.findIndex((message) => message.id === payload.messageId);
          if (index >= 0) next[index] = { ...next[index], content: next[index].content + payload.text };
          else next.push({ id: payload.messageId, senderName: payload.senderName ?? 'Mock Agent', content: payload.text, status: 'streaming' });
        } else if (['turn_completed', 'turn_aborted', 'turn_failed'].includes(event.type)) {
          const status = event.type === 'turn_completed' ? 'completed' : event.type === 'turn_aborted' ? 'aborted' : 'failed';
          next = next.map((message) => message.id === (event.payload as { messageId: string }).messageId ? { ...message, status } : message);
        }
      }
      return next;
    });
    setSnapshot((current) => {
      if (!current) return current;
      let next = { ...current, sequence: cursor, turns: [...current.turns] };
      for (const event of events) {
        if (event.type === 'run_state_changed') next.status = (event.payload as { status: RunSnapshot['status'] }).status;
        if (event.type === 'turn_started') {
          const payload = event.payload as { turnId: string; agentId: string; requestId: string; messageId: string };
          next.turns.push({ ...payload, runId: event.runId, status: 'running' });
        } else if (['turn_completed', 'turn_aborted', 'turn_failed'].includes(event.type)) {
          const status = event.type === 'turn_completed' ? 'completed' : event.type === 'turn_aborted' ? 'aborted' : 'failed';
          next.turns = next.turns.map((turn) => turn.turnId === (event.payload as { turnId: string }).turnId ? { ...turn, status } : turn);
        }
      }
      return next;
    });
  }

  async function createRoom() {
    if (startInFlight.current || synchronizing.current || isActive) return;
    setError(undefined);
    try {
      const result = await window.roundtable.room.createDemo(objective);
      resetRun();
      localStorage.removeItem('roundtable.runId');
      setRoomId(result.roomId);
      setMessages([]);
      setSnapshot(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function startRun() {
    if (startInFlight.current || synchronizing.current || isActive) return;
    startInFlight.current = true;
    setStarting(true);
    setError(undefined);
    try {
      const selectedRoom = roomId ?? (await window.roundtable.room.createDemo(objective)).roomId;
      const result = await window.roundtable.run.start({ roomId: selectedRoom, task: objective, workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
      resetRun(result.runId);
      localStorage.setItem('roundtable.runId', result.runId);
      setRoomId(selectedRoom);
      setSnapshot(result);
      setMessages(result.messages);
      await syncRun(result.runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      startInFlight.current = false;
      setStarting(false);
    }
  }

  async function control(action: 'pause' | 'stop' | 'step' | 'resumeRun') {
    const runId = selectedRun.current;
    if (!runId) return;
    try {
      await window.roundtable.run[action](runId);
      if (selectedRun.current === runId) await syncRun(runId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">AI 圆桌 <span>Mock Mode</span></div>
        <button onClick={() => void createRoom()} disabled={starting || syncing || isActive}>新建任务</button>
        <div className="room-card">{roomId ? objective : '还没有任务'}</div>
      </aside>
      <section className="timeline">
        <header>
          <div><small>当前任务</small><h1>{objective}</h1></div>
          <div className="status">{statusLabels[snapshot?.status ?? 'idle']} {activeTurn ? `· 第 ${(snapshot?.turns.indexOf(activeTurn) ?? 0) + 1} 回合` : ''}</div>
        </header>
        <div className="messages">
          {messages.length === 0 && <div className="empty">创建任务后启动 Mock 三 Agent 协作。</div>}
          {messages.map((message) => <article className="message" key={message.id}><strong>{message.senderName}</strong><p>{message.content}</p><small>{statusLabels[message.status] ?? '未知状态'}</small></article>)}
        </div>
        <div className="composer"><input aria-label="任务目标" value={objective} onChange={(event) => setObjective(event.target.value)} disabled={starting || syncing || isActive} /><button onClick={() => void startRun()} disabled={starting || syncing || isActive}>开始 Mock 协作</button></div>
        {error && <div className="error">{error}</div>}
      </section>
      <aside className="workbench">
        <h2>主持人控制</h2>
        <button onClick={() => void control('pause')} disabled={snapshot?.status !== 'running'}>暂停</button>
        <button onClick={() => void control('step')} disabled={snapshot?.status !== 'paused'}>下一步</button>
        <button onClick={() => void control('resumeRun')} disabled={snapshot?.status !== 'paused'}>继续</button>
        <button onClick={() => void control('stop')} disabled={!['running', 'pausing', 'paused'].includes(snapshot?.status ?? '')}>停止</button>
        <dl><dt>事件序列</dt><dd>{snapshot?.sequence ?? 0}</dd><dt>回合</dt><dd>{snapshot?.turns.length ?? 0}</dd></dl>
      </aside>
    </main>
  );
}
