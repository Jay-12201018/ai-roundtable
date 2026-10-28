import { useCallback, useEffect, useRef, useState } from 'react';
import { ChartColumn, PanelLeftClose, Plus, Settings2, Users, X } from 'lucide-react';
import type { RoomConfiguration, RoomManagementApiContract, RunSummary } from '../../../shared/contracts/configuration';
import { Button, IconButton, cx } from '../../components/ui';
import { statusLabels } from '../../locales/zhCN';
import { Logo } from './Logo';

const RUNS_SHOWN = 12;
const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];

/** Rooms (with how many members take part), archived rooms apart, and the current room's discussions newest first. */
export function useRoomDirectory(api: RoomManagementApiContract, roomId: string | undefined, refreshKey: string) {
  const [rooms, setRooms] = useState<RoomConfiguration[]>();
  const [archived, setArchived] = useState<RoomConfiguration[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [runs, setRuns] = useState<{ roomId: string; items: RunSummary[] }>();
  const [failed, setFailed] = useState(false);
  const [runsFailed, setRunsFailed] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const token = ++request.current;
    let list: RoomConfiguration[];
    try {
      const all = await api.listRooms({ includeArchived: true });
      if (token !== request.current) return;
      list = Array.isArray(all) ? all : [];
      setRooms(list.filter(room => !room.archivedAt)); setArchived(list.filter(room => room.archivedAt)); setFailed(false);
    } catch { if (token === request.current) setFailed(true); return; }
    // Members who take part (enabled, not archived) per room; a room whose members fail to load shows no count.
    void Promise.all(list.map(room => api.listAgentConfigurations({ roomId: room.id }).then(agents => [room.id, agents.filter(agent => agent.enabled && !agent.archivedAt).length] as const, () => undefined)))
      .then(rows => { if (token === request.current) setCounts(new Map(rows.filter((row): row is readonly [string, number] => Boolean(row)))); });
    if (!roomId) { setRuns(undefined); setRunsFailed(false); return; }
    // Pages come oldest first, so read them all: only the last page holds the newest discussions, and the room page
    // counts and lists every one. A page that fails (or a cursor that does not move) leaves the list unread, never cut short.
    try {
      const items: RunSummary[] = []; let cursor: Parameters<RoomManagementApiContract['listRoomRuns']>[0]['cursor'];
      for (;;) {
        const result = await api.listRoomRuns({ roomId, limit: 100, ...(cursor ? { cursor } : {}) });
        if (token !== request.current) return;
        if (!result) throw new Error('No page');
        items.push(...result.items);
        if (!result.hasMore) break;
        if (!result.nextCursor || JSON.stringify(result.nextCursor) === JSON.stringify(cursor)) throw new Error('Cursor did not advance');
        cursor = result.nextCursor;
      }
      setRuns({ roomId, items: items.reverse() }); setRunsFailed(false);
    } catch { if (token === request.current) setRunsFailed(true); }
  }, [api, roomId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return { rooms, archived, counts, runs: runs && runs.roomId === roomId ? runs.items : [], runsLoaded: runs?.roomId === roomId, failed, runsFailed, reload: load };
}

type Props = {
  rooms?: RoomConfiguration[]; archived?: RoomConfiguration[]; counts?: ReadonlyMap<string, number>; runs: RunSummary[]; failed: boolean; runsFailed?: boolean; onRetry: () => void;
  roomId?: string; runId?: string; page: string; ready: boolean; monthSpend?: string; noRealProvider?: boolean; emptyText?: string;
  onOpenRoom: (id: string) => void; onSelectRun: (id: string) => void; onNewDiscussion: () => void; onNewRoom: () => void;
  onOpenUsage: () => void; onOpenSettings: () => void; onHome?: () => void;
  onCollapse?: () => void; onClose?: () => void;
};

/** Left navigation: rooms with their member counts and, under the current room, its discussions; usage and settings at the bottom. */
export function Sidebar({ rooms, archived = [], counts, runs, failed, runsFailed, onRetry, roomId, runId, page, ready, monthSpend, noRealProvider, emptyText, onOpenRoom, onSelectRun, onNewDiscussion, onNewRoom, onOpenUsage, onOpenSettings, onHome, onCollapse, onClose }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => setShowAll(false), [roomId]);
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  const roomItem = (room: RoomConfiguration) => {
    const current = room.id === roomId; const count = counts?.get(room.id);
    return <li key={room.id}>
      <button type="button" className="sb-item" aria-current={current && page === 'rooms' ? 'page' : undefined} aria-expanded={!room.archivedAt ? current : undefined}
        aria-label={room.name} aria-describedby={count !== undefined ? `sb-count-${room.id}` : undefined}
        disabled={!ready} onClick={() => onOpenRoom(room.id)} title={room.objective || room.name}>
        <Users aria-hidden size={16} /><span className="t">{room.name}</span>{count !== undefined && <span className="meta" id={`sb-count-${room.id}`} title={`${count} 位成员参与讨论（不含暂停参与的）`}>{count} 人</span>}</button>
      {current && !room.archivedAt && <ul className="sb-runs" aria-label={`${room.name} 的讨论记录`}>
        {runsFailed && <li className="sb-empty small" role="alert">讨论记录没有读完。<button type="button" className="link-btn" onClick={onRetry}>重试</button></li>}
        {runs.length === 0 && !runsFailed && <li className="sb-empty small">还没有讨论。写下目标就能开始第一场。</li>}
        {shown.map(run => <li key={run.id}>
          <button type="button" className="sb-item" aria-current={run.id === runId && page === 'discussion' ? 'page' : undefined} onClick={() => onSelectRun(run.id)}
            title={`${run.task ?? '旧任务（目标未知）'} · ${statusLabels[run.status] ?? run.status}`}>
            <span className={cx('run-dot', liveStatuses.includes(run.status) && 'is-live', run.status === 'error' && 'is-warn')} aria-hidden />
            <span className="t">{run.task ?? '旧任务（目标未知）'}</span><span className="sr-only">（{statusLabels[run.status] ?? run.status}）</span></button>
        </li>)}
        {runs.length > RUNS_SHOWN && <li><button type="button" className="sb-more" onClick={() => setShowAll(value => !value)}>{showAll ? '收起' : `显示全部 ${runs.length} 场`}</button></li>}
      </ul>}
    </li>;
  };
  return <nav className="sidebar" aria-label="应用导航">
    <div className="sb-top">{onHome ? <button type="button" className="brand brand-home" onClick={onHome} title="回到首页（新讨论或欢迎页）">{<Logo />}AI 圆桌</button> : <div className="brand"><Logo />AI 圆桌</div>}
      {onClose ? <IconButton icon={X} label="关闭导航" onClick={onClose} data-autofocus /> : onCollapse && <IconButton icon={PanelLeftClose} label="收起导航" onClick={onCollapse} />}</div>
    <Button className="sb-new" icon={Plus} disabled={!ready || !roomId} title={roomId ? '在当前房间开始一场新的讨论' : '先建一个房间'} onClick={onNewDiscussion}>新讨论</Button>
    <div className="sb-scroll">
      <div className="sb-label"><span>房间</span><IconButton size="sm" icon={Plus} label="新建房间" disabled={!ready} onClick={onNewRoom} /></div>
      {failed && <p className="sb-empty" role="alert">房间列表没有读出来。<button type="button" className="link-btn" onClick={onRetry}>重试</button></p>}
      {rooms && rooms.length === 0 && <p className="sb-empty">{emptyText ?? '还没有房间。点「+」新建一个，会带好三位默认成员。'}</p>}
      {!rooms && !failed && <p className="sb-empty" role="status">正在读取房间…</p>}
      <ul className="sb-rooms">{rooms?.map(roomItem)}</ul>
      {archived.length > 0 && <div className="sb-archived">
        <button type="button" className="sb-more" aria-expanded={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? '收起已归档' : `已归档（${archived.length}）`}</button>
        {showArchived && <ul className="sb-rooms">{archived.map(roomItem)}</ul>}
      </div>}
    </div>
    <div className="sb-foot">
      <button type="button" className="sb-item" aria-current={page === 'usage' ? 'page' : undefined} aria-label="用量" aria-describedby={monthSpend ? 'sb-month' : undefined} onClick={onOpenUsage}><ChartColumn aria-hidden size={16} /><span className="t">用量</span>{monthSpend && <span className="meta" id="sb-month" aria-hidden>本月 {monthSpend}</span>}</button>
      <button type="button" className="sb-item" aria-current={page === 'settings' ? 'page' : undefined} aria-label="设置" aria-describedby={noRealProvider ? 'sb-no-model' : undefined} onClick={onOpenSettings}><Settings2 aria-hidden size={16} /><span className="t">设置</span>{noRealProvider && <span className="meta warn-text" id="sb-no-model" aria-hidden>未连接模型</span>}</button>
    </div>
  </nav>;
}
