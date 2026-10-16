import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomManagementApiContract, RoomMessagePage, RoomRunPage } from '../../../shared/contracts/configuration';
import { statusLabels } from '../../locales/zhCN';
import { errorText } from './ui';

const emptyRuns: RoomRunPage = { items: [], nextCursor: null, hasMore: false };
const emptyMessages: RoomMessagePage = { items: [], nextCursor: null, hasMore: false };
export function HistoryPanel({ api, roomId, onSelectRun }: { api: RoomManagementApiContract; roomId: string; onSelectRun: (id: string) => void }) {
  const [runs, setRuns] = useState<RoomRunPage>(emptyRuns); const [messages, setMessages] = useState<RoomMessagePage>(emptyMessages);
  const [selectedRun, setSelectedRun] = useState<string>();
  const [runLoading, setRunLoading] = useState(false); const [messageLoading, setMessageLoading] = useState(false);
  const [runError, setRunError] = useState(''); const [messageError, setMessageError] = useState('');
  const requests = useRef({ runs: 0, messages: 0 }); const locks = useRef({ runs: false, messages: false }); const alive = useRef(true);
  const loadRuns = useCallback(async (cursor?: NonNullable<RoomRunPage['nextCursor']>) => {
    if (cursor && locks.current.runs) return;
    locks.current.runs = true; const token = ++requests.current.runs; setRunLoading(true); setRunError('');
    if (!cursor) { setRuns(emptyRuns); setSelectedRun(undefined); }
    try {
      const page = await api.listRoomRuns({ roomId, limit: 100, ...(cursor ? { cursor } : {}) });
      if (alive.current && token === requests.current.runs) setRuns(previous => ({ ...page, items: cursor ? [...previous.items, ...page.items] : page.items }));
    } catch (error) { if (alive.current && token === requests.current.runs) setRunError(errorText(error)); }
    finally { if (alive.current && token === requests.current.runs) { locks.current.runs = false; setRunLoading(false); } }
  }, [api, roomId]);
  const loadMessages = useCallback(async (cursor?: NonNullable<RoomMessagePage['nextCursor']>) => {
    if (cursor && locks.current.messages) return;
    locks.current.messages = true; const token = ++requests.current.messages; setMessageLoading(true); setMessageError('');
    if (!cursor) setMessages(emptyMessages);
    try {
      const page = await api.listRoomMessages({ roomId, limit: 100, ...(cursor ? { cursor } : {}) });
      if (alive.current && token === requests.current.messages) setMessages(previous => ({ ...page, items: cursor ? [...previous.items, ...page.items] : page.items }));
    } catch (error) { if (alive.current && token === requests.current.messages) setMessageError(errorText(error)); }
    finally { if (alive.current && token === requests.current.messages) { locks.current.messages = false; setMessageLoading(false); } }
  }, [api, roomId]);
  useEffect(() => {
    alive.current = true; void loadRuns(); void loadMessages();
    return () => { alive.current = false; requests.current.runs++; requests.current.messages++; };
  }, [loadRuns, loadMessages]);
  const visibleMessages = messages.items.filter(message => !selectedRun || message.runId === selectedRun);
  return <section aria-label="房间历史">
    <div className="rooms-toolbar"><div><h3>历史记录</h3><p className="rooms-secondary">按创建顺序浏览。刷新会重新固定分页范围。</p></div><button type="button" disabled={runLoading || messageLoading} onClick={() => { void loadRuns(); void loadMessages(); }}>刷新历史</button></div>
    <div className="rooms-history">
      <section aria-label="Run 列表"><h4>Run</h4>
        {runLoading && <p role="status">正在加载 Run…</p>}
        {runError && <p role="alert" className="rooms-error">{runError}<button type="button" disabled={runLoading} onClick={() => void loadRuns(runs.nextCursor ?? undefined)}>重试 Run 列表</button></p>}
        {!runLoading && !runError && !runs.items.length && <p>还没有 Run。开始协作后会在这里保留记录。</p>}
        <ul className="rooms-list">{runs.items.map(run => <li key={run.id}><button type="button" aria-current={selectedRun === run.id ? 'true' : undefined} onClick={() => { setSelectedRun(run.id); onSelectRun(run.id); }}>{run.task ?? '旧任务（目标未知）'}</button><p className="rooms-secondary">{statusLabels[run.status] ?? run.status} · <time dateTime={run.createdAt}>{new Date(run.createdAt).toLocaleString('zh-CN')}</time></p></li>)}</ul>
        {runs.hasMore && <button type="button" disabled={runLoading} onClick={() => void loadRuns(runs.nextCursor!)}>加载更多 Run</button>}
      </section>
      <section aria-label="历史消息"><div className="rooms-toolbar"><h4>{selectedRun ? '所选 Run 的消息' : '房间消息'}</h4>{selectedRun && <button type="button" onClick={() => setSelectedRun(undefined)}>查看全部消息</button>}</div>
        <p className="rooms-secondary">身份信息以 Run 冻结快照为准；历史消息保留当时的发送者姓名。活动 Run 的实时状态由执行视图同步。</p>
        {messageLoading && <p role="status">正在加载消息…</p>}
        {messageError && <p role="alert" className="rooms-error">{messageError}<button type="button" disabled={messageLoading} onClick={() => void loadMessages(messages.nextCursor ?? undefined)}>重试消息</button></p>}
        {!messageLoading && !messageError && !visibleMessages.length && <p>{messages.hasMore ? '已加载范围暂无对应消息，请继续加载。' : '暂无消息。'}</p>}
        <ol className="rooms-messages">{visibleMessages.map(message => <li key={message.id}><div className="rooms-toolbar"><strong>{message.senderName}</strong><span className="rooms-secondary">{message.senderType === 'agent' ? 'AI 成员' : message.senderType === 'user' ? '主持人' : '系统'} · {statusLabels[message.status] ?? message.status}</span></div><p className="rooms-prewrap">{message.content || '（无正文，执行证据已保留）'}</p><time className="rooms-secondary" dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString('zh-CN')}</time></li>)}</ol>
        {messages.hasMore && <button type="button" disabled={messageLoading} onClick={() => void loadMessages(messages.nextCursor!)}>加载更多消息</button>}
      </section>
    </div>
  </section>;
}
