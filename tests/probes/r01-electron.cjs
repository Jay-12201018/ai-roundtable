// Finite R01 probe; launches the real built app with fresh data, never a user profile.
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, resolve } = require('node:path');
const { pathToFileURL } = require('node:url');
const { app, session, safeStorage } = require('electron');
// A fresh profile does not isolate the OS keychain; never call its backend in probes.
const fakeStorage = { isEncryptionAvailable: () => false, getSelectedStorageBackend: () => 'basic_text',
  encryptString: () => { throw new Error('Fixture encryption unavailable'); },
  decryptString: () => { throw new Error('Fixture decryption unavailable'); },
  setUsePlainTextEncryption: () => { throw new Error('Fixture plaintext backend forbidden'); } };
for (const name of Object.getOwnPropertyNames(safeStorage)) {
  assert.equal(typeof fakeStorage[name], 'function', 'Unisolated safeStorage method: ' + name);
  safeStorage[name] = fakeStorage[name];
  assert.equal(safeStorage[name], fakeStorage[name]);
}
const { execFileSync } = require('node:child_process');

app.commandLine.appendSwitch('use-mock-keychain');
assert.equal(app.commandLine.hasSwitch('use-mock-keychain'), true);

const args = process.argv.slice(2);
const development = args[0] === '--development';
const recoveryMode = args[0] === '--r03-recovery';
const jointMode = args[0] === '--joint-ui';
assert.ok(args.length === 0 || (development && args.length === 2) || ((recoveryMode || jointMode) && args.length === 1), 'Usage: Electron r01-electron.cjs [--joint-ui | --r03-recovery | --development http://127.0.0.1:5173/]');
const devUrl = development ? new URL(args[1]) : undefined;
if (devUrl) {
  assert.equal(devUrl.href, 'http://127.0.0.1:5173/');
  process.env.ELECTRON_RENDERER_URL = devUrl.href;
} else delete process.env.ELECTRON_RENDERER_URL;

const root = resolve(__dirname, '../..');
const entry = join(root, 'out/main/index.js');
const preload = join(root, 'out/preload/index.cjs');
const renderer = join(root, 'out/renderer/index.html');
assert.ok(existsSync(entry) && existsSync(preload) && existsSync(renderer), 'Build main/preload/renderer before this probe');
const preloadReferences = [...readFileSync(entry, 'utf8').matchAll(/preload:\s*join\(__dirname,\s*(["'])([^"']+)\1\)/g)];
assert.equal(preloadReferences.length, 1, 'Built Main must contain one explicit preload path');
const preloadReference = preloadReferences[0][2];
assert.equal(preloadReference, '../preload/index.cjs');
assert.equal(resolve(dirname(entry), preloadReference), preload);
assert.deepEqual(readdirSync(dirname(preload)), ['index.cjs'], 'Preload output must contain only its bundled CJS entry');
assert.equal(app.isReady(), false, 'Data isolation must precede readiness and the real Main import');
const temporaryDirectory = mkdtempSync(join(tmpdir(), 'roundtable-r01-electron-'));
const userData = join(temporaryDirectory, 'userData');
const sessionData = join(temporaryDirectory, 'sessionData');
const logs = join(temporaryDirectory, 'logs');
for (const directory of [userData, sessionData, logs]) mkdirSync(directory);
app.setPath('userData', userData);
app.setPath('sessionData', sessionData);
app.setPath('logs', logs);
assert.equal(app.getPath('userData'), userData);
assert.equal(app.getPath('sessionData'), sessionData);
assert.equal(existsSync(join(userData, 'ai-roundtable.db')), false);
const recoveryStates = ['running','pausing','paused','cancelling','idle','completed','cancelled','error','interrupted'];
if (recoveryMode) {
  const Sqlite = require('better-sqlite3');
  const source = execFileSync('git',['show','135bf82c6462ade6dd5300717d6f0102ce4a660c:src/main/database/Database.ts'],{cwd:root,encoding:'utf8'});
  const migration = source.match(/const migrations = \[\s*`([\s\S]*?)`/);
  assert.ok(migration?.[1]);
  const seed = new Sqlite(join(userData,'ai-roundtable.db'));
  try {
    seed.exec(migration[1]);
    const time='2026-10-13T00:00:00.000Z';
    seed.exec('CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL)');
    seed.prepare('INSERT INTO schema_migrations VALUES(1,?)').run(time);
    seed.prepare('INSERT INTO rooms VALUES(?,?,?,?,?)').run('r03-room','R03 fixture','not the task',time,time);
    seed.prepare('INSERT INTO agents(id,room_id,display_name,role_template_id,created_at,updated_at) VALUES(?,?,?,?,?,?)').run('r03-agent','r03-room','A','draft',time,time);
    for(const status of recoveryStates) {
      const id='r03-'+status;
      seed.prepare('INSERT INTO workflow_runs(id,room_id,status,workflow_snapshot,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(id,'r03-room',status,'{}',time,time);
      seed.prepare('INSERT INTO turns(id,run_id,agent_id,status,request_id,turn_index,partial_content,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(id+'-turn',id,'r03-agent','running',id+'-request',0,'R03 preexisting partial',time,time);
      seed.prepare('INSERT INTO messages(id,room_id,run_id,turn_id,sender_type,sender_name,content,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id+'-message','r03-room',id,id+'-turn','agent','A','R03 preexisting partial','streaming',time,time);
      seed.prepare('UPDATE workflow_runs SET current_turn_id=?,current_agent_id=? WHERE id=?').run(id+'-turn','r03-agent',id);
    }
  } finally {seed.close();}
  assert.equal(app.isReady(),false,'Legacy fixture must precede readiness/Main import');
}

const metadataPath = join(temporaryDirectory, 'probe-result.json');
const result = {
  status: 'RUNNING', development, recoveryMode, jointMode, temporaryDirectory, userData, sessionData,
  metadataPath, entry, preload, renderer, preloadPathEvidence: { source: 'built Main relative reference', relativePath: preloadReference, onlyOutput: 'index.cjs' }, isolationBeforeReady: !app.isReady(),
  blockedRequests: [], permittedRequests: [], consoleErrors: [], cspConsoleErrors: [], preloadErrors: [],
};
const save = () => writeFileSync(metadataPath, JSON.stringify(result, null, 2) + '\n');
save();
console.log('R01_PROBE_ISOLATION ' + JSON.stringify({ userData, sessionData, isolationBeforeReady: result.isolationBeforeReady, metadataPath }));
let quitting = false;
const fail = (error) => {
  result.status = 'FAIL';
  result.error = error instanceof Error ? error.stack : String(error);
  save();
  console.error('R01_PROBE_FAIL ' + JSON.stringify({ error: result.error, metadataPath }));
  app.exit(1);
};
const timeout = setTimeout(() => fail(new Error('R01 probe timed out after 30 seconds, including shutdown')), 30000);
process.on('uncaughtException', fail);
process.on('unhandledRejection', fail);
process.once('exit', () => clearTimeout(timeout));
const consoleMessages = [];
const loaded = new Promise((resolveWindow, reject) => {
  app.once('browser-window-created', (_event, window) => {
    const contents = window.webContents;
    contents.on('console-message', (event, legacyLevel, legacyMessage) => {
      const message = event.message ?? legacyMessage ?? '';
      consoleMessages.push(message);
      if (event.level === 'error' || legacyLevel === 3) result.consoleErrors.push(message);
      if (/violates.*Content Security Policy|Refused to.*(?:script|connect|frame|style)|Content Security Policy.*(?:violat|block)/i.test(message)) result.cspConsoleErrors.push(message);
    });
    contents.on('preload-error', (_event, filename, error) => {
      result.preloadErrors.push({ filename, error: String(error) });
      reject(error);
    });
    contents.on('render-process-gone', (_event, details) => { if (!quitting) reject(new Error('Renderer exited: ' + details.reason)); });
    contents.on('did-fail-load', (_event, code, description, url, isMainFrame) => {
      if (isMainFrame) reject(new Error(`Page load failed ${code}: ${description} (${url})`));
    });
    contents.on('dom-ready', () => {
      void contents.executeJavaScript(`
        window.__r01ProbeViolations = [];
        addEventListener('securitypolicyviolation', (event) => {
          window.__r01ProbeViolations.push({ directive: event.effectiveDirective, blockedURI: event.blockedURI });
        });
      `).catch(reject);
    });
    contents.once('did-finish-load', () => resolveWindow(window));
  });
});

// This callback is registered before Main's whenReady callback and guards its session.
const networkReady = app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const url = new URL(details.url);
    const network = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol);
    const permitted = development && ['http:', 'ws:'].includes(url.protocol)
      && url.hostname === '127.0.0.1' && url.port === '5173' && !url.username && !url.password;
    if (network) (permitted ? result.permittedRequests : result.blockedRequests).push({ url: url.href, resourceType: details.resourceType });
    callback({ cancel: network && !permitted });
  });
});

async function probe() {
  await import(pathToFileURL(entry).href);
  await networkReady;
  const window = await loaded;
  const contents = window.webContents;
  const preferences = contents.getLastWebPreferences();
  assert.equal(preferences.sandbox, true);
  assert.equal(preferences.contextIsolation, true);
  assert.equal(preferences.nodeIntegration, false);
  assert.equal(preferences.webSecurity, true);
  assert.equal(contents.getURL(), development ? devUrl.href : pathToFileURL(renderer).href);
  result.preferences = { sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity };
  if (jointMode) result.jointRuns = await require('./joint-ui.cjs')(contents);
  const page = await contents.executeJavaScript(`(async () => {
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const deadline = Date.now() + 10000;
    while (!document.querySelector('#root .app-shell')) {
      check(Date.now() < deadline, 'Actual Renderer App did not render');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    check(typeof window.require === 'undefined' && typeof window.process === 'undefined', 'Node globals exposed');
    const api = window.roundtable;
    check(api && JSON.stringify(Object.keys(api).sort()) === JSON.stringify(['room', 'rooms', 'run', 'settings']), 'Unexpected Bridge top-level API');
    check(JSON.stringify(Object.keys(api.room).sort()) === JSON.stringify(['createDemo', 'getMessages']), 'Unexpected room API');
    const expected = ['continueMessage', 'getSnapshot', 'onEvent', 'pause', 'recoverInterruptedRun', 'resumeRun', 'retryTurn', 'start', 'step', 'stop', 'subscribe'];
    check(JSON.stringify(Object.keys(api.run).sort()) === JSON.stringify(expected), 'Unexpected run API');
    const configurationKeys = {
      rooms: ['archiveAgent','archiveRoom','createAgent','createRoom','deleteAgent','deleteRoom','getAgentConfiguration','getRoomConfiguration','listAgentConfigurations','listRoomMessages','listRoomRuns','listRooms','reorderAgents','updateAgent','updateRoom'],
      settings: ['confirmTarget','createProvider','deleteKey','deleteProvider','getKeyStorageStatus','getProviderConfiguration','getProviderKeyState','listModels','listProviderSummaries','setKey','testConnection','updateProvider'],
    };
    for (const [group, methods] of Object.entries(configurationKeys)) {
      check(JSON.stringify(Object.keys(api[group]).sort()) === JSON.stringify(methods), 'Unexpected ' + group + ' API');
      check(Object.values(api[group]).every(value => typeof value === 'function'), 'Configuration Bridge method missing');
      check(!('resolveKey' in api[group]) && !('invoke' in api[group]), 'Private capability exposed');
    }
    check(Object.values(api.room).every((value) => typeof value === 'function') && Object.values(api.run).every((value) => typeof value === 'function'), 'Bridge method missing');
    const policy = document.querySelector('meta[http-equiv="Content-Security-Policy"]').content;
    check(policy.includes("frame-src 'none';") && policy.includes("object-src 'none';") && policy.includes("base-uri 'none';"), 'CSP missing isolation directives');
    const scriptPolicy = policy.match(/script-src ([^;]+);/)[1];
    check(!scriptPolicy.includes("'unsafe-inline'") && !scriptPolicy.includes("'unsafe-eval'"), 'Script CSP broadened');
    const development = ${development};
    if (development) {
      check(policy.includes("connect-src 'self' ws://127.0.0.1:5173;"), 'Incorrect dev HMR source');
      const nonce = scriptPolicy.match(/'nonce-([^']+)'/)[1];
      check([...document.scripts].every((script) => script.nonce === nonce), 'Vite scripts lack matching CSP nonce');
    } else check(policy.includes("connect-src 'none';") && !/localhost|127\\.0\\.0\\.1|nonce-/u.test(policy), 'Production CSP retains development sources');
    check(Array.isArray(window.__r01ProbeViolations), 'CSP monitor missing');
    const recoveryChecks = [];
    if (${recoveryMode}) {
      for(const status of ${JSON.stringify(recoveryStates)}) {
        const recovered=['running','pausing','paused','cancelling'].includes(status);
        const old=await api.run.getSnapshot('r03-'+status);
        check(old.status===(recovered?'interrupted':status),'Incorrect startup Run classification');
        check(old.turns[0].status===(recovered?'interrupted':'running'),'Terminal/idle child changed');
        check(old.messages[0].content==='R03 preexisting partial' && old.messages[0].status===(recovered?'aborted':'streaming'),'Partial evidence changed');
        check(old.sequence===(recovered?1:0),'Recovery event is missing or duplicated');
        check(old.execution.task===null && old.execution.membersSnapshot===null && old.execution.elapsedExecutionMs===null,'Legacy inputs/time invented');
        check(old.attempts.length===1 && !('inputSnapshot' in old.attempts[0]),'Attempt projection unsafe');
        if(recovered) check(old.currentTurnId===undefined && old.activeAgentId===undefined,'Active pointers retained');
        recoveryChecks.push({runId:old.runId,status:old.status,sequence:old.sequence});
      }
    }
    const events = [];
    const unsubscribe = api.run.onEvent((event) => events.push(event));
    const { roomId } = await api.room.createDemo('R01 isolated lifecycle probe');
    const started = await api.run.start({ roomId, task: 'R01 isolated Mock step', workflowSnapshot: { templateId: 'r01-probe', version: 1 }, mode: 'step', maxTurns: 3 });
    let snapshot;
    const runDeadline = Date.now() + 10000;
    do {
      snapshot = await api.run.getSnapshot(started.runId);
      check(!['error', 'cancelled', 'completed'].includes(snapshot.status), 'Unexpected first-step state: ' + snapshot.status);
      check(Date.now() < runDeadline, 'Mock step did not pause');
      if (snapshot.status !== 'paused') await new Promise((resolve) => setTimeout(resolve, 50));
    } while (snapshot.status !== 'paused');
    check(snapshot.turns.length === 1 && snapshot.messages.length === 1 && snapshot.messages[0].content.length > 0, 'First step output missing');
    const subscription = await api.run.subscribe(started.runId, 0);
    check(subscription.snapshot.status === 'paused' && subscription.nextCursor === snapshot.sequence && subscription.events.length > 0, 'IPC subscription did not return authoritative state');
    const messages = await api.room.getMessages(roomId);
    check(messages.length === 1 && messages[0].content === snapshot.messages[0].content, 'Room message projection differs');
    check(events.length > 0, 'No real IPC events received');
    unsubscribe();
    unsubscribe();
    const eventCount = events.length;
    await api.run.step(started.runId);
    await new Promise((resolve) => setTimeout(resolve, 50));
    snapshot = await api.run.getSnapshot(started.runId);
    check(snapshot.status === 'paused' && snapshot.turns.length === 2 && snapshot.messages.length === 2, 'Second step did not remain paused');
    check(events.length === eventCount, 'Cancelled listener still receives events');
    return { runId: started.runId, roomId, snapshot, policy, eventCount,recoveryChecks, listenerCancelled: true, rootRendered: true, nodeGlobalsAbsent: true, bridgeKeys: Object.keys(api).sort(), cspViolations: window.__r01ProbeViolations };
  })()`);
  if (development) {
    const deadline = Date.now() + 5000;
    while (!consoleMessages.some((message) => message.includes('[vite] connected.'))) {
      assert.ok(Date.now() < deadline, 'Vite HMR WebSocket did not connect');
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
    result.hmrConnected = true;
    assert.ok(result.permittedRequests.some((request) => request.resourceType === 'webSocket'), 'No actual allowed HMR WebSocket request');
  }
  assert.deepEqual(result.preloadErrors, []);
  assert.deepEqual(result.consoleErrors, []);
  assert.deepEqual(result.cspConsoleErrors, []);
  assert.deepEqual(page.cspViolations, []);
  assert.deepEqual(result.blockedRequests, [], 'Unexpected network request was blocked');
  Object.assign(result, page, { status: 'PASS', shutdown: 'requested through real Main app.quit' });
  save();
  console.log('R01_PROBE_RESULT ' + JSON.stringify({ status: result.status, development, runId: result.runId, userData, metadataPath, hmrConnected: result.hmrConnected ?? false }));
  quitting = true;
  app.quit();
}
probe().catch(fail);
