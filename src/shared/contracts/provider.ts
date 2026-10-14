import type { z } from 'zod';
import type * as schemas from '../schemas/provider';

export type ProviderMessage = z.infer<typeof schemas.providerMessageSchema>;
export type ProviderModel = z.infer<typeof schemas.providerModelSchema>;
export type ListModelsInput = z.infer<typeof schemas.listModelsInputSchema> & { signal?: AbortSignal };
export type TestConnectionInput = z.infer<typeof schemas.testConnectionInputSchema> & { signal?: AbortSignal };
export type ConnectionTestResult = z.infer<typeof schemas.connectionTestResultSchema>;
export type StreamChatInput = z.infer<typeof schemas.streamChatInputSchema> & { signal?: AbortSignal };
export type NormalizedChunk = z.infer<typeof schemas.normalizedChunkSchema>;

export interface ProviderAdapter {
  listModels(input: ListModelsInput): Promise<ProviderModel[]>;
  testConnection(input: TestConnectionInput): Promise<ConnectionTestResult>;
  streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk>;
}
