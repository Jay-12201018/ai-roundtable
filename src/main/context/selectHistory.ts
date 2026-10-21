import type { ProviderMessage } from '../providers/types';
import type { ContextInput, ContextSource, HistoryDecision, HistoryReason } from './types';

export interface HistoryCandidate {
  message: ProviderMessage;
  source: ContextSource;
  decision: HistoryDecision;
}

/** The array order is the R03 readRunSnapshot sort_key order, never a timestamp or ID sort. */
export function selectHistory(input: ContextInput): { candidates: HistoryCandidate[]; decisions: HistoryDecision[] } | undefined {
  const { run, current, snapshot } = input;
  const members = new Map(run.membersSnapshot!.map(member => [member.agentId, member]));
  const turns = new Map(snapshot.turns.map(turn => [turn.id, turn]));
  const attempts = new Map(snapshot.attempts.map(attempt => [attempt.messageId, attempt]));
  if (members.size !== run.membersSnapshot!.length || turns.size !== snapshot.turns.length
    || attempts.size !== snapshot.attempts.length
    || new Set(snapshot.attempts.map(a => a.requestId)).size !== snapshot.attempts.length
    || new Set(snapshot.turns.map(t => t.turnIndex)).size !== snapshot.turns.length
    || snapshot.turns.some(t => t.runId !== run.id || !members.has(t.agentId))) return;

  const latest = new Map<string, number>();
  const byTurn = new Map<string, typeof snapshot.attempts>();
  for (const attempt of snapshot.attempts) {
    const turn = turns.get(attempt.turnId);
    if (!turn || attempt.runId !== run.id) return;
    const group = byTurn.get(turn.id) ?? [];
    group.push(attempt);
    byTurn.set(turn.id, group);
    latest.set(turn.id, Math.max(latest.get(turn.id) ?? 0, attempt.attemptIndex));
  }
  for (const [turnId, group] of byTurn) {
    group.sort((a, b) => a.attemptIndex - b.attemptIndex);
    if (group.some((a, index) => a.attemptIndex !== index) || group[0].requestId !== turns.get(turnId)!.requestId) return;
  }

  const versions = snapshot.versions ? new Map(snapshot.versions.map(version => [version.messageId, version])) : undefined;
  if (versions && (versions.size !== snapshot.versions!.length || snapshot.messages.some(m => !versions.has(m.id)))) return;
  // A later version keeps its slot's original position, never its own newer sort position.
  const slotOrder = new Map<string, number>();
  snapshot.messages.forEach((message, index) => { const slot = versions?.get(message.id)?.slotId ?? message.id; if (!slotOrder.has(slot)) slotOrder.set(slot, index); });
  const position = (message: { id: string }, index: number) => {
    const version = versions?.get(message.id);
    return version && version.versionNumber > 1 ? slotOrder.get(version.slotId)! : index;
  };
  const ordered = [...snapshot.messages.entries()].sort(([a, left], [b, right]) => position(left, a) - position(right, b) || a - b);
  const visible = new Set(input.visibleMessageIds);
  const seen = new Map<string, string>();
  const candidates: HistoryCandidate[] = [];
  const decisions: HistoryDecision[] = [];
  for (const [snapshotIndex, message] of ordered) {
    const decision: HistoryDecision = {
      messageId: message.id, snapshotIndex, reason: 'context_rejected',
      range: { start: 0, end: message.content.length, unit: 'utf16_code_units' },
    };
    decisions.push(decision);
    const serialized = JSON.stringify(message);
    const version = versions?.get(message.id);
    if (seen.has(message.id)) {
      if (seen.get(message.id) !== serialized) return;
      decision.reason = 'duplicate';
      continue;
    }
    seen.set(message.id, serialized);
    let excluded: HistoryReason | undefined;
    if (message.roomId !== run.roomId) excluded = 'other_room';
    else if (message.runId !== run.id) excluded = 'other_run';
    else if (!visible.has(message.id)) excluded = 'not_visible';
    else if (!['agent', 'user'].includes(message.senderType)) excluded = 'non_public_sender';
    else if (version && !version.active) excluded = 'inactive_version';
    else if (message.status !== 'completed') excluded = 'message_not_completed';
    if (excluded) { decision.reason = excluded; continue; }
    if (message.senderType === 'user' && attempts.has(message.id)) return;

    const source: ContextSource = { kind: 'history', runId: run.id, roomId: run.roomId, sourceId: message.id, messageId: message.id, snapshotIndex };
    if (message.senderType === 'agent' || message.turnId !== undefined) {
      const turn = message.turnId === undefined ? undefined : turns.get(message.turnId);
      if (!turn) { decision.reason = 'missing_turn'; continue; }
      if (turn.id === current.turnId || turn.turnIndex >= current.turnIndex) { decision.reason = 'current_or_future_turn'; continue; }
      if (turn.status !== 'completed') { decision.reason = 'turn_not_completed'; continue; }
      const attempt = attempts.get(message.id);
      if (message.senderName !== members.get(turn.agentId)!.displayName) return;
      if (version?.origin === 'edit') {
        // A host edit is a completed version without its own request; it never claims Agent generation.
        if (attempt || message.senderType !== 'agent' || version.slotId !== turn.id) return;
        Object.assign(source, { turnId: turn.id, agentId: turn.agentId });
      } else {
        if (!attempt) { decision.reason = 'missing_attempt'; continue; }
        if (attempt.turnId !== turn.id) return;
        if (attempt.status !== 'completed') { decision.reason = 'attempt_not_completed'; continue; }
        if (!version && attempt.attemptIndex !== latest.get(turn.id)) { decision.reason = 'superseded_attempt'; continue; }
        // A user row linked to an Agent request cannot prove public user provenance.
        if (message.senderType !== 'agent') return;
        Object.assign(source, { turnId: turn.id, requestId: attempt.requestId, agentId: turn.agentId });
      }
    }
    candidates.push({
      message: {
        role: message.senderType === 'agent' ? 'assistant' : 'user',
        content: JSON.stringify({ speaker: message.senderName, ...(source.agentId ? { agentId: source.agentId } : {}), publicText: message.content,
          ...(version?.origin === 'edit' ? { editedByHost: true } : {}), ...(version?.affected ? { basedOnRevisedHistory: true } : {}) }),
      },
      source, decision,
    });
  }
  return { candidates, decisions };
}
