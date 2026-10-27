async function page(stage, saved = {}) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const sleep = () => new Promise(resolve => setTimeout(resolve, 25));
  const wait = async (read, accepts, message) => { const deadline = Date.now() + 60000; for (;;) { const value = await read(); if (accepts(value)) return value; if (Date.now() > deadline) throw new Error(message); await sleep(); } };
  const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const findButton = name => [...document.querySelectorAll('button')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.textContent.trim() === name));
  // R16: 讨论方式 opens from the composer chip, named after the current choice.
  const openWorkflow = async () => { const chip = await wait(() => [...document.querySelectorAll('button')].find(e => visible(e) && e.getAttribute('aria-label')?.startsWith('讨论方式：')), b => b && !b.disabled, 'Unavailable 讨论方式 chip'); chip.click(); await sleep(); };
  const clickIn = async (scope, name) => { const button = await wait(() => [...document.querySelectorAll(scope + ' button')].find(e => visible(e) && e.textContent.trim() === name), b => b && !b.disabled, 'Unavailable button in ' + scope + ': ' + name); button.click(); await sleep(); };
  const click = async name => { const button = await wait(() => findButton(name), b => b && !b.disabled, 'Unavailable button: ' + name); button.click(); await sleep(); };
  const field = name => [...document.querySelectorAll('input,select,textarea')].find(e => visible(e) && (e.getAttribute('aria-label') === name || e.closest('label')?.firstChild?.textContent?.trim() === name));
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
  await click('设置');
  check(document.body.innerText.includes('R10R11 fixture anthropic') && document.body.innerText.includes('R10R11 fixture gemini'), 'Settings page did not identify native providers');
  await click('返回讨论');
  const room = await api.rooms.createRoom({ name: 'R10R11 fixture workflows', objective: 'Finite fixture collaboration' }); saved.roomId = room.id;
  const members = [];
  for (const [index, kind] of ['anthropic', 'gemini', 'anthropic'].entries()) members.push(await api.rooms.createAgent({ roomId: room.id, displayName: 'Native member ' + index, roleTemplateId: 'Role ' + index, systemPrompt: 'Owned system ' + index, providerId: saved.providers[kind], modelId: 'fixture', enabled: true, displayOrder: index }));
  // R16: opening the room list refreshes the sidebar; the sidebar room opens a new discussion in it.
  await click('管理房间与成员'); await clickIn('.sidebar', 'R10R11 fixture workflows');
  const runs = [];
  for (const template of ['free-chat', 'two-model-dialogue', 'review-revision', 'deep-debate']) {
    await openWorkflow(); await fill('工作流模板', template); await fill('最大回合数', '32'); await fill('累计时长上限（毫秒）', '60000'); await fill('单次输出上限（Token）', '128');
    await click('验证并预览'); await wait(() => document.body.innerText, text => text.includes('已验证的计划预览'), 'Main preview did not appear');
    check(saved.runIds.length === runs.length, 'Preview unexpectedly created a Run');
    await click('应用配置'); await wait(() => document.body.innerText, text => text.includes('下次开始将使用'), 'Apply not retained');
    await click('返回讨论'); await fill('讨论目标', 'Fixture workflow ' + template); await click('开始讨论');
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
    await openWorkflow(); await wait(() => document.body.innerText, text => text.includes('已完成'), 'Actual Main progress UI absent');
    check(!document.body.innerText.includes('进度尚未接入'), 'Placeholder progress');
    check(run.execution.membersSnapshot.every(member => members.some(current => current.id === member.agentId && current.providerId === member.providerId)), 'Frozen Provider identity lost');
    runs.push(run); await click('返回讨论');
  }
  return { saved, runs, assertions };
}
module.exports = (contents, stage, saved) => contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)},${JSON.stringify(saved)})`);
