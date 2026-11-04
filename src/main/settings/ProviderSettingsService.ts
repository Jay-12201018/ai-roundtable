import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { Database } from '../database/Database';
import type { KeyService } from '../security/KeyService';
import { MockProvider } from '../providers/mock/MockProvider';
import type { ProviderRegistry } from '../providers/ProviderRegistry';
import { ContractError, toPublicError } from '../../shared/contracts/errors';
import { providerSettingsContracts, type ProviderSettingsApiContract } from '../../shared/contracts/configuration';
import * as schemas from '../../shared/schemas/configuration';
import { modelLimits } from '../../shared/schemas/provider';
import type {
  ConfigurationIdInput, CreateProviderInput, ProviderInput, ProviderIdInput,
  ProviderModelsInput, ProviderConnectionTestInput, SetProviderKeyInput, ProviderConfiguration,
} from '../../shared/contracts/configuration';

function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ContractError('invalid_input');
  return parsed.data;
}

/** Main-only service. Production IPC registration and adapter resolution belong to integration. */
export class ProviderSettingsService implements ProviderSettingsApiContract {
  private readonly mock = new MockProvider();

  constructor(private readonly database: Database, private readonly keys: KeyService, private readonly runtime?: ProviderRegistry) {}

  private async perform<T>(work: () => T | Promise<T>): Promise<T> {
    try { return await work(); }
    catch (error) { throw new ContractError(toPublicError(error).code); }
  }

  async createProvider(input: CreateProviderInput) {
    return this.perform(() => {
      const parsed = parseInput(schemas.createProviderInputSchema, input);
      return providerSettingsContracts.createProvider.output.parse(this.database.createProvider({ ...parsed, id: randomUUID() }));
    });
  }

  async updateProvider(input: ProviderInput) {
    return this.perform(() => {
      const parsed = parseInput(schemas.providerInputSchema, input);
      return providerSettingsContracts.updateProvider.output.parse(this.database.updateProvider(parsed));
    });
  }

  async getProviderConfiguration(input: ConfigurationIdInput) {
    return this.perform(() => {
      const { id } = parseInput(schemas.configurationIdInputSchema, input);
      const provider = this.database.getProviderConfiguration(id);
      if (!provider) throw new ContractError('not_found');
      return providerSettingsContracts.getProviderConfiguration.output.parse(provider);
    });
  }

  async listProviderSummaries() {
    return this.perform(() => providerSettingsContracts.listProviderSummaries.output.parse(this.database.listProviderSummaries()));
  }

  async deleteProvider(input: ConfigurationIdInput): Promise<void> {
    return this.perform(() => this.keys.deleteProvider(parseInput(schemas.configurationIdInputSchema, input).id));
  }

  async setKey(input: SetProviderKeyInput) {
    return this.perform(async () => {
      const { providerId, apiKey } = parseInput(schemas.setProviderKeyInputSchema, input);
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
        const ids = mock ? ['mock'] : [...new Set([configuration?.defaultModelId, ...(configuration?.customModels ?? []).map(model => model.id)].filter((id): id is string => Boolean(id)))];
        const key = mock || !configuration ? undefined : await this.keys.getProviderKeyState(summary.id);
        const keyUsable = key?.state === 'configured' || key?.state === 'session';
        result.push({ providerId: summary.id, keyState: key?.state ?? 'none', baseUrl: (configuration && registry.targetOf(configuration)) ?? null,
          models: ids.map(modelId => {
            const blockedBy = !configuration ? 'invalid' as const : !summary.enabled ? 'disabled' as const : mock ? null
              : !keyUsable ? 'key' as const : null;
            return { modelId, ...(configuration ? registry.limits(configuration, modelId) : modelLimits()), usable: blockedBy === null, blockedBy };
          }) });
      }
      return schemas.providerReadinessListSchema.parse(result);
    });
  }

  async listModels(input: ProviderModelsInput) {
    return this.perform(async () => {
      const { providerId } = parseInput(schemas.providerModelsInputSchema, input);
      const provider = await this.getProviderConfiguration({ id: providerId });
      if (!provider.enabled) throw new ContractError('invalid_state');
      if (provider.kind !== 'mock' && !this.runtime) throw new ContractError('unsupported');
      const adapter = provider.kind === 'mock' ? this.mock : this.runtime!.getAdapter(providerId);
      return providerSettingsContracts.listModels.output.parse({ providerId, models: await adapter.listModels({ requestId: randomUUID() }) });
    });
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
