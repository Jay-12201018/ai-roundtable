// Finite production-entry smoke. Only private fixture data and a fully fake safeStorage backend.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage, screen } = require('electron');

const args = process.argv.slice(2);
assert.ok(args.length === 0 || args.length === 2 && args[0] === '--restart', 'Usage: electron r09-electron.cjs [--restart private-manifest.json]');
const restarting = args.length === 2;
assert.equal(app.isReady(), false, 'Isolation must precede readiness/Main');
app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true, 'Chromium Keychain isolation switch missing');
const directory = restarting ? dirname(resolve(args[1])) : fs.mkdtempSync(join(tmpdir(), 'roundtable-r09-production-'));
assert.ok(basename(directory).startsWith('roundtable-r09-production-') && fs.realpathSync(dirname(directory)) === fs.realpathSync(tmpdir()), 'Only this probe owned temporary profile is allowed');
assert.ok(fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink(), 'Profile directory cannot be a symlink');
assert.equal(fs.statSync(directory).uid, process.getuid());
const manifestPath = join(directory, 'r09-manifest.json');
assert.equal(restarting ? resolve(args[1]) : manifestPath, manifestPath);
// --restart needs the first phase's manifest; without it (the first phase failed), fail with a non-zero exit instead
// of letting Electron report a load error and exit 0.
if (restarting && !fs.existsSync(manifestPath)) {
  console.error('R09_PRODUCTION_FAIL ' + JSON.stringify({ error: 'Missing first-phase manifest: ' + manifestPath }));
  process.exit(1);
}
const ownerPath = join(directory, 'r09-owner.json');
if (!restarting) fs.writeFileSync(ownerPath, JSON.stringify({ probe: 'R09 production smoke', uid: process.getuid(), directory }), { mode: 0o600, flag: 'wx' });
const owner = JSON.parse(fs.readFileSync(ownerPath, 'utf8'));
assert.deepEqual(owner, { probe: 'R09 production smoke', uid: process.getuid(), directory });
assert.equal(fs.statSync(ownerPath).uid, process.getuid());
const prior = restarting ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : undefined;
if (restarting) assert.equal(prior.status, 'PASS');
const paths = Object.fromEntries(['userData', 'sessionData', 'logs'].map(name => [name, join(directory, name)]));
for (const [name, path] of Object.entries(paths)) { fs.mkdirSync(path, { recursive: true, mode: 0o700 }); assert.ok(fs.lstatSync(path).isDirectory() && !fs.lstatSync(path).isSymbolicLink(), 'Profile child cannot be a symlink'); app.setPath(name, path); assert.equal(app.getPath(name), path); }
assert.equal(fs.existsSync(join(paths.userData, 'ai-roundtable.db')), restarting);
delete process.env.ELECTRON_RENDERER_URL;
const root = resolve(__dirname, '../..');
const entry = join(root, 'out/main/index.js'); const preload = join(root, 'out/preload/index.cjs'); const renderer = join(root, 'out/renderer/index.html');
for (const file of [entry, preload, renderer]) assert.ok(fs.existsSync(file), 'Build missing: ' + file);
const result = { status: 'RUNNING', phase: restarting ? 'restart' : 'first', directory, paths, entry, preload, renderer, runtime: { electron: process.versions.electron, node: process.versions.node, abi: process.versions.modules, arch: process.arch }, isolationBeforeReady: !app.isReady(), chromiumMockKeychain: app.commandLine.hasSwitch('use-mock-keychain'), fakeSafeStorage: { replacedMethods: [], encrypt: 0, decrypt: 0 }, nodeNetworkAttempts: [], chromiumNetworkAttempts: [], consoleErrors: [], preloadErrors: [], checks: [] };
const resultPath = join(directory, restarting ? 'r09-restart.json' : 'r09-first.json');
const save = () => fs.writeFileSync(resultPath, JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
const fake = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'r09-fixture-only',
  encryptString: value => { result.fakeSafeStorage.encrypt++; return Buffer.from([...Buffer.from(value)].map(value => value ^ 0xa5)); },
  decryptString: value => { result.fakeSafeStorage.decrypt++; return Buffer.from([...value].map(value => value ^ 0xa5)).toString(); },
  setUsePlainTextEncryption: () => { throw new Error('Fixture does not allow plaintext storage'); },
};
const safeStorageMethods = Object.getOwnPropertyNames(safeStorage).filter(name => typeof safeStorage[name] === 'function');
assert.ok(safeStorageMethods.length > 0, 'safeStorage method inventory is empty');
for (const name of safeStorageMethods) assert.ok(Object.hasOwn(fake, name), 'Unisolated safeStorage method: ' + name);
for (const [name, implementation] of Object.entries(fake)) {
  safeStorage[name] = implementation; assert.equal(safeStorage[name], implementation, 'Cannot isolate safeStorage.' + name); result.fakeSafeStorage.replacedMethods.push(name);
}
assert.equal(safeStorage.isEncryptionAvailable, fake.isEncryptionAvailable);
assert.equal(safeStorage.encryptString, fake.encryptString); assert.equal(safeStorage.decryptString, fake.decryptString);
const http = require('node:http');
const { syncBuiltinESMExports } = require('node:module');
let mode='normal'; const requests=[]; let fixtureBase; let fixturePort;
const fixture = http.createServer(async(req,res)=>{
  try {
    const chunks=[]; for await(const data of req) chunks.push(data);
    const official=req.url.startsWith('/official/');
    const expectedKey=official?'r09-fake-key-official':'r09-fake-key-compatible';
    const credentialMatches=req.headers.authorization==='Bearer '+expectedKey;
    assert.equal(credentialMatches,true,'Fixture received a Key belonging to another Provider');
    const call={path:req.url,method:req.method,credentialMatches,body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null,aborted:false};requests.push(call);
    if(req.method==='GET'&&req.url.endsWith('/models')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({data:[{id:'fixture'}]}));return;}
    assert.equal(req.method,'POST');assert.ok(req.url.endsWith('/chat/completions'));
    assert.equal(call.body.model,'fixture');assert.equal(call.body.stream,true);
    assert.ok(Number.isSafeInteger(call.body[official?'max_completion_tokens':'max_tokens']));
    res.writeHead(200,{'content-type':'text/event-stream'});
    const emit=v=>res.write('data: '+JSON.stringify(v)+'\n\n');
    emit({id:'fixture-'+requests.length,choices:[{index:0,delta:{content:'R09 public output '+requests.length},finish_reason:null}]});
    res.on('close',()=>{if(!res.writableEnded)call.aborted=true;});
    if(mode==='hang')return;
    setTimeout(()=>{if(res.destroyed)return;emit({id:'fixture-'+requests.length,choices:[{index:0,delta:{},finish_reason:'stop'}]});emit({id:'fixture-'+requests.length,choices:[],usage:{prompt_tokens:40,completion_tokens:4}});res.end('data: [DONE]\n\n');},250);
  } catch(error){ fail(error); }
});
// No public network. Production network code is retained for the compatible loopback endpoint.
const originalRequest=http.request;
http.request=function(url,options,callback){
  const value=typeof url==='string'||url instanceof URL?new URL(url):url;
  const host=value.hostname??value.host; const port=Number(value.port);
  if(host!=='127.0.0.1'||port!==fixturePort){result.nodeNetworkAttempts.push('http outside owned fixture');throw new Error('Only owned fixture transport permitted');}
  return originalRequest.apply(this,arguments);
};
http.get=()=>{throw new Error('Probe does not use http.get');};
const https=require('node:https'); https.request=https.get=()=>{result.nodeNetworkAttempts.push('https');throw new Error('Remote TLS disabled');};
globalThis.fetch=async()=>{result.nodeNetworkAttempts.push('global fetch');throw new Error('Remote fetch disabled');};
syncBuiltinESMExports();
let quitting=false;
const fail=error=>{result.status='FAIL';result.error=error instanceof Error?error.stack:String(error);result.requests=requests;save();console.error('R09_PRODUCTION_FAIL '+JSON.stringify({resultPath,error:result.error}));app.exit(1);};
const timeout=setTimeout(()=>fail(new Error('R09 production smoke exceeded 240 seconds')),240000);
process.on('uncaughtException',fail);process.on('unhandledRejection',fail);process.once('exit',()=>clearTimeout(timeout));
const loaded=new Promise((yes,no)=>app.once('browser-window-created',(_event,window)=>{
 window.webContents.on('preload-error',(_event,file,error)=>{result.preloadErrors.push({file,error:String(error)});no(error);});
 window.webContents.on('console-message',(event,level,message)=>{if(event.level==='error'||level===3)result.consoleErrors.push(event.message??message);});
 window.webContents.once('did-finish-load',()=>yes(window));
}));
const guarded=app.whenReady().then(()=>{
 session.defaultSession.setPermissionRequestHandler((_c,_p,cb)=>cb(false));session.defaultSession.setPermissionCheckHandler(()=>false);
 session.defaultSession.webRequest.onBeforeRequest({urls:['<all_urls>']},(details,cb)=>{const network=/^(https?|wss?):/u.test(details.url);if(network)result.chromiumNetworkAttempts.push(details.url);cb({cancel:network});});
});
async function main(){
 // The compatible service's saved address names this port, so a restart listens on the first phase's port again.
 await new Promise(r=>fixture.listen(restarting?prior.fixturePort:0,'127.0.0.1',r));fixturePort=fixture.address().port;fixtureBase='http://127.0.0.1:'+fixturePort;
 // The reviewed Main profile directory intentionally has no live-provider profiles. Substitute only
 // trusted Main policy/official transport for this owned zero-cost fixture; no product env backdoor.
 const entryModule=await import(pathToFileURL(entry).href);
 const Registry=entryModule.ProviderRegistry;assert.equal(typeof Registry,'function','Actual production Registry export missing');
 const originalPolicy=Registry.prototype.resolveModelPolicy;
 Registry.prototype.resolveModelPolicy=function(config,modelId){
  if(!config.name.startsWith('R09 fixture ')||modelId!=='fixture')return originalPolicy.call(this,config,modelId);
  return {evidence:'owned local HTTP fixture protocol; no live API model claim',outputTokenParameter:config.kind==='openai'?'max_completion_tokens':'max_tokens',contextWindowTokens:100000,maxOutputTokens:4096,
    counter:{modelId:'fixture',kind:'upper_bound',method:'owned fixture UTF8 bytes + packet framing bound',countMessages:ms=>32+ms.reduce((n,m)=>n+16+Buffer.byteLength(m.content),0)},
    price:{inputUsdPerMillion:0,outputUsdPerMillion:0,maxRequestUsd:0,evidence:'owned loopback fixture has no provider charges'}};
 };
 const originalCapabilities=Registry.prototype.resolveCapabilities;
 Registry.prototype.resolveCapabilities=function(config){return config.name==='R09 fixture Compatible'?{outputTokenParameter:'max_tokens',streamUsage:true,listModels:true,authentication:'models'}:originalCapabilities.call(this,config);};
 const originalTransport=Registry.prototype.createTransport;
 Registry.prototype.createTransport=function(guard){const transport=originalTransport.call(this,guard);return (url,init)=>{const target=String(url);return transport(target.startsWith('https://api.openai.com/v1/')?fixtureBase+'/official/v1/'+target.slice('https://api.openai.com/v1/'.length):url,init);};};
 result.fixture={policySubstitutedInTrustedMain:true,officialTransportMappedToLoopback:true,realCompatibleSafeTransport:true,liveApi:false};
 await guarded;const window=await loaded;const contents=window.webContents;
 assert.equal(contents.getURL(),pathToFileURL(renderer).href);
 const preferences=contents.getLastWebPreferences();assert.equal(preferences.sandbox,true);assert.equal(preferences.contextIsolation,true);assert.equal(preferences.nodeIntegration,false);assert.equal(preferences.webSecurity,true);
 result.bridge=await contents.executeJavaScript(`(()=>{const a=window.roundtable;if(typeof require!=='undefined'||typeof process!=='undefined'||'invoke' in a||'resolveKey' in a.settings||typeof a.settings.confirmTarget!=='function')throw new Error('Bridge security failure');return {restricted:true,settings:Object.keys(a.settings).sort()};})()`);
 const ui=require('./r09-ui.cjs');
 if(restarting){
  // Nothing is sent by the restart itself; D113: the explicit new start sends without asking to confirm the target again.
  const before=requests.length;assert.equal(before,0,'Restart must not automatically send requests');
  result.ui=await ui(contents,'restart',prior.saved);
  const sent=requests.filter(r=>r.method==='POST'&&r.body.messages.some(m=>m.content.includes('R09 confirmed restart')));
  assert.equal(sent.length,3,'Only the explicit start after the restart sent requests');assert.equal(requests.filter(r=>r.method==='POST').length,3,'No other request was sent after the restart');
 }
 else{
  result.first=await ui(contents,'first',{},fixtureBase+'/compatible/v1');
  const refreshed=new Promise(r=>contents.once('did-finish-load',r));contents.reload();await refreshed;
  result.resumed=await ui(contents,'resume',result.first.saved);
  const finished=result.resumed.snapshots.completed;
  const runCalls=requests.filter(r=>r.method==='POST'&&r.body.messages.some(m=>m.content.includes('R09 three Agent public context')));
  assert.equal(runCalls.length,3);assert.deepEqual(runCalls.map(r=>r.path.startsWith('/official/')),[false,true,false]);
  for(let i=0;i<3;i++){
   assert.ok(finished.attempts[i].requestId, 'Main request identity absent');
   assert.ok(JSON.stringify(runCalls[i].body.messages).includes('R09 system '+i));
   // D095: other members' replies are quoted user-side discussion; with three different members none is assistant.
   assert.ok(runCalls[i].body.messages.every(m=>m.role!=='assistant'),'Another member was sent as assistant');
   for(let j=0;j<i;j++)assert.ok(runCalls[i].body.messages.some(m=>m.role==='user'&&m.content.includes('\n> '+finished.messages[j].content)),'Prior public output missing');
  }
  mode='hang';result.ui=await ui(contents,'stop',result.resumed.saved);await new Promise(r=>setTimeout(r,100));
  const stopped=requests.filter(r=>r.method==='POST'&&r.body.messages.some(m=>m.content.includes('R09 hanging HTTP output')));
  assert.equal(stopped.length,3,'One explicit start, retry and continue; no automatic retry');assert.ok(stopped.every(r=>r.aborted),'Stop did not abort actual sockets');
  assert.deepEqual(result.ui.snapshots.repeated.messages[0],result.ui.snapshots.stopped.messages[0]);
 }
 result.deepSeekPreparation=await require('./deepseek-preparation.cjs')(contents,()=>result.fakeSafeStorage.decrypt);
 assert.equal(result.deepSeekPreparation.checks.length,9,'DeepSeek preparation assertions did not all execute');
 assert.deepEqual(result.nodeNetworkAttempts,[]);assert.deepEqual(result.chromiumNetworkAttempts,[]);assert.deepEqual(result.preloadErrors,[]);assert.deepEqual(result.consoleErrors,[]);
 for(const name of safeStorageMethods)assert.equal(safeStorage[name],fake[name],'Unisolated Key backend');
 assert.ok(result.fakeSafeStorage.decrypt>0,'No actual fake encrypted Key read');
 const publicResults={ui:result.ui,first:result.first,resumed:result.resumed,requests};assert.ok(!JSON.stringify(publicResults).includes('r09-fake-key-'),'Key leaked to ordinary data');
 result.requests=requests;result.saved=result.ui.saved;result.assertions=(result.ui.assertions??0)+(result.first?.assertions??0)+(result.resumed?.assertions??0);
 assert.ok(result.assertions>0,'No UI assertions executed');result.status='PASS';save();
 if(!restarting)fs.writeFileSync(manifestPath,JSON.stringify({status:'PASS',directory,saved:result.saved,fixturePort},null,2),{mode:0o600,flag:'wx'});
 console.log('R09_PRODUCTION_PASS '+JSON.stringify({resultPath,manifestPath,requests:requests.length,assertions:result.assertions,liveApi:false}));
 quitting=true;await new Promise(r=>{fixture.closeAllConnections();fixture.close(r);});app.quit();
}
save();console.log('R09_PRODUCTION_ISOLATION '+JSON.stringify({resultPath,manifestPath,paths}));main().catch(fail);
