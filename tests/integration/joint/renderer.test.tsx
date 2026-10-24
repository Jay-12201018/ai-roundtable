import { afterEach,describe,expect,it,vi } from 'vitest';
import type { RunEvent } from '../../../src/shared/types/run';
import { act,cleanup,fireEvent,render,screen,waitFor } from '@testing-library/react';
import { App } from '../../../src/renderer/App';
import { Database } from '../../../src/main/database/Database';
import { RunService } from '../../../src/main/services/RunService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { createRendererSession } from '../../../src/renderer/subscriptions/rendererSession';
import { PublicProvider,apiFor,appApiFor } from './fixtures';

afterEach(()=>{cleanup();localStorage.clear();});
function fixture(options:ConstructorParameters<typeof PublicProvider>[0]={gated:true}){
  const db=new Database(':memory:');db.initialize();const provider=new PublicProvider(options);
  const service=new RunService(db,provider,createPublicMessagesBuilder());const api=appApiFor(service,db);
  return {db,provider,service,api,async close(){provider.releaseAll();await service.shutdown();db.close();}};
}
describe('R04 + R05 + R06 live integration',()=>{
  it('resyncs a missing structural event, deduplicates real events, and ignores old Attempt/room responses',async()=>{
    const f=fixture();let deliver:((event:RunEvent)=>void)|undefined;const events:RunEvent[]=[];
    f.api.run.subscribe=vi.fn(f.api.run.subscribe);
    f.api.run.onEvent=listener=>{deliver=listener;return f.service.onEvent(event=>{events.push(event);if(event.type!=='turn_started'){listener(event);listener(event);}});};
    const session=createRendererSession(f.api,localStorage);const dispose=session.mount();
    try{
      await session.startRun();await waitFor(()=>expect(session.store.getState().snapshot?.messages[0]?.content).toBe('alpha'));
      await session.control('stop');const runId=session.store.getState().runId!;const old=events.find(e=>e.type==='text_delta')!;
      const operation=session.repeat('retryTurn');await waitFor(()=>expect(session.store.getState().snapshot?.messages[1]?.content).toBe('beta'));
      deliver!(old);deliver!(old);await session.synchronize();
      expect(session.store.getState().snapshot?.messages.map(m=>m.content)).toEqual(['alpha','beta']);
      expect(vi.mocked(f.api.run.subscribe).mock.calls.length).toBeGreaterThan(2);
      await session.selectRun(runId);expect(session.store.getState().snapshot).toEqual(f.service.getSnapshot(runId));expect(f.provider.inputs).toHaveLength(2);
      session.selectRoom('other-room');await f.service.stop(runId);await operation;f.provider.release(0);
      expect(session.store.getState().roomId).toBe('other-room');expect(session.store.getState().snapshot).toBeUndefined();expect(f.provider.inputs).toHaveLength(2);
    }finally{dispose();await f.close();}
  });
  it('projects real alpha/beta/gamma to the DOM with Pause, one Step and Resume',async()=>{
    const f=fixture();f.service.createDemoRoom('联合 Mock');window.roundtable=f.api;
    try{
      render(<App/>);await waitFor(()=>expect((screen.getByRole('button',{name:'开始讨论'}) as HTMLButtonElement).disabled).toBe(false));fireEvent.click(screen.getByRole('button',{name:'开始讨论'}));
      await screen.findByText('alpha');expect(f.provider.inputs).toHaveLength(1);
      await waitFor(()=>expect((screen.getByRole('button',{name:'暂停'}) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button',{name:'暂停'}));await waitFor(()=>expect(screen.getByRole('status',{name:'运行状态'}).textContent).toContain('正在暂停'));
      await act(async()=>{f.provider.release(0);});await waitFor(()=>expect(screen.getByRole('status',{name:'运行状态'}).textContent).toContain('已暂停'));
      fireEvent.click(screen.getByRole('button',{name:'下一步'}));await screen.findByText('beta');expect(f.provider.inputs).toHaveLength(2);
      await act(async()=>{f.provider.release(1);});await waitFor(()=>expect(screen.getByRole('status',{name:'运行状态'}).textContent).toContain('已暂停'));
      fireEvent.click(screen.getByRole('button',{name:'继续'}));await screen.findByText('gamma');expect(f.provider.inputs).toHaveLength(3);
      await act(async()=>{f.provider.release(2);});await waitFor(()=>expect(screen.getByRole('status',{name:'运行状态'}).textContent).toContain('已完成'));
      const runId=f.db.getAttempt(f.provider.inputs[0].requestId)!.runId;
      expect(f.service.getSnapshot(runId).turns).toHaveLength(3);
      expect(JSON.stringify(f.provider.inputs[1].messages)).toContain('alpha');expect(JSON.stringify(f.provider.inputs[2].messages)).toContain('beta');
    }finally{cleanup();await f.close();}
  });
  it.each(['retryTurn','continueMessage'] as const)('uses typed %s without duplicating a logical Turn or losing its old message',async command=>{
    const f=fixture();const session=createRendererSession(f.api);const dispose=session.mount();
    try{
      await session.startRun();await waitFor(()=>expect(session.store.getState().snapshot?.messages[0]?.content).toBe('alpha'));
      await session.control('stop');const runId=session.store.getState().runId!;const old=f.db.readRunSnapshot(runId);
      const operation=session.repeat(command);await waitFor(()=>expect(f.provider.inputs).toHaveLength(2));
      await session.repeat(command);expect(f.provider.inputs).toHaveLength(2);
      await waitFor(()=>expect(session.store.getState().snapshot?.messages[1]?.content).toBe('beta'));
      expect(session.store.getState().snapshot?.turns).toHaveLength(1);
      expect(session.store.getState().snapshot?.attempts).toHaveLength(2);
      expect(f.db.getMessage(old.messages[0].id)).toEqual(old.messages[0]);expect(f.db.getAttempt(old.attempts[0].requestId)).toEqual(old.attempts[0]);
      expect(f.provider.inputs[1].messages).toEqual(command==='retryTurn'?f.provider.inputs[0].messages:[...f.provider.inputs[0].messages,{role:'assistant',content:'alpha'},{role:'user',content:'Continue the previous response from where it stopped.'}]);
      for(const input of f.provider.inputs)expect(f.db.getAttempt(input.requestId)?.inputSnapshot).toEqual(input);
      await session.control('stop');await operation;
      expect(session.store.getState().snapshot).toEqual(f.service.getSnapshot(runId));
      expect(f.db.listTurns(runId)).toHaveLength(1);
    }finally{dispose();await f.close();}
  });
});
