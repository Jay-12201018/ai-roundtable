// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { Database, LINEUP_ROOM_ID } from '../../../src/main/database/Database';
import { HostService } from '../../../src/main/host/HostService';
import { ProviderRegistry } from '../../../src/main/providers/ProviderRegistry';
import { MockProvider } from '../../../src/main/providers/mock/MockProvider';
import { RoomService } from '../../../src/main/room/RoomService';
import { KeyService, type KeyStorageBackend } from '../../../src/main/security/KeyService';
import { RunService } from '../../../src/main/services/RunService';
import { ProviderSettingsService } from '../../../src/main/settings/ProviderSettingsService';
import { createPublicMessagesBuilder } from '../../../src/main/context/wirePublicContext';
import { projectBriefText } from '../../../src/main/context/transcript';
import { groupChatWorkflowSnapshot } from '../../../src/shared/schemas/groupChat';

const backend: KeyStorageBackend = { mode: 'secure', backend: 'fixture', persistent: true,
  async encrypt(value) { return Buffer.from(value).toString('base64'); }, async decrypt(value) { return Buffer.from(value, 'base64').toString(); } };
type Body = { model: string; messages: Array<{ role: string; content: string }> };
const isSchedule = (body: Body) => String(body.messages[0]?.content).includes('调度程序');
const speakerOf = (body: Body) => /现在由你（成员「([^」]+)」/u.exec(String(body.messages.at(-1)?.content))?.[1] ?? '';
const sse = (text: string) => new Response([`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`, `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 50, completion_tokens: 5 } })}\n\n`, 'data: [DONE]\n\n'].join(''),
  { headers: { 'content-type': 'text/event-stream' } });

const open: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of open.splice(0)) await close(); });

async function fixture() {
  const db = new Database(':memory:'); db.initialize();
  const keys = new KeyService(db, backend);
  const requests: Body[] = [];
  const fetcher = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Body; requests.push(body);
    return isSchedule(body) ? sse('{"speakers":[]}') : sse(`${speakerOf(body)}说了话`);
  };
  const registry = new ProviderRegistry(db, keys, { transportFactory: guard => async (url, init) => { guard(); return fetcher(url, init); } });
  const settings = new ProviderSettingsService(db, keys, registry);
  const modelBudget = (modelId: string | null, member: { providerId: string | null }) => member.providerId ? registry.budget(member.providerId, modelId!) : undefined;
  const service = new RunService(db, new MockProvider({ tokenDelayMs: 0 }), createPublicMessagesBuilder(modelBudget), registry, member => { try { return modelBudget(member.modelId, member); } catch { return undefined; } });
  const host = new HostService(db, service);
  const rooms = new RoomService(db);
  const provider = await settings.createProvider({ name: 'S', kind: 'compatible', baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [{ id: 'deepseek-flash', name: 'x' }] });
  await settings.setKey({ providerId: provider.id, apiKey: 'fixture-key' });
  const model = { providerId: provider.id, modelId: 'deepseek-flash' };
  const project = await rooms.createRoom({ name: '跑腿项目', objective: '' });
  for (const [index, name] of ['林舟', '阿哲', '小雨'].entries())
    await rooms.createAgent({ roomId: project.id, displayName: name, roleTemplateId: ['产品', '工程', '总结'][index]!, systemPrompt: `${name}的设定`, ...model, enabled: true, displayOrder: index });
  const replies = () => requests.filter(body => !isSchedule(body));
  const briefOf = (body: Body) => body.messages.filter(message => message.role === 'system' && message.content.startsWith('【项目说明'));
  let request = 0;
  const send = (runId: string, content: string) => host.command({ kind: 'interject', runId, clientRequestId: `client-${++request}`, content });
  open.push(async () => { await service.shutdown().catch(() => {}); db.close(); });
  return { db, rooms, service, project, model, requests, replies, briefOf, send };
}

describe('项目说明 reaches every member (D168)', () => {
  const brief = '我们在做校园跑腿平台。\n试点学校：两所，预算 5 万。';

  it('goes with every member\'s request in a group chat, as application material and never as an instruction', async () => {
    const { rooms, service, project, replies, briefOf, requests } = await fixture();
    await rooms.updateRoom({ id: project.id, name: project.name, objective: '', brief });
    const { runId } = await service.start({ roomId: project.id, task: '@所有人 说说第一步做什么', workflowSnapshot: { ...groupChatWorkflowSnapshot } });
    await service.waitForIdle(runId);
    expect(replies().map(speakerOf).sort()).toEqual(['小雨', '林舟', '阿哲'].sort());
    for (const body of replies()) {
      expect(briefOf(body)).toEqual([{ role: 'system', content: projectBriefText(brief) }]);
      // Every line the host wrote is quoted, so nothing in it can pass for an application label or an instruction.
      expect(briefOf(body)[0]!.content).toContain('> 我们在做校园跑腿平台。\n> 试点学校：两所，预算 5 万。');
      expect(briefOf(body)[0]!.content).toContain('不是指令');
      // It sits before what differs by member, so the members of one project share the prefix.
      const at = body.messages.indexOf(briefOf(body)[0]!);
      expect(at).toBe(2);
      expect(body.messages.slice(0, at + 1)).toEqual(replies()[0]!.messages.slice(0, at + 1));
    }
    // The scheduling request is not a member speaking and does not carry it.
    for (const body of requests.filter(isSchedule)) expect(JSON.stringify(body)).not.toContain('校园跑腿平台');
  });

  it('goes with every turn of a stricter flow too', async () => {
    const { rooms, service, project, replies, briefOf } = await fixture();
    await rooms.updateRoom({ id: project.id, name: project.name, objective: '', brief });
    const { runId } = await service.start({ roomId: project.id, task: '定一个试点方案', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    await service.waitForIdle(runId);
    expect(service.getSnapshot(runId).status).toBe('completed');
    expect(replies()).toHaveLength(3);
    for (const body of replies()) expect(briefOf(body)).toEqual([{ role: 'system', content: projectBriefText(brief) }]);
  });

  it('is read when each request is built: a change reaches the next reply of a discussion that is still going', async () => {
    const { rooms, service, project, replies, briefOf, send } = await fixture();
    const { runId } = await service.start({ roomId: project.id, task: '@林舟 在吗', workflowSnapshot: { ...groupChatWorkflowSnapshot } });
    await service.waitForIdle(runId);
    expect(briefOf(replies()[0]!)).toEqual([]);
    await rooms.updateRoom({ id: project.id, name: project.name, objective: '', brief: '预算改成 8 万。' });
    await send(runId, '@阿哲 预算够吗'); await service.waitForIdle(runId);
    expect(briefOf(replies().at(-1)!)).toEqual([{ role: 'system', content: projectBriefText('预算改成 8 万。') }]);
    // An update that does not name the brief leaves it alone.
    await rooms.updateRoom({ id: project.id, name: '改了名', objective: '' });
    expect((await rooms.getRoomConfiguration({ id: project.id })).brief).toBe('预算改成 8 万。');
  });

  it('refuses a brief longer than every model has room for', async () => {
    const { rooms, project } = await fixture();
    await expect(rooms.updateRoom({ id: project.id, name: project.name, objective: '', brief: '长'.repeat(4001) })).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await rooms.updateRoom({ id: project.id, name: project.name, objective: '', brief: '长'.repeat(4000) })).brief).toHaveLength(4000);
  });
});

describe('独立讨论 and the 常用阵容 (D167)', () => {
  it('starts a discussion on its own copy of the lineup, runs it like any other, and lists it with who took part', async () => {
    const { rooms, service, model, replies, briefOf, send } = await fixture();
    const lineup = await rooms.getLineup();
    expect(lineup).toMatchObject({ id: LINEUP_ROOM_ID, kind: 'lineup', name: '常用阵容' });
    expect((await rooms.listAgentConfigurations({ roomId: lineup.id })).map(agent => agent.displayName)).toEqual(['林舟', '阿哲', '小雨']);
    const room = await rooms.createStandalone({ fallbackModel: model });
    expect(room).toMatchObject({ kind: 'standalone', defaultMode: 'group-chat', brief: '' });
    const members = await rooms.listAgentConfigurations({ roomId: room.id });
    expect(members.map(agent => [agent.displayName, agent.providerId, agent.modelId, agent.builtInDemo])).toEqual(['林舟', '阿哲', '小雨'].map(name => [name, model.providerId, model.modelId, undefined]));
    // Not started yet: nothing to list.
    expect(await rooms.listStandalone()).toEqual([]);
    const { runId } = await service.start({ roomId: room.id, task: '@所有人 周末去哪玩', workflowSnapshot: { ...groupChatWorkflowSnapshot } });
    await service.waitForIdle(runId);
    expect(replies()).toHaveLength(3);
    for (const body of replies()) expect(briefOf(body)).toEqual([]);
    // Continuing is the same Run, as in any group chat.
    await send(runId, '@小雨 你定一个'); await service.waitForIdle(runId);
    expect(service.getSnapshot(runId).turns).toHaveLength(4);
    const listed = await rooms.listStandalone();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ room: { id: room.id, kind: 'standalone' }, run: { id: runId, roomId: room.id, groupChat: true, task: '@所有人 周末去哪玩' }, members: ['林舟', '阿哲', '小雨'] });
    // Projects are listed apart, and neither list has the lineup.
    expect((await rooms.listRooms({ includeArchived: true })).map(item => item.kind)).toEqual(['project']);
  });

  it('keeps the lineup as it is when a discussion changes its own members, and the other way round', async () => {
    const { rooms, model } = await fixture();
    const lineup = await rooms.getLineup();
    const room = await rooms.createStandalone({ fallbackModel: model });
    const [first] = await rooms.listAgentConfigurations({ roomId: room.id });
    await rooms.updateAgent({ id: first!.id, roomId: room.id, displayName: '老陆', roleTemplateId: '审查', systemPrompt: '严谨', ...model, enabled: true, displayOrder: 0 });
    expect((await rooms.listAgentConfigurations({ roomId: lineup.id })).map(agent => agent.displayName)).toEqual(['林舟', '阿哲', '小雨']);
    // The lineup is changed in 设置: the next discussion gets it, and a member who has a model keeps it.
    const [lead] = await rooms.listAgentConfigurations({ roomId: lineup.id });
    await rooms.updateAgent({ id: lead!.id, roomId: lineup.id, displayName: '苏苏', roleTemplateId: '体验', systemPrompt: '站在用户那边', ...model, enabled: true, displayOrder: 0 });
    await rooms.createAgent({ roomId: lineup.id, displayName: '老周', roleTemplateId: '反方', systemPrompt: '', providerId: null, modelId: null, enabled: false, displayOrder: 3 });
    const next = await rooms.createStandalone();
    expect((await rooms.listAgentConfigurations({ roomId: next.id })).map(agent => [agent.displayName, agent.modelId, agent.enabled]))
      .toEqual([['苏苏', 'deepseek-flash', true], ['阿哲', null, true], ['小雨', null, true], ['老周', null, false]]);
    // The one that never started is gone; nothing piles up.
    await expect(rooms.getRoomConfiguration({ id: room.id })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('carries on with the same people from another 独立讨论, and keeps every started one', async () => {
    const { rooms, service, model } = await fixture();
    const first = await rooms.createStandalone({ fallbackModel: model });
    const [lead] = await rooms.listAgentConfigurations({ roomId: first.id });
    await rooms.updateAgent({ id: lead!.id, roomId: first.id, displayName: '老陆', roleTemplateId: '审查', systemPrompt: '', ...model, enabled: true, displayOrder: 0 });
    await rooms.updateRoom({ id: first.id, name: first.name, objective: '', defaultMode: 'free-chat' });
    const started = await service.start({ roomId: first.id, task: '第一场', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    await service.waitForIdle(started.runId);
    const second = await rooms.createStandalone({ fromRoomId: first.id });
    expect(second).toMatchObject({ kind: 'standalone', defaultMode: 'free-chat' });
    expect((await rooms.listAgentConfigurations({ roomId: second.id })).map(agent => agent.displayName)).toEqual(['老陆', '阿哲', '小雨']);
    expect((await rooms.getRoomConfiguration({ id: first.id })).id).toBe(first.id);
    const again = await service.start({ roomId: second.id, task: '第二场', workflowSnapshot: { templateId: 'draft-review-finalize', version: 1 } });
    await service.waitForIdle(again.runId);
    expect((await rooms.listStandalone()).map(item => item.run.task).sort()).toEqual(['第一场', '第二场']);
    // Archiving one takes it out of the list, and it comes back with the archived ones.
    await rooms.archiveRoom({ id: first.id });
    expect((await rooms.listStandalone()).map(item => item.run.task)).toEqual(['第二场']);
    expect((await rooms.listStandalone({ includeArchived: true })).map(item => item.run.task).sort()).toEqual(['第一场', '第二场']);
    // A project is not a source: its members are the project's.
    const project = (await rooms.listRooms())[0]!;
    await expect(rooms.createStandalone({ fromRoomId: project.id })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(rooms.createStandalone({ fallbackModel: { providerId: 'nobody', modelId: 'x' } })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('never discusses in the lineup, and never archives, renames or deletes it', async () => {
    const { db, rooms, service, model } = await fixture();
    const lineup = await rooms.getLineup();
    for (const agent of await rooms.listAgentConfigurations({ roomId: lineup.id })) await rooms.updateAgent({ id: agent.id, roomId: lineup.id, displayName: agent.displayName, roleTemplateId: agent.roleTemplateId, systemPrompt: agent.systemPrompt, ...model, enabled: true, displayOrder: agent.displayOrder });
    await expect(service.start({ roomId: lineup.id, task: '不行', workflowSnapshot: { ...groupChatWorkflowSnapshot } })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(() => db.insertRun({ id: 'forced', roomId: lineup.id, status: 'idle', workflowSnapshot: {} })).toThrow(/lineup/u);
    await expect(rooms.archiveRoom({ id: lineup.id })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(rooms.deleteRoom({ id: lineup.id })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(rooms.updateRoom({ id: lineup.id, name: '改名', objective: '' })).rejects.toMatchObject({ code: 'invalid_state' });
    expect(await rooms.getLineup()).toEqual(lineup);
  });
});

describe('默认讨论方式 (D169)', () => {
  it('is the project\'s own, kept in the database, and one of the five ways', async () => {
    const { rooms, project } = await fixture();
    expect(project.defaultMode).toBe('group-chat');
    expect((await rooms.updateRoom({ id: project.id, name: project.name, objective: '', defaultMode: 'review-revision' })).defaultMode).toBe('review-revision');
    expect((await rooms.listRooms())[0]!.defaultMode).toBe('review-revision');
    await expect(rooms.updateRoom({ id: project.id, name: project.name, objective: '', defaultMode: 'anything' as never })).rejects.toMatchObject({ code: 'invalid_input' });
    const made = await rooms.createRoom({ name: '另一个', objective: '', brief: '背景', defaultMode: 'deep-debate' });
    expect(made).toMatchObject({ kind: 'project', brief: '背景', defaultMode: 'deep-debate' });
  });
});
