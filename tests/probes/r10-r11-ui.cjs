async function page(stage, saved = {}) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const sleep = () => new Promise(resolve => setTimeout(resolve, 25));
  const wait = async (read, accepts, message) => { const deadline = Date.now() + 60000; for (;;) { const value = await read(); if (accepts(value)) return value; if (Date.now() > deadline) throw new Error(message); await sleep(); } };
  const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const findButton = name => [...document.querySelectorAll('button')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.textContent.trim() === name));
  // R16: 讨论方式 opens from the composer chip, named after the current choice.
  const openWorkflow = async () => { const chip = await wait(() => [...document.querySelectorAll('button')].find(e => visible(e) && e.getAttribute('aria-label')?.startsWith('讨论方式：')), b => b && !b.disabled, 'Unavailable 讨论方式 chip'); chip.click(); await sleep(); };
  const clickIn = async (scope, name) => { const button = await wait(() => [...document.querySelectorAll(scope + ' button')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.textContent.trim() === name)), b => b && !b.disabled, 'Unavailable button in ' + scope + ': ' + name); button.click(); await sleep(); };
  const click = async name => { const button = await wait(() => findButton(name), b => b && !b.disabled, 'Unavailable button: ' + name); button.click(); await sleep(); };
  const field = name => [...document.querySelectorAll('input,select,textarea')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.labels?.[0]?.textContent?.trim() === name || e.closest('label')?.firstChild?.textContent?.trim() === name));
  const fill = async (name, value) => { const input = await wait(() => field(name), Boolean, 'Unavailable field: ' + name); const prototype = input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, value); input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true })); await sleep(); };
  // Plain wrappers (not Proxies: contextBridge objects are frozen) so a rejected call reports which API failed.
  const api = Object.fromEntries(Object.entries(window.roundtable).map(([area, methods]) => [area, Object.fromEntries(Object.entries(methods).map(([name, method]) =>
    [name, typeof method === 'function' ? (...args) => Promise.resolve(method(...args)).catch(error => { throw new Error(`${area}.${name} failed: ${JSON.stringify(error)}`); }) : method]))]));
  await wait(() => document.querySelector('.app-shell'), Boolean, 'App absent');
  check(typeof api.run.previewWorkflow === 'function', 'Typed workflow bridge missing');
  check(!('invoke' in api) && !('resolveKey' in api.settings) && typeof require === 'undefined', 'Bridge privilege leak');
  if (stage === 'restart') {
    check((await api.rooms.listRooms()).some(room => room.id === saved.roomId), 'Room lost');
    for (const runId of saved.runIds) {
      const run = await api.run.getSnapshot(runId);
      check(run.status === 'completed', 'Completed Run changed on restart');
      check(run.workflow.completedTurns === run.workflow.totalTurns, 'Frozen progress lost');
      check(run.turns.length === run.attempts.length, 'Attempt history lost');
    }
    for (const id of Object.values(saved.providers)) check((await api.settings.getProviderKeyState({ providerId: id })).state === 'configured', 'Fake encrypted Key not restored');
    return { saved, assertions };
  }
  saved.providers = {}; saved.runIds = [];
  for (const [kind, baseUrl] of [['anthropic', 'https://api.anthropic.com'], ['gemini', 'https://generativelanguage.googleapis.com/v1beta']]) {
    const provider = await api.settings.createProvider({ name: 'R10R11 fixture ' + kind, kind, defaultModelId: 'fixture', customModels: [{ id: 'fixture', name: 'Owned fixture' }] });
    saved.providers[kind] = provider.id;
    await api.settings.setKey({ providerId: provider.id, apiKey: 'r10r11-fake-' + kind });
    await api.settings.confirmTarget({ providerId: provider.id, baseUrl, confirmed: true });
    const configuration = await api.settings.testConnection({ providerId: provider.id, level: 'configuration' });
    check(configuration.result.ok && configuration.result.level === 'configuration', 'Native local configuration false');
    const models = await api.settings.listModels({ providerId: provider.id });
    check(models.models.some(model => model.id === 'fixture'), 'Native model list not connected');
    const auth = await api.settings.testConnection({ providerId: provider.id, level: 'authentication' });
    check(auth.result.ok && auth.result.level === 'authentication', 'Native authentication fixture false');
    check(!JSON.stringify(await api.settings.getProviderConfiguration({ id: provider.id })).includes('r10r11-fake'), 'Key in public config');
  }
  // R16 batch 2: opening 设置 re-reads the services; each native service is a card with its own status.
  await click('设置');
  await wait(() => document.body.innerText, text => text.includes('R10R11 fixture anthropic') && text.includes('R10R11 fixture gemini'), 'Settings page did not identify native providers');
  const room = await api.rooms.createRoom({ name: 'R10R11 fixture workflows', objective: 'Finite fixture collaboration' }); saved.roomId = room.id;
  const members = [];
  for (const [index, kind] of ['anthropic', 'gemini', 'anthropic'].entries()) members.push(await api.rooms.createAgent({ roomId: room.id, displayName: 'Native member ' + index, roleTemplateId: 'Role ' + index, systemPrompt: 'Owned system ' + index, providerId: saved.providers[kind], modelId: 'fixture', enabled: true, displayOrder: index }));
  // R16: changing page refreshes the sidebar; the room opens on its page, where 新讨论 starts a discussion in it.
  await click('用量'); await clickIn('.sidebar', 'R10R11 fixture workflows'); await clickIn('.room-page', '新讨论');
  const labels = { 'free-chat': '自由讨论', 'two-model-dialogue': '双人对话', 'review-revision': '审查修订链', 'deep-debate': '深度辩论' };
  const runs = [];
  for (const template of ['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate']) {
    // D111: a finished discussion is continued from its box; the next one starts from the explicit 新讨论 button.
    if (!field('讨论目标')) { await clickIn('.controls', '新讨论'); await wait(() => field('讨论目标'), Boolean, 'Goal box absent after 新讨论'); }
    // D116: the dialog is checked by Main as it is edited and remembered for the room; every start checks it again.
    await openWorkflow();
    const choice = await wait(() => [...document.querySelectorAll('dialog[open] .choice')].find(e => e.textContent.startsWith(labels[template])), Boolean, 'Template card absent: ' + template); choice.click(); await sleep();
    await fill('最多回合', '32'); await fill('时长上限', '1'); await fill('单次发言上限', '128');
    await wait(() => document.querySelector('dialog[open]')?.textContent, text => text?.includes('已核对：预计'), 'Main check did not appear');
    check(saved.runIds.length === runs.length, 'The check unexpectedly created a Run');
    await clickIn('dialog[open]', '用于这个房间'); await wait(() => document.querySelector('dialog[open]'), value => !value, 'Dialog did not close');
    await wait(() => findButton('讨论方式：' + labels[template]), Boolean, 'Mode not remembered for the room');
    await fill('讨论目标', 'Fixture workflow ' + template); await click('开始讨论');
    const runId = await wait(() => localStorage.getItem('roundtable.runId'), id => id && !saved.runIds.includes(id), 'New Run absent'); saved.runIds.push(runId);
    if (template === 'free-chat') {
      await wait(() => api.run.getSnapshot(runId), run => run.messages[0]?.content, 'No streamed partial'); await click('暂停');
      const paused = await wait(() => api.run.getSnapshot(runId), run => run.status === 'paused', 'Pause failed');
      check(paused.turns.length === 1 && paused.workflow.completedTurns === 1, 'Pause advanced extra step');
      await click('下一步'); const stepped = await wait(() => api.run.getSnapshot(runId), run => run.status === 'paused' && run.turns.length === 2, 'Step failed');
      check(stepped.workflow.completedTurns === 2, 'Step projection wrong'); await click('继续');
    }
    const run = await wait(() => api.run.getSnapshot(runId), run => run.status === 'completed' || run.status === 'error', 'Plan did not terminate');
    check(run.status === 'completed', 'Workflow failed: ' + template);
    check(run.workflow.templateId === template, 'Template not persisted');
    check(run.workflow.completedTurns === run.workflow.totalTurns, 'Main progress incomplete');
    check(JSON.stringify(run.turns.map(turn => turn.agentId)) === JSON.stringify(run.workflowSnapshot.steps.map(step => step.agentId)), 'Execution did not follow frozen steps');
    check(run.attempts.length === run.turns.length && run.attempts.every(attempt => attempt.status === 'completed'), 'Attempt persistence inconsistent');
    check(new Set(run.attempts.map(attempt => attempt.requestId)).size === run.attempts.length, 'Duplicate request identity');
    check(!JSON.stringify(run).includes('r10r11-fake'), 'Key in history');
    // 本场信息 › 进度 shows Main's own progress: every step and stage done.
    await wait(() => document.querySelector('[role=status][aria-label="运行状态"]')?.textContent, text => text?.includes(`第 ${run.workflow.totalTurns}/${run.workflow.totalTurns} 步`) && text.includes(labels[template]), 'Actual Main progress UI absent');
    check(document.querySelectorAll('.thread-item .msg-head .tag').length >= run.turns.length, 'Each plan message carries its stage');
    check(run.execution.membersSnapshot.every(member => members.some(current => current.id === member.agentId && current.providerId === member.providerId)), 'Frozen Provider identity lost');
    runs.push(run);
  }
  return { saved, runs, assertions };
}
module.exports = (contents, stage, saved) => contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)},${JSON.stringify(saved)})`);
