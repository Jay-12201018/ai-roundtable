// DOM operations against the production Renderer; IPC is used only to inspect/reject evidence.
async function page(stage, saved) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
  const wait = async (read, predicate, message) => {
    const deadline = Date.now() + 15000;
    while (true) {
      const value = await read();
      if (predicate(value)) return value;
      check(Date.now() < deadline, message);
      await sleep();
    }
  };
  const visible = element => element && !element.closest('[hidden]') && element.getClientRects().length > 0;
  const findButton = name => [...document.querySelectorAll('button')].find(element => visible(element)
    && (element.getAttribute('aria-label') === name || element.textContent.trim() === name));
  const click = async name => {
    const element = await wait(() => findButton(name), element => element && !element.disabled, 'Unavailable button: ' + name);
    element.click(); await sleep();
  };
  const field = name => [...document.querySelectorAll('input,select,textarea')].find(element => visible(element)
    && (element.getAttribute('aria-label') === name || element.closest('label')?.firstChild?.textContent?.trim() === name || element.closest('label')?.textContent?.trim() === name));
  const fill = async (name, value) => {
    const element = await wait(() => field(name), element => element && !element.disabled, 'Unavailable field: ' + name);
    const prototype = element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }));
    await sleep();
  };
  const toggle = async (name, value) => {
    const element = await wait(() => field(name), element => element && !element.disabled, 'Unavailable checkbox: ' + name);
    if (element.checked !== value) element.click(); await sleep();
  };
  const text = () => [...document.querySelectorAll('.message p')].map(element => element.textContent);
  const api = window.roundtable;
  const snapshots = {};
  await wait(() => document.querySelector('.app-shell'), Boolean, 'Production App absent');
  const settle = (runId, status, count) => wait(() => api.run.getSnapshot(runId), snapshot => snapshot.status === status
    && (count === undefined || snapshot.turns.length === count) && JSON.stringify(text()) === JSON.stringify(snapshot.messages.map(message => message.content)), 'Run/DOM did not settle: ' + status);
  const roomList = () => api.rooms.listRooms({ includeArchived: true });
  const providerList = () => api.settings.listProviderSummaries();
  const noKey = value => {
    const serialized = JSON.stringify(value);
    check(!/r78-fake-key-(?:one|two|three|final)/u.test(serialized), 'Ordinary DTO contains fake secret');
    check(!/"(?:apiKey|encryptedValue|ciphertext)"/u.test(serialized), 'Ordinary DTO contains secret fields');
    return value;
  };
  if (stage === 'first') {
    check(!findButton('开始协作') || findButton('开始协作').disabled, 'Empty room must not start a legacy demo');
    await click('模型设置');
    await click('新增 Provider'); await fill('Provider 名称', 'Smoke Mock'); await fill('Provider 类型', 'mock');
    await click('保存配置');
    const mock = await wait(providerList, providers => providers.some(provider => provider.name === 'Smoke Mock'), 'Mock Provider not saved');
    saved.mockProviderId = mock.find(provider => provider.name === 'Smoke Mock').id;
    async function realProvider(name) {
      await click('新增 Provider'); await fill('Provider 名称', name); await fill('Base URL', 'https://fixture.invalid/v1');
      await fill('默认模型 ID', 'fixture-model'); await fill('新增模型 ID', 'fixture-model'); await fill('新增模型名称', 'Fixture Model');
      await click('添加自定义模型'); await toggle('我已核对请求目标', true); await click('保存配置');
      const providers = await wait(providerList, values => values.some(value => value.name === name), 'Provider not saved: ' + name);
      const provider = providers.find(value => value.name === name);
      await wait(() => field('API Key'), Boolean, 'Saved Provider editor not loaded');
      return provider.id;
    }
    saved.realProviderId = await realProvider('Smoke Real A');
    const keyState = () => api.settings.getProviderKeyState({ providerId: saved.realProviderId });
    async function saveKey(value) {
      await toggle('我已核对请求目标', true); await fill('API Key', value); await click('保存或替换 Key');
      const state = await wait(keyState, state => state.state === 'configured', 'Fake secure Key not configured');
      check(field('API Key').value === '', 'Secret form not cleared after save'); return noKey(state);
    }
    const firstKey = await saveKey('r78-fake-key-one');
    await toggle('我已核对请求目标', true); await fill('API Key', 'r78-fake-key-two'); await click('保存或替换 Key');
    const replacement = await wait(keyState, state => state.state === 'configured' && state.keyReference.id !== firstKey.keyReference.id, 'Replacement did not revoke old reference');
    await click('删除 Key'); await click('确认删除 Key'); await wait(keyState, state => state.state === 'missing', 'Key deletion not saved');
    await saveKey('r78-fake-key-three');
    await fill('Base URL', 'https://fixture.invalid/v2'); await toggle('我已核对请求目标', true); await click('保存配置');
    await wait(keyState, state => state.state === 'missing', 'Endpoint change did not revoke old Key');
    const finalKey = await saveKey('r78-fake-key-final');
    saved.keyReference = finalKey.keyReference;
    saved.otherProviderId = await realProvider('Smoke Real B');
    const target = await api.settings.getProviderConfiguration({ id: saved.otherProviderId });
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...otherInput } = target;
    let rejected = false; let rejectionEvidence;
    try { await api.settings.updateProvider({ ...otherInput, keyReference: saved.keyReference }); }
    catch (error) { rejectionEvidence = { name: error.name, message: error.message, code: error.code, detail: error.detail, keys: Object.getOwnPropertyNames(error) }; rejected = error.code === 'invalid_input' || error.detail?.code === 'invalid_input'; }
    check(rejected, 'Cross-provider Key reference injection rejection shape: ' + JSON.stringify(rejectionEvidence));
    check((await api.settings.getProviderKeyState({ providerId: saved.otherProviderId })).state === 'missing', 'Other Provider acquired Key');
    await toggle('我已核对请求目标', true); await click('测试鉴权');
    await wait(() => document.body.innerText, value => value.includes('鉴权测试：当前目标或模型缺少已确认的能力、计数或预算信息。'), 'Real Provider reported false network success');
    noKey(await api.settings.listProviderSummaries()); noKey(await api.settings.getProviderConfiguration({ id: saved.realProviderId }));
    noKey(await keyState()); noKey(replacement);
    await click('返回讨论'); await click('房间与成员');
    async function createRoom(name) {
      await click('新建房间'); await fill('房间名称', name); await fill('房间目标', name + ' public goal'); await click('保存房间');
      const rooms = await wait(roomList, values => values.some(value => value.name === name), 'Room not saved: ' + name);
      await wait(() => document.querySelector('.rooms-header h2')?.textContent, value => value === name, 'Created room not selected');
      return rooms.find(value => value.name === name).id;
    }
    saved.roomId = await createRoom('Smoke Roundtable');
    const names = ['Smoke Drafter', 'Smoke Critic', 'Smoke Synthesizer']; const roles = ['Drafter', 'Critic', 'Synthesizer'];
    for (let index = 0; index < names.length; index++) {
      await click('新增成员'); await fill('成员名称', names[index]); await fill('成员角色', roles[index]);
      await fill('System prompt', 'Only use public discussion. ' + roles[index]);
      const providerOptions = await wait(() => field('Provider'), Boolean, 'Provider field absent');
      check([...providerOptions.options].some(option => option.value === saved.realProviderId), 'Settings summary did not refresh in Rooms');
      await fill('Provider', saved.mockProviderId); check(field('Model').value === 'mock', 'Explicit Mock model not selected');
      await click('保存成员'); await wait(() => api.rooms.listAgentConfigurations({ roomId: saved.roomId, includeArchived: false }), values => values.length === index + 1, 'Member not persisted');
      await wait(() => document.querySelector('dialog[open]'), value => !value, 'Member editor did not close');
    }
    saved.agents = await api.rooms.listAgentConfigurations({ roomId: saved.roomId, includeArchived: false });
    check(saved.agents.every(agent => agent.providerId === saved.mockProviderId && agent.modelId === 'mock'), 'Members are not all explicit Mock');
    saved.otherRoomId = await createRoom('Smoke Disposable');
    await click('Smoke Roundtable'); await click('讨论'); await fill('任务目标', 'R78 public three Agent collaboration');
    await click('开始协作'); saved.runId = await wait(() => localStorage.getItem('roundtable.runId'), Boolean, 'Run not selected');
    await wait(text, values => values[0]?.length > 0, 'Partial message not projected');
    await click('暂停'); snapshots.paused = await settle(saved.runId, 'paused', 1);
    check(snapshots.paused.execution.membersSnapshot.length === 3, 'Frozen members missing');
    check(snapshots.paused.execution.membersSnapshot.every(member => member.providerId === saved.mockProviderId && member.modelId === 'mock'), 'Frozen Provider/model identity changed');
    saved.paused = snapshots.paused;
    return { saved, checks: ['real UI Provider/model CRUD', 'fake Key save/replace/delete/endpoint revoke', 'cross-provider reference rejected', 'ordinary DTO secret exclusion', 'real network unsupported', 'room/three explicit Mock members', 'settings summary refreshed in member options', 'start/partial projection/pause'], snapshots };
  }
  check(saved.runId && saved.roomId && saved.realProviderId, 'Missing first-phase manifest');
  if (stage === 'resume') {
    snapshots.refreshed = await settle(saved.runId, 'paused', 1);
    check(JSON.stringify(snapshots.refreshed) === JSON.stringify(saved.paused), 'Refresh changed execution evidence');
    await click('下一步'); snapshots.stepped = await settle(saved.runId, 'paused', 2);
    await click('继续'); snapshots.completed = await settle(saved.runId, 'completed', 3);
    check(snapshots.completed.attempts.length === 3 && new Set(snapshots.completed.attempts.map(attempt => attempt.requestId)).size === 3, 'Three request identities missing');
    await fill('任务目标', 'R78 cancellation and explicit repeat'); await click('开始协作');
    const repeatRunId = await wait(() => localStorage.getItem('roundtable.runId'), id => id && id !== saved.runId, 'Repeat scenario Run absent');
    await wait(text, values => values[0]?.length > 0, 'Stop partial output absent'); await click('停止'); await click('确认停止');
    snapshots.stopped = await settle(repeatRunId, 'cancelled', 1); snapshots.repeats = [];
    for (const name of ['重试当前回合', '续写部分回复']) {
      const before = snapshots.repeats.at(-1) ?? snapshots.stopped;
      await click(name);
      await wait(() => api.run.getSnapshot(repeatRunId), snapshot => snapshot.messages.length === before.messages.length + 1 && snapshot.messages.at(-1).content.length > 0 && text().length === snapshot.messages.length, 'Explicit repeat output absent');
      await click('停止'); await click('确认停止'); const repeated = await settle(repeatRunId, 'cancelled', 1);
      check(JSON.stringify(repeated.messages[0]) === JSON.stringify(snapshots.stopped.messages[0]), 'Repeat changed original partial');
      check(JSON.stringify(repeated.attempts[0]) === JSON.stringify(snapshots.stopped.attempts[0]), 'Repeat changed original request evidence');
      snapshots.repeats.push(repeated);
    }
    saved.repeatRunId = repeatRunId;
    await click('房间与成员'); await click('Smoke Disposable'); await click('讨论');
    check(localStorage.getItem('roundtable.runId') === null && text().length === 0, 'Room switch kept old Run/messages');
    await click('房间与成员'); await click('Smoke Roundtable');
    await click('编辑 Smoke Drafter'); await fill('成员名称', 'Smoke Current Renamed'); await fill('成员角色', 'New Current Role'); await click('保存成员');
    await wait(() => document.querySelector('dialog[open]'), value => !value, 'Member edit did not close');
    await click('删除 Smoke Current Renamed'); await click('确认删除');
    await wait(() => document.querySelector('dialog[open] [role="alert"]')?.textContent, value => value?.includes('受保护'), 'Historical member deletion not protected');
    await click('取消');
    await click('历史记录'); await click('R78 public three Agent collaboration');
    await settle(saved.runId, 'completed', 3);
    check(document.querySelector('.message strong').textContent === 'Smoke Drafter', 'Historical name replaced by current member');
    check(document.querySelector('.message-identity').textContent.includes('Drafter') && !document.querySelector('.message-identity').textContent.includes('New Current Role'), 'Historical role replaced');
    await click('房间与成员'); await click('删除房间'); await click('确认删除');
    await wait(() => document.querySelector('dialog[open] [role="alert"]')?.textContent, value => value?.includes('受保护'), 'Historical room deletion not protected');
    await click('取消'); await click('归档房间'); await click('确认归档');
    await wait(() => document.querySelector('.rooms-header h2')?.textContent, value => value === 'Smoke Disposable', 'Archive did not switch to remaining room');
    await click('删除房间'); await click('确认删除');
    await wait(() => document.querySelector('.rooms-empty h2')?.textContent, value => value === '你的下一场圆桌', 'Last visible room deletion did not clear');
    await click('讨论'); check(text().length === 0 && localStorage.getItem('roundtable.runId') === null && findButton('开始协作').disabled, 'Last-room clear kept old projection/start');
    await click('房间与成员'); await toggle('显示归档房间', true);
    await wait(() => document.querySelector('.rooms-header h2')?.textContent, value => value === 'Smoke Roundtable', 'Archived room unavailable');
    await click('历史记录'); await click('R78 public three Agent collaboration'); await settle(saved.runId, 'completed', 3);
    await click('房间与成员'); await toggle('显示归档房间', false);
    await wait(() => document.querySelector('.rooms-empty h2')?.textContent, value => value === '你的下一场圆桌', 'Filter did not remove last selection');
    await click('讨论'); check(text().length === 0 && localStorage.getItem('roundtable.runId') === null, 'Filter retained Run projection');
    await click('房间与成员'); await toggle('显示归档房间', true);
    await wait(() => findButton('恢复房间'), Boolean, 'Archived selected room missing'); await click('恢复房间');
    await wait(() => findButton('归档房间'), Boolean, 'Room restore failed');
    await click('成员配置'); await click('归档 Smoke Current Renamed'); await click('确认归档');
    await wait(() => document.querySelector('dialog[open]'), value => !value, 'Member archive did not finish');
    await toggle('显示归档成员', true); await wait(() => findButton('恢复 Smoke Current Renamed'), Boolean, 'Archived member not visible');
    await click('恢复 Smoke Current Renamed'); await wait(() => findButton('归档 Smoke Current Renamed'), Boolean, 'Member restore failed');
    await click('历史记录'); await click('R78 public three Agent collaboration'); snapshots.final = await settle(saved.runId, 'completed', 3);
    noKey(snapshots.final); noKey(Object.fromEntries(Object.entries(localStorage)));
    return { saved, checks: ['refresh preserved paused evidence', 'step/resume/three members', 'stop/explicit retry/continue retained original partial and request', 'cross-room projection clear', 'frozen name/role/provider/model', 'member/room history deletion guards', 'archive/delete last room clear', 'archive filter clear', 'room/member restore'], snapshots };
  }
  check(stage === 'restart', 'Unknown UI stage');
  snapshots.restarted = await settle(saved.runId, 'completed', 3);
  check(snapshots.restarted.messages[0].senderName === 'Smoke Drafter', 'Restart changed historical sender');
  noKey(snapshots.restarted);
  const providers = noKey(await providerList());
  check(providers.some(provider => provider.id === saved.mockProviderId) && providers.some(provider => provider.id === saved.realProviderId), 'Provider persistence lost');
  const keyState = noKey(await api.settings.getProviderKeyState({ providerId: saved.realProviderId }));
  check(keyState.state === 'configured' && keyState.keyReference.id === saved.keyReference.id, 'Fake secure Key did not survive restart');
  check((await api.settings.getProviderKeyState({ providerId: saved.otherProviderId })).state === 'missing', 'Cross-provider isolation lost on restart');
  await click('房间与成员'); await wait(() => document.querySelector('.rooms-header h2')?.textContent, value => value === 'Smoke Roundtable', 'Restart room selection missing');
  await click('成员配置'); await wait(() => findButton('编辑 Smoke Current Renamed'), Boolean, 'Edited configuration not restored');
  await click('模型设置'); await wait(() => document.querySelector('.settings-feature'), Boolean, 'Settings not mounted after restart');
  return { saved, checks: ['restart actual Main/Renderer configuration/history', 'fake secure Key persistence and owner isolation', 'edited member restored'], snapshots };
}

module.exports = async (contents, stage, saved = {}) => contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)}, ${JSON.stringify(saved)})`);
