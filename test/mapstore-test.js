// Map progress: save to file, restore on a "fresh PC", never overwrite a newer local state.
// The embedded page is faked, so this runs without Electron and without network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const mapstore = require('../lib/mapstore');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4map-'));
const file = path.join(dir, 'map-progress.json');
mapstore.configure({ file, log: () => {} });

// A stand-in for the map page: executeJavaScript() answers like a browser would.
function fakePage(store) {
  return {
    isDestroyed: () => false,
    async executeJavaScript(code) {
      if (code.includes('localStorage.key(i)')) return { ...store };       // snapshot
      const m = code.match(/const d = (\{[\s\S]*?\});/);                   // restore
      const data = JSON.parse(m[1]);
      let n = 0;
      for (const k of Object.keys(data)) { store[k] = data[k]; n++; }
      return n;
    },
  };
}

(async () => {
  // --- PC 1: two real entries plus one cookie-banner key that must not be saved
  const pc1 = { 'd4-map-altars': '[12,47,88]', 'd4-map-quests': '[3,9]', 'cookie-consent': 'yes' };
  const saved = await mapstore.save(fakePage(pc1));
  assert.strictEqual(saved, 2, 'only progress is saved, consent keys are skipped');
  const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(onDisk.savedAt, 'file carries a timestamp');
  assert.deepStrictEqual(Object.keys(onDisk.keys).sort(), ['d4-map-altars', 'd4-map-quests']);
  console.log('ok  saved', saved, 'entries ·', fs.statSync(file).size, 'bytes');

  // --- PC 2: nothing there yet -> the file is played back
  const pc2 = {};
  const restored = await mapstore.restore(fakePage(pc2), false);
  assert.strictEqual(restored, 2, 'restored on a fresh machine');
  assert.strictEqual(pc2['d4-map-altars'], '[12,47,88]');
  console.log('ok  fresh machine: restored', restored, 'entries');

  // --- PC 3: already has its own progress -> must NOT be overwritten
  const pc3 = { 'd4-map-altars': '[1,2,3,4,5]' };
  const skipped = await mapstore.restore(fakePage(pc3), false);
  assert.strictEqual(skipped, 0, 'existing progress is left alone');
  assert.strictEqual(pc3['d4-map-altars'], '[1,2,3,4,5]');
  console.log('ok  existing progress is not overwritten');

  // --- forced restore (the button in the settings) does overwrite
  const forced = await mapstore.restore(fakePage(pc3), true);
  assert.strictEqual(forced, 2);
  assert.strictEqual(pc3['d4-map-altars'], '[12,47,88]', 'forced restore wins');
  console.log('ok  forced restore overwrites');

  // --- nothing to save must not clobber the file
  const before = fs.readFileSync(file, 'utf8');
  await mapstore.save(fakePage({ 'cookie-consent': 'yes' }));
  assert.strictEqual(fs.readFileSync(file, 'utf8'), before, 'empty snapshot leaves the file untouched');
  console.log('ok  empty snapshot keeps the old file');

  fs.rmSync(dir, { recursive: true, force: true });
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
