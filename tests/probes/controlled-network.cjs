// Runs in a separate Node/Electron-as-Node process: globals are restored after every case.
const assert = require('node:assert/strict');
const { installControlledNetwork } = require('../../scripts/controlled-desktop/controlled-network.cjs');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');
const path = require('node:path'), os = require('node:os'), fs = require('node:fs');
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'controlled-network-regression-'));
// Load real Main classes without importing Electron Main or touching a profile.
const esbuild = createRequire(require.resolve('vite'))('esbuild');
esbuild.buildSync({ stdin: { contents: "export { ProviderRegistry } from './src/main/providers/ProviderRegistry'; export { TrialDiagnostics } from './src/main/providers/diagnostics';", resolveDir: process.cwd() }, bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: path.join(folder, 'registry.cjs') });
const ownRequire = createRequire(pathToFileURL(path.join(process.cwd(), 'package.json')));
const Module = require('node:module');
const bundle = new Module(path.join(folder, 'registry.cjs')); bundle.paths = ownRequire.resolve.paths('zod');
bundle._compile(fs.readFileSync(path.join(folder, 'registry.cjs'), 'utf8'), path.join(folder, 'registry.cjs'));
const { ProviderRegistry, TrialDiagnostics } = bundle.exports;
const target = 'https://api.deepseek.com/chat/completions';
const input = { requestId: 'fixture-request', modelId: 'deepseek-flash', messages: [{ role: 'user', content: 'Reply OK.' }], outputTokenLimit: 128 };
const config = { id: 'fixture-provider', name: 'Local fixture', kind: 'openai-compatible', enabled: true, baseUrl: 'https://api.deepseek.com', defaultModelId: 'deepseek-flash', customModels: [], isDefault: false, keyReference: { id: 'owned-reference' }, createdAt: '2026-10-18T00:00:00.000Z', updatedAt: '2026-10-18T00:00:00.000Z' };
const db = { getProviderConfiguration: () => config, validateModelSelection: () => config, getProviderKeyRevision: () => 'fixture-revision', saveTargetApproval(_id, approval) { this.approval = approval; }, getTargetApproval() { return this.approval; } };
const fakeKeys = { getProviderKeyState: async () => ({ keyReference: config.keyReference }), resolveKey: async () => 'owned-fake-key' };
let passed = 0;
async function run(name, action) { await action(); passed++; console.log('PASS ' + name); }
async function withGate(options, action) {
 const gate = installControlledNetwork({ sendAuthorized: true, fixtureOnly: true, fixtureOrigin: 'http://127.0.0.1:1/', priceExpiresAt: new Date(Date.now()+30000).toISOString(), ...options });
 try { await action(gate); } finally { gate.restore(); }
}
(async () => {
 await run('both diagnostic observer parameters survive the real registry and controlled wrapper', async () => {
  const d = new TrialDiagnostics(() => {}); let transportObserver, calls = 0;
  const registry = new ProviderRegistry(db, fakeKeys, { transportFactory: (_guard, observer) => {
   transportObserver = observer;
   return async () => { calls++; observer?.({ stage: 'dns', category: 'dns_failed' }); throw new Error('owned-fake-key raw cause must not escape'); };
  } });
  registry.confirmTarget({ providerId: config.id, baseUrl: config.baseUrl, confirmed: true });
  await withGate({}, async gate => {
   gate.attachRegistry(ProviderRegistry.prototype); assert.ok(gate.approve(config.id));
   for await (const _ of registry.streamControlledTrial(config.id, input, () => {}, d.observe)) {}
   assert.equal(transportObserver, d.observe, 'transport observer was dropped');
  });
  assert.equal(calls, 1); assert.equal(d.snapshot().stage, 'dns'); assert.equal(d.snapshot().category, 'dns_failed');
  assert.equal(d.snapshot().evidence, 'client_invoked'); assert.ok(!JSON.stringify(d.snapshot()).includes('owned-fake-key'));
 });
 for (const [category, stage] of [['dns_failed','dns'], ['tcp_failed','tcp'], ['tls_failed','tls'], ['request_interrupted','response']]) {
  await run('preserves safe ' + category + ' from the wrapped transport', async () => {
   const d = new TrialDiagnostics(() => {});
   const registry = new ProviderRegistry(db, fakeKeys, { transportFactory: (_guard, observe) => async () => { observe?.({ stage, category }); throw new Error('owned-fake-key'); } });
   registry.confirmTarget({ providerId: config.id, baseUrl: config.baseUrl, confirmed: true });
   await withGate({}, async gate => { gate.attachRegistry(ProviderRegistry.prototype); gate.approve(config.id); for await (const _ of registry.streamControlledTrial(config.id,input,()=>{},d.observe)) {} });
   assert.equal(d.snapshot().category,category); assert.equal(d.snapshot().stage,stage); assert.equal(d.snapshot().evidence,'client_invoked');
  });
 }
 await run('observed HTTP status survives and has no raw body or credential', async () => {
  const d = new TrialDiagnostics(() => {}); let calls = 0;
  const registry = new ProviderRegistry(db, fakeKeys, { transportFactory: () => async () => { calls++; return new Response('owned-fake-key raw response', { status: 429 }); } });
  registry.confirmTarget({ providerId: config.id, baseUrl: config.baseUrl, confirmed: true });
  await withGate({}, async gate => { gate.attachRegistry(ProviderRegistry.prototype); gate.approve(config.id); for await (const _ of registry.streamControlledTrial(config.id,input,()=>{},d.observe)) {} });
  assert.equal(calls,1); assert.equal(d.snapshot().evidence,'http_response'); assert.equal(d.snapshot().httpStatus,429); assert.equal(d.snapshot().category,'http_error');
  assert.ok(!JSON.stringify(d.snapshot()).includes('owned-fake-key'));
 });
 await run('unarmed launch rejects before credentials or transport', async () => {
  let reads = 0, calls = 0;
  const registry = new ProviderRegistry(db, { resolveKey: async()=>{ reads++; return 'owned-fake-key'; } }, { transportFactory: ()=>async()=>{ calls++; } });
  await withGate({ sendAuthorized:false }, async gate => {
   gate.attachRegistry(ProviderRegistry.prototype); assert.equal(gate.approve(config.id),false);
   await assert.rejects(async()=>{ for await(const _ of registry.streamControlledTrial(config.id,input,()=>{},()=>{})){} });
  });
  assert.equal(reads,0); assert.equal(calls,0);
 });
 await run('one-shot cannot retry and invalid model cannot use the lease', async () => {
  const registry = new ProviderRegistry(db,fakeKeys,{transportFactory:()=>async()=>new Response('',{status:401})});
  registry.confirmTarget({providerId:config.id,baseUrl:config.baseUrl,confirmed:true});
  await withGate({},async gate=>{
   gate.attachRegistry(ProviderRegistry.prototype); assert.ok(gate.approve(config.id));
   await assert.rejects(async()=>{for await(const _ of registry.streamControlledTrial(config.id,{...input,modelId:'other'},()=>{})){} });
   for await(const _ of registry.streamControlledTrial(config.id,input,()=>{})){}
   assert.equal(gate.approve(config.id),false);
   await assert.rejects(async()=>{for await(const _ of registry.streamControlledTrial(config.id,input,()=>{})){} });
  });
 });
 console.log('CONTROLLED_NETWORK_PASS '+JSON.stringify({cases:passed,publicRequests:0,realKeyReads:0,persistentSendPermits:0}));
})().catch(error=>{ console.error(error); process.exitCode=1; }).finally(()=>fs.rmSync(folder,{recursive:true,force:true}));
