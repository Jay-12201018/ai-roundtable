import { ContractError } from '../../../shared/contracts/errors';

// Same whole-operation cancellation semantics as R09; its helper is module-private.
export class RequestScope {
  private readonly controller = new AbortController();
  readonly signal = this.controller.signal;
  private readonly deadline: number;
  private readonly timer: ReturnType<typeof setTimeout>;
  private readonly abort = () => this.controller.abort(new ContractError(
    this.parent?.reason instanceof ContractError && this.parent.reason.code === 'timeout' ? 'timeout' : 'cancelled'));
  constructor(private readonly parent: AbortSignal | undefined, timeoutMs: number) {
    this.deadline = performance.now() + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(new ContractError('timeout')), timeoutMs);
    parent?.addEventListener('abort', this.abort, { once: true });
    if (parent?.aborted) this.abort();
  }
  check() {
    if (!this.signal.aborted && performance.now() >= this.deadline) this.controller.abort(new ContractError('timeout'));
    if (this.signal.aborted) throw this.signal.reason;
  }
  async wait<T>(work: () => Promise<T>): Promise<T> {
    this.check();
    return new Promise<T>((resolve, reject) => {
      const abort = () => { this.signal.removeEventListener('abort', abort); reject(this.signal.reason); };
      this.signal.addEventListener('abort', abort, { once: true });
      Promise.resolve().then(() => { this.check(); return work(); }).then(value => {
        this.signal.removeEventListener('abort', abort);
        try { this.check(); resolve(value); } catch (error) { reject(error); }
      }, error => { this.signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  close() {
    clearTimeout(this.timer); this.parent?.removeEventListener('abort', this.abort);
    this.controller.abort(new ContractError('cancelled'));
  }
}
