// Read-only audit helper for the D095 model-facing discussion format (src/main/context/transcript.ts).
// Another member's reply reaches the next request on the user side as an application label line followed by the
// reply quoted line by line with "> "; only the member's own replies are assistant messages.
const labelText = (value, fallback = '未命名') => value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/gu, ' ').replace(/[【】「」]/gu, '').replace(/\s+/gu, ' ').trim() || fallback;
const quoteText = text => text.split(/\r\n|[\n\r\u000b\u000c\u0085\u2028\u2029]/u).map(line => line ? `> ${line}` : '>').join('\n');

/** The exact block a foreign member's unedited, finished reply becomes: its label line, then the quoted original. */
const labelledQuote = (member, content) => `【成员「${labelText(member.displayName)}」· ${labelText(member.roleTemplateId, '未填写角色')}】\n${quoteText(content)}`;

/** Where the labelled quote sits in Provider messages, as [message index, offset], or undefined when absent. */
function quotedPosition(messages, member, content) {
  const block = labelledQuote(member, content);
  for (const [index, message] of messages.entries()) {
    if (message.role !== 'user') continue;
    const offset = message.content.indexOf(block);
    if (offset >= 0) return [index, offset];
  }
  return undefined;
}

const before = (a, b) => a[0] < b[0] || a[0] === b[0] && a[1] < b[1];

/** Never an assistant message carrying someone else's words (the pre-D095 format the model mistook for its own). */
const foreignAsAssistant = (messages, content) => messages.some(message => message.role === 'assistant' && message.content.includes(content));

/** Run members by the Turn that wrote each message, from the frozen snapshot: { messageId: MemberSnapshot }. */
function membersByMessage(database, runId) {
  const members = JSON.parse(database.prepare('SELECT members_snapshot FROM workflow_runs WHERE id=?').pluck().get(runId));
  const rows = database.prepare('SELECT m.id AS messageId, t.agent_id AS agentId FROM messages m JOIN turns t ON t.id=m.turn_id WHERE m.run_id=?').all(runId);
  return Object.fromEntries(rows.map(row => {
    const member = members.find(value => value.agentId === row.agentId);
    if (!member) throw new Error('Message author missing from the frozen member snapshot: ' + row.messageId);
    return [row.messageId, member];
  }));
}

module.exports = { labelledQuote, quotedPosition, before, foreignAsAssistant, membersByMessage };
