import { useId, useMemo, useState, type ReactNode } from 'react';
import { Ellipsis } from 'lucide-react';
import type { RunSnapshot } from '../../../shared/types/run';
import { Avatar, IconButton, Tag } from '../../components/ui';
import { chargeOfMessage } from '../usage';
import { timelineSlots, usedSummary } from '../host/model';
import type { HostCommands } from '../host/useHostCommands';
import type { SummaryCommands } from '../host/useSummaryCommands';
import type { LedgerCommands } from '../usage';
import { Markdown } from './Markdown';
import { stageOfTurn } from '../workflows/productionAdapter';
import { RequestDetails, SlotItem } from './MessageItem';
import { SummaryCard } from './SummaryCard';
import { Timeline, type TimelineItem } from './Timeline';
import { memberOf, messageStatusText, modelLabel, providerLabel, type ProviderNames } from './model';
import './timeline.css';

export { Markdown, markdownSchema, safeHref } from './Markdown';
export { Timeline, VIRTUALIZE_AT, type TimelineItem } from './Timeline';
export { RunNotices, ContextHint } from './RunNotices';
export { SummaryDialog } from './SummaryDialog';
export { requestFailureText } from './failure';
export { SummaryCard } from './SummaryCard';
export { AgentMessage, HostMessage, SlotItem } from './MessageItem';
export { providerNamesFrom, modelLabel, providerLabel, type ProviderNames } from './model';

type Props = { snapshot: RunSnapshot; commands: HostCommands; providers?: ProviderNames; ledger?: LedgerCommands; summaries: SummaryCommands;
  onRegenerateSummary: (summaryId: string) => void; header?: ReactNode; footer?: ReactNode;
  /** R14: a message to bring into view, by slot id (from an artifact's sources). */
  reveal?: { key: string; nonce: number } };

/** The shared public timeline of one Run: one item per message slot, its effective version first. */
export function DiscussionTimeline({ snapshot, commands, providers, ledger, summaries, onRegenerateSummary, header, footer, reveal }: Props) {
  const items = useMemo<TimelineItem[]>(() => {
    const slots = timelineSlots(snapshot);
    if (!slots) return snapshot.messages.map(message => ({ key: message.id, render: () => <LegacyMessage snapshot={snapshot} messageId={message.id} providers={providers} /> }));
    const used = usedSummary(snapshot);
    return slots.map(slot => ({
      key: slot.slotId,
      render: () => slot.author === 'summary'
        ? <SummaryCard slot={slot} snapshot={snapshot} commands={commands} summaries={summaries} ledger={ledger} onRegenerate={onRegenerateSummary} />
        : <SlotItem slot={slot} snapshot={snapshot} commands={commands} providers={providers} ledger={ledger}
          coveredBy={used?.coveredSlotIds.includes(slot.slotId) ? used : undefined} revisedAfterSummary={used?.revisedSlotIds?.includes(slot.slotId) ?? false} />,
    }));
  }, [snapshot, commands, providers, ledger, summaries, onRegenerateSummary]);
  const last = snapshot.messages.at(-1);
  return <Timeline viewKey={snapshot.runId} label="讨论时间线" items={items} header={header} footer={footer}
    contentVersion={`${snapshot.sequence}:${snapshot.messages.length}:${last?.content.length ?? 0}`}
    latestFromHost={[...snapshot.messages].reverse().find(message => message.senderName === '主持人')?.id} reveal={reveal} />;
}

/** Builds without version data keep a flat rendering. */
function LegacyMessage({ snapshot, messageId, providers }: { snapshot: RunSnapshot; messageId: string; providers?: ProviderNames }) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const message = snapshot.messages.find(item => item.id === messageId)!;
  const attempt = snapshot.attempts?.find(value => value.messageId === message.id);
  const turn = snapshot.turns.find(value => attempt ? value.turnId === attempt.turnId : value.messageId === message.id);
  const member = memberOf(snapshot, turn?.agentId);
  const name = member?.displayName ?? message.senderName;
  return <article className="msg" aria-label={name}>
    <div className="msg-head"><Avatar name={name} /><span className="msg-name">{name}</span><span className="msg-meta">{modelLabel(member, providers)}</span>
      {stageOfTurn(snapshot, turn?.turnId) && <Tag title="讨论方式里的阶段">{stageOfTurn(snapshot, turn?.turnId)}</Tag>}</div>
    <div className="msg-body">{message.content ? <Markdown text={message.content} /> : <p className="muted small">（没有生成文字）</p>}</div>
    <div className="msg-foot">{messageStatusText[message.status] && <span>{messageStatusText[message.status]}</span>}<span className="grow" />
      <IconButton size="sm" icon={Ellipsis} label="请求详情" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(value => !value)} /></div>
    {details && <RequestDetails id={detailsId} charge={attempt ? chargeOfMessage(snapshot, message.id) : undefined} runId={snapshot.runId}
      lines={[['角色', member?.roleTemplateId || '未记录'], ['服务', providerLabel(member, providers)], ['模型 ID', member?.modelId ?? '未记录']]} />}
  </article>;
}
