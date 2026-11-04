import { z } from 'zod';
import type { WorkflowDraft } from './model';

/**
 * D116 (R16 D2-B): a room's discussion mode is remembered in this browser profile. Main still checks it against the
 * current members at every start (previewWorkflow); a lost or damaged entry falls back to the default and says so.
 */
const draftSchema = z.object({
  template: z.enum(['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate']),
  phases: z.array(z.object({ key: z.string().min(1).max(64), title: z.string().max(32), participants: z.array(z.string().max(128)).max(32), repeat: z.string().max(4) }).strict()).min(1).max(16),
  turnLimit: z.string().max(4), durationMinutes: z.string().max(5), outputTokens: z.string().max(6), finishAt: z.string().max(64),
}).strict();
const storedSchema = z.object({ version: z.literal(1), draft: draftSchema }).strict();
const key = (roomId: string) => `roundtable.workflow.${roomId}`;

export type StoredWorkflow = { draft?: WorkflowDraft; damaged: boolean };
export function readRoomWorkflow(roomId: string): StoredWorkflow {
  let text: string | null;
  try { text = localStorage.getItem(key(roomId)); } catch { return { damaged: false }; }
  if (text === null) return { damaged: false };
  try { const parsed = storedSchema.safeParse(JSON.parse(text)); return parsed.success ? { draft: parsed.data.draft, damaged: false } : { damaged: true }; }
  catch { return { damaged: true }; }
}
/** Saves (or, with null, forgets) a room's mode; false when this profile cannot store it. */
export function writeRoomWorkflow(roomId: string, draft: WorkflowDraft | null): boolean {
  try {
    if (draft) localStorage.setItem(key(roomId), JSON.stringify({ version: 1, draft }));
    else localStorage.removeItem(key(roomId));
    return true;
  } catch { return false; }
}

const countKey = (roomId: string) => `roundtable.participants.${roomId}`;
/** How many take part in a room's adjustable modes, for coming back from a mode of two. */
export function readRoomCount(roomId: string): number | undefined {
  try { const value = Number(localStorage.getItem(countKey(roomId))); return Number.isInteger(value) && value >= 2 && value <= 8 ? value : undefined; } catch { return undefined; }
}
export function writeRoomCount(roomId: string, count: number): void {
  try { localStorage.setItem(countKey(roomId), String(count)); } catch { /* Only a convenience: the default applies instead. */ }
}
