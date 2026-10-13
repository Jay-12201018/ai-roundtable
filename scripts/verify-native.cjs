const { execFileSync } = require('node:child_process');
const { join } = require('node:path');

module.exports = ({ appOutDir, electronPlatformName, arch, packager }) => {
  const targetArch = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'][arch];
  if (electronPlatformName !== process.platform || (targetArch !== process.arch && targetArch !== 'universal')) {
    console.log(`Native SQLite runtime check: 未验证 (${electronPlatformName}/${targetArch} requires its target host)`);
    return;
  }
  const name = packager.appInfo.productFilename;
  const executable = electronPlatformName === 'darwin'
    ? join(appOutDir, `${name}.app`, 'Contents', 'MacOS', name)
    : join(appOutDir, electronPlatformName === 'win32' ? `${name}.exe` : packager.executableName);
  const resources = packager.getResourcesDir(appOutDir);
  const modulePath = join(resources, 'app.asar', 'node_modules', 'better-sqlite3');
  const code = `const assert = require('node:assert/strict');
    const Database = require(${JSON.stringify(modulePath)});
    const db = new Database(':memory:');
    db.exec('CREATE TABLE smoke (value TEXT)');
    db.prepare('INSERT INTO smoke VALUES (?)').run('sqlite-ready');
    assert.equal(db.prepare('SELECT value FROM smoke').get().value, 'sqlite-ready');
    db.close();
    console.log('Packaged SQLite PASS: Electron ABI ' + process.versions.modules);`;
  const output = execFileSync(executable, ['-e', code], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    timeout: 15000, encoding: 'utf8',
  });
  console.log(output.trim());
};
