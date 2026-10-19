// Runs every offline test and reports a single summary.
//   npm test
const { spawnSync } = require('child_process');
const path = require('path');

const TESTS = [
  ['settings', 'settings-test.js'],
  ['update check', 'updates-test.js'],
  ['backup', 'backup-test.js'],
  ['search', 'search-test.js'],
  ['maxroll extraction', 'extract-test.js'],
  ['cookies', 'cookie-test.js'],
  ['world boss timer', 'timer-test.js'],
  ['activities', 'activities-test.js'],
  ['map progress', 'mapstore-test.js'],
  ['d4guides parsing', 'd4guides-test.js'],
  ['iconic mythics', 'mythics-test.js'],
  ['bar placement', 'place-test.js'],
  ['click spam', 'clicker-test.js'],
  ['farm list + builds', 'farm-test.js'],
  ['compare builds', 'compare-test.js'],
  ['maxroll build import', 'maxbuild-test.js'],
  ['d4builds + d2core import', 'sitebuilds-test.js'],
  ['infinitybuilds import', 'infinitybuilds-test.js'],
  ['builder engine', 'builder-test.js'],
  ['pictures by name', 'icons-test.js'],
  ['main process channels', 'ipc-test.js'],
  ['requests that do not answer', 'netfetch-test.js'],
  ['stylesheet', 'css-test.js'],
  ['overlay UI', 'renderer-smoke.js'],
];

let failed = 0;
for (const [name, file] of TESTS) {
  const r = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const bad = r.status !== 0 || /\bFAIL\b/.test(out);
  if (bad) failed++;
  console.log((bad ? 'FAIL  ' : 'ok    ') + name);
  if (bad) console.log(out.split('\n').map((l) => '        ' + l).join('\n'));
  else {
    // show the lines the test marked as a result
    out.split('\n').filter((l) => /^\s*(ok|→)/.test(l)).forEach((l) => console.log('        ' + l.trim()));
  }
}
console.log('\n' + (failed ? failed + ' of ' + TESTS.length + ' test files failed' : 'all ' + TESTS.length + ' test files passed'));
process.exit(failed ? 1 : 0);
