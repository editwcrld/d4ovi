// Where the bar lands when it shrinks to the pill and grows back.
// The bug this guards against: every idle -> awake -> idle round moved the pill half the
// width difference to the left, until it sat at the screen edge.
const assert = require('assert');
const place = require('../lib/place');

const wa = { x: 0, y: 0, width: 2560, height: 1392 };
const RAIL = 62;        // 48 css px at the usual zoom
const PILL = 308;       // 239 css px – timer, magnifier, diablo.trade, quit

// Replays what the main process does: switching state sets the place from the settings
// (fixed), then the overlay reports its real size once or twice.
function round(start, opts) {
  let x = start, prev = opts.fromWidth;
  // 1. state switch: place comes from the settings, size not reported yet
  x = place.barLeft({ barX: x, bw: prev, prevBw: prev, wa, idle: opts.idle, centre: opts.centre, fixed: true });
  // 2. + 3. the two size reports of the renderer
  for (const w of [opts.toWidth, opts.toWidth]) {
    x = place.barLeft({ barX: x, bw: w, prevBw: prev, wa, idle: opts.idle, centre: opts.centre, fixed: true });
    prev = w;
  }
  // 4. later reports (window size setting, labels …) are not frozen any more
  x = place.barLeft({ barX: x, bw: prev, prevBw: prev, wa, idle: opts.idle, centre: opts.centre, fixed: false });
  return x;
}

// --- a pill that was dragged to 900 stays at 900, round after round
let idleX = 900;
const seen = [];
for (let i = 0; i < 5; i++) {
  idleX = round(idleX, { idle: true, centre: false, fromWidth: RAIL, toWidth: PILL });
  seen.push(idleX);
  // awake again: the open bar has its own place, the pill's is kept
  round(24, { idle: false, centre: false, fromWidth: PILL, toWidth: RAIL });
}
assert.deepStrictEqual(seen, [900, 900, 900, 900, 900], 'the dragged pill never moves: ' + seen.join(', '));
// the core of the old bug: a width change alone must not move the pill, frozen or not
assert.strictEqual(place.barLeft({ barX: 900, bw: PILL, prevBw: RAIL, wa, idle: true, centre: false, fixed: false }),
  900, 'growing from rail to pill does not shift the pill');
console.log('ok  dragged pill stays put over 5 rounds (' + seen.join(', ') + ')');

// --- a pill that was never dragged stays centred, whatever width it has
const centred = round(0, { idle: true, centre: true, fromWidth: RAIL, toWidth: PILL });
assert.strictEqual(centred, Math.round((2560 - PILL) / 2), 'centred on the work area');
assert.strictEqual(round(centred, { idle: true, centre: true, fromWidth: PILL, toWidth: PILL + 40 }),
  Math.round((2560 - PILL - 40) / 2), 'stays centred when the timer gets longer');
console.log('ok  undragged pill stays centred');

// --- the open horizontal bar still grows around its centre
const grown = place.barLeft({ barX: 1000, bw: 600, prevBw: 400, wa, idle: false, centre: false, fixed: false });
assert.strictEqual(grown, 900, 'half of the growth to the left');
const shrunk = place.barLeft({ barX: 900, bw: 400, prevBw: 600, wa, idle: false, centre: false, fixed: false });
assert.strictEqual(shrunk, 1000, 'and back on the way down');
console.log('ok  open bar still grows around its centre');

// --- nothing ever leaves the screen
assert.strictEqual(place.barLeft({ barX: 2500, bw: PILL, prevBw: PILL, wa, idle: true, centre: false, fixed: false }),
  2560 - PILL, 'clamped at the right edge');
assert.strictEqual(place.barLeft({ barX: -80, bw: PILL, prevBw: PILL, wa, idle: true, centre: false, fixed: false }),
  0, 'clamped at the left edge');
console.log('ok  clamped to the work area');

// --- a place on a second screen counts as valid, a leftover from a removed one does not
const displays = [{ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }, { bounds: { x: 2560, y: 0, width: 1920, height: 1080 } }];
assert.ok(place.onScreen({ x: 3000, y: 100 }, displays), 'second screen');
assert.ok(!place.onScreen({ x: 5000, y: 100 }, displays), 'screen no longer there');
assert.ok(!place.onScreen(null, displays), 'nothing saved yet');
console.log('ok  saved places are checked against the screens');
