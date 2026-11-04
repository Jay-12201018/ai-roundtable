import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Database, ModelDiscovery } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import { MockProvider } from '../providers/mock/MockProvider';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { providerSettingsContracts, type ProviderSettingsApiContract } from '../../shared/contracts/configuration';
import * as schemas from '../../shared/schemas/configuration';
import { modelLimits } from '../../shared/schemas/provider';
import { catalogHas, catalogServiceAt, discoverable, modelAllowed, serviceCatalog, type CatalogService } from '../../shared/serviceCatalog';
import { modelIdSchema } from '../../shared/schemas/common';
import type {
  ConfigurationIdInput, CreateProviderInput, ProviderInput, ProviderIdInput,
  ProviderConnectionTestInput, SetProviderKeyInput, ProviderConfiguration, RefreshModelsInput,
} from '../../shared/contracts/configuration';

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ContractError('invalid_input');
  return parsed.data;
}

/** Main-only service. Production IPC registration and adapter resolution belong to integration. */
const MODEL_LIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;
type ModelDiscoveryOutcome = ModelDiscovery['outcome'];

export class ProviderSettingsService implements ProviderSettingsApiContract {
  private readonly mock = new MockProvider();

  constructor(private readonly database: Database, private readonly keys: KeyService, private readonly runtime?: ProviderRegistry) {}

  private async perform<T>(work: () => T | Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { throw new ContractError(toPublicError(error).code); }
  }

  private catalog(): readonly CatalogService[] { return this.runtime?.catalog() ?? serviceCatalog; }

  /** D143: a service is saved only as the catalog has it. A stopped one outside it may keep its name, and nothing else. */
  private assertInCatalog(next: { kind: string; baseUrl: string | null; enabled: boolean; defaultModelId: string | null; customModels: Array<{ id: string }> }, previous?: ProviderConfiguration) {
    if (next.kind === 'mock') return;
    const service = catalogServiceAt(this.catalog(), next.baseUrl);
    if (!service) {
      const unchanged = previous && !next.enabled && previous.baseUrl === next.baseUrl && previous.defaultModelId === next.defaultModelId
        && previous.customModels.length === next.customModels.length && previous.customModels.every((model, index) => model.id === next.customModels[index]?.id);
      if (!unchanged) throw new ContractError('service_unsupported');
      return;
    }
    const listed = previous ? this.listed(previous.id) : [];
    for (const id of [next.defaultModelId, ...next.customModels.map(model => model.id)]) if (id !== null && !modelAllowed(service, id, listed)) throw new ContractError('model_unsupported');
  }

  private listed(providerId: string): string[] { return this.database.getModelDiscovery(providerId)?.modelIds ?? []; }

  /** D143: what the page sees of a catalog service: the catalog's models, then what the service's own list added, with the limits the host set. */
  private withCatalog<T extends { id: string; kind: ProviderConfiguration['kind'] | null; defaultModelId: string | null; customModels: ProviderConfiguration['customModels'] }>(provider: T, baseUrl: string | null | undefined): T {
    const service = provider.kind === 'mock' ? undefined : catalogServiceAt(this.catalog(), baseUrl);
    if (!service) return provider;
    const listed = this.listed(provider.id);
    const added = listed.filter(id => !catalogHas(service, id) && discoverable(service, id)).map(id => ({ id, name: id }));
    return { ...provider, defaultModelId: provider.defaultModelId && modelAllowed(service, provider.defaultModelId, listed) ? provider.defaultModelId : null,
      customModels: [...service.models, ...added].map(model => ({ ...provider.customModels.find(item => item.id === model.id), id: model.id, name: model.name })) };
  }

  async createProvider(input: CreateProviderInput) {
    return this.perform(() => {
      const parsed = parseInput(schemas.createProviderInputSchema, input);
      this.assertInCatalog(parsed);
      return providerSettingsContracts.createProvider.output.parse(this.database.createProvider({ ...parsed, id: randomUUID() }));
    });
  }

  async updateProvider(input: ProviderInput) {
    return this.perform(() => {
      const parsed = parseInput(schemas.providerInputSchema, input);
      const previous = this.database.getProviderConfiguration(parsed.id);
      this.assertInCatalog(parsed, previous);
      if (previous && previous.baseUrl !== parsed.baseUrl) this.database.clearModelDiscovery(parsed.id);
      return providerSettingsContracts.updateProvider.output.parse(this.database.updateProvider(parsed));
    });
  }

  async getProviderConfiguration(input: ConfigurationIdInput) {
    return this.perform(() => {
      const { id } = parseInput(schemas.configurationIdInputSchema, input);
      const provider = this.database.getProviderConfiguration(id);
      if (!provider) throw new ContractError('not_found');
      return providerSettingsContracts.getProviderConfiguration.output.parse(this.withCatalog(provider, provider.baseUrl));
    });
  }

  async listProviderSummaries() {
    return this.perform(() => providerSettingsContracts.listProviderSummaries.output.parse(this.database.listProviderSummaries()
      .map(summary => summary.configurationValid ? this.withCatalog(summary, this.database.getProviderConfiguration(summary.id)?.baseUrl) : summary)));
  }

  async deleteProvider(input: ConfigurationIdInput): Promise<void> {
    return this.perform(() => this.keys.deleteProvider(parseInput(schemas.configurationIdInputSchema, input).id));
  }

  async setKey(input: SetProviderKeyInput) {
    return this.perform(async () => {
      const { providerId, apiKey } = parseInput(schemas.setProviderKeyInputSchema, input);
      const provider = this.database.getProviderConfiguration(providerId);
      if (provider && provider.kind !== 'mock' && !catalogServiceAt(this.catalog(), provider.baseUrl)) throw new ContractError('service_unsupported');
      await this.keys.storeKey(providerId, apiKey);
      return providerSettingsContracts.setKey.output.parse(await this.keys.getProviderKeyState(providerId));
    });
  }

  async deleteKey(input: ProviderIdInput): Promise<void> {
    return this.perform(() => this.keys.deleteKey(parseInput(schemas.providerIdInputSchema, input).providerId));
  }

  async getProviderKeyState(input: ProviderIdInput) {
    return this.perform(async () => {
      const { providerId } = parseInput(schemas.providerIdInputSchema, input);
      const state = await this.keys.getProviderKeyState(providerId);
      return providerSettingsContracts.getProviderKeyState.output.parse(state);
    });
  }

  async getKeyStorageStatus() {
    return this.perform(async () => providerSettingsContracts.getKeyStorageStatus.output.parse(await this.keys.getStatus()));
  }

  /** D114: for each Provider and configured model, the first reason a send would be refused now, as Main decides it. */
  async listModelReadiness() {
    return this.perform(async () => {
      if (!this.runtime) throw new ContractError('unsupported');
      const registry = this.runtime;
      const summaries = this.database.listProviderSummaries();
      const result = [];
      for (const summary of summaries) {
        let configuration: ProviderConfiguration | undefined;
        try { configuration = this.database.getProviderConfiguration(summary.id); } catch { configuration = undefined; }
        const mock = configuration?.kind === 'mock';
        const service = mock ? undefined : catalogServiceAt(this.catalog(), configuration?.baseUrl);
        const discovery = mock || !service ? undefined : this.database.getModelDiscovery(summary.id);
        const added = service ? (discovery?.modelIds ?? []).filter(id => !catalogHas(service, id) && discoverable(service, id)) : [];
        const ids = mock ? ['mock'] : [...new Set([...(service?.models ?? []).map(model => model.id), ...added, configuration?.defaultModelId, ...(configuration?.customModels ?? []).map(model => model.id)].filter((id): id is string => Boolean(id)))];
        const key = mock || !configuration ? undefined : await this.keys.getProviderKeyState(summary.id);
        const keyUsable = key?.state === 'configured' || key?.state === 'session';
        result.push({ providerId: summary.id, keyState: key?.state ?? 'none', supported: mock || Boolean(service), discovery: discovery ? { outcome: discovery.outcome, checkedAt: discovery.checkedAt } : null, baseUrl: (configuration && registry.targetOf(configuration)) ?? null,
          models: ids.map(modelId => {
            const blockedBy = !configuration ? 'invalid' as const : !summary.enabled ? 'disabled' as const : mock ? null
              : !service || !modelAllowed(service, modelId, discovery?.modelIds ?? []) ? 'unsupported' as const : !keyUsable ? 'key' as const : null;
            return { modelId, ...(configuration ? registry.limits(configuration, modelId) : modelLimits()), usable: blockedBy === null, blockedBy,
              ...(discovery?.listedAt && !discovery.modelIds.includes(modelId) ? { delisted: true } : {}) };
          }) });
      }
      return schemas.providerReadinessListSchema.parse(result);
    });
  }

  private readonly refreshing = new Map<string, Promise<ModelDiscoveryOutcome>>();

  /** D143: asks the service at its catalog address for its model list, at most once a day unless the host asks. Nothing is generated; a failure leaves what was known. */
  async refreshModels(input: RefreshModelsInput) {
    return this.perform(async () => {
      const { providerId, force } = parseInput(schemas.refreshModelsInputSchema, input);
      const provider = this.database.getProviderConfiguration(providerId);
      if (!provider) throw new ContractError('not_found');
      const service = provider.kind === 'mock' ? undefined : catalogServiceAt(this.catalog(), provider.baseUrl);
      const skipped = () => schemas.refreshModelsResultSchema.parse({ providerId, outcome: 'skipped' });
      if (!this.runtime || !service || !provider.enabled) return skipped();
      const last = this.database.getModelDiscovery(providerId);
      if (!force && last && Date.now() - Date.parse(last.checkedAt) < MODEL_LIST_MAX_AGE_MS) return skipped();
      const key = await this.keys.getProviderKeyState(providerId);
      if (key.state !== 'configured' && key.state !== 'session') return skipped();
      let pending = this.refreshing.get(providerId);
      if (!pending) {
        pending = this.lookAtModelList(providerId, service).finally(() => this.refreshing.delete(providerId));
        this.refreshing.set(providerId, pending);
      }
      return schemas.refreshModelsResultSchema.parse({ providerId, outcome: await pending });
    });
  }
  private async lookAtModelList(providerId: string, service: CatalogService): Promise<ModelDiscoveryOutcome> {
    try {
      const ids = await this.runtime!.listModels(providerId, randomUUID());
      const kept = ids.filter(id => modelIdSchema.safeParse(id).success && (catalogHas(service, id) || discoverable(service, id))).slice(0, 200);
      // An empty answer says nothing about what can be used; it does not make every model look retired.
      if (kept.length === 0) { this.database.saveModelDiscovery(providerId, 'unsupported'); return 'unsupported'; }
      this.database.saveModelDiscovery(providerId, 'listed', kept);
      return 'listed';
    } catch (error) {
      const { code } = toPublicError(error);
      const outcome: ModelDiscoveryOutcome = code === 'not_found' || code === 'unsupported' || code === 'forbidden' ? 'unsupported' : code === 'authentication_failed' ? 'authentication_failed' : 'failed';
      this.database.saveModelDiscovery(providerId, outcome);
      return outcome;
    }
  }

  async testConnection(input: ProviderConnectionTestInput) {
    return this.perform(async () => {
      const { providerId, level, modelId, allowGeneration } = parseInput(schemas.providerConnectionTestInputSchema, input);
      const requestId = randomUUID();
      try {
        const provider = await this.getProviderConfiguration({ id: providerId });
        if (!provider.enabled) throw new ContractError('invalid_state');
        if (provider.kind === 'compatible' && provider.baseUrl === null) throw new ContractError('invalid_input');
        if (modelId !== undefined) this.database.validateModelSelection(providerId, modelId);
        if (provider.kind === 'mock') {
          return schemas.providerConnectionTestResultSchema.parse({ providerId, result: await this.mock.testConnection({ requestId, level, ...(modelId === undefined ? {} : { modelId }) }) });
        }
        if (level === 'configuration') {
          this.runtime?.validateConfiguration(providerId);
          return schemas.providerConnectionTestResultSchema.parse({ providerId, result: { requestId, level, ok: true } });
        }
        if (!this.runtime) throw new ContractError('unsupported');
        if (level === 'generation') {
          if (allowGeneration !== true) throw new ContractError('forbidden');
          this.runtime.checkGeneration(providerId, { requestId, modelId: modelId!, messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 8 });
        }
        const adapter = this.runtime.getAdapter(providerId, level === 'generation' ? modelId : undefined);
        return schemas.providerConnectionTestResultSchema.parse({ providerId, result: await adapter.testConnection({ requestId, level, ...(modelId === undefined ? {} : { modelId }) }) });
      } catch (error) {
        return schemas.providerConnectionTestResultSchema.parse({ providerId, result: { requestId, level, ok: false, error: toPublicError(error) } });
      }
    });
  }
}
