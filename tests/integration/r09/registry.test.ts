// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { OpenAIProvider } from '../../../src/main/providers/openai/OpenAIProvider';
import { OpenAICompatibleProvider } from '../../../src/main/providers/openai-compatible/OpenAICompatibleProvider';

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
const fixturePolicy: ApprovedModelPolicy = {
  evidence: 'local deterministic fixture protocol; not a remote model profile', outputTokenParameter: 'max_tokens', contextWindowTokens: 100000, maxOutputTokens: 4096,
  counter: { modelId: 'fixture', method: 'fixture utf8 bytes plus packet framing; upper bound', kind: 'upper_bound', countMessages: ms => 32 + ms.reduce((n,m) => n + 16 + Buffer.byteLength(m.content),0) },
  price: { inputUsdPerMillion: 0, outputUsdPerMillion: 0, maxRequestUsd: 0, evidence: 'owned loopback fixture has no billable provider' },
};
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'p', name: 'fixture', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:12345/v1', customModels: [{id:'fixture',name:'fixture'}] });
  const keys = new KeyService(db, createMemoryKeyBackend());
  return { db, keys };
}
const request = { requestId: 'request', modelId:'fixture', outputTokenLimit:8, messages:[{role:'user' as const,content:'hello'}] };
function confirm(registry:ProviderRegistry, providerId='p',baseUrl='http://127.0.0.1:12345/v1') {
  return registry.confirmTarget({providerId,baseUrl,confirmed:true});
}
it('registers both actual adapters, never a kind/model-name Mock fallback', () => {
  const {db,keys}=fixture(); const sent=vi.fn(); const read=vi.spyOn(keys,'getProviderKeyState');
  const registry=new ProviderRegistry(db,keys,{transportFactory:()=>sent});
  confirm(registry); expect(registry.getAdapter('p')).toBeInstanceOf(OpenAICompatibleProvider);
  db.createProvider({id:'official',name:'official',kind:'openai'});
  confirm(registry,'official','https://api.openai.com/v1'); expect(registry.getAdapter('official')).toBeInstanceOf(OpenAIProvider);
  db.createProvider({id:'future',name:'future',kind:'anthropic'});
  // Native Anthropic is registered; it still needs an explicit session target approval.
  expect(()=>registry.getAdapter('future')).toThrowError(expect.objectContaining({code:'forbidden'}));
  expect(read).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
});
it('requires an exact Main confirmation; D113 remembers it only for the same Key revision, kind and target', async () => {
  const {db,keys}=fixture(); const registry=new ProviderRegistry(db,keys);
  expect(()=>registry.getAdapter('p')).toThrowError(expect.objectContaining({code:'forbidden'}));
  expect(()=>confirm(registry,'p','http://127.0.0.1:9/v1')).toThrow();
  confirm(registry); expect(()=>registry.getAdapter('p')).not.toThrow();
  // A restarted Main (a new registry over the same database) inherits the persisted confirmation …
  expect(()=>new ProviderRegistry(db,keys).getAdapter('p')).not.toThrow();
  // … until the Key changes: the new revision voids it at once, in every registry.
  await keys.storeKey('p','fake-replacement');
  expect(()=>registry.getAdapter('p')).toThrowError(expect.objectContaining({code:'forbidden'}));
  expect(()=>new ProviderRegistry(db,keys).getAdapter('p')).toThrowError(expect.objectContaining({code:'forbidden'}));
});
it('invalidates previously created adapters when a key or endpoint changes, before fetch', async () => {
  const {db,keys}=fixture(); await keys.storeKey('p','fake-old');
  const fetch=vi.fn(); const registry=new ProviderRegistry(db,keys,{transportFactory:()=>fetch,capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'})}); confirm(registry);
  const adapter=registry.getAdapter('p'); await keys.storeKey('p','fake-new');
  await expect(adapter.listModels({requestId:'req'})).rejects.toMatchObject({code:'forbidden'}); expect(fetch).not.toHaveBeenCalled();
  confirm(registry); const second=registry.getAdapter('p');
  db.updateProvider({id:'p',name:'new',kind:'openai-compatible',baseUrl:'http://127.0.0.1:9/v1'});
  await expect(second.listModels({requestId:'req'})).rejects.toMatchObject({code:'forbidden'}); expect(fetch).not.toHaveBeenCalled();
});
it('refuses unknown real model counters, limits, prices and compatible capabilities before credentials/network', async () => {
  const {db,keys}=fixture(); const resolve=vi.spyOn(keys,'resolveKey'); const fetch=vi.fn();
  const registry=new ProviderRegistry(db,keys,{transportFactory:()=>fetch,capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'})}); confirm(registry);
  for(const modelId of ['fixture','mock']) expect(()=>registry.checkGeneration('p',{...request,modelId})).toThrowError(expect.objectContaining({code:'unsupported'}));
  const chunks=[]; for await(const c of registry.getAdapter('p').streamChat(request)) chunks.push(c);
  expect(chunks.at(-1)).toMatchObject({type:'error',error:{code:'unsupported'}});
  expect(resolve).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it.each([
  {contextWindowTokens:40}, {maxOutputTokens:4}, {counter:{...fixturePolicy.counter,modelId:'other'}},
  {price:{...fixturePolicy.price,inputUsdPerMillion:1,maxRequestUsd:0}}, {price:{...fixturePolicy.price,evidence:''}},
])('rejects unsafe policy/budget %j', change => {
  const {db,keys}=fixture(); const registry=new ProviderRegistry(db,keys,{policyResolver:()=>({...fixturePolicy,...change}),capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:false,listModels:true,authentication:'models'})}); confirm(registry);
  expect(()=>registry.checkGeneration('p',request)).toThrow();
});
it('accepts only a reviewed pair-specific deterministic fixture policy with truthful zero cost', () => {
  const {db,keys}=fixture(); const registry=new ProviderRegistry(db,keys,{policyResolver:(p,m)=>p.id==='p'&&m==='fixture'?fixturePolicy:undefined,capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'})}); confirm(registry);
  expect(()=>registry.checkGeneration('p',request)).not.toThrow();
  expect(()=>registry.checkGeneration('p',{...request,modelId:'mock'})).toThrow();
  db.createProvider({id:'other',name:'other',kind:'openai'}); confirm(registry,'other','https://api.openai.com/v1');
  expect(()=>registry.checkGeneration('other',request)).toThrow();
});

it('binds a selected model to the adapter even if another model also has an approved policy', async () => {
 const {db,keys}=fixture(); const fetch=vi.fn();
 const registry=new ProviderRegistry(db,keys,{policyResolver:(_p,m)=>({...fixturePolicy,counter:{...fixturePolicy.counter,modelId:m}}),capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'}),transportFactory:()=>fetch});confirm(registry);
 expect(()=>registry.assertSelection('p','manual-model')).not.toThrow();
 const chunks=[];for await(const c of registry.getAdapter('p','fixture').streamChat({...request,modelId:'manual-model'}))chunks.push(c);
 expect(chunks.at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});expect(fetch).not.toHaveBeenCalled();
});
