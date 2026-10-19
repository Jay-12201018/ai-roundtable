// Local-fixture clock only: never renew the production price snapshot or authorize a live request.
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { app } = require('electron');
assert.ok(process.versions.electron && app && typeof app.isReady === 'function', 'Run with the actual Electron executable, not the npm package entry');
assert.equal(app.isReady(), false, 'Fixture clock must precede production Main');
const RealDate = Date;
const epoch = RealDate.parse('2026-10-19T12:00:00.000Z');
const origin = performance.now();
const now = () => epoch + Math.floor(performance.now() - origin);
globalThis.__roundtableDiagnosticFixtureClock = Object.freeze({
  mode: 'local-fixture-only', epoch: new RealDate(epoch).toISOString(),
  wallClockAtStart: new RealDate().toISOString(), elapsedSource: 'performance.now',
  priceReviewedAgain: false, liveApiAuthorized: false,
});
globalThis.Date = class extends RealDate {
  constructor(...args) { if (args.length === 0) super(now()); else super(...args); }
  static now() { return now(); }
};
console.log('DEEPSEEK_DIAGNOSTIC_FIXTURE_CLOCK ' + JSON.stringify(globalThis.__roundtableDiagnosticFixtureClock));
require('./deepseek-trial-electron.cjs');
