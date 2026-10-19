// The window's whole flow (lib/windowplace.js), as main.js drives it – with a stand-in for the
// screen and the window. Each step is one that went wrong once: the panel's place lost at start-up,
// the strip walking left at the right edge after closing, sliding out not keeping its right end,
// our own moves taken for a drag by hand.
const assert = require('assert');
const windowplace = require('../lib/windowplace');

const WA = { x: 0, y: 0, width: 2560, height: 1392 };
const STRIP = 392, WIDE = 578, H = 46;

function rig(settings) {
  const seen = { bounds: [], layout: [], saved: 0 };
  const win = windowplace.create({
    settings: () => settings,
    screen: { matching: () => WA, primary: () => WA, displays: () => [{ bounds: WA }] },
    zoom: () => 1,
    setBounds: (b) => seen.bounds.push(b),
    layout: (m) => seen.layout.push(m),
    save: () => { seen.saved++; },
  });
  const last = () => seen.bounds[seen.bounds.length - 1];
  return { win, seen, last };
}

const settings = { posOpen: { x: 130, y: 79 }, posIdle: { x: 2137, y: 341 }, windowSize: 'medium' };
let { win, seen, last } = rig(settings);

// --- start: the window starts at the open place; the page reports the strip before it says
// "nothing open" – that must not become the panel's place
assert.deepStrictEqual(win.start(), { x: 130, y: 79, width: 300, height: 52 });
win.applySize(STRIP, H, false);
win.setIdle(true);
assert.deepStrictEqual(settings.posOpen, { x: 130, y: 79 }, 'the panel keeps its place over the start');
assert.deepStrictEqual(last(), { x: 2137, y: 341, width: STRIP, height: H }, 'the strip at its place');
win.applySize(STRIP, H, false);
console.log('ok  start: the strip at its place, the panel\'s place kept');

// --- our own move told back by Windows: no drag by hand
win.moved(2137, 341);
assert.deepStrictEqual(settings.posIdle, { x: 2137, y: 341 });

// --- sliding out at the right edge: asked first, then it grows to the left, its right end kept
assert.deepStrictEqual(win.slidePlan(WIDE), { toLeft: true }, 'it will grow to the left');
win.applySize(WIDE, H, false, true);
assert.strictEqual(last().x + last().width, 2137 + STRIP, 'the right end stays where it was');
assert.ok(seen.layout[seen.layout.length - 1].toLeft, 'the page is told to keep to the right side');
win.applySize(STRIP, H, false);
assert.deepStrictEqual(last(), { x: 2137, y: 341, width: STRIP, height: H }, 'folded in: back exactly');
assert.ok(!seen.layout[seen.layout.length - 1].toLeft);
console.log('ok  sliding out at the right edge grows to the left and comes back exactly');

// --- opened from slid out, closed again with a wider strip for a moment: nothing walks
for (let i = 0; i < 3; i++) {
  win.applySize(WIDE, H, false, true);
  win.setIdle(false);
  assert.deepStrictEqual({ x: last().x, y: last().y }, { x: 130, y: 79 }, 'the panel at its own place');
  win.setIdle(true);
  win.applySize(547, H, false);                       // the strip wider for a moment after closing
  assert.strictEqual(last().x, 2560 - 547, 'shown on the screen');
  win.applySize(STRIP, H, false);
  assert.strictEqual(last().x, 2137, 'and back where it was put – round ' + (i + 1));
}
assert.deepStrictEqual(settings.posIdle, { x: 2137, y: 341 }, 'the strip\'s place never moved');
assert.deepStrictEqual(settings.posOpen, { x: 130, y: 79 }, 'nor the panel\'s');
console.log('ok  open and close, round after round: nothing walks');

// --- dragged by hand: the new place – while slid out it moves along
win.applySize(WIDE, H, false, true);
const slid = last();
win.moved(slid.x - 300, slid.y + 20);
win.applySize(STRIP, H, false);
assert.deepStrictEqual({ x: last().x, y: last().y }, { x: 2137 - 300, y: 361 }, 'dragged while slid out: folds in where it was dragged');
assert.deepStrictEqual(settings.posIdle, { x: 1837, y: 361 }, 'and that is its place now');
win.applySize(WIDE, H, false, true);
assert.strictEqual(last().x, 1837, 'away from the edge it grows to the right');
assert.deepStrictEqual(win.slidePlan(WIDE), { toLeft: false });
win.applySize(STRIP, H, false);
win.setIdle(false);
win.moved(400, 200);
assert.deepStrictEqual(settings.posOpen, { x: 400, y: 200 }, 'the panel dragged: its new place');
win.setIdle(true);
console.log('ok  a drag by hand is the new place, also while slid out');

// --- the next start: both places as they were left
({ win, seen, last } = rig(settings));
win.start();
win.applySize(STRIP, H, false);
win.setIdle(true);
assert.deepStrictEqual({ x: last().x, y: last().y }, { x: 1837, y: 361 }, 'the strip where it was');
win.setIdle(false);
assert.deepStrictEqual({ x: last().x, y: last().y }, { x: 400, y: 200 }, 'the panel where it was');
console.log('ok  the next start: both places kept');

// --- a strip never put anywhere: centred, whatever its width
({ win, last } = rig({ windowSize: 'medium' }));
win.start();
win.applySize(STRIP, H, false);
win.setIdle(true);
assert.strictEqual(last().x, Math.round((2560 - STRIP) / 2), 'centred');
win.moved(last().x, last().y);                    // Windows tells our own move back
win.applySize(STRIP + 40, H, false);
assert.strictEqual(last().x, Math.round((2560 - STRIP - 40) / 2), 'still centred when it grows');
console.log('ok  an undragged strip stays centred');

// --- the panel: the size picked, the size dragged (not below its least), on the screen
const s2 = { windowSize: 'large', posOpen: { x: 2400, y: 1300 } };
({ win, last } = rig(s2));
win.start();
win.setIdle(true); win.setIdle(false);
assert.deepStrictEqual(last(), { x: 2560 - 985, y: 1392 - 720, width: 985, height: 720 }, 'large, kept on the screen');
win.panelSize({ w: 100, h: 100 });
assert.deepStrictEqual(s2.panelSize, { w: 360, h: 400 }, 'not below its least');
assert.deepStrictEqual(s2.posOpen, { x: 2400, y: 1300 }, 'being kept on the screen does not move its place');
console.log('ok  the panel: its size, on the screen, its place kept');
