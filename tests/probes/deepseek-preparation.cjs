// Uses only the isolated production probe's Bridge and fake Key backend; no model policy injection.
// Since R13A (D089) production approves deepseek-flash, so the refusal is checked with deepseek-v4-pro, whose price is
// reviewed but which stays unapproved: it must be refused before any Key read or network use.
module.exports = async (contents, readDecryptCount) => {
  const providerId=await contents.executeJavaScript(`(async () => {
  const api=window.roundtable;
  const provider = await api.settings.createProvider({name:'DeepSeek safety preparation',kind:'openai-compatible',baseUrl:'https://api.deepseek.com',customModels:[{id:'deepseek-flash',name:'deepseek-flash'},{id:'deepseek-v4-pro',name:'deepseek-v4-pro'}]});
  await api.settings.setKey({providerId:provider.id,apiKey:'r09-fake-key-deepseek-preparation'});
    return provider.id;
  })()`);
  const decryptBefore=readDecryptCount();
  const result=await contents.executeJavaScript(`(async () => {
    const providerId=${JSON.stringify(providerId)};
    const api=window.roundtable;const checks=[];
    const check=(ok,label)=>{if(!ok)throw new Error(label);checks.push(label);};
  const before = await api.settings.testConnection({providerId,level:'generation',modelId:'deepseek-v4-pro',allowGeneration:true});
  check(!before.result.ok && before.result.error.code === 'forbidden', 'Missing confirmation was accepted');
  await api.settings.confirmTarget({providerId,baseUrl:'https://api.deepseek.com',confirmed:true});
  for (const level of ['authentication','generation']) {
    const result = await api.settings.testConnection({providerId,level,modelId:'deepseek-v4-pro',...(level==='generation'?{allowGeneration:true}:{})});
    check(!result.result.ok && result.result.error.code === 'unsupported', 'Unapproved DeepSeek '+level+' was enabled');
    check(!JSON.stringify(result).includes('r09-fake-key-'), 'Key leaked in test result');
  }
  const room = await api.rooms.createRoom({name:'DeepSeek single Agent refusal'});
  await api.rooms.createAgent({roomId:room.id,displayName:'Single',roleTemplateId:'assistant',providerId,modelId:'deepseek-v4-pro'});
  let error;try { await api.run.start({roomId:room.id,task:'Reply OK.',workflowSnapshot:{},maxTurns:1,outputTokenLimit:128}); } catch (rejected) { error=rejected; }
  check(error?.code==='unsupported','Unapproved real-model Run was started');
  const runs = await api.rooms.listRoomRuns({roomId:room.id});
  check(runs.items.length===0,'Rejected Run left fake execution evidence');
  check(!JSON.stringify(await api.settings.getProviderConfiguration({id:providerId})).includes('r09-fake-key-'),'Key leaked in provider DTO');
  await api.rooms.deleteRoom({id:room.id});await api.settings.deleteProvider({id:providerId});
  check(!(await api.settings.listProviderSummaries()).some(p=>p.id===providerId),'Probe configuration cleanup failed');
  return {status:'PASS',checks,realApiRequests:0,modelPolicyInjected:false};
})()`, true);
  const decryptAfter=readDecryptCount();
  require('node:assert/strict').equal(decryptAfter,decryptBefore,'Rejected DeepSeek operation decrypted a Key');
  return {...result,decryptBefore,decryptAfter};
};
