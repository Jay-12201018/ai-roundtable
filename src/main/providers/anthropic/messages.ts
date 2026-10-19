import type { ProviderMessage } from '../types';
import { ContractError } from '../../../shared/contracts/errors';

/** For Main model policies to count the exact Anthropic request framing. */
export function buildAnthropicMessages(input: readonly ProviderMessage[]) {
  const system: Array<{ type: 'text'; text: string }> = [];
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  for (const message of input) {
    if (message.role === 'system') {
      if (messages.length) throw new ContractError('unsupported');
      if (message.content) system.push({ type: 'text', text: message.content });
    } else messages.push({ role: message.role, content: message.content });
  }
  if (!messages.length || messages.some(message => !message.content.trim())) throw new ContractError('invalid_input');
  if (messages[0].role !== 'user') throw new ContractError('unsupported');
  // A prior Agent's answer must not become a prefill of the current Agent's answer.
  if (messages.at(-1)!.role === 'assistant') messages.push({ role: 'user', content: 'Respond to the public discussion above as the current agent.' });
  return { ...(system.length ? { system } : {}), messages };
}
