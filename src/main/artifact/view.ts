import type { ArtifactRecord, ArtifactVersionRecord, Database } from '../database/Database';
import { publicSlots } from '../context/summary';
import { artifactContentSchemas, artifactIssueSchema, type ArtifactKind, type ArtifactSource, type ArtifactSummary, type ArtifactVersion,
  type ArtifactVersionStatus, type ArtifactContent } from '../../shared/schemas/artifact';

type Snapshot = ReturnType<Database['readRunSnapshot']>;

/** The status the host sees for one version (D122). */
export function versionStatus(version: ArtifactVersionRecord): ArtifactVersionStatus {
  if (version.request?.status === 'generating') return 'generating';
  if (version.validation === 'invalid') return 'invalid';
  if (version.validation === 'empty') return 'empty';
  if (version.validation !== 'valid') return 'failed';
  if (version.origin !== 'edit' && version.adoptedAt === undefined) return 'candidate';
  return version.exports.length ? 'exported' : 'valid';
}

/** True for a version the host has made effective: adopted, or written by the host. */
export const isEffective = (version: ArtifactVersionRecord) => version.validation === 'valid' && (version.origin === 'edit' || version.adoptedAt !== undefined);

export function contentOf(kind: ArtifactKind, version: ArtifactVersionRecord): ArtifactContent | undefined {
  return version.contentJson === null ? undefined : artifactContentSchemas[kind].parse(JSON.parse(version.contentJson)) as ArtifactContent;
}

/**
 * D121: the message versions a version stands for — its sources, and for a confirmed summary among them the versions
 * that summary stands for (recursively, as D109) — and the public slots they belong to.
 */
export function represented(snapshot: Pick<Snapshot, 'messages' | 'versions' | 'turns'>, sources: readonly string[]) {
  const byId = new Map(snapshot.versions.map(version => [version.messageId, version]));
  const systemIds = new Set(snapshot.messages.filter(message => message.senderType === 'system').map(message => message.id));
  const set = new Set<string>();
  const visit = (id: string) => {
    if (set.has(id)) return;
    set.add(id);
    if (systemIds.has(id)) for (const nested of byId.get(id)?.basis ?? []) visit(nested);
  };
  sources.forEach(visit);
  const slots = publicSlots(snapshot);
  const touched = slots.filter(slot => snapshot.versions.some(version => version.slotId === slot.slotId && set.has(version.messageId)));
  return { set, slots, touched };
}

/** D121: an artifact version is affected when a message it is based on was later edited or regenerated. */
export function affectedNumbers(snapshot: Pick<Snapshot, 'messages' | 'versions' | 'turns'>, sources: readonly string[]): number[] {
  const { set, touched } = represented(snapshot, sources);
  return touched.filter(slot => slot.message.status === 'completed' && !set.has(slot.active.messageId)).map(slot => slot.number);
}

export function versionView(kind: ArtifactKind, version: ArtifactVersionRecord, snapshot: Snapshot): ArtifactVersion {
  const { touched } = represented(snapshot, version.sources);
  const numbers = touched.map(slot => slot.number);
  const content = contentOf(kind, version);
  const issues = version.issuesJson === null ? [] : (JSON.parse(version.issuesJson) as unknown[]).map(issue => artifactIssueSchema.parse(issue));
  return {
    versionId: version.id, artifactId: version.artifactId, number: version.number, origin: version.origin, status: versionStatus(version),
    ...(version.parentVersionId ? { parentVersionId: version.parentVersionId } : {}), ...(version.agentId ? { agentId: version.agentId } : {}),
    ...(version.request ? { request: { requestId: version.request.requestId, status: version.request.status, ...(version.request.finishReason ? { finishReason: version.request.finishReason } : {}) } } : {}),
    ...(content ? { title: content.title } : {}), issues, ...(version.emptyReason !== null ? { emptyReason: version.emptyReason } : {}), outputChars: version.rawOutput.length,
    ...(numbers.length ? { firstNumber: Math.min(...numbers), lastNumber: Math.max(...numbers) } : {}),
    affectedNumbers: affectedNumbers(snapshot, version.sources),
    ...(version.adoptedAt ? { adoptedAt: version.adoptedAt } : {}), ...(version.exports.length ? { exportedAt: version.exports.at(-1)!.createdAt } : {}),
    createdAt: version.createdAt, updatedAt: version.updatedAt,
  };
}

export function artifactView(artifact: ArtifactRecord, snapshot: Snapshot): ArtifactSummary {
  return { artifactId: artifact.id, runId: artifact.runId, roomId: artifact.roomId, kind: artifact.kind, createdAt: artifact.createdAt,
    versions: artifact.versions.map(version => versionView(artifact.kind, version, snapshot)) };
}

/** Each source as the timeline shows it now: its number (or a summary's range), speaker and whether it is still in effect. */
export function sourceViews(version: ArtifactVersionRecord, snapshot: Snapshot): ArtifactSource[] {
  const slots = publicSlots(snapshot);
  const byId = new Map(snapshot.versions.map(item => [item.messageId, item]));
  return version.sources.map(messageId => {
    const entry = byId.get(messageId)!;
    const message = snapshot.messages.find(item => item.id === messageId)!;
    const slot = slots.find(item => item.slotId === entry.slotId);
    const summary = snapshot.summaries.find(item => item.id === entry.slotId);
    const covered = summary ? summary.covered.map(slotId => slots.find(item => item.slotId === slotId)?.number).filter((number): number is number => number !== undefined) : [];
    const speaker = slot?.author === 'host' ? '主持人' : summary ? '讨论摘要'
      : snapshot.run.membersSnapshot?.find(member => member.agentId === slot?.agentId)?.displayName ?? message.senderName;
    return { messageId, slotId: entry.slotId, ...(slot ? { number: slot.number } : {}), speaker,
      ...(covered.length ? { summary: { firstNumber: 1, lastNumber: Math.max(...covered) } } : {}), active: entry.active };
  });
}

/** The basis a host edit records: the current effective version of every message the edited version stood for (as D107). */
export function rebasedSources(snapshot: Pick<Snapshot, 'messages' | 'versions' | 'turns'>, sources: readonly string[]): string[] {
  return represented(snapshot, sources).touched.filter(slot => slot.message.status === 'completed').map(slot => slot.active.messageId);
}
