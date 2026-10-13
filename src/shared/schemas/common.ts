import { z } from 'zod';

// The sandboxed bridge must validate without dynamically generated code under CSP.
z.config({ jitless: true });

export const PROTOCOL_VERSION = 1 as const;
export const idSchema = z.string().min(1).max(256).regex(/^\S+$/u);
export const sequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const timestampSchema = z.iso.datetime();
export const workflowSnapshotSchema = z.record(z.string(), z.json());
