import { ContractError } from '../../shared/contracts/errors';
import { streamChatInputSchema } from '../../shared/schemas/provider';
import { buildPublicContext,countModelTokens } from './buildPublicContext';
import type { ModelTokenCounter } from './types';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import type { RunMessagesBuilder } from '../services/RunService';
import { workflowStageInstruction } from '../workflow';
import { mockModelBudget } from '../providers/mock/tokenBudget';
import { affectedVersions, effectiveInstructions, slotPositions } from '../host/versions';

type ModelBudget={contextWindowTokens:number;counter:ModelTokenCounter};
export function createPublicMessagesBuilder(resolve:(modelId:string|null,member:MemberSnapshot)=>ModelBudget|undefined=id=>id==='mock'?mockModelBudget:undefined):RunMessagesBuilder{
  return (run,member,turnIndex,{snapshot,current,repeat,workflowStep,regenerate})=>{
    const budget=resolve(member.modelId,member);
    if(!budget||!Number.isSafeInteger(budget.contextWindowTokens)||budget.contextWindowTokens<=0)throw new ContractError('unsupported');
    if(snapshot.run.id!==run.id||snapshot.run.roomId!==run.roomId||current.agentId!==member.agentId||current.turnIndex!==turnIndex
      ||snapshot.messages.some(m=>m.id===current.messageId)||snapshot.attempts.some(a=>a.requestId===current.requestId))throw new ContractError('invalid_state');
    if(repeat){
      const turn=snapshot.turns.find(t=>t.id===current.turnId);
      const latest=snapshot.attempts.filter(a=>a.turnId===current.turnId).at(-1);
      if(!turn||turn.agentId!==member.agentId||turn.turnIndex!==turnIndex||latest?.requestId!==repeat.sourceRequestId||!latest.inputSnapshot
        ||latest.inputSnapshot.modelId!==member.modelId)throw new ContractError('invalid_state');
      const original=latest.inputSnapshot.messages;
      const oldMessage=snapshot.messages.find(m=>m.id===latest.messageId);
      const expected=repeat.kind==='retry'?original:[...original,{role:'assistant',content:oldMessage?.content},{role:'user',content:'Continue the previous response from where it stopped.'}];
      if(JSON.stringify(repeat.messages)!==JSON.stringify(expected))throw new ContractError('invalid_state');
      const messages=streamChatInputSchema.shape.messages.parse(repeat.messages);
      const count=countModelTokens(messages,member.modelId,budget.counter);
      const previous=countModelTokens(original,member.modelId,budget.counter);
      if(count===undefined||previous===undefined)throw new ContractError('unsupported');
      if(count<previous||count+run.outputTokenLimit>budget.contextWindowTokens)throw new ContractError('invalid_input');
      return messages;
    }
    // R12: only effective versions are public history; a regenerated Turn sees only slots positioned before it.
    const versions=snapshot.versions??[];
    const affected=affectedVersions(snapshot.messages,versions);
    const positions=slotPositions(snapshot.messages,versions);
    const slotOf=new Map(versions.map(v=>[v.messageId,v.slotId]));
    const cutoff=regenerate?positions.get(current.turnId):undefined;
    if(regenerate&&(cutoff===undefined||slotOf.get(regenerate.sourceMessageId)!==current.turnId))throw new ContractError('invalid_state');
    const visible=snapshot.messages.filter(m=>cutoff===undefined||(positions.get(slotOf.get(m.id)??m.id)??Infinity)<cutoff).map(m=>m.id);
    const hostInstructions=effectiveInstructions(snapshot.instructions??[]).map(i=>({id:i.id,content:i.content!,roomId:run.roomId,runId:i.runId}));
    const result=buildPublicContext({
      run:{id:run.id,roomId:run.roomId,task:run.task,membersSnapshot:run.membersSnapshot,nextTurnIndex:run.nextTurnIndex,elapsedExecutionMs:run.elapsedExecutionMs,maxTurns:run.maxTurns,maxDurationMs:run.maxDurationMs,outputTokenLimit:run.outputTokenLimit},
      current:{agentId:current.agentId,turnId:current.turnId,requestId:current.requestId,turnIndex,...(regenerate?{mode:'regenerate' as const}:{})},
      snapshot:{messages:snapshot.messages,turns:snapshot.turns.map(t=>({id:t.id,runId:t.runId,agentId:t.agentId,status:t.status,requestId:t.requestId,turnIndex:t.turnIndex})),attempts:snapshot.attempts.map(a=>({requestId:a.requestId,runId:a.runId,turnId:a.turnId,messageId:a.messageId,attemptIndex:a.attemptIndex,status:a.status,...(a.finishReason?{finishReason:a.finishReason}:{})})),
        ...(versions.length?{versions:versions.map(v=>({messageId:v.messageId,slotId:v.slotId,versionNumber:v.versionNumber,active:v.active,origin:v.origin,affected:(affected.get(v.messageId)?.length??0)>0}))}:{})},
      visibleMessageIds:visible,applicationInstructions:workflowStep?[{id:`workflow-${workflowStep.stageId}`,content:workflowStageInstruction(workflowStep.kind)}]:[],hostInstructions,contextWindowTokens:budget.contextWindowTokens,
    },budget.counter);
    if(!result.ok)throw new ContractError(result.reason==='token_count_unavailable'?'unsupported':'invalid_input');
    return result.messages;
  };
}
