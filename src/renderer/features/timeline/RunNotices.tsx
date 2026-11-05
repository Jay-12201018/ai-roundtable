import { CircleStop, Clock, History, Layers, RefreshCw, TriangleAlert } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { Button, Note, NoticeCard } from '../../components/ui';
import { durationStopText, durationText } from '../../locales/zhCN';
import { canContinueRun, summaryWritable } from '../host/model';
import { GROUP_CHAT_MAX_TURNS } from '../../../shared/schemas/groupChat';

/** D107: the moment to summarize is the host's call; this only says how full the context is. */
export function ContextHint({ snapshot, onSummarize }: { snapshot: RunSnapshot; onSummarize: () => void }) {
  const pressure = snapshot.contextPressure;
  if (!pressure || pressure.level === 'ok') return null;
  const percent = Math.min(100, Math.round(pressure.usedTokens / Math.max(1, pressure.inputBudgetTokens) * 100));
  const writable = summaryWritable(snapshot);
  return <div className="context-hint"><Note tone="info" icon={Layers} role="status" action={<Button size="sm" onClick={onSummarize} disabled={!writable}>生成摘要</Button>}>
    {pressure.level === 'over'
      ? `讨论已超过上下文上限：下一次请求有 ${pressure.omittedMessages} 条较早的发言放不下，不会发给模型（原文仍保留）。生成摘要后，后续发言能看到它们的要点。`
      : `讨论已接近上下文上限：下一次请求约占可用输入的 ${percent}%。再继续下去，较早的发言会放不下。可以生成摘要，用摘要代替较早的发言。`}
    {writable ? '' : ' 暂停或等当前回合结束后可以生成摘要。'}
  </Note></div>;
}

type Repeat = { enabled: boolean; run: () => void };
type Props = {
  snapshot: RunSnapshot | undefined; error?: string; syncFailed: boolean; onRetrySync: () => void;
  retry: Repeat; resume: Repeat; carryOn?: Repeat;
  recover: { inspect: Repeat; resume: Repeat; discard: Repeat }; onSummarize: () => void; summaryOpen: boolean;
};

/** Everything that ends or blocks a Run sits right after the last message it describes, with its one way forward. */
export function RunNotices({ snapshot, error, syncFailed, onRetrySync, retry, resume, carryOn, recover, onSummarize, summaryOpen }: Props) {
  if (syncFailed) return <div className="run-notices"><NoticeCard tone="danger" icon={RefreshCw} title="同步运行状态失败">
    <p>{error ?? '已保留当前文本。'}</p>
    <div className="notice-row"><Button variant="primary" onClick={onRetrySync}>重试同步</Button></div>
  </NoticeCard></div>;
  if (!snapshot) return null;
  const lastTurn = snapshot.turns.at(-1);
  const lastAttempt = snapshot.attempts?.filter(attempt => attempt.turnId === lastTurn?.turnId).at(-1);
  const member = snapshot.execution?.membersSnapshot?.find(item => item.agentId === lastTurn?.agentId);
  const repeatable = retry.enabled || resume.enabled;
  const repeatButtons = repeatable && <>
    <div className="notice-row">
      {retry.enabled && <Button variant="primary" onClick={retry.run}>{snapshot.groupChat ? '让 TA 重说' : '重试当前回合'}</Button>}
      {resume.enabled && <Button onClick={resume.run}>{snapshot.groupChat ? '接着说完' : '续写部分回复'}</Button>}
    </div>
    <p className="notice-hint">{snapshot.groupChat ? '这两个都会重新发送请求，可能再次计费。' : '重试和续写会重新发送请求，可能再次计费。'}</p>
  </>;
  return <div className="run-notices">
    {snapshot.status === 'interrupted' && <NoticeCard icon={History} title="执行已中断，部分输出已保留">
      <p>应用上次关闭时，这次讨论还在进行。为避免重复计费，不会自动重发。请先检查中断记录，再决定恢复后续回合或放弃。</p>
      <div className="notice-row">
        <Button variant="primary" disabled={!recover.inspect.enabled} onClick={recover.inspect.run}>检查中断记录</Button>
        <Button disabled={!recover.resume.enabled} onClick={recover.resume.run}>恢复后续回合</Button>
        <Button variant="quiet" disabled={!recover.discard.enabled} onClick={recover.discard.run}>放弃中断执行</Button>
      </div>
      {repeatButtons}
    </NoticeCard>}
    {snapshot.status === 'cancelled' && <NoticeCard tone="info" icon={CircleStop} title="已停止 · 已生成的文字都保留" role="status">
      <p>{snapshot.groupChat ? '大家先停下了，不会自动继续。发新消息就能接着聊。' : '后续回合不会再进行，也不会自动继续。'}{!snapshot.groupChat && canContinueRun(snapshot) ? '要接着讨论，在下方输入框写下你的话：所有成员各回应一次，或用 @ 只让一位回应。' : ''}</p>{repeatButtons}
    </NoticeCard>}
    {snapshot.durationStop && <NoticeCard tone="info" icon={Clock} title="已到时长上限" role="status">
      <p>{durationStopText(snapshot.durationStop.limitMs)}已生成的发言都保留，现在没有在发送请求。</p>
      <div className="notice-row"><Button variant="primary" disabled={!carryOn?.enabled} onClick={carryOn?.run}>继续讨论</Button></div>
      <p className="notice-hint">点了才会发送：{retry.enabled ? '没说完的这位成员会重新回复' : '下一位成员接着发言'}，可能产生费用。继续后最多再运行 {durationText(snapshot.durationStop.nextAllowanceMs)}。</p>
    </NoticeCard>}
    {snapshot.status === 'error' && !snapshot.durationStop && <NoticeCard tone="danger" icon={TriangleAlert} title="运行失败">
      <p>{error ?? '运行失败，历史输出已保留。'}</p>
      {snapshot.lastFailure?.code === 'invalid_input' && (snapshot.taskAttachments?.length || snapshot.messages.some(message => message.attachments?.length)) ? <p>这场讨论带了图片。如果这个模型不接受图片，开始新讨论时给这位成员换一个能看图的模型。</p> : null}
      {snapshot.groupChat && <p>也可以直接发新消息：还没说话的成员不再说，按新消息重新安排。</p>}
      {repeatButtons}
    </NoticeCard>}
    {error && snapshot.status !== 'error' && <p className="run-error" role="alert">{error}</p>}
    {!summaryOpen && <ContextHint snapshot={snapshot} onSummarize={onSummarize} />}
    {snapshot.groupChat?.round?.state === 'stopped' && !['running', 'pausing', 'cancelling', 'cancelled'].includes(snapshot.status) && <div className="sys-line" role="status">大家停下了，发新消息可以继续。</div>}
    {snapshot.groupChat?.round?.state === 'limit' && <div className="sys-line" role="status">这条消息的回复到了 {GROUP_CHAT_MAX_TURNS} 次发言的上限，大家先停下了。发新消息可以继续。</div>}
    {snapshot.status === 'completed' && !snapshot.groupChat && <div className="sys-line">讨论已完成{snapshot.workflow?.limitReason ? ` · ${snapshot.workflow.limitReason === 'max_turns' ? '回合数到限' : '累计时长到限'}` : ''} · 可以在下方继续这场讨论，或开始新讨论</div>}
  </div>;
}
