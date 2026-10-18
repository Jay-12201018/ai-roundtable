import { randomUUID } from 'node:crypto';
import type { Database } from '../../database/Database';
import type { ProviderRegistry } from '../ProviderRegistry';
import { ContractError, toPublicError } from '../../../shared/contracts/errors';
import { deepSeekTrialReview, estimateDeepSeekInput, type LocalTokenEstimate } from './estimate';
import type { TrialRecord } from './record';

export type TrialQuote = TrialRecord & { expiresAt: string; estimate: Extract<LocalTokenEstimate, { kind: 'estimated' }> };
const prompt = 'Reply OK.';

/** Separate single-agent test, never a Run policy, retry or recovery permission. */
export class ControlledTrialService {
  private readonly quotes = new Map<string, TrialQuote>();
  private active?: Promise<TrialRecord>;
  private controller?: AbortController;
  private activeId?: string;
  private closing = false;

  constructor(private readonly database: Database, private readonly registry: ProviderRegistry,
    private readonly confirm: (quote: TrialQuote) => Promise<boolean>,
    private readonly hasActiveRuns: () => boolean = () => false) {}

  isBusy(): boolean { return this.activeId !== undefined; }

  prepare(providerId: string): TrialQuote {
    if (this.closing || this.active || this.hasActiveRuns() || this.database.listControlledTrials().some(value => value.state !== 'settled')) throw new ContractError('invalid_state');
    const { revision } = this.registry.controlledTrialTarget(providerId);
    this.checkPrice();
    const estimate = estimateDeepSeekInput([{ role: 'user', content: prompt }]);
    if (estimate.kind === 'unknown') throw new ContractError('unsupported');
    const { price } = deepSeekTrialReview;
    const estimatedMicroCny = estimate.inputTokens * price.inputMicroCnyPerToken + 128 * price.outputMicroCnyPerToken;
    if (!Number.isSafeInteger(estimatedMicroCny) || estimatedMicroCny > price.maxRequestMicroCny) throw new ContractError('invalid_input');
    const value: TrialQuote = {
      id: randomUUID(), requestId: randomUUID(), providerId, modelId: 'deepseek-flash', baseUrl: 'https://api.deepseek.com',
      prompt, keyRevision: revision, createdAt: new Date().toISOString(),
      expiresAt: new Date(Math.min(Date.now() + 120000, Date.parse(price.expiresAt))).toISOString(),
      priceReviewedAt: price.reviewedAt, priceExpiresAt: price.expiresAt, priceEvidence: price.evidence,
      inputMicroCnyPerToken: price.inputMicroCnyPerToken, outputMicroCnyPerToken: price.outputMicroCnyPerToken,
      estimatedInputTokens: estimate.inputTokens, estimatedMicroCny, reservedMicroCny: 50000, maxOutputTokens: 128,
      state: 'reserved', outcome: 'running', actualInputTokens: null, actualOutputTokens: null,
      accountedMicroCny: null, observedUsage: null, text: '', errorCode: null, estimate,
    };
    // Only the most recent preview can be authorized; previews never reserve or send.
    this.quotes.clear(); this.quotes.set(value.id, value);
    return structuredClone(value);
  }

  execute(id: string): Promise<TrialRecord> {
    const quote = this.quotes.get(id);
    if (!quote || this.active || this.closing) return Promise.reject(new ContractError('forbidden'));
    this.quotes.delete(id); // Consume before any await; cancellation cannot authorize a replay.
    this.activeId = id;
    this.controller = new AbortController();
    const operation = this.perform(quote);
    this.active = operation;
    void operation.then(() => this.clearActive(), () => this.clearActive());
    return operation;
  }

  abort(): void { this.controller?.abort(new ContractError('cancelled')); }
  async shutdown(): Promise<void> {
    this.closing = true; this.quotes.clear(); this.abort();
    try { await this.active; } catch { /* The reservation remains unknown if persistence failed. */ }
  }
  private clearActive() { this.active = undefined; this.activeId = undefined; this.controller = undefined; }
  private checkPrice() {
    const { price } = deepSeekTrialReview;
    if (!(Date.parse(price.reviewedAt) <= Date.now() && Date.now() < Date.parse(price.expiresAt))) throw new ContractError('unsupported');
  }
  private checkQuote(quote: TrialQuote) {
    if (this.hasActiveRuns()) throw new ContractError('invalid_state');
    this.checkPrice();
    if (this.controller?.signal.aborted) throw this.controller.signal.reason;
    if (this.closing || this.activeId !== quote.id || Date.now() >= Date.parse(quote.expiresAt)
      || this.registry.controlledTrialTarget(quote.providerId).revision !== quote.keyRevision) throw new ContractError('forbidden');
  }
  private async perform(quote: TrialQuote): Promise<TrialRecord> {
    const controller = this.controller!;
    this.checkQuote(quote);
    const approved = await new Promise<boolean>((resolve, reject) => {
      const abort = () => reject(controller.signal.reason);
      controller.signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new ContractError('timeout')), Math.max(1, Date.parse(quote.expiresAt) - Date.now()));
      const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', abort); controller.signal.removeEventListener('abort', finish); };
      controller.signal.addEventListener('abort', finish, { once: true });
      try { void this.confirm(structuredClone(quote)).then(value => { finish(); resolve(value); }, error => { finish(); reject(error); }); }
      catch (error) { finish(); reject(error); }
    });
    if (!approved) throw new ContractError('forbidden');
    this.checkQuote(quote);
    const { expiresAt: _expiry, estimate: _estimate, ...record } = quote;
    this.database.reserveControlledTrial(record);
    const timer = setTimeout(() => controller.abort(new ContractError('timeout')), 20000);
    let usage: { inputTokens: number; outputTokens: number } | undefined;
    let completed = false; let error: TrialRecord['errorCode'] = null; let text = '';
    try {
      for await (const chunk of this.registry.streamControlledTrial(quote.providerId, {
        requestId: quote.requestId, modelId: quote.modelId, messages: [{ role: 'user', content: prompt }],
        outputTokenLimit: 128, signal: controller.signal,
      }, () => this.checkQuote(quote))) {
        if (chunk.type === 'text_delta') {
          text += chunk.text;
          if (text.length > 16384) throw new ContractError('invalid_response');
          this.database.updateControlledTrialProgress(quote.id, { text });
        } else if (chunk.type === 'usage') {
          usage = { inputTokens: chunk.inputTokens, outputTokens: chunk.outputTokens };
          this.database.updateControlledTrialProgress(quote.id, { observedUsage: usage });
        }
        else if (chunk.type === 'error') error = chunk.error.code;
        else if (chunk.type === 'finish') completed = true;
      }
    } catch (failure) { error = toPublicError(failure).code; }
    finally { clearTimeout(timer); controller.abort(); }
    // A full terminal stream and valid usage are required to release any reservation.
    const accounted = completed && !error && usage ? usage.inputTokens * quote.inputMicroCnyPerToken + usage.outputTokens * quote.outputMicroCnyPerToken : null;
    const settled = accounted !== null && Number.isSafeInteger(accounted);
    return this.database.finishControlledTrial(quote.id, {
      state: settled ? 'settled' : 'unknown', outcome: error === 'cancelled' ? 'cancelled' : error ? 'error' : completed ? 'completed' : 'interrupted',
      actualInputTokens: settled ? usage!.inputTokens : null, actualOutputTokens: settled ? usage!.outputTokens : null,
      accountedMicroCny: settled ? accounted : null, errorCode: error,
    });
  }
}
