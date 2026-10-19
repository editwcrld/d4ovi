'use strict';
// Where the bar's left edge belongs when its width changes.
//
// Two rules collide here, which is why this is its own little module (and tested):
//   open & horizontal – the bar grows around its centre, so a wider bar must move left by
//                       half of what it grew.
//   idle (the pill)   – it must stay exactly where it was dragged, otherwise it walks across
//                       the screen: every idle -> awake -> idle round would move it half the
//                       width difference. Only a pill that was never dragged follows the
//                       width, so that it stays centred.
// Right after a state switch the place comes from the settings, so the growth rule must not
// fire at all for the next few size reports (`fixed`).

/**
 * @param {object} o
 * @param {number} o.barX   current left edge
 * @param {number} o.bw     new bar width
 * @param {number} o.prevBw width the bar had before
 * @param {object} o.wa     work area {x, width}
 * @param {boolean} o.idle  the shrunk pill
 * @param {boolean} o.centre pill without a place of its own -> keep it centred
 * @param {boolean} o.fixed the place was just set from the settings
 * @returns {number} left edge, clamped to the screen
 */
function barLeft(o) {
  let x = o.barX;
  if (o.idle) {
    if (o.centre) x = o.wa.x + Math.round((o.wa.width - o.bw) / 2);
  } else if (!o.fixed && o.bw !== o.prevBw) {
    x = Math.round(o.barX - (o.bw - o.prevBw) / 2);
  }
  return Math.max(o.wa.x, Math.min(x, o.wa.x + o.wa.width - o.bw));
}

/**
 * The strip sliding out its sections under the mouse: it grows to the right from where it is –
 * or, when that runs past the screen's right edge, to the left, its right end staying put. Folding
 * in, it goes back to `home` exactly (main.js keeps it), so it never walks.
 * @param {object} home its place and width before sliding out {x, w}
 * @param {number} w    the width slid out
 * @param {object} wa   work area {x, width}
 * @returns {number} left edge, clamped to the screen
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

module.exports = { barLeft, slideOut, onScreen };
