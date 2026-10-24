import { useCallback, useEffect, useRef, useState } from 'react';
import { ChartColumn, PanelLeftClose, Plus, Settings2, Users, X } from 'lucide-react';
import type { RoomConfiguration, RoomManagementApiContract, RunSummary } from '../../../shared/contracts/configuration';
import { Button, IconButton, cx } from '../../components/ui';
import { statusLabels } from '../../locales/zhCN';
import { Logo } from './Logo';

const RUNS_SHOWN = 12;
const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];

/** Rooms and, for the current room, its discussions newest first; refreshed when the caller's key changes. */
export function useRoomDirectory(api: RoomManagementApiContract, roomId: string | undefined, refreshKey: string) {
  const [rooms, setRooms] = useState<RoomConfiguration[]>();
  const [runs, setRuns] = useState<{ roomId: string; items: RunSummary[] }>();
  const [failed, setFailed] = useState(false);
  const request = useRef(0);
  const load = useCallback(async () => {
    const token = ++request.current;
    try {
      const next = await api.listRooms({ includeArchived: false });
      if (token !== request.current) return;
      setRooms(Array.isArray(next) ? next : []); setFailed(false);
      if (!roomId) { setRuns(undefined); return; }
      // Pages come oldest first; read up to 500 so the newest discussions are known.
      const items: RunSummary[] = []; let cursor: Parameters<RoomManagementApiContract['listRoomRuns']>[0]['cursor'];
      for (let page = 0; page < 5; page++) {
        const result = await api.listRoomRuns({ roomId, limit: 100, ...(cursor ? { cursor } : {}) });
        if (!result) break;
        items.push(...result.items);
        if (!result.hasMore || !result.nextCursor) break;
        cursor = result.nextCursor;
      }
      if (token === request.current) setRuns({ roomId, items: items.reverse() });
    } catch { if (token === request.current) setFailed(true); }
  }, [api, roomId]);
  useEffect(() => { void load(); }, [load, refreshKey]);
  return { rooms, runs: runs && runs.roomId === roomId ? runs.items : [], failed, reload: load };
}

type Props = {
  rooms?: RoomConfiguration[]; runs: RunSummary[]; failed: boolean; onRetry: () => void;
  roomId?: string; runId?: string; page: string; ready: boolean; monthSpend?: string; noRealProvider?: boolean;
  onSelectRoom: (id: string) => void; onSelectRun: (id: string) => void; onNewDiscussion: () => void;
  onManageRooms: () => void; onOpenUsage: () => void; onOpenSettings: () => void;
  onCollapse?: () => void; onClose?: () => void;
};

/** Left navigation: rooms and their discussions, a new discussion, and usage and settings at the bottom. */
export function Sidebar({ rooms, runs, failed, onRetry, roomId, runId, page, ready, monthSpend, noRealProvider, onSelectRoom, onSelectRun, onNewDiscussion, onManageRooms, onOpenUsage, onOpenSettings, onCollapse, onClose }: Props) {
  const [showAll, setShowAll] = useState(false);
  useEffect(() => setShowAll(false), [roomId]);
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  return <nav className="sidebar" aria-label="应用导航">
    <div className="sb-top"><div className="brand"><Logo />AI 圆桌</div>
      {onClose ? <IconButton icon={X} label="关闭导航" onClick={onClose} data-autofocus /> : onCollapse && <IconButton icon={PanelLeftClose} label="收起导航" onClick={onCollapse} />}</div>
    <Button className="sb-new" icon={Plus} disabled={!ready || !roomId} title={roomId ? '在当前房间开始一场新的讨论' : '先在房间里建好成员'} onClick={onNewDiscussion}>新讨论</Button>
    <div className="sb-scroll">
      <div className="sb-label"><span>房间</span><button type="button" className="sb-manage" disabled={!ready} onClick={onManageRooms}>管理房间与成员</button></div>
      {failed && <p className="sb-empty" role="alert">房间列表没有读出来。<button type="button" className="link-btn" onClick={onRetry}>重试</button></p>}
      {rooms && rooms.length === 0 && <p className="sb-empty">还没有房间。点「管理房间与成员」新建一个，配好成员后就能开始讨论。</p>}
      {!rooms && !failed && <p className="sb-empty" role="status">正在读取房间…</p>}
      <ul className="sb-rooms">{rooms?.map(room => {
        const current = room.id === roomId;
        return <li key={room.id}>
          <button type="button" className="sb-item" aria-current={current && page === 'discussion' && !runId ? 'page' : undefined} aria-expanded={current}
            disabled={!ready} onClick={() => onSelectRoom(room.id)} title={room.objective || room.name}>
            <Users aria-hidden size={16} /><span className="t">{room.name}</span></button>
          {current && <ul className="sb-runs" aria-label={`${room.name} 的讨论记录`}>
            {runs.length === 0 && <li className="sb-empty small">还没有讨论。写下目标就能开始第一场。</li>}
            {shown.map(run => <li key={run.id}>
              <button type="button" className="sb-item" aria-current={run.id === runId && page === 'discussion' ? 'page' : undefined} onClick={() => onSelectRun(run.id)}
                title={`${run.task ?? '旧任务（目标未知）'} · ${statusLabels[run.status] ?? run.status}`}>
                <span className={cx('run-dot', liveStatuses.includes(run.status) && 'is-live', run.status === 'error' && 'is-warn')} aria-hidden />
                <span className="t">{run.task ?? '旧任务（目标未知）'}</span><span className="sr-only">（{statusLabels[run.status] ?? run.status}）</span></button>
            </li>)}
            {runs.length > RUNS_SHOWN && <li><button type="button" className="sb-more" onClick={() => setShowAll(value => !value)}>{showAll ? '收起' : `显示全部 ${runs.length} 场`}</button></li>}
          </ul>}
        </li>;
      })}</ul>
    </div>
    <div className="sb-foot">
      <button type="button" className="sb-item" aria-current={page === 'usage' ? 'page' : undefined} aria-describedby={monthSpend ? 'sb-month' : undefined} onClick={onOpenUsage}><ChartColumn aria-hidden size={16} /><span className="t">用量</span>{monthSpend && <span className="meta" id="sb-month" aria-hidden>本月 {monthSpend}</span>}</button>
      <button type="button" className="sb-item" aria-current={page === 'settings' ? 'page' : undefined} aria-describedby={noRealProvider ? 'sb-no-model' : undefined} onClick={onOpenSettings}><Settings2 aria-hidden size={16} /><span className="t">设置</span>{noRealProvider && <span className="meta warn-text" id="sb-no-model" aria-hidden>未连接模型</span>}</button>
    </div>
  </nav>;
}
