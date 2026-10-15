import { afterEach,describe,expect,it } from 'vitest';
import { cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import { canRecover } from '../../../src/renderer/store/rendererStore';
import { PublicProvider,apiFor } from './fixtures';

afterEach(()=>{cleanup();localStorage.clear();});
function recovered(options:{completed?:boolean;legacy?:boolean;exhausted?:boolean}={}){
  const db=new Database(':memory:');db.initialize();
  db.insertRoom({id:'room',name:'Recovery',objective:'not task'});
  db.insertAgent({id:'agent',roomId:'room',displayName:'A',roleTemplateId:'Drafter',displayOrder:0});
  db.insertRun({id:'run',roomId:'room',status:'running',workflowSnapshot:{},...(options.legacy?{}:{
    task:'saved task',membersSnapshot:[{agentId:'agent',displayName:'A',roleTemplateId:'Drafter',displayOrder:0,systemPrompt:'',providerId:null,modelId:'mock'}],
    nextTurnIndex:0,elapsedExecutionMs:options.exhausted?300000:17,maxTurns:2,
  })});
  db.insertTurn({id:'turn',runId:'run',agentId:'agent',requestId:'original-request',turnIndex:0,status:options.completed?'completed':'running'});
  db.updateTurn('turn',{partialContent:'saved alpha'});
  db.insertMessage({id:'original-message',roomId:'room',runId:'run',turnId:'turn',senderType:'agent',senderName:'A',content:'saved alpha',status:options.completed?'completed':'streaming'});
  db.createAttempt({runId:'run',turnId:'turn',requestId:'original-request',messageId:'original-message',attemptIndex:0,status:'running',inputSnapshot:{requestId:'original-request',modelId:'mock',messages:[{role:'user',content:'saved task'}],outputTokenLimit:1024}});
  if(options.completed)db.updateAttempt('original-request',{status:'completed'});
  if(options.completed)db.updateRunProgress('run',{nextTurnIndex:1});
  expect(db.markInFlightRunsInterrupted()).toBe(1);expect(db.markInFlightRunsInterrupted()).toBe(0);
  const provider=new PublicProvider({gated:true});const service=new RunService(db,provider,createPublicMessagesBuilder());const api=apiFor(service);
  return {db,provider,service,api,async close(){provider.releaseAll();await service.shutdown();db.close();}};
}
describe('joint interrupted recovery and reload',()=>{
  it('refreshes the authoritative interrupted App without calling Provider; inspect and discard keep evidence',async()=>{
    const f=recovered();window.roundtable=f.api;localStorage.setItem('roundtable.runId','run');const before=f.db.readRunSnapshot('run');
    try{
      const page=render(<App/>);await screen.findByText('saved alpha');expect(screen.getByRole('status').textContent).toContain('已中断');
      expect((screen.getByRole('button',{name:'恢复后续回合'}) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(screen.getByRole('button',{name:'检查中断记录'}));await waitFor(()=>expect((screen.getByRole('button',{name:'检查中断记录'}) as HTMLButtonElement).disabled).toBe(false));
      expect(f.db.readRunSnapshot('run')).toEqual(before);expect(f.provider.inputs).toEqual([]);
      page.unmount();render(<App/>);await screen.findByText('saved alpha');expect(f.provider.inputs).toEqual([]);
      fireEvent.click(screen.getByRole('button',{name:'放弃中断执行'}));await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('已停止'));
      const after=f.db.readRunSnapshot('run');expect(after.turns).toEqual(before.turns);expect(after.messages).toEqual(before.messages);expect(after.attempts).toEqual(before.attempts);expect(f.provider.inputs).toEqual([]);
    }finally{cleanup();await f.close();}
  });
  it('requires explicit recovery Retry, creates one fresh Attempt and permits Stop while it is running',async()=>{
    const f=recovered();const session=createRendererSession(f.api,localStorage);const dispose=session.mount();const before=f.db.readRunSnapshot('run');
    try{
      await session.selectRun('run');expect(canRecover(session.store.getState(),'retry')).toBe(true);expect(canRecover(session.store.getState(),'resume')).toBe(false);expect(f.provider.inputs).toEqual([]);
      const operation=session.recover('retry');await waitFor(()=>expect(session.store.getState().snapshot?.messages).toHaveLength(2));
      await session.recover('retry');expect(f.provider.inputs).toHaveLength(1);expect(session.store.getState().snapshot?.turns).toHaveLength(1);
      expect(f.provider.inputs[0].requestId).not.toBe('original-request');expect(f.provider.inputs[0].messages).toEqual(before.attempts[0].inputSnapshot!.messages);
      await session.control('stop');await operation;
      expect(f.db.getMessage('original-message')).toEqual(before.messages[0]);expect(f.db.getAttempt('original-request')).toEqual(before.attempts[0]);
      expect(session.store.getState().snapshot).toEqual(f.service.getSnapshot('run'));
    }finally{dispose();await f.close();}
  });
  it('resumes only the next Turn when every historical latest Attempt is completed',async()=>{
    const f=recovered({completed:true});const session=createRendererSession(f.api);const dispose=session.mount();
    try{
      await session.selectRun('run');expect(canRecover(session.store.getState(),'resume')).toBe(true);expect(canRecover(session.store.getState(),'retry')).toBe(false);
      const operation=session.recover('resume');await waitFor(()=>expect(f.provider.inputs).toHaveLength(1));
      expect(f.provider.inputs[0].turnIndex).toBe(1);expect(JSON.stringify(f.provider.inputs[0].messages)).toContain('saved alpha');
      f.provider.release(0);await operation;expect(session.store.getState().snapshot?.status).toBe('completed');expect(f.db.listTurns('run')).toHaveLength(2);
    }finally{dispose();await f.close();}
  });
  it.each([{legacy:true},{exhausted:true}])('disables paid recovery for incomplete or exhausted metadata: %j',async options=>{
    const f=recovered(options);const session=createRendererSession(f.api);const dispose=session.mount();
    try{
      await session.selectRun('run');for(const decision of ['resume','retry'] as const){expect(canRecover(session.store.getState(),decision)).toBe(false);await session.recover(decision);}
      expect(canRecover(session.store.getState(),'inspect')).toBe(true);expect(canRecover(session.store.getState(),'discard')).toBe(true);expect(f.provider.inputs).toEqual([]);
      session.selectRoom('different');await session.recover('retry');expect(f.provider.inputs).toEqual([]);expect(session.store.getState().snapshot).toBeUndefined();
    }finally{dispose();await f.close();}
  });
  it.each(['timeout','length','content_filter'] as const)('projects %s as an error and preserves its actual partial response',async cause=>{
    const db=new Database(':memory:');db.initialize();const provider=new PublicProvider(cause==='timeout'?{gated:true}:{finish:cause});
    const service=new RunService(db,provider,createPublicMessagesBuilder());const session=createRendererSession(apiFor(service));const dispose=session.mount();
    try{
      const run=await service.start({roomId:service.createDemoRoom('room'),task:'task',workflowSnapshot:{},maxDurationMs:cause==='timeout'?150:300000});await session.selectRun(run.runId);
      await waitFor(()=>expect(session.store.getState().snapshot?.status).toBe('error'));
      expect(session.store.getState().snapshot?.messages[0].content).toBe('alpha');expect(session.store.getState().snapshot?.messages[0].status).toBe(cause==='timeout'?'aborted':'failed');
      expect(session.store.getState().error).toContain(cause==='timeout'?'请求已超时':'模型未完整完成响应');
      if(cause==='timeout')expect(provider.signals[0]?.aborted).toBe(true);
      expect(db.listAttempts(run.runId)[0].status).toBe(cause==='timeout'?'aborted':'failed');expect(service.hasActiveRuns()).toBe(false);
    }finally{dispose();provider.releaseAll();await service.shutdown();db.close();}
  });
});
