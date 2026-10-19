'use strict';
// Where the overlay's one window is and how big – kept apart from Electron (main.js hands in the
// window, the screens and the settings), so the whole flow can be played through in a test
// (test/windowplace-test.js): start, open, close, sliding out at the right edge, dragging.
//
// Two states, each with its own place (lib/place.js keeps the rules):
//   the strip   closed – where it was dragged (never dragged: centred at the top); it reports its
//               width, and sliding out under the mouse (hold) it grows from where it is shown,
//               at the right edge of the screen to the left
//   the panel   open – where it was dragged (by default top left: the room left of the game's
//               inventory), 820 × 600 at 1080p, or the size picked or dragged
// Only a drag by hand moves a place; what is shown is the place kept on the screen.
const place = require('./place');

const BAR_WIDTH = 300;                   // until the page reports its real size
const BAR_HEIGHT = 52;
// The open panel is made for the room left of the game's inventory, skill tree and paragon:
// 820 × 600 at 1080p (CSS pixels – the zoom grows it with the screen), smaller or larger by the
// "Panel size" setting – or tall and narrow like a phone (393 × 850, "mobile") – or the size
// dragged by hand. Every page works down to the phone's width.
const PANEL_SIZES = { small: { w: 700, h: 510 }, medium: { w: 820, h: 600 }, large: { w: 985, h: 720 }, mobile: { w: 393, h: 850 } };
const PANEL_MIN = { w: 360, h: 400 };

/**
 * @param deps {
 *   settings: () => the settings (posIdle, posOpen, panelSize, windowSize),
 *   screen: { matching(rect) -> work area, primary() -> work area, displays() -> [{ bounds }] },
 *   zoom(wa): the zoom for that screen (main.js applies it to the page),
 *   setBounds(rect), layout({ manual, toLeft }) – told to the page, save(), log(...) }
 */
function create(deps) {
  const log = deps.log || (() => {});
  const S = deps.settings;
  // the place of the state shown (barX, barY) and where the window is shown (placedAt)
  let barX = 0, barY = 0, curW = BAR_WIDTH, curH = BAR_HEIGHT;
  let strip = { w: BAR_WIDTH, h: BAR_HEIGHT };   // the strip's last reported size (CSS pixels)
  let isIdle = false;                            // nothing open: the window is the strip
  // the strip slid out (hold): where it was shown and how wide before – it grows from there
  let peekHome = null;
  let shownOpen = null;                          // what the window shows: the panel (true) or the strip (false)
  let placedAt = { x: NaN, y: NaN };             // where the window is shown (by us – not a move by hand)
  let centreIdle = true;                         // the strip was never dragged: it stays centred
  let z = 1;

  const wa = () => deps.screen.matching({ x: barX, y: barY, width: curW, height: curH });
  const onScreen = (p) => place.onScreen(p, deps.screen.displays());

  function defaultPlace(idle) {
    const a = deps.screen.primary();
    return idle ? { x: Math.round(a.x + (a.width - strip.w * z) / 2), y: a.y + 8 } : { x: a.x + 16, y: a.y + 64 };
  }
  function checkCentre() { centreIdle = !onScreen(S().posIdle); }
  function placeFor(idle) {
    const p = idle ? S().posIdle : S().posOpen;
    return onScreen(p) ? { x: p.x, y: p.y } : defaultPlace(idle);
  }
  /** Folding in (or opening) from slid out. */
  function endPeek() {
    if (!peekHome) return;
    curW = peekHome.w;
    peekHome = null;
  }
  function rememberPlace() {
    // the window shows the other state's look (at start-up: the strip, while the state is still
    // "open" until the page says otherwise) – where it is now is no place of this state
    if (shownOpen === null || shownOpen === isIdle) return;
    const p = { x: barX, y: barY };
    if (isIdle) S().posIdle = p; else S().posOpen = p;
  }
  /** The open panel in screen pixels: the size dragged by hand, else the one picked – on the screen. */
  function panelBox(a) {
    const s = S();
    const m = s.panelSize && s.panelSize.w > 0 ? s.panelSize : null;
    const p = PANEL_SIZES[s.windowSize] || PANEL_SIZES.medium;
    const w = m ? m.w : p.w, h = m ? m.h : p.h;
    return { w: Math.min(Math.round(w * z), a.width), h: Math.min(Math.round(h * z), a.height), manual: !!m };
  }
  /** The strip's width in screen pixels for a width reported by the page (CSS pixels). */
  const stripWidth = (cssW, a) => Math.max(44, Math.min(Math.round(cssW * z), a.width));
  /** Where the strip is shown slid out to width w: from where it is shown now. */
  const slidX = (w, a) => place.slideOut(peekHome || { x: placedAt.x, w: curW }, w, a);

  /**
   * Closed, the window is the strip at its place (never dragged: centred while its width changes);
   * sliding out (hold) it grows from where it is shown. Open, it is the panel at the open place.
   */
  function applySize(barW, barH, open, hold) {
    const a = wa();
    z = deps.zoom(a);
    let w, h, x, manual = false;
    if (!hold) endPeek();
    if (open) {
      const p = panelBox(a);
      w = p.w; h = p.h; manual = p.manual;
      x = barX;
    } else {
      strip = { w: barW, h: barH };
      w = stripWidth(barW, a);
      h = Math.max(36, Math.min(Math.round(barH * z), a.height));
      if (hold) {
        if (!peekHome) peekHome = { x: placedAt.x, w: curW };
        x = slidX(w, a);
      } else {
        if (centreIdle) barX = place.centred(w, a);
        x = barX;
      }
    }
    const at = place.shown({ x, y: barY }, w, h, a);
    // noted before the move: Windows may tell it as 'moved' while setBounds is still running
    placedAt = at;
    deps.setBounds({ x: at.x, y: at.y, width: w, height: h });
    shownOpen = !!open;
    curW = w; curH = h;
    rememberPlace();
    // grown to the left (slid out at the right edge): the strip sits at the window's right side
    deps.layout({ manual, toLeft: !!peekHome && at.x < peekHome.x });
  }

  /** The page opened something (false) or closed it all (true): the window goes to that state's place. */
  function setIdle(on) {
    if (on === isIdle) return;
    endPeek();                             // opened from slid out: the strip's place is its own
    rememberPlace();                       // keep the place of the state we are leaving
    isIdle = on;
    checkCentre();
    const p = placeFor(on);
    barX = p.x; barY = p.y;
    log(on ? 'Closed: the strip' : 'Open: the panel', '→', barX + ',' + barY);
    applySize(strip.w, strip.h, !on);
    deps.save();
  }

  /** Windows says the window moved – our own setBounds too; only a drag by hand is a new place. */
  function moved(x, y) {
    if (Math.abs(x - placedAt.x) <= 2 && Math.abs(y - placedAt.y) <= 2) return;   // (scaled screens round)
    log('Moved by hand to', x + ',' + y, peekHome ? '(while slid out)' : '');
    if (peekHome) {
      // dragged while slid out: the place moves along – folding in, it lands where it was dragged
      const dx = x - placedAt.x, dy = y - placedAt.y;
      barX += dx; barY += dy; peekHome.x += dx;
    } else { barX = x; barY = y; }
    placedAt = { x, y };
    rememberPlace();
    if (isIdle) centreIdle = false;
    deps.save();
  }

  /** Which way the strip will grow sliding out to this width (CSS px) – asked before it does. */
  function slidePlan(cssW) {
    const a = deps.screen.matching({ x: placedAt.x, y: placedAt.y, width: curW, height: curH });
    const x = slidX(stripWidth(Number(cssW) || 0, a), a);
    return { toLeft: x < (peekHome ? peekHome.x : placedAt.x) };
  }

  /** The panel's size set or dragged (CSS px; null: back to the size picked). */
  function panelSize(size) {
    const s = S();
    s.panelSize = size && size.w ? { w: Math.max(PANEL_MIN.w, Math.round(size.w)), h: Math.max(PANEL_MIN.h, Math.round(size.h)) } : null;
    applySize(strip.w, strip.h, true);
  }

  /** Where the window starts: the open place (the page says right away that nothing is open). */
  function start() {
    const p = placeFor(false);
    barX = p.x; barY = p.y;
    return { x: p.x, y: p.y, width: BAR_WIDTH, height: BAR_HEIGHT };
  }

  return {
    start, applySize, setIdle, moved, slidePlan, panelSize, checkCentre,
    /** The text size may have changed: sized again only when the zoom did (sliding out is left alone). */
    rezoom() { if (deps.zoom(wa()) !== z) applySize(strip.w, strip.h, !isIdle); },
    zoom: () => z,
    get idle() { return isIdle; },
  };
}

module.exports = { create, PANEL_SIZES, PANEL_MIN, BAR_WIDTH, BAR_HEIGHT };
