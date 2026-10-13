import { z } from 'zod';
import { idSchema, PROTOCOL_VERSION, sequenceSchema } from '../schemas/common';
import type { RunEvent } from '../types/run';

const eventIdentitySchema = z.object({ runId: idSchema, sequence: sequenceSchema.refine((value) => value > 0) });
export function resyncEvent(value: unknown, reason: 'invalid_event' | 'incompatible_version' | 'sequence_gap'): RunEvent | undefined {
  const identity = eventIdentitySchema.safeParse(value);
  if (!identity.success) return undefined;
  return { version: PROTOCOL_VERSION, ...identity.data, type: 'snapshot_required', payload: { reason }, timestamp: new Date().toISOString() };
}
