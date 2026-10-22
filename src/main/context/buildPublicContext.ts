import { contextInputSchema } from './types';
import type { ContextInput, ContextReport, ContextRejection, ContextResult, ContextSource, ModelTokenCounter } from './types';
import type { ProviderMessage } from '../providers/types';
import { selectHistory, type HistoryCandidate } from './selectHistory';
import { agentBriefText, assembleDiscussion, boundaryText, contextFormatVersion, discussionRulesText } from './transcript';

/** Main-only: accepts explicit safe projections, never a Renderer draft, database handle or SDK object. */
export function buildPublicContext(input: ContextInput, counter?: ModelTokenCounter): ContextResult {
  const parsed = contextInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: 'invalid_input' };
  input = parsed.data;
  const { run, current } = input;
  if (run.task === null || !run.task.trim() || run.membersSnapshot === null
    || run.nextTurnIndex === null || run.elapsedExecutionMs === null) {
    return { ok: false, reason: 'unknown_execution_metadata' };
  }
  const member = run.membersSnapshot.find(m => m.agentId === current.agentId);
  const existing = input.snapshot.turns.find(t => t.id === current.turnId);
  const position = current.mode === 'regenerate'
    ? !!existing && existing.agentId === current.agentId && existing.turnIndex === current.turnIndex && current.turnIndex < run.nextTurnIndex
    : !existing && current.turnIndex === run.nextTurnIndex;
  if (!member || !position
    || input.snapshot.turns.some(t => t.requestId === current.requestId)
    || input.snapshot.attempts.some(a => a.requestId === current.requestId)
    || input.hostInstructions.some(i => i.roomId !== run.roomId || i.runId !== run.id)
    || new Set(input.applicationInstructions.map(i => i.id)).size !== input.applicationInstructions.length
    || new Set(input.hostInstructions.map(i => i.id)).size !== input.hostInstructions.length) {
    return { ok: false, reason: 'invalid_identity' };
  }
  const history = selectHistory(input);
  if (!history) return { ok: false, reason: 'invalid_identity' };

  const sources: ContextSource[] = [];
  const prefix: ProviderMessage[] = [];
  const append = (message: ProviderMessage, kind: ContextSource['kind'], sourceId: string) => {
    sources.push({ kind, sourceId, runId: run.id, roomId: run.roomId, providerMessageIndex: prefix.length });
    prefix.push(message);
  };
  append({ role: 'system', content: boundaryText }, 'boundary', contextFormatVersion);
  append({ role: 'system', content: discussionRulesText }, 'application', 'discussion-rules-v1');
  for (const instruction of input.applicationInstructions) append({ role: 'system', content: instruction.content }, 'application', instruction.id);
  for (const instruction of input.hostInstructions) append({ role: 'system', content: instruction.content }, 'host', instruction.id);
  append({ role: 'system', content: agentBriefText(member, run.membersSnapshot) }, 'agent', member.agentId);
  // The task, quoted history and the turn cue are assembled into the exact final messages before every count.
  const assemble = (selected: readonly HistoryCandidate[]) => {
    const discussion = assembleDiscussion(run.task!, selected.map(candidate => candidate.entry), member, prefix.length);
    return { ...discussion, messages: [...prefix.map(message => ({ ...message })), ...discussion.messages] };
  };
  const required = assemble([]);
  const messages = required.messages;

  const byteEstimate = (values: readonly ProviderMessage[]) => Buffer.byteLength(JSON.stringify(values), 'utf8');
  const report: ContextReport = {
    runId: run.id, roomId: run.roomId, turnId: current.turnId, requestId: current.requestId,
    limits: { outputTokenLimit: run.outputTokenLimit, maxTurns: run.maxTurns, turnIndex: current.turnIndex, elapsedExecutionMs: run.elapsedExecutionMs, maxDurationMs: run.maxDurationMs },
    budget: {
      contextWindowTokens: input.contextWindowTokens, reservedOutputTokens: run.outputTokenLimit,
      inputBudgetTokens: Math.max(0, input.contextWindowTokens - run.outputTokenLimit),
      inputTokens: null, remainingInputTokens: null,
      estimatedInputBytes: byteEstimate(assemble(history.candidates).messages),
      measurement: { unit: 'utf8_bytes', kind: 'estimate', method: 'UTF-8 bytes of JSON role/content array; excludes provider framing; not tokens', modelId: member.modelId ?? 'unknown' },
    },
    sources: [], history: history.decisions,
  };
  const reject = (reason: ContextRejection): ContextResult => {
    for (const candidate of history.candidates) candidate.decision.reason = 'context_rejected';
    return { ok: false, reason, report };
  };
  if (run.outputTokenLimit > input.contextWindowTokens) return reject('output_exceeds_window');
  if (!counter || counter.modelId !== member.modelId || typeof counter.method !== 'string' || !counter.method.trim()
    || typeof counter.countMessages !== 'function' || !['exact', 'upper_bound'].includes(counter.kind)) return reject('token_count_unavailable');

  const count = (values: readonly ProviderMessage[]) => countModelTokens(values,member.modelId,counter);
  let inputTokens = count(messages);
  if (inputTokens === undefined) return reject('invalid_token_count');
  report.budget.measurement = { unit: 'tokens', kind: counter.kind, method: counter.method, modelId: counter.modelId };
  report.budget.inputTokens = inputTokens;
  report.budget.remainingInputTokens = report.budget.inputBudgetTokens - inputTokens;
  if (inputTokens > report.budget.inputBudgetTokens) return reject('required_context_exceeds_window');

  // Keep a whole, most-recent suffix; never edit originals or skip across an over-budget message.
  // Every count is of the final assembled messages, so the bound holds for exactly what is sent.
  const selected: HistoryCandidate[] = [];
  let final = required;
  for (let index = history.candidates.length - 1; index >= 0; index--) {
    const candidate = history.candidates[index];
    const next = assemble([candidate, ...selected]);
    const tokens = count(next.messages);
    // Adding a labelled entry always adds text, so a sound counter must strictly increase.
    if (tokens === undefined || tokens <= inputTokens) return reject('invalid_token_count');
    if (tokens > report.budget.inputBudgetTokens) {
      for (let omitted = 0; omitted <= index; omitted++) history.candidates[omitted].decision.reason = 'input_budget';
      break;
    }
    inputTokens = tokens;
    final = next;
    selected.unshift(candidate);
    candidate.decision.reason = 'selected';
  }
  const selectedHistory = selected.map((candidate, index) => ({ ...candidate.source, providerMessageIndex: final.indexes[index] }));
  sources.push({ kind: 'task', sourceId: run.id, runId: run.id, roomId: run.roomId, providerMessageIndex: final.taskIndex });
  report.sources = [...sources, ...selectedHistory,
    { kind: 'application', sourceId: 'turn-cue-v1', runId: run.id, roomId: run.roomId, providerMessageIndex: final.cueIndex }];
  report.budget.inputTokens = inputTokens;
  report.budget.remainingInputTokens = report.budget.inputBudgetTokens - inputTokens;
  report.budget.estimatedInputBytes = byteEstimate(final.messages);
  return { ok: true, messages: final.messages, outputTokenLimit: run.outputTokenLimit, selectedHistory, report };
}

export function countModelTokens(values:readonly ProviderMessage[],modelId:string|null,counter?:ModelTokenCounter):number|undefined{
  if(!counter||counter.modelId!==modelId||!['exact','upper_bound'].includes(counter.kind)||typeof counter.method!=='string'||!counter.method.trim()||typeof counter.countMessages!=='function')return;
  try{
    const tokens=counter.countMessages(Object.freeze(values.map(value=>Object.freeze({...value}))));
    return typeof tokens==='number'&&Number.isSafeInteger(tokens)&&tokens>0?tokens:undefined;
  }catch{return;}
}
