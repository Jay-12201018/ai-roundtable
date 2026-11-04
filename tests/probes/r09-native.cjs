const assert=require('node:assert/strict');
// The one native build is for Electron's Node; from a plain Node this probe hands itself over to it.
if(!process.versions.electron){const {status}=require('node:child_process').spawnSync(process.execPath,[require('node:path').join(__dirname,'../../scripts/electron-node.cjs'),__filename],{stdio:'inherit'});process.exit(status??1);}
const Sqlite=require('better-sqlite3');
assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
assert.equal(process.versions.modules,'139');assert.equal(process.versions.node.split('.')[0],'22');assert.equal(process.versions.electron.split('.')[0],'38');
let rows=0;
for(let pass=0;pass<100;pass++){
 const db=new Sqlite(':memory:');
 try{
  db.exec('CREATE TABLE evidence(id INTEGER PRIMARY KEY, content TEXT NOT NULL)');const insert=db.prepare('INSERT INTO evidence(content) VALUES (?)');
  db.transaction(()=>{for(let n=0;n<100;n++)insert.run('owned fixture '+n);})();
  assert.equal(db.prepare('SELECT count(*) FROM evidence').pluck().get(),100);assert.deepEqual(db.prepare('PRAGMA integrity_check').pluck().all(),['ok']);rows+=100;
 }finally{db.close();}
}
console.log(JSON.stringify({status:'PASS',runtime:process.versions.electron?'electron':'node',node:process.versions.node,electron:process.versions.electron,abi:process.versions.modules,arch:process.arch,databases:100,rows,naturalExit:true}));
