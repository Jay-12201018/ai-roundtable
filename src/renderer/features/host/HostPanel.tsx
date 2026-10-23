import { useState } from 'react';
import './host.css';
import type { RunSnapshot } from '../../../shared/types/run';
import { HostTextArea } from './HostTextArea';
import { canDirectRun, nextSpeaker, overrideCandidates, summaryWritable, timelineSlots, usedSummary } from './model';
import type { HostCommands } from './useHostCommands';

type Props = { snapshot: RunSnapshot | undefined; commands: HostCommands; onSummarize?: () => void };

/** Host controls for the selected Run: next speaker, interjection and standing instructions. */
export function HostPanel({ snapshot, commands, onSummarize }: Props) {
  const [message, setMessage] = useState('');
  const [instruction, setInstruction] = useState('');
  const [editing, setEditing] = useState<{ instructionId: string; content: string; original: string }>();
  const disabled = !commands.available || commands.pending !== undefined;
  const directable = canDirectRun(snapshot);
  const candidates = overrideCandidates(snapshot);
  const next = snapshot && ['running', 'pausing', 'paused'].includes(snapshot.status) || snapshot?.host?.override ? nextSpeaker(snapshot) : undefined;
  const instructions = snapshot?.host?.instructions ?? [];
  const active = instructions.filter(item => item.status === 'active');
  const cleared = instructions.filter(item => item.status === 'cleared');
  const instructionsWritable = !!snapshot && snapshot.status !== 'idle' && snapshot.status !== 'cancelling';
  const generation = snapshot?.host?.generation;
  const send = async () => {
    if (!message.trim()) return;
    if (await commands.send('interject', { kind: 'interject', content: message }, '插话已加入公共历史，从下一回合起可见。')) setMessage('');
  };
  const addInstruction = async () => {
    if (!instruction.trim()) return;
    if (await commands.send('instruction:new', { kind: 'setInstruction', content: instruction }, '持续指令已生效，从下一个新请求起使用。')) setInstruction('');
  };
  const saveInstruction = async () => {
    if (!editing?.content.trim() || editing.content === editing.original) return;
    if (await commands.send(`instruction:${editing.instructionId}`, { kind: 'setInstruction', instructionId: editing.instructionId, content: editing.content }, '持续指令已修改，从下一个新请求起使用。')) setEditing(undefined);
  };
  if (!snapshot) return null;
  return <section className="host-panel" aria-label="主持人指令">
    <h3>下一位发言</h3>
    <p className="host-next">{next ? `下一位：${next.name}${next.source === 'override' ? '（主持人点名，排在下一回合，不打断正在进行的发言）' : '（按计划）'}`
      : snapshot.status === 'completed' ? '下一位：无（运行已完成）' : '下一位：暂无（运行未在进行，或已达回合上限）'}</p>
    {directable && candidates.length > 0 && <div className="host-row" role="group" aria-label="点名下一位成员">
      <span className="host-hint">点名后，被点名的成员在下一回合发言（正在进行的发言不会被打断）：</span>
      {candidates.map(member => {
        const chosen = snapshot.host?.override?.agentId === member.agentId;
        return <button type="button" key={member.agentId} aria-pressed={chosen} disabled={disabled || chosen}
          onClick={() => void commands.send('override', { kind: 'setOverride', agentId: member.agentId }, `已点名${member.name}，将在下一回合发言。`)}>点名 {member.name}</button>;
      })}
      {snapshot.host?.override && <button type="button" disabled={disabled} onClick={() => void commands.send('cancelOverride', { kind: 'cancelOverride' }, '已取消点名，恢复按计划发言。')}>取消点名</button>}
    </div>}
    {snapshot.workflow && directable && <p className="host-hint">工作流运行中只能点名当前阶段成员；点名回合为计划外插入，不占用计划步骤，但计入回合上限。</p>}

    <h3>插话</h3>
    {directable ? <form className="host-compose" onSubmit={event => { event.preventDefault(); void send(); }}>
      <HostTextArea aria-label="主持人插话" rows={3} value={message} placeholder="Enter 发送，Shift+Enter 换行" onChange={event => setMessage(event.target.value)} onSubmit={() => void send()} />
      <button type="submit" disabled={disabled || !message.trim()}>发送插话</button>
    </form> : <p className="host-hint">{snapshot.status === 'completed' ? '运行已完成，不能再插话；仍可修改消息或重新生成某条回复。' : '运行开始后可以插话。'}</p>}

    <h3>持续指令</h3>
    {active.length === 0 && <p className="host-hint">没有生效中的持续指令。</p>}
    <ul className="host-instructions">
      {active.map(item => <li key={item.instructionId}>
        {editing?.instructionId === item.instructionId ? <form onSubmit={event => { event.preventDefault(); void saveInstruction(); }}>
          <HostTextArea aria-label="修改持续指令" rows={3} autoFocus value={editing.content} onChange={event => setEditing({ ...editing, content: event.target.value })} onSubmit={() => void saveInstruction()} />
          <button type="submit" disabled={disabled || !editing.content.trim() || editing.content === editing.original}>保存修改</button>
          <button type="button" onClick={() => setEditing(undefined)}>取消</button>
        </form> : <>
          <p>{item.content}</p>
          <small>生效中 · 第 {item.revision} 版 · 仅影响之后开始的请求</small>
          <button type="button" disabled={disabled || !instructionsWritable} onClick={() => setEditing({ instructionId: item.instructionId, content: item.content, original: item.content })}>修改</button>
          <button type="button" disabled={disabled || !instructionsWritable} onClick={() => void commands.send(`clear:${item.instructionId}`, { kind: 'clearInstruction', instructionId: item.instructionId }, '持续指令已清除，从下一个新请求起不再使用。')}>清除</button>
        </>}
      </li>)}
    </ul>
    {cleared.length > 0 && <p className="host-hint">已清除 {cleared.length} 条指令；历史版本保留在主持人记录中。</p>}
    <form className="host-compose" onSubmit={event => { event.preventDefault(); void addInstruction(); }}>
      <HostTextArea aria-label="新增持续指令" rows={2} value={instruction} placeholder="例如：所有回答使用中文并给出编号" disabled={!instructionsWritable} onChange={event => setInstruction(event.target.value)} onSubmit={() => void addInstruction()} />
      <button type="submit" disabled={disabled || !instructionsWritable || !instruction.trim()}>添加持续指令</button>
    </form>

    {onSummarize && <>
      <h3>讨论摘要</h3>
      <p className="host-hint">{usedSummary(snapshot) ? `之后的发言正在用摘要代替第 1–${usedSummary(snapshot)!.lastNumber} 条原文。讨论再变长时，可以在此基础上续写摘要。`
        : '讨论变长、快放不进上下文时，可以把较早的发言整理成摘要。生成是一次真实请求，会按预算预留和结算；不会自动生成。'}</p>
      <button type="button" disabled={!summaryWritable(snapshot) || (timelineSlots(snapshot)?.filter(slot => slot.number !== undefined).length ?? 0) < 2} onClick={onSummarize}>生成讨论摘要…</button>
      {!summaryWritable(snapshot) && <p className="host-hint">暂停运行或等当前请求结束后可以生成摘要。</p>}
    </>}

    {generation && <button type="button" disabled={disabled} onClick={() => void commands.send('abort', { kind: 'abortGeneration' }, '已中止重新生成，部分输出已保留。')}>中止重新生成</button>}
    {commands.pending && <p role="status" className="sync-feedback">主持人操作已发送，等待主进程确认</p>}
    {commands.notice && <p role="status">{commands.notice}</p>}
    {commands.error && <p role="alert" className="error">{commands.error}</p>}
  </section>;
}
