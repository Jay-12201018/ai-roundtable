import { useState } from 'react';
import { Check, Code, FileText, ListChecks, Table, X } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { formatYuan } from '../../../shared/schemas/budget';
import { Avatar, Button, IconButton, Pill, Tabs, cx } from '../../components/ui';
import { statusLabels } from '../../locales/zhCN';
import { HostTextArea } from '../host/HostTextArea';
import { canContinueRun, canDirectRun, isContinuationTurn, nextSpeaker, nextSpeakerText, overrideCandidates, planTurnCount, scheduledNext, summaryWritable, timelineSlots, usedSummary } from '../host/model';
import type { HostCommands } from '../host/useHostCommands';
import { parseBudgetYuan, yuanShort, type LedgerCommands } from '../usage';
import { workflowProgressForFeature, workflowTemplateLabels } from '../workflows/productionAdapter';
import { modelLabel, type ProviderNames } from '../timeline/model';
import './runPanel.css';

export type PanelTab = 'progress' | 'members' | 'instructions' | 'artifacts';
const clock = (iso: string) => new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const duration = (ms: number) => { const seconds = Math.round(ms / 1000); return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`; };

/** Run-level spend: limit (with top-ups), what is spent and how, what is left; a top-up is one click away. */
export function BudgetCard({ snapshot, ledger }: { snapshot: RunSnapshot; ledger?: LedgerCommands }) {
  const [adding, setAdding] = useState(false);
  const [amount, setAmount] = useState('1');
  const budget = snapshot.budget;
  if (!budget) return <p className="muted small">这次讨论没有预算记录（较早版本创建，或只用内置 Mock）。</p>;
  const written = budget.writtenOffMicro ?? 0;
  const spent = budget.settledMicro + budget.unknownMicro + written;
  const topUps = budget.topUps ?? [];
  const added = topUps.reduce((total, topUp) => total + topUp.amountMicro, 0);
  const micro = parseBudgetYuan(amount);
  const blockedHere = budget.blocked?.reason === 'insufficient' && snapshot.status === 'error';
  const percent = (value: number) => `${Math.min(100, budget.limitMicro ? value / budget.limitMicro * 100 : 0)}%`;
  const warn = budget.blocked !== undefined || budget.overrunMicro > 0;
  return <section className={cx('budget-card', warn && 'is-warn')} aria-label="运行预算">
    <div className="budget-big tabular">{formatYuan(spent)} <small>/ {yuanShort(budget.limitMicro)}{added > 0 ? `（含追加 ${yuanShort(added)}）` : ''}</small></div>
    <div className="budget-bar" aria-hidden><i style={{ width: percent(spent) }} />{budget.reservedMicro > 0 && <i className="is-reserved" style={{ width: percent(budget.reservedMicro) }} />}</div>
    <dl className="budget-rows tabular">
      <dt>剩余额度</dt><dd>{formatYuan(budget.remainingMicro)}</dd>
      <dt>进行中预留</dt><dd>{budget.reservedMicro > 0 ? formatYuan(budget.reservedMicro) : '—'}</dd>
      <dt>未知费用（按上限计）</dt><dd>{budget.unknownMicro > 0 ? formatYuan(budget.unknownMicro) : '无'}</dd>
      {(written > 0 || (snapshot.charges ?? []).some(charge => charge.writeOffs?.length)) && <><dt>已核销</dt><dd>{formatYuan(written)}</dd></>}
      {budget.overrunMicro > 0 && <><dt>超出</dt><dd className="is-danger">{formatYuan(budget.overrunMicro)}</dd></>}
    </dl>
    {budget.blocked && <p className="budget-blocked">{budget.blocked.reason === 'insufficient' ? '已因预算不足停止发送，可以在讨论末尾追加并继续。' : '已因用量超出上限停止。'}</p>}
    {ledger?.available && !blockedHere && !adding && <Button size="sm" onClick={() => setAdding(true)}>追加预算</Button>}
    {ledger?.available && !blockedHere && adding && <form className="budget-add" onSubmit={event => { event.preventDefault(); if (micro !== undefined) void ledger.addBudget(micro, false).then(result => { if (result) setAdding(false); }); }}>
      <span className="money-input" data-invalid={micro === undefined || undefined}><span aria-hidden>¥</span>
        <input aria-label="追加预算（元）" inputMode="decimal" value={amount} aria-invalid={micro === undefined} autoFocus onChange={event => setAmount(event.target.value)} /></span>
      <Button type="submit" size="sm" variant="primary" disabled={micro === undefined || ledger.pending !== undefined}>追加</Button>
      <Button size="sm" variant="quiet" onClick={() => setAdding(false)}>取消</Button>
      <p className="field-help">只能追加、不能减少；每次追加单独记录。</p>
    </form>}
    {topUps.length > 0 && <details className="budget-history">
      <summary>追加记录（{topUps.length}）</summary>
      <ol>{topUps.map(topUp => <li key={topUp.topUpId}>+{formatYuan(topUp.amountMicro)} · {clock(topUp.createdAt)}</li>)}</ol>
      <p>开始时 {formatYuan(budget.initialLimitMicro ?? budget.limitMicro - added)}，之后共追加 {formatYuan(added)}。</p>
    </details>}
    {ledger?.notice?.key === 'budget' && !blockedHere && <p role="status" className="budget-notice">{ledger.notice.message}</p>}
    {ledger?.error?.key === 'budget' && !blockedHere && <p role="alert" className="field-error">{ledger.error.message}</p>}
  </section>;
}

/** D110/D111: Turns the host inserted (named or asked to continue) are counted apart from the plan's turns. */
function insertedText(snapshot: RunSnapshot): string {
  const inserted = snapshot.turns.filter(turn => turn.overrideActionId);
  if (!inserted.length) return '';
  const continued = inserted.filter(turn => isContinuationTurn(snapshot, turn.overrideActionId)).length;
  const named = inserted.length - continued;
  return ` · 另有 ${inserted.length} 轮插入（${[named ? `点名 ${named}` : '', continued ? `继续讨论 ${continued}` : ''].filter(Boolean).join('、')}）`;
}

function ProgressTab({ snapshot, ledger, onSummarize, onOpenWorkflow }: { snapshot: RunSnapshot; ledger?: LedgerCommands; onSummarize?: () => void; onOpenWorkflow?: () => void }) {
  const progress = workflowProgressForFeature(snapshot);
  const workflow = snapshot.workflow;
  const used = usedSummary(snapshot);
  const numbered = (timelineSlots(snapshot)?.filter(slot => slot.number !== undefined).length ?? 0);
  const writable = summaryWritable(snapshot);
  return <>
    <section className="ctx-sec"><h3>预算</h3>
      <BudgetCard snapshot={snapshot} ledger={ledger} />
      <p className="small muted ctx-note">按官方单价估算，DeepSeek 空闲时段按半价；实际扣费以服务商控制台为准。</p>
    </section>
    <section className="ctx-sec"><h3>讨论方式{onOpenWorkflow && <button type="button" className="link-btn" aria-label="查看讨论方式" onClick={onOpenWorkflow}>查看</button>}</h3>
      {progress && workflow ? <>
        <p className="small muted ctx-lead">{workflowTemplateLabels[workflow.templateId]} · 第 {Math.min(progress.completedTurns + (snapshot.turns.some(turn => turn.turnId === snapshot.currentTurnId && !turn.overrideActionId) ? 1 : 0), progress.totalTurns)} / {progress.totalTurns} 步 · 用时 {duration(progress.elapsedMs)}{progress.limitReason ? ` · ${progress.limitReason}` : ''}{insertedText(snapshot)}</p>
        <ol className="steps">{progress.stages.map(stage => {
          const state = stage.status === '已完成' ? 'done' : stage.status === '执行中' ? 'now' : '';
          return <li key={stage.id} className={state}><span className="mark" aria-hidden>{state === 'done' && <Check size={11} strokeWidth={3} />}</span>
            <span><span className="t">{stage.label}</span><span className="s">{stage.status} · {stage.completedTurns}/{stage.totalTurns} 回合</span></span></li>;
        })}</ol>
        <p className="small muted">下一步：{progress.nextStep}</p>
      </> : <p className="small muted ctx-lead">成员按顺序轮流发言 · 计划 {Math.min(planTurnCount(snapshot), snapshot.execution?.maxTurns ?? 0)} / {snapshot.execution?.maxTurns ?? '—'} 回合{insertedText(snapshot)}{snapshot.execution?.elapsedExecutionMs ? ` · 用时 ${duration(snapshot.execution.elapsedExecutionMs)}` : ''}</p>}
    </section>
    {onSummarize && <section className="ctx-sec"><h3>讨论摘要</h3>
      <p className="small muted">{used ? `之后的发言正在用摘要代替第 1–${used.lastNumber} 条原文。讨论再变长时，可以在此基础上续写摘要。`
        : '讨论变长、快放不进上下文时，可以把较早的发言整理成摘要。生成是一次真实请求，会按预算预留和结算；不会自动生成。'}</p>
      <Button size="sm" disabled={!writable || numbered < 2} onClick={onSummarize}>生成讨论摘要…</Button>
      {!writable && <p className="small muted">暂停运行或等当前请求结束后可以生成摘要。</p>}
    </section>}
  </>;
}

function MembersTab({ snapshot, commands, providers }: { snapshot: RunSnapshot; commands: HostCommands; providers?: ProviderNames }) {
  const members = snapshot.execution?.membersSnapshot ?? [];
  const candidates = new Set(overrideCandidates(snapshot).map(member => member.agentId));
  const directable = canDirectRun(snapshot);
  const override = snapshot.host?.override;
  const next = ['running', 'pausing', 'paused'].includes(snapshot.status) || override ? nextSpeaker(snapshot) : undefined;
  const nextText = next ? nextSpeakerText(next) : undefined;
  const speaking = snapshot.turns.find(turn => turn.turnId === snapshot.currentTurnId)?.agentId;
  // D110: the member the schedule already has next gets no 点名 (it would only make them speak twice); its row says 下一位.
  const scheduled = scheduledNext(snapshot);
  const disabled = !commands.available || commands.pending !== undefined;
  return <section className="ctx-sec"><h3>本场成员</h3>
    <p className="small ctx-lead">{nextText ? `下一位：${nextText.name}（${nextText.source}）${nextText.then ? ` · ${nextText.then}` : ''}`
      : canContinueRun(snapshot) ? '讨论已结束。可以在下方输入框里继续：所有成员各回应一次，或用 @ 只让一位回应。' : '下一位：暂无（运行未在进行，或计划的回合已用完）'}</p>
    {members.map(member => {
      const state = member.agentId === speaking ? '正在发言' : override?.agentId === member.agentId ? '已点名' : next?.agentId === member.agentId ? '下一位' : undefined;
      return <div key={member.agentId} className="member-row"><Avatar name={member.displayName} />
        <div className="info"><b>{member.displayName}</b><small>角色：{member.roleTemplateId || '未记录'} · {modelLabel(member, providers)}</small></div>
        {state && <Pill tone={state === '正在发言' ? 'live' : 'neutral'}>{state}</Pill>}
        {directable && candidates.has(member.agentId) && override?.agentId !== member.agentId && scheduled !== member.agentId && <Button size="sm" variant="quiet" disabled={disabled} aria-label={`点名 ${member.displayName}`}
          onClick={() => void commands.send('override', { kind: 'setOverride', agentId: member.agentId }, `已点名${member.displayName}，将在下一回合发言。`)}>点名</Button>}
      </div>;
    })}
    {override && directable && <Button size="sm" disabled={disabled} onClick={() => void commands.send('cancelOverride', { kind: 'cancelOverride' }, '已取消点名，恢复按计划发言。')}>取消点名</Button>}
    {directable && <p className="small muted">点名是在下一回合插入一轮：不占用计划的回合{snapshot.workflow ? '和步骤' : ''}，之后回到原计划，原计划的成员不会被跳过。按计划的下一位不用点名，直接在下方插话即可。{snapshot.workflow ? '按讨论方式进行时只能点名当前阶段的成员。' : ''}</p>}
    <p className="small muted">成员名单在讨论开始时固定；在「房间」里改成员，只影响之后的讨论。也可以在下方输入框里输入 @ 点名。</p>
  </section>;
}

function InstructionsTab({ snapshot, commands }: { snapshot: RunSnapshot; commands: HostCommands }) {
  const [editing, setEditing] = useState<{ instructionId: string; content: string; original: string }>();
  const [instruction, setInstruction] = useState('');
  const instructions = snapshot.host?.instructions ?? [];
  const active = instructions.filter(item => item.status === 'active');
  const cleared = instructions.filter(item => item.status === 'cleared');
  const writable = snapshot.status !== 'idle' && snapshot.status !== 'cancelling';
  const disabled = !commands.available || commands.pending !== undefined;
  const save = async () => {
    if (!editing?.content.trim() || editing.content === editing.original) return;
    if (await commands.send(`instruction:${editing.instructionId}`, { kind: 'setInstruction', instructionId: editing.instructionId, content: editing.content }, '持续指令已修改，从下一个新请求起使用。')) setEditing(undefined);
  };
  const add = async () => {
    if (!instruction.trim()) return;
    if (await commands.send('instruction:new', { kind: 'setInstruction', content: instruction }, '持续指令已生效，从下一个新请求起使用。')) setInstruction('');
  };
  return <section className="ctx-sec"><h3>持续指令 <span className="small muted">每次发言都会遵守</span></h3>
    {active.length === 0 && <p className="small muted">没有生效中的持续指令。</p>}
    {active.map(item => <div key={item.instructionId} className="instr">
      {editing?.instructionId === item.instructionId ? <form onSubmit={event => { event.preventDefault(); void save(); }}>
        <HostTextArea className="textarea" aria-label="修改持续指令" rows={3} autoFocus value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} onSubmit={() => void save()} />
        <div className="instr-actions"><Button size="sm" onClick={() => setEditing(undefined)}>取消</Button>
          <Button size="sm" type="submit" variant="primary" disabled={disabled || !editing.content.trim() || editing.content === editing.original}>保存修改</Button></div>
      </form> : <>
        <p>{item.content}</p>
        <small><span>第 {item.revision} 版 · 从下一次发言起生效</span><span className="grow" />
          <button type="button" className="link-btn" disabled={disabled || !writable} onClick={() => setEditing({ instructionId: item.instructionId, content: item.content, original: item.content })}>修改</button>
          <button type="button" className="link-btn is-danger" disabled={disabled || !writable} onClick={() => void commands.send(`clear:${item.instructionId}`, { kind: 'clearInstruction', instructionId: item.instructionId }, '持续指令已清除，从下一个新请求起不再使用。')}>清除</button></small>
      </>}
    </div>)}
    {cleared.length > 0 && <p className="small muted">已清除 {cleared.length} 条指令；历史版本保留在主持人记录中。</p>}
    <form className="instr-new" onSubmit={event => { event.preventDefault(); void add(); }}>
      <HostTextArea className="textarea" aria-label="新增持续指令" rows={2} value={instruction} placeholder="例如：所有金额精确到元，并标出依据" disabled={!writable} onChange={event => setInstruction(event.target.value)} onSubmit={() => void add()} />
      <Button size="sm" type="submit" disabled={disabled || !writable || !instruction.trim()}>添加持续指令</Button>
    </form>
    <p className="small muted">运行中也可以在输入框写好一段话，点「设为持续指令」。</p>
  </section>;
}

function ArtifactsTab() {
  const item = (Icon: typeof FileText, title: string, text: string) => <div className="artifact"><Icon aria-hidden size={16} /><div className="grow"><b>{title}</b><small>{text}</small></div><span className="tag">即将推出</span></div>;
  return <section className="ctx-sec"><h3>整理成…</h3>
    <p className="small muted ctx-lead">把讨论整理成可以直接用的东西。这部分功能即将推出，现在还不能生成。</p>
    {item(FileText, '方案文档', '把讨论结论整理成一份文档，标出来源发言')}
    {item(Table, '对比表', '把讨论中的几种方案并排比较')}
    {item(ListChecks, '行动清单', '负责人、截止时间、来源发言')}
    {item(Code, '代码候选', '预览 diff 和路径，逐个文件确认后才写入磁盘；不会执行生成的代码')}
    <p className="small muted">将来生成产物是一次真实请求，开始前会显示预计最高花费。</p>
  </section>;
}

/** 本场信息: for looking things up; acting stays in the composer and on the messages themselves. */
export function RunPanel({ snapshot, commands, ledger, providers, tab, onTab, onClose, onSummarize, onOpenWorkflow, syncLabel }: {
  snapshot: RunSnapshot | undefined; commands: HostCommands; ledger?: LedgerCommands; providers?: ProviderNames;
  tab: PanelTab; onTab: (tab: PanelTab) => void; onClose: () => void; onSummarize?: () => void; onOpenWorkflow?: () => void; syncLabel: string;
}) {
  const instructions = snapshot?.host?.instructions.filter(item => item.status === 'active').length ?? 0;
  const members = snapshot?.execution?.membersSnapshot?.length ?? 0;
  return <aside className="run-panel" aria-label="本场信息">
    <div className="ctx-head"><h2>本场信息</h2><IconButton icon={X} label="关闭本场信息" onClick={onClose} data-autofocus /></div>
    <Tabs idPrefix="ctx" label="本场信息" value={tab} onChange={onTab} tabs={[{ id: 'progress', label: '进度' }, { id: 'members', label: '成员', count: members },
      { id: 'instructions', label: '指令', count: instructions }, { id: 'artifacts', label: '产物' }]} />
    <div className="ctx-body" id={`ctx-panel-${tab}`} role="tabpanel" aria-labelledby={`ctx-tab-${tab}`}>
      {!snapshot ? <p className="small muted">开始讨论后，这里会显示这场讨论的预算和花费、讨论方式的进度、成员状态和持续指令。</p>
        : tab === 'progress' ? <ProgressTab snapshot={snapshot} ledger={ledger} onSummarize={onSummarize} onOpenWorkflow={onOpenWorkflow} />
        : tab === 'members' ? <MembersTab snapshot={snapshot} commands={commands} providers={providers} />
        : tab === 'instructions' ? <InstructionsTab snapshot={snapshot} commands={commands} />
        : <ArtifactsTab />}
    </div>
    <details className="dev-details"><summary>运行详情（排查问题时用）</summary>
      <dl><dt>运行 ID</dt><dd>{snapshot?.runId ?? '—'}</dd><dt>事件序列</dt><dd>{snapshot?.sequence ?? 0}</dd>
        <dt>回合</dt><dd>{snapshot?.turns.length ?? 0}{snapshot?.execution ? ` / ${snapshot.execution.maxTurns}` : ''}</dd>
        <dt>运行状态</dt><dd>{snapshot ? statusLabels[snapshot.status] ?? '未知状态' : '—'}</dd><dt>状态来源</dt><dd>{syncLabel}</dd></dl>
    </details>
  </aside>;
}
