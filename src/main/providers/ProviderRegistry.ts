import type { Database } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import type { ProviderConfiguration } from '../../shared/contracts/configuration';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { modelLimits, streamChatInputSchema } from '../../shared/schemas/provider';
import type { ProviderAdapter, StreamChatInput } from './types';
import type { ModelTokenCounter } from '../context/types';
import { countModelTokens } from '../context/buildPublicContext';
import { MockProvider } from './mock/MockProvider';
import { mockModelBudget } from './mock/tokenBudget';
import { CompatibleProvider } from './compatible/CompatibleProvider';
import { catalogHas, catalogHosts, catalogServiceAt, serviceCatalog, type CatalogService } from '../../shared/serviceCatalog';
import type { ProviderMessage } from './types';
import { createSafeFetch, type AllowedHosts } from './network';
import type { DiagnosticObserver } from './diagnostics';

type Options = {
  /** Tests pass their own; the application never does. */
  catalog?: readonly CatalogService[];
  transportFactory?: (guard: () => void, diagnostics?: DiagnosticObserver) => typeof fetch;
};
/** What a request for a model may use: the host's per-model limits or the defaults (D134), with an input counter. */
export type ModelBudget = { contextWindowTokens: number; maxOutputTokens: number; counter: ModelTokenCounter };
/** What a request was prepared for; it stops if the service's kind, address or Key changes under it. */
type Binding = { kind: string; baseUrl: string; revision: string };
/** D135: a long reply from a slow model must not be cut off; the Run's duration limit is what bounds a discussion. */
const STREAM_TIMEOUT_MS = 600_000;

// D136: saving a service is what lets its Key go to its address; Renderer and model names cannot change where it goes.
export class ProviderRegistry {
  constructor(private readonly database: Database, private readonly keys: KeyService, private readonly options: Options = {}) {}

  private configuration(id: string): ProviderConfiguration {
    const configuration = this.database.getProviderConfiguration(id);
    if (!configuration) throw new ContractError('not_found');
    if (!configuration.enabled) throw new ContractError('invalid_state');
    return configuration;
  }
  catalog(): readonly CatalogService[] { return this.options.catalog ?? serviceCatalog; }
  /** What the transport may reach: the catalog's hosts. */
  transportHosts(): AllowedHosts { return catalogHosts(this.catalog()); }
  /** D143: the catalog's service at this address, or a refusal, before any Key is read. */
  private catalogService(configuration: ProviderConfiguration): CatalogService {
    const service = catalogServiceAt(this.catalog(), configuration.baseUrl);
    if (!service) throw new ContractError('service_unsupported');
    return service;
  }
  private target(configuration: ProviderConfiguration): string {
    return this.catalogService(configuration).baseUrl;
  }
  /** Where this service's Key and content go; undefined when its configuration is unusable. */
  targetOf(configuration: ProviderConfiguration): string | undefined {
    if (configuration.kind === 'mock') return undefined;
    return configuration.baseUrl?.replace(/\/+$/u, '') ?? undefined;
  }
  validateConfiguration(providerId: string): void {
    const configuration = this.configuration(providerId);
    if (configuration.kind !== 'mock') this.target(configuration);
  }
  private bound(id: string): Binding {
    const configuration = this.configuration(id);
    return { kind: configuration.kind, baseUrl: this.target(configuration), revision: this.database.getProviderKeyRevision(id) };
  }
  createTransport(guard: () => void, diagnostics?: DiagnosticObserver): typeof fetch {
    return this.options.transportFactory?.(guard, diagnostics) ?? createSafeFetch(guard, undefined, diagnostics, this.transportHosts());
  }
  assertSelection(providerId: string, modelId: string): void {
    // D143: what is outside the catalog says so, even if it is also stopped.
    const stored = this.database.getProviderConfiguration(providerId);
    if (stored && stored.kind !== 'mock' && !catalogHas(this.catalogService(stored), modelId)) throw new ContractError('model_unsupported');
    this.database.validateModelSelection(providerId, modelId);
  }
  /** D134: the limits a model's requests use now; they never depend on the model's name. */
  limits(configuration: ProviderConfiguration, modelId: string): { contextWindowTokens: number; maxOutputTokens: number } {
    return modelLimits(configuration.customModels.find(model => model.id === modelId));
  }
  budget(providerId: string, modelId: string): ModelBudget {
    this.assertSelection(providerId, modelId);
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') return { ...mockModelBudget, maxOutputTokens: mockModelBudget.contextWindowTokens };
    return { ...this.limits(configuration, modelId), counter: { modelId, kind: 'upper_bound', method: inputBoundMethod, countMessages: countInputUpperBound } };
  }
  checkGeneration(providerId: string, input: StreamChatInput): void {
    // StreamChatInput includes AbortSignal only inside Main; validate its serializable request separately.
    const { signal: _signal, ...request } = input;
    if (!streamChatInputSchema.safeParse(request).success) throw new ContractError('invalid_input');
    this.assertSelection(providerId, input.modelId);
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') return;
    const budget = this.budget(providerId, input.modelId);
    const count = countModelTokens(input.messages, input.modelId, budget.counter);
    if (count === undefined || input.outputTokenLimit === undefined || input.outputTokenLimit > budget.maxOutputTokens
      || count + input.outputTokenLimit > budget.contextWindowTokens) throw new ContractError('invalid_input');
  }

  private createRealAdapter(configuration: ProviderConfiguration, binding: Binding, guard: () => void, diagnostics?: DiagnosticObserver,
    onDispatch?: () => void): ProviderAdapter {
    const providerId = configuration.id;
    const safeTransport = this.createTransport(guard, diagnostics);
    const options = { configuration, confirmedBaseUrl: binding.baseUrl, diagnostics, streamTimeoutMs: STREAM_TIMEOUT_MS,
      resolveKey: async (id: string) => {
        guard();
        if (id !== providerId) throw new ContractError('forbidden');
        const state = await this.keys.getProviderKeyState(id); guard();
        const key = state.keyReference ? await this.keys.resolveKey(id, state.keyReference) : undefined;
        guard(); return key;
      },
      // The single path to the network: a request that never reached it provably was not sent.
      fetch: (async (url, init) => { guard(); onDispatch?.(); return safeTransport(url, init); }) as typeof fetch,
    };
    return new CompatibleProvider(options);
  }

  getAdapter(providerId: string, modelId?: string, onDispatch?: () => void): ProviderAdapter {
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') {
      if (modelId !== undefined) this.database.validateModelSelection(providerId, modelId);
      return new MockProvider({ tokenDelayMs: 60 });
    }
    const binding = this.bound(providerId);
    if (modelId !== undefined) this.assertSelection(providerId, modelId);
    const guard = () => {
      const current = this.bound(providerId);
      if (current.kind !== binding.kind || current.baseUrl !== binding.baseUrl || current.revision !== binding.revision) throw new ContractError('forbidden');
      if (modelId !== undefined) this.assertSelection(providerId, modelId);
    };
    const adapter = this.createRealAdapter(configuration, binding, guard, undefined, onDispatch);
    const stream = adapter.streamChat.bind(adapter);
    const registry = this;
    adapter.streamChat = async function* (input) {
      try {
        if (modelId !== undefined && input.modelId !== modelId) throw new ContractError('invalid_input');
        guard(); registry.checkGeneration(providerId, input);
        for await (const chunk of stream(input)) { guard(); yield chunk; }
      } catch (error) { yield { type: 'error', requestId: input.requestId, error: toPublicError(error) }; }
    };
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

// Framing allowances are generous on purpose: role markers carry no message bytes, and nothing here is exact.
const framing = { perRequestTokens: 512, perMessageTokens: 32 };
const inputBoundMethod = `UTF-8 bytes + ${framing.perMessageTokens}/message + ${framing.perRequestTokens}/request`;
/**
 * D090, D134: an upper bound on a request's input tokens for any tokenizer that emits at least one byte per token. It
 * overstates Chinese about 1.5–2 times and English about 4 times, which only means a discussion is called full early.
 */
export function countInputUpperBound(messages: readonly Readonly<ProviderMessage>[]): number | undefined {
  let total = framing.perRequestTokens;
  for (const message of messages) {
    if (typeof message.content !== 'string') return undefined;
    total += framing.perMessageTokens + Buffer.byteLength(message.content, 'utf8');
  }
  return Number.isSafeInteger(total) ? total : undefined;
}
