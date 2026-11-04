import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Archive, ArchiveRestore, CircleAlert, Ellipsis, GitBranch, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AgentConfiguration, CreateAgentInput, ProviderReadiness, ProviderSummary, RoomConfiguration, RoomManagementApiContract, RunSummary } from '../../../shared/contracts/configuration';
import { createRoomInputSchema } from '../../../shared/schemas/configuration';
import { Avatar, Button, Field, IconButton, Modal, Pill, Switch, Tag, cx, useDismiss } from '../../components/ui';
import { statusLabels } from '../../locales/zhCN';
import { delistedText, modelBlockText } from '../settings/model';
import { MemberDialog } from './MemberDialog';
import { roleShown, roomErrorText } from './templates';
import './rooms.css';

const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];
const when = (iso: string) => {
  const date = new Date(iso); const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return today ? `今天 ${time}` : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
};

/** One line per member: which model and whether it can take part now, as Main decides it (D114). */
export function memberLine(agent: AgentConfiguration, providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined): { text: string; warn: boolean } {
  if (agent.withheldModelId) return { text: '之前填的模型名像 API Key，已隐藏且不会使用；请重新选择模型', warn: true };
  if (!agent.providerId || !agent.modelId) return { text: '还没选模型，暂时不会参与讨论', warn: true };
  const provider = providers.find(item => item.id === agent.providerId);
  if (!provider) return { text: '所选服务已删除，暂时不会参与讨论', warn: true };
  if (provider.kind === 'mock') return { text: '演示（Mock）· 回复是预先写好的示例', warn: false };
  const name = provider.customModels.find(model => model.id === agent.modelId)?.name ?? agent.modelId;
  const row = readiness?.find(item => item.providerId === provider.id);
  const state = row?.models.find(model => model.modelId === agent.modelId);
  if (row?.supported === false) return { text: `${name} · 这个服务已不再支持，请换一个模型`, warn: true };
  if (!provider.enabled) return { text: `${name} · 服务已停用`, warn: true };
  if (row && !state || state?.blockedBy === 'unsupported') return { text: `${name} · ${row?.discovery?.outcome === 'listed' ? delistedText : '这个模型已不再支持'}，请换一个`, warn: true };
  if (!state) return { text: name, warn: false };
  if (state.usable && state.delisted) return { text: `${name} · ${delistedText}`, warn: true };
  return state.usable ? { text: `${name} · 可以使用`, warn: false } : { text: `${name} · ${modelBlockText(state)}`, warn: true };
}

export type RoomPageProps = {
  /** The member dialog shows the models: a moment a service's list may be looked at again. */
  onEditMember?: () => void;
  api: RoomManagementApiContract; room: RoomConfiguration; providers: readonly ProviderSummary[]; readiness: readonly ProviderReadiness[] | undefined;
  runs: RunSummary[]; workflow: { label: string; detail: string; onChange: () => void };
  onNewDiscussion: () => void; onOpenRun: (runId: string) => void; onOpenSettings: () => void;
  /** Members, names or archive state changed: the sidebar and discussion header reload. */
  onChanged: () => void; onDeleted: () => void;
};

/** 房间: one page — the room, its members (order, on/off, menu), its discussion mode, its discussions, and archive or delete. */
export function RoomPage({ api, room, providers, readiness, runs, workflow, onNewDiscussion, onOpenRun, onOpenSettings, onChanged, onDeleted, onEditMember }: RoomPageProps) {
  const [agents, setAgents] = useState<AgentConfiguration[]>(); const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<AgentConfiguration | 'new'>(); const [editingRoom, setEditingRoom] = useState(false);
  const [confirm, setConfirm] = useState<{ kind: 'room' } | { kind: 'agent'; agent: AgentConfiguration }>();
  const [showArchived, setShowArchived] = useState(false);
  const [dragging, setDragging] = useState<string>(); const [dropBefore, setDropBefore] = useState<string>();
  const request = useRef(0); const alive = useRef(true); const lock = useRef(false);
  useEffect(() => { if (editor) onEditMember?.(); }, [Boolean(editor)]);
  // Keyboard reordering keeps focus on the moved member's grip, so ↑/↓ can be pressed again.
  const refocus = useRef<string | undefined>(undefined);
  useEffect(() => { if (!refocus.current || !agents) return; document.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus(); refocus.current = undefined; }, [agents]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);
  const load = useCallback(async () => {
    const token = ++request.current;
    try { const next = await api.listAgentConfigurations({ roomId: room.id, includeArchived: true }); if (alive.current && token === request.current) { setAgents(next); setLoadFailed(false); } }
    catch { if (alive.current && token === request.current) setLoadFailed(true); }
  }, [api, room.id]);
  useEffect(() => { setAgents(undefined); setError(''); setNotice(''); setShowArchived(false); void load(); }, [load]);

  async function act(work: () => Promise<unknown>, done?: string) {
    if (lock.current) return false;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    const roomAtStart = room.id;
    try { await work(); if (alive.current && roomAtStart === room.id) { if (done) setNotice(done); await load(); onChanged(); } return true; }
    catch (cause) { if (alive.current) setError(roomErrorText(cause)); return false; }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  const active = (agents ?? []).filter(agent => !agent.archivedAt);
  const archived = (agents ?? []).filter(agent => agent.archivedAt);
  const enabledCount = active.filter(agent => agent.enabled).length;
  const reorder = (ids: string[]) => act(() => api.reorderAgents({ roomId: room.id, agentIds: ids }), '已保存新的发言顺序。');
  const move = (agent: AgentConfiguration, offset: number) => {
    const ids = active.map(item => item.id); const from = ids.indexOf(agent.id); const to = from + offset;
    if (from < 0 || to < 0 || to >= ids.length) return;
    ids.splice(to, 0, ...ids.splice(from, 1)); void reorder(ids);
  };
  const input = (agent: AgentConfiguration) => { const { archivedAt: _a, createdAt: _c, updatedAt: _u, withheldModelId: _w, ...rest } = agent; return rest; };
  const archivedRoom = Boolean(room.archivedAt);
  const live = runs.some(run => liveStatuses.includes(run.status));

  function drop(event: DragEvent, target: string) {
    event.preventDefault(); const from = dragging; setDragging(undefined); setDropBefore(undefined);
    if (!from || from === target) return;
    const ids = active.map(item => item.id).filter(id => id !== from); ids.splice(ids.indexOf(target), 0, from); void reorder(ids);
  }
  function gripKeys(event: KeyboardEvent, agent: AgentConfiguration) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); refocus.current = agent.id; move(agent, event.key === 'ArrowUp' ? -1 : 1); }
  }

  return <div className="page room-page"><div className="page-inner">
    <div className="page-head"><div className="grow"><h1>{room.name}{archivedRoom && <> <Pill>已归档</Pill></>}</h1>
      <p>{room.objective.trim() ? <>默认目标：{room.objective}。新讨论会预填这个目标，可以改。</> : '还没有默认目标。写一个，新讨论会自动填进输入框。'}</p></div>
      <div className="actions">{!archivedRoom && <Button icon={Pencil} disabled={busy} onClick={() => setEditingRoom(true)}>编辑</Button>}
        {archivedRoom ? <Button variant="primary" icon={ArchiveRestore} disabled={busy} onClick={() => void act(() => api.archiveRoom({ id: room.id, archived: false }), '已恢复这个房间。')}>恢复房间</Button>
          : <Button variant="primary" icon={Plus} disabled={busy} onClick={onNewDiscussion}>新讨论</Button>}</div></div>
    {notice && <p role="status" className="ok-text small room-notice">{notice}</p>}
    {error && !editor && !confirm && !editingRoom && <p role="alert" className="field-error room-notice">{error}</p>}

    <section className="section" aria-labelledby="room-members"><h2 id="room-members"><span className="grow">成员</span>
      {!archivedRoom && <Button size="sm" icon={Plus} disabled={busy || !agents} onClick={() => { setError(''); setEditor('new'); }}>添加成员</Button>}</h2>
      <p className="lead">按顺序轮流发言（选了讨论方式时按流程分配）。拖动或用方向键调整顺序。改动只影响之后开始的讨论。</p>
      {loadFailed && <p role="alert" className="field-error">成员没有读出来。<button type="button" className="link-btn" onClick={() => void load()}>重试</button></p>}
      {!agents && !loadFailed && <p role="status" className="muted">正在读取成员…</p>}
      {agents && active.length === 0 && <div className="card"><div className="card-row"><span className="grow"><b>还没有成员</b><small>添加几位成员，选好模型，就能开始讨论。</small></span></div></div>}
      {active.length > 0 && <ol className="card member-list" aria-label="成员">{active.map((agent, index) => {
        const line = memberLine(agent, providers, readiness); const role = roleShown(agent);
        return <li key={agent.id} className={cx('card-row', !agent.enabled && 'is-off', dragging === agent.id && 'is-dragging', dropBefore === agent.id && 'is-drop-before')}
          draggable={!busy && !archivedRoom} onDragStart={event => { setDragging(agent.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { setDragging(undefined); setDropBefore(undefined); }}
          onDragOver={event => { if (dragging) { event.preventDefault(); setDropBefore(agent.id); } }} onDrop={event => drop(event, agent.id)}>
          <button type="button" className="grip" data-grip={agent.id} aria-label={`调整「${agent.displayName}」的顺序：第 ${index + 1} 位，按上下方向键移动`} disabled={archivedRoom} onKeyDown={event => gripKeys(event, agent)}><GripVertical aria-hidden /></button>
          <Avatar name={agent.displayName} />
          <div className="grow"><b>{agent.displayName}</b>{role && <> <Tag>{role}</Tag></>}
            <small className={line.warn ? 'warn-text' : undefined}>{line.warn && <CircleAlert aria-hidden size={13} className="inline-icon" />}{agent.enabled ? '' : '已暂停参与 · '}{line.text}
              {line.warn && !archivedRoom && <> · <button type="button" className="link-btn" onClick={() => { setError(''); setEditor(agent); }}>去选择</button></>}</small></div>
          <Switch label={`${agent.displayName} 参与讨论`} checked={agent.enabled} disabled={busy || archivedRoom} onChange={value => void act(() => api.updateAgent({ ...input(agent), enabled: value }), value ? `${agent.displayName} 会参与之后的讨论。` : `${agent.displayName} 暂不参与之后的讨论。`)} />
          {!archivedRoom && <MemberMenu agent={agent} first={index === 0} last={index === active.length - 1} disabled={busy}
            onEdit={() => { setError(''); setEditor(agent); }} onMove={offset => move(agent, offset)}
            onArchive={() => void act(() => api.archiveAgent({ id: agent.id, archived: true }), `已归档「${agent.displayName}」，可以在下方恢复。`)}
            onDelete={() => { setError(''); setConfirm({ kind: 'agent', agent }); }} />}
        </li>;
      })}</ol>}
      {agents && active.length > 0 && enabledCount === 0 && <p className="warn-text small room-notice">没有参与讨论的成员，现在不能开始讨论。</p>}
      {archived.length > 0 && <div className="archived-members">
        <button type="button" className="link-btn" aria-expanded={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? '收起已归档的成员' : `已归档的成员（${archived.length}）`}</button>
        {showArchived && <ul className="card">{archived.map(agent => <li key={agent.id} className="card-row is-off"><Avatar name={agent.displayName} /><span className="grow"><b>{agent.displayName}</b><small>已归档，不参与讨论；讨论记录里仍保留 TA 的发言。</small></span>
          {!archivedRoom && <><Button size="sm" disabled={busy} onClick={() => void act(() => api.archiveAgent({ id: agent.id, archived: false }), `已恢复「${agent.displayName}」。`)}>恢复</Button>
            <IconButton icon={Trash2} label={`删除「${agent.displayName}」`} disabled={busy} onClick={() => setConfirm({ kind: 'agent', agent })} /></>}</li>)}</ul>}
      </div>}
    </section>

    <section className="section" aria-labelledby="room-mode"><h2 id="room-mode"><span className="grow">讨论方式</span>{!archivedRoom && <Button size="sm" onClick={workflow.onChange}>更改</Button>}</h2>
      <div className="card"><div className="card-row"><GitBranch aria-hidden size={18} className="muted" /><div className="grow"><b>{workflow.label}</b><small>{workflow.detail}</small></div></div></div></section>

    <section className="section" aria-labelledby="room-runs"><h2 id="room-runs"><span className="grow">讨论记录</span></h2>
      {runs.length === 0 ? <p className="muted small">还没有讨论。写下目标就能开始第一场。</p>
        : <ul className="card run-list">{runs.map(run => <li key={run.id} className="card-row">
          <span className={cx('run-dot', liveStatuses.includes(run.status) && 'is-live', run.status === 'error' && 'is-warn')} aria-hidden />
          <div className="grow"><b>{run.task ?? '旧任务（目标未记录）'}</b><small>{statusLabels[run.status] ?? run.status} · {when(run.createdAt)}</small></div>
          <Button size="sm" variant="quiet" onClick={() => onOpenRun(run.id)}>打开</Button></li>)}</ul>}
    </section>

    {!archivedRoom && <section className="section" aria-labelledby="room-danger"><h2 id="room-danger">归档或删除</h2>
      <div className="danger-zone is-quiet"><div className="grow"><b>归档房间</b><small>从列表收起，不能开始新讨论；记录都保留，可以随时恢复。{live ? '有讨论正在进行，先停止它再归档。' : ''}</small></div>
        <Button icon={Archive} disabled={busy || live} onClick={() => void act(() => api.archiveRoom({ id: room.id, archived: true }), '已归档这个房间。')}>归档</Button></div>
      <div className="danger-zone"><div className="grow"><b>删除房间</b><small>{runs.length ? '这个房间已经有讨论记录，不能删除；可以归档。' : '不可撤销。只有从没讨论过的房间可以删除，成员会一起删除。'}</small></div>
        <Button variant="danger" icon={Trash2} disabled={busy || runs.length > 0} onClick={() => { setError(''); setConfirm({ kind: 'room' }); }}>删除…</Button></div>
    </section>}

    {editor && <MemberDialog key={editor === 'new' ? 'new' : editor.id} agent={editor === 'new' ? undefined : editor} roomId={room.id}
      order={active.length ? Math.max(...active.map(agent => agent.displayOrder)) + 1 : 0} providers={providers} readiness={readiness} onOpenSettings={onOpenSettings}
      onClose={() => setEditor(undefined)} onSave={async (value: CreateAgentInput) => {
        const target = editor;
        await (target === 'new' ? api.createAgent(value) : api.updateAgent({ ...value, id: target.id }));
        if (!alive.current) return;
        setEditor(undefined); setNotice(target === 'new' ? `已添加「${value.displayName}」。` : '已保存。'); await load(); onChanged();
      }} />}
    {editingRoom && <RoomDialog room={room} onClose={() => setEditingRoom(false)} onSave={async value => { await api.updateRoom({ ...value, id: room.id }); if (alive.current) { setEditingRoom(false); setNotice('已保存。'); onChanged(); } }} />}
    {confirm && <ConfirmDelete what={confirm.kind === 'room' ? `房间「${room.name}」` : `成员「${confirm.agent.displayName}」`}
      detail={confirm.kind === 'room' ? '不可撤销。房间和里面的成员都会删除。' : '不可撤销。参加过讨论的成员不能删除，可以归档；讨论记录里仍会保留 TA 的发言。'}
      onClose={() => setConfirm(undefined)} onConfirm={async () => {
        if (confirm.kind === 'room') { await api.deleteRoom({ id: room.id }); if (alive.current) { setConfirm(undefined); onDeleted(); } return; }
        await api.deleteAgent({ id: confirm.agent.id }); if (!alive.current) return;
        setConfirm(undefined); setNotice(`已删除「${confirm.agent.displayName}」。`); await load(); onChanged();
      }} />}
  </div></div>;
}

function MemberMenu({ agent, first, last, disabled, onEdit, onMove, onArchive, onDelete }: { agent: AgentConfiguration; first: boolean; last: boolean; disabled: boolean; onEdit: () => void; onMove: (offset: number) => void; onArchive: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false); const trigger = useRef<HTMLButtonElement>(null); const menu = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, [trigger, menu]);
  useEffect(() => { if (open) menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }, [open]);
  const pick = (work: () => void) => () => { setOpen(false); trigger.current?.focus(); work(); };
  return <span className="menu-anchor">
    <IconButton ref={trigger} icon={Ellipsis} label={`「${agent.displayName}」：编辑、排序、归档、删除`} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(value => !value)} />
    {open && <div ref={menu} className="popover menu menu-right" role="menu" aria-label={`${agent.displayName} 的操作`}
      onKeyDown={event => { if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); const items = [...menu.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]; const at = items.indexOf(document.activeElement as HTMLButtonElement); items[(at + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus(); } }}>
      <button type="button" role="menuitem" onClick={pick(onEdit)}><Pencil aria-hidden />编辑…</button>
      <button type="button" role="menuitem" disabled={first} onClick={pick(() => onMove(-1))}>上移</button>
      <button type="button" role="menuitem" disabled={last} onClick={pick(() => onMove(1))}>下移</button>
      <hr /><button type="button" role="menuitem" onClick={pick(onArchive)}><Archive aria-hidden />归档</button>
      <button type="button" role="menuitem" className="is-danger" onClick={pick(onDelete)}><Trash2 aria-hidden />删除…</button>
    </div>}
  </span>;
}

/** A red, second step for anything that cannot be undone; focus starts on 取消. */
function ConfirmDelete({ what, detail, onClose, onConfirm }: { what: string; detail: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const run = async () => { setBusy(true); setError(''); try { await onConfirm(); } catch (cause) { setError(roomErrorText(cause)); setBusy(false); } };
  return <Modal title={`删除${what}？`} description={detail} onClose={onClose} busy={busy}
    footer={<><Button data-autofocus disabled={busy} onClick={onClose}>取消</Button><Button variant="danger" solid icon={Trash2} disabled={busy} onClick={() => void run()}>{busy ? '正在删除…' : '删除'}</Button></>}>
    {error && <p className="field-error" role="alert">{error}</p>}
  </Modal>;
}

/** 新建 / 编辑房间: a name and an optional default goal that pre-fills new discussions. */
export function RoomDialog({ room, onClose, onSave, note }: { room?: RoomConfiguration; onClose: () => void; onSave: (value: { name: string; objective: string }) => Promise<void>; note?: string }) {
  const [name, setName] = useState(room?.name ?? ''); const [objective, setObjective] = useState(room?.objective ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createRoomInputSchema.safeParse({ name, objective });
    if (!parsed.success) { setError('请填写房间名称。'); return; }
    setBusy(true); setError('');
    try { await onSave({ name: parsed.data.name, objective: parsed.data.objective }); } catch (cause) { setError(roomErrorText(cause)); setBusy(false); }
  }
  return <Modal title={room ? '编辑房间' : '新建房间'} description={note} onClose={onClose} busy={busy}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" form="room-form" disabled={busy}>{busy ? '正在保存…' : room ? '保存' : '新建'}</Button></>}>
    <form id="room-form" className="form-stack" onSubmit={event => void submit(event)} noValidate>
      <Field label="房间名称">{props => <input {...props} className="input" autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：校园跑腿讨论" />}</Field>
      <Field label="默认目标" optional help="新讨论会预填这个目标，开始前可以改。">{props => <textarea {...props} className="textarea" rows={3} value={objective} disabled={busy} onChange={event => setObjective(event.target.value)} />}</Field>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
