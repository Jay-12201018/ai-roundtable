import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { statusLabels } from './locales/zhCN';
import { canCommand,canRecover, selectTaskTitle } from './store/rendererStore';
import { createRendererSession } from './subscriptions/rendererSession';

export function App() {
  const [session] = useState(() => createRendererSession(window.roundtable, localStorage));
  const snapshot = useStore(session.store, state => state.snapshot);
  const roomId = useStore(session.store, state => state.roomId);
  const draft = useStore(session.store, state => state.draft);
  const title = useStore(session.store, selectTaskTitle);
  const error = useStore(session.store, state => state.error);
  const pending = useStore(session.store, state => state.pending);
  const syncStatus = useStore(session.store, state => state.syncStatus);
  const createEnabled = useStore(session.store, state => canCommand(state, 'create'));
  const startEnabled = useStore(session.store, state => canCommand(state, 'start'));
  const pauseEnabled = useStore(session.store, state => canCommand(state, 'pause'));
  const stopEnabled = useStore(session.store, state => canCommand(state, 'stop'));
  const stepEnabled = useStore(session.store, state => canCommand(state, 'step'));
  const resumeEnabled = useStore(session.store, state => canCommand(state, 'resumeRun'));
  const retryEnabled = useStore(session.store,state=>canCommand(state,'retryTurn'));
  const continueEnabled = useStore(session.store,state=>canCommand(state,'continueMessage'));
  const recoverEnabled = useStore(session.store,state=>canRecover(state,'resume'));
  const inspectEnabled = useStore(session.store,state=>canRecover(state,'inspect'));
  useEffect(() => session.mount(), [session]);
  const activeTurn = snapshot?.turns.find(turn => turn.status === 'running');
  const messages = snapshot?.messages ?? [];

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">AI 圆桌 <span>Mock Mode</span></div>
        <button onClick={() => void session.createRoom()} disabled={!createEnabled}>新建任务</button>
        <div className="room-card">{roomId ? title : '还没有任务'}</div>
      </aside>
      <section className="timeline">
        <header>
          <div><small>当前任务</small><h1>{title}</h1></div>
          <div className="status" role="status">{statusLabels[snapshot?.status ?? 'idle']} {activeTurn ? `· 第 ${(snapshot?.turns.indexOf(activeTurn) ?? 0) + 1} 回合` : ''}</div>
        </header>
        <div className="messages">
          {messages.length === 0 && <div className="empty">创建任务后启动 Mock 三 Agent 协作。</div>}
          {messages.map(message => <article className="message" key={message.id}><strong>{message.senderName}</strong><p>{message.content}</p><small>{statusLabels[message.status] ?? '未知状态'}</small></article>)}
        </div>
        <div className="composer"><input aria-label="任务目标" value={draft} onChange={event => session.store.getState().setDraft(event.target.value)} /><button onClick={() => void session.startRun()} disabled={!startEnabled}>开始 Mock 协作</button></div>
        {syncStatus === 'syncing' && <div role="status">正在同步运行状态</div>}
        {pending && <div role="status">操作已发送，等待确认</div>}
        {snapshot?.status === 'interrupted' && <div>执行已中断，部分输出已保留。请先检查历史记录。</div>}
        {error && <div className="error" role="alert">{error}</div>}
        {syncStatus === 'error' && <button onClick={() => void session.synchronize()}>重试同步</button>}
      </section>
      <aside className="workbench">
        <h2>主持人控制</h2>
        <button onClick={() => void session.control('pause')} disabled={!pauseEnabled}>暂停</button>
        <button onClick={() => void session.control('step')} disabled={!stepEnabled}>下一步</button>
        <button onClick={() => void session.control('resumeRun')} disabled={!resumeEnabled}>继续</button>
        <button onClick={() => void session.control('stop')} disabled={!stopEnabled}>停止</button>
        {(snapshot?.status==='error'||snapshot?.status==='cancelled'||snapshot?.status==='interrupted')&&<>
          <button onClick={()=>void session.repeat('retryTurn')} disabled={!retryEnabled}>重试当前回合</button>
          <button onClick={()=>void session.repeat('continueMessage')} disabled={!continueEnabled}>续写部分回复</button>
        </>}
        {snapshot?.status==='interrupted'&&<>
          <button onClick={()=>void session.recover('inspect')} disabled={!inspectEnabled}>检查中断记录</button>
          <button onClick={()=>void session.recover('resume')} disabled={!recoverEnabled}>恢复后续回合</button>
          <button onClick={()=>void session.recover('discard')} disabled={!inspectEnabled}>放弃中断执行</button>
        </>}
        <dl><dt>事件序列</dt><dd>{snapshot?.sequence ?? 0}</dd><dt>回合</dt><dd>{snapshot?.turns.length ?? 0}</dd></dl>
      </aside>
    </main>
  );
}
