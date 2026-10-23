import type { InstructionRevisionRecord, MessageRecord, VersionRecord } from '../database/Database';

/** The position of each slot is its first (original) version in R03 sort order; later versions keep it. */
export function slotPositions(messages: readonly Pick<MessageRecord, 'id'>[], versions: readonly VersionRecord[]): Map<string, number> {
  const slotOf = new Map(versions.map(version => [version.messageId, version.slotId]));
  const positions = new Map<string, number>();
  messages.forEach((message, index) => {
    const slot = slotOf.get(message.id) ?? message.id;
    if (!positions.has(slot)) positions.set(slot, index);
  });
  return positions;
}

/**
 * The public history a new request is based on: the active, completed version of every slot before
 * `beforeSlotId` (or of every slot when it is omitted). This is recorded with each generated version.
 */
export function basisBefore(messages: readonly MessageRecord[], versions: readonly VersionRecord[], beforeSlotId?: string): string[] {
  const positions = slotPositions(messages, versions);
  const limit = beforeSlotId === undefined ? Number.POSITIVE_INFINITY : positions.get(beforeSlotId) ?? Number.POSITIVE_INFINITY;
  const status = new Map(messages.map(message => [message.id, message.status ?? 'completed']));
  return versions.filter(version => version.active && status.get(version.messageId) === 'completed' && positions.get(version.slotId)! < limit)
    .sort((a, b) => positions.get(a.slotId)! - positions.get(b.slotId)!)
    .map(version => version.messageId);
}

/**
 * Pre-R12 rows have no recorded basis. Before R12 only the latest Attempt of earlier Turns was public and
 * nothing could be edited, so their basis is the latest completed version created before them.
 */
function legacyBasis(messages: readonly MessageRecord[], versions: readonly VersionRecord[], version: VersionRecord, positions: Map<string, number>): string[] {
  const index = new Map(messages.map((message, position) => [message.id, position]));
  const status = new Map(messages.map(message => [message.id, message.status ?? 'completed']));
  const own = index.get(version.messageId)!;
  const latest = new Map<string, VersionRecord>();
  for (const candidate of versions) {
    if (candidate.slotId === version.slotId || positions.get(candidate.slotId)! >= positions.get(version.slotId)!
      || index.get(candidate.messageId)! > own || status.get(candidate.messageId) !== 'completed') continue;
    const previous = latest.get(candidate.slotId);
    if (!previous || candidate.versionNumber > previous.versionNumber) latest.set(candidate.slotId, candidate);
  }
  return [...latest.values()].map(item => item.messageId);
}

/**
 * A generated version is affected when its basis contains a version that is no longer active or is itself
 * affected. Host-authored versions (edits and host messages) have no generated basis and are never affected.
 * R13B: every version of a summary (a `system` message) records the covered versions it stands for, including a
 * host edit, so a summary is affected when any covered original is later edited or regenerated (D087/D107).
 */
export function affectedVersions(messages: readonly MessageRecord[], versions: readonly VersionRecord[]): Map<string, string[]> {
  const positions = slotPositions(messages, versions);
  const byId = new Map(versions.map(version => [version.messageId, version]));
  const summaries = new Set(messages.filter(message => message.senderType === 'system').map(message => message.id));
  const result = new Map<string, string[]>();
  const ordered = [...versions].sort((a, b) => positions.get(a.slotId)! - positions.get(b.slotId)! || a.versionNumber - b.versionNumber);
  for (const version of ordered) {
    if (summaries.has(version.messageId)) {
      // Coverage is a prefix, so every upstream of a covered original is covered too: a change shows up as an inactive
      // covered version. Only an earlier summary it builds on passes its own affected state on.
      result.set(version.messageId, (version.basis ?? []).filter(id => {
        const entry = byId.get(id);
        return entry !== undefined && (!entry.active || summaries.has(id) && (result.get(id)?.length ?? 0) > 0);
      }));
      continue;
    }
    if (version.origin === 'edit' || version.turnId === undefined) { result.set(version.messageId, []); continue; }
    const basis = version.basis ?? legacyBasis(messages, versions, version, positions);
    result.set(version.messageId, basis.filter(id => {
      const entry = byId.get(id);
      return entry !== undefined && (!entry.active || (result.get(id)?.length ?? 0) > 0);
    }));
  }
  return result;
}

/** Effective standing instructions: the latest revision of each instruction that has not been cleared. */
export function effectiveInstructions(revisions: readonly InstructionRevisionRecord[]): InstructionRevisionRecord[] {
  const latest = new Map<string, InstructionRevisionRecord>();
  for (const revision of revisions) {
    const previous = latest.get(revision.instructionId);
    if (!previous || revision.revision > previous.revision) latest.set(revision.instructionId, revision);
  }
  return [...latest.values()].filter(revision => revision.content !== null);
}
