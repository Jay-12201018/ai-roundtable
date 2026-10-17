const assert=require('node:assert/strict');const Sqlite=require('better-sqlite3');
assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
assert.equal(process.versions.modules,process.versions.electron?'139':'137');assert.equal(process.versions.node,process.versions.electron?'22.22.0':'24.18.1');
if(process.versions.electron)assert.equal(process.versions.electron,'38.8.6');
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
