export type ProviderMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type StreamChatInput = {
  agentRole: string;
  turnIndex: number;
  messages: ProviderMessage[];
  signal?: AbortSignal;
};

export type NormalizedChunk =
  | { type: 'start'; requestId: string }
  | { type: 'text_delta'; text: string }
  | { type: 'reasoning_summary_delta'; text: string }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'finish'; reason: 'stop' };

export interface ProviderAdapter {
  streamChat(input: StreamChatInput): AsyncIterable<NormalizedChunk>;
}
