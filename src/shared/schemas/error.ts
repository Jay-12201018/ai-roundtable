import { z } from 'zod';
import './common';

export const errorMessages = {
  invalid_input: 'Invalid request parameters',
  invalid_response: 'Invalid response; refresh the run snapshot',
  forbidden: 'Permission denied',
  unsupported: 'This operation is not supported yet',
  not_found: 'Requested resource was not found',
  invalid_state: 'Operation is not allowed in the current state',
  internal_error: 'Operation failed',
  transport_error: 'IPC connection failed',
  authentication_failed: 'Provider authentication failed',
  rate_limited: 'Provider rate limit reached',
  timeout: 'Provider request timed out',
  cancelled: 'Request cancelled',
  network_error: 'Provider connection failed',
  // D138: the address resolved to a private or reserved network, which is never connected to directly.
  target_rejected: 'The address resolves to a private or reserved network',
  // D137: the system's proxy is of a type this app cannot use; never turned into a direct connection silently.
  proxy_unsupported: 'The configured proxy type is not supported',
  // D133: nothing raises this any more; events of old Runs keep it and recovery still has to read them.
  budget_exceeded: 'Run budget is insufficient for the next request',
} as const;
export const errorCodeSchema = z.enum(Object.keys(errorMessages) as [keyof typeof errorMessages, ...(keyof typeof errorMessages)[]]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
const retryableCodes: readonly ErrorCode[] = ['transport_error', 'rate_limited', 'timeout', 'network_error'];
const errorFieldSchema = z.enum(['arguments', 'roomId', 'runId', 'turnId', 'messageId', 'cursor', 'task', 'workflowSnapshot', 'mode', 'maxTurns', 'maxDurationMs', 'outputTokenLimit', 'decision',
  'clientRequestId', 'kind', 'agentId', 'instructionId', 'content',
  'requestId', 'throughSlotId', 'summaryId',
  // R14 artifacts.
  'artifactId', 'versionId', 'text', 'sources', 'format', 'target',
  // R15 code export.
  'rootId', 'previewId', 'files']);
export type ErrorField = z.infer<typeof errorFieldSchema>;

export const apiErrorSchema = z.object({
  code: errorCodeSchema, message: z.string(), retryable: z.boolean(), field: errorFieldSchema.optional(),
}).strict().refine((error) => error.message === errorMessages[error.code] && error.retryable === retryableCodes.includes(error.code)
  && (error.field === undefined || error.code === 'invalid_input'), 'Invalid public error');
export type ApiError = z.infer<typeof apiErrorSchema>;

export function publicError(code: ErrorCode, field?: ErrorField): ApiError {
  return { code, message: errorMessages[code], retryable: retryableCodes.includes(code), ...(field === undefined ? {} : { field }) };
}

export function inputError(error: z.ZodError): ApiError {
  const field = errorFieldSchema.safeParse(error.issues[0]?.path[0]);
  return publicError('invalid_input', field.success ? field.data : 'arguments');
}
