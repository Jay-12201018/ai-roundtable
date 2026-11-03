import { useCallback, useEffect, useRef, useState } from 'react';
import type { SummaryApiContract } from '../../../shared/contracts/app';
import { commandErrorMessage } from '../usage';

type SummaryApi = { summary: SummaryApiContract };
let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `summary-${Date.now()}-${++fallbackCounter}`;

/** Summary generation and confirmation for the selected Run; each click gets its own clientRequestId (D107). */
export function useSummaryCommands(api: SummaryApi | undefined, runId: string | undefined, onApplied: () => void) {
  const inFlight = useRef(false);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<{ key: string; message: string }>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => setError(undefined), [runId]);
  const act = useCallback(async (key: string, work: (clientRequestId: string) => Promise<unknown>) => {
    if (!api || !runId || inFlight.current) return false;
    inFlight.current = true; setPending(key); setError(undefined);
    try { await work(newRequestId()); onApplied(); return true; }
    catch (failure) { if (alive.current) setError({ key, message: commandErrorMessage(failure) }); return false; }
    finally { inFlight.current = false; if (alive.current) setPending(undefined); }
  }, [api, runId, onApplied]);
  // Stable callbacks: the summary dialog re-reads its preview only when its inputs or the Run change.
  const preview = useCallback((input: { agentId?: string; throughSlotId?: string; summaryId?: string }) => api!.summary.preview({ runId: runId!, ...input }), [api, runId]);
  const generate = useCallback((input: { agentId: string; throughSlotId: string; summaryId?: string }) =>
    act('generate', clientRequestId => api!.summary.generate({ runId: runId!, clientRequestId, ...input })), [act, api, runId]);
  const confirm = useCallback((messageId: string) => act(`confirm:${messageId}`, clientRequestId => api!.summary.confirm({ runId: runId!, clientRequestId, messageId })), [act, api, runId]);
  return { preview, generate, confirm, pending, error, available: Boolean(api && runId) };
}
export type SummaryCommands = ReturnType<typeof useSummaryCommands>;
