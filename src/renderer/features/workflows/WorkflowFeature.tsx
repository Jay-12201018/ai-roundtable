import { useEffect, useRef, useState } from 'react';
import './workflows.css';
import { DEFAULT_OUTPUT_TOKEN_LIMIT } from '../../../shared/schemas/run';

// Presentation models only. The parent must adapt them to the approved Shared API.
export type WorkflowTemplate = 'free-chat' | 'two-model-dialogue' | 'review-revision' | 'deep-debate';
export type WorkflowMember = { id: string; name: string; enabled: boolean };
export type WorkflowDraft = {
  template: WorkflowTemplate;
  phases: Array<{ key: string; title: string; participants: string[]; repeat: string }>;
  turnLimit: string; durationMs: string; outputTokens: string; finishAt: string;
};
export type WorkflowPreview = {
  id: string; totalTurns: number; nextStep: string; ending: string; limits: string;
  stages: Array<{ id: string; label: string; turns: number; memberNames: string[] }>;
};
export type WorkflowPreviewResult = { ok: true; preview: WorkflowPreview } | { ok: false; errors: string[] };
export type WorkflowProgress = {
  runLabel: string; status: string; completedTurns: number; totalTurns: number; elapsedMs: number;
  currentStage: string; nextStep: string; limitReason?: string;
  stages: Array<{ id: string; label: string; status: string; completedTurns: number; totalTurns: number }>;
};
export type WorkflowFeatureProps = {
  scopeKey: string; members: readonly WorkflowMember[]; theme?: 'light' | 'dark' | 'system';
  onPreview?: (draft: WorkflowDraft) => Promise<WorkflowPreviewResult>;
  onApply?: (input: { previewId: string; draft: WorkflowDraft }) => Promise<void>;
  progress?: WorkflowProgress | null;
};

const templates: Record<WorkflowTemplate, string> = {
  'free-chat': '自由群聊', 'two-model-dialogue': '双模型对话',
  'review-revision': '起草 → 审查 → 修订 → 复审 → 定稿', 'deep-debate': '深度辩论',
};
export function createWorkflowDraft(template: WorkflowTemplate, members: readonly WorkflowMember[]): WorkflowDraft {
  const ids = members.filter(m => m.enabled).map(m => m.id);
  const one = (key: string, title: string, participants: string[], repeat = '1') => ({ key, title, participants, repeat });
  const phases = template === 'review-revision' ? [
    one('draft', '起草', [ids[0] ?? '']), one('review', '审查', [ids[1] ?? '']),
    one('revise', '修订', [ids[0] ?? '']), one('rereview', '复审', [ids[1] ?? '']), one('finalize', '定稿', [ids[0] ?? '']),
  ] : template === 'deep-debate' ? [one('opening', '陈述', [...ids]), one('rebuttal', '交锋', [...ids], '2'), one('closing', '总结', [...ids])]
    : template === 'two-model-dialogue' ? [one('dialogue', '对话', [ids[0] ?? '', ids[1] ?? ''])]
      : [one('discussion', '讨论', ids.length ? [...ids] : [''])];
  return { template, phases, turnLimit: '12', durationMs: '300000', outputTokens: String(DEFAULT_OUTPUT_TOKEN_LIMIT), finishAt: '' };
}

export function WorkflowFeature(props: WorkflowFeatureProps) {
  return <WorkflowEditor key={props.scopeKey} {...props} />;
}

function WorkflowEditor(props: WorkflowFeatureProps) {
  const [draft, setDraft] = useState(() => createWorkflowDraft('free-chat', props.members));
  const [preview, setPreview] = useState<WorkflowPreview>();
  const [errors, setErrors] = useState<string[]>([]);
  const [checking, setChecking] = useState(false); const [applying, setApplying] = useState(false);
  const [submitted, setSubmitted] = useState(false); const [notice, setNotice] = useState('');
  const revision = useRef(0); const previewLock = useRef(false); const applyLock = useRef(false); const alive = useRef(true);
  const membership = JSON.stringify(props.members);
  useEffect(() => { alive.current = true; return () => { alive.current = false; revision.current++; }; }, []);
  useEffect(() => {
    revision.current++; previewLock.current = false; setChecking(false); setPreview(undefined); setSubmitted(false); setNotice('');
  }, [membership, props.onPreview, props.onApply]);

  function edit(next: WorkflowDraft) {
    if (applyLock.current) return;
    revision.current++; previewLock.current = false; setChecking(false);
    setDraft(next); setPreview(undefined); setErrors([]); setSubmitted(false); setNotice('');
  }
  function phaseEdit(index: number, patch: Partial<WorkflowDraft['phases'][number]>) {
    edit({ ...draft, phases: draft.phases.map((phase, i) => i === index ? { ...phase, ...patch } : phase) });
  }
  function moveMember(phaseIndex: number, memberIndex: number, offset: number) {
    const participants = [...draft.phases[phaseIndex].participants];
    [participants[memberIndex], participants[memberIndex + offset]] = [participants[memberIndex + offset], participants[memberIndex]];
    phaseEdit(phaseIndex, { participants });
  }
  async function validate() {
    if (!props.onPreview || previewLock.current || applyLock.current) return;
    const positive = (text: string) => /^\d+$/u.test(text) && Number.isSafeInteger(Number(text)) && Number(text) > 0;
    if (![draft.turnLimit, draft.durationMs, draft.outputTokens, ...draft.phases.map(p => p.repeat)].every(positive)
      || draft.phases.some(p => !p.participants.length || p.participants.some(id => !props.members.some(m => m.id === id && m.enabled)))) {
      setErrors(['请补全成员和正整数限制后再验证。']); return;
    }
    previewLock.current = true; setChecking(true); setErrors([]); setPreview(undefined); setNotice('');
    const token = ++revision.current;
    try {
      const result = await props.onPreview(structuredClone(draft));
      if (!alive.current || token !== revision.current) return;
      if (result.ok) { setPreview(result.preview); setSubmitted(false); }
      else setErrors(result.errors);
    } catch { if (alive.current && token === revision.current) setErrors(['验证失败，请检查配置后重试。']); }
    finally { if (alive.current && token === revision.current) { previewLock.current = false; setChecking(false); } }
  }
  async function apply() {
    if (!props.onApply || !preview || submitted || applyLock.current) return;
    applyLock.current = true; setApplying(true); setSubmitted(true); setErrors([]);
    const token = revision.current;
    try {
      await props.onApply({ previewId: preview.id, draft: structuredClone(draft) });
      if (alive.current && token === revision.current) setNotice('应用请求已提交，等待主界面确认。');
    } catch { if (alive.current && token === revision.current) setErrors(['应用结果未确认，请先核对主界面配置；重新应用前需再次验证。']); }
    finally { applyLock.current = false; if (alive.current) setApplying(false); }
  }
  const fixedMembers = draft.template === 'review-revision' || draft.template === 'two-model-dialogue';
  const reorderPhases = draft.template === 'free-chat' || draft.template === 'two-model-dialogue';
  return <section className="workflows-feature" data-theme={props.theme ?? 'system'} aria-label="工作流">
    <header><h1>工作流配置</h1><p>按阶段串行协作。先验证计划，再应用到下一次任务。</p></header>
    <label>工作流模板<select value={draft.template} disabled={applying} onChange={event => edit(createWorkflowDraft(event.target.value as WorkflowTemplate, props.members))}>
      {Object.entries(templates).map(([id, title]) => <option key={id} value={id}>{title}</option>)}
    </select></label>
    <ol className="workflow-phases">{draft.phases.map((phase, phaseIndex) => <li key={phase.key}>
      <fieldset disabled={applying} aria-label={`阶段 ${phaseIndex + 1} ${phase.title}`}><legend>{phaseIndex + 1}. {phase.title}</legend>
        {phase.participants.map((id, memberIndex) => <div className="workflow-member" key={memberIndex}>
          <label>{phase.title} 成员 {memberIndex + 1}<select value={id} onChange={event => phaseEdit(phaseIndex, { participants: phase.participants.map((value, i) => i === memberIndex ? event.target.value : value) })}>
            <option value="">请选择成员</option>
            {id && !props.members.some(m => m.id === id) && <option value={id} disabled>成员不可用（{id}）</option>}
            {props.members.map(member => <option key={member.id} value={member.id} disabled={!member.enabled}>{member.name}{!member.enabled ? '（已停用）' : ''}</option>)}
          </select></label>
          {!fixedMembers && <div className="workflow-actions">
            <button type="button" aria-label={`上移 ${phase.title} 成员 ${memberIndex + 1}`} disabled={memberIndex === 0} onClick={() => moveMember(phaseIndex, memberIndex, -1)}>上移</button>
            <button type="button" aria-label={`下移 ${phase.title} 成员 ${memberIndex + 1}`} disabled={memberIndex === phase.participants.length - 1} onClick={() => moveMember(phaseIndex, memberIndex, 1)}>下移</button>
            <button type="button" aria-label={`移除 ${phase.title} 成员 ${memberIndex + 1}`} onClick={() => phaseEdit(phaseIndex, { participants: phase.participants.filter((_, i) => i !== memberIndex) })}>移除</button>
          </div>}
        </div>)}
        {!fixedMembers && <button type="button" aria-label={`添加 ${phase.title} 成员`} disabled={phase.participants.length >= 32} onClick={() => phaseEdit(phaseIndex, { participants: [...phase.participants, props.members.find(m => m.enabled && !phase.participants.includes(m.id))?.id ?? ''] })}>添加成员</button>}
        <label>{phase.title} 重复次数<input type="number" min="1" max="32" step="1" value={phase.repeat} disabled={draft.template === 'review-revision' || draft.template === 'deep-debate' && phase.key !== 'rebuttal'} onChange={event => phaseEdit(phaseIndex, { repeat: event.target.value })} /></label>
        {reorderPhases && <div className="workflow-actions">{[-1, 1].map(offset => <button key={offset} type="button" disabled={phaseIndex + offset < 0 || phaseIndex + offset >= draft.phases.length} onClick={() => {
          const phases = [...draft.phases]; [phases[phaseIndex], phases[phaseIndex + offset]] = [phases[phaseIndex + offset], phases[phaseIndex]]; edit({ ...draft, phases });
        }}>{offset < 0 ? '上移阶段' : '下移阶段'}</button>)}<button type="button" disabled={draft.phases.length === 1} onClick={() => edit({
          ...draft, phases: draft.phases.filter(p => p.key !== phase.key), finishAt: draft.finishAt === phase.key ? '' : draft.finishAt,
        })}>移除阶段</button></div>}
      </fieldset>
    </li>)}</ol>
    {reorderPhases && <button type="button" disabled={applying || draft.phases.length >= 16} onClick={() => {
      const first = createWorkflowDraft(draft.template, props.members).phases[0];
      let nextId = draft.phases.length + 1;
      while (draft.phases.some(phase => phase.key === `${first.key}-${nextId}`)) nextId++;
      const key = `${first.key}-${nextId}`;
      edit({ ...draft, phases: [...draft.phases, { ...first, key, title: `${first.title} ${nextId}` }] });
    }}>添加阶段</button>}
    <fieldset disabled={applying} className="workflow-limits"><legend>结束与限制</legend>
      <label>最大回合数<input type="number" min="1" max="256" step="1" value={draft.turnLimit} onChange={e => edit({ ...draft, turnLimit: e.target.value })} /></label>
      <label>累计时长上限（毫秒）<input type="number" min="1" max="86400000" step="1" value={draft.durationMs} onChange={e => edit({ ...draft, durationMs: e.target.value })} /></label>
      <label>单次输出上限（Token）<input type="number" min="1" max="65536" step="1" value={draft.outputTokens} onChange={e => edit({ ...draft, outputTokens: e.target.value })} /></label>
      <label>结束条件<select value={draft.finishAt} onChange={e => edit({ ...draft, finishAt: e.target.value })}><option value="">完成计划后结束</option>{draft.phases.map(p => <option key={p.key} value={p.key}>{p.title}完成后结束</option>)}</select></label>
      <p>每轮按成员顺序各执行一回合。暂停时间不计入累计用时，硬限制可提前结束计划。</p>
    </fieldset>
    {errors.length > 0 && <div role="alert" className="workflow-error">{errors.map((error, i) => <p key={i}>{error}</p>)}</div>}
    {!props.onPreview && <p>工作流验证尚未接入，当前只能编辑草稿。</p>}
    {!props.onApply && <p>配置应用尚未接入。</p>}
    <div className="workflow-actions"><button type="button" disabled={!props.onPreview || checking || applying} onClick={() => void validate()}>{checking ? '正在验证…' : '验证并预览'}</button>
      <button type="button" className="workflow-primary" disabled={!props.onApply || !preview || submitted || applying} onClick={() => void apply()}>{applying ? '正在提交…' : '应用配置'}</button></div>
    {notice && <p role="status">{notice}</p>}
    {preview && <section aria-label="计划预览"><h2>已验证的计划预览</h2><p>预计 {preview.totalTurns} 回合</p><ol>{preview.stages.map(stage => <li key={stage.id}>{stage.label} · {stage.memberNames.join(' → ')} · {stage.turns} 回合</li>)}</ol><p>下一步：{preview.nextStep}</p><p>{preview.ending}</p><p>{preview.limits}</p></section>}
    <section aria-label="运行进度"><h2>运行进度</h2>{props.progress ? <>
      <p>{props.progress.runLabel}</p><p role="status">{props.progress.status}</p><p>{props.progress.completedTurns} / {props.progress.totalTurns} 回合</p>
      <progress aria-label="已完成回合" max={props.progress.totalTurns || 1} value={props.progress.completedTurns} />
      <p>累计用时 {props.progress.elapsedMs} 毫秒</p><p>{props.progress.currentStage}</p><p>下一步：{props.progress.nextStep}</p>
      {props.progress.limitReason && <p>{props.progress.limitReason}</p>}
      <ol>{props.progress.stages.map(stage => <li key={stage.id}>{stage.label} · {stage.status} · {stage.completedTurns} / {stage.totalTurns} 回合</li>)}</ol>
    </> : <p>当前没有可显示的运行进度。</p>}</section>
  </section>;
}
