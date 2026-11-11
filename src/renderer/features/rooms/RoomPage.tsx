import { useCallback, useEffect, useRef, useState, type DragEvent, type FormEvent, type KeyboardEvent } from 'react';
import { Archive, ArchiveRestore, CircleAlert, Ellipsis, GitBranch, GripVertical, Pencil, Plus, Trash2 } from 'lucide-react';
import type { AgentConfiguration, CreateAgentInput, ProviderReadiness, ProviderSummary, RoomConfiguration, RoomManagementApiContract, RunSummary } from '../../../shared/contracts/configuration';
import { PROJECT_BRIEF_MAX_CHARS, createRoomInputSchema } from '../../../shared/schemas/configuration';
import { Avatar, Button, Field, IconButton, Modal, Pill, Switch, Tag, cx, useDismiss } from '../../components/ui';
import { runStatusLabel } from '../../locales/zhCN';
import { delistedText, modelBlockText } from '../settings/model';
import { groupChatMode, templates, type DiscussionMode } from '../workflows/model';
import { MemberDialog } from './MemberDialog';
import { agentInput as input, roleShown, roomErrorText } from './templates';
import './rooms.css';

const liveStatuses = ['running', 'pausing', 'paused', 'cancelling'];
const when = (iso: string) => {
  const date = new Date(iso); const today = new Date().toDateString() === date.toDateString();
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  return today ? `今天 ${time}` : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
};

/** Whether Main would refuse this member at the start of a discussion. A model the service's list dropped may still work, and that is the host's call. */
export function memberBlocked(agent: AgentConfiguration, providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined): boolean {
  if (!readiness) return false;
  if (agent.builtInDemo) return false;
  if (agent.withheldModelId || !agent.providerId || !agent.modelId) return true;
  const provider = providers.find(item => item.id === agent.providerId);
  if (!provider || !provider.enabled) return true;
  if (provider.kind === 'mock') return false;
  const row = readiness.find(item => item.providerId === provider.id);
  if (!row) return false;
  const state = row.models.find(model => model.modelId === agent.modelId);
  return row.supported === false || !state || !state.usable;
}

/** One line per member: which model and whether it can take part now, as Main decides it (D114). */
export function memberLine(agent: AgentConfiguration, providers: readonly ProviderSummary[], readiness: readonly ProviderReadiness[] | undefined, unset?: string): { text: string; warn: boolean } {
  if (agent.builtInDemo) return { text: '内置演示 · 回复是预先写好的示例', warn: false };
  if (agent.withheldModelId) return { text: '之前填的模型名像 API Key，已隐藏且不会使用；请重新选择模型', warn: true };
  // D167: in the 常用阵容 a member without a model is not a fault: the new discussion gives them the default one.
  if (!agent.providerId || !agent.modelId) return unset ? { text: unset, warn: false } : { text: '还没选模型，暂时不会参与讨论', warn: true };
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
  runs: RunSummary[];
  /** D169: how this project's new discussions talk. Absent on the 常用阵容, which has no discussions. */
  mode?: { value: DiscussionMode; detail: string; onPick: (mode: DiscussionMode) => void; onCustomize: () => void };
  /** D167: 'lineup' is the 常用阵容 in 设置: only its members, with no project around them. */
  variant?: 'project' | 'lineup';
  /** What a member with no model says in the 常用阵容. */
  unsetModelText?: string;
  onNewDiscussion: () => void; onOpenRun: (runId: string) => void; onOpenSettings: () => void;
  /** Members, names or archive state changed: the sidebar and discussion header reload. */
  onChanged: () => void; onDeleted: () => void;
};

/**
 * 项目 (D167): one page — the project, its 项目说明, its members (order, on/off, menu), how its new discussions talk, its discussions,
 * and archive or delete. The same page with `variant="lineup"` is the 常用阵容 in 设置: members only.
 */
export function RoomPage({ api, room, providers, readiness, runs, mode, variant = 'project', unsetModelText, onNewDiscussion, onOpenRun, onOpenSettings, onChanged, onDeleted, onEditMember }: RoomPageProps) {
  const lineup = variant === 'lineup';
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

  const body = <>
    {lineup ? <div className="page-head"><div className="grow"><h1>常用阵容</h1>
      <p>点侧栏的「新讨论」时，默认是这几位成员。每场讨论开始前都可以再换人，换了只影响那一场；项目有自己的成员，不用这套阵容。</p></div></div>
      : <div className="page-head"><div className="grow"><h1>{room.name}{archivedRoom && <> <Pill>已归档</Pill></>}</h1>
      <p>{room.objective.trim() ? <>默认目标：{room.objective}。新讨论会预填这个目标，可以改。</> : '项目里的讨论共用下面的项目说明、成员和默认讨论方式。'}</p></div>
      <div className="actions">{!archivedRoom && <Button icon={Pencil} disabled={busy} onClick={() => setEditingRoom(true)}>编辑</Button>}
        {archivedRoom ? <Button variant="primary" icon={ArchiveRestore} disabled={busy} onClick={() => void act(() => api.archiveRoom({ id: room.id, archived: false }), '已恢复这个项目。')}>恢复项目</Button>
          : <Button variant="primary" icon={Plus} disabled={busy} onClick={onNewDiscussion}>新讨论</Button>}</div></div>}
    {notice && <p role="status" className="ok-text small room-notice">{notice}</p>}
    {error && !editor && !confirm && !editingRoom && <p role="alert" className="field-error room-notice">{error}</p>}

    {!lineup && <BriefSection key={room.brief} brief={room.brief} readOnly={archivedRoom} busy={busy}
      onSave={brief => act(() => api.updateRoom({ id: room.id, name: room.name, objective: room.objective, brief }), brief.trim() ? '已保存项目说明。之后每次发言都会带上它，正在进行的讨论也一样。' : '已清空项目说明。')} />}

    <section className="section" aria-labelledby="room-members"><h2 id="room-members"><span className="grow">成员</span>
      {!archivedRoom && <Button size="sm" icon={Plus} disabled={busy || !agents} onClick={() => { setError(''); setEditor('new'); }}>添加成员</Button>}</h2>
      <p className="lead">{lineup ? '拖动或用方向键调整顺序。改动只影响之后新开的讨论，已有讨论不变。'
        : <>{!mode || mode.value === 'group-chat' ? '群聊里谁接话由程序判断；用严格流程时按这个顺序发言。' : '按顺序轮流发言（选了讨论方式时按流程分配）。'}拖动或用方向键调整顺序。改动只影响之后开始的讨论。</>}</p>
      {loadFailed && <p role="alert" className="field-error">成员没有读出来。<button type="button" className="link-btn" onClick={() => void load()}>重试</button></p>}
      {!agents && !loadFailed && <p role="status" className="muted">正在读取成员…</p>}
      {agents && active.length === 0 && <div className="card"><div className="card-row"><span className="grow"><b>还没有成员</b><small>{lineup ? '阵容是空的：新讨论开始前要先在新讨论页添加成员。' : '添加几位成员，选好模型，就能开始讨论。'}</small></span></div></div>}
      {active.length > 0 && <ol className="card member-list" aria-label="成员">{active.map((agent, index) => {
        const line = memberLine(agent, providers, readiness, lineup ? unsetModelText : undefined); const role = roleShown(agent);
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
      {agents && active.length > 0 && enabledCount === 0 && <p className="warn-text small room-notice">{lineup ? '阵容里没有参与讨论的成员，新讨论开始前要先打开至少一位。' : '没有参与讨论的成员，现在不能开始讨论。'}</p>}
      {archived.length > 0 && <div className="archived-members">
        <button type="button" className="link-btn" aria-expanded={showArchived} onClick={() => setShowArchived(value => !value)}>{showArchived ? '收起已归档的成员' : `已归档的成员（${archived.length}）`}</button>
        {showArchived && <ul className="card">{archived.map(agent => <li key={agent.id} className="card-row is-off"><Avatar name={agent.displayName} /><span className="grow"><b>{agent.displayName}</b><small>已归档，不参与讨论；讨论记录里仍保留 TA 的发言。</small></span>
          {!archivedRoom && <><Button size="sm" disabled={busy} onClick={() => void act(() => api.archiveAgent({ id: agent.id, archived: false }), `已恢复「${agent.displayName}」。`)}>恢复</Button>
            <IconButton icon={Trash2} label={`删除「${agent.displayName}」`} disabled={busy} onClick={() => setConfirm({ kind: 'agent', agent })} /></>}</li>)}</ul>}
      </div>}
    </section>

    {!lineup && mode && <section className="section" aria-labelledby="room-mode"><h2 id="room-mode"><span className="grow">默认讨论方式</span></h2>
      <p className="lead">这个项目里的新讨论默认用它；开始某一场之前，还可以在新讨论页改。已经开始的讨论不变。</p>
      <div className="card mode-card">
        <div className="setup-modes" role="group" aria-labelledby="room-mode">
          <div className="seg setup-seg"><button type="button" aria-pressed={mode.value === groupChatMode.id} disabled={busy || archivedRoom} onClick={() => mode.onPick(groupChatMode.id)}>{groupChatMode.label}</button></div>
          <span className="setup-strict"><span className="setup-strict-label" id="room-mode-strict">更严格的流程</span>
            <span className="seg setup-seg" role="group" aria-labelledby="room-mode-strict">{templates.map(item =>
              <button key={item.id} type="button" aria-pressed={mode.value === item.id} disabled={busy || archivedRoom} onClick={() => mode.onPick(item.id)}>{item.label}</button>)}</span></span>
        </div>
        <p className="small muted mode-detail"><GitBranch aria-hidden size={14} className="inline-icon" />{mode.detail}
          {!archivedRoom && mode.value !== groupChatMode.id && <button type="button" className="link-btn setup-link" onClick={mode.onCustomize}>自定义流程</button>}</p>
      </div></section>}

    {!lineup && <section className="section" aria-labelledby="room-runs"><h2 id="room-runs"><span className="grow">讨论</span>{!archivedRoom && runs.length > 0 && <Button size="sm" icon={Plus} disabled={busy} onClick={onNewDiscussion}>新讨论</Button>}</h2>
      {runs.length === 0 ? <p className="muted small">这个项目还没有讨论。点右上角的「新讨论」开始第一场。</p>
        : <ul className="card run-list">{runs.map(run => <li key={run.id} className="card-row">
          <span className={cx('run-dot', liveStatuses.includes(run.status) && 'is-live', run.status === 'error' && 'is-warn')} aria-hidden />
          <div className="grow"><b>{run.task ?? '旧任务（目标未记录）'}</b><small>{runStatusLabel(run)} · {when(run.createdAt)}</small></div>
          <Button size="sm" variant="quiet" onClick={() => onOpenRun(run.id)}>打开</Button></li>)}</ul>}
    </section>}

    {!lineup && !archivedRoom && <section className="section" aria-labelledby="room-danger"><h2 id="room-danger">归档或删除</h2>
      <div className="danger-zone is-quiet"><div className="grow"><b>归档项目</b><small>从列表收起，不能开始新讨论；记录都保留，可以随时恢复。{live ? '有讨论正在进行，先停止它再归档。' : ''}</small></div>
        <Button icon={Archive} disabled={busy || live} onClick={() => void act(() => api.archiveRoom({ id: room.id, archived: true }), '已归档这个项目。')}>归档</Button></div>
      <div className="danger-zone"><div className="grow"><b>删除项目</b><small>{runs.length ? '这个项目已经有讨论记录，不能删除；可以归档。' : '不可撤销。只有从没讨论过的项目可以删除，成员会一起删除。'}</small></div>
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
    {confirm && <ConfirmDelete what={confirm.kind === 'room' ? `项目「${room.name}」` : `成员「${confirm.agent.displayName}」`}
      detail={confirm.kind === 'room' ? '不可撤销。项目和里面的成员都会删除。' : '不可撤销。参加过讨论的成员不能删除，可以归档；讨论记录里仍会保留 TA 的发言。'}
      onClose={() => setConfirm(undefined)} onConfirm={async () => {
        if (confirm.kind === 'room') { await api.deleteRoom({ id: room.id }); if (alive.current) { setConfirm(undefined); onDeleted(); } return; }
        await api.deleteAgent({ id: confirm.agent.id }); if (!alive.current) return;
        setConfirm(undefined); setNotice(`已删除「${confirm.agent.displayName}」。`); await load(); onChanged();
      }} />}
  </>;
  return lineup ? <div className="room-page lineup-page">{body}</div> : <div className="page room-page"><div className="page-inner">{body}</div></div>;
}

/**
 * 项目说明 (D168): one fixed text every member reads before every reply in this project. It is saved when the host says so, never
 * as they type, because what is saved goes into the very next request of a discussion that is still going.
 */
function BriefSection({ brief, readOnly, busy, onSave }: { brief: string; readOnly: boolean; busy: boolean; onSave: (brief: string) => Promise<boolean> }) {
  const [text, setText] = useState(brief); const [editing, setEditing] = useState(false);
  const over = text.length > PROJECT_BRIEF_MAX_CHARS; const dirty = text !== brief;
  return <section className="section" aria-labelledby="room-brief"><h2 id="room-brief"><span className="grow">项目说明</span>
    {!readOnly && !editing && <Button size="sm" icon={Pencil} disabled={busy} onClick={() => setEditing(true)}>{brief.trim() ? '修改' : '写项目说明'}</Button>}</h2>
    <p className="lead">项目里每场讨论、每位成员每次发言前都会读到这段话，当作背景材料，不是给成员下的指令。它会算进每次发言的输入用量，写清楚就好，不用长。</p>
    {editing ? <form className="brief-form" onSubmit={event => { event.preventDefault(); if (!over && dirty) void onSave(text.trim()).then(saved => { if (saved) setEditing(false); }); }}>
      <textarea className="textarea" rows={6} autoFocus aria-labelledby="room-brief" aria-describedby="room-brief-count" aria-invalid={over || undefined} value={text} disabled={busy}
        placeholder="例如：我们在做什么、给谁用、已经定下的约束、项目里的专有说法。" onChange={event => setText(event.target.value)} />
      <div className="brief-foot"><span id="room-brief-count" className={cx('small', over ? 'field-error' : 'muted')} role={over ? 'alert' : undefined}>{text.length} / {PROJECT_BRIEF_MAX_CHARS} 字{over ? '，超出了上限，请删减。' : ''}</span>
        <span className="actions"><Button size="sm" disabled={busy} onClick={() => { setText(brief); setEditing(false); }}>取消</Button>
          <Button size="sm" variant="primary" type="submit" disabled={busy || over || !dirty}>{busy ? '正在保存…' : '保存'}</Button></span></div>
    </form>
      : brief.trim() ? <div className="card"><div className="card-row"><p className="brief-text grow">{brief}</p></div></div>
        : <p className="muted small">还没有写。不写也能讨论，只是成员不知道这个项目的背景，每场都要你重新交代。</p>}
  </section>;
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

/** 新建 / 编辑项目: a name and an optional default goal that pre-fills new discussions. */
export function RoomDialog({ room, onClose, onSave, note }: { room?: RoomConfiguration; onClose: () => void; onSave: (value: { name: string; objective: string }) => Promise<void>; note?: string }) {
  const [name, setName] = useState(room?.name ?? ''); const [objective, setObjective] = useState(room?.objective ?? '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = createRoomInputSchema.safeParse({ name, objective });
    if (!parsed.success) { setError('请填写项目名称。'); return; }
    setBusy(true); setError('');
    try { await onSave({ name: parsed.data.name, objective: parsed.data.objective }); } catch (cause) { setError(roomErrorText(cause)); setBusy(false); }
  }
  return <Modal title={room ? '编辑项目' : '新建项目'} description={note} onClose={onClose} busy={busy}
    footer={<><Button disabled={busy} onClick={onClose}>取消</Button><Button variant="primary" type="submit" form="room-form" disabled={busy}>{busy ? '正在保存…' : room ? '保存' : '新建'}</Button></>}>
    <form id="room-form" className="form-stack" onSubmit={event => void submit(event)} noValidate>
      <Field label="项目名称">{props => <input {...props} className="input" autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：校园跑腿讨论" />}</Field>
      <Field label="默认目标" optional help="新讨论会预填这个目标，开始前可以改。">{props => <textarea {...props} className="textarea" rows={3} value={objective} disabled={busy} onChange={event => setObjective(event.target.value)} />}</Field>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Modal>;
}
