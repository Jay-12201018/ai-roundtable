// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { StreamChatInput,NormalizedChunk } from '../../../src/main/providers/types';
import { publicError } from '../../../src/shared/schemas/error';

class CapturingProvider extends MockProvider {
  inputs: Omit<StreamChatInput,'signal'>[]=[];
  constructor(private readonly failFirst=false){super();}
  override async *streamChat({signal,...input}:StreamChatInput):AsyncIterable<NormalizedChunk>{
    this.inputs.push(structuredClone(input));
    yield {type:'start',requestId:input.requestId};
    yield {type:'text_delta',requestId:input.requestId,text:['alpha','beta','gamma'][this.inputs.length-1]??'suffix'};
    if(this.failFirst && this.inputs.length===1) yield {type:'error',requestId:input.requestId,error:publicError('internal_error')};
    else yield {type:'finish',requestId:input.requestId,reason:'stop'};
  }
}
function database(){const db=new Database(':memory:');db.initialize();return db;}

describe('joint request preparation',()=>{
  it.each(['timeout','stop'] as const)('rolls back every candidate record if the builder causes %s',async cause=>{
    const db=database();const provider=new CapturingProvider();let time=0;const clock=vi.spyOn(performance,'now').mockImplementation(()=>time);
    let stop:Promise<void>|undefined;
    const service=new RunService(db,provider,run=>{if(cause==='timeout')time=100;else stop=service.stop(run.id);return [{role:'user',content:'task'}];});
    try{
      const run=await service.start({roomId:service.createDemoRoom('room'),task:'task',workflowSnapshot:{},maxDurationMs:50});await service.waitForIdle(run.runId);await stop;
      expect(provider.inputs).toEqual([]);const data=db.readRunSnapshot(run.runId);
      expect(data.turns).toEqual([]);expect(data.attempts).toEqual([]);expect(data.messages).toEqual([]);
      expect(data.run.status).toBe(cause==='timeout'?'error':'cancelled');expect(service.hasActiveRuns()).toBe(false);
      expect(db.listRunEvents(run.runId,0).every(e=>e.type==='run_state_changed')).toBe(true);
    }finally{clock.mockRestore();await service.shutdown();db.close();}
  });
  it('provides the actual candidate identities and a pre-write consistent snapshot to the builder',async()=>{
    const db=database();const provider=new CapturingProvider();const calls:unknown[][]=[];
    const service=new RunService(db,provider,(...args)=>{calls.push(args);return [{role:'user',content:'task'}];});
    try {
      const run=await service.start({roomId:service.createDemoRoom('room'),task:'task',workflowSnapshot:{},maxTurns:1});
      await service.waitForIdle(run.runId);
      const attempt=db.listAttempts(run.runId)[0];
      expect(calls[0][3]).toMatchObject({current:{turnId:attempt.turnId,requestId:attempt.requestId,messageId:attempt.messageId,agentId:db.getTurn(attempt.turnId)!.agentId,turnIndex:0},snapshot:{turns:[],messages:[],attempts:[],sequence:1}});
    }finally{await service.shutdown();db.close();}
  });
  it.each(['retry','continue'] as const)('does not bypass the builder for %s final input',async kind=>{
    const db=database();const provider=new CapturingProvider(true);const calls:unknown[][]=[];
    const service=new RunService(db,provider,(...args)=>{calls.push(args);return [{role:'user',content:'task'}];});
    try {
      const run=await service.start({roomId:service.createDemoRoom('room'),task:'task',workflowSnapshot:{},maxTurns:1});
      await service.waitForIdle(run.runId);const first=db.listAttempts(run.runId)[0];
      if(kind==='retry')await service.retryTurn(run.runId,first.turnId);else await service.continueMessage(run.runId,first.messageId);
      expect(calls).toHaveLength(2);
      expect(calls[1][3]).toMatchObject({repeat:{sourceRequestId:first.requestId,kind},snapshot:{attempts:[{requestId:first.requestId}]}});
      expect(db.listTurns(run.runId)).toHaveLength(1);expect(db.listAttempts(run.runId)).toHaveLength(2);
    }finally{await service.shutdown();db.close();}
  });
});
