// Backups of the data folder: what goes along, folder names, only the newest kept.
//   node test/backup-test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const backup = require('../lib/backup');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd4bk-'));
const data = path.join(tmp, 'data'), target = path.join(tmp, 'OneDrive', 'D4');
fs.mkdirSync(data);
fs.writeFileSync(path.join(data, 'settings.json'), '{"notes":{}}');
fs.writeFileSync(path.join(data, 'builds.json'), '{"builds":[]}');
fs.writeFileSync(path.join(data, 'items-cache.json'), '[]');          // a cache – not backed up
fs.mkdirSync(path.join(data, 'Partitions'));                          // the login – never

try {
  const r = backup.run(data, target, { now: new Date('2026-10-11T14:05:09Z') });
  assert.strictEqual(path.basename(r.dir), 'D4-Overlay-Backup-2026-10-11_14-05-09');
  assert.deepStrictEqual(r.files, ['settings.json', 'builds.json'], 'what exists goes along, nothing else');
  assert.deepStrictEqual(fs.readdirSync(r.dir).sort(), ['builds.json', 'settings.json']);
  assert.strictEqual(fs.readFileSync(path.join(r.dir, 'settings.json'), 'utf8'), '{"notes":{}}');
  assert.strictEqual(backup.lastAt(target), Date.parse('2026-10-11T14:05:09Z'), 'when the last one was made');
  console.log('ok  a backup: own folder, only your files');

  for (let i = 1; i <= 4; i++) backup.run(data, target, { keep: 3, now: new Date(Date.UTC(2026, 9, 12, i)) });
  const left = backup.list(target);
  assert.strictEqual(left.length, 3, 'only the newest three kept');
  assert.strictEqual(left[2], 'D4-Overlay-Backup-2026-10-12_04-00-00');
  console.log('ok  old backups go');

  assert.throws(() => backup.run(data, ''), /no backup folder/);
  assert.strictEqual(backup.lastAt(path.join(tmp, 'nothing')), 0);
  console.log('ok  no folder chosen, none made yet');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
