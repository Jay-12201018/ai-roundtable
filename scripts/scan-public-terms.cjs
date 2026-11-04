#!/usr/bin/env node
// Lists words the public tree should not contain. This file holds the only copy of the list and is not scanned itself.
// Exit codes: 0 nothing unexpected; 1 unexpected hits. Lines that must stay (see `kept`) and lockfile hits are listed, and do not fail.
const fs = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const scanned = ['src', 'tests', 'scripts', 'package.json', 'README.md', 'SPEC.md'];
const self = relative(root, __filename);
const terms = /openai|anthropic|claude|gemini|chatgpt|gpt|google|grok|groq|mistral|llama|copilot|openrouter|bedrock|azure|proxy|代理|梯子|翻墙|\bVPN\b|\bClash\b|V2Ray|fake-?ip|海外|境外/iu;
// `new Proxy(` is the language's, and has nothing to do with networks.
const harmless = /new Proxy\(/gu;
// Published migrations are never edited (AGENTS.md); migration 14 has to name what it converts, and the recovery check reads old tables.
const kept = [
  { file: 'src/main/database/migrations/v11.ts', why: 'published migration' },
  { file: 'src/main/database/migrations/v14.ts', why: 'converts the old values' },
  { file: 'tests/integration/persistence/migrationV14.test.ts', why: 'old values as a test input' },
];

function* files(path) {
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) { yield path; return; }
  for (const name of fs.readdirSync(path)) yield* files(join(path, name));
}
function hits(path) {
  const found = [];
  fs.readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    if (terms.test(line.replace(harmless, ''))) found.push({ line: index + 1, text: line.trim().slice(0, 140) });
  });
  return found;
}

let unexpected = 0;
const retained = [];
for (const start of scanned) {
  for (const path of files(join(root, start))) {
    const file = relative(root, path).split('\\').join('/');
    if (file === self.split('\\').join('/') || /\.(png|jpg|ico|icns)$/iu.test(file)) continue;
    const allowed = kept.find(item => item.file === file);
    for (const hit of hits(path)) {
      if (allowed) { retained.push(`${file}:${hit.line} [${allowed.why}] ${hit.text}`); continue; }
      unexpected++;
      console.log(`${file}:${hit.line} ${hit.text}`);
    }
  }
}
if (retained.length) { console.log(`\n保留 ${retained.length} 处：`); for (const line of retained) console.log(`  ${line}`); }
const lock = join(root, 'pnpm-lock.yaml');
// Checksums match by chance.
const locked = fs.existsSync(lock) ? hits(lock).filter(hit => !hit.text.startsWith('resolution:')) : [];
if (locked.length) { console.log(`\npnpm-lock.yaml 里的传递依赖 ${locked.length} 处：`); for (const hit of locked) console.log(`  ${hit.line} ${hit.text}`); }
console.log(`\n意外命中 ${unexpected} 处。`);
process.exit(unexpected ? 1 : 0);
