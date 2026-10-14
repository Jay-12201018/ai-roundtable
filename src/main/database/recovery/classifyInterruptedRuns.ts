import type { RunRecord } from '../Database';
import { idSchema } from '../../../shared/schemas/common';
import { runSnapshotSchema } from '../../../shared/schemas/run';

export function classifyInterruptedRuns(runs: readonly Pick<RunRecord, 'id' | 'status'>[]): string[] {
  const seen = new Set<string>();
  const interruptedIds: string[] = [];
  for (const run of runs) {
    const id = idSchema.parse(run.id);
    const status = runSnapshotSchema.shape.status.parse(run.status);
    if (seen.has(id)) throw new Error('Duplicate Run ID');
    seen.add(id);
    if (status === 'running' || status === 'pausing' || status === 'paused' || status === 'cancelling') {
      interruptedIds.push(id);
    }
  }
  return interruptedIds;
}
