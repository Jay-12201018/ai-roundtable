import type { ProviderMessage } from '../types';
import type { ModelTokenCounter } from '../../context/types';
import { IMAGE_INPUT_TOKENS, messageImagesOf, messageTextOf } from '../../../shared/schemas/provider';

// Test-model vocabulary only: each text token has at most four Unicode scalars.
export function mockTextTokens(text:string):string[]{
  const scalars=Array.from(text);const tokens:string[]=[];
  for(let index=0;index<scalars.length;index+=4)tokens.push(scalars.slice(index,index+4).join(''));
  return tokens;
}
// Request start/end; each message has start, role, content separator and end tokens.
export function countMockInputTokens(messages:readonly Readonly<ProviderMessage>[]):number{
  return 2+messages.reduce((total,message)=>total+4+mockTextTokens(messageTextOf(message.content)).length+messageImagesOf(message.content).length*IMAGE_INPUT_TOKENS,0);
}
export const mockModelBudget:{contextWindowTokens:number;counter:ModelTokenCounter}={
  contextWindowTokens:32768,
  counter:{modelId:'mock',method:'mock packet vocabulary v1 (four scalar text tokens + explicit framing); test model only',kind:'exact',countMessages:countMockInputTokens},
};
