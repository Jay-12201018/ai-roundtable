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

const cleanup: Array<()=>Promise<unknown>|unknown> = [];
afterEach(async()=>{for(const f of cleanup.splice(0).reverse()) await f();});
const policy:ApprovedModelPolicy={evidence:'owned local fixture',outputTokenParameter:'max_tokens',contextWindowTokens:100000,maxOutputTokens:4096,
 counter:{modelId:'fixture',kind:'upper_bound',method:'fixture packet UTF8 bound',countMessages:ms=>32+ms.reduce((n,m)=>n+16+Buffer.byteLength(m.content),0)},
 price:{inputUsdPerMillion:0,outputUsdPerMillion:0,maxRequestUsd:0,evidence:'owned fixture is free'}};
async function fixture(mode:'normal'|'hang'|'broken'|'length'='normal'){
 const calls:Array<{path:string;key:string|undefined;body:any}>=[];
 let notify!:()=>void; const partial=new Promise<void>(r=>{notify=r;});
 const server=createServer(async(req,res)=>{
  const buffers=[]; for await(const data of req)buffers.push(data);
  const body=JSON.parse(Buffer.concat(buffers).toString()); calls.push({path:req.url!,key:req.headers.authorization,body});
  res.writeHead(200,{'content-type':'text/event-stream'});
  const emit=(v:unknown)=>res.write(`data: ${JSON.stringify(v)}\n\n`);
  emit({id:`http-${calls.length}`,choices:[{index:0,delta:{content:`public-${calls.length}`},finish_reason:null}]});
  if(mode==='hang'){notify();return;}
  if(mode==='broken'){res.end();return;}
  emit({id:`http-${calls.length}`,choices:[{index:0,delta:{},finish_reason:mode==='length'?'length':'stop'}]});
  emit({id:`http-${calls.length}`,choices:[],usage:{prompt_tokens:40,completion_tokens:4}});res.end('data: [DONE]\n\n');
 });
 server.listen(0,'127.0.0.1'); await once(server,'listening');
 const port=(server.address() as {port:number}).port;
 cleanup.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
 const db=new Database(':memory:');db.initialize();cleanup.push(()=>db.close());
 db.createRoom({id:'room',name:'Room'});
 db.createProvider({id:'p',name:'local',kind:'openai-compatible',baseUrl:`http://127.0.0.1:${port}/v1`,customModels:[{id:'fixture',name:'fixture'}]});
 const keys=new KeyService(db,createMemoryKeyBackend());await keys.storeKey('p','fake-p');
 const registry=new ProviderRegistry(db,keys,{policyResolver:(_p,m)=>m==='fixture'?policy:undefined,capabilitiesResolver:()=>({outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'})});
 registry.confirmTarget({providerId:'p',baseUrl:`http://127.0.0.1:${port}/v1`,confirmed:true});
 for(let i=0;i<3;i++)db.createAgent({id:`a${i}`,roomId:'room',displayName:`Agent${i}`,roleTemplateId:`Role${i}`,systemPrompt:`System${i}`,providerId:'p',modelId:'fixture',displayOrder:i});
 const mock=new MockProvider(); const mockCall=vi.spyOn(mock,'streamChat');
 const run=new RunService(db,mock,createPublicMessagesBuilder((model,member)=>member.providerId?registry.budget(member.providerId,model!):undefined),registry);cleanup.push(()=>run.shutdown());
 return {db,run,registry,calls,partial,mockCall,keys};
}
const input={roomId:'room',task:'common task',workflowSnapshot:{},maxTurns:3,outputTokenLimit:32};
it('routes three frozen members to actual HTTP, with public context, systems, output limits, usage and Attempt identities',async()=>{
 const f=await fixture(); const start=await f.run.start(input);await f.run.waitForIdle(start.runId);
 expect(f.run.getSnapshot(start.runId).status).toBe('completed');expect(f.calls).toHaveLength(3);expect(f.mockCall).not.toHaveBeenCalled();
 const snapshot=f.db.readRunSnapshot(start.runId);
 expect(snapshot.attempts).toHaveLength(3);expect(snapshot.attempts.every(a=>a.status==='completed')).toBe(true);
 for(let i=0;i<3;i++){
  const attempt=snapshot.attempts.find(a=>a.turnId===snapshot.turns[i].id)!;
  expect(f.calls[i].path).toBe('/v1/chat/completions');expect(f.calls[i].key).toBe('Bearer fake-p');
  expect(f.calls[i].body).toMatchObject({model:'fixture',stream:true,max_tokens:32});
  expect(f.calls[i].body.messages).toEqual(attempt.inputSnapshot!.messages);
  expect(JSON.stringify(f.calls[i].body.messages)).toContain(`System${i}`);
  for(let j=0;j<i;j++)expect(JSON.stringify(f.calls[i].body.messages)).toContain(`public-${j+1}`);
  expect(attempt.providerRequestId).toBeNull();
  expect(attempt.requestId).toBe(snapshot.turns[i].requestId);
 }
 expect(f.run.subscribe(start.runId,0).events.filter(e=>e.type==='usage_updated')).toHaveLength(3);
 expect(JSON.stringify(snapshot)).not.toContain('fake-p');
});
it('aborts a hanging HTTP stream on Stop and preserves partial text/Attempt without automatic resending',async()=>{
 const f=await fixture('hang'); const start=await f.run.start(input);await f.partial;
 await new Promise(r=>setTimeout(r,30));await f.run.stop(start.runId);await f.run.waitForIdle(start.runId);
 const saved=f.db.readRunSnapshot(start.runId);
 expect(saved.run.status).toBe('cancelled');expect(saved.messages[0].content).toBe('public-1');expect(saved.attempts[0].status).toBe('aborted');
 expect(f.calls).toHaveLength(1);expect(f.run.hasActiveRuns()).toBe(false);
});
it.each(['broken','length'] as const)('retains partial/error evidence without retrying %s',async mode=>{
 const f=await fixture(mode);const start=await f.run.start(input);await f.run.waitForIdle(start.runId);
 const saved=f.db.readRunSnapshot(start.runId);expect(saved.run.status).toBe('error');expect(saved.messages[0].content).toBe('public-1');expect(saved.attempts[0].status).toBe('failed');expect(f.calls).toHaveLength(1);
});
it('deadline aborts real transport and persisted partial output survives',async()=>{
 const f=await fixture('hang');const start=await f.run.start({...input,maxDurationMs:500});await f.run.waitForIdle(start.runId);
 const saved=f.db.readRunSnapshot(start.runId);expect(saved.run.status).toBe('error');expect(saved.messages[0].content).toBe('public-1');expect(saved.attempts[0].status).toBe('aborted');expect(f.calls).toHaveLength(1);
});
it('pause/resume keeps public history and never changes frozen member identity',async()=>{
 const f=await fixture();const start=await f.run.start({...input,mode:'step'});await f.run.waitForIdle(start.runId);
 expect(f.run.getSnapshot(start.runId).status).toBe('paused');await f.run.step(start.runId);expect(f.run.getSnapshot(start.runId).status).toBe('paused');
 await f.run.resumeRun(start.runId);await f.run.waitForIdle(start.runId);expect(f.run.getSnapshot(start.runId).status).toBe('completed');expect(f.calls).toHaveLength(3);
});
it('requires renewed confirmation after Key replacement before an explicit retry; original paid-attempt evidence is immutable',async()=>{
 const f=await fixture('broken');const start=await f.run.start(input);await f.run.waitForIdle(start.runId);
 const before=f.db.readRunSnapshot(start.runId);await f.keys.storeKey('p','fake-replacement');
 await expect(f.run.retryTurn(start.runId,before.turns[0].id)).rejects.toMatchObject({code:'forbidden'});
 expect(f.calls).toHaveLength(1);expect(f.db.readRunSnapshot(start.runId)).toEqual(before);
 const baseUrl=f.db.getProviderConfiguration('p')!.baseUrl!;f.registry.confirmTarget({providerId:'p',baseUrl,confirmed:true});
 await f.run.retryTurn(start.runId,before.turns[0].id);
 const after=f.db.readRunSnapshot(start.runId);expect(f.calls).toHaveLength(2);expect(f.calls[1].key).toBe('Bearer fake-replacement');
 expect(after.attempts[0]).toEqual(before.attempts[0]);expect(after.messages[0]).toEqual(before.messages[0]);expect(after.attempts[1].inputSnapshot!.messages).toEqual(before.attempts[0].inputSnapshot!.messages);
});
it('recovery never auto-sends: an explicit interrupted decision alone schedules remaining real fixture turns',async()=>{
 const f=await fixture();const members=f.db.listAgents('room',(p,m)=>f.registry.assertSelection(p,m)).map(({id,roomId:_roomId,...member})=>({...member,agentId:id}));
 f.db.insertRun({id:'interrupted',roomId:'room',status:'running',workflowSnapshot:{},task:'recover fixture',membersSnapshot:members,nextTurnIndex:0,elapsedExecutionMs:0,maxTurns:3,outputTokenLimit:32});
 f.db.markInFlightRunsInterrupted();expect(f.db.getRun('interrupted')!.status).toBe('interrupted');expect(f.calls).toHaveLength(0);
 await f.run.recoverInterruptedRun('interrupted','inspect');expect(f.calls).toHaveLength(0);
 await f.run.recoverInterruptedRun('interrupted','resume');await f.run.waitForIdle('interrupted');expect(f.run.getSnapshot('interrupted').status).toBe('completed');expect(f.calls).toHaveLength(3);
});
