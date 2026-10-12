// Settings: defaults, and every migration of an older settings file.
//   node test/settings-test.js
const assert = require('assert');
const { DEFAULTS, load } = require('../lib/settings');

// a first start: the defaults, written once (the macro revisions are stamped)
let r = load(undefined);
assert.ok(r.changed, 'a fresh file is written');
assert.strictEqual(r.settings.macroRev, 3);
assert.strictEqual(r.settings.ctName, 'Timer');
assert.deepStrictEqual(r.settings.lockKeys, []);
assert.ok(!load([]).settings.length && load('x').settings.d4WindowTitle === DEFAULTS.d4WindowTitle, 'junk reads as nothing');
// a current file stays as it is
r = load(r.settings);
assert.ok(!r.changed, 'nothing to do on a current file');
console.log('ok  defaults, current file untouched');

// the defaults are never shared between two loads
const a = load({}).settings, b = load({}).settings;
a.recent.push('x');
assert.deepStrictEqual(b.recent, [], 'no shared arrays');
assert.deepStrictEqual(DEFAULTS.recent, [], 'defaults unchanged');

// the Fields of Hatred timers became one timer of your own
r = load({ macroRev: 3, fohTimers: false, fohMin: 7 });
assert.ok(r.changed && r.settings.ctTimer === false && r.settings.ctSecs === 420, 'switch and minutes carry over');
r = load({ macroRev: 3, ctMin: 12 });
assert.ok(r.changed && r.settings.ctSecs === 720 && !('ctMin' in r.settings), 'the slider\'s minutes become seconds');
assert.ok(load({}).settings.ctSecs === 300 && load({}).settings.ctUp === false, '5:00, counting down by default');
assert.ok(!('fohTimers' in r.settings) && !('fohMin' in r.settings), 'old keys gone');
console.log('ok  Fields of Hatred -> own timer');

// the update check: off by default, and switched off once in a file from before
assert.strictEqual(load(undefined).settings.updateCheck, false, 'off on a first start');
r = load({ macroRev: 3, updateCheck: true });
assert.ok(r.changed && r.settings.updateCheck === false && r.settings.updateRev === 1, 'an older file: switched off once');
r = load(r.settings); r.settings.updateCheck = true;
assert.strictEqual(load(r.settings).settings.updateCheck, true, 'switched on again by hand: it stays on');
console.log('ok  update check off by default');

// one place -> pill and open bar; an unused setting goes
r = load({ macroRev: 3, position: { x: 5, y: 6 }, fadeAfterSec: 8 });
assert.deepStrictEqual(r.settings.posOpen, { x: 5, y: 6 });
assert.ok(!('position' in r.settings) && !('fadeAfterSec' in r.settings));
r = load({ macroRev: 3, position: { x: 5, y: 6 }, posOpen: { x: 1, y: 2 } });
assert.deepStrictEqual(r.settings.posOpen, { x: 1, y: 2 }, 'a newer place wins');
console.log('ok  old place, unused keys');

// the builds hotkey: filled once when empty, a chosen one stays
assert.strictEqual(load({ macroRev: 3, hotkeyFarm: '' }).settings.hotkeyFarm, DEFAULTS.hotkeyFarm);
assert.strictEqual(load({ macroRev: 3, hotkeyRev: 1, hotkeyFarm: 'F7' }).settings.hotkeyFarm, 'F7');
assert.strictEqual(load({ macroRev: 3, hotkeyRev: 2, hotkeyFarm: '' }).settings.hotkeyFarm, '', 'cleared on purpose later: stays empty');
console.log('ok  builds hotkey');

// macros from before they had their own tab: off, keys carried over into lock
r = load({
  clickSpam: true, keyLoop: true, keyLoopKeys: '12Q', keyLoopSecs: { 1: 2.5 }, keyLoopSec: 1, keyLoopBind: 'F8',
  holdOn: true, holdKeys: ['Mouse1', '2'], holdBind: 'F6',
  macroChars: [{ name: 'Necro', keyLoopKeys: '3', keyLoopSecs: { 3: 4 }, holdKeys: ['Space'] }, null],
});
const s = r.settings;
assert.ok(s.clickSpam === false && s.lockOn === false, 'every macro starts switched off');
assert.deepStrictEqual(s.lockKeys, [
  { key: '1', lock: false, sec: 2.5 }, { key: '2', lock: false, sec: 1 }, { key: 'Q', lock: false, sec: 1 },
  { key: 'Mouse1', lock: true, sec: 1 },
], 'timed keys first, each key once');
assert.strictEqual(s.lockBind, 'F6', 'both were switched off by rev 1: the hold key stays');
assert.deepStrictEqual(s.macroChars, [{ name: 'Necro', lockKeys: [{ key: '3', lock: false, sec: 4 }, { key: 'Space', lock: true, sec: 1 }] }]);
for (const k of ['keyLoop', 'skillLoop', 'keyLoopBind', 'holdOn', 'holdKeys', 'holdBind', 'keyLoopKeys', 'keyLoopSecs', 'keyLoopSec']) {
  assert.ok(!(k in s), k + ' is gone');
}
// rev 2 -> 3: a running hold mode keeps its key
r = load({ macroRev: 2, holdOn: true, holdBind: 'F6', holdKeys: ['Shift'], skillLoop: [{ key: '4', sec: 0 }] });
assert.ok(r.settings.lockOn && r.settings.lockBind === 'F6');
assert.deepStrictEqual(r.settings.lockKeys, [{ key: '4', lock: false, sec: 1 }, { key: 'Shift', lock: true, sec: 1 }]);
console.log('ok  macros: rev 1 → 3');
