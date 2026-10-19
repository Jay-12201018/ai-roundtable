// Quote binding is exercised without sockets, database or credentials.
const assert=require('node:assert/strict');
const {installControlledNetwork}=require('../../scripts/controlled-desktop/controlled-network.cjs');
let assertions=0;
const check=(a,b,n)=>{assert.deepEqual(a,b,n);assertions++;};
const expires=new Date(Date.now()+60000).toISOString();
const quote={id:'quote',requestId:'request',providerId:'provider',keyRevision:'revision',baseUrl:'https://api.deepseek.com',modelId:'deepseek-flash',prompt:'Reply OK.',maxOutputTokens:128,reservedMicroCny:50000,estimatedMicroCny:1158,priceExpiresAt:expires,expiresAt:expires};
const input={requestId:'request',modelId:'deepseek-flash',messages:[{role:'user',content:'Reply OK.'}],outputTokenLimit:128};
async function test(mutate,revision='revision',revoke=false){
 const gate=installControlledNetwork({allowSessionAuthorization:true,sendAuthorized:false,priceExpiresAt:()=>expires});
 let reached=0;
 class Registry{controlledTrialTarget(){return {revision};}createTransport(){}async *streamControlledTrial(){reached++;yield {type:'text_delta',text:'fixture'};}}
 try{
  check(gate.status().sendAuthorized,false,'launch unarmed');check(gate.approve('provider'),false,'legacy approval cannot arm production');
  gate.attachRegistry(Registry.prototype);check(gate.approveQuote(quote),true,'valid structured quote grants one lease');
  if(revoke)gate.revoke();
  let rejected=false;try{for await(const _ of new Registry().streamControlledTrial('provider',{...input,...mutate},()=>{})){} }catch{rejected=true;}
  const valid=!Object.keys(mutate).length&&revision==='revision'&&!revoke;
  check(rejected,!valid,'only matching live lease enters registry');check(reached,valid?1:0,'mismatch rejected before registry/key');
  if(valid){check(gate.approveQuote(quote),false,'used process cannot rearm');check(gate.status().started,0,'test itself never creates transport');}
 }finally{gate.restore();}
}
(async()=>{
 await test({});await test({requestId:'different'});await test({},'new-key-revision');await test({},'revision',true);
 for(const patch of [{modelId:'other'},{prompt:'other'},{reservedMicroCny:0},{maxOutputTokens:129},{priceExpiresAt:new Date(0).toISOString()}]){
  const gate=installControlledNetwork({allowSessionAuthorization:true,priceExpiresAt:()=>expires});
  try{check(gate.approveQuote({...quote,...patch}),false,'invalid quote rejected');}finally{gate.restore();}
 }
 const gate=installControlledNetwork({priceExpiresAt:()=>expires});try{check(gate.approveQuote(quote),false,'no session capability means no grant');}finally{gate.restore();}
 console.log('CONTROLLED_QUOTE_LEASE_PASS '+JSON.stringify({assertions,publicRequests:0,realKeyReads:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
