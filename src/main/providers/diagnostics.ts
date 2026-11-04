import { z } from 'zod';

const stage = z.enum(['validation', 'credential', 'network_client', 'dns', 'tcp', 'tls', 'request', 'response', 'stream', 'usage', 'accounting', 'complete']);
const evidence = z.enum(['not_started', 'client_invoked', 'http_response']);
const category = z.enum(['credential_unavailable', 'credential_read_failed', 'dns_failed', 'target_rejected', 'tcp_failed', 'tcp_timeout', 'tls_failed', 'http_error', 'request_timeout', 'request_interrupted', 'response_invalid', 'usage_missing', 'accounting_failed', 'cancelled', 'policy_rejected', 'network_unknown']);
const status = z.number().int().min(100).max(599);
const eventSchema = z.object({ stage: stage.optional(), evidence: evidence.optional(), category: category.nullable().optional(), httpStatus: status.optional() }).strict();
export type DiagnosticEvent = z.infer<typeof eventSchema>;
export type DiagnosticObserver = (event: DiagnosticEvent) => void;
