// Click spam: what gets bound, how fast, and what the helper is told.
// Nothing is started here – the test only checks the plan and the generated script.
const assert = require('assert');
const c = require('../lib/clicker');

// --- bindings
assert.strictEqual(c.vkFor('Mouse4'), 0x05, 'thumb back = XBUTTON1');
assert.strictEqual(c.vkFor('Mouse5'), 0x06, 'thumb forward = XBUTTON2');
assert.strictEqual(c.vkFor('Mouse3'), 0x04, 'wheel button');
assert.strictEqual(c.vkFor('F5'), 0x74);
assert.strictEqual(c.vkFor('F12'), 0x7B);
assert.strictEqual(c.vkFor('a'), 65, 'letters are case insensitive');
assert.strictEqual(c.vkFor('Space'), 0x20);
assert.strictEqual(c.vkFor(''), 0, 'nothing bound');
assert.strictEqual(c.vkFor('Control+Q'), 0, 'combinations are not supported – one key only');
assert.strictEqual(c.vkFor('F25'), 0, 'no such key');
console.log('ok  bindings: thumb buttons, keys, and what is rejected');

// --- speed
assert.strictEqual(c.delayFor(15), 67, '15 per second');
assert.strictEqual(c.delayFor(40), 25, 'fastest');
assert.strictEqual(c.delayFor(500), 25, 'clamped at 40 per second');
assert.strictEqual(c.delayFor(0), 67, 'falls back to the default');
assert.strictEqual(c.delayFor(1), 1000, 'slowest');
console.log('ok  speed is clamped to 1–40 per second');

// --- the plan: the defaults are Mouse4 = right, Mouse5 = left
const def = { clickSpam: true, clickLeftBind: 'Mouse5', clickRightBind: 'Mouse4', clickCps: 15, d4WindowTitle: 'Diablo IV' };
const p = c.plan(def, 'Diablo IV');
assert.strictEqual(p.vkLeft, 0x06, 'Mouse5 sends left clicks');
assert.strictEqual(p.vkRight, 0x05, 'Mouse4 sends right clicks');
assert.strictEqual(p.title, 'Diablo IV');
assert.ok(p.usable);

// switched off, or nothing bound -> the helper is not started at all
assert.strictEqual(c.plan({ ...def, clickSpam: false }, 'Diablo IV').usable, false, 'disabled');
assert.strictEqual(c.plan({ ...def, clickLeftBind: '', clickRightBind: '' }, 'Diablo IV').usable, false, 'nothing bound');
assert.ok(c.plan({ ...def, clickLeftBind: '' }, 'Diablo IV').usable, 'one side is enough');
assert.strictEqual(c.plan({ ...def, clickLeftBind: '' }, 'Diablo IV').vkLeft, 0, 'the unbound side stays off');
console.log('ok  plan: defaults, off switch, half bound');

// --- the generated helper
const s = c.script(p);
assert.ok(s.includes("[Clicker]::Run(6, 5, 67, 0, '', 1000,"), 'started with the right codes and speed, no key loop');
assert.ok(s.includes("'Diablo IV'"), 'window title passed through');
assert.ok(s.includes('GetAsyncKeyState') && s.includes('SendInput'), 'polls the key, sends the clicks');
assert.ok(s.includes('GetForegroundWindow'), 'checks which window is in front');
assert.ok(s.includes('ParentAlive'), 'stops when the overlay is gone');
assert.ok(/Active\(title, proc\)/.test(s), 'clicks only while the game is in front');
console.log('ok  helper script carries key codes, window check and the dead-man switch');

// a window title with a quote must not break out of the PowerShell string
const odd = c.script(c.plan({ ...def, d4WindowTitle: "Diablo' IV" }, ''));
assert.ok(odd.includes("'Diablo'' IV'"), 'quotes are escaped');
assert.ok(!/\n\[Clicker\]::Run\([^)]*IV'[^)]*\)[^\n]/.test(odd), 'nothing injected after the call');
console.log('ok  window titles are escaped');

// --- key loop: a toggle key, the skill keys 1–4, seconds between rounds
assert.deepStrictEqual(c.loopKeys('4321'), [49, 50, 51, 52], 'in order 1–4');
assert.deepStrictEqual(c.loopKeys('13x9 1'), [49, 51], 'only 1–4, each once');
assert.strictEqual(c.loopMsFor(1.5), 1500);
assert.strictEqual(c.loopMsFor(0), 1000, 'falls back to one second');
assert.strictEqual(c.loopMsFor(0.01), 100, 'not faster than ten rounds a second');
assert.strictEqual(c.loopMsFor(500), 60000, 'at most a minute');
const loop = { ...def, keyLoop: true, keyLoopKeys: '124', keyLoopSec: 2, keyLoopBind: 'F8' };
const lp = c.plan(loop, 'Diablo IV');
assert.strictEqual(lp.vkLoop, 0x77, 'F8 toggles');
assert.ok(c.script(lp).includes("[Clicker]::Run(6, 5, 67, 119, '49,50,52', 2000,"), 'helper gets toggle, keys and pace');
assert.strictEqual(c.plan({ ...loop, keyLoop: false }, '').vkLoop, 0, 'off switch');
assert.strictEqual(c.plan({ ...loop, keyLoopKeys: '' }, '').vkLoop, 0, 'no keys picked -> no loop');
assert.ok(c.plan({ ...loop, clickSpam: false }, '').usable, 'the loop alone keeps the helper running');
assert.ok(c.script(lp).includes('Key(k, 30)') && c.script(lp).includes('MapVirtualKey'), 'keys go out as scan codes');
console.log('ok  key loop: keys, pace, toggle, off switch');

// --- labels for the settings
assert.strictEqual(c.label('Mouse4'), 'Mouse 4');
assert.strictEqual(c.label('F5'), 'F5');
assert.strictEqual(c.label(''), 'not set');
console.log('ok  labels');
