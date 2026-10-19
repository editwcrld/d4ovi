'use strict';
// The bar's motions: the window's size as the page reports it, the strip fading when nothing is
// open, its sections sliding out under the mouse (at the right edge of the screen to the left),
// the panel growing out of it and folding back, the faded panel while you play.
// One of the overlay's page scripts: they share one scope with app.js and are loaded before it
// (renderer/index.html) – app.js starts the page.

// ---------------------------------------------------------------- size reporting
// Closed, the window is the strip – its size is measured here. Open, the main process knows the
// panel's size by itself (820 × 600, the size picked or dragged).
function reportSize() {
  const open = !$('panel').hidden;
  // the sections are sliding out: the window already has their width (peek) – no smaller one now
  if (!open && $('app').classList.contains('peek')) return;
  const r = $('rail').getBoundingClientRect();
  api.resize(Math.ceil(open ? r.width : restWidth()), Math.ceil(r.height), open);
  setTimeout(syncView, 30);
}
/** The bar as a strip (closed) or the panel's spine (open) – opening, the panel grows out of it. */
function setOpen(on) {
  const was = $('app').classList.contains('open');
  $('app').classList.remove('peek');
  watchCursor();
  $('app').classList.toggle('open', !!on);
  $('panel').hidden = !on;
  if (on && !was) {
    $('app').classList.add('grow');
    clearTimeout(setOpen.t);
    setOpen.t = setTimeout(() => $('app').classList.remove('grow'), 320);
  }
  renderTimers();
}

// ---------------------------------------------------------------- idle
// Nothing open: the bar is the strip and fades to the set opacity. The timers keep their full
// strength when asked to, and an alert blinks on its own element only.
function armIdle() {
  clearTimeout(idleTimer);
  if (section) return;
  setIdle(true);                                     // nothing open: straight back to the pill
}
function setIdle(on) {
  if (on === idle) return;
  idle = on;
  const rail = $('rail');
  rail.classList.add('morph');
  clearTimeout(setIdle.t);
  setIdle.t = setTimeout(() => rail.classList.remove('morph'), 140);
  $('app').classList.toggle('idle', on);
  if (!on) { $('app').classList.remove('peek'); watchCursor(); }
  api.setIdle(on);
  renderTimers();
  setTimeout(reportSize, 40);
  setTimeout(reportSize, 280);                       // again once the shrink has run
}
// The closed bar shows the timers and lock only. The mouse over it takes the fade off and slides
// the sections out (those switched on for it): the window takes their width first – keeping its
// place – then they slide in; leaving, they slide back and the window follows once they are in.
// Leaving is told by the main process (where the cursor is, against the window): the strip is a
// drag area between its buttons, and Windows reports the mouse there as gone from the page – the
// page's own mouseleave would fold it in and out while the mouse only moves along it.
// At the right edge of the screen it grows to the left: the window moves, and Windows shows its old
// picture at the new place for a moment before the new one is drawn – the strip would flash. So it
// is asked first which way it will grow (main.js overlay:slide-plan); growing to the left, the strip
// fades out, sets itself to the window's right side, the window moves, and it fades in again while
// the sections slide out – and the same way back.
let peekT = null, peekN = 0;
const PEEK_ROOM = 24;                      // a little more than the sections' gaps and border, never less
const SHIFT_MS = 90;                       // the fade before the window moves
/**
 * The closed strip's width at rest – timers and lock, without the sections, however far they have
 * slid in or out right now: measured mid-slide, the window would take a width in between and the
 * strip's place would drift with every pass of the mouse.
 */
function restWidth() {
  const part = (e) => e.getBoundingClientRect().width + (parseFloat(getComputedStyle(e).marginLeft) || 0);
  return $('rail').getBoundingClientRect().width - part($('secs')) - part($('sys'));
}
function peek(on) {
  clearTimeout(peekT);
  const app = $('app');
  if (!on || !idle || app.classList.contains('open')) {
    peekN++;                               // a slide-out still being asked for is called off
    app.classList.remove('shift');
    if (!app.classList.contains('peek')) return;
    app.classList.remove('peek');
    watchCursor();
    // the sections are in: the window follows – grown to the left, it moves back right, faded
    peekT = setTimeout(() => {
      if (!app.classList.contains('toleft')) return reportSize();
      app.classList.add('shift');
      peekT = setTimeout(reportSize, SHIFT_MS);
    }, 360);
    return;
  }
  if (app.classList.contains('peek')) return;
  const n = ++peekN;
  const s = $('secs'), y = $('sys'), r = $('rail').getBoundingClientRect();
  const w = Math.ceil(restWidth() + s.scrollWidth + y.scrollWidth + PEEK_ROOM), h = Math.ceil(r.height);
  const go = (toLeft) => {
    if (n !== peekN) return;
    s.style.setProperty('--w', s.scrollWidth + 'px');
    y.style.setProperty('--w', y.scrollWidth + 'px');
    app.classList.toggle('toleft', toLeft);
    api.resize(w, h, false, true);
    app.classList.add('peek');
    watchCursor();
  };
  Promise.resolve(api.slidePlan ? api.slidePlan(w) : null).catch(() => null).then((plan) => {
    const toLeft = !!(plan && plan.toLeft);
    if (n !== peekN) return;               // the mouse left again meanwhile
    if (!toLeft || app.classList.contains('toleft')) return go(toLeft);
    app.classList.add('shift');
    peekT = setTimeout(() => go(true), SHIFT_MS);
  });
}
/** The window was moved and drawn anew (main.js 'layout'): what was hidden for the move comes back. */
function unshift() {
  const app = $('app');
  if (!app.classList.contains('shift') && !app.classList.contains('swap')) return;
  requestAnimationFrame(() => requestAnimationFrame(() => app.classList.remove('shift', 'swap')));
}

// ---------------------------------------------------------------- closing
// The panel folds back into the corner it grew out of; then the page hides itself, and only once
// that is drawn does the window become the strip at its place (main.js), where it fades in
// (unshift). Moved at once, Windows would show the panel's last picture at the strip's place.
const FOLD_MS = 200;
let folding = false;
/** still() – is it still to be closed (nothing opened meanwhile); done() – show the strip. */
function foldAway(still, done) {
  const app = $('app');
  if (folding) return;
  if (!app.classList.contains('open')) return done();
  folding = true;
  app.classList.add('fold');
  setTimeout(() => {
    app.classList.add('swap');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      folding = false;
      app.classList.remove('fold');
      if (!still()) { app.classList.remove('swap'); return; }   // opened again meanwhile: it stays
      done();
      setTimeout(() => app.classList.remove('swap'), 500);      // in case the window does not move
    }));
  }, FOLD_MS);
}

/** Pinned and the game has the focus: the panel fades; the mouse over it lifts the fade. */
function setGhost(on) {
  $('app').classList.toggle('ghost', !!on);
  if (!on) $('app').classList.remove('near');
  watchCursor();
}
/** Where the cursor is, told by the main process, is needed by two at once – the fade (ghost) and the
 * sections slid out (peek): it runs while either needs it, so ending one never blinds the other. */
function watchCursor() {
  const on = $('app').classList.contains('ghost') || $('app').classList.contains('peek');
  if (on !== !!watchCursor.on) { watchCursor.on = on; api.hoverWatch(on); }
}
