import type { Database } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import type { ConfirmProviderTargetInput, ProviderConfiguration } from '../../shared/contracts/configuration';
import { confirmProviderTargetInputSchema } from '../../shared/schemas/configuration';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { modelLimits, streamChatInputSchema } from '../../shared/schemas/provider';
import type { ProviderAdapter, StreamChatInput } from './types';
import type { ModelTokenCounter } from '../context/types';
import { countModelTokens } from '../context/buildPublicContext';
import { MockProvider } from './mock/MockProvider';
import { mockModelBudget } from './mock/tokenBudget';
import { OpenAIProvider } from './openai/OpenAIProvider';
import { OpenAICompatibleProvider } from './openai-compatible/OpenAICompatibleProvider';
import { AnthropicProvider } from './anthropic/AnthropicProvider';
import { GeminiProvider } from './gemini/GeminiProvider';
import type { ChatCompletionCapabilities } from './openai/ChatCompletionProvider';
import type { ProviderMessage } from './types';
import { createNativeSafeFetch, createSafeFetch } from './network';
import type { DiagnosticObserver } from './diagnostics';
import type { LoopbackProxy, ProxyTargetKind } from './loopbackProxy';

type Options = {
  proxy?: LoopbackProxy;
  capabilitiesResolver?: (configuration: ProviderConfiguration) => ChatCompletionCapabilities;
  transportFactory?: (guard: () => void, diagnostics?: DiagnosticObserver, proxyKind?: ProxyTargetKind) => typeof fetch;
};
/** What a request for a model may use: the host's per-model limits or the defaults (D134), with an input counter. */
export type ModelBudget = { contextWindowTokens: number; maxOutputTokens: number; counter: ModelTokenCounter };
type Approval = { kind: string; baseUrl: string; revision: string };
const officialCapabilities: ChatCompletionCapabilities = { outputTokenParameter: 'max_completion_tokens', streamUsage: true, listModels: true, authentication: 'models' };
// D135: any compatible service is taken at its word: the common Chat Completions parameter, usage if it sends any, a model list if it has one.
const compatibleCapabilities: ChatCompletionCapabilities = { outputTokenParameter: 'max_tokens', streamUsage: true, listModels: true, authentication: 'models' };
const deepSeekBaseUrl = 'https://api.deepseek.com';
type RegistryCapabilities = Omit<ChatCompletionCapabilities, 'outputTokenParameter'> & { outputTokenParameter: 'max_tokens' | 'max_completion_tokens' | 'maxOutputTokens' | null };
/** D135: a long reply from a slow model must not be cut off; the Run's duration limit is what bounds a discussion. */
const STREAM_TIMEOUT_MS = 600_000;
const nativeTargets = { anthropic: 'https://api.anthropic.com', gemini: 'https://generativelanguage.googleapis.com/v1beta' } as const;

// Main owns target approvals. Renderer/model names cannot supply one.
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
  resolveCapabilities(configuration: ProviderConfiguration): RegistryCapabilities {
    if (configuration.kind === 'anthropic' || configuration.kind === 'gemini') return {
      outputTokenParameter: configuration.kind === 'gemini' ? 'maxOutputTokens' : 'max_tokens',
      streamUsage: true, listModels: true, authentication: 'models',
    };
    if (configuration.kind === 'openai') return officialCapabilities;
    const resolved = this.options.capabilitiesResolver?.(configuration);
    if (resolved) return resolved;
    // D135: DeepSeek's thinking is on by default for every model and would spend the output limit before any text.
    return configuration.baseUrl && new URL(configuration.baseUrl).toString().replace(/\/+$/u, '') === deepSeekBaseUrl
      ? { ...compatibleCapabilities, disableThinking: true } : compatibleCapabilities;
  }
  createTransport(guard: () => void, diagnostics?: DiagnosticObserver, proxyKind?: ProxyTargetKind): typeof fetch {
    return this.options.transportFactory?.(guard, diagnostics, proxyKind) ?? createSafeFetch(guard, undefined, diagnostics, this.options.proxy, proxyKind);
  }
  /** D136: the fixed proxy target of an official origin; any other Provider is refused while a proxy is configured. */
  private proxyKind(configuration: ProviderConfiguration, approval: Approval): ProxyTargetKind | undefined {
    if (!this.options.proxy) return;
    if (configuration.kind === 'anthropic' || configuration.kind === 'gemini') return configuration.kind;
    if (configuration.kind === 'openai') return 'openai';
    if (configuration.kind === 'openai-compatible' && approval.baseUrl === deepSeekBaseUrl) return 'deepseek';
    throw new ContractError('forbidden');
  }

  assertSelection(providerId: string, modelId: string): void {
    const configuration = this.database.validateModelSelection(providerId, modelId);
    if (configuration.kind === 'mock') return;
    this.trusted(providerId);
  }
  /** D114: the confirmed target that a send would use now, or undefined when none is valid. */
  confirmedTarget(id: string): string | undefined {
    try { return this.trusted(id).baseUrl; } catch { return undefined; }
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

  private createRealAdapter(configuration: ProviderConfiguration, approval: Approval, guard: () => void, diagnostics?: DiagnosticObserver,
    onDispatch?: () => void): ProviderAdapter {
    const proxyKind = this.proxyKind(configuration, approval);
    const providerId = configuration.id;
    const safeTransport = this.createTransport(guard, diagnostics, proxyKind);
    const transport = configuration.kind === 'anthropic' || configuration.kind === 'gemini'
      ? createNativeSafeFetch(configuration.kind, safeTransport, guard) : safeTransport;
    const options = { configuration, confirmedBaseUrl: approval.baseUrl, diagnostics, streamTimeoutMs: STREAM_TIMEOUT_MS,
      resolveKey: async (id: string) => {
        guard();
        if (id !== providerId) throw new ContractError('forbidden');
        const state = await this.keys.getProviderKeyState(id); guard();
        const key = state.keyReference ? await this.keys.resolveKey(id, state.keyReference) : undefined;
        guard(); return key;
      },
      // The single path to the network: a request that never reached it provably was not sent.
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
