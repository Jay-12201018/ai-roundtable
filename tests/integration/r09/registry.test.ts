// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { OpenAIProvider } from '../../../src/main/providers/openai/OpenAIProvider';
import { OpenAICompatibleProvider } from '../../../src/main/providers/openai-compatible/OpenAICompatibleProvider';

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
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
it('D134: a confirmed service can use any model, within the limits that apply to it', () => {
  const {db,keys}=fixture(); const registry=new ProviderRegistry(db,keys); confirm(registry);
  expect(()=>registry.checkGeneration('p',request)).not.toThrow();
  expect(()=>registry.checkGeneration('p',{...request,modelId:'any-other-model'})).not.toThrow();
  expect(()=>registry.checkGeneration('p',{...request,outputTokenLimit:8193})).toThrowError(expect.objectContaining({code:'invalid_input'}));
  db.createProvider({id:'other',name:'other',kind:'openai'});
  expect(()=>registry.checkGeneration('other',request)).toThrowError(expect.objectContaining({code:'forbidden'}));
  confirm(registry,'other','https://api.openai.com/v1');
  expect(()=>registry.checkGeneration('other',request)).not.toThrow();
});
it('D134: a model entry can change its own limits, and a request above them is refused before credentials or network', async () => {
  const {db,keys}=fixture(); const resolve=vi.spyOn(keys,'resolveKey'); const send=vi.fn();
  db.updateProvider({id:'p',name:'fixture',kind:'openai-compatible',baseUrl:'http://127.0.0.1:12345/v1',customModels:[{id:'fixture',name:'fixture',contextWindowTokens:2000,maxOutputTokens:1000}]});
  const registry=new ProviderRegistry(db,keys,{transportFactory:()=>send}); confirm(registry);
  expect(registry.budget('p','fixture')).toMatchObject({contextWindowTokens:2000,maxOutputTokens:1000});
  expect(registry.budget('p','unlisted')).toMatchObject({contextWindowTokens:128000,maxOutputTokens:8192});
  expect(()=>registry.checkGeneration('p',{...request,outputTokenLimit:1000})).not.toThrow();
  const chunks=[];for await(const c of registry.getAdapter('p','fixture').streamChat({...request,outputTokenLimit:1001}))chunks.push(c);
  expect(chunks.at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});
  const long=[];for await(const c of registry.getAdapter('p','fixture').streamChat({...request,messages:[{role:'user',content:'字'.repeat(1000)}]}))long.push(c);
  expect(long.at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});
  expect(resolve).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
});

it('binds a selected model to the adapter even if another model also has an approved policy', async () => {
 const {db,keys}=fixture(); const fetch=vi.fn();
 const registry=new ProviderRegistry(db,keys,{capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'}),transportFactory:()=>fetch});confirm(registry);
 expect(()=>registry.assertSelection('p','manual-model')).not.toThrow();
 const chunks=[];for await(const c of registry.getAdapter('p','fixture').streamChat({...request,modelId:'manual-model'}))chunks.push(c);
 expect(chunks.at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});expect(fetch).not.toHaveBeenCalled();
});
