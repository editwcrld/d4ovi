'use strict';
// Where the window goes – the rules, apart from Electron so they can be tested.
//
// Two things are kept apart (main.js):
//   the place  where the strip or the panel was put – it changes only when it is dragged by hand
//              (a strip never put anywhere: centred), and it is what the settings remember
//   the shown  where the window is right now – the place, kept on the screen. A strip wider for a
//              moment, a panel bigger than the room left of it, the sections sliding out at the
//              right edge: all of that moves only what is shown, never the place, so nothing
//              walks across the screen however often it happens.

/** A strip never put anywhere: centred on the work area. */
const centred = (w, wa) => wa.x + Math.round((wa.width - w) / 2);

/** What is shown of a place: the window (w × h) kept on the work area. */
function shown(p, w, h, wa) {
  return {
    x: Math.max(wa.x, Math.min(p.x, wa.x + wa.width - w)),
    y: Math.max(wa.y, Math.min(p.y, wa.y + wa.height - h)),
  };
}

/**
 * The strip sliding out its sections under the mouse: it grows to the right from where it is shown –
 * or, when that runs past the screen's right edge, to the left, its right end staying put.
 * @param {object} home where it is shown before sliding out, and its width {x, w}
 * @param {number} w    the width slid out
 * @param {object} wa   work area {x, width}
 * @returns {number} left edge, on the screen
 */
function slideOut(home, w, wa) {
  const x = home.x + w > wa.x + wa.width ? home.x + home.w - w : home.x;
  return Math.max(wa.x, Math.min(x, wa.x + wa.width - w));
}

/** Is this place still on one of the screens? */
function onScreen(p, displays) {
  return !!p && (displays || []).some((d) => p.x >= d.bounds.x - 50 && p.x < d.bounds.x + d.bounds.width
    && p.y >= d.bounds.y - 10 && p.y < d.bounds.y + d.bounds.height);
}

module.exports = { centred, shown, slideOut, onScreen };
