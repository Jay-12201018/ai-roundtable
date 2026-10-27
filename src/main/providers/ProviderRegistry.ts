import type { Database } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import type { ConfirmProviderTargetInput, ProviderConfiguration } from '../../shared/contracts/configuration';
import { confirmProviderTargetInputSchema } from '../../shared/schemas/configuration';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { streamChatInputSchema } from '../../shared/schemas/provider';
import type { ProviderAdapter, StreamChatInput } from './types';
import type { ModelTokenCounter } from '../context/types';
import { countModelTokens } from '../context/buildPublicContext';
import { MockProvider } from './mock/MockProvider';
import { mockModelBudget } from './mock/tokenBudget';
import { OpenAIProvider } from './openai/OpenAIProvider';
import { OpenAICompatibleProvider } from './openai-compatible/OpenAICompatibleProvider';
import { AnthropicProvider, buildAnthropicMessages } from './anthropic/AnthropicProvider';
import { GeminiProvider, buildGeminiContents } from './gemini/GeminiProvider';
import type { ChatCompletionCapabilities } from './openai/ChatCompletionProvider';
import { createNativeSafeFetch, createSafeFetch } from './network';
import type { PeriodPricing } from '../usage/pricing';
import type { DiagnosticObserver } from './diagnostics';
import { deepSeekFlashCapabilities } from './modelPolicies/deepseekFlash';
import type { LoopbackProxy, ProxyTargetKind } from './loopbackProxy';

export type ApprovedNativeInputCounter = {
  protocol: 'anthropic-messages-v1'; evidence: string;
  countNativeWire: (wire: ReturnType<typeof buildAnthropicMessages>) => number | undefined;
} | {
  protocol: 'gemini-generate-content-v1'; evidence: string;
  countNativeWire: (wire: ReturnType<typeof buildGeminiContents>) => number | undefined;
};
export interface ApprovedModelPolicy {
  evidence: string;
  outputTokenParameter: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens';
  contextWindowTokens: number;
  maxOutputTokens: number;
  maxInputTokens?: number;
  counter: ModelTokenCounter;
  nativeInputCounter?: ApprovedNativeInputCounter;
  price: { inputUsdPerMillion: number; outputUsdPerMillion: number; maxRequestUsd: number; evidence: string;
    reviewedAt?: string; expiresAt?: string } | {
    currency: 'CNY'; inputMicroCnyPerToken: number; outputMicroCnyPerToken: number; maxRequestMicroCny: number;
    reviewedAt: string; expiresAt: string; evidence: string;
    /** R13B (D106): reviewed period and cache-hit rates used only to settle; reservation stays at the rates above. */
    periodPricing?: PeriodPricing;
  };
}
type Options = {
  proxy?: LoopbackProxy;
  policyResolver?: (configuration: ProviderConfiguration, modelId: string) => ApprovedModelPolicy | undefined;
  capabilitiesResolver?: (configuration: ProviderConfiguration) => ChatCompletionCapabilities;
  transportFactory?: (guard: () => void, diagnostics?: DiagnosticObserver, proxyKind?: ProxyTargetKind) => typeof fetch;
};
/** The most a request can cost under its approved price, reserved against the Run budget before it is sent. */
export type RequestQuote = {
  currency: 'CNY' | 'USD'; inputTokenBound: number; outputTokenLimit: number;
  inputMicroPerToken: number; outputMicroPerToken: number; reservedMicro: number;
  priceEvidence: string; priceReviewedAt: string | null;
  /** D106: how a settled request is actually priced; absent means the reserved peak cache-miss rates apply. */
  periodPricing?: PeriodPricing;
};
type Approval = { kind: string; baseUrl: string; revision: string };
const officialCapabilities: ChatCompletionCapabilities = { outputTokenParameter: 'max_completion_tokens', streamUsage: true, listModels: true, authentication: 'models' };
const unknownCapabilities: ChatCompletionCapabilities = { outputTokenParameter: null, streamUsage: false, listModels: false, authentication: 'unsupported' };
type RegistryCapabilities = Omit<ChatCompletionCapabilities, 'outputTokenParameter'> & { outputTokenParameter: ApprovedModelPolicy['outputTokenParameter'] | null };
const nativeTargets = { anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta' } as const;

// Main owns approvals and reviewed model evidence. Renderer/model names cannot supply either.
// D113: an approval is persisted with the Key revision it names, so it survives a restart but not a new Key or target.
export class ProviderRegistry {
  constructor(private readonly database: Database, private readonly keys: KeyService, private readonly options: Options = {}) {}

  private configuration(id: string): ProviderConfiguration {
    const configuration = this.database.getProviderConfiguration(id);
    if (!configuration) throw new ContractError('not_found');
    if (!configuration.enabled) throw new ContractError('invalid_state');
    if (!['mock', 'openai', 'openai-compatible', 'anthropic', 'gemini'].includes(configuration.kind)) throw new ContractError('unsupported');
    return configuration;
  }
  private target(configuration: ProviderConfiguration): string {
    const official = configuration.kind === 'anthropic' || configuration.kind === 'gemini' ? nativeTargets[configuration.kind]
      : configuration.kind === 'openai' ? 'https://api.openai.com/v1' : undefined;
    const base = configuration.baseUrl ?? official ?? '';
    if (!base) throw new ContractError('invalid_input');
    const target = new URL(base).toString().replace(/\/+$/u, '');
    if (official && target !== official) throw new ContractError('invalid_input');
    return target;
  }
  validateConfiguration(providerId: string): void {
    const configuration = this.configuration(providerId);
    if (configuration.kind !== 'mock') this.target(configuration);
  }
  confirmTarget(input: ConfirmProviderTargetInput): { providerId: string } {
    const parsed = confirmProviderTargetInputSchema.safeParse(input);
    if (!parsed.success) throw new ContractError('invalid_input');
    const configuration = this.configuration(parsed.data.providerId);
    if (configuration.kind === 'mock') throw new ContractError('invalid_input');
    const baseUrl = this.target(configuration);
    if (new URL(parsed.data.baseUrl).toString().replace(/\/+$/u, '') !== baseUrl) throw new ContractError('forbidden');
    this.database.saveTargetApproval(configuration.id, { kind: configuration.kind, baseUrl, revision: this.database.getProviderKeyRevision(configuration.id) });
    return { providerId: configuration.id };
  }
  /** Whether a send would pass the target check now: same kind, target and Key revision as confirmed (D113). */
  isTargetConfirmed(id: string): boolean {
    try { this.trusted(id); return true; } catch { return false; }
  }
  private trusted(id: string): Approval {
    const configuration = this.configuration(id);
    const approved = this.database.getTargetApproval(id);
    if (!approved || approved.kind !== configuration.kind || approved.baseUrl !== this.target(configuration)
      || approved.revision !== this.database.getProviderKeyRevision(id)) throw new ContractError('forbidden');
    return approved;
  }
  resolveModelPolicy(configuration: ProviderConfiguration, modelId: string): ApprovedModelPolicy | undefined {
    // Production Main injects the reviewed DeepSeek policy (D089); a bare registry approves nothing.
    return this.options.policyResolver?.(configuration, modelId);
  }
  resolveCapabilities(configuration: ProviderConfiguration): RegistryCapabilities {
    if (configuration.kind === 'anthropic' || configuration.kind === 'gemini') return {
      outputTokenParameter: configuration.kind === 'gemini' ? 'maxOutputTokens' : 'max_tokens',
      streamUsage: true, listModels: true, authentication: 'models',
    };
    return configuration.kind === 'openai' ? officialCapabilities : this.options.capabilitiesResolver?.(configuration) ?? deepSeekFlashCapabilities(configuration) ?? unknownCapabilities;
  }
  createTransport(guard: () => void, diagnostics?: DiagnosticObserver, proxyKind?: ProxyTargetKind): typeof fetch {
    return this.options.transportFactory?.(guard, diagnostics, proxyKind) ?? createSafeFetch(guard, undefined, diagnostics, this.options.proxy, proxyKind);
  }
  /** The fixed proxy target for a reviewed origin; any other Provider is refused while a proxy is configured. */
  private proxyKind(configuration: ProviderConfiguration, approval: Approval): ProxyTargetKind | undefined {
    if (!this.options.proxy) return;
    if (configuration.kind === 'anthropic' || configuration.kind === 'gemini') return configuration.kind;
    if (configuration.kind === 'openai-compatible' && approval.baseUrl === 'https://api.deepseek.com') return 'deepseek';
    throw new ContractError('forbidden');
  }

  assertSelection(providerId: string, modelId: string): void {
    const configuration = this.database.validateModelSelection(providerId, modelId);
    if (configuration.kind === 'mock') return;
    this.trusted(providerId);
    if (!this.approvedPolicy(configuration, modelId)) throw new ContractError('unsupported');
  }
  /** D114: the model's reviewed policy when it is complete and current, exactly as assertSelection requires it. */
  approvedPolicy(configuration: ProviderConfiguration, modelId: string): ApprovedModelPolicy | undefined {
    const policy = this.resolveModelPolicy(configuration, modelId);
    if (!policy || !policy.evidence.trim() || policy.counter.modelId !== modelId || !policy.counter.method.trim()
      || !['exact','upper_bound'].includes(policy.counter.kind)
      || !Number.isSafeInteger(policy.contextWindowTokens) || policy.contextWindowTokens <= 0
      || !Number.isSafeInteger(policy.maxOutputTokens) || policy.maxOutputTokens <= 0
      || policy.maxOutputTokens > policy.contextWindowTokens
      || policy.maxInputTokens !== undefined && (!Number.isSafeInteger(policy.maxInputTokens) || policy.maxInputTokens <= 0 || policy.maxInputTokens > policy.contextWindowTokens)
      || !validPrice(policy.price)
      || (configuration.kind === 'anthropic' || configuration.kind === 'gemini') && (!validReviewWindow(policy.price)
        || !policy.nativeInputCounter?.evidence.trim() || typeof policy.nativeInputCounter.countNativeWire !== 'function'
        || policy.nativeInputCounter.protocol !== (configuration.kind === 'anthropic' ? 'anthropic-messages-v1' : 'gemini-generate-content-v1'))
      || !policy.outputTokenParameter || this.resolveCapabilities(configuration).outputTokenParameter !== policy.outputTokenParameter) return undefined;
    return policy;
  }
  /** D114: the confirmed target that a send would use now, or undefined when none is valid. */
  confirmedTarget(id: string): string | undefined {
    try { return this.trusted(id).baseUrl; } catch { return undefined; }
  }
  budget(providerId: string, modelId: string) {
    this.assertSelection(providerId, modelId);
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') return mockModelBudget;
    const policy = this.resolveModelPolicy(configuration, modelId)!;
    return { ...policy, counter: this.inputCounter(configuration, policy) };
  }
  private inputCounter(configuration: ProviderConfiguration, policy: ApprovedModelPolicy): ModelTokenCounter {
    if (configuration.kind !== 'anthropic' && configuration.kind !== 'gemini') return policy.counter;
    const native = policy.nativeInputCounter!;
    return { ...policy.counter, countMessages: messages => native.protocol === 'anthropic-messages-v1'
      ? native.countNativeWire(buildAnthropicMessages(messages)) : native.countNativeWire(buildGeminiContents(messages)) };
  }
  checkGeneration(providerId: string, input: StreamChatInput): void {
    // StreamChatInput includes AbortSignal only inside Main; validate its serializable request separately.
    const { signal: _signal, ...request } = input;
    if (!streamChatInputSchema.safeParse(request).success) throw new ContractError('invalid_input');
    this.assertSelection(providerId, input.modelId);
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') return;
    const policy = this.resolveModelPolicy(configuration, input.modelId)!;
    const count = countModelTokens(input.messages, input.modelId, this.inputCounter(configuration, policy));
    if (count === undefined || input.outputTokenLimit === undefined || input.outputTokenLimit > policy.maxOutputTokens
      || policy.maxInputTokens !== undefined && count > policy.maxInputTokens
      || count + input.outputTokenLimit > policy.contextWindowTokens) throw new ContractError('invalid_input');
    const price = policy.price;
    if ('currency' in price) {
      const maximumMicroCny = count * price.inputMicroCnyPerToken + input.outputTokenLimit * price.outputMicroCnyPerToken;
      if (!Number.isSafeInteger(maximumMicroCny) || maximumMicroCny > price.maxRequestMicroCny) throw new ContractError('invalid_input');
    } else {
      const maximumUsd = (count * price.inputUsdPerMillion + input.outputTokenLimit * price.outputUsdPerMillion) / 1_000_000;
      if (!Number.isFinite(maximumUsd) || maximumUsd > price.maxRequestUsd) throw new ContractError('invalid_input');
    }
  }

  /** Validates the request like checkGeneration and returns its maximum cost; undefined for Mock members. */
  quoteRequest(providerId: string, input: StreamChatInput): RequestQuote | undefined {
    this.checkGeneration(providerId, input);
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') return;
    const policy = this.resolveModelPolicy(configuration, input.modelId)!;
    const inputTokenBound = countModelTokens(input.messages, input.modelId, this.inputCounter(configuration, policy))!;
    const outputTokenLimit = input.outputTokenLimit!;
    const price = policy.price;
    if ('currency' in price) {
      const reservedMicro = inputTokenBound * price.inputMicroCnyPerToken + outputTokenLimit * price.outputMicroCnyPerToken;
      return { currency: 'CNY', inputTokenBound, outputTokenLimit, inputMicroPerToken: price.inputMicroCnyPerToken,
        outputMicroPerToken: price.outputMicroCnyPerToken, reservedMicro, priceEvidence: price.evidence, priceReviewedAt: price.reviewedAt,
        ...(price.periodPricing ? { periodPricing: price.periodPricing } : {}) };
    }
    // The Run budget is CNY. A non-zero USD price is never converted by guessing an exchange rate.
    if (price.inputUsdPerMillion !== 0 || price.outputUsdPerMillion !== 0) throw new ContractError('unsupported');
    return { currency: 'USD', inputTokenBound, outputTokenLimit, inputMicroPerToken: 0, outputMicroPerToken: 0, reservedMicro: 0,
      priceEvidence: price.evidence, priceReviewedAt: price.reviewedAt ?? null };
  }

  controlledTrialTarget(providerId: string) {
    const configuration = this.database.validateModelSelection(providerId, 'deepseek-flash');
    const approval = this.trusted(providerId);
    if (configuration.kind !== 'openai-compatible' || approval.baseUrl !== 'https://api.deepseek.com') throw new ContractError('unsupported');
    if (configuration.defaultModelId !== 'deepseek-flash' && !configuration.customModels.some(model => model.id === 'deepseek-flash')) throw new ContractError('invalid_input');
    return { configuration, revision: approval.revision };
  }

  // Main-only, single fixed-prompt test. This does not approve a policy for ordinary Runs.
  async *streamControlledTrial(providerId: string, input: StreamChatInput, permit: () => void, diagnostics?: DiagnosticObserver) {
    try {
      const { signal: _signal, ...parameters } = input;
      const parsed = streamChatInputSchema.parse(parameters);
      if (parsed.modelId !== 'deepseek-flash' || parsed.outputTokenLimit !== 128 || parsed.messages.length !== 1
        || parsed.messages[0].role !== 'user' || parsed.messages[0].content !== 'Reply OK.'
        || parsed.agentRole !== undefined || parsed.turnIndex !== undefined) throw new ContractError('invalid_input');
      const { configuration, revision } = this.controlledTrialTarget(providerId);
      const approval = this.trusted(providerId);
      const guard = () => {
        try {
          permit();
          if (input.signal?.aborted) throw input.signal.reason instanceof ContractError ? input.signal.reason : new ContractError('cancelled');
          if (this.controlledTrialTarget(providerId).revision !== revision) throw new ContractError('forbidden');
        } catch (error) {
          const code = toPublicError(error).code;
          diagnostics?.({ category: code === 'cancelled' ? 'cancelled' : code === 'timeout' ? 'request_timeout' : 'policy_rejected' });
          throw error;
        }
      };
      guard();
      const adapter = this.createRealAdapter(configuration, approval, guard, diagnostics);
      for await (const chunk of adapter.streamChat({ ...parsed, signal: input.signal })) { guard(); yield chunk; }
    } catch (error) { yield { type: 'error' as const, requestId: input.requestId, error: toPublicError(error) }; }
  }

  private createRealAdapter(configuration: ProviderConfiguration, approval: Approval, guard: () => void, diagnostics?: DiagnosticObserver,
    onDispatch?: () => void): ProviderAdapter {
    const proxyKind = this.proxyKind(configuration, approval);
    const providerId = configuration.id;
    const safeTransport = this.createTransport(guard, diagnostics, proxyKind);
    const transport = configuration.kind === 'anthropic' || configuration.kind === 'gemini'
      ? createNativeSafeFetch(configuration.kind, safeTransport, guard) : safeTransport;
    const options = { configuration, confirmedBaseUrl: approval.baseUrl, diagnostics,
      resolveKey: async (id: string) => {
        guard();
        if (id !== providerId) throw new ContractError('forbidden');
        const state = await this.keys.getProviderKeyState(id); guard();
        const key = state.keyReference ? await this.keys.resolveKey(id, state.keyReference) : undefined;
        guard(); return key;
      },
      // The single path to the network: a request that never reached it provably cost nothing.
      fetch: (async (url, init) => { guard(); onDispatch?.(); return transport(url, init); }) as typeof fetch,
    };
    if (configuration.kind === 'anthropic') return new AnthropicProvider(options);
    if (configuration.kind === 'gemini') return new GeminiProvider(options);
    if (configuration.kind === 'openai') return new OpenAIProvider(options);
    const capabilities = this.resolveCapabilities(configuration);
    if (capabilities.outputTokenParameter === 'maxOutputTokens') throw new ContractError('unsupported');
    return new OpenAICompatibleProvider({ ...options, capabilities: { ...capabilities, outputTokenParameter: capabilities.outputTokenParameter } });
  }

  getAdapter(providerId: string, modelId?: string, onDispatch?: () => void): ProviderAdapter {
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') {
      if (modelId !== undefined) this.database.validateModelSelection(providerId, modelId);
      return new MockProvider({ tokenDelayMs: 60 });
    }
    const approval = this.trusted(providerId);
    if (modelId !== undefined) this.assertSelection(providerId, modelId);
    const guard = () => {
      const current = this.trusted(providerId);
      if (current.kind !== approval.kind || current.baseUrl !== approval.baseUrl || current.revision !== approval.revision) throw new ContractError('forbidden');
      if (modelId !== undefined) this.assertSelection(providerId, modelId);
    };
    const adapter = this.createRealAdapter(configuration, approval, guard, undefined, onDispatch);
    const stream = adapter.streamChat.bind(adapter);
    const registry = this;
    adapter.streamChat = async function* (input) {
      try {
        if (modelId !== undefined && input.modelId !== modelId) throw new ContractError('invalid_input');
        guard(); registry.checkGeneration(providerId, input);
        for await (const chunk of stream(input)) { guard(); yield chunk; }
      } catch (error) { yield { type: 'error', requestId: input.requestId, error: toPublicError(error) }; }
    };
    const list = adapter.listModels.bind(adapter);
    adapter.listModels = async input => { guard(); const models = await list(input); guard(); return models; };
    const test = adapter.testConnection.bind(adapter);
    adapter.testConnection = async input => {
      try {
        guard();
        if (input.level === 'generation') this.checkGeneration(providerId, { requestId: input.requestId, modelId: input.modelId!,
          messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8, signal: input.signal });
        const result = await test(input); guard(); return result;
      } catch (error) { return { requestId: input.requestId, level: input.level, ok: false, error: toPublicError(error) }; }
    };
    return adapter;
  }
}

function validReviewWindow(price: ApprovedModelPolicy['price']): boolean {
  const reviewed = Date.parse(price.reviewedAt ?? ''); const expires = Date.parse(price.expiresAt ?? ''); const now = Date.now();
  return Number.isFinite(reviewed) && Number.isFinite(expires) && reviewed <= now && now < expires && expires > reviewed;
}

/** D106: settlement rates may only lower the reserved peak cache-miss price, never raise it. */
function validPeriodPricing(pricing: PeriodPricing, inputMicroPerToken: number, outputMicroPerToken: number): boolean {
  const rates = [pricing.peak, pricing.offPeak];
  return pricing.evidence.trim().length > 0 && Number.isInteger(pricing.utcOffsetMinutes) && Math.abs(pricing.utcOffsetMinutes) <= 14 * 60
    && pricing.peakWeekdays.every(day => Number.isInteger(day) && day >= 0 && day <= 6)
    && pricing.peakWindows.every(window => Number.isInteger(window.startMinute) && Number.isInteger(window.endMinute) && window.startMinute >= 0 && window.startMinute < window.endMinute && window.endMinute <= 1440)
    && rates.every(rate => [rate.cacheHitMicroPerMillion, rate.cacheMissMicroPerMillion, rate.outputMicroPerMillion].every(n => Number.isSafeInteger(n) && n >= 0)
      && rate.cacheHitMicroPerMillion <= rate.cacheMissMicroPerMillion
      && rate.cacheMissMicroPerMillion <= inputMicroPerToken * 1_000_000 && rate.outputMicroPerMillion <= outputMicroPerToken * 1_000_000);
}

function validPrice(price: ApprovedModelPolicy['price']): boolean {
  if (!price.evidence.trim()) return false;
  if ('currency' in price) {
    const reviewed = Date.parse(price.reviewedAt); const expires = Date.parse(price.expiresAt); const now = Date.now();
    return price.currency === 'CNY' && Number.isFinite(reviewed) && Number.isFinite(expires)
      && reviewed <= now && now < expires && expires > reviewed
      && [price.inputMicroCnyPerToken, price.outputMicroCnyPerToken, price.maxRequestMicroCny].every(n => Number.isSafeInteger(n) && n >= 0)
      && (price.periodPricing === undefined || validPeriodPricing(price.periodPricing, price.inputMicroCnyPerToken, price.outputMicroCnyPerToken));
  }
  return [price.inputUsdPerMillion, price.outputUsdPerMillion, price.maxRequestUsd].every(n => Number.isFinite(n) && n >= 0);
}
