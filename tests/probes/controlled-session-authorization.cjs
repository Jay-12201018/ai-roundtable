// Pure native-dialog simulation: no sockets, database, profile or Keychain.
const assert = require('node:assert/strict');
const { createSessionAuthorization } = require('../../scripts/controlled-desktop/session-authorization.cjs');
const epoch = Date.parse('2026-10-19T12:00:00Z');
const quote = { id:'quote', requestId:'request', providerId:'provider', keyRevision:'revision',
  baseUrl:'https://api.deepseek.com', modelId:'deepseek-flash', prompt:'Reply OK.', maxOutputTokens:128,
  reservedMicroCny:50000, estimatedMicroCny:1158, priceExpiresAt:new Date(epoch+60000).toISOString(),
  expiresAt:new Date(epoch+30000).toISOString() };
const options = { title:'授权一次 DeepSeek 受控测试', buttons:['取消','授权并发送这一次请求'], defaultId:0, cancelId:0, detail:'fixture' };
let assertions=0;
const check = (a,b,name) => { assert.deepEqual(a,b,name); assertions++; };
function setup(responses) {
  let now=epoch, grants=[]; const dialogs=[];
  const auth=createSessionAuthorization({ now:()=>now, priceExpiresAt:()=>quote.priceExpiresAt,
    approve:value=>{grants.push(value);return true;}, revoke:()=>{} });
  const show=async opts=>{dialogs.push(opts); const value=responses.shift();return typeof value==='function'?value():{response:value};};
  return {auth,show,dialogs,grants,advance:()=>{now+=60001;}};
}
(async()=>{
  let f=setup([1]); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,0,'unarmed final cannot grant even if simulated UI returns 1');
  check(f.grants.length,0,'unarmed no lease'); check(f.dialogs[0].buttons,['取消'],'unarmed cancel-only');
  f=setup([1,1]); check(f.auth.request(),true,'explicit menu intent accepted'); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,1,'two explicit native confirmations grant');
  check(f.dialogs.length,2,'permit and final dialog both executed');
  check(f.dialogs.map(x=>[x.defaultId,x.cancelId]),[[0,0],[0,0]],'both default cancel');
  check(f.grants,[quote],'same full quote bound'); check(f.auth.request(),false,'process cannot rearm after grant');
  f=setup([0]); f.auth.request(); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,0,'permit cancellation'); check(f.grants.length,0,'cancel has zero grants');
  check(f.auth.request(),false,'cancel invalidates process intent');
  f=setup([1,0]); f.auth.request(); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,0,'final cancellation'); check(f.grants.length,0,'final cancel no grant');
  f=setup([1,()=>{f.advance();return {response:1};}]); f.auth.request(); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,0,'late native authorization rejected'); check(f.grants.length,0,'late decision no grant');
  f=setup([1,()=>{f.auth.cancel();return {response:1};}]); f.auth.request(); f.auth.capture(quote);
  check((await f.auth.confirm(options,f.show)).response,0,'Stop or close invalidates in-flight confirmation');
  f=setup([1,1]); f.auth.request(); f.auth.capture({...quote,modelId:'other'});
  check((await f.auth.confirm(options,f.show)).response,0,'changed fixed model rejected'); check(f.grants.length,0,'invalid quote no grant');
  f=setup([1,1]); f.auth.request(); f.auth.capture(quote); f.advance();
  check((await f.auth.confirm(options,f.show)).response,0,'expired preview rejected');
  const fresh=setup([1]); check((await fresh.auth.confirm(options,fresh.show)).response,0,'restart has no inherited intent');
  check(JSON.stringify(f.dialogs).includes('Authorization'),false,'no credential in dialogs');
  console.log('CONTROLLED_SESSION_AUTHORIZATION_PASS '+JSON.stringify({assertions,publicRequests:0,realKeyReads:0}));
})().catch(error=>{console.error(error);process.exitCode=1;});
