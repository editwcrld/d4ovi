// Where the window goes (lib/place.js). The bugs this guards against: the strip walking across the
// screen – every round of a wider strip (the sections sliding, the bar right after the panel closed)
// at the right edge pushed it left for good – and sliding out at the right edge not keeping its
// right end.
const assert = require('assert');
const place = require('../lib/place');

const wa = { x: 0, y: 0, width: 2560, height: 1392 };
const STRIP = 392, WIDE = 547, H = 46;

// --- the place is never moved by what is shown: a strip at the right edge, wider for a moment
// after the panel closed, then back to its width – round after round
const home = { x: 2137, y: 341 };
const seen = [];
for (let i = 0; i < 5; i++) {
  const wide = place.shown(home, WIDE, H, wa);
  assert.strictEqual(wide.x, 2560 - WIDE, 'wider for a moment: shown on the screen');
  seen.push(place.shown(home, STRIP, H, wa).x);
}
assert.deepStrictEqual(seen, [2137, 2137, 2137, 2137, 2137], 'back where it was put, every time: ' + seen.join(', '));
console.log('ok  the strip stays where it was put (' + seen.join(', ') + ')');

// --- shown on the screen, on every side
assert.deepStrictEqual(place.shown({ x: 2500, y: 20 }, STRIP, H, wa), { x: 2560 - STRIP, y: 20 }, 'right edge');
assert.deepStrictEqual(place.shown({ x: -80, y: 20 }, STRIP, H, wa), { x: 0, y: 20 }, 'left edge');
assert.deepStrictEqual(place.shown({ x: 100, y: 1380 }, STRIP, H, wa), { x: 100, y: 1392 - H }, 'bottom');
assert.deepStrictEqual(place.shown({ x: 100, y: -30 }, STRIP, H, wa), { x: 100, y: 0 }, 'top');
console.log('ok  shown on the work area');

// --- a strip never put anywhere: centred, whatever width it has
assert.strictEqual(place.centred(STRIP, wa), Math.round((2560 - STRIP) / 2));
assert.strictEqual(place.centred(STRIP + 40, wa), Math.round((2560 - STRIP - 40) / 2), 'stays centred when the timer gets longer');
console.log('ok  an undragged strip stays centred');

// --- sliding out under the mouse: to the right – at the right edge to the left, its right end kept
assert.strictEqual(place.slideOut({ x: 1000, w: 300 }, 700, wa), 1000, 'room on the right: it grows to the right');
assert.strictEqual(place.slideOut({ x: 2200, w: 300 }, 700, wa), 1800, 'at the right edge: to the left, right end at 2500 as before');
assert.strictEqual(place.slideOut({ x: 2260, w: 300 }, 700, wa), 1860, 'touching the edge: the same');
assert.strictEqual(place.slideOut({ x: 0, w: 300 }, 700, wa), 0, 'at the left edge: to the right');
assert.strictEqual(place.slideOut({ x: 100, w: 300 }, 3000, wa), 0, 'wider than the screen: on it');
console.log('ok  sliding out keeps the right end at the right edge');

// --- a place on a second screen counts as valid, a leftover from a removed one does not
const displays = [{ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }, { bounds: { x: 2560, y: 0, width: 1920, height: 1080 } }];
assert.ok(place.onScreen({ x: 3000, y: 100 }, displays), 'second screen');
assert.ok(!place.onScreen({ x: 5000, y: 100 }, displays), 'screen no longer there');
assert.ok(!place.onScreen(null, displays), 'nothing saved yet');
console.log('ok  saved places are checked against the screens');
