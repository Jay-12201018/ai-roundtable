#!/usr/bin/env node
// `pnpm trial:reset`: deletes only the trial profile that `pnpm trial` created (it must carry trial-profile.json).
// The real profile and its database are never touched. Pass --yes to delete; without it this only reports.
const fs = require('node:fs');
const { join } = require('node:path');
const { appDataDirectory, trialProfile, MARKER, TRIAL_NAME } = require('./profile.cjs');

const directory = trialProfile(appDataDirectory());
if (!fs.existsSync(directory)) { console.log(`没有试用数据：${directory} 不存在。`); process.exit(0); }
let marker;
try { marker = JSON.parse(fs.readFileSync(join(directory, MARKER), 'utf8')); } catch { marker = undefined; }
if (marker?.profile !== TRIAL_NAME) {
  console.error(`${directory} 缺少试用标记 ${MARKER}，不是 pnpm trial 创建的目录，未删除。`);
  process.exit(1);
}
if (!process.argv.includes('--yes')) {
  console.log(`将删除试用数据目录：${directory}\n（包含试用数据库、加密保存的 Key 和日志；真实数据不受影响。）\n确认删除请运行：pnpm trial:reset --yes`);
  process.exit(0);
}
fs.rmSync(directory, { recursive: true, force: false });
console.log(`已删除试用数据目录：${directory}`);
