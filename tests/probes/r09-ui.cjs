// Real DOM interactions in the production App. Bridge calls below inspect evidence only.
async function page(stage, saved, endpoint) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const sleep = () => new Promise(r => setTimeout(r,30));
  const wait = async (read, accept, message) => { const end=Date.now()+15000; while(true){ const value=await read(); if(accept(value))return value;check(Date.now()<end,message);await sleep();} };
  const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length>0;
  const button = name => [...document.querySelectorAll('button')].find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.textContent.trim()===name));
  const clickIn=async(scope,name)=>{const e=await wait(()=>[...document.querySelectorAll(scope+' button')].find(e=>visible(e)&&e.textContent.trim()===name),e=>e&&!e.disabled,'Unavailable button in '+scope+': '+name);e.click();await sleep();};
  const click = async name => {const e=await wait(()=>button(name),e=>e&&!e.disabled,'Unavailable button '+name);e.click();await sleep();};
  const field = name => [...document.querySelectorAll('input,select,textarea')].find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.closest('label')?.firstChild?.textContent?.trim()===name||e.closest('label')?.textContent?.trim()===name));
  const fill = async(name,value)=>{const e=await wait(()=>field(name),e=>e&&!e.disabled,'Unavailable field '+name);const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await sleep();};
  const toggle=async(name,value)=>{const e=await wait(()=>field(name),e=>e&&!e.disabled,'Unavailable checkbox '+name);if(e.checked!==value)e.click();await sleep();};
  const api=window.roundtable;
  const noKey=value=>{check(!JSON.stringify(value).includes('r09-fake-key-'),'Plain Key leaked');return value;};
  // R16 renders replies as Markdown, which drops trailing whitespace (a reply stopped right after a space ends in one);
  // the DOM and Main are compared without it. Everything else must match exactly.
  const visibleText=value=>value.trimEnd();
  const text=()=>[...document.querySelectorAll('.thread-item')].map(item=>visibleText(item.querySelector('.msg-body .md, .bubble')?.textContent??''));
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

  const settle=(id,status)=>wait(()=>api.run.getSnapshot(id),s=>s.status===status&&JSON.stringify(text())===JSON.stringify(effective(s)),'Run/DOM not settled '+status);
  await wait(()=>document.querySelector('.app-shell'),Boolean,'App absent');
  const snapshots={};
  if(stage==='first'){
    await click('设置');
    for(const [name,kind,url,key] of [['R09 fixture Compatible','openai-compatible',endpoint,'r09-fake-key-compatible'],['R09 fixture Official','openai','','r09-fake-key-official']]){
      await click('新增 Provider');await fill('Provider 名称',name);await fill('Provider 类型',kind);await fill('Base URL',url);await fill('默认模型 ID','fixture');await fill('新增模型 ID','fixture');await fill('新增模型名称','Owned local fixture');await click('添加自定义模型');await toggle('我已核对请求目标',true);await click('保存配置');
      const values=await wait(()=>api.settings.listProviderSummaries(),ps=>ps.some(p=>p.name===name),'Provider not created');const p=values.find(p=>p.name===name);saved[kind]=p.id;
      await wait(()=>field('API Key'),Boolean,'Key editor absent');await toggle('我已核对请求目标',true);await fill('API Key',key);await click('保存或替换 Key');
      await wait(()=>api.settings.getProviderKeyState({providerId:p.id}),s=>s.state==='configured','Fake encrypted Key missing');check(field('API Key').value==='','Secret form retained');
      await toggle('我已核对请求目标',true);await click('确认本次会话目标');
      await click('检查配置');await wait(()=>document.body.innerText,t=>t.includes('配置检查：通过（仅本地配置）'),'Configuration test false semantics');
      await click('获取模型列表');await wait(()=>document.body.innerText,t=>t.includes('模型列表：已获取'),'Models not fetched');
      await click('测试鉴权');await wait(()=>document.body.innerText,t=>t.includes('鉴权测试：通过'),'Authentication failed');
      await fill('生成测试模型 ID','fixture');await toggle('我确认本次生成测试可能产生费用',true);await click('发起生成测试');await wait(()=>document.body.innerText,t=>t.includes('生成测试：通过'),'Explicit fixture generation failed');
      noKey(await api.settings.getProviderConfiguration({id:p.id}));
    }
    await click('返回讨论');await click('管理房间与成员');await click('新建房间');await fill('房间名称','R09 fixture Room');await fill('房间目标','Local HTTP public collaboration');await click('保存房间');
    saved.roomId=(await wait(()=>api.rooms.listRooms(),rs=>rs.some(r=>r.name==='R09 fixture Room'),'Room absent')).find(r=>r.name==='R09 fixture Room').id;
    await wait(()=>document.querySelector('.rooms-header h2')?.textContent,t=>t==='R09 fixture Room','Room not selected');
    for(let i=0;i<3;i++){
      await click('新增成员');await fill('成员名称','R09 Agent '+i);await fill('成员角色','Role '+i);await fill('System prompt','R09 system '+i);await fill('Provider',i===1?saved.openai:saved['openai-compatible']);await fill('Model','fixture');await click('保存成员');await wait(()=>document.querySelector('dialog[open]'),d=>!d,'Member dialog did not close');
    }
    check((await api.rooms.listAgentConfigurations({roomId:saved.roomId})).length===3,'Not three members');
    await click('返回讨论');await fill('讨论目标','R09 three Agent public context');await click('开始讨论');saved.runId=await wait(()=>localStorage.getItem('roundtable.runId'),Boolean,'Run absent');
    await wait(text,ts=>ts[0]?.length>0,'No real HTTP partial');await click('暂停');snapshots.paused=await settle(saved.runId,'paused');check(snapshots.paused.turns.length===1,'Pause crossed next turn');
    check(snapshots.paused.execution.membersSnapshot.every(m=>m.modelId==='fixture'),'Frozen model mismatch');
    return {saved,snapshots,assertions};
  }
  if(stage==='resume'){
    snapshots.refreshed=await settle(saved.runId,'paused');await click('下一步');snapshots.stepped=await settle(saved.runId,'paused');check(snapshots.stepped.turns.length===2,'Step count');
    await click('继续');snapshots.completed=await settle(saved.runId,'completed');check(snapshots.completed.attempts.length===3,'No three HTTP Attempts');
    check(new Set(snapshots.completed.attempts.map(a=>a.requestId)).size===3,'Request IDs not unique');noKey(snapshots.completed);
    check(snapshots.completed.execution.membersSnapshot[1].providerId===saved.openai,'Official frozen binding lost');
    return {saved,snapshots,assertions};
  }
  if(stage==='stop'){
    // D111: the previous Run completed, so its box continues it; a new discussion is the explicit 新讨论 button.
    await wait(()=>field('继续讨论'),Boolean,'Completed Run did not offer to continue in place');check(!field('讨论目标'),'Completed Run offered a new-goal box');
    await clickIn('.controls','新讨论');
    await fill('讨论目标','R09 hanging HTTP output');await click('开始讨论');saved.stopRunId=await wait(()=>localStorage.getItem('roundtable.runId'),id=>id&&id!==saved.runId,'Stop Run absent');
    await wait(text,ts=>ts[0]?.length>0,'No partial before Stop');await click('停止'); await click('停止讨论');snapshots.stopped=await settle(saved.stopRunId,'cancelled');check(snapshots.stopped.messages[0].content.length>0,'Stop lost partial');check(snapshots.stopped.attempts[0].status==='aborted','Attempt not aborted');
    for(const name of ['重试当前回合','续写部分回复']){
      const before=snapshots.repeated??snapshots.stopped;await click(name);await wait(()=>api.run.getSnapshot(saved.stopRunId),s=>s.messages.length===before.messages.length+1&&s.messages.at(-1).content.length>0,'Explicit repeat missing');await click('停止'); await click('停止讨论');snapshots.repeated=await settle(saved.stopRunId,'cancelled');check(JSON.stringify(snapshots.repeated.messages[0])===JSON.stringify(snapshots.stopped.messages[0]),'Repeat overwrote original partial');
    }
    check(await history(snapshots.repeated,0)===3,'Original, retry and continuation versions must all stay reachable');
    noKey(snapshots.repeated);return {saved,snapshots,assertions};
  }
  if(stage==='restart'){
    await wait(()=>api.rooms.listRooms(),rs=>rs.some(r=>r.id===saved.roomId),'Room configuration lost');
    await click('管理房间与成员');await clickIn('.rooms-feature','R09 fixture Room');await click('历史记录');await clickIn('.rooms-feature','R09 three Agent public context');snapshots.restarted=await settle(saved.runId,'completed');check(snapshots.restarted.attempts.length===3,'History lost on restart');
    for(const id of [saved.openai,saved['openai-compatible']])check((await api.settings.getProviderKeyState({providerId:id})).state==='configured','Fake secure Key not restored');
    // An explicit click must fail closed after restart until Main target confirmation is renewed.
    // The reopened Run completed (D111: its box continues it); a new discussion starts from 新讨论, which leaves the
    // history selection. A refused start must create and select no Run.
    await wait(()=>field('继续讨论'),Boolean,'Completed Run did not offer to continue in place');check(!field('讨论目标'),'Completed Run offered a new-goal box');
    const runsBefore=(await api.rooms.listRoomRuns({roomId:saved.roomId})).items.map(r=>r.id);
    await clickIn('.controls','新讨论');
    await fill('讨论目标','R09 unconfirmed restart');await click('开始讨论');await wait(()=>document.querySelector('[role="alert"]')?.textContent,Boolean,'Missing target refusal feedback');
    check(localStorage.getItem('roundtable.runId')===null,'Rejected start selected a Run');
    check(JSON.stringify((await api.rooms.listRoomRuns({roomId:saved.roomId})).items.map(r=>r.id))===JSON.stringify(runsBefore),'Rejected start created a Run');noKey(snapshots.restarted);return {saved,snapshots,assertions};
  }
  throw new Error('Unknown UI stage');
}
module.exports=async(contents,stage,saved={},endpoint='')=>contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)},${JSON.stringify(saved)},${JSON.stringify(endpoint)})`);
