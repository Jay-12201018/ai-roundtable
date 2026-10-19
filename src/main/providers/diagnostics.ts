import { z } from 'zod';
import { timestampSchema } from '../../shared/schemas/common';
import type { ErrorCode } from '../../shared/schemas/error';

const stage = z.enum(['validation', 'credential', 'network_client', 'dns', 'tcp', 'proxy', 'tls', 'request', 'response', 'stream', 'usage', 'accounting', 'complete']);
const evidence = z.enum(['not_started', 'client_invoked', 'http_response']);
const category = z.enum(['credential_unavailable', 'credential_read_failed', 'dns_failed', 'target_rejected', 'tcp_failed', 'tcp_timeout', 'proxy_failed', 'proxy_rejected', 'tls_failed', 'http_error', 'request_timeout', 'request_interrupted', 'response_invalid', 'usage_missing', 'accounting_failed', 'cancelled', 'policy_rejected', 'network_unknown']);
const status = z.number().int().min(100).max(599);
const eventSchema = z.object({ stage: stage.optional(), evidence: evidence.optional(), category: category.nullable().optional(), httpStatus: status.optional() }).strict();
export type DiagnosticEvent = z.infer<typeof eventSchema>;
export type DiagnosticObserver = (event: DiagnosticEvent) => void;
export const trialDiagnosticsSchema = z.object({
  version: z.literal(1), stage, evidence, category: category.nullable(),
  startedAt: timestampSchema, updatedAt: timestampSchema,
  clientInvokedAt: timestampSchema.optional(), httpResponseAt: timestampSchema.optional(), httpStatus: status.optional(),
}).strict().superRefine((value, ctx) => {
  if ((value.evidence === 'http_response' ? value.httpStatus === undefined || value.httpResponseAt === undefined : value.httpStatus !== undefined || value.httpResponseAt !== undefined)
    || (value.evidence !== 'not_started') !== (value.clientInvokedAt !== undefined)) ctx.addIssue({ code: 'custom', message: 'Inconsistent network evidence' });
});
export type TrialDiagnostic = z.infer<typeof trialDiagnosticsSchema>;

/** Main-only whitelist: retain observations, never raw errors, headers, targets or response bodies. */
export class TrialDiagnostics {
  private value: TrialDiagnostic;
  constructor(private readonly persist: (value: TrialDiagnostic) => void) {
    const now = new Date().toISOString();
    this.value = { version: 1, stage: 'validation', evidence: 'not_started', category: null, startedAt: now, updatedAt: now };
  }
  snapshot(): TrialDiagnostic { return structuredClone(this.value); }
  readonly observe: DiagnosticObserver = event => {
    const parsed = eventSchema.parse(event); const now = new Date().toISOString();
    if (parsed.evidence === 'http_response' && parsed.httpStatus === undefined) throw new Error('HTTP evidence requires a status');
    const next = { ...this.value, updatedAt: now };
    if (!next.category) { if (parsed.stage) next.stage = parsed.stage; if (parsed.category) next.category = parsed.category; }
    if (parsed.evidence && parsed.evidence !== 'not_started') {
      next.clientInvokedAt ??= now;
      if (next.evidence !== 'http_response') next.evidence = parsed.evidence;
    }
    if (parsed.evidence === 'http_response') { next.httpResponseAt ??= now; next.httpStatus = parsed.httpStatus; }
    this.value = trialDiagnosticsSchema.parse(next);
    this.persist(this.snapshot());
  };
  fail(code: ErrorCode): void {
    const current = this.value;
    const reason = code === 'cancelled' ? 'cancelled' : code === 'timeout'
      ? current.stage === 'tcp' ? 'tcp_timeout' : current.stage === 'tls' ? 'tls_failed' : current.stage === 'dns' ? 'dns_failed' : 'request_timeout'
      : current.evidence === 'not_started' ? current.stage === 'credential' ? 'credential_read_failed' : 'policy_rejected'
      : current.stage === 'stream' ? 'response_invalid' : 'network_unknown';
    this.observe({ category: reason });
  }
}
