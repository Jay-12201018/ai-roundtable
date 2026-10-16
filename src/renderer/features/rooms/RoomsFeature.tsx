import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { RoomConfiguration, RoomsFeatureProps, RoomInput, CreateRoomInput } from '../../../shared/contracts/configuration';
import { createRoomInputSchema } from '../../../shared/schemas/configuration';
import { MembersPanel } from './MembersPanel';
import { HistoryPanel } from './HistoryPanel';
import { Dialog, errorText } from './ui';
import './rooms.css';

export function RoomsFeature(props: RoomsFeatureProps) {
  const { api, onSelectRoom } = props;
  const [rooms, setRooms] = useState<RoomConfiguration[]>([]);
  const [selectedId, setSelectedId] = useState<string>(); const selection = useRef<string | undefined>(undefined);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [loading, setLoading] = useState(true); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<RoomConfiguration | 'new'>();
  const [confirmation, setConfirmation] = useState<'archive' | 'delete'>();
  const [busy, setBusy] = useState(false); const lock = useRef(false); const request = useRef(0); const generation = useRef(0); const alive = useRef(true);
  const [tab, setTab] = useState<'members' | 'history'>('members');
  const selected = rooms.find(room => room.id === selectedId);
  useEffect(() => { alive.current = true; return () => { alive.current = false; request.current++; }; }, []);

  const select = useCallback((id: string | undefined) => {
    if (selection.current === id) return;
    generation.current++; selection.current = id; setSelectedId(id); setEditor(undefined); setConfirmation(undefined); setNotice(''); setError(''); setTab('members');
    if (id) onSelectRoom(id);
  }, [onSelectRoom]);
  const reload = useCallback(async () => {
    const token = ++request.current; setLoading(true); setError('');
    try {
      const next = await api.listRooms({ includeArchived });
      if (!alive.current || token !== request.current) return;
      setRooms(next);
      if (!next.some(room => room.id === selection.current)) select(next[0]?.id);
    } catch (error) { if (alive.current && token === request.current) setError(errorText(error)); }
    finally { if (alive.current && token === request.current) setLoading(false); }
  }, [api, includeArchived, select]);
  useEffect(() => { void reload(); return () => { request.current++; }; }, [reload]);

  async function mutate(work: () => Promise<RoomConfiguration | void>, success: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); const captured = generation.current; request.current++;
    try {
      const result = await work();
      if (!alive.current) return;
      if (captured === generation.current) {
        setEditor(undefined); setConfirmation(undefined);
        if (result && (!result.archivedAt || includeArchived)) {
          setRooms(previous => previous.some(room => room.id === result.id) ? previous.map(room => room.id === result.id ? result : room) : [...previous, result]);
          select(result.id);
        } else {
          const next = rooms.filter(room => room.id !== selection.current); setRooms(next); select(next[0]?.id);
        }
        setNotice(success);
      } else await reload();
    } catch (error) { if (alive.current && captured === generation.current) setError(errorText(error)); }
    finally { lock.current = false; if (alive.current) { setBusy(false); setLoading(false); } }
  }
  return <section className="rooms-feature" aria-label="房间管理">
    <aside className="rooms-navigation" aria-label="房间导航">
      <div className="rooms-toolbar"><h1>圆桌房间</h1><button type="button" disabled={busy} onClick={() => { setError(''); setEditor('new'); }}>新建房间</button></div>
      <p className="rooms-secondary">为每项协作保留成员与历史。</p>
      <label className="rooms-check"><input type="checkbox" checked={includeArchived} disabled={busy} onChange={event => setIncludeArchived(event.target.checked)} />显示归档房间</label>
      <button type="button" disabled={loading || busy} onClick={() => void reload()}>刷新房间</button>
      {loading && <p role="status">正在加载房间…</p>}
      {!loading && !rooms.length && !error && <p>还没有房间。创建一个房间开始配置。</p>}
      <ul className="rooms-list">{rooms.map(room => <li key={room.id}><button type="button" aria-current={selectedId === room.id ? 'page' : undefined} onClick={() => select(room.id)}>{room.name}{room.archivedAt && <span className="rooms-secondary"> · 已归档</span>}</button></li>)}</ul>
      <button type="button" onClick={props.onOpenSettings}>模型设置</button>
    </aside>
    <main className="rooms-content">
      {error && !editor && !confirmation && <div role="alert" className="rooms-error">{error}<button type="button" disabled={busy} onClick={() => void reload()}>重试房间列表</button></div>}
      {notice && <p role="status" className="rooms-success">{notice}</p>}
      {selected ? <>
        <header className="rooms-header"><div><p className="rooms-eyebrow">{selected.archivedAt ? '已归档房间 · 可查看历史' : '当前房间'}</p><h2>{selected.name}</h2><p className="rooms-objective">{selected.objective || '尚未设置房间目标'}</p></div>
          <div className="rooms-actions"><button type="button" disabled={busy} onClick={() => { setError(''); setEditor(selected); }}>编辑房间</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); if (selected.archivedAt) void mutate(() => api.archiveRoom({ id: selected.id, archived: false }), '已恢复房间'); else setConfirmation('archive'); }}>{selected.archivedAt ? '恢复房间' : '归档房间'}</button>
            <button type="button" disabled={busy} onClick={() => { setError(''); setConfirmation('delete'); }}>删除房间</button></div>
        </header>
        <nav className="rooms-tabs" aria-label="房间内容"><button type="button" aria-pressed={tab === 'members'} onClick={() => setTab('members')}>成员配置</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>历史记录</button></nav>
        <div key={selected.id}>
          {tab === 'members' ? <MembersPanel key={`${selected.id}-members`} {...props} room={selected} /> : <HistoryPanel key={`${selected.id}-history`} api={api} roomId={selected.id} onSelectRun={props.onSelectRun} />}
        </div>
      </> : !loading && <div className="rooms-empty"><h2>你的下一场圆桌</h2><p>新建房间，配置 AI 成员，并在此浏览协作历史。</p></div>}
    </main>
    {editor && <RoomEditor key={editor === 'new' ? 'new' : editor.id} room={editor === 'new' ? undefined : editor} busy={busy} serverError={error} onClose={() => setEditor(undefined)} onSave={input => void mutate(() => editor === 'new' ? api.createRoom(input) : api.updateRoom({ ...input, id: editor.id }), '已保存房间')} />}
    {confirmation && selected && <Dialog title={confirmation === 'delete' ? `删除「${selected.name}」` : `归档「${selected.name}」`} busy={busy} onClose={() => setConfirmation(undefined)}>
      <p>{confirmation === 'delete' ? '删除不可撤销。仅无 Run、无消息且无成员历史引用的房间可以删除；有历史的房间请归档保留。' : '归档后房间将从默认列表隐藏，并停止接受新 Run。已有历史保留，可随时恢复；活动或暂停 Run 会阻止归档。'}</p>
      {error && <p role="alert" className="rooms-error">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void mutate(() => confirmation === 'delete' ? api.deleteRoom({ id: selected.id }) : api.archiveRoom({ id: selected.id }), confirmation === 'delete' ? '已删除房间' : '已归档房间')}>{busy ? '处理中…' : confirmation === 'delete' ? '确认删除' : '确认归档'}</button>
    </Dialog>}
  </section>;
}
function RoomEditor({ room, busy, serverError, onClose, onSave }: { room?: RoomConfiguration; busy: boolean; serverError: string; onClose: () => void; onSave: (input: CreateRoomInput | RoomInput) => void }) {
  const [name, setName] = useState(room?.name ?? ''); const [objective, setObjective] = useState(room?.objective ?? ''); const [error, setError] = useState('');
  function submit(event: FormEvent) { event.preventDefault(); setError(''); const parsed = createRoomInputSchema.safeParse({ name, objective }); if (!parsed.success) { setError('请填写房间名称。'); return; } onSave(parsed.data); }
  return <Dialog title={room ? '编辑房间' : '新建房间'} busy={busy} onClose={onClose}><form onSubmit={submit} onChange={() => setError('')} className="rooms-form" noValidate>
    <label>房间名称<input autoFocus value={name} disabled={busy} onChange={event => setName(event.target.value)} required /></label>
    <label>房间目标<textarea value={objective} disabled={busy} onChange={event => setObjective(event.target.value)} rows={3} /></label>
    {(error || serverError) && <p role="alert" className="rooms-error">{error || serverError}</p>}<button type="submit" className="rooms-primary" disabled={busy}>{busy ? '正在保存…' : '保存房间'}</button>
  </form></Dialog>;
}
