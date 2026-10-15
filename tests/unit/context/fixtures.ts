import type { ContextInput, ModelTokenCounter } from '../../../src/main/context/types';

export function contextInput(): ContextInput {
  return {
    run: {
      id: 'run', roomId: 'room', task: 'Discuss the task', nextTurnIndex: 2, elapsedExecutionMs: 120,
      maxTurns: 8, maxDurationMs: 10000, outputTokenLimit: 100,
      membersSnapshot: ['a', 'b', 'c'].map((id, displayOrder) => ({
        agentId: id, displayName: id.toUpperCase(), roleTemplateId: `role-${id}`,
        systemPrompt: `Prompt for ${id}`, providerId: 'fixture', modelId: 'fixture', displayOrder,
      })),
    },
    current: { agentId: 'c', turnId: 'turn-c', requestId: 'request-c', turnIndex: 2 },
    snapshot: {
      messages: ['a', 'b'].map(id => ({
        id: `message-${id}`, roomId: 'room', runId: 'run', turnId: `turn-${id}`,
        senderType: 'agent', senderName: id.toUpperCase(), content: id === 'a' ? 'alpha' : 'beta', status: 'completed',
      })),
      turns: ['a', 'b'].map((id, turnIndex) => ({
        id: `turn-${id}`, runId: 'run', agentId: id, status: 'completed', requestId: `request-${id}`, turnIndex,
      })),
      attempts: ['a', 'b'].map(id => ({
        requestId: `request-${id}`, runId: 'run', turnId: `turn-${id}`, messageId: `message-${id}`, attemptIndex: 0, status: 'completed',
      })),
    },
    visibleMessageIds: ['message-a', 'message-b'],
    applicationInstructions: [{ id: 'app', content: 'Respect application policy' }],
    hostInstructions: [{ id: 'host', roomId: 'room', runId: 'run', content: 'Compare the proposals' }],
    contextWindowTokens: 10000,
  };
}

// This fixture model defines one Unicode scalar per token plus four framing tokens per message.
// It is a test tokenizer, never an estimate for any real Provider model.
export const fixtureCounter: ModelTokenCounter = {
  modelId: 'fixture', method: 'fixture-unicode-scalar-v1', kind: 'exact',
  countMessages: messages => messages.reduce((total, message) => total + [...message.content].length + 4, 0),
};
