// DOM operations against the production Renderer; IPC is used only to inspect/reject evidence.
async function page(stage, saved) {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
  const wait = async (read, predicate, message) => {
    // The Electron side reads the step recorded last when a phase overruns its deadline.
    window.__r78Step = stage + ': ' + message;
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
  // R16: rooms and discussions also appear in the sidebar; clickIn picks the one inside a given area.
  const clickIn = async (scope, name) => {
    const element = await wait(() => [...document.querySelectorAll(scope + ' button')].find(element => visible(element) && element.textContent.trim() === name), element => element && !element.disabled, 'Unavailable button in ' + scope + ': ' + name);
    element.click(); await sleep();
  };
  const click = async name => {
    const element = await wait(() => findButton(name), element => element && !element.disabled, 'Unavailable button: ' + name);
    element.click(); await sleep();
  };
  // R16: fields are labelled with <label for>; the visible label text names the control.
  // While a modal dialog is open the page behind it is inert: look for fields in the dialog.
  const field = name => [...(document.querySelector('dialog[open]') ?? document).querySelectorAll('input,select,textarea')].find(element => visible(element)
    && (element.getAttribute('aria-label') === name || element.labels?.[0]?.textContent?.trim() === name || element.closest('label')?.firstChild?.textContent?.trim() === name || element.closest('label')?.textContent?.trim() === name));
  // A choice card or a list row is named by its first words (its description follows).
  const clickPrefix = async (name, scope = document) => {
    const element = await wait(() => [...scope.querySelectorAll('button')].find(element => visible(element) && (n => { const c = n.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent.trim(); })(element).startsWith(name)), element => element && !element.disabled, 'Unavailable button: ' + name + '…');
    element.click(); await sleep();
  };
  const card = name => document.querySelector('section[aria-label="' + name + '"]');
  const clickInCard = async (cardName, name) => {
    const element = await wait(() => card(cardName) && [...card(cardName).querySelectorAll('button')].find(element => visible(element) && (element.textContent.trim() === name || element.getAttribute('aria-label') === name)), element => element && !element.disabled, 'Unavailable button in ' + cardName + ': ' + name);
    element.click(); await sleep();
  };
  const openAdvanced = async cardName => { const details = await wait(() => card(cardName)?.querySelector('details.adv'), Boolean, 'Advanced section missing: ' + cardName); if (!details.open) { details.querySelector('summary').click(); await sleep(); } };
  const dialog = () => document.querySelector('dialog[open]');
  const closeWizard = () => wait(dialog, value => !value, 'Wizard did not close');
  // The member menu: 编辑…, 上移, 下移, 归档, 删除….
  const memberAction = async (member, action) => {
    await click('「' + member + '」：编辑、排序、归档、删除');
    const item = await wait(() => [...document.querySelectorAll('[role=menu] button')].find(element => element.textContent.trim() === action), element => element && !element.disabled, 'Menu item unavailable: ' + action);
    item.click(); await sleep();
  };
  const roomTitle = () => document.querySelector('.room-page .page-head h1')?.firstChild?.textContent;
  const openRoom = async name => { await clickPrefix(name, document.querySelector('.sidebar')); await wait(roomTitle, value => value === name, 'Room page not opened: ' + name); };
  const openRun = async task => {
    const row = await wait(() => [...document.querySelectorAll('.run-list li')].find(element => element.querySelector('b')?.textContent === task), Boolean, 'Run not listed: ' + task);
    row.querySelector('button').click(); await sleep();
  };
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
  // R16: one .thread-item per slot; a member's text is its Markdown body, the host's is its bubble.
  // R16 renders replies as Markdown, which drops trailing whitespace (a reply stopped right after a space ends in one);
  // the DOM and Main are compared without it. Everything else must match exactly.
  const visibleText = value => value.trimEnd();
  const text = () => [...document.querySelectorAll('.thread-item')].map(item => visibleText(item.querySelector('.msg-body .md, .bubble')?.textContent ?? ''));
  // R12: the timeline shows one entry per message slot (its effective version); other versions stay one click away.
  const effective = snapshot => { if (!snapshot.versions) return snapshot.messages.map(message => visibleText(message.content));
    const slots = new Map(); for (const message of snapshot.messages) { const version = snapshot.versions.find(item => item.messageId === message.id); if (!version) continue;
      const group = slots.get(version.slotId) ?? []; group.push({ ...version, content: message.content }); slots.set(version.slotId, group); }
    return [...slots.values()].map(group => { group.sort((a, b) => a.versionNumber - b.versionNumber); return visibleText((group.find(version => version.active) ?? group.at(-1)).content); }); };
  // Steps back through a slot's earlier versions in the real UI, checks each against Main, then returns to the effective one.
  const history = async (snapshot, slotIndex) => {
    const article = () => document.querySelectorAll('.thread-item')[slotIndex]; const version = snapshot.versions.find(item => item.messageId === snapshot.messages[0].id);
    const versions = snapshot.versions.filter(item => item.slotId === version.slotId).sort((a, b) => a.versionNumber - b.versionNumber);
    const contentOf = id => visibleText(snapshot.messages.find(message => message.id === id).content);
    const shown = () => visibleText(article().querySelector('.msg-body .md').textContent); const step = label => article().querySelector('button[aria-label="' + label + '"]').click();
    check(article().textContent.includes('版本 ' + versions.length + '/' + versions.length), 'Version count missing');
    for (let index = versions.length - 2; index >= 0; index--) { step('查看上一个版本'); await sleep(); check(shown() === contentOf(versions[index].messageId), 'Earlier version not reachable'); }
    for (let index = 1; index < versions.length; index++) { step('查看下一个版本'); await sleep(); }
    check(shown() === contentOf(versions.at(-1).messageId), 'Did not return to the effective version');
    return versions.length;
  };

  const api = window.roundtable;
  const snapshots = {};
  await wait(() => document.querySelector('.app-shell'), Boolean, 'Production App absent');
  let lastSeen;
  const settle = (runId, status, count) => wait(() => api.run.getSnapshot(runId), snapshot => { lastSeen = { status: snapshot.status, turns: snapshot.turns.length, dom: text(), main: effective(snapshot) }; return snapshot.status === status
    && (count === undefined || snapshot.turns.length === count) && JSON.stringify(text()) === JSON.stringify(effective(snapshot)); }, 'Run/DOM did not settle')
    // Report the state seen last, not the one before waiting started.
    .catch(error => { throw new Error(error.message + ': ' + status + ' ' + JSON.stringify(lastSeen ?? {})); });
  const roomList = () => api.rooms.listRooms({ includeArchived: true });
  const providerList = () => api.settings.listProviderSummaries();
  const noKey = value => {
    const serialized = JSON.stringify(value);
    check(!/r78-fake-key-(?:one|two|three|final)/u.test(serialized), 'Ordinary DTO contains fake secret');
    check(!/"(?:apiKey|encryptedValue|ciphertext)"/u.test(serialized), 'Ordinary DTO contains secret fields');
    return value;
  };
  if (stage === 'first') {
    // D6-A: with no service and no room the welcome page shows; nothing starts and no demo is created implicitly.
    await wait(() => document.querySelector('.welcome'), Boolean, 'Welcome page absent');
    check(!findButton('开始讨论'), 'Empty profile must not offer a start');
    await click('设置');
    await click('添加服务'); await clickPrefix('演示（Mock）', dialog()); await click('添加演示服务');
    const mock = await wait(providerList, providers => providers.some(provider => provider.kind === 'mock'), 'Mock Provider not saved');
    saved.mockProviderId = mock.find(provider => provider.kind === 'mock').id;
    await closeWizard();
    const keyState = id => api.settings.getProviderKeyState({ providerId: id });
    const secretsGone = () => check(!/r78-fake-key-/u.test(document.body.innerHTML) && [...document.querySelectorAll('input')].every(input => !input.value.startsWith('r78-fake-key-')), 'Secret left in the page');
    // A catalog service: pick it, the Key, save (D136, D143).
    async function realProvider(name, key, address) {
      await click('添加服务'); await clickPrefix(name, dialog());
      check(dialog().querySelector('.target').textContent === 'Key 只会发往 ' + address, 'Target not written above the Key');
      await fill('API Key', key); await click('保存');
      const providers = await wait(providerList, values => values.some(value => value.name === name), 'Provider not saved: ' + name);
      const provider = providers.find(value => value.name === name);
      await wait(() => keyState(provider.id), state => state.state === 'configured', 'Key not saved: ' + name);
      await closeWizard(); secretsGone();
      // The first real service goes straight to its discussion (D136); the probe goes back to settings.
      await sleep(); if (!card(name)) await click('设置');
      return provider.id;
    }
    saved.realProviderId = await realProvider('DeepSeek', 'r78-fake-key-one', 'https://api.deepseek.com');
    const firstKey = noKey(await keyState(saved.realProviderId));
    async function rekey(cardName, label, value) {
      await wait(() => card(cardName), Boolean, 'Card absent: ' + cardName);
      if (!card(cardName).querySelector('.svc-body')) await clickInCard(cardName, '展开 ' + cardName);
      await wait(() => [...card(cardName).querySelectorAll('button')].some(element => element.textContent.trim() === label), Boolean, 'Key button absent: ' + label);
      await clickInCard(cardName, label); await fill('API Key', value); await click('保存');
    }
    await rekey('DeepSeek', '更换', 'r78-fake-key-two');
    const replacement = await wait(() => keyState(saved.realProviderId), state => state.state === 'configured' && state.keyReference.id !== firstKey.keyReference.id, 'Replacement did not revoke old reference');
    await closeWizard(); secretsGone();
    await openAdvanced('DeepSeek'); await clickInCard('DeepSeek', '删除 Key…'); await clickInCard('DeepSeek', '确认删除 Key');
    await wait(() => keyState(saved.realProviderId), state => state.state === 'missing', 'Key deletion not saved');
    await rekey('DeepSeek', '填写 Key', 'r78-fake-key-three');
    await wait(() => keyState(saved.realProviderId), state => state.state === 'configured', 'Third Key not saved'); await closeWizard();
    await rekey('DeepSeek', '更换', 'r78-fake-key-final');
    const finalKey = noKey(await wait(() => keyState(saved.realProviderId), state => state.state === 'configured', 'Final Key not saved')); await closeWizard(); secretsGone();
    saved.keyReference = finalKey.keyReference;
    saved.otherProviderId = await realProvider('Kimi', 'r78-fake-key-b', 'https://api.moonshot.cn/v1');
    if (!card('Kimi').querySelector('.svc-body')) await clickInCard('Kimi', '展开 Kimi');
    await openAdvanced('Kimi'); await clickInCard('Kimi', '删除 Key…'); await clickInCard('Kimi', '确认删除 Key');
    await wait(() => keyState(saved.otherProviderId), state => state.state === 'missing', 'Kimi Key not deleted');
    const target = await api.settings.getProviderConfiguration({ id: saved.otherProviderId });
    const { keyReference: _key, createdAt: _created, updatedAt: _updated, ...otherInput } = target;
    let rejected = false; let rejectionEvidence;
    try { await api.settings.updateProvider({ ...otherInput, keyReference: saved.keyReference }); }
    catch (error) { rejectionEvidence = { name: error.name, message: error.message, code: error.code, detail: error.detail, keys: Object.getOwnPropertyNames(error) }; rejected = error.code === 'invalid_input' || error.detail?.code === 'invalid_input'; }
    check(rejected, 'Cross-provider Key reference injection rejection shape: ' + JSON.stringify(rejectionEvidence));
    check((await api.settings.getProviderKeyState({ providerId: saved.otherProviderId })).state === 'missing', 'Other Provider acquired Key');
    // 测试连接 tells what it found; the network is off here, and nothing pretends it succeeded.
    if (!card('DeepSeek').querySelector('.svc-body')) await clickInCard('DeepSeek', '展开 DeepSeek');
    await clickInCard('DeepSeek', '测试连接');
    await wait(() => card('DeepSeek').querySelector('.svc-checks .status-text')?.textContent, value => Boolean(value) && !value.includes('连接正常'), 'Real Provider reported false network success');
    check(card('DeepSeek').textContent.includes('上下文 128,000 · 最大输出 8,192'), 'Model limits not stated');
    noKey(await api.settings.listProviderSummaries()); noKey(await api.settings.getProviderConfiguration({ id: saved.realProviderId }));
    noKey(await keyState(saved.realProviderId)); noKey(replacement);
    // D167: the first real service opens a new 独立讨论 and makes no project.
    check((await roomList()).length === 0, 'Connecting a service made a project');
    async function createRoom(name) {
      await click('新建项目'); await fill('项目名称', name); await fill('默认目标可选', name + ' public goal'); await click('新建');
      const rooms = await wait(roomList, values => values.some(value => value.name === name), 'Room not saved: ' + name);
      await wait(roomTitle, value => value === name, 'Created room not opened');
      const created = rooms.find(value => value.name === name).id;
      localStorage.setItem(`roundtable.mode.${created}`, 'free-chat');
      return created;
    }
    saved.roomId = await createRoom('Smoke Roundtable');
    // The three default members take the default service, which has a Key: replace them with explicit Mock members.
    const starters = await api.rooms.listAgentConfigurations({ roomId: saved.roomId, includeArchived: false });
    check(starters.map(agent => agent.displayName).join() === '林舟,阿哲,小雨' && starters.every(agent => agent.providerId === saved.realProviderId), 'Default members missing or silently on Mock');
    for (const starter of starters) { await memberAction(starter.displayName, '删除…'); await clickIn('dialog[open]', '删除'); await wait(dialog, value => !value, 'Member deletion did not finish'); }
    const names = ['Smoke Drafter', 'Smoke Critic', 'Smoke Synthesizer']; const roles = ['Drafter', 'Critic', 'Synthesizer'];
    for (let index = 0; index < names.length; index++) {
      await click('添加成员'); await clickPrefix('自定义', dialog()); await fill('名字', names[index]); await fill('角色', roles[index]);
      await fill('设定可选', 'Only use public discussion. ' + roles[index]);
      const modelOptions = await wait(() => field('模型'), Boolean, 'Model field absent');
      check([...modelOptions.options].some(option => option.value.startsWith(saved.realProviderId + '\u0000')), 'Settings summary did not refresh in member options');
      await fill('模型', saved.mockProviderId + '\u0000mock');
      check(dialog().textContent.includes('演示成员不联网'), 'Mock choice not explained');
      await clickIn('dialog[open]', '添加'); await wait(() => api.rooms.listAgentConfigurations({ roomId: saved.roomId, includeArchived: false }), values => values.length === index + 1, 'Member not persisted');
      await wait(dialog, value => !value, 'Member editor did not close');
    }
    saved.agents = await api.rooms.listAgentConfigurations({ roomId: saved.roomId, includeArchived: false });
    check(saved.agents.every(agent => agent.providerId === saved.mockProviderId && agent.modelId === 'mock'), 'Members are not all explicit Mock');
    saved.otherRoomId = await createRoom('Smoke Disposable');
    await openRoom('Smoke Roundtable'); await clickIn('.room-page', '新讨论');
    await fill('讨论目标', 'R78 public three Agent collaboration');
    await click('开始讨论'); saved.runId = await wait(() => localStorage.getItem('roundtable.runId'), Boolean, 'Run not selected');
    await wait(text, values => values[0]?.length > 0, 'Partial message not projected');
    await click('暂停'); snapshots.paused = await settle(saved.runId, 'paused', 1);
    check(snapshots.paused.execution.membersSnapshot.length === 3, 'Frozen members missing');
    check(snapshots.paused.execution.membersSnapshot.every(member => member.providerId === saved.mockProviderId && member.modelId === 'mock'), 'Frozen Provider/model identity changed');
    saved.paused = snapshots.paused;
    return { saved, checks: ['welcome page, no implicit demo', 'connect wizard: Mock and compatible services, address above the Key confirmed by saving', 'fake Key save/replace/delete/endpoint revoke', 'cross-provider reference rejected', 'ordinary DTO and page secret exclusion', 'real network unsupported stated honestly', 'D6 starter room deletable', 'default members without a model, replaced by explicit Mock members', 'settings summary refreshed in member options', 'start/partial projection/pause'], snapshots };
  }
  check(saved.runId && saved.roomId && saved.realProviderId, 'Missing first-phase manifest');
  if (stage === 'resume') {
    snapshots.refreshed = await settle(saved.runId, 'paused', 1);
    check(JSON.stringify(snapshots.refreshed) === JSON.stringify(saved.paused), 'Refresh changed execution evidence');
    await click('下一步'); snapshots.stepped = await settle(saved.runId, 'paused', 2);
    await click('继续'); snapshots.completed = await settle(saved.runId, 'completed', 3);
    check(snapshots.completed.attempts.length === 3 && new Set(snapshots.completed.attempts.map(attempt => attempt.requestId)).size === 3, 'Three request identities missing');
    // D111: a finished discussion keeps a box that continues it; a new discussion is the explicit 新讨论 button.
    await wait(() => field('继续讨论'), Boolean, 'Completed Run did not offer to continue in place');
    check(!field('讨论目标'), 'Completed Run offered a new-goal box');
    await clickIn('.controls', '新讨论');
    await fill('讨论目标', 'R78 cancellation and explicit repeat'); await click('开始讨论');
    const repeatRunId = await wait(() => localStorage.getItem('roundtable.runId'), id => id && id !== saved.runId, 'Repeat scenario Run absent');
    await wait(text, values => values[0]?.length > 0, 'Stop partial output absent'); await click('停止'); await click('停止讨论');
    snapshots.stopped = await settle(repeatRunId, 'cancelled', 1); snapshots.repeats = [];
    for (const name of ['重试当前回合', '续写部分回复']) {
      const before = snapshots.repeats.at(-1) ?? snapshots.stopped;
      await click(name);
      await wait(() => api.run.getSnapshot(repeatRunId), snapshot => snapshot.messages.length === before.messages.length + 1 && snapshot.messages.at(-1).content.length > 0 && JSON.stringify(text()) === JSON.stringify(effective(snapshot)), 'Explicit repeat output absent');
      await click('停止'); await click('停止讨论'); const repeated = await settle(repeatRunId, 'cancelled', 1);
      check(JSON.stringify(repeated.messages[0]) === JSON.stringify(snapshots.stopped.messages[0]), 'Repeat changed original partial');
      check(JSON.stringify(repeated.attempts[0]) === JSON.stringify(snapshots.stopped.attempts[0]), 'Repeat changed original request evidence');
      snapshots.repeats.push(repeated);
    }
    check(await history(snapshots.repeats.at(-1), 0) === 3, 'Original, retry and continuation versions must all stay reachable');
    saved.repeatRunId = repeatRunId;
    await openRoom('Smoke Disposable');
    check(localStorage.getItem('roundtable.runId') === null && text().length === 0, 'Room switch kept old Run/messages');
    await openRoom('Smoke Roundtable');
    await memberAction('Smoke Drafter', '编辑…'); await fill('名字', 'Smoke Current Renamed'); await fill('角色', 'New Current Role'); await clickIn('dialog[open]', '保存');
    await wait(dialog, value => !value, 'Member edit did not close');
    await memberAction('Smoke Current Renamed', '删除…'); await clickIn('dialog[open]', '删除');
    await wait(() => document.querySelector('dialog[open] [role="alert"]')?.textContent, value => value?.includes('已有讨论记录引用了它'), 'Historical member deletion not protected');
    await clickIn('dialog[open]', '取消');
    await openRun('R78 public three Agent collaboration');
    await settle(saved.runId, 'completed', 3);
    check(document.querySelector('.thread-item .msg-name').textContent === 'Smoke Drafter', 'Historical name replaced by current member');
    document.querySelector('.thread-item button[aria-label="请求详情"]').click(); await sleep();
    check(document.querySelector('.msg-details').textContent.includes('Drafter') && !document.querySelector('.msg-details').textContent.includes('New Current Role'), 'Historical role replaced');
    // A room with discussions cannot be deleted at all (no request is offered); it can be archived.
    await openRoom('Smoke Roundtable');
    check(findButton('删除…').disabled && document.body.innerText.includes('这个项目已经有讨论记录，不能删除；可以归档。'), 'Historical room deletion not protected');
    await click('归档'); await wait(() => findButton('恢复项目'), Boolean, 'Archive did not finish');
    check((await roomList()).find(room => room.id === saved.roomId).archivedAt !== null, 'Room not archived');
    await openRoom('Smoke Disposable'); await click('删除…'); await clickIn('dialog[open]', '删除');
    await wait(() => document.querySelector('.room-page'), value => !value, 'Deleted room page still shown');
    check(text().length === 0 && localStorage.getItem('roundtable.runId') === null && findButton('开始讨论').disabled, 'Last-room clear kept old projection/start');
    // The archived room stays reachable from the folded list, with its history.
    await click('已归档（1）'); await openRoom('Smoke Roundtable');
    await openRun('R78 public three Agent collaboration'); await settle(saved.runId, 'completed', 3);
    await openRoom('Smoke Roundtable'); await click('恢复项目');
    await wait(() => findButton('归档'), Boolean, 'Room restore failed');
    await memberAction('Smoke Current Renamed', '归档'); await wait(() => findButton('已归档的成员（1）'), Boolean, 'Archived member not visible');
    await click('已归档的成员（1）'); await click('恢复');
    await wait(() => findButton('Smoke Current Renamed 参与讨论'), Boolean, 'Member restore failed');
    await openRun('R78 public three Agent collaboration'); snapshots.final = await settle(saved.runId, 'completed', 3);
    noKey(snapshots.final); noKey(Object.fromEntries(Object.entries(localStorage)));
    return { saved, checks: ['refresh preserved paused evidence', 'step/resume/three members', 'stop/explicit retry/continue retained original partial and request', 'cross-room projection clear', 'frozen name/role/provider/model', 'member/room history deletion guards', 'archive, delete last visible room clears', 'archived room reachable with history', 'room/member restore'], snapshots };
  }
  check(stage === 'restart', 'Unknown UI stage');
  // R16: the layout pass ended on the room page, which shows the room rather than a discussion; open the Run from its list.
  await openRoom('Smoke Roundtable'); await openRun('R78 public three Agent collaboration');
  snapshots.restarted = await settle(saved.runId, 'completed', 3);
  check(snapshots.restarted.messages[0].senderName === 'Smoke Drafter', 'Restart changed historical sender');
  noKey(snapshots.restarted);
  const providers = noKey(await providerList());
  check(providers.some(provider => provider.id === saved.mockProviderId) && providers.some(provider => provider.id === saved.realProviderId), 'Provider persistence lost');
  const keyState = noKey(await api.settings.getProviderKeyState({ providerId: saved.realProviderId }));
  check(keyState.state === 'configured' && keyState.keyReference.id === saved.keyReference.id, 'Fake secure Key did not survive restart');
  check((await api.settings.getProviderKeyState({ providerId: saved.otherProviderId })).state === 'missing', 'Cross-provider isolation lost on restart');
  await openRoom('Smoke Roundtable');
  await wait(() => findButton('Smoke Current Renamed 参与讨论'), Boolean, 'Edited configuration not restored');
  await click('设置'); await wait(() => document.querySelector('.settings-shell'), Boolean, 'Settings not mounted after restart');
  // D113: the remembered confirmation survived the restart for the unchanged Key.
  return { saved, checks: ['restart actual Main/Renderer configuration/history', 'fake secure Key persistence and owner isolation', 'edited member restored'], snapshots };
}

module.exports = async (contents, stage, saved = {}) => contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)}, ${JSON.stringify(saved)})`);
