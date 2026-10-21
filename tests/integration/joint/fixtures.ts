import type { Database } from '../../../src/main/database/Database';
import { RoomService } from '../../../src/main/room/RoomService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { KeyService, createMemoryKeyBackend } from '../../../src/main/security/KeyService';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import type { NormalizedChunk,StreamChatInput } from '../../../src/main/providers/types';
import type { RoundtableApiContract, RunSessionApiContract } from '../../../src/shared/contracts/app';
import type { RunService } from '../../../src/main/services/RunService';
import { publicError } from '../../../src/shared/schemas/error';

export class PublicProvider extends MockProvider {
  inputs:Omit<StreamChatInput,'signal'>[]=[];
  signals:(AbortSignal|undefined)[]=[];
  private releases=new Map<number,()=>void>();
  private released=new Set<number>();
  constructor(readonly config:{gated?:boolean;failFirst?:boolean;finish?:'stop'|'length'|'content_filter';answers?:string[];reasoning?:string}={}){super();}
  release(index:number){this.released.add(index);this.releases.get(index)?.();}
  releaseAll(){for(let i=0;i<20;i++)this.release(i);}
  override async *streamChat({signal,...input}:StreamChatInput):AsyncIterable<NormalizedChunk>{
    const index=this.inputs.length;this.inputs.push(structuredClone(input));this.signals.push(signal);
    yield {type:'start',requestId:input.requestId};
    if(this.config.reasoning)yield {type:'reasoning_summary_delta',requestId:input.requestId,text:this.config.reasoning};
    yield {type:'text_delta',requestId:input.requestId,text:this.config.answers?.[index]??['alpha','beta','gamma'][index]??'suffix'};
    if(this.config.gated && !this.released.has(index))await new Promise<void>(resolve=>this.releases.set(index,resolve));
    if(signal?.aborted)yield {type:'error',requestId:input.requestId,error:publicError('cancelled')};
    else if(this.config.failFirst&&index===0)yield {type:'error',requestId:input.requestId,error:publicError('internal_error')};
    else yield {type:'finish',requestId:input.requestId,reason:this.config.finish??'stop'};
  }
}
export function apiFor(service:RunService):RunSessionApiContract {
  return {room:{createDemo:async objective=>({roomId:service.createDemoRoom(objective)}),getMessages:async id=>service.getMessages(id)},run:{
    previewWorkflow: async input => service.previewWorkflow(input), start:input=>service.start(input),getSnapshot:async id=>service.getSnapshot(id),subscribe:async(id,cursor)=>service.subscribe(id,cursor),onEvent:listener=>service.onEvent(listener),
    pause:async id=>service.pause(id),stop:id=>service.stop(id),step:id=>service.step(id),resumeRun:id=>service.resumeRun(id),retryTurn:(id,turn)=>service.retryTurn(id,turn),continueMessage:(id,message)=>service.continueMessage(id,message),recoverInterruptedRun:(id,decision)=>service.recoverInterruptedRun(id,decision),
  }};
}

export function appApiFor(service: RunService, database: Database): RoundtableApiContract {
  return { ...apiFor(service), rooms: new RoomService(database), settings: new ProviderSettingsService(database, new KeyService(database, createMemoryKeyBackend())) };
}
