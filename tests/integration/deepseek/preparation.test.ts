// @vitest-environment node
import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterEach, expect, it, vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { ProviderRegistry, type ApprovedModelPolicy } from '../../../src/main/providers/ProviderRegistry';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { createSafeFetch } from '../../../src/main/providers/network';
import { deepSeekFlashReview } from '../../../src/main/providers/modelPolicies/deepseekFlash';
import { collect } from '../../unit/providers/openai/fixtures';

const baseUrl = 'https://api.deepseek.com';
const modelId = 'deepseek-flash';
const request = { requestId:'request',modelId,outputTokenLimit:128,messages:[{role:'user' as const,content:'Reply OK.'}] };
const cleanup: Array<()=>unknown|Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const f of cleanup.splice(0).reverse())await f();});
const price = deepSeekFlashReview.price;
function policy(count=100):ApprovedModelPolicy {
 return {evidence:'LOCAL FIXTURE ONLY: synthetic counter is NOT a DeepSeek tokenizer',outputTokenParameter:'max_tokens',contextWindowTokens:1048576,maxInputTokens:1024,maxOutputTokens:128,
  counter:{modelId,kind:'upper_bound',method:'owned fixture protocol only; no production token claim',countMessages:()=>count},price};
}
function fixture(selectedPolicy?:ApprovedModelPolicy) {
 vi.spyOn(Date,'now').mockReturnValue(Date.parse('2026-10-17T12:00:00.000Z'));
 const db=new Database(':memory:');db.initialize();cleanup.push(()=>db.close());
 db.createProvider({id:'deepseek',name:'Display names do not authorize models',kind:'openai-compatible',baseUrl,customModels:[{id:modelId,name:modelId}]});
 const keys=new KeyService(db,createMemoryKeyBackend());const transport=vi.fn<typeof fetch>();
 const registry=new ProviderRegistry(db,keys,{policyResolver:()=>selectedPolicy,transportFactory:()=>transport});
 return {db,keys,registry,transport,confirm:()=>registry.confirmTarget({providerId:'deepseek',baseUrl:db.getProviderConfiguration('deepseek')!.baseUrl!,confirmed:true})};
}
it('selects sourced request parameters only for the exact compatible DeepSeek origin',()=>{
 const f=fixture();const c=f.db.getProviderConfiguration('deepseek')!;
 expect(f.registry.resolveCapabilities(c)).toMatchObject({outputTokenParameter:'max_tokens',streamUsage:true,thinkingDisabledForModel:modelId,listModels:false,authentication:'unsupported'});
 for(const changed of [{baseUrl:baseUrl+'/v1'},{baseUrl:baseUrl+'/beta'},{baseUrl:baseUrl+'.evil.test'},{baseUrl:'https://other.example'},{kind:'mock' as const}]){
  expect(f.registry.resolveCapabilities({...c,...changed})).not.toHaveProperty('thinkingDisabledForModel');
 }
});
it('keeps production generation blocked without a proven full-request counter, before Key access',async()=>{
 const f=fixture();f.confirm();const key=vi.spyOn(f.keys,'getProviderKeyState');const resolve=vi.spyOn(f.keys,'resolveKey');
 const chunks=await collect(f.registry.getAdapter('deepseek').streamChat(request));
 expect(chunks).toMatchObject([{type:'error',error:{code:'unsupported'}}]);expect(key).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
 expect(new ProviderRegistry(f.db,f.keys).resolveModelPolicy(f.db.getProviderConfiguration('deepseek')!,modelId)).toBeUndefined();
});
it('requires session confirmation even when a trusted fixture policy is supplied',()=>{
 const f=fixture(policy());expect(()=>f.registry.checkGeneration('deepseek',request)).toThrowError(expect.objectContaining({code:'forbidden'}));
});
it('accepts an exact CNY budget boundary, rejecting the next input token without USD conversion',()=>{
 const f=fixture({...policy(24996),maxInputTokens:100000});f.confirm();
 expect(()=>f.registry.checkGeneration('deepseek',{...request,outputTokenLimit:1})).not.toThrow();
 const over=new ProviderRegistry(f.db,f.keys,{policyResolver:()=>({...policy(24997),maxInputTokens:100000})});over.confirmTarget({providerId:'deepseek',baseUrl,confirmed:true});
 expect(()=>over.checkGeneration('deepseek',{...request,outputTokenLimit:1})).toThrowError(expect.objectContaining({code:'invalid_input'}));
});
it.each([0.5,-1,NaN,Infinity,Number.MAX_SAFE_INTEGER])('rejects malformed/unsafe CNY price %s',value=>{
 const f=fixture({...policy(),price:{...price,inputMicroCnyPerToken:value}});f.confirm();
 expect(()=>f.registry.checkGeneration('deepseek',request)).toThrow();
});
it.each([
 {reviewedAt:'not-a-date'}, {reviewedAt:'2026-10-19T00:00:00Z'}, {expiresAt:'2026-10-16T00:00:00Z'},
 {expiresAt:'not-a-date'}, {expiresAt:price.reviewedAt}, {evidence:''},
])('rejects unreviewed or expired CNY evidence before Key/network %j',change=>{
 const f=fixture({...policy(),price:{...price,...change}});f.confirm();
 expect(()=>f.registry.checkGeneration('deepseek',request)).toThrowError(expect.objectContaining({code:'unsupported'}));expect(f.transport).not.toHaveBeenCalled();
});
it('rechecks expiration on an already-created adapter before Key reads',async()=>{
 const f=fixture(policy());f.confirm();const adapter=f.registry.getAdapter('deepseek',modelId);const key=vi.spyOn(f.keys,'getProviderKeyState');
 vi.spyOn(Date,'now').mockReturnValue(Date.parse(price.expiresAt));
 expect((await collect(adapter.streamChat(request))).at(-1)).toMatchObject({type:'error',error:{code:'unsupported'}});expect(key).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it.each([{count:1025,output:128},{count:100,output:129}])('enforces small test limits separately from the 1M context %j',({count,output})=>{
 const f=fixture(policy(count));f.confirm();expect(()=>f.registry.checkGeneration('deepseek',{...request,outputTokenLimit:output})).toThrowError(expect.objectContaining({code:'invalid_input'}));
});
it('rejects unknown counts and changed/unknown models before Key/network',async()=>{
 const p=policy();p.counter.countMessages=()=>undefined;const f=fixture(p);f.confirm();const key=vi.spyOn(f.keys,'getProviderKeyState');
 expect(()=>f.registry.checkGeneration('deepseek',request)).toThrow();
 expect(()=>f.registry.checkGeneration('deepseek',{...request,modelId:'deepseek-v4-flash'})).toThrow();
 f.db.updateProvider({id:'deepseek',name:'changed',kind:'openai-compatible',baseUrl:'https://other.example'});
 expect(()=>f.registry.getAdapter('deepseek')).toThrowError(expect.objectContaining({code:'forbidden'}));expect(key).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});

async function localHttp(mode:'ok'|'no-usage'|'hang'|'broken'|400|401|429='ok') {
 const f=fixture(policy());await f.keys.storeKey('deepseek','fake-deepseek-only');f.confirm();
 const calls:Array<{url:string;body:any}>=[];let notify!:()=>void;const partial=new Promise<void>(r=>{notify=r;});
 const server=createServer(async(req,res)=>{
  const buffers=[];for await(const data of req)buffers.push(data);calls.push({url:req.url!,body:JSON.parse(Buffer.concat(buffers).toString())});
  if(typeof mode==='number'){res.writeHead(mode);res.end('untrusted fake-deepseek-only body');return;}
  res.writeHead(200,{'content-type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:'partial OK'},finish_reason:null}]})+'\n\n');notify();
  if(mode==='hang')return;if(mode==='broken'){res.end();return;}
  const usage=mode==='no-usage'?{}:{usage:{prompt_tokens:100,completion_tokens:8,completion_tokens_details:{reasoning_tokens:0},prompt_cache_hit_tokens:0,prompt_cache_miss_tokens:100,total_tokens:108}};
  res.end('data: '+JSON.stringify({choices:[{index:0,delta:{content:''},finish_reason:'stop'}],...usage})+'\n\ndata: [DONE]\n\n');
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const local='http://127.0.0.1:'+(server.address() as {port:number}).port;
 cleanup.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
 const registry=new ProviderRegistry(f.db,f.keys,{policyResolver:()=>policy(),transportFactory:guard=>{
  const safe=createSafeFetch(guard);return ((url,init)=>{expect(new URL(String(url)).origin).toBe(baseUrl);return safe(local+new URL(String(url)).pathname,init);}) as typeof fetch;
 }});registry.confirmTarget({providerId:'deepseek',baseUrl,confirmed:true});
 return {...f,registry,calls,partial};
}
it('sends max_tokens and thinking.disabled through the real SDK/local HTTP body, preserving terminal usage',async()=>{
 const f=await localHttp();const events=await collect(f.registry.getAdapter('deepseek',modelId).streamChat(request));
 expect(f.calls).toHaveLength(1);expect(f.calls[0]).toEqual({url:'/chat/completions',body:{model:modelId,messages:request.messages,stream:true,max_tokens:128,stream_options:{include_usage:true},thinking:{type:'disabled'}}});
 expect(events).toContainEqual({type:'usage',requestId:'request',inputTokens:100,outputTokens:8,cacheHitInputTokens:0});expect(events.at(-1)).toMatchObject({type:'finish',reason:'stop'});
});
it.each(['ok','no-usage','broken',400,401,429] as const)('persists a single Agent attempt for %s without auto retry or invented usage',async mode=>{
 const f=await localHttp(mode);f.db.createRoom({id:'room',name:'One Agent'});f.db.createAgent({id:'one',roomId:'room',displayName:'One',roleTemplateId:'assistant',providerId:'deepseek',modelId});
 const mock=new MockProvider();const mockCall=vi.spyOn(mock,'streamChat');const run=new RunService(f.db,mock,createPublicMessagesBuilder((m,member)=>f.registry.budget(member.providerId!,m!)),f.registry);cleanup.push(()=>run.shutdown());
 const started=await run.start({roomId:'room',task:'Reply OK.',workflowSnapshot:{},maxTurns:1,outputTokenLimit:128});await run.waitForIdle(started.runId);
 const saved=f.db.readRunSnapshot(started.runId);expect(f.calls).toHaveLength(1);expect(saved.attempts).toHaveLength(1);expect(mockCall).not.toHaveBeenCalled();
 expect(saved.run.status).toBe(mode==='ok'||mode==='no-usage'?'completed':'error');
 const usage=run.subscribe(started.runId,0).events.filter(e=>e.type==='usage_updated');expect(usage).toHaveLength(mode==='ok'?1:0);
 if(mode==='broken')expect(saved.messages[0].content).toBe('partial OK');expect(JSON.stringify(saved)).not.toContain('fake-deepseek-only');
});
it.each(['stop','timeout'] as const)('preserves partial text and abort evidence after %s with one request',async action=>{
 const f=await localHttp('hang');f.db.createRoom({id:'room',name:'One Agent'});f.db.createAgent({id:'one',roomId:'room',displayName:'One',roleTemplateId:'assistant',providerId:'deepseek',modelId});
 const run=new RunService(f.db,new MockProvider(),createPublicMessagesBuilder((m,member)=>f.registry.budget(member.providerId!,m!)),f.registry);cleanup.push(()=>run.shutdown());
 const started=await run.start({roomId:'room',task:'Reply OK.',workflowSnapshot:{},maxTurns:1,outputTokenLimit:128,maxDurationMs:action==='timeout'?300:10000});
 await f.partial;if(action==='stop'){await new Promise(r=>setTimeout(r,25));await run.stop(started.runId);}await run.waitForIdle(started.runId);
 const saved=f.db.readRunSnapshot(started.runId);expect(saved.messages[0].content).toBe('partial OK');expect(saved.attempts[0].status).toBe('aborted');expect(f.calls).toHaveLength(1);expect(run.hasActiveRuns()).toBe(false);
});

it('stores the reviewed limits and CNY units without claiming an approved tokenizer',()=>{
 expect(deepSeekFlashReview).toMatchObject({modelId,modelVersion:'DeepSeek-V4.1-Flash-1017',documentedContext:'1M',documentedMaxOutputTokens:393216,testMaxInputTokens:1024,testMaxOutputTokens:128,generationBlockedReason:'full_request_token_bound_unverified'});
 expect(price).toMatchObject({currency:'CNY',inputMicroCnyPerToken:2,outputMicroCnyPerToken:8,maxRequestMicroCny:50000});
 expect((1024*price.inputMicroCnyPerToken+128*price.outputMicroCnyPerToken)/1000000).toBe(0.003072);
});
it('refuses an over-budget stream before key resolution and transport',async()=>{
 const f=fixture({...policy(24997),maxInputTokens:100000});f.confirm();const key=vi.spyOn(f.keys,'getProviderKeyState');const resolve=vi.spyOn(f.keys,'resolveKey');
 expect((await collect(f.registry.getAdapter('deepseek',modelId).streamChat({...request,outputTokenLimit:1}))).at(-1)).toMatchObject({type:'error',error:{code:'invalid_input'}});
 expect(key).not.toHaveBeenCalled();expect(resolve).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('does not open model listing or authentication as a side effect of parameter preparation',async()=>{
 const f=fixture();f.confirm();const key=vi.spyOn(f.keys,'getProviderKeyState');const adapter=f.registry.getAdapter('deepseek');
 await expect(adapter.listModels({requestId:'list'})).rejects.toMatchObject({code:'unsupported'});
 expect(await adapter.testConnection({requestId:'auth',level:'authentication'})).toMatchObject({ok:false,error:{code:'unsupported'}});
 expect(key).not.toHaveBeenCalled();expect(f.transport).not.toHaveBeenCalled();
});
it('does not attach DeepSeek thinking parameters to another compatible provider',async()=>{
 const f=await localHttp();f.db.updateProvider({id:'deepseek',name:'other',kind:'openai-compatible',baseUrl:'https://other.example'});
 const transport=vi.fn<typeof fetch>(async()=>new Response('data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}}));
 const registry=new ProviderRegistry(f.db,f.keys,{policyResolver:()=>policy(),capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:false,authentication:'unsupported'}),transportFactory:()=>transport});
 await f.keys.storeKey('deepseek','fake-other');registry.confirmTarget({providerId:'deepseek',baseUrl:'https://other.example',confirmed:true});
 await collect(registry.getAdapter('deepseek',modelId).streamChat(request));expect(transport).toHaveBeenCalledTimes(1);
 expect(JSON.parse(String(transport.mock.calls[0][1]?.body))).not.toHaveProperty('thinking');
});
