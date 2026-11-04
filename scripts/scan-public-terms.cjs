#!/usr/bin/env node
// Lists lines of the public tree that match a word list kept outside this repository, so the list itself is not published.
// usage: node scripts/scan-public-terms.cjs <word list file>
// The file has one case-insensitive regular expression per line; a line starting with `!` is text removed before matching,
// and one starting with `#` is a comment.
// Exit codes: 0 no hits; 1 hits; 2 no usable list. Lockfile hits are listed, and do not fail.
const fs = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '..');
const scanned = ['src', 'tests', 'scripts', 'package.json', 'README.md', 'SPEC.md'];

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
for (const start of scanned) {
  for (const path of files(join(root, start))) {
    const file = relative(root, path).split('\\').join('/');
    if (/\.(png|jpg|ico|icns)$/iu.test(file)) continue;
    for (const hit of hits(path)) {
      unexpected++;
      console.log(`${file}:${hit.line} ${hit.text}`);
    }
  }
}
const lock = join(root, 'pnpm-lock.yaml');
// Checksums match by chance.
const locked = fs.existsSync(lock) ? hits(lock).filter(hit => !hit.text.startsWith('resolution:')) : [];
if (locked.length) { console.log(`\npnpm-lock.yaml 里的传递依赖 ${locked.length} 处：`); for (const hit of locked) console.log(`  ${hit.line} ${hit.text}`); }
console.log(`\n命中 ${unexpected} 处。`);
process.exit(unexpected ? 1 : 0);
