// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { mockTextTokens,countMockInputTokens,mockModelBudget } from '../../../src/main/providers/mock/tokenBudget';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { countModelTokens } from '../../../src/main/context/buildPublicContext';

describe('mock-only vocabulary and framing',()=>{
  it('counts the declared request tokens including roles, framing, newlines and Unicode scalars',()=>{
    expect(mockTextTokens('ab😀\n界')).toEqual(['ab😀\n','界']);expect(countMockInputTokens([])).toBe(2);
    expect(countMockInputTokens([{role:'user',content:''}])).toBe(6);
    expect(countMockInputTokens([{role:'system',content:'a'},{role:'user',content:''},{role:'assistant',content:'ab😀\n界'}])).toBe(17);
    expect(countModelTokens([{role:'user',content:'text'}],'real-model',mockModelBudget.counter)).toBeUndefined();
  });
  it('uses that same model count in the actual Mock usage frame',async()=>{
    const messages=[{role:'user' as const,content:'😀\n中文测试 packet'}];const chunks=[];
    for await(const c of new MockProvider().streamChat({requestId:'count',modelId:'mock',messages,outputTokenLimit:1}))chunks.push(c);
    expect(chunks.find(c=>c.type==='usage')).toMatchObject({inputTokens:countMockInputTokens(messages),outputTokens:1});
    expect(chunks.at(-1)).toMatchObject({type:'finish',reason:'length'});
  });
});
