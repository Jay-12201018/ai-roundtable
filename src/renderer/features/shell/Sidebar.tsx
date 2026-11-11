import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArchiveRestore, ChartColumn, Folder, FolderOpen, PanelLeftClose, Plus, Settings2, X } from 'lucide-react';
import type { RoomConfiguration, RoomManagementApiContract, RunSummary, StandaloneDiscussion } from '../../../shared/contracts/configuration';
import { Avatar, Button, IconButton, cx } from '../../components/ui';
import { runStatusLabel } from '../../locales/zhCN';
import { Logo } from './Logo';

const RUNS_SHOWN = 12;
const RECENT_SHOWN = 12;
const FACES_SHOWN = 3;
const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];
const taskOf = (run: Pick<RunSummary, 'task'>) => run.task?.trim() || '旧任务（目标未知）';

/**
 * What the sidebar lists (D167): the projects (with how many members take part), every 独立讨论 that has started, the room now
 * open whatever its kind, and that room's discussions newest first.
 */
export function useRoomDirectory(api: RoomManagementApiContract, roomId: string | undefined, refreshKey: string) {
  const [rooms, setRooms] = useState<RoomConfiguration[]>();
  const [archived, setArchived] = useState<RoomConfiguration[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const [runs, setRuns] = useState<{ roomId: string; items: RunSummary[] }>();
  const [standalone, setStandalone] = useState<StandaloneDiscussion[]>();
  const [current, setCurrent] = useState<RoomConfiguration>();
  const [failed, setFailed] = useState(false);
  const [runsFailed, setRunsFailed] = useState(false);
  const [recentFailed, setRecentFailed] = useState(false);
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
    // Members who take part (enabled, not archived) per project; a project whose members fail to load shows no count.
    void Promise.all(list.map(room => api.listAgentConfigurations({ roomId: room.id }).then(agents => [room.id, agents.filter(agent => agent.enabled && !agent.archivedAt).length] as const, () => undefined)))
      .then(rows => { if (token === request.current) setCounts(new Map(rows.filter((row): row is readonly [string, number] => Boolean(row)))); });
    void Promise.resolve().then(() => api.listStandalone({ includeArchived: true })).then(items => {
      if (token === request.current) { setStandalone(Array.isArray(items) ? items : []); setRecentFailed(false); }
    }, () => { if (token === request.current) setRecentFailed(true); });
    if (!roomId) { setRuns(undefined); setRunsFailed(false); setCurrent(undefined); return; }
    // The open room may be a 独立讨论, which the project list does not have.
    void Promise.resolve().then(() => list.find(room => room.id === roomId) ?? api.getRoomConfiguration({ id: roomId }))
      .then(room => { if (token === request.current) setCurrent(room); }, () => { if (token === request.current) setCurrent(undefined); });
    // Pages come oldest first, so read them all: only the last page holds the newest discussions, and the project page
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
  return { rooms, archived, counts, runs: runs && runs.roomId === roomId ? runs.items : [], runsLoaded: runs?.roomId === roomId, failed, runsFailed, reload: load,
    current: current?.id === roomId ? current : undefined,
    recent: standalone?.filter(item => !item.room.archivedAt), archivedRecent: standalone?.filter(item => item.room.archivedAt) ?? [], recentFailed };
}

type Props = {
  rooms?: RoomConfiguration[]; archived?: RoomConfiguration[]; counts?: ReadonlyMap<string, number>; runs: RunSummary[]; failed: boolean; runsFailed?: boolean; onRetry: () => void;
  recent?: StandaloneDiscussion[]; archivedRecent?: StandaloneDiscussion[]; recentFailed?: boolean;
  /** The room now open, and whether it is a 独立讨论 that has not started (the 新讨论 page). */
  roomId?: string; composing?: boolean; runId?: string; page: string; ready: boolean; monthTokens?: string; noRealProvider?: boolean; emptyText?: string;
  onOpenRoom: (id: string) => void; onSelectRun: (id: string) => void; onNewDiscussion: () => void; onNewRoom: () => void; onNewInRoom?: (id: string) => void;
  onArchiveDiscussion?: (roomId: string, archived: boolean) => void;
  onOpenUsage: () => void; onOpenSettings: () => void; onHome?: () => void;
  onCollapse?: () => void; onClose?: () => void;
};

/** Who took part, as a few small faces; the names are in the row's title, so the faces are decoration. */
function Faces({ names }: { names: readonly string[] }) {
  if (!names.length) return <span className="sb-faces is-empty" aria-hidden />;
  return <span className="avatar-stack sb-faces" aria-hidden>
    {names.slice(0, FACES_SHOWN).map((name, index) => <Avatar key={`${name}-${index}`} name={name} size="sm" />)}
    {names.length > FACES_SHOWN && <span className="avatar is-sm sb-faces-more">+{names.length - FACES_SHOWN}</span>}
  </span>;
}

/**
 * Left navigation (D167): 新讨论 starts a 独立讨论 at once; 项目 lists the projects, and the open one shows its discussions;
 * 最近讨论 lists the discussions that belong to no project, newest first, with who took part; usage and settings at the bottom.
 */
export function Sidebar({ rooms, archived = [], counts, runs, failed, runsFailed, onRetry, recent, archivedRecent = [], recentFailed, roomId, composing, runId, page, ready, monthTokens, noRealProvider, emptyText,
  onOpenRoom, onSelectRun, onNewDiscussion, onNewRoom, onNewInRoom, onArchiveDiscussion, onOpenUsage, onOpenSettings, onHome, onCollapse, onClose }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [showAllRecent, setShowAllRecent] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  useEffect(() => setShowAll(false), [roomId]);
  const shown = showAll ? runs : runs.slice(0, RUNS_SHOWN);
  const runItem = (run: RunSummary) => <li key={run.id}>
    <button type="button" className="sb-item" aria-current={run.id === runId && page === 'discussion' ? 'page' : undefined} onClick={() => onSelectRun(run.id)}
      title={`${taskOf(run)} · ${runStatusLabel(run)}`}>
      <span className={cx('run-dot', liveStatuses.includes(run.status) && 'is-live', run.status === 'error' && 'is-warn')} aria-hidden />
      <span className="t">{taskOf(run)}</span><span className="sr-only">（{runStatusLabel(run)}）</span></button>
  </li>;
  const roomItem = (room: RoomConfiguration) => {
    const current = room.id === roomId; const count = counts?.get(room.id); const open = current && !room.archivedAt;
    const Icon = open ? FolderOpen : Folder;
    return <li key={room.id} className={cx('sb-project', open && onNewInRoom && 'has-act')}>
      <button type="button" className="sb-item" aria-current={current && page === 'rooms' ? 'page' : undefined} aria-expanded={!room.archivedAt ? current : undefined}
        aria-label={room.name} aria-describedby={count !== undefined ? `sb-count-${room.id}` : undefined}
        disabled={!ready} onClick={() => onOpenRoom(room.id)} title={room.name}>
        <Icon aria-hidden size={16} /><span className="t">{room.name}</span>{count !== undefined && <span className="meta" id={`sb-count-${room.id}`} title={`${count} 位成员参与讨论（不含暂停参与的）`}>{count} 人</span>}</button>
      {open && onNewInRoom && <IconButton size="sm" className="sb-row-act is-shown" icon={Plus} label={`在「${room.name}」里开新讨论`} disabled={!ready} onClick={() => onNewInRoom(room.id)} />}
      {open && <ul className="sb-runs" aria-label={`${room.name} 的讨论`}>
        {runsFailed && <li className="sb-empty small" role="alert">讨论记录没有读完。<button type="button" className="link-btn" onClick={onRetry}>重试</button></li>}
        {runs.length === 0 && !runsFailed && <li className="sb-empty small">这个项目还没有讨论，点右边的「+」开第一场。</li>}
        {shown.map(runItem)}
        {runs.length > RUNS_SHOWN && <li><button type="button" className="sb-more" onClick={() => setShowAll(value => !value)}>{showAll ? '收起' : `显示全部 ${runs.length} 场`}</button></li>}
      </ul>}
    </li>;
  };
  const recentItem = ({ room, run, members }: StandaloneDiscussion) => {
    const live = liveStatuses.includes(run.status); const title = taskOf(run); const archivedRow = Boolean(room.archivedAt);
    return <li key={run.id} className="sb-recent">
      <button type="button" className="sb-item" aria-current={run.id === runId && page === 'discussion' ? 'page' : undefined} onClick={() => onSelectRun(run.id)}
        title={`${title} · ${members.length ? members.join('、') : '成员未记录'} · ${runStatusLabel(run)}`}>
        <Faces names={members} /><span className="t">{title}</span>
        {(live || run.status === 'error' || run.status === 'interrupted') && <span className={cx('run-dot', live ? 'is-live' : 'is-warn')} aria-hidden />}
        <span className="sr-only">（{members.length ? `成员：${members.join('、')}；` : ''}{runStatusLabel(run)}）</span></button>
      {onArchiveDiscussion && (archivedRow
        ? <IconButton size="sm" className="sb-row-act" icon={ArchiveRestore} label={`恢复「${title}」`} onClick={() => onArchiveDiscussion(room.id, false)} />
        : <IconButton size="sm" className="sb-row-act" icon={Archive} label={live ? `「${title}」还在进行，先停止它再归档` : `归档「${title}」`} disabled={live} onClick={() => onArchiveDiscussion(room.id, true)} />)}
    </li>;
  };
  const recentShown = showAllRecent ? recent ?? [] : (recent ?? []).slice(0, RECENT_SHOWN);
  const archivedCount = archived.length + archivedRecent.length;
  return <nav className="sidebar" aria-label="应用导航">
    <div className="sb-top">{onHome ? <button type="button" className="brand brand-home" onClick={onHome} title="回到首页（新讨论或欢迎页）">{<Logo />}AI 圆桌</button> : <div className="brand"><Logo />AI 圆桌</div>}
      {onClose ? <IconButton icon={X} label="关闭导航" onClick={onClose} data-autofocus /> : onCollapse && <IconButton icon={PanelLeftClose} label="收起导航" onClick={onCollapse} />}</div>
    <Button className="sb-new" icon={Plus} disabled={!ready} aria-current={composing && page === 'discussion' ? 'page' : undefined} title="直接开一场讨论，不用先建项目；成员是常用阵容，开始前可以换" onClick={onNewDiscussion}>新讨论</Button>
    <div className="sb-scroll">
      <div className="sb-label"><span id="sb-projects">项目</span><IconButton size="sm" icon={Plus} label="新建项目" disabled={!ready} onClick={onNewRoom} /></div>
      {failed && <p className="sb-empty" role="alert">项目列表没有读出来。<button type="button" className="link-btn" onClick={onRetry}>重试</button></p>}
      {rooms && rooms.length === 0 && <p className="sb-empty">{emptyText ?? '还没有项目。几场讨论要共用成员和背景时，点「+」建一个。'}</p>}
      {!rooms && !failed && <p className="sb-empty" role="status">正在读取项目…</p>}
      <ul className="sb-rooms" aria-labelledby="sb-projects">{rooms?.map(roomItem)}</ul>

      <div className="sb-label sb-label-next"><span id="sb-recent">最近讨论</span></div>
      {recentFailed && <p className="sb-empty" role="alert">最近讨论没有读出来。<button type="button" className="link-btn" onClick={onRetry}>重试</button></p>}
      {recent && recent.length === 0 && !recentFailed && <p className="sb-empty">不属于任何项目的讨论会列在这里。点上面的「新讨论」开始一场。</p>}
      <ul className="sb-rooms sb-recents" aria-labelledby="sb-recent">{recentShown.map(recentItem)}</ul>
      {(recent?.length ?? 0) > RECENT_SHOWN && <button type="button" className="sb-more" onClick={() => setShowAllRecent(value => !value)}>{showAllRecent ? '收起' : `显示全部 ${recent!.length} 场`}</button>}

      {archivedCount > 0 && <div className="sb-archived">
        <button type="button" className="sb-more" aria-expanded={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? '收起已归档' : `已归档（${archivedCount}）`}</button>
        {showArchived && <>
          {archived.length > 0 && <ul className="sb-rooms" aria-label="已归档的项目">{archived.map(roomItem)}</ul>}
          {archivedRecent.length > 0 && <ul className="sb-rooms sb-recents" aria-label="已归档的讨论">{archivedRecent.map(recentItem)}</ul>}
        </>}
      </div>}
    </div>
    <div className="sb-foot">
      <button type="button" className="sb-item" aria-current={page === 'usage' ? 'page' : undefined} aria-label="用量" aria-describedby={monthTokens ? 'sb-month' : undefined} onClick={onOpenUsage}><ChartColumn aria-hidden size={16} /><span className="t">用量</span>{monthTokens && <span className="meta" id="sb-month" aria-hidden>本月 {monthTokens}</span>}</button>
      <button type="button" className="sb-item" aria-current={page === 'settings' ? 'page' : undefined} aria-label="设置" aria-describedby={noRealProvider ? 'sb-no-model' : undefined} onClick={onOpenSettings}><Settings2 aria-hidden size={16} /><span className="t">设置</span>{noRealProvider && <span className="meta warn-text" id="sb-no-model" aria-hidden>未连接模型</span>}</button>
    </div>
  </nav>;
}
