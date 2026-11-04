#!/usr/bin/env node
// Lists lines of the public tree that match a word list kept outside this repository, so the list itself is not published.
// usage: node scripts/scan-public-terms.cjs <word list file>
// The file has one case-insensitive regular expression per line; a line starting with `!` is text removed before matching,
// and one starting with `#` is a comment.
// Exit codes: 0 nothing unexpected; 1 unexpected hits; 2 no usable list. Lines that must stay (see `kept`) and lockfile hits are listed, and do not fail.
const fs = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const scanned = ['src', 'tests', 'scripts', 'package.json', 'README.md', 'SPEC.md'];
// Published migrations are never edited (AGENTS.md); migration 14 has to name what it converts.
const kept = [
  { file: 'src/main/database/migrations/v11.ts', why: 'published migration' },
  { file: 'src/main/database/migrations/v14.ts', why: 'converts the old values' },
  { file: 'tests/integration/persistence/migrationV14.test.ts', why: 'old values as a test input' },
];

function readList(path) {
  if (!path || !fs.existsSync(path)) { console.error('usage: node scripts/scan-public-terms.cjs <word list file>'); process.exit(2); }
  const lines = fs.readFileSync(path, 'utf8').split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const terms = lines.filter(line => !line.startsWith('!')).map(line => new RegExp(line, 'iu'));
  const ignored = lines.filter(line => line.startsWith('!')).map(line => line.slice(1));
  if (terms.length === 0) { console.error('The word list is empty.'); process.exit(2); }
  return { terms, ignored };
}
const { terms, ignored } = readList(process.argv[2]);

function* files(path) {
  const stat = fs.lstatSync(path);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) { yield path; return; }
  for (const name of fs.readdirSync(path)) yield* files(join(path, name));
}
function hits(path) {
  const found = [];
  fs.readFileSync(path, 'utf8').split('\n').forEach((line, index) => {
    const clean = ignored.reduce((text, words) => text.split(words).join(''), line);
    if (terms.some(term => term.test(clean))) found.push({ line: index + 1, text: line.trim().slice(0, 140) });
  });
  return found;
}

let unexpected = 0;
const retained = [];
for (const start of scanned) {
  for (const path of files(join(root, start))) {
    const file = relative(root, path).split('\\').join('/');
    if (/\.(png|jpg|ico|icns)$/iu.test(file)) continue;
    const allowed = kept.find(item => item.file === file);
    for (const hit of hits(path)) {
      if (allowed) { retained.push(`${file}:${hit.line} [${allowed.why}]`); continue; }
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
