import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Plus, X } from 'lucide-react';
import { Avatar, Button, Choice, Field, IconButton, Modal, cx } from '../../components/ui';
import { createWorkflowDraft, draftProblems, templates, type WorkflowDraft, type WorkflowMember, type WorkflowTemplate } from './model';
import './workflows.css';

export type WorkflowCheck = { ok: true; summary: string } | { ok: false; errors: string[] };
export type WorkflowDialogProps = {
  roomName: string; members: readonly WorkflowMember[]; initial?: WorkflowDraft;
  /** Main's previewWorkflow for the room's current members; it sends nothing and authorizes nothing. */
  onCheck: (draft: WorkflowDraft) => Promise<WorkflowCheck>;
  /** Remember the mode for this room (null: back to the default); false when it could not be stored. */
  onSave: (draft: WorkflowDraft | null) => boolean;
  onClose: () => void;
};

/**
 * 讨论方式 (R16 D2-B / D116): choose a template, assign members to its stages and set limits. Every change is checked by
 * Main against the current members at once; 用于这个房间 remembers it, and each start checks it again.
 */
export function WorkflowDialog({ roomName, members, initial, onCheck, onSave, onClose }: WorkflowDialogProps) {
  const [draft, setDraft] = useState<WorkflowDraft>(() => initial ?? createWorkflowDraft('free-chat', members));
  const [check, setCheck] = useState<{ draft: string; result?: WorkflowCheck; pending: boolean }>({ draft: '', pending: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const token = useRef(0); const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; token.current++; }; }, []);
  const enabled = members.filter(member => member.enabled);
  const local = draftProblems(draft, members);
  const key = JSON.stringify(draft);
  useEffect(() => {
    const current = ++token.current;
    if (local.length) { setCheck({ draft: key, pending: false, result: { ok: false, errors: local } }); return; }
    setCheck({ draft: key, pending: true });
    const timer = setTimeout(() => {
      onCheck(structuredClone(draft)).then(result => { if (alive.current && current === token.current) setCheck({ draft: key, pending: false, result }); },
        () => { if (alive.current && current === token.current) setCheck({ draft: key, pending: false, result: { ok: false, errors: ['没能核对这个讨论方式，请稍后再试。'] } }); });
    }, 250);
    return () => clearTimeout(timer);
  }, [key]);

  const name = (id: string) => members.find(member => member.id === id)?.name ?? '已不在房间';
  const edit = (next: Partial<WorkflowDraft>) => { setSaveFailed(false); setDraft(previous => ({ ...previous, ...next })); };
  const phase = (index: number, patch: Partial<WorkflowDraft['phases'][number]>) => edit({ phases: draft.phases.map((item, i) => i === index ? { ...item, ...patch } : item) });
  const toggle = (index: number, id: string) => {
    const current = draft.phases[index].participants.filter(Boolean);
    const next = current.includes(id) ? current.filter(item => item !== id) : enabled.map(member => member.id).filter(item => item === id || current.includes(item));
    phase(index, { participants: next });
  };
  const ok = check.draft === key && !check.pending && check.result?.ok === true;
  const ended = draft.finishAt ? draft.phases.findIndex(item => item.key === draft.finishAt) : -1;
  const used = new Set(draft.phases.slice(0, ended >= 0 ? ended + 1 : undefined).flatMap(item => item.participants));
  const idle = enabled.filter(member => !used.has(member.id)).map(member => member.name);
  const fixedOne = draft.template === 'review-revision';
  const pair = draft.template === 'two-model-dialogue';

  const save = (value: WorkflowDraft | null) => { if (onSave(value)) onClose(); else setSaveFailed(true); };
  const footer = <>
    <span className="is-left">{idle.length ? `${idle.join('、')}不在这个流程里，这次不会发言${idle.some(item => /综合|总结/u.test(item)) ? '；需要时可以在讨论中生成摘要' : ''}。` : '成员按顺序依次发言，不会同时生成。'}</span>
    {initial && <Button variant="quiet" onClick={() => save(null)}>恢复默认</Button>}
    <Button onClick={onClose}>取消</Button>
    <Button variant="primary" disabled={!ok} onClick={() => save(draft)}>用于这个房间</Button>
  </>;
  return <Modal wide title="讨论方式" description={`决定谁在什么时候发言。「${roomName}」会记住你的选择，每次开始时按当时的成员自动核对，不用重复应用。`} onClose={onClose} footer={footer} className="wf-dialog">
    <div className="choice-grid is-4" role="group" aria-label="讨论方式模板">
      {templates.map(item => <Choice key={item.id} selected={draft.template === item.id} title={item.label}
        onSelect={() => { if (draft.template !== item.id) { setSaveFailed(false); setDraft({ ...createWorkflowDraft(item.id as WorkflowTemplate, members), turnLimit: draft.turnLimit, durationMinutes: draft.durationMinutes, outputTokens: draft.outputTokens }); } }}>
        {item.description}<span className="mini-flow" aria-hidden>{Array.from({ length: item.steps }, (_, i) => <i key={i} />)}</span></Choice>)}
    </div>
    <ol className="card wf-stages" aria-label="阶段与成员">{draft.phases.map((item, index) => {
      const skipped = ended >= 0 && index > ended;
      return <li key={item.key} className={cx('wf-stage', skipped && 'is-skipped')}>
        <span className="n" aria-hidden>{index + 1}</span><b>{item.title}</b>
        <div className="wf-members">
          {fixedOne || pair ? item.participants.map((id, slot) => <select key={slot} className="select input wf-select" aria-label={`${item.title}${pair ? `：第 ${slot + 1} 位` : ''}`} value={id}
            onChange={event => phase(index, { participants: item.participants.map((value, i) => i === slot ? event.target.value : value) })}>
            {!enabled.some(member => member.id === id) && <option value={id}>{id ? `${name(id)}（不可用）` : '选择成员'}</option>}
            {enabled.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select>)
            : <>{item.participants.filter(Boolean).map(id => <span key={id} className="member-chip"><Avatar name={name(id)} size="sm" />{name(id)}
              <IconButton size="sm" icon={X} label={`从${item.title}移除 ${name(id)}`} onClick={() => toggle(index, id)} /></span>)}
              {enabled.filter(member => !item.participants.includes(member.id)).map(member => <button key={member.id} type="button" className="member-chip is-add" onClick={() => toggle(index, member.id)} aria-label={`把 ${member.name} 加入${item.title}`}><Plus aria-hidden size={13} />{member.name}</button>)}</>}
        </div>
        <div className="wf-stage-end">
          {(draft.template === 'free-chat' || pair || item.key === 'rebuttal') && <label className="wf-repeat">{pair ? '来回' : '每人'}<input className="input" inputMode="numeric" aria-label={`${item.title}的轮数`} value={item.repeat} onChange={event => phase(index, { repeat: event.target.value.trim() })} />轮</label>}
          {draft.phases.length > 1 && (skipped ? <span className="small muted">不执行</span>
            : <button type="button" className="wf-end" aria-pressed={draft.finishAt === item.key} onClick={() => edit({ finishAt: draft.finishAt === item.key ? '' : item.key })}>{draft.finishAt === item.key ? `${item.title}后结束` : '在此结束'}</button>)}
        </div>
      </li>;
    })}</ol>
    <div className="wf-limits">
      <Field label="最多回合">{props => <input {...props} className="input" inputMode="numeric" value={draft.turnLimit} onChange={event => edit({ turnLimit: event.target.value.trim() })} />}</Field>
      <Field label="时长上限" help="分钟，暂停不计时">{props => <input {...props} className="input" inputMode="numeric" value={draft.durationMinutes} onChange={event => edit({ durationMinutes: event.target.value.trim() })} />}</Field>
      <Field label="单次发言上限" help="tokens；4096 约等于 3,000 汉字">{props => <input {...props} className="input" inputMode="numeric" value={draft.outputTokens} onChange={event => edit({ outputTokens: event.target.value.trim() })} />}</Field>
    </div>
    <div className={cx('callout', ok ? 'is-accent' : check.result && !check.result.ok && !check.pending ? 'is-warn' : '')} role="status" aria-live="polite">
      {ok ? <Check aria-hidden /> : <CircleAlert aria-hidden />}
      <span className="grow">{check.pending || check.draft !== key ? '正在核对…' : check.result?.ok ? `已核对：${check.result.summary}` : (check.result?.errors ?? []).join(' ')}</span>
    </div>
    {saveFailed && <p className="field-error" role="alert">这台电脑现在不能保存讨论方式（浏览器存储不可用）。这次仍可按默认方式讨论。</p>}
  </Modal>;
}
