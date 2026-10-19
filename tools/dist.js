// Builds the portable .exe (electron-builder) – without the macros, unless asked for:
//   npm run dist        without lock and click spam (the one to share)
//   npm run dist:m      with them (the same as npm run dist -- --m)
// The choice is written into lib/build-flags.json for the build (lib/features.js reads it) and
// taken out again afterwards, so running from source is not changed by it.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// --m on this script's own command line – npm 11 does not hand its own unknown flags on
const macros = process.argv.includes('--m');
const flags = path.join(__dirname, '..', 'lib', 'build-flags.json');
console.log('Building the .exe ' + (macros ? 'WITH the macros (lock, click spam) – for yourself only' : 'without the macros'));
fs.writeFileSync(flags, JSON.stringify({ macros }) + '\n');
let code = 1;
try {
  const r = spawnSync('npx', ['electron-builder', '--win', 'portable'], { stdio: 'inherit', shell: true, cwd: path.join(__dirname, '..') });
  code = r.status == null ? 1 : r.status;
} finally {
  fs.rmSync(flags, { force: true });
}
process.exit(code);
