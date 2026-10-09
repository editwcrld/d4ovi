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
assert.ok(s.includes("[Clicker]::Run(6, 5, 67, 0, '',"), 'started with the right codes and speed, no key loop');
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

// --- loop skills: a toggle key, a list of keys, seconds per key
assert.strictEqual(c.loopMsFor(1.5), 1500);
assert.strictEqual(c.loopMsFor(0), 1000, 'falls back to one second');
assert.strictEqual(c.loopMsFor(0.01), 100, 'not faster than ten rounds a second');
assert.strictEqual(c.loopMsFor(500), 60000, 'at most a minute');
assert.deepStrictEqual(c.keyOf('Q'), [81, 0]);
assert.deepStrictEqual(c.keyOf('Mouse2'), [0x02, 2], 'mouse buttons with their number');
assert.deepStrictEqual(c.keyOf('Space'), [0x20, 0]);
assert.strictEqual(c.keyOf('F5'), null, 'only the listed choices');
assert.deepStrictEqual(c.skillItems([{ key: '4', sec: 12 }, { key: 'Q', sec: 0.5 }, { key: '4', sec: 1 }, { key: 'nope', sec: 1 }, null, { key: 'Mouse1', sec: 2 }]),
  [[52, 0, 12000], [81, 0, 500], [0x01, 1, 2000]], 'the user\'s order, each key once, unknown left out, mouse with its button');
const loop = { ...def, keyLoop: true, skillLoop: [{ key: '1', sec: 0.5 }, { key: 'Q', sec: 12 }], keyLoopBind: 'F8' };
const lp = c.plan(loop, 'Diablo IV');
assert.strictEqual(lp.vkLoop, 0x77, 'F8 toggles');
assert.ok(c.script(lp).includes("[Clicker]::Run(6, 5, 67, 119, '49:500:0,81:12000:0',"), 'helper gets each key with its pace');
assert.ok(c.script(c.plan({ ...loop, skillLoop: [{ key: 'Mouse2', sec: 3 }] }, '')).includes("'2:3000:2'"), 'a mouse button in the list');
assert.ok(c.script(lp).includes('last[i] = Environment.TickCount - every[i]'), 'all keys go out right when it is switched on');
assert.ok(c.script(lp).includes('MouseEdge(kbtn[i], true)'), 'a mouse button is clicked');
assert.strictEqual(c.plan({ ...loop, skillLoop: [{ key: '1', sec: 999 }] }, '').loopItems[0][2], 60000, 'clamped per key');
assert.strictEqual(c.plan({ ...loop, keyLoop: false }, '').vkLoop, 0, 'off switch');
assert.strictEqual(c.plan({ ...loop, skillLoop: [] }, '').vkLoop, 0, 'an empty list -> nothing');
assert.ok(c.plan({ ...loop, clickSpam: false }, '').usable, 'loop skills alone keeps the helper running');
assert.ok(c.script(lp).includes('Key(keys[i], 30)') && c.script(lp).includes('MapVirtualKey'), 'keys go out as scan codes');
console.log('ok  loop skills: list of keys and mouse buttons, pace per key, toggle, off switch');

// --- num-lock mode: keys and mouse buttons held, its own toggle key
assert.deepStrictEqual(c.holdItems(['Mouse1', '1', 'Q', 'Mouse5', 'Mouse9', 'x', '1']),
  [[0x01, 1], [49, 0], [81, 0], [0x06, 5]], 'the user\'s order, mouse buttons with their number, unknown left out, each once');
assert.deepStrictEqual(c.holdItems(null), []);
const hold = { ...def, clickSpam: false, holdOn: true, holdKeys: ['2', 'Mouse2'], holdBind: 'F9' };
const hp = c.plan(hold, 'Diablo IV');
assert.strictEqual(hp.vkHold, 0x78, 'F9 toggles');
assert.ok(hp.usable, 'num-lock mode alone keeps the helper running');
const hs = c.script(hp);
assert.ok(hs.includes("[Clicker]::Run(0, 0, 67, 0, '', 120, '50:0,2:2',"), 'helper gets the toggle and what to hold');
assert.ok(hs.includes('Release(hvk, hbtn)') && /finally \{\s*if \(pressed\) Release/.test(hs), 'lets go when switched off and when it ends');
assert.ok(hs.includes('Console.In.ReadLine()') && hs.includes('quit = true'), 'stdin closing stops it');
assert.ok(hs.includes('inGame = Active(title, proc)'), 'held only while the game is in front');
assert.ok(/repeatAt = now \+ 300/.test(hs) && /repeatAt = now \+ 33/.test(hs) && /if \(hbtn\[i\] == 0\) KeyEdge\(hvk\[i\], true\)/.test(hs),
  'a held key repeats like a real one: a pause, then about 30 times a second (mouse buttons do not)');
assert.strictEqual(c.plan({ ...hold, holdOn: false }, '').vkHold, 0, 'off switch');
assert.strictEqual(c.plan({ ...hold, holdKeys: [] }, '').vkHold, 0, 'nothing listed -> nothing held');
console.log('ok  num-lock mode: keys, mouse buttons, toggle, letting go');

// --- off unless switched on, and nothing at all when the build leaves the macros out
const bare = { clickLeftBind: 'Mouse5', clickRightBind: 'Mouse4', skillLoop: [{ key: '1', sec: 1 }], keyLoopBind: 'F8', holdKeys: ['1'], holdBind: 'F9' };
assert.strictEqual(c.plan(bare, '').usable, false, 'not switched on -> not started');
const all = { ...bare, clickSpam: true, keyLoop: true, holdOn: true };
assert.ok(c.plan(all, '').usable);
const none = c.plan(all, '', false);
assert.ok(!none.usable && !none.vkLeft && !none.vkLoop && !none.vkHold, 'build without macros: never started');
// a build can leave each macro out on its own
const noLoop = c.plan(all, '', { clickSpam: true, loop: false, numlock: true });
assert.ok(noLoop.vkLeft && !noLoop.vkLoop && noLoop.vkHold, 'loop skills left out, the others stay');
const onlyHold = c.plan(all, '', { numlock: true });
assert.ok(!onlyHold.vkLeft && !onlyHold.vkRight && !onlyHold.vkLoop && onlyHold.vkHold && onlyHold.usable, 'only num-lock mode');
assert.strictEqual(c.plan({ ...all, holdOn: false }, '', { numlock: true }).usable, false, 'the one left switched off: not started');
console.log('ok  off by default; a build without macros never starts the helper');

// --- labels for the settings
assert.strictEqual(c.label('Mouse4'), 'Mouse 4');
assert.strictEqual(c.label('F5'), 'F5');
assert.strictEqual(c.label(''), 'not set');
console.log('ok  labels');
