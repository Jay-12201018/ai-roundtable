// Runs in Electron's Node (the only ABI better-sqlite3 is built for): read-only queries against a test's own database.
// argv: <database path> <JSON array of SQL strings>. Prints a JSON array of row arrays.
const Database = require('better-sqlite3');

const [path, statements] = process.argv.slice(2);
const db = new Database(path, { readonly: true, fileMustExist: true });
try { process.stdout.write(JSON.stringify(JSON.parse(statements).map(sql => db.prepare(sql).all()))); }
finally { db.close(); }
