import { ChatCompletionProvider, type ChatCompletionOptions, type ChatCompletionCapabilities } from '../openai/ChatCompletionProvider';

export class OpenAICompatibleProvider extends ChatCompletionProvider {
  constructor(options: ChatCompletionOptions & { capabilities: ChatCompletionCapabilities }) {
    super(options, 'openai-compatible', options.capabilities);
  }
}
