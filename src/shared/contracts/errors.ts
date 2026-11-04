import { apiErrorSchema, publicError, type ApiError, type ErrorCode, type ErrorField, type UpstreamError } from '../schemas/error';

export class ContractError extends Error {
  readonly detail: ApiError;
  constructor(code: ErrorCode, field?: ErrorField, upstream?: UpstreamError) {
    const detail = publicError(code, field, upstream);
    super(detail.message);
    this.name = 'ContractError';
    this.detail = detail;
    this.stack = `${this.name}: ${this.message}`;
  }
  get code(): ErrorCode { return this.detail.code; }
}

export function toPublicError(error: unknown, fallback: ErrorCode = 'internal_error'): ApiError {
  const detail = apiErrorSchema.safeParse(error instanceof ContractError ? error.detail : undefined);
  return detail.success ? detail.data : publicError(fallback);
}
