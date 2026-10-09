// World boss timer: parsing, and the last reading held while the page reloads
const assert = require('assert');
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { session: {}, app: {} }; return orig.call(this, r, ...a); };
const { parseTimer, holdTimer } = require('../lib/trade');

assert.strictEqual(parseTimer('00:41:11'), 41 * 60 + 11);
assert.strictEqual(parseTimer('1d 02:00:00'), 86400 + 7200);
assert.strictEqual(parseTimer(''), null);
console.log('ok  countdown text read');

const t0 = 1e12;
const good = holdTimer({ text: '00:10:00', secs: 600, at: t0 });
assert.strictEqual(good.secs, 600);
const during = holdTimer({ text: '', secs: null, at: t0 + 15000 });
assert.strictEqual(during.secs, 600, 'reload: the last reading is kept …');
assert.strictEqual(during.at, t0, '… and counts on from when it was read');
assert.strictEqual(holdTimer({ text: '', secs: null, at: t0 + 4 * 60000 }).secs, null, 'not for ever');
holdTimer({ text: '00:00:20', secs: 20, at: t0 });
assert.strictEqual(holdTimer({ text: '', secs: null, at: t0 + 30000 }).secs, null, 'never past the spawn');
console.log('ok  reload does not blank the timer');
