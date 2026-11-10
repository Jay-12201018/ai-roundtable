import type { Database } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import type { ProviderConfiguration } from '../../shared/contracts/configuration';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { IMAGE_INPUT_TOKENS, messageImagesOf, messageTextOf, modelLimits, streamChatInputSchema } from '../../shared/schemas/provider';
import type { ProviderAdapter, StreamChatInput } from './types';
import type { ModelTokenCounter } from '../context/types';
import { countModelTokens } from '../context/buildPublicContext';
import { MockProvider } from './mock/MockProvider';
import { mockModelBudget } from './mock/tokenBudget';
import { CompatibleProvider } from './compatible/CompatibleProvider';
import { catalogHosts, catalogServiceAt, fastReplyBodyOf, imageSupportOf, modelAllowed, serviceCatalog, type CatalogService, type ImageSupport } from '../../shared/serviceCatalog';
import type { ProviderMessage } from './types';
import { createSafeFetch, type AllowedHosts } from './network';
import type { DiagnosticObserver } from './diagnostics';

type Options = {
  /** Tests pass their own; the application never does. */
  catalog?: readonly CatalogService[];
  transportFactory?: (guard: () => void, diagnostics?: DiagnosticObserver) => typeof fetch;
  /** D147: reads a stored image's bytes when a request is written. Without it, a request with images cannot be sent. */
  readImage?: (attachmentId: string) => Promise<Uint8Array>;
};
/** What a request for a model may use: the host's per-model limits or the defaults (D134), with an input counter. */
export type ModelBudget = { contextWindowTokens: number; maxOutputTokens: number; counter: ModelTokenCounter; imageSupport: ImageSupport };
/** What a request was prepared for; it stops if the service's kind, address or Key changes under it. */
type Binding = { kind: string; baseUrl: string; revision: string };
/** D135: a long reply from a slow model must not be cut off; the Run's duration limit is what bounds a discussion. */
const STREAM_TIMEOUT_MS = 600_000;
/** D164: a reply that has started and then sends nothing for this long is taken as cut off. Services stream their thinking, so a minute of nothing is not thought. */
const STREAM_IDLE_TIMEOUT_MS = 60_000;

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
    if (stored && stored.kind !== 'mock' && !modelAllowed(this.catalogService(stored), modelId, this.database.getModelDiscovery(providerId)?.modelIds ?? [])) throw new ContractError('model_unsupported');
    this.database.validateModelSelection(providerId, modelId);
  }
  /** D134: the limits a model's requests use now; they never depend on the model's name. */
  limits(configuration: ProviderConfiguration, modelId: string): { contextWindowTokens: number; maxOutputTokens: number } {
    // What the catalog says of a short model, unless the host set otherwise.
    const listed = catalogServiceAt(this.catalog(), configuration.baseUrl)?.models.find(model => model.id === modelId);
    return modelLimits({ ...listed, ...configuration.customModels.find(model => model.id === modelId) });
  }
  budget(providerId: string, modelId: string): ModelBudget {
    this.assertSelection(providerId, modelId);
    const configuration = this.configuration(providerId);
    // The demo's replies are written in advance, so it does not read images, and it says so.
    if (configuration.kind === 'mock') return { ...mockModelBudget, maxOutputTokens: mockModelBudget.contextWindowTokens, imageSupport: 'no' };
    return { ...this.limits(configuration, modelId), counter: { modelId, kind: 'upper_bound', method: inputBoundMethod, countMessages: countInputUpperBound },
      imageSupport: imageSupportOf(catalogServiceAt(this.catalog(), configuration.baseUrl), modelId) };
  }
  /**
   * D150, D162: the models a group chat may ask to read a message, best first. A model a member of this discussion uses comes before any
   * other: the host chose it, so it is known to answer on this account, which a model that is merely listed is not (a listed model can still
   * need switching on, and then fails every time). Among those, one the catalog marks fast, then one that can skip thinking. After them, the
   * fast model of each connected service, the discussion's own services first. A service with no Key is never asked; the demo is never one.
   */
  scheduleCandidates(members: ReadonlyArray<{ providerId: string | null; modelId: string | null }>): Array<{ providerId: string; modelId: string }> {
    const connected = this.database.listProviderSummaries().filter(provider => provider.enabled && provider.configurationValid && provider.hasStoredKey && provider.kind !== 'mock');
    const service = (providerId: string) => { try { return catalogServiceAt(this.catalog(), this.configuration(providerId).baseUrl); } catch { return undefined; } };
    const found: Array<{ providerId: string; modelId: string }> = [];
    const add = (providerId: string, modelId: string) => {
      if (!connected.some(provider => provider.id === providerId) || found.some(item => item.providerId === providerId && item.modelId === modelId)) return;
      try { this.assertSelection(providerId, modelId); found.push({ providerId, modelId }); } catch { /* A service that cannot take this request is not asked. */ }
    };
    const used = members.flatMap(member => member.providerId && member.modelId ? [{ providerId: member.providerId, modelId: member.modelId }] : []);
    const flag = (member: { providerId: string; modelId: string }) => service(member.providerId)?.models.find(model => model.id === member.modelId);
    for (const member of used) if (flag(member)?.fast) add(member.providerId, member.modelId);
    for (const member of used) if (flag(member)?.fastReply) add(member.providerId, member.modelId);
    const preferred = [...new Set(used.map(member => member.providerId))];
    for (const provider of [...connected].sort((a, b) => rank(preferred, a.id) - rank(preferred, b.id))) {
      const model = service(provider.id)?.models.find(item => item.fast);
      if (model) add(provider.id, model.id);
    }
    return found;
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
    onDispatch?: () => void): CompatibleProvider {
    const providerId = configuration.id;
    const safeTransport = this.createTransport(guard, diagnostics);
    const options = { configuration, confirmedBaseUrl: binding.baseUrl, diagnostics, streamTimeoutMs: STREAM_TIMEOUT_MS, streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS, readImage: this.options.readImage,
      fastReplyBody: (modelId: string) => fastReplyBodyOf(catalogServiceAt(this.catalog(), configuration.baseUrl), modelId),
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

  /** D143: asks the service at its catalog address which models this Key can use. The Provider must be usable, as for any request. */
  listModels(providerId: string, requestId: string): Promise<string[]> {
    const configuration = this.configuration(providerId);
    if (configuration.kind === 'mock') throw new ContractError('unsupported');
    const binding = this.bound(providerId);
    const guard = () => {
      const current = this.bound(providerId);
      if (current.kind !== binding.kind || current.baseUrl !== binding.baseUrl || current.revision !== binding.revision) throw new ContractError('forbidden');
    };
    return this.createRealAdapter(configuration, binding, guard).listModels({ requestId });
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

const rank = (preferred: readonly string[], id: string) => { const at = preferred.indexOf(id); return at < 0 ? preferred.length : at; };
// Framing allowances are generous on purpose: role markers carry no message bytes, and nothing here is exact.
const framing = { perRequestTokens: 512, perMessageTokens: 32 };
const inputBoundMethod = `UTF-8 bytes + ${IMAGE_INPUT_TOKENS}/image + ${framing.perMessageTokens}/message + ${framing.perRequestTokens}/request`;
/**
 * D090, D134: an upper bound on a request's input tokens for any tokenizer that emits at least one byte per token. It
 * overstates Chinese about 1.5–2 times and English about 4 times, which only means a discussion is called full early.
 */
export function countInputUpperBound(messages: readonly Readonly<ProviderMessage>[]): number | undefined {
  let total = framing.perRequestTokens;
  for (const message of messages) {
    total += framing.perMessageTokens + Buffer.byteLength(messageTextOf(message.content), 'utf8') + messageImagesOf(message.content).length * IMAGE_INPUT_TOKENS;
  }
  return Number.isSafeInteger(total) ? total : undefined;
}
