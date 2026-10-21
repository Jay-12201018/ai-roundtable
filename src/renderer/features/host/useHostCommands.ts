import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostApiContract } from '../../../shared/contracts/app';
import type { HostCommand } from '../../../shared/schemas/host';
import { hostErrorMessage } from './model';

type CommandInput = HostCommand extends infer C ? C extends HostCommand ? Omit<C, 'clientRequestId' | 'runId'> : never : never;

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
  const send = useCallback(async (key: string, command: CommandInput, success?: string): Promise<boolean> => {
    if (!api || !runId || inFlight.current) return false;
    inFlight.current = key; setPending(key); setError(undefined); setNotice(undefined);
    try {
      const result = await api.command({ ...command, runId, clientRequestId: newRequestId() } as HostCommand);
      if (alive.current) setNotice(result.duplicate ? '该操作已在队列中，未重复提交。' : success);
      onApplied();
      return true;
    } catch (failure) {
      if (alive.current) setError(hostErrorMessage(failure));
      return false;
    } finally {
      inFlight.current = undefined;
      if (alive.current) setPending(undefined);
    }
  }, [api, runId, onApplied]);
  return { send, pending, error, notice, available: Boolean(api && runId) };
}
export type HostCommands = ReturnType<typeof useHostCommands>;
