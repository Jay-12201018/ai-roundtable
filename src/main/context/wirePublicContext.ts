import { ContractError } from '../../shared/contracts/errors';
import { streamChatInputSchema } from '../../shared/schemas/provider';
import { buildPublicContext,countModelTokens } from './buildPublicContext';
import type { ModelTokenCounter } from './types';
import type { MemberSnapshot } from '../../shared/schemas/persistence';
import type { RunMessagesBuilder } from '../services/RunService';
import { workflowStageInstruction } from '../workflow';
import { mockModelBudget } from '../providers/mock/tokenBudget';

type ModelBudget={contextWindowTokens:number;counter:ModelTokenCounter};
export function createPublicMessagesBuilder(resolve:(modelId:string|null,member:MemberSnapshot)=>ModelBudget|undefined=id=>id==='mock'?mockModelBudget:undefined):RunMessagesBuilder{
  return (run,member,turnIndex,{snapshot,current,repeat,workflowStep})=>{
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
    const result=buildPublicContext({
      run:{id:run.id,roomId:run.roomId,task:run.task,membersSnapshot:run.membersSnapshot,nextTurnIndex:run.nextTurnIndex,elapsedExecutionMs:run.elapsedExecutionMs,maxTurns:run.maxTurns,maxDurationMs:run.maxDurationMs,outputTokenLimit:run.outputTokenLimit},
      current:{agentId:current.agentId,turnId:current.turnId,requestId:current.requestId,turnIndex},
      snapshot:{messages:snapshot.messages,turns:snapshot.turns.map(t=>({id:t.id,runId:t.runId,agentId:t.agentId,status:t.status,requestId:t.requestId,turnIndex:t.turnIndex})),attempts:snapshot.attempts.map(a=>({requestId:a.requestId,runId:a.runId,turnId:a.turnId,messageId:a.messageId,attemptIndex:a.attemptIndex,status:a.status}))},
      visibleMessageIds:snapshot.messages.map(m=>m.id),applicationInstructions:workflowStep?[{id:`workflow-${workflowStep.stageId}`,content:workflowStageInstruction(workflowStep.kind)}]:[],hostInstructions:[],contextWindowTokens:budget.contextWindowTokens,
    },budget.counter);
    if(!result.ok)throw new ContractError(result.reason==='token_count_unavailable'?'unsupported':'invalid_input');
    return result.messages;
  };
}
