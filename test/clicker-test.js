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
assert.ok(s.includes("[Clicker]::Run(6, 5, 67, 0, '',"), 'started with the right codes and speed, no lock');
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

// --- lock: one list, each key held (lock) or pressed on a timer; one toggle key
assert.strictEqual(c.loopMsFor(1.5), 1500);
assert.strictEqual(c.loopMsFor(0), 1000, 'falls back to one second');
assert.strictEqual(c.loopMsFor(0.01), 100, 'not faster than ten rounds a second');
assert.strictEqual(c.loopMsFor(500), 60000, 'at most a minute');
assert.deepStrictEqual(c.keyOf('Q'), [81, 0]);
assert.deepStrictEqual(c.keyOf('Mouse2'), [0x02, 2], 'mouse buttons with their number');
assert.deepStrictEqual(c.keyOf('Space'), [0x20, 0]);
assert.strictEqual(c.keyOf('F5'), null, 'only the listed choices');
assert.deepStrictEqual(c.lockItems([{ key: '4', lock: false, sec: 12 }, { key: 'Q', sec: 0.5 }, { key: '4', lock: true }, { key: 'nope' }, null, { key: 'Mouse1', lock: false, sec: 2 }]),
  [[52, 0, 12000], [81, 0, 0], [0x01, 1, 2000]], 'the user\'s order, each key once, unknown left out; lock unless false (ms 0 = held)');
assert.deepStrictEqual(c.lockItems(null), []);
assert.deepStrictEqual(c.lockItems([{ key: '1', off: true }, { key: '2' }, { key: '1' }]), [[50, 0, 0]], 'a key switched off is left out (and still counts as in the list)');
assert.strictEqual(c.plan({ lockOn: true, lockBind: 'F9', lockKeys: [{ key: '1', off: true }] }, '').usable, false, 'all switched off: nothing to run');
const lock = { ...def, clickSpam: false, lockOn: true, lockKeys: [{ key: '1', lock: true }, { key: 'Q', lock: false, sec: 12 }, { key: 'Mouse2', lock: false, sec: 3 }], lockBind: 'F9' };
const lp = c.plan(lock, 'Diablo IV');
assert.strictEqual(lp.vkLock, 0x78, 'F9 toggles');
assert.ok(lp.usable, 'lock alone keeps the helper running');
const ls = c.script(lp);
assert.ok(ls.includes("[Clicker]::Run(0, 0, 67, 120, '49:0:0,81:12000:0,2:3000:2', 'Diablo IV',"), 'helper gets the toggle and each key: held, or its pace');
assert.ok(ls.includes('last[i] = Environment.TickCount - every[i]'), 'the timed keys go out right when it is switched on');
assert.ok(!/if \(pressed\) \{ Release\(vk, btn, every\); pressed = false; \}\s*last\[i\]/.test(ls), 'a timed key due: the held ones stay down');
assert.ok(ls.includes('Key(vk[i], 60)') && ls.includes('Thread.Sleep(60); MouseEdge(btn[i], false)'), 'a timed tap lasts 60 ms – long enough for a slow frame');
assert.ok(ls.includes('toggle.Start(vkLock)') && ls.includes('lockPresses++'), 'the toggle key is watched on its own thread – a short tap is not missed');
assert.ok(ls.includes('timeBeginPeriod(1)') && ls.includes('timeEndPeriod(1)'), 'sleeps are precise to 1 ms');
assert.ok(ls.indexOf('every[i] == 0 || unchecked') < ls.indexOf('if (!pressed) {'), 'timed keys before the held ones');
assert.ok(ls.includes('MapVirtualKey'), 'keys go out as scan codes');
assert.ok(ls.includes('MouseEdge(btn[i], true)'), 'mouse buttons too');
assert.ok(/finally \{\s*if \(pressed\) Release/.test(ls), 'lets go when it ends');
assert.ok(ls.includes('Console.In.ReadLine()') && ls.includes('quit = true'), 'stdin closing stops it');
assert.ok(ls.includes('inGame = Active(title, proc)'), 'only while the game is in front');
assert.ok(/repeatAt = now \+ 300/.test(ls) && /repeatAt = now \+ 33/.test(ls), 'a held key repeats like a real one');
// a left click by hand or left click spam pauses it
assert.ok(ls.includes('SetWindowsHookEx(14') && /\(s\.flags & 1\) == 0/.test(ls), 'a mouse hook tells a hand click from a sent one');
assert.ok(/bool hand = handLeft \|\| map \|\| \(spam && l\)/.test(ls), 'left click by hand, the map, or left click spam');
assert.ok(/< 250\)/.test(ls) && /locking && inGame && !paused/.test(ls), 'waits until let go, and a moment more');
// the map: Tab opens and closes it, Esc closes it – lock waits while it is open
assert.ok(ls.includes('SetWindowsHookEx(13') && /k\.vkCode == 0x09/.test(ls) && /mapOpen = !mapOpen/.test(ls), 'Tab toggles the map');
assert.ok(/k\.vkCode == 0x1B && down\) mapOpen = false/.test(ls), 'Esc closes it');
assert.ok(/!tabDown && active/.test(ls), 'a held Tab counts once, only in the game with lock on');
assert.ok(/if \(mapOpen\) break;/.test(ls), 'the timed keys stop at once when the map opens');
assert.ok(ls.includes('\\"map\\":true'), 'tells the overlay it waits for the map');
assert.ok(ls.includes('"{\\"pause\\":true}"'), 'tells the overlay it waits');
assert.strictEqual(c.plan({ ...lock, lockOn: false }, '').vkLock, 0, 'off switch');
assert.strictEqual(c.plan({ ...lock, lockKeys: [] }, '').vkLock, 0, 'an empty list -> nothing');
assert.strictEqual(c.plan({ ...lock, lockKeys: [{ key: '1', sec: 999, lock: false }] }, '').lockItems[0][2], 60000, 'clamped per key');
assert.ok(!c.script(c.plan(def, '')).includes("'49:"), 'click spam alone: no lock keys');
// what goes on the command line stays under the Windows limit (32767), with room to spare
const big = c.plan({ ...lock, clickSpam: true, d4WindowTitle: 'Diablo IV', lockKeys: c.KEY_CHOICES.map((k, i) => ({ key: k, lock: i % 2 === 0, sec: 1 })) }, 'Diablo IV');
assert.ok(c.encoded(big).length < 30000, 'encoded helper fits the command line: ' + c.encoded(big).length);
const plain = Buffer.from(c.encoded(big), 'base64').toString('utf16le');
assert.ok(!/^\s*\/\//m.test(plain) && plain.includes('[Clicker]::Run(') && /^"@$/m.test(plain), 'comments gone, the here-string end still on its own line');
console.log('ok  lock: held or timed per key, timed first in order, left click and the map pause, toggle, off switch');

// --- off unless switched on, and nothing at all when the build leaves the macros out
const bare = { clickLeftBind: 'Mouse5', clickRightBind: 'Mouse4', lockKeys: [{ key: '1' }], lockBind: 'F9' };
assert.strictEqual(c.plan(bare, '').usable, false, 'not switched on -> not started');
const all = { ...bare, clickSpam: true, lockOn: true };
assert.ok(c.plan(all, '').usable);
const none = c.plan(all, '', false);
assert.ok(!none.usable && !none.vkLeft && !none.vkLock, 'build without macros: never started');
// a build can leave each macro out on its own
const noLock = c.plan(all, '', { clickSpam: true, lock: false });
assert.ok(noLock.vkLeft && !noLock.vkLock, 'lock left out, click spam stays');
const onlyLock = c.plan(all, '', { lock: true });
assert.ok(!onlyLock.vkLeft && !onlyLock.vkRight && onlyLock.vkLock && onlyLock.usable, 'only lock');
assert.strictEqual(c.plan({ ...all, lockOn: false }, '', { lock: true }).usable, false, 'the one left switched off: not started');
console.log('ok  off by default; a build without macros never starts the helper');

// --- labels for the settings
assert.strictEqual(c.label('Mouse4'), 'Mouse 4');
assert.strictEqual(c.label('F5'), 'F5');
assert.strictEqual(c.label(''), 'not set');
console.log('ok  labels');
