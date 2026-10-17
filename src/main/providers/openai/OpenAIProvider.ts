import { ChatCompletionProvider, type ChatCompletionOptions } from './ChatCompletionProvider';

export class OpenAIProvider extends ChatCompletionProvider {
  constructor(options: ChatCompletionOptions) {
    super(options, 'openai', { outputTokenParameter: 'max_completion_tokens', streamUsage: true, listModels: true, authentication: 'models' });
  }
}
