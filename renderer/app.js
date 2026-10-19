'use strict';
const api = window.d4api;          // (not "api" on window: that would clash with the bridge name)
const S = window.SearchLib;
const $ = (id) => document.getElementById(id);
const { el } = UI;
/** Sort order: bosses before loot pools. */
const bossFirst = (x, y) => (y.sec.isBoss ? 1 : 0) - (x.sec.isBoss ? 1 : 0);

// Sections that show an embedded web page instead of our own cards
const EMBEDDED = { chat: 'chat', listings: 'listings', maptool: 'maptool', page: 'page' };

let settings = null;
// what this build has (lib/features.js) – without an answer: no macros
let features = { macros: false, clickSpam: false, lock: false };
let loot = { sections: [], fetchedAt: 0 };
// maxroll's "Uniques from Boss Trophies" lists the lair keys under the bosses' names – no loot, it
// only got in the way of a boss's own drops (searching "The Butcher" showed it first)
const TROPHY_POOL = /boss trophies/i;
// maxroll heads its list of the Iconic Mythics just "Mythics" – they are only the iconic ones
const useLoot = (l) => (l ? Object.assign({}, l, { sections: (l.sections || []).filter((s) => !TROPHY_POOL.test(s.name || ''))
  .map((s) => (/^mythics?$/i.test(String(s.name || '').trim()) ? Object.assign({}, s, { name: 'Iconic Mythics' }) : s)) }) : null);
let craft = { tables: [], fetchedAt: 0 };
let activities = [];
let wb = { at: 0, secs: null, text: '' };

let section = null;                // null = closed; otherwise one of the rail sections
let pageUrl = null;                // page opened from a card ("Database" button)
let itemHits = [], itemQuery = null;
let pick = null;                   // the result picked in the list (shown in full beside it)
let chip = 'all';                  // active filter chip
let runewords = [];
let note = null, noteTimer = null, debounce = null;
let idle = false, idleTimer = null;       // idle = shrunk to the pill and faded
let setTab = 'behaviour';
let pinned = false;                // pinned: a click into the game leaves the panel open (it fades)
let wbAck = 0;                     // the spawn whose blinking was clicked away
let setMsgText = '';               // the line under the settings ("Signed out." …)
let cookieBox = false;
let missing = null;                // the active build: { name, total, missing } – shown when switched on
let updateInfo = null, appVersion = '';
let backupAt = 0;                  // when the last backup was made (0: none)   // the last update check, the running version             // Settings › diablo.trade: the box to paste cookies into is open
let pageFrom = null;               // where a page (guide, database) was opened from – "Back" returns there
let dataInfo = '';                 // "8433 items · …" – shown in Settings › Data, not in the footer
let resultKeys = [], shownKey = null;   // the result list in order – arrow keys walk it
let bossCls = null;                // the class the boss drops are shown for (null: the active build's)
let lastSection = null, lastUrl = null;   // what was open last – the timer opens it again
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
function syncView() {
  if (!EMBEDDED[section]) return;
  const r = $('viewSlot').getBoundingClientRect();
  if (r.width > 2) api.viewBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
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

// ---------------------------------------------------------------- sections
function openSection(name, url, heading) {
  const prevSection = section;
  // its icon again: closed, the same way as always
  if (section === name && (!url || url === pageUrl)) return closeAll();
  $('app').classList.remove('fold', 'swap');           // opened while the panel was folding away: it stays
  setIdle(false);
  // opened from closed: never pinned – pinning is always your own click
  if (!section) setPinned(false);
  section = name;
  pick = null; chip = 'all';
  if (url) pageUrl = url;
  if (name === 'page') pageFrom = prevSection;

  setOpen(true);
  // the builder lives under Builds – one icon for both
  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => b.classList.toggle('on', b.dataset.section === section || (section === 'builder' && b.dataset.section === 'farm')));

  const embedded = !!EMBEDDED[section];
  $('viewSlot').hidden = !embedded;
  $('main').hidden = embedded;
  if (embedded) {
    const kind = section === 'maptool' ? 'map' : section === 'page' ? 'page' : section;
    api.viewShow(kind, section === 'page' ? pageUrl : null, heading || null);
    [0, 60, 150, 350, 700].forEach((ms) => setTimeout(syncView, ms));
  } else api.viewHide();

  showCoach();
  armIdle();
  render();
  // only now: render() shows the search bar – a field still hidden cannot take the focus
  if (section === 'search') { typeIn($('q')); $('q').select(); }
}
// Closing: nothing is open from the first moment (the keyboard is the game's again) – what is seen
// follows. The panel folds back into the corner it grew out of; then the page hides itself, and only
// once that is drawn does the window become the strip at its place (main.js), where it fades in
// (unshift). Moved at once, Windows would show the panel's last picture at the strip's place.
const FOLD_MS = 200;
let folding = false;
function closeAll() {
  if (section) { lastSection = section; lastUrl = section === 'page' ? pageUrl : null; }
  section = null; pick = null;
  setPinned(false);
  setGhost(false);
  if (window.FarmView) window.FarmView.hideTip();
  if (window.BuildViews) window.BuildViews.hideTip();
  $('q').value = ''; itemHits = []; itemQuery = '';
  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => b.classList.remove('on'));
  api.viewHide();
  api.keyboard(false);
  const app = $('app');
  if (folding) return;
  if (!app.classList.contains('open')) return shut();
  folding = true;
  app.classList.add('fold');
  setTimeout(() => {
    app.classList.add('swap');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      folding = false;
      app.classList.remove('fold');
      if (section) { app.classList.remove('swap'); return; }   // opened again meanwhile: it stays
      shut();
      setTimeout(() => app.classList.remove('swap'), 500);      // in case the window does not move
    }));
  }, FOLD_MS);
}
/** What is seen once closed: the strip. */
function shut() {
  setOpen(false);
  showCoach();
  armIdle();
  render();
}

function setPinned(on) {
  pinned = !!on;
  $('btnPin').classList.toggle('on', pinned);
  $('btnPin').title = pinned ? 'Pinned — stays open while you play · click to unpin' : 'Pin — stays open while you play';
}
/** A click outside the overlay (into the game): an open panel closes – pinned (or set to stay) it fades instead. */
function onClickOutside() {
  if (!section) return;
  if (pinned || settings.clickGame === 'keep') {
    // builds (skills, paragon) are read while you play – they stay fully visible unless asked otherwise
    if (section === 'farm' && settings.buildsNoFade !== false) return;
    setGhost(true);
  }
  else closeAll();
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
// ---- the keyboard stays with the game (main.js setKeyboard): the overlay asks for it only while
// something is typed into – a text field, a key to record – and gives it back once that lost the focus
const WANTS_KEYS = 'input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button]), textarea, [contenteditable=""], [contenteditable="true"], .hk, [data-keys]';
const wantsKeys = (t) => !!(t && t.closest && t.closest(WANTS_KEYS));
/** Into a field from code (the search opening, a key to record): the keyboard first. */
function typeIn(e) { clearTimeout(keysBack); keysFor = e; api.keyboard(true); e.focus(); }
let keysBack = null;
// The window gets the focus a moment after it was asked for (main.js) – until then a field cannot
// really take it, so the one asked for is focused again once the window has it. Without this the
// search needed a second click before it could be typed into.
let keysFor = null;
function watchKeyboard() {
  document.addEventListener('mousedown', (e) => {
    setGhost(false);                                 // faded and clicked: it is used again
    if (wantsKeys(e.target)) { clearTimeout(keysBack); keysFor = e.target.closest(WANTS_KEYS); api.keyboard(true); }
  }, true);
  window.addEventListener('focus', () => {
    const f = keysFor;
    keysFor = null;
    if (f && f.isConnected && document.activeElement !== f) f.focus();
  });
  // a moment later: a click from one field into the next (or a field focused from code) keeps it
  document.addEventListener('focusout', () => {
    clearTimeout(keysBack);
    keysBack = setTimeout(() => { if (!wantsKeys(document.activeElement)) api.keyboard(false); }, 150);
  });
}
function showCoach() { $('coach').hidden = !section || !!(settings && settings.coachSeen); }

function showNote(text, kind, ms) {
  note = { text, kind: kind || 'info' };
  clearTimeout(noteTimer);
  // gone again: only the note itself – redrawing the page would throw away what is going on in it
  // (a key being recorded, the cursor in a field)
  if (ms !== 0) noteTimer = setTimeout(() => { note = null; document.querySelectorAll('#main > .note').forEach((n) => n.remove()); }, ms || 6000);
  if (!section) { section = 'search'; setOpen(true); document.querySelector('#rail .ri[data-section=search]').classList.add('on'); }
  render();
}

/** A line in the footer for a while – seen when the panel is open, never opening it. */
let footTimer = null;
function footNote(text, kind) {
  const e = $('stNote');
  e.textContent = text;
  e.className = kind || 'info';
  e.title = text;
  e.hidden = false;
  syncStatus();
  clearTimeout(footTimer);
  footTimer = setTimeout(() => { e.hidden = true; syncStatus(); }, kind === 'error' ? 15000 : 8000);
}
/** The line under the page shows only while it has something to say. */
function syncStatus() { $('status').hidden = !$('stData').textContent && $('stNote').hidden; }

// ---------------------------------------------------------------- rendering
// Every page has the same three parts: the head (#title – or the search field), the tabs (#chips)
// and the body (#main, with the result list #side for the search). Pin and close sit at the
// head's right end on every page.
function render() {
  renderSection();
}
/** The page head: a kicker (small caps, red), the title, and what goes on the right. */
function pageHead(kicker, title, right) {
  const t = $('title');
  t.textContent = '';
  const b = el('div', 'tblock');
  if (kicker) b.appendChild(kicker instanceof Node ? kicker : el('div', 'kick', kicker));
  const h = el('h1', 'ttl', title);
  h.title = title;
  b.appendChild(h);
  t.appendChild(b);
  if (right && right.length) {
    const r = el('div', 'tright');
    right.forEach((x) => r.appendChild(x));
    t.appendChild(r);
  }
}
/** Builds is one place: your farm list, and finding a build – the switch sits in the kicker. */
function buildsSwitch(extra) {
  const k = el('div', 'kick');
  [['farm', 'My builds', 'Your farm list'], ['builder', 'Find a build', 'Pick a class and a skill – every guide for it, or build it yourself']].forEach(([key, label, title], i) => {
    if (i) k.appendChild(el('span', 'sep', '·'));
    const b = el('button', section === key ? 'on' : '', label);
    b.title = title;
    b.onclick = () => { if (section !== key) openSection(key); };
    k.appendChild(b);
  });
  if (extra) { k.appendChild(el('span', 'sep', '·')); k.appendChild(el('span', null, extra)); }
  return k;
}
function renderSection() {
  const main = $('main'), side = $('side');
  const sm = document.querySelector('#main.settings');
  setScroll.top = sm ? sm.scrollTop : 0;
  main.textContent = ''; side.textContent = '';
  main.className = '';
  main.onscroll = null;
  document.querySelectorAll('#cols > .ishade').forEach((x) => x.remove());
  $('title').textContent = '';
  $('chips').textContent = '';
  $('qClear').hidden = !$('q').value;
  $('top').hidden = section !== 'search';
  side.hidden = section !== 'search';
  side.className = section === 'search' ? 'hits' : '';
  $('cols').classList.toggle('withside', section === 'search');
  syncStatus();

  if (!section) { reportSize(); return; }
  if (note) main.appendChild(el('div', 'note ' + note.kind, note.text));

  if (section === 'settings') { renderSettings(main); return; }
  if (EMBEDDED[section]) { renderEmbedded(); return; }
  if (section === 'farm') {
    main.classList.add('farm');
    window.FarmView.render(main, farmCtx);
    return;
  }
  if (section === 'builder') {
    pageHead(buildsSwitch(), 'Find a build');
    main.classList.add('bd');
    window.BuilderView.render(main, builderCtx);
    return;
  }
  if (section === 'search') renderSearch(main, side);
}

// What the builder (builder.js) may use from here – it keeps where you scrolled to when it redraws
const builderCtx = {
  get api() { return api; },
  get tabs() { return $('chips'); },
  rerender: () => {
    if (section !== 'builder') return;
    const y = $('main').scrollTop;
    render();
    $('main').scrollTop = y;
  },
  note: (t, kind) => showNote(t, kind, 3500),
  openFarm: () => openSection('farm'),
  openPage: (url) => openSection('page', url),   // the skill tree's d4builds.gg fallback
};

// What the farm list (farm.js) may use from here – its head and tabs go into the page's own
const farmCtx = {
  get api() { return api; },
  el,
  get head() { return $('title'); },
  get tabs() { return $('chips'); },
  kicker: (extra) => buildsSwitch(extra),
  rerender: () => { if (section === 'farm') render(); },
  note: (t, kind) => showNote(t, kind, 3500),
  openPage: (url) => openSection('page', url),   // a build site page inside the overlay
  status: (t) => { $('stData').textContent = t; syncStatus(); },
};

const PAGE_TITLE = { maptool: ['Map tool', 'Your marks are saved automatically'], listings: ['diablo.trade', 'Listings — the chat is one click away there'], chat: ['diablo.trade', 'Chat'] };
function renderEmbedded() {
  const [title, kick] = PAGE_TITLE[section] || ['Page', ''];
  const right = [];
  if (section === 'page' && pageFrom && pageFrom !== 'page' && !EMBEDDED[pageFrom]) {
    const back = UI.btn('Back', () => openSection(pageFrom), '', 'left');
    back.title = 'Back to where you opened it';
    right.push(back);
  }
  pageHead(kick || (section === 'page' ? 'Opened from the overlay' : ''), section === 'page' ? (pageUrl ? pageUrl.replace(/^https?:\/\/(www\.)?/, '').split(/[/?#]/)[0] : 'Page') : title, right);
}

// ---------------------------------------------------------------- pictures
const cleanName = (n) => String(n || '').replace(/‍/g, '').trim();
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];
/** The pictures of every thing by name (lib/icons.js) – asked again when the data changed. */
function loadIcons() {
  if (!api.icons) return;
  api.icons().then((m) => { UI.setIcons(m); if (section) render(); }).catch(() => {});
}

// ---------------------------------------------------------------- misc
async function save(patch) {
  const r = await api.saveSettings(patch);
  settings = r.settings;
  if (r.errors && r.errors.length) showNote(r.errors.join(' · '), 'error');
  render();
  return r;
}
async function openTrade(name) {
  pushRecent(name);
  const how = await api.openTrade(name);
  if (how === 'browser') showNote('Opened in your browser. “' + name + '” is on the clipboard.', 'ok', 7000);
  else if (how === 'internal-nofill') showNote('diablo.trade opened, but the search field was not found.', 'error');
}
// What the small pill shows – each one can be switched off (settings.pillHide lists those).
const PILL_ITEMS = [['search', 'Search'], ['farm', 'Builds'], ['maptool', 'Map tool'], ['listings', 'diablo.trade'],
  ['wb', 'World boss'], ['ht', 'Helltide'], ['ct', 'Own timer'], ['rc', 'Counter'], ['miss', 'To farm'], ['settings', 'Settings'], ['quit', 'Quit']];
const pillHide = () => (Array.isArray(settings.pillHide) ? settings.pillHide : []);
const pillEl = (k) => (k === 'quit' ? $('btnQuit') : $('rail').querySelector('[data-section="' + k + '"]') || $(k));
function applyLayout() {
  document.documentElement.style.setProperty('--fade', settings.fadeOpacity == null ? 0.35 : settings.fadeOpacity);
  PILL_ITEMS.forEach(([k]) => { const e = pillEl(k); if (e) e.classList.toggle('pillhide', pillHide().includes(k)); });
  $('app').classList.toggle('wbbright', settings.wbBright !== false);
  renderTimers();
  reportSize();
}
let recentTimer = null;
function onQuery() {
  // typing (or clearing) on a guide or page opened from the results goes back to the results
  if (section && section !== 'search') {
    const v = $('q').value;
    openSection('search');
    $('q').value = v; $('q').setSelectionRange(v.length, v.length);
  }
  chip = 'all'; pick = null; bossCls = null;   // a new search starts with everything in view
  clearTimeout(debounce);
  debounce = setTimeout(() => { updateItems($('q').value.trim()); render(); }, 80);
  // a search counts as done once the typing has stopped for a moment
  clearTimeout(recentTimer);
  recentTimer = setTimeout(() => { const v = $('q').value.trim(); if (v.length >= 3) pushRecent(v); }, 1500);
}

// ---------------------------------------------------------------- resizing by hand
// Dragging the corner sets a fixed panel size; the embedded pages follow because their
// bounds are recalculated from the slot on every resize.
function wireResize() {
  const grip = $('grip-resize');
  // the main process reads the cursor itself and keeps the corner under it – the window
  // moves while it grows, so the coordinates in here would drift
  let from = null, frame = 0;
  grip.addEventListener('pointerdown', (e) => {
    from = true;
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}   // not available everywhere
    document.body.classList.add('resizing');
    api.resizeDrag('start');
    e.preventDefault();
  });
  grip.addEventListener('pointermove', () => {
    if (!from || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (from) api.resizeDrag('move'); });
  });
  const stop = (e) => {
    if (!from) return;
    from = null;
    api.resizeDrag('move');
    api.resizeDrag('end');
    document.body.classList.remove('resizing');
    try { grip.releasePointerCapture(e.pointerId); } catch (_) {}
    setTimeout(syncView, 40);
  };
  grip.addEventListener('pointerup', stop);
  grip.addEventListener('pointercancel', stop);
}

// ---------------------------------------------------------------- start
async function init() {
  settings = await api.getSettings();
  try { features = Object.assign({}, features, await api.getFeatures()); } catch (_) { /* an older main: no macros */ }
  loot = useLoot(await api.getLoot()) || loot;
  craft = (await api.getCraft()) || craft;
  activities = (await api.getActivities()) || [];
  // the uniques' catalog: slot, rarity and the in-game tooltip for boss loot and the search
  loadIcons();
  window.FarmView.ensure(api).then(() => { if (section === 'search') render(); }).catch(() => {});
  runewords = (await api.getRunewords()) || [];
  applyLayout();

  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => { b.onclick = () => openSection(b.dataset.section); });
  $('btnQuit').onclick = () => api.quit();
  // the world boss timer: blinking, a click stops the blinking; otherwise the timers are the
  // biggest target in the small pill and open what was open last (or the search)
  const openFromTimer = () => {
    if (section) openSection('search');
    else openSection(lastSection || 'search', lastSection === 'page' ? lastUrl : undefined);
  };
  $('wb').onclick = () => {
    if ($('wb').classList.contains('blink')) { wbAck = spawnOf(); renderTimers(); return; }
    openFromTimer();
  };
  $('ht').onclick = openFromTimer;
  $('miss').onclick = () => openSection('farm');
  // your own timer: a click starts it (over), a right click clears it – the panel stays shut
  $('ct').onclick = (e) => { e.stopPropagation(); clickCt(); };
  $('ct').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); clearCt(); };
  // the counter: a click adds one, a right click starts it at 0 – the panel stays shut
  $('rc').onclick = (e) => { e.stopPropagation(); countRc(true); };
  $('rc').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); countRc(false); };
  $('panelClose').onclick = closeAll;
  $('btnPin').onclick = () => { setPinned(!pinned); setGhost(false); };
  $('coachOk').onclick = () => { save({ coachSeen: true }); $('coach').hidden = true; };
  api.onClickOutside(onClickOutside);
  watchKeyboard();
  // faded: the main process says when the cursor is over the window – :hover misses a quick exit
  api.onCursorInside((inside) => {
    $('app').classList.toggle('near', !!inside);
    if (!inside) peek(false);                        // the mouse left the strip (see peek)
  });
  $('qClear').onclick = () => { $('q').value = ''; itemHits = []; itemQuery = ''; onQuery(); render(); typeIn($('q')); };
  $('q').addEventListener('input', onQuery);
  $('q').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { const v = $('q').value.trim(); pushRecent(v); if (e.shiftKey) openTrade(v); }
    if (e.key === 'Escape') closeAll();
    // the arrow keys walk the results, the picked one shows on the right
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && resultKeys.length) {
      e.preventDefault();
      const i = resultKeys.indexOf(pick || shownKey);
      const n = e.key === 'ArrowDown' ? Math.min(resultKeys.length - 1, i + 1) : Math.max(0, i < 0 ? 0 : i - 1);
      pick = resultKeys[n]; render();
      const on = document.querySelector('#side .hit.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  $('rail').addEventListener('pointerenter', () => peek(true));

  api.onLoot((l) => { loot = useLoot(l) || loot; loadIcons(); render(); });
  api.onCraft((c) => { craft = c || craft; render(); });
  api.onActivities((a) => { activities = a || activities; render(); });
  api.onFarmReady(() => { loadIcons(); if (window.FarmView) window.FarmView.reload(); });
  if (api.onIconsReady) api.onIconsReady(loadIcons);
  if (window.FarmView) window.FarmView.onChange = updateMissing;
  api.onItemsReady(async () => { itemQuery = null; loadIcons(); runewords = (await api.getRunewords()) || runewords; updateItems($('q').value.trim()); });
  api.onWorldBoss((d) => { wb = d; renderTimers(); });
  // what the app reports by itself (data loaded, login saved, backup …) goes to the footer only –
  // it never opens the panel while you play
  api.onNotice((n) => footNote(n.text, n.kind));
  // the game's state: a dot at the foot of the spine
  api.onStatus((s) => {
    const e = $('stD4');
    e.classList.toggle('off', !(s.d4Active || s.running));
    e.title = s.d4Active ? 'Diablo IV in foreground' : s.running ? 'Diablo IV running' : 'Diablo IV not found';
  });
  api.onDataInfo((d) => { dataInfo = d.text; });
  api.onAuthInfo(() => {});
  api.onViewLoading((on) => $('viewSlot').classList.toggle('loading', !!on));
  api.onFocusSearch(() => { if (section !== 'search') openSection('search'); else { typeIn($('q')); $('q').select(); } });
  api.onToggle(() => { if (section) closeAll(); else openSection('search'); });
  api.onOpenSection((name) => openSection(name));
  api.onEscape(closeAll);
  api.onLayout(({ manual, toLeft }) => {
    $('app').classList.toggle('manual', !!manual);
    $('app').classList.toggle('toleft', !!toLeft);      // at the right edge it slides out to the left
    unshift();
    setTimeout(syncView, 30);
  });
  api.onClickSpam(({ on, button }) => {
    clickState = on ? 'Clicking now (' + button + ') …' : '';
    const e = $('clickState');
    if (e) e.textContent = clickState;
  });
  // straight to the build's skills or paragon; pressed again on the same page, it closes
  api.onOpenBuildView((v) => {
    const fv = window.FarmView;
    if (!fv) return;
    if (section === 'farm' && fv.view() === v) { closeAll(); return; }
    fv.setView(v);
    if (section === 'farm') render(); else openSection('farm');
  });
  api.onTimerRestart(() => { if (settings.ctTimer !== false) clickCt(); });
  api.onCounterAdd(() => { if (settings.rcCounter !== false) countRc(true); });
  api.onUpdateInfo(onUpdate);
  api.onBackupDone((t) => { backupAt = Number(t) || Date.now(); if (section === 'settings') render(); });
  api.onLock(({ on, paused, why }) => {
    const t = $('lockTag');
    t.hidden = !on;
    t.classList.toggle('paused', !!paused);
    t.title = !paused ? 'Lock running — the toggle key stops it'
      : why === 'map' ? 'Lock waits — the map is open, Tab or Esc closes it'
        : why === 'chat' ? 'Lock waits — the chat is open, Enter or Esc closes it'
        : why === 'portal' ? 'Lock waits — town portal (T), 5 seconds or a left click' : 'Lock waits — goes on when you let go of the left button';
    t.firstChild.textContent = !paused ? 'Lock' : ({ map: 'Map', chat: 'Chat', portal: 'Portal' })[why] || 'Wait';
    t.lastChild.replaceWith(lockKeys(!!paused));
  });
  api.onChatUnread((n) => {
    const b = $('chatBadge');
    b.hidden = !n; b.textContent = n > 99 ? '99+' : String(n);
    const icon = document.querySelector('#rail .ri[data-section=listings]');
    icon.classList.toggle('alert', n > 0);
    icon.classList.toggle('blink', n > 0 && settings.msgBlink !== false);   // only this icon blinks
  });

  wireResize();
  armIdle();
  updateMissing();
  api.getVersion().then((v) => { appVersion = v || ''; });
  api.lastUpdate().then((r) => { if (r) onUpdate(r); });
  refreshBackupAt();
  api.refreshStatus();            // ask once – avoids a race with the first broadcast
  setInterval(renderTimers, 1000);
  // the strip grows with what it shows (a timer, a badge) – the window must follow
  new ResizeObserver(() => { if ($('panel').hidden) reportSize(); }).observe($('rail'));
  window.addEventListener('resize', syncView);
  render();
}
init();
