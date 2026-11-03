// Runs in the development Electron of the same version as the package, under a name that is not the app's and inside
// a Seatbelt rule. It reports where --user-data-dir puts the data folder and what the kernel says about a stand-in folder.
const fs = require('node:fs');
const { join } = require('node:path');
const { app } = require('electron');

const attempt = work => { try { work(); return 'allowed'; } catch (error) { return error.code; } };
const denied = process.env.ROUNDTABLE_PROOF_DENIED;
app.setName('roundtable-isolation-proof');
console.log(`ISOLATION_PROOF ${JSON.stringify({ userData: app.getPath('userData'), read: attempt(() => fs.readdirSync(denied)), write: attempt(() => fs.writeFileSync(join(denied, 'written'), 'x')) })}`);
app.exit(0);
