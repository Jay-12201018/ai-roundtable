// Runs in Electron's Node (the only ABI better-sqlite3 is built for): queries against a test's own database.
// argv: <database path> <JSON array of SQL strings> [write]. Prints a JSON array of row arrays. Writing is for a test to
// put in place what an older version left behind, while the app is closed.
const Database = require('better-sqlite3');

const [path, statements, mode] = process.argv.slice(2);
const writing = mode === 'write';
const db = new Database(path, { readonly: !writing, fileMustExist: true });
try { process.stdout.write(JSON.stringify(JSON.parse(statements).map(sql => writing ? (db.prepare(sql).run(), []) : db.prepare(sql).all()))); }
finally { db.close(); }
