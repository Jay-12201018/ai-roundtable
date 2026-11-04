// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { CompatibleProvider } from '../../../src/main/providers/compatible/CompatibleProvider';

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function fixture() {
  const db = new Database(':memory:'); db.initialize(); databases.push(db);
  db.createProvider({ id: 'p', name: 'fixture', kind: 'compatible', baseUrl: 'http://127.0.0.1:12345/v1', customModels: [{id:'fixture',name:'fixture'}] });
  const keys = new KeyService(db, createMemoryKeyBackend());
  return { db, keys };
}
const request = { requestId: 'request', modelId:'fixture', outputTokenLimit:8, messages:[{role:'user' as const,content:'hello'}] };
it('registers the actual adapters, never a kind/model-name Mock fallback', () => {
  const {db,keys}=fixture(); const sent=vi.fn(); const read=vi.spyOn(keys,'getProviderKeyState');
  const registry=new ProviderRegistry(db,keys,{transportFactory:()=>sent});
  expect(registry.getAdapter('p')).toBeInstanceOf(CompatibleProvider);
  expect(read).not.toHaveBeenCalled(); expect(sent).not.toHaveBeenCalled();
});
it('invalidates previously created adapters when a key or endpoint changes, before fetch', async () => {
  const {db,keys}=fixture(); await keys.storeKey('p','fake-old');
  const fetch=vi.fn(); const registry=new ProviderRegistry(db,keys,{transportFactory:()=>fetch,capabilitiesResolver:()=>({streamUsage:true,listModels:true,authentication:'models'})}); 
  const adapter=registry.getAdapter('p'); await keys.storeKey('p','fake-new');
  await expect(adapter.listModels({requestId:'req'})).rejects.toMatchObject({code:'forbidden'}); expect(fetch).not.toHaveBeenCalled();
  const second=registry.getAdapter('p');
  db.updateProvider({id:'p',name:'new',kind:'compatible',baseUrl:'http://127.0.0.1:9/v1'});
  await expect(second.listModels({requestId:'req'})).rejects.toMatchObject({code:'forbidden'}); expect(fetch).not.toHaveBeenCalled();
});
it('D134: a saved service can use any model, within the limits that apply to it', () => {
  const {db,keys}=fixture(); const registry=new ProviderRegistry(db,keys); 
  expect(()=>registry.checkGeneration('p',request)).not.toThrow();
  expect(()=>registry.checkGeneration('p',{...request,modelId:'any-other-model'})).not.toThrow();
  expect(()=>registry.checkGeneration('p',{...request,outputTokenLimit:8193})).toThrowError(expect.objectContaining({code:'invalid_input'}));
  db.createProvider({id:'other',name:'other',kind: 'compatible', baseUrl: 'https://service.example/v1'});
  
  expect(()=>registry.checkGeneration('other',request)).not.toThrow();
});
it('D134: a model entry can change its own limits, and a request above them is refused before credentials or network', async () => {
  const {db,keys}=fixture(); const resolve=vi.spyOn(keys,'resolveKey'); const send=vi.fn();
  db.updateProvider({id:'p',name:'fixture',kind:'compatible',baseUrl:'http://127.0.0.1:12345/v1',customModels:[{id:'fixture',name:'fixture',contextWindowTokens:2000,maxOutputTokens:1000}]});
  const registry=new ProviderRegistry(db,keys,{transportFactory:()=>send}); 
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
 const registry=new ProviderRegistry(db,keys,{capabilitiesResolver:()=>({streamUsage:true,listModels:true,authentication:'models'}),transportFactory:()=>fetch});
 expect(()=>registry.assertSelection('p','manual-model')).not.toThrow();
 const chunks=[];for await(const c of registry.getAdapter('p','fixture').streamChat({...request,modelId:'manual-model'}))chunks.push(c);
 expect(chunks.at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});expect(fetch).not.toHaveBeenCalled();
});
