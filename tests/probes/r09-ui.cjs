// Real DOM interactions in the production App. Bridge calls below inspect evidence only.
async function page(stage, saved, endpoint) {
  let assertions = 0;
  const check = (value, message) => { assertions++; if (!value) throw new Error(message); };
  const sleep = () => new Promise(r => setTimeout(r,30));
  const wait = async (read, accept, message) => { const end=Date.now()+15000; while(true){ const value=await read(); if(accept(value))return value;check(Date.now()<end,message);await sleep();} };
  const visible = e => e && !e.closest('[hidden]') && e.getClientRects().length>0;
  const button = name => [...document.querySelectorAll('button')].find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.textContent.trim()===name));
  const clickIn=async(scope,name)=>{const e=await wait(()=>[...document.querySelectorAll(scope+' button')].find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.textContent.trim()===name)),e=>e&&!e.disabled,'Unavailable button in '+scope+': '+name);e.click();await sleep();};
  const click = async name => {const e=await wait(()=>button(name),e=>e&&!e.disabled,'Unavailable button '+name);e.click();await sleep();};
  // While a modal dialog is open the page behind it is inert: look for fields in the dialog.
  const field = name => [...(document.querySelector('dialog[open]')??document).querySelectorAll('input,select,textarea')].find(e=>visible(e)&&(e.getAttribute('aria-label')===name||e.labels?.[0]?.textContent?.trim()===name||e.closest('label')?.firstChild?.textContent?.trim()===name||e.closest('label')?.textContent?.trim()===name));
  const fill = async(name,value)=>{const e=await wait(()=>field(name),e=>e&&!e.disabled,'Unavailable field '+name);const proto=e instanceof HTMLSelectElement?HTMLSelectElement.prototype:e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,value);e.dispatchEvent(new Event(e instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await sleep();};
  const toggle=async(name,value)=>{const e=await wait(()=>field(name),e=>e&&!e.disabled,'Unavailable checkbox '+name);if(e.checked!==value)e.click();await sleep();};
  // R16 batch 2: choice cards and list rows are named by their first words; service cards are regions named by the service.
  const clickPrefix=async(name,scope=document)=>{const e=await wait(()=>[...scope.querySelectorAll('button')].find(e=>visible(e)&&(n => { const c = n.cloneNode(true); c.querySelectorAll('[aria-hidden="true"]').forEach(x => x.remove()); return c.textContent.trim(); })(e).startsWith(name)),e=>e&&!e.disabled,'Unavailable button '+name+'…');e.click();await sleep();};
  const card=name=>document.querySelector('section[aria-label="'+name+'"]');
  const inCard=async(cardName,name)=>{const e=await wait(()=>card(cardName)&&[...card(cardName).querySelectorAll('button')].find(e=>visible(e)&&(e.textContent.trim()===name||e.getAttribute('aria-label')===name)),e=>e&&!e.disabled,'Unavailable button in '+cardName+': '+name);e.click();await sleep();};
  const dialog=()=>document.querySelector('dialog[open]');
  const memberAction=async(member,action)=>{await click('「'+member+'」：编辑、排序、归档、删除');const item=await wait(()=>[...document.querySelectorAll('[role=menu] button')].find(e=>e.textContent.trim()===action),e=>e&&!e.disabled,'Menu item '+action);item.click();await sleep();};
  const roomTitle=()=>document.querySelector('.room-page .page-head h1')?.firstChild?.textContent;
  const openRun=async task=>{const row=await wait(()=>[...document.querySelectorAll('.run-list li')].find(e=>e.querySelector('b')?.textContent===task),Boolean,'Run not listed '+task);row.querySelector('button').click();await sleep();};
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

  let lastSeen;
  const settle=(id,status)=>wait(()=>api.run.getSnapshot(id),s=>{lastSeen={status:s.status,turns:s.turns.length,dom:text(),main:effective(s),selected:localStorage.getItem('roundtable.runId')===id};return s.status===status&&JSON.stringify(text())===JSON.stringify(effective(s));},'Run/DOM not settled '+status)
    .catch(error=>{throw new Error(error.message+' '+JSON.stringify(lastSeen??{}));});
  await wait(()=>document.querySelector('.app-shell'),Boolean,'App absent');
  const snapshots={};
  if(stage==='first'){
    await click('设置');
    for(const [name,kind,url,key] of [['R09 fixture Compatible','openai-compatible',endpoint,'r09-fake-key-compatible'],['R09 fixture Official','openai','','r09-fake-key-official']]){
      // The connect wizard for a user-added service; the official-endpoint adapter has no preset (D142), so its service comes from the API.
      if(kind==='openai'){const made=await api.settings.createProvider({name,kind,enabled:true,isDefault:false,defaultModelId:'fixture',customModels:[{id:'fixture',name:'fixture'}]});await api.settings.setKey({providerId:made.id,apiKey:key});await click('添加服务');await clickIn('dialog[open] .modal-foot','取消');}
      else{await click('添加服务');await clickPrefix('自定义服务',dialog());await fill('服务名称',name);await fill('地址',url);await fill('模型名','fixture');check(dialog().querySelector('.target').textContent==='Key 只会发往 '+url,'Typed target not shown');await fill('API Key',key);await click('保存');}
      // A refusal is reported with what the wizard said, never with a secret (the Key field is cleared on submit).
      const values=await wait(()=>api.settings.listProviderSummaries(),ps=>ps.some(p=>p.name===name),'Provider not created').catch(error=>{throw new Error(error.message+' '+name+': '+(dialog()?.innerText??'no dialog').slice(0,600));});const p=values.find(p=>p.name===name);saved[kind]=p.id;
      await wait(()=>api.settings.getProviderKeyState({providerId:p.id}),s=>s.state==='configured','Fake encrypted Key missing');
      await wait(dialog,d=>!d,'Wizard did not close');
      check([...document.querySelectorAll('input')].every(e=>!e.value.startsWith('r09-fake-key-')),'Secret form retained');
      // The first real service goes straight to its discussion (D136); the probe goes back to settings.
      await sleep();if(!card(name))await click('设置');
      await wait(()=>card(name),Boolean,'Card absent: '+name);
      // The free check, then an explicit generation; both go to the owned fixture only.
      if(!card(name).querySelector('.svc-body'))await inCard(name,'展开 '+name);
      await inCard(name,'测试连接');await wait(()=>card(name).textContent,t=>t.includes('Key 有效，连接正常'),'Authentication check failed');
      check((await api.settings.testConnection({providerId:p.id,level:'generation',modelId:'fixture',allowGeneration:true})).result.ok,'Explicit fixture generation failed');
      await inCard(name,'从服务商获取列表');await wait(()=>card(name).textContent,t=>t.includes('服务商返回的模型'),'Models not fetched');
      noKey(await api.settings.getProviderConfiguration({id:p.id}));
    }
    // D6-A: the first real service got a room; it becomes the fixture room with three explicitly configured members.
    await clickIn('.sidebar','我的第一场讨论');await wait(roomTitle,t=>t==='我的第一场讨论','Starter room absent');
    await click('编辑');await fill('房间名称','R09 fixture Room');await fill('默认目标可选','Local HTTP public collaboration');await clickIn('dialog[open]','保存');
    await wait(roomTitle,t=>t==='R09 fixture Room','Room not renamed');
    saved.roomId=(await api.rooms.listRooms()).find(r=>r.name==='R09 fixture Room').id;
    for(const starter of await api.rooms.listAgentConfigurations({roomId:saved.roomId})){await memberAction(starter.displayName,'删除…');await clickIn('dialog[open]','删除');await wait(dialog,d=>!d,'Member deletion did not finish');}
    for(let i=0;i<3;i++){
      await click('添加成员');await clickPrefix('自定义',dialog());await fill('名字','R09 Agent '+i);await fill('角色','Role '+i);await fill('设定可选','R09 system '+i);
      await fill('模型',(i===1?saved.openai:saved['openai-compatible'])+'\u0000fixture');await clickIn('dialog[open]','添加');await wait(dialog,d=>!d,'Member dialog did not close');
    }
    check((await api.rooms.listAgentConfigurations({roomId:saved.roomId})).length===3,'Not three members');
    await clickIn('.room-page','新讨论');await fill('讨论目标','R09 three Agent public context');await click('开始讨论');saved.runId=await wait(()=>localStorage.getItem('roundtable.runId'),Boolean,'Run absent');
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
    await clickIn('.sidebar','R09 fixture Room');await wait(roomTitle,t=>t==='R09 fixture Room','Room page absent');
    await openRun('R09 three Agent public context');snapshots.restarted=await settle(saved.runId,'completed');check(snapshots.restarted.attempts.length===3,'History lost on restart');
    for(const id of [saved.openai,saved['openai-compatible']]){const state=await api.settings.getProviderKeyState({providerId:id});check(state.state==='configured','Fake secure Key not restored');}
    // D113 (R16 D1-B): after a restart the same Key, address and kind need no confirmation; an explicit start sends.
    await wait(()=>field('继续讨论'),Boolean,'Completed Run did not offer to continue in place');check(!field('讨论目标'),'Completed Run offered a new-goal box');
    const runsBefore=(await api.rooms.listRoomRuns({roomId:saved.roomId})).items.map(r=>r.id);
    await clickIn('.controls','新讨论');
    await fill('讨论目标','R09 confirmed restart');await click('开始讨论');
    saved.restartRunId=await wait(()=>localStorage.getItem('roundtable.runId'),id=>id&&!runsBefore.includes(id),'Restart start did not create a Run');
    snapshots.restartRun=await settle(saved.restartRunId,'completed');check(snapshots.restartRun.attempts.length===3,'The remembered confirmation did not let the Run send');
    noKey(snapshots.restarted);noKey(snapshots.restartRun);return {saved,snapshots,assertions};
  }
  throw new Error('Unknown UI stage');
}
module.exports=async(contents,stage,saved={},endpoint='')=>contents.executeJavaScript(`(${page.toString()})(${JSON.stringify(stage)},${JSON.stringify(saved)},${JSON.stringify(endpoint)})`);
