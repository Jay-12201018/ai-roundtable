import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostApiContract } from '../../../shared/contracts/app';
import type { HostCommand } from '../../../shared/schemas/host';
import { hostErrorMessage } from './model';

export type CommandInput = HostCommand extends infer C ? C extends HostCommand ? Omit<C, 'clientRequestId' | 'runId'> : never : never;
export type CommandOutcome = { ok: true; duplicate: boolean } | { ok: false; message: string };

let fallbackCounter = 0;
const newRequestId = () => globalThis.crypto?.randomUUID?.() ?? `host-${Date.now()}-${++fallbackCounter}`;

/**
 * One host command in flight at a time. A ref (not only React state) guards re-entry so two clicks in the same
 * frame send once; each user action gets its own clientRequestId, which Main uses for idempotency.
 */
export function useHostCommands(api: HostApiContract | undefined, runId: string | undefined, onApplied: () => void) {
  const inFlight = useRef<string | undefined>(undefined);
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setError(undefined); setNotice(undefined); }, [runId]);
  // A confirmation is read once; it should not linger above the box after the moment has passed. Errors stay.
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => { if (alive.current) setNotice(undefined); }, 8000); return () => clearTimeout(timer); }, [notice]);
  /** Sends one command and reports the outcome; `quiet` leaves the shared notice/error to the caller (D4). */
  const request = useCallback(async (key: string, command: CommandInput, options: { success?: string; quiet?: boolean } = {}): Promise<CommandOutcome> => {
    if (!api || !runId) return { ok: false, message: '这次讨论还没有开始，暂时不能发送。' };
    if (inFlight.current) return { ok: false, message: '上一个操作还在等待主进程确认，请稍后再试。' };
    inFlight.current = key; setPending(key);
    if (!options.quiet) { setError(undefined); setNotice(undefined); }
    try {
      const result = await api.command({ ...command, runId, clientRequestId: newRequestId() } as HostCommand);
      if (alive.current && !options.quiet) setNotice(result.duplicate ? '该操作已在队列中，未重复提交。' : options.success);
      onApplied();
      return { ok: true, duplicate: result.duplicate };
    } catch (failure) {
      const message = hostErrorMessage(failure);
      if (alive.current && !options.quiet) setError(message);
      return { ok: false, message };
    } finally {
      inFlight.current = undefined;
      if (alive.current) setPending(undefined);
    }
  }, [api, runId, onApplied]);
  const send = useCallback(async (key: string, command: CommandInput, success?: string): Promise<boolean> =>
    !inFlight.current && (await request(key, command, { success })).ok, [request]);
  /** Lets a caller show its own combined result in the shared feedback line. */
  const report = useCallback((result: { notice?: string; error?: string }) => { setNotice(result.notice); setError(result.error); }, []);
  return { send, request, report, pending, error, notice, available: Boolean(api && runId) };
}
export type HostCommands = ReturnType<typeof useHostCommands>;
