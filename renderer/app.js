(function () {
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
  api.resize(Math.ceil(r.width), Math.ceil(r.height), open);
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
let peekT = null;
const PEEK_ROOM = 24;                      // a little more than the sections' gaps and border, never less
function peek(on) {
  clearTimeout(peekT);
  if (!on || !idle || $('app').classList.contains('open')) {
    if (!$('app').classList.contains('peek')) return;
    $('app').classList.remove('peek');
    watchCursor();
    peekT = setTimeout(reportSize, 360);
    return;
  }
  if ($('app').classList.contains('peek')) return;
  const s = $('secs'), y = $('sys'), r = $('rail').getBoundingClientRect();
  s.style.setProperty('--w', s.scrollWidth + 'px');
  y.style.setProperty('--w', y.scrollWidth + 'px');
  api.resize(Math.ceil(r.width + s.scrollWidth + y.scrollWidth + PEEK_ROOM), Math.ceil(r.height), false, true);
  $('app').classList.add('peek');
  watchCursor();
}

// ---------------------------------------------------------------- timers
// Three timers sit in the bar and the pill: the world boss (read from diablo.trade), the
// Helltide (from the clock) and one of your own (started by a click).
const pad2 = (v) => String(Math.floor(v)).padStart(2, '0');
const fmtMin = (s) => pad2(s / 60) + 'min ' + pad2(s % 60) + 'sec';
const fmtMs = (s) => pad2(s / 60) + ':' + pad2(s % 60);
/** Room for the long labels: the strip has it, the spine only for short ones. */
const timersWide = () => !$('app').classList.contains('open');

function renderTimers() {
  const wide = timersWide();
  renderWb(wide);
  renderHt(wide);
  renderCt(wide);
  renderMissing(wide);
}

// ---- world boss: turns red and grows in the warning time, blinks until clicked
/** The spawn the timer counts down to (identifies it for the click that stops the blinking). */
const spawnOf = () => (wb.secs == null ? 0 : Math.round((wb.at + wb.secs * 1000) / 60000));
function renderWb(wide) {
  const box = $('wb'), e = $('wbTime');
  box.hidden = settings && settings.wbTimer === false;
  box.querySelector('b').textContent = wide ? 'World boss' : 'Boss';
  if (wb.secs == null) { e.textContent = '--:--'; box.classList.remove('soon', 'blink'); return; }
  const left = Math.max(0, wb.secs - (Date.now() - wb.at) / 1000);
  e.textContent = fmtClock(Math.round(left));
  box.title = 'World boss' + (wb.text ? ' — ' + wb.text : '') + ' — in ' + fmtClock(Math.round(left));
  const warn = Number(settings && settings.wbWarnMin);
  const window_ = (isNaN(warn) ? 5 : warn) * 60;
  const soon = left < window_;
  box.classList.toggle('soon', soon);
  box.classList.toggle('blink', soon && !(settings && settings.wbBlink === false) && wbAck !== spawnOf());
  // the closer it gets, the bigger – less in the narrow spine
  const most = wide ? 0.4 : 0.15;
  const k = soon && window_ > 0 ? 1 + (1 - left / window_) * most : 1;
  box.style.setProperty('--wbk', k.toFixed(2));
}

// ---- Helltide: no data source needed – it starts on the full hour, runs 55 minutes, then
// 5 minutes pass until the next one. Taken in UTC, so a time zone with half hours is no problem.
// Orange while it runs, red for its last minutes.
const HT_ON = 55 * 60, HT_ENDING = 3 * 60;
function helltide(now = Date.now()) {
  const s = Math.floor(now / 1000) % 3600;           // seconds into the hour
  return s < HT_ON ? { on: true, left: HT_ON - s } : { on: false, left: 3600 - s };
}
function renderHt(wide) {
  const box = $('ht');
  box.hidden = settings && settings.helltide === false;
  if (box.hidden) return;
  const h = helltide();
  box.classList.toggle('on', h.on);
  box.classList.toggle('ending', h.on && h.left <= HT_ENDING);
  box.querySelector('b').textContent = wide ? (h.on ? 'Helltide' : 'Helltide in') : (h.on ? 'Helltide' : 'Next HT');
  $('htTime').textContent = fmtMs(h.left);
  box.title = h.on ? 'Helltide is on — ends in ' + fmtMin(h.left) : 'No Helltide — the next one starts in ' + fmtMin(h.left);
}

// ---- your own timer: a click starts it (again), a right click clears it; red and blinking
// for the last 30 seconds, "ready" at the end. It counts down from its time – or, counting up,
// from 0:00 to its time.
const CT_WARN = 30, CT_MAX = 99 * 3600 + 59 * 60 + 59;
let ctEnd = 0;                                       // when it runs out (0 = not counting)
const ctSecs = () => Math.max(1, Math.min(CT_MAX, Math.round(Number(settings && settings.ctSecs) || 300)));
const ctUp = () => !!(settings && settings.ctUp);
const ctName = () => String((settings && settings.ctName) || '').trim() || 'Timer';
/** 5:00, 45:10, 1:30:00 – hours only when there are any. */
const fmtClock = (s) => (s >= 3600 ? Math.floor(s / 3600) + ':' + pad2((s % 3600) / 60) : pad2(s / 60)) + ':' + pad2(s % 60);
/**
 * A time as typed -> seconds (with tenths); null when it is no time. Everywhere a time is typed in:
 *   10 · 5.2 · 5,2 · 5.2 sec   seconds
 *   1:12 · 1:30:00             m:ss · h:mm:ss (the seconds may have tenths)
 *   1h · 15m · 15m10s · 1h30m  hours, minutes, seconds
 */
function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (/^\d+(:\d+)?:\d+(\.\d+)?$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((v) => v >= 60)) return null;            // 1:75 is no time
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  const m = t.match(/^(?:(\d+(?:\.\d+)?)h(?:ours?|rs?)?)?(?:(\d+(?:\.\d+)?)m(?:in(?:utes?|s)?)?)?(?:(\d+(?:\.\d+)?)(?:s(?:ec(?:onds?|s)?)?)?)?$/);
  if (m && (m[1] || m[2] || m[3])) return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return null;
}
/** The own timer's time: whole seconds, 1 s – 99:59:59. */
function parseClock(text) {
  const v = parseDuration(text);
  if (v == null) return null;
  const secs = Math.round(v);
  return secs >= 1 && secs <= CT_MAX ? secs : null;
}
/** Lock: tenths of a second up to a minute ("5.2s"), past it the clock ("1:12"). */
const fmtSec = (s) => (s < 60 ? String(Math.round(s * 10) / 10) + 's' : fmtClock(Math.round(s)));
/** A field that takes a time (parseDuration): put back, red for a moment, when it is none. */
function timeField(id, value, fmt, parse, onSet) {
  const f = el('input');
  f.type = 'text'; f.className = 'clock'; f.value = fmt(value); f.maxLength = 12; f.spellcheck = false;
  if (id) f.id = id;
  f.placeholder = '5.2 · 1:12 · 15m10s';
  f.onchange = () => {
    const v = parse(f.value);
    if (v == null) { f.value = fmt(value); f.classList.add('bad'); setTimeout(() => f.classList.remove('bad'), 900); return; }
    f.value = fmt(v);
    onSet(v);
  };
  f.onkeydown = (e) => { if (e.key === 'Enter') f.blur(); };
  return f;
}
function renderCt(wide) {
  const box = $('ct');
  box.hidden = settings && settings.ctTimer === false;
  if (box.hidden) return;
  const total = ctSecs(), up = ctUp();
  const left = ctEnd ? Math.ceil((ctEnd - Date.now()) / 1000) : null;
  const state = left == null ? 'idle' : left > 0 ? 'run' : 'ready';
  box.classList.toggle('idle', state === 'idle');
  box.classList.toggle('run', state === 'run');
  box.classList.toggle('ready', state === 'ready');
  box.classList.toggle('soon', state === 'run' && left <= CT_WARN);
  box.classList.toggle('blink', state === 'run' && left <= CT_WARN);
  box.querySelector('b').textContent = wide ? ctName() : ctName().slice(0, 8);
  const shown = state === 'run' ? (up ? total - left : left) : up ? 0 : total;
  $('ctTime').textContent = state === 'ready' ? 'ready' : fmtClock(shown);
  box.title = ctName() + ' — ' + (state === 'run' ? (up ? fmtClock(total - left) + ' of ' + fmtClock(total) + ', ' : '') + 'done in ' + fmtClock(left)
    : state === 'ready' ? 'done' : 'not running')
    + '\nClick: start ' + (up ? 'counting up to ' : '') + fmtClock(total) + ' (again) · right click: clear';
}
// ---- what the active build still needs: switched on in the settings; a click opens the build
async function updateMissing() {
  if (!settings || settings.pillMissing !== true || !window.FarmView) missing = null;
  else { try { missing = await window.FarmView.summary(api); } catch (_) { missing = null; } }
  renderMissing(timersWide());
}
function renderMissing(wide) {
  const box = $('miss');
  box.hidden = !(settings && settings.pillMissing === true) || !missing || !missing.total;
  if (box.hidden) return;
  const done = missing.missing === 0;
  box.classList.toggle('done', done);
  box.querySelector('b').textContent = wide ? 'To farm' : 'Farm';
  $('missN').textContent = done ? 'done' : wide ? missing.missing + ' of ' + missing.total : String(missing.missing);
  box.title = missing.name + ' — ' + (done ? 'everything farmed' : missing.missing + ' of ' + missing.total + ' still to farm')
    + '\nClick: open the build';
}

function startCt(on) { ctEnd = on ? Date.now() + ctSecs() * 1000 : 0; renderCt(timersWide()); }

// ---------------------------------------------------------------- sections
function openSection(name, url, heading) {
  const prevSection = section;
  setIdle(false);
  const same = section === name && (!url || url === pageUrl);
  // opened from closed: never pinned – pinning is always your own click
  if (!section && !same) setPinned(false);
  section = same ? null : name;
  if (!same) { pick = null; chip = 'all'; }
  if (url) pageUrl = url;
  if (name === 'page' && !same) pageFrom = prevSection;

  setOpen(!!section);
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
function closeAll() {
  if (section) { lastSection = section; lastUrl = section === 'page' ? pageUrl : null; }
  section = null; pick = null;
  setPinned(false);
  setGhost(false);
  if (window.FarmView) window.FarmView.hideTip();
  if (window.BuildViews) window.BuildViews.hideTip();
  $('q').value = ''; itemHits = []; itemQuery = '';
  setOpen(false);
  showCoach();
  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => b.classList.remove('on'));
  api.viewHide();
  api.keyboard(false);
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

// ---------------------------------------------------------------- search data
async function updateItems(q) {
  if (q === itemQuery) return;
  itemQuery = q;
  const r = q ? await api.searchItems(q) : [];
  if (itemQuery !== q) return;                      // typed on in the meantime
  itemHits = r || [];
  render();
}
const favs = () => (settings && settings.favorites) || [];
const isFav = (name) => favs().some((f) => f.name === name);
function toggleFav(it) {
  const list = favs().slice();
  const i = list.findIndex((f) => f.name === it.name);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ name: it.name, type: it.type || '', icon: it.icon || '', url: it.url || '' });
  save({ favorites: list.slice(0, 30) });
}
function pushRecent(q) {
  if (!q || q.length < 2) return;
  const list = ((settings && settings.recent) || []).filter((r) => r.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  settings.recent = list.slice(0, 12);
  // saved quietly – the list is only shown with an empty search field, nothing to redraw
  api.saveSettings({ recent: settings.recent }).then((r) => { if (r && r.settings) settings = r.settings; });
}

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

// ---- search -------------------------------------------------------------
function renderSearch(main, side) {
  const q = $('q').value.trim();
  const { term, kinds } = S.parseQuery(q);
  // "crafting", "boss loot" or "activities" name a whole area instead of one thing
  const area = !term && kinds.length > 0;
  // an item found by name shows its bosses on its own card – a boss gets a card of its own only
  // when the search named the boss, or it drops something no item card shows
  const shownItems = new Set(itemHits.map((it) => S.norm(it.name)));
  const named = (b) => !!term && S.norm(b.sec.name).includes(S.norm(term));
  const bosses = (S.showBoss(kinds) ? S.search(loot.sections, term, area) : [])
    .filter((b) => area || named(b) || !b.items.length || b.items.some((x) => !shownItems.has(S.norm(x.name))));
  const bossArea = area && S.showBoss(kinds);
  if (bossArea) bosses.sort(bossFirst);
  const recipes = S.showCraft(kinds) ? S.searchCraft(craft.tables, term, area) : [];
  const acts = S.showActs(kinds)
    ? (term ? activities.filter((x) => x.n.includes(S.norm(term))) : (area ? activities : []))
    : [];
  const rws = area && kinds.indexOf('recipe') >= 0 ? runewords : [];

  // the tabs switch the whole result list; a result picked in the list shows beside it
  const counts = [['all', 'All', itemHits.length + bosses.length + recipes.length + rws.length + acts.length],
    ['items', 'Items', itemHits.length], ['boss', 'Bosses', bosses.length],
    ['crafting', 'Crafting', recipes.length + rws.length], ['activities', 'Activities', acts.length]];
  if (q) {
    $('chips').appendChild(UI.tabs(counts.filter(([, , n], i) => !i || n).map(([id, label, n]) => [id, label, null, false, n]), chip,
      (id) => { chip = id; if (id !== 'all') pick = null; render(); }));
  }

  if (!q) {
    const hit = (o) => side.appendChild(Object.assign(UI.line(Object.assign({ tag: 'button' }, o)), {}));
    if (favs().length) {
      side.appendChild(el('h5', null, 'Favourites'));
      favs().forEach((f) => hit({ name: f.name, sub: f.type, rarity: f.type, pic: { name: f.name, url: f.icon }, cls: 'hit', onClick: () => { $('q').value = f.name; onQuery(); } }));
    }
    const rec = (settings && settings.recent) || [];
    if (rec.length) {
      const h = el('h5', null, 'Recent');
      const clr = el('button', 'clr', 'Clear');
      clr.title = 'Delete the recent searches';
      clr.onclick = () => save({ recent: [] });
      h.appendChild(clr);
      side.appendChild(h);
      rec.forEach((r) => hit({ name: r, pic: UI.pic(r, { kind: 'search' }), cls: 'hit', onClick: () => { $('q').value = r; onQuery(); } }));
    }
    if (!favs().length && !rec.length) side.appendChild(el('div', 'empty', 'Type to search'));
    const hint = el('div', 'empty', 'Items, boss loot, crafting recipes and activities — all in one search.');
    hint.appendChild(el('div', 'meta', 'Try: crafting · boss loot · activities · duriel · ber rune · iconic mythic'));
    main.appendChild(hint);
    return;
  }

  // ---- the results: a list – what it is and where it comes from – and the picked one in full
  // beside it (the first one until you pick another)
  const inChip = (k) => chip === 'all' || chip === k;
  const R = [];
  const itemRows = !inChip('items') ? [] : itemHits.map((it) => {
    const from = dropSources(it.name).slice().sort(bossFirst)[0];
    return { key: 'i:' + it.name, group: 'Items', name: it.name, rarity: rarityOf(it.name, it), pic: { name: it.name, url: it.icon, kind: kindOf(it) },
      sub: [it.type, from ? from.sec.name.split(',')[0] : ''].filter(Boolean).join(' · '), card: () => itemCard(it) };
  });
  const bossRows = !inChip('boss') ? [] : bosses.slice().sort(bossFirst).map((b) => ({ key: 'b:' + b.sec.name, group: b.sec.isBoss ? 'Bosses' : 'Loot pools',
    name: b.sec.name, rarity: '', pic: { name: b.sec.name, kind: b.sec.isBoss ? 'boss' : 'pool' },
    sub: [(b.sec.drops || []).length + ' drops', b.sec.location ? placeOf(b.sec).where : ''].filter(Boolean).join(' · '), card: () => bossLoot([b]) }));
  // a boss searched by its name ("duriel", "Everything Duriel drops") comes first, and is shown –
  // not its trophy ("Duriel: Shard of Agony"), which only carries the name
  const bossNamed = !!term && bosses.some((b) => b.sec.isBoss && S.norm(b.sec.name).startsWith(S.norm(term)));
  R.push(...(bossNamed ? bossRows.concat(itemRows) : itemRows.concat(bossRows)));
  if (inChip('crafting')) {
    rws.forEach((r) => R.push({ key: 'r:' + r.name, group: 'Runewords', name: r.name, rarity: 'Runeword', pic: { name: r.name, url: r.icon, kind: 'rune' },
      sub: 'Runeword', src: ((r.fields && r.fields[0] && r.fields[0].value) || ''), card: () => itemCard(r) }));
    recipes.forEach((r, i) => R.push({ key: 'c:' + i, group: 'Crafting', name: r.table.group + (r.table.sub ? ' · ' + r.table.sub : ''), pic: UI.pic('', { kind: 'craft' }),
      sub: r.rows.length + ' recipes', card: () => craftCard(r) }));
  }
  if (inChip('activities')) {
    acts.forEach((x) => R.push({ key: 'a:' + x.name, group: 'Activities', name: x.name, pic: UI.pic('', { kind: 'activity' }),
      sub: 'Activity', card: () => activityCard(x) }));
  }
  resultKeys = R.map((r) => r.key);
  // "boss loot" without a pick shows the bosses as tiles; everything else shows the first hit
  // "crafting" without a pick shows the overview: every runeword with its runes, every table
  const craftArea = area && kinds.indexOf('recipe') >= 0 && !pick;
  const cur = R.find((r) => r.key === pick) || (bossArea || craftArea || !R.length ? null : R[0]);
  shownKey = cur ? cur.key : null;          // the default stays a default – late item hits come first

  // the results as chips, in order – the tabs above say how many of each kind there are
  R.forEach((r) => {
    const row = UI.line({ tag: 'button', name: r.name, rarity: r.rarity, sub: r.sub, pic: r.pic, end: r.src || '', on: r === cur, cls: 'hit',
      title: r.name + (r.src ? ' — ' + r.src : ''),
      onClick: () => { pick = r.key; render(); $('main').scrollTop = 0; } });
    row.dataset.key = r.key;
    if (r.key.startsWith('i:') && window.FarmView) window.FarmView.tip(row, r.name);
    side.appendChild(row);
  });
  if (!area) {
    const tl = UI.line({ tag: 'button', name: 'Search “' + q + '” on diablo.trade', pic: UI.pic('', { kind: 'trade' }), cls: 'hit trade', onClick: () => openTrade(q) });
    side.appendChild(tl);
  }

  if (!R.length) {
    main.appendChild(el('div', 'empty', loot.sections.length ? 'No matches.' : 'Data is still loading …'));
    return;
  }
  if (!cur && craftArea) {
    if (rws.length && inChip('crafting')) main.appendChild(runewordList());
    if (inChip('crafting')) recipes.forEach((r) => main.appendChild(craftCard(r)));
    if (inChip('activities')) acts.forEach((x) => main.appendChild(activityCard(x)));
    return;
  }
  if (!cur) {
    // "boss loot": the bosses to pick from, then what the picked one drops
    main.appendChild(bossLoot(bosses));
    return;
  }
  if (bossArea && cur.key.startsWith('b:')) {
    const back = UI.btn('All bosses', () => { pick = null; render(); }, 'ghost', 'left');
    back.style.marginBottom = '10px';
    main.appendChild(back);
  }
  main.appendChild(cur.card());
}

// ---- pictures and rarities ----------------------------------------------
const cleanName = (n) => String(n || '').replace(/‍/g, '').trim();
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];
/** The pictures of every thing by name (lib/icons.js) – asked again when the data changed. */
function loadIcons() {
  if (!api.icons) return;
  api.icons().then((m) => { UI.setIcons(m); if (section) render(); }).catch(() => {});
}
/** "mythic" | "unique" | … – from the item, the catalog, or the loot sheet's note. */
function rarityOf(name, it, note) {
  const r = (it && it.rarity) || ((window.FarmView && window.FarmView.item(name)) || {}).rarity || '';
  if (/mythic/i.test(r) || (!r && /mythic/i.test(note || ''))) return 'mythic';      // "Iconic Mythic Unique" too
  return r ? r.split(' ')[0].toLowerCase() : 'unique';
}
/** What kind of thing an item from the search is – it picks where its picture comes from. */
function kindOf(it) {
  const t = String((it && it.type) || '').toLowerCase(), r = String((it && it.rarity) || '').toLowerCase();
  if (/mythic/.test(r)) return 'mythic';
  if (/unique/.test(r)) return 'unique';
  if (/charm/.test(t)) return 'charm';
  if (/seal/.test(t)) return 'seal';
  if (/gem/.test(t)) return 'gem';
  if (/rune/.test(t)) return 'rune';
  if (/aspect/.test(t)) return 'aspect';
  return 'thing';
}

// ---- an item: its picture, what it does, then who drops it -------------------
function itemCard(it) {
  const c = el('div', 'card');
  const rar = rarityOf(it.name, it);
  const top = el('div', 'entry');
  const art = UI.pic(it.name, { url: it.icon, kind: kindOf(it), cls: 'pic art r-' + rar });
  if (window.FarmView) window.FarmView.tip(art, it.name);          // the in-game tooltip, as in the gear
  top.appendChild(art);
  const tx = el('div', 'etx');
  tx.appendChild(el('h2', 'r-' + rar, it.name));
  const cat = window.FarmView && window.FarmView.item(it.name);
  const cls = cat && cat.cls && cat.cls !== 'All' ? cat.cls : '';
  const meta = [it.rarity, it.type, cls, it.level ? 'level ' + it.level + '+' : '', it.set ? 'Set: ' + it.set : ''].filter(Boolean);
  if (meta.length) tx.appendChild(el('div', 'sub', meta.join(' · ')));
  // what it does, as the game's tooltip shows it
  if (it.power) tx.appendChild(el('div', 'power' + (rar === 'mythic' ? '' : ' u'), it.power));
  if ((it.effects || []).length) {
    const ul = el('ul', 'aff');
    it.effects.forEach((e) => ul.appendChild(el('li', null, e)));
    tx.appendChild(ul);
  }
  const acts = el('div', 'acts');
  acts.appendChild(UI.btn('diablo.trade', () => openTrade(it.name), 'pri', 'trade'));
  const star = UI.btn(isFav(it.name) ? 'Favourite' : 'Favourite', () => toggleFav(it), 'star' + (isFav(it.name) ? ' on' : ''), 'star');
  star.title = isFav(it.name) ? 'A favourite – click to take it out' : 'Keep it with the favourites (empty search)';
  acts.appendChild(star);
  acts.appendChild(UI.btn('Copy', () => { api.copyText(it.name); showNote('“' + it.name + '” copied.', 'ok', 2500); }, '', 'copy'));
  tx.appendChild(acts);
  top.appendChild(tx);
  c.appendChild(top);

  if (it.obtain) {
    const g = el('div', 'get');
    g.appendChild(el('b', null, 'How to get it'));
    g.appendChild(el('span', null, it.obtain));
    if (it.obtainNote) g.appendChild(el('span', 'sub', it.obtainNote));
    c.appendChild(g);
  }
  dropsFrom(it.name, c);
  const fields = it.fields || [];
  if (fields.length) {
    const g = el('div', 'fields');
    fields.forEach((f) => {
      const cell = el('div', 'cell');
      if (f.label) cell.appendChild(el('b', null, f.label));
      cell.appendChild(el('span', null, f.value));
      g.appendChild(cell);
    });
    c.appendChild(g);
  }
  if (it.desc) c.appendChild(el('div', 'desc', it.desc));
  return c;
}

/** "The Glacial Fissure is located South-west of Kyovashad in …" -> where it is, and the lair's name. */
function placeOf(sec) {
  const loc = String(sec.location || '').trim().replace(/\.$/, '');
  // "… is located South of …", sometimes just "… is East of …"
  const m = loc.match(/^(.*?)\s+(?:is|are)\s+(?:located\s+)?(.*)$/i);
  if (!m) return { where: loc, lair: '' };
  const where = m[2].replace(/^(in|at|on)\s+/i, '');
  const lair = m[1].toLowerCase() === String(sec.name || '').toLowerCase() ? '' : m[1];
  return { where: where.charAt(0).toUpperCase() + where.slice(1), lair };
}
/** Only what you need to go there: the torment level and the key. */
function bossFacts(info) {
  const out = [];
  (info || []).forEach((i) => {
    const t = String(i).trim().replace(/\.$/, '');
    let m;
    if ((m = t.match(/Torment\s*(\d+)/i)) && /requires/i.test(t)) out.push(['Torment ' + m[1] + '+', 'red']);
    else if ((m = t.match(/Lair Key:\s*(.+)$/i))) out.push([m[1], 'gold']);
  });
  return out;
}
const factTags = (sec) => {
  const f = bossFacts(sec.info);
  if (!f.length) return null;
  const t = el('div', 'tags');
  f.forEach(([v, k]) => t.appendChild(el('span', 'tag ' + k, v)));
  return t;
};

/** The lair screenshot from the guide: on request, it is big. Only a boss has a lair. */
function lairMap(sec, into, links) {
  if (!sec.isBoss || !sec.images || !sec.images[0]) return;
  const tg = el('button', 'lnk dim', 'Show lair & map');
  const box = el('div', 'shot');
  box.hidden = true;
  tg.onclick = () => {
    if (!box.firstChild) box.appendChild(UI.img(sec.images[0], () => { box.remove(); tg.remove(); }));
    box.hidden = !box.hidden;
    tg.textContent = box.hidden ? 'Show lair & map' : 'Hide lair & map';
  };
  (links || into).appendChild(tg);
  into.appendChild(box);
}

/** Every boss and loot pool that drops an item (by name). */
let dropIndex = { of: null, map: new Map() };
function dropSources(name) {
  if (dropIndex.of !== loot.sections) {
    const map = new Map();
    (loot.sections || []).forEach((sec) => (sec.drops || []).forEach((d) => {
      const k = S.norm(d.name);
      if (!map.has(k)) map.set(k, []);
      if (!map.get(k).some((x) => x.sec === sec)) map.get(k).push({ sec, drop: d });
    }));
    dropIndex = { of: loot.sections, map };
  }
  return dropIndex.map.get(S.norm(name)) || [];
}
/** On the item's card: who drops it and where that boss is – bosses first, then loot pools. */
function dropsFrom(name, into) {
  const src = dropSources(name).slice().sort(bossFirst);
  if (!src.length) return;
  const p = UI.plate({ title: 'Drops from', icon: 'lair', badge: src.length, cls: 'from' });
  const grid = el('div', 'bcards');
  src.forEach(({ sec, drop }) => {
    const card = el('div', 'bcard');
    card.appendChild(UI.pic(sec.name, { kind: sec.isBoss ? 'boss' : 'pool' }));
    const tx = el('div', 'btx');
    tx.appendChild(el('b', null, sec.name));
    const where = sec.location ? placeOf(sec) : null;
    const note = [drop.cls, cleanName(drop.note)].filter((x) => x && !/^(all|multiple) classes$/i.test(x)).join(' · ');
    const line = [where && where.where, where && where.lair ? 'Lair: ' + where.lair : '', note].filter(Boolean).join(' · ');
    if (line) tx.appendChild(el('span', 'lm', line));
    const tags = factTags(sec);
    if (tags) tx.appendChild(tags);
    const links = el('div', 'links');
    const all = el('button', 'lnk ball', 'Everything ' + sec.name.split(',')[0] + ' drops →');
    all.onclick = () => { $('q').value = sec.name.split(',')[0]; onQuery(); };
    links.appendChild(all);
    tx.appendChild(links);
    lairMap(sec, tx, links);
    card.appendChild(tx);
    grid.appendChild(card);
  });
  p.body.appendChild(grid);
  into.appendChild(p.card);
}

// ---- boss loot: every boss (or the one picked) with its uniques as tiles, filtered by class
function activeClass() {
  const st = window.FarmView && window.FarmView._state && window.FarmView._state();
  const b = st && st.data && st.data.builds.find((x) => x.id === st.data.active);
  return b && b.cls && b.cls !== 'All' ? b.cls : 'All';
}
/** The class the drops are shown for: picked here, else the active build's, else all. */
const lootClass = () => bossCls || (CLASSES.includes(activeClass()) ? activeClass() : 'All');
/** A drop for this class: its own, or one for every class. */
const forClass = (d, cls) => cls === 'All' || !d.cls || d.cls === cls || /^(all|multiple)/i.test(d.cls);
function classBar() {
  const cur = lootClass();
  const bar = el('div', 'clsbar clsrow');
  ['All'].concat(CLASSES).forEach((c) => {
    const b = el('button', 'cls' + (c === cur ? ' on' : ''));
    b.dataset.cls = c;
    b.title = c === 'All' ? 'Every class' : c;
    if (c === 'All') b.appendChild(el('span', null, 'All'));
    else b.appendChild(UI.img(UI.classPic(c), () => { b.textContent = c.slice(0, 3); }));
    b.onclick = () => { bossCls = c; render(); };
    bar.appendChild(b);
  });
  if (!bossCls && cur !== 'All') bar.appendChild(el('span', 'meta', cur + ' · your build’s class'));
  return bar;
}
/** One unique: picture, name in its colour, slot – the in-game tooltip on hover, a click looks it up. */
function itemTile(d) {
  const name = cleanName(d.name);
  const cat = window.FarmView && window.FarmView.item(name);
  const rar = rarityOf(name, null, d.note);
  const t = el('button', 'tile itile r-' + rar);
  t.dataset.item = name;
  t.appendChild(UI.pic(name, { url: cat && cat.icon, kind: rar === 'mythic' ? 'mythic' : 'unique' }));
  t.appendChild(el('b', 'inm r-' + rar, name));
  // "(Druid, Sorc)" is worth showing, "All" next to "all classes" is not
  const note = cleanName(d.note).replace(/^\((.*)\)$/, '$1').replace(/^all( classes)?$/i, '');
  const sub = [cat && cat.slot, /^(all|multiple)/i.test(d.cls || '') ? 'all classes' : '', note].filter(Boolean).join(' · ');
  if (sub) t.appendChild(el('small', 'ity', sub));
  t.onclick = () => { UI.tip.hide(); $('q').value = name; onQuery(); };
  if (window.FarmView) window.FarmView.tip(t, name);
  return t;
}
/** A boss with what it drops for the class – the count says how many of how many. */
function bossSection(sec, drops) {
  const cls = lootClass();
  const shown = drops.filter((d) => forClass(d, cls));
  const s = el('section', 'bsec' + (sec.isBoss ? '' : ' pool'));
  const hero = el('div', 'hero');
  hero.appendChild(UI.pic(sec.name, { kind: sec.isBoss ? 'boss' : 'pool' }));
  const tx = el('div', 'htx');
  tx.appendChild(el('h3', null, sec.name));
  if (sec.location) {
    const p = placeOf(sec);
    const w = el('div', 'where');
    w.appendChild(el('b', null, p.where));
    if (p.lair) w.appendChild(document.createTextNode(' · Lair: ' + p.lair));
    tx.appendChild(w);
  }
  const tags = factTags(sec);
  if (tags) tx.appendChild(tags);
  hero.appendChild(tx);
  const end = el('div', 'hend');
  const n = el('div', 'cnt', String(shown.length));
  n.appendChild(el('small', null, shown.length === drops.length ? 'drops' : 'for ' + cls + ' · ' + drops.length + ' in all'));
  end.appendChild(n);
  hero.appendChild(end);
  s.appendChild(hero);
  const g = el('div', 'tiles igrid');
  shown.forEach((d) => g.appendChild(itemTile(d)));
  if (!shown.length) g.appendChild(el('div', 'meta', drops.length ? 'Nothing for ' + cls + ' here.' : 'No drop list for it.'));
  s.appendChild(g);
  const lairs = el('div', 'lairs');
  lairMap(sec, lairs);
  if (lairs.firstChild) s.appendChild(lairs);
  return s;
}
/** "boss loot", or a boss picked: the class bar, then the bosses, the loot pools after them. */
function bossLoot(list) {
  const wrap = el('div', 'bloot');
  wrap.appendChild(classBar());
  list.slice().sort(bossFirst).forEach((b) => wrap.appendChild(bossSection(b.sec, b.items)));
  return wrap;
}

function craftCard(m) {
  const t = m.table;
  const p = UI.plate({ title: t.group + (t.sub ? ' · ' + t.sub : ''), sub: m.rows.length + ' recipes', icon: 'craft' });
  m.rows.forEach((row) => {
    const r = el('div', 'recipe');
    row.forEach((cell, i) => {
      if (!cell) return;
      const f = el('div', 'f');
      if (t.cols && t.cols[i]) f.appendChild(el('b', null, t.cols[i]));
      f.appendChild(el('span', null, cell));
      r.appendChild(f);
    });
    p.body.appendChild(r);
  });
  return p.card;
}

/** The parts of a step-by-step guide ("Part 1 – …", "Step 2 …"); other guides have none. */
const actSteps = (a) => {
  const parts = (a.sections || []).map((t, i) => [t, i]).filter(([t]) => /^(part|step|stage|quest)\s*\d/i.test(t));
  return parts.length >= 2 ? parts : [];
};
/** An activity: what it is, the parts to tick off (step-by-step guides), and its sections to jump to. */
function activityCard(a) {
  const steps = actSteps(a);
  const done = actDone(a);
  const p = UI.plate({ title: a.name, sub: steps.length ? actProgress(a) + ' of ' + steps.length + ' parts done · maxroll.gg guide' : 'maxroll.gg guide', icon: 'activity', cls: 'act' });
  p.side.appendChild(UI.btn('Open guide', () => openSection('page', a.url), 'pri sm'));
  const c = p.body;
  if (a.desc) c.appendChild(el('div', 'pw', a.desc));
  if (steps.length) {
    c.appendChild(el('div', 'k2', 'Your progress'));
    const list = el('div', 'steps');
    steps.forEach(([st, i]) => {
      const row = el('div', 'step' + (done.includes(i) ? ' done' : ''));
      row.appendChild(UI.tick({ on: done.includes(i), title: done.includes(i) ? 'Done – click to undo' : 'Done', onClick: (v) => setActDone(a, i, v) }));
      row.appendChild(el('span', null, st));
      const go = UI.iconBtn('Open the guide here', 'right', (e) => { e.preventDefault(); openSection('page', a.url, st); }, 'ghost sm');
      row.appendChild(go);
      list.appendChild(row);
    });
    c.appendChild(list);
  }
  const rest = (a.sections || []).filter((st) => !steps.some(([x]) => x === st) && !/^tl;?dr/i.test(st));
  if (rest.length) {
    c.appendChild(el('div', 'k2', steps.length ? 'More in the guide' : 'In the guide'));
    const list = el('div', 'jumps');
    rest.forEach((st) => {
      const b = el('button', 'jump');
      b.appendChild(el('span', null, st));
      b.appendChild(UI.icon('right'));
      b.title = 'Open the guide at this section';
      b.onclick = () => openSection('page', a.url, st);
      list.appendChild(b);
    });
    c.appendChild(list);
  }
  return p.card;
}
const actKey = (a) => a.slug || a.name;
const actDone = (a) => ((settings && settings.actDone) || {})[actKey(a)] || [];
/** How many of the guide's parts are ticked off. */
const actProgress = (a) => { const steps = actSteps(a); return actDone(a).filter((i) => steps.some(([, j]) => j === i)).length; };
function setActDone(a, i, on) {
  const all = Object.assign({}, (settings && settings.actDone) || {});
  const cur = new Set(all[actKey(a)] || []);
  if (on) cur.add(i); else cur.delete(i);
  all[actKey(a)] = [...cur].sort((x, y) => x - y);
  save({ actDone: all });
}

// All runewords as one plate – every entry opens its page with the exact recipes
function runewordList() {
  const p = UI.plate({ title: 'Runewords', sub: runewords.length + ' runewords · d4guides.gg', icon: 'rune' });
  runewords.forEach((r) => {
    const open = UI.iconBtn('Open in the database', 'external', () => openSection('page', r.url), 'ghost sm');
    p.body.appendChild(UI.line({ name: r.name, rarity: 'Runeword', sub: (r.fields[0] && r.fields[0].value) || '', pic: { name: r.name, url: r.icon, kind: 'rune' }, end: open, cls: 'drop' }));
  });
  return p.card;
}

// ---------------------------------------------------------------- settings
// The areas as the page's tabs; in each, plates with rows of the same shape – name and a line of
// help on the left, one control on the right. Four kinds of control: switch, segments, slider, key field.
const SET_TABS = [
  ['behaviour', 'Behaviour'],
  ['appearance', 'Appearance'],
  ['hotkeys', 'Hotkeys'],
  // only when the build has them (lib/features.js)
  ['macros', 'Macros', () => features.macros],
  ['trade', 'diablo.trade'],
  ['data', 'Data'],
];
let setScroll = { tab: null, top: 0 };          // filled by render() before the page is cleared
const setTabs = () => SET_TABS.filter((t) => !t[2] || t[2]());
function renderSettings(main) {
  if (!setTabs().some((t) => t[0] === setTab)) setTab = 'behaviour';
  // switching an option redraws the page – it stays where it was scrolled to
  const top = setScroll.tab ? setScroll.top : 0;
  setScroll.tab = 'all';
  pageHead('Overlay · changes apply right away', 'Settings');
  main.classList.add('settings');
  const inner = el('div', 'setbody');
  const FN = { behaviour: setBehaviour, appearance: setAppearance, hotkeys: setHotkeys, macros: setMacros, trade: setTrade, data: setData };
  const groups = setTabs().map(([id, label]) => {
    const g = el('section', 'setgroup');
    g.dataset.group = id;
    g.appendChild(el('h2', 'sgh', label));
    FN[id](g);
    inner.appendChild(g);
    return [id, label, g];
  });
  inner.appendChild(el('div', 'msg', setMsgText));
  main.appendChild(inner);
  // the chips jump to a group; scrolling lights the one you are in
  const chips = el('nav', 'anchors');
  const mark = (id) => chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.group === id));
  groups.forEach(([id, label, g]) => {
    const c = el('button', 'chip', label);
    c.dataset.group = id;
    c.onclick = () => {
      setTab = id; mark(id);
      main.style.scrollBehavior = 'smooth';                 // a jump glides; a redraw keeps its place at once
      main.scrollTop = g.offsetTop - 8;
      setTimeout(() => { main.style.scrollBehavior = ''; }, 700);
    };
    chips.appendChild(c);
  });
  $('chips').appendChild(chips);
  main.onscroll = () => {
    const y = main.scrollTop + 24;
    const cur = groups.filter(([, , g]) => g.offsetTop <= y).pop() || groups[0];
    if (cur) { setTab = cur[0]; mark(cur[0]); }
  };
  mark(setTab);
  // the warning sits over the visible part of the page, wherever it is scrolled to
  document.querySelectorAll('#cols > .ishade').forEach((x) => x.remove());
  if (riskAsk) $('cols').appendChild(riskDialog());
  main.scrollTop = top;
}
function opt(parent, title, hint, ctl) {
  const o = el('div', 'opt');
  const t = el('div', 'txt');
  t.appendChild(el('b', null, title));
  if (hint) t.appendChild(el('span', null, hint));
  o.appendChild(t);
  const c = el('div', 'ctl');
  (Array.isArray(ctl) ? ctl : [ctl]).forEach((x) => c.appendChild(x));
  o.appendChild(c);
  parent.appendChild(o);
  return o;
}
function sw(on, onChange) {
  const s = el('button', 'sw' + (on ? ' on' : ''));
  s.setAttribute('role', 'switch');
  s.setAttribute('aria-checked', on ? 'true' : 'false');
  s.appendChild(el('i'));
  s.onclick = () => onChange(!on);
  return s;
}
function sel(options, value, onChange) {
  const s = el('select');
  options.forEach(([v, label]) => { const o = el('option', null, label); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  s.onchange = () => onChange(s.value);
  return s;
}
function seg(options, value, onChange) {
  const g = el('div', 'seg');
  options.forEach(([v, label]) => {
    const b = el('button', v === value ? 'on' : null, label);
    b.onclick = () => onChange(v);
    g.appendChild(b);
  });
  return g;
}
/** A slider with its value next to it; onLive runs while dragging, onSet once let go. */
function slider(min, max, value, unit, onSet, onLive) {
  const r = el('input'); r.type = 'range'; r.className = 'range'; r.min = min; r.max = max; r.value = value;
  const v = el('span', 'val', value + unit);
  r.oninput = () => { v.textContent = r.value + unit; if (onLive) onLive(Number(r.value)); };
  r.onchange = () => onSet(Number(r.value));
  return [r, v];
}
const btn = (label, fn, cls) => UI.btn(label, fn, cls);

function setBehaviour(root) {
  let b;
  b = sect(root, 'Panel').body;
  opt(b, 'A click into the game', 'What happens to the open panel — Pin keeps it open either way',
    seg([['close', 'Closes it'], ['keep', 'Keeps it open']], settings.clickGame || 'close', (v) => save({ clickGame: v })));
  opt(b, 'No fade out on builds', 'Pinned builds stay fully visible while you play',
    sw(settings.buildsNoFade !== false, (v) => save({ buildsNoFade: v })));
  b = sect(root, 'Bar').body;
  opt(b, 'Show the overlay when', 'Otherwise it stays hidden',
    seg([['focused', 'D4 in front'], ['running', 'D4 running'], ['always', 'Always']], settings.visibility || 'focused', (v) => save({ visibility: v })));
  opt(b, 'What your build still needs', 'A small "to farm" count next to the timers — a click opens the build',
    sw(settings.pillMissing === true, (v) => save({ pillMissing: v }).then(() => { applyLayout(); updateMissing(); })));
  opt(b, 'Bar opacity', 'How far the closed bar fades — the mouse over it brings it back',
    slider(10, 100, Math.round((settings.fadeOpacity == null ? 0.35 : settings.fadeOpacity) * 100), ' %',
      (v) => save({ fadeOpacity: v / 100 }), (v) => document.documentElement.style.setProperty('--fade', v / 100)));
  b = sect(root, 'Timers').body;
  opt(b, 'World boss timer', 'In the bar, closed and open',
    sw(settings.wbTimer !== false, (v) => save({ wbTimer: v }).then(applyLayout)));
  opt(b, 'Warn before the spawn', 'The world boss timer turns red and grows from here on',
    slider(1, 30, settings.wbWarnMin == null ? 5 : settings.wbWarnMin, ' min', (v) => save({ wbWarnMin: v })));
  opt(b, 'Blink while it warns', 'A click on the timer stops it',
    sw(settings.wbBlink !== false, (v) => save({ wbBlink: v })));
  opt(b, 'Helltide timer', 'How long the Helltide still runs (red for its last 3 minutes), or when the next one starts',
    sw(settings.helltide !== false, (v) => save({ helltide: v }).then(applyLayout)));
  opt(b, 'Own timer', 'A click starts it, another click starts it over, a right click clears it — red and blinking for the last 30 seconds',
    sw(settings.ctTimer !== false, (v) => save({ ctTimer: v }).then(applyLayout)));
  const name = el('input');
  name.type = 'text'; name.id = 'ctName'; name.value = ctName(); name.maxLength = 16; name.spellcheck = false;
  name.onchange = () => save({ ctName: name.value.trim() }).then(renderTimers);
  const cn = opt(b, 'Its name', 'Shown above the time', name);
  const time = timeField('ctTimeIn', ctSecs(), fmtClock, parseClock, (v) => save({ ctSecs: v }).then(renderTimers));
  time.title = 'e.g. 90 (seconds), 5:00, 1:30:00, 15m, 15m10s or 1h';
  const cm = opt(b, 'Its time', 'Up to 99:59:59 — 90, 1:12 (m:ss), 1:30:00, 15m10s or 1h — what a click on it starts', time);
  const cu = opt(b, 'Counting', 'Down from its time, or up from 0:00 to its time',
    seg([['down', 'Down'], ['up', 'Up']], ctUp() ? 'up' : 'down', (v) => save({ ctUp: v === 'up' }).then(renderTimers)));
  [cn, cm, cu].forEach((o) => o.classList.toggle('off', settings.ctTimer === false));
  opt(b, 'Timers always bright', 'They ignore the closed bar\'s fade',
    sw(settings.wbBright !== false, (v) => save({ wbBright: v }).then(applyLayout)));
  b = sect(root, 'Messages').body;
  opt(b, 'Blink on a new message', 'Only the diablo.trade icon blinks, nothing else',
    sw(settings.msgBlink !== false, (v) => save({ msgBlink: v })));
}

function setAppearance(root) {
  let b;
  b = sect(root, 'Closed bar').body;
  const pick = el('div', 'seg multi chips');
  pick.id = 'pillPick';
  PILL_ITEMS.forEach(([k, label]) => {
    const t = el('button', pillHide().includes(k) ? null : 'on', label);
    t.dataset.pill = k;
    t.onclick = () => save({ pillHide: pillHide().includes(k) ? pillHide().filter((x) => x !== k) : pillHide().concat([k]) }).then(applyLayout);
    pick.appendChild(t);
  });
  opt(b, 'What it shows while closed', 'A click switches each one on or off — the drag handle always stays, a timer switched off in Behaviour stays off here too', pick);
  b = sect(root, 'Size').body;
  opt(b, 'Text size', 'On top of the automatic scaling by screen size',
    seg([[0.9, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], Number(settings.textScale) || 1, (v) => save({ textScale: Number(v) })));
  opt(b, 'Panel size', 'Medium fits the room left of the game\'s inventory (820 × 600 at 1080p) · Mobile is tall and narrow like a phone (393 × 850)',
    seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['mobile', 'Mobile']], settings.windowSize || 'medium',
      (v) => { api.setPanelSize(null); return save({ windowSize: v, panelSize: null }).then(reportSize); }));
  const reset = btn('Reset', () => { api.setPanelSize(null); save({ panelSize: null }); setMsg('Panel size back to the one picked above.'); });
  reset.id = 'btnResetSize';
  reset.disabled = !settings.panelSize;
  opt(b, 'Your own size', settings.panelSize
    ? settings.panelSize.w + ' × ' + settings.panelSize.h + ' px — drag the bottom right corner to change it'
    : 'Drag the bottom right corner of the panel – every page fits down to a phone\'s width', reset);
  b = sect(root, 'Look').body;
  opt(b, 'Opacity', 'How much of the game shows through',
    slider(60, 100, Math.round((settings.opacity || 1) * 100), ' %', (v) => save({ opacity: v / 100 }), (v) => api.setOpacity(v / 100)));
  opt(b, 'Places', 'The closed bar and the open panel each remember where you dragged them',
    btn('Reset', () => save({ posIdle: null, posOpen: null }).then(() => setMsg('Places reset — drag the bar where you want it.'))));
}

function setHotkeys(root) {
  let b;
  b = sect(root, 'Hotkeys').body;
  b.appendChild(el('div', 'ghint', 'Click a field and press the combination. Esc cancels, Del clears.'));
  opt(b, 'Open / close search', 'The cursor lands in the search field', hkField('hotkeySearch'));
  opt(b, 'Open builds', 'Gear, skills and paragon', hkField('hotkeyFarm'));
  opt(b, 'Open the map', 'Map tool', hkField('hotkeyMap'));
  opt(b, 'Show / hide the overlay', 'Without quitting', hkField('hotkeyToggle'));
  opt(b, 'Build: skills', 'Opens the active build on its skills — again closes it', hkField('hotkeySkills'));
  opt(b, 'Build: paragon', 'Opens the active build on its paragon boards', hkField('hotkeyParagon'));
  opt(b, 'Start the own timer', 'Starts it over as well — the game keeps the focus. A single F-key works here too', hkField('hotkeyTimer'));
}

// ---- Macros: click spam and lock – both off until switched on past a warning.
// Lock's keys are kept per character, to switch quickly.
// What can be pressed or held – the same list as lib/clicker.js (KEY_CHOICES).
const KEY_CHOICES = [...'1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'Space', 'Shift',
  'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'Mouse5'];
/** A key's short name on a tile ("M4"), and its long one in a tooltip. */
const keyName = (k) => (/^Mouse\d$/.test(k) ? 'M' + k.slice(5) : k);
const keyLabel = (k) => (/^Mouse\d$/.test(k) ? 'Mouse ' + k.slice(5) + ({ 1: ' (left)', 2: ' (right)', 3: ' (wheel)', 4: ' (thumb)', 5: ' (thumb)' }[k.slice(5)]) : k);
let riskAsk = null;                // the switch waiting for "use at your own risk": { key, label }

function setMacros(b) {
  const warn = el('div', 'mwarn');
  warn.appendChild(el('b', null, 'Use at your own risk'));
  warn.appendChild(el('span', null, 'These send mouse clicks and key presses to the game for you. Automated input can break the game\'s terms of use — your account is your responsibility.'));
  b.appendChild(warn);
  b.appendChild(el('div', 'ghint', 'All of them work only while Diablo IV is in front, and let go of everything when you leave it.'));

  const ch = sect(b, 'Character', 'Lock is kept per character — pick one and its keys load right away.', 'character');
  ch.card.hidden = !features.lock;          // nothing kept per character
  const chars = charList();
  const cur = charAt();
  const pick = sel(chars.map((c, i) => [String(i), c.name]), String(cur), (v) => switchChar(Number(v)));
  pick.id = 'macroChar';
  const name = el('input');
  name.type = 'text'; name.id = 'macroCharName'; name.value = chars[cur].name; name.maxLength = 30; name.spellcheck = false;
  name.title = 'Rename this character';
  name.onchange = () => { const n = name.value.trim(); if (n) saveChar({}, n); else name.value = chars[cur].name; };
  ch.tag.textContent = chars[cur].name;
  opt(ch.body, 'Character', 'The one in use', pick);
  opt(ch.body, 'Name', 'Rename the one picked', name);
  const del = btn('Delete', () => deleteChar());
  del.disabled = chars.length < 2;
  opt(ch.body, 'Characters', chars.length + ' saved', [btn('+ New', () => newChar()), del]);

  if (features.lock) {
    const lk = macroCard(b, 'lockOn', 'Lock', 'Press the toggle key in the game: every key is held down (lock) or pressed again after its time — until you press it again. A left click by hand or left click spam pauses it until you let go. The map (Tab) or the chat (Enter) pauses it until the same key or Esc closes it. The town portal (T) pauses it for 5 seconds, a left click goes on at once.', 'lockBind');
    riskSwitch(lk.body, 'lockOn', 'Lock', 'Off means the toggle key does nothing');
    opt(lk.body, 'Toggle key', 'Switches it on and off', bindField('lockBind'));
    const keys = lockList();
    opt(lk.body, 'Keys', 'Click + and press a key or mouse button — × takes one out',
      keyChips('lock', keys.map((e) => e.key),
        (k) => saveChar({ lockKeys: keys.concat([{ key: k, lock: true, sec: 1 }]) }),
        (k) => saveChar({ lockKeys: keys.filter((e) => e.key !== k) })));
    if (keys.length) lk.body.appendChild(lockRows(keys));
  }

  if (features.clickSpam) {
    const cs = macroCard(b, 'clickSpam', 'Click spam', 'Hold the button and the overlay keeps clicking.');
    riskSwitch(cs.body, 'clickSpam', 'Click spam', 'Off means nothing is watched at all');
    opt(cs.body, 'Right click spam', 'Hold this button to repeat right clicks', bindField('clickRightBind'));
    opt(cs.body, 'Left click spam', 'Hold this button to repeat left clicks', bindField('clickLeftBind'));
    opt(cs.body, 'Speed', 'Clicks per second',
      slider(1, 40, settings.clickCps == null ? 15 : settings.clickCps, ' /s', (v) => save({ clickCps: v })));
  }

  const st = el('div', 'msg');
  st.id = 'clickState';
  st.textContent = clickState;
  b.appendChild(st);
}

// Every settings section is a plate: icon, title, a line on what it is about – the macros add
// whether they are on and their toggle key.
const SECTIONS = {
  Panel: ['What the open panel does while you play', 'build'],
  Bar: ['The bar – closed a strip, open the panel\'s spine', 'list'],
  'Closed bar': ['Timers and lock – the mouse over it slides out the rest', 'list'],
  Timers: ['World boss, Helltide and your own timer', 'timer'],
  Messages: ['diablo.trade chat', 'trade'],
  Size: ['How big the text and the panel are', 'fit'],
  Look: ['How much of the game shows through, and where things sit', 'eye'],
  Hotkeys: ['Shortcuts that work while the game is in front', 'key'],
  Account: ['Your diablo.trade login', 'person'],
  'Item search': ['How a search opens on diablo.trade', 'search'],
  'If signing in does not work': ['Other ways to get your login in', 'warn'],
  'Game data': ['Loot, crafting, items — and your own saved data', 'folder'],
  Backup: ['A copy of what you made, in a folder of your choice', 'folder'],
  Updates: ['Whether a newer version is out', 'refresh'],
  Advanced: ['Where the game is and how it is found', 'gear'],
  Character: [null, 'person'],
  'Click spam': [null, 'target'],
  Lock: [null, 'lock'],
};
function sect(parent, title, hint, id) {
  const [line, icon] = SECTIONS[title] || [null, 'info'];
  const p = UI.plate({ title, sub: hint || line, icon, id: id || title });
  parent.appendChild(p.card);
  return { card: p.card, body: p.body, tag: p.badge, side: p.side };
}
/** A macro's plate: its state (ON / OFF) and its toggle key in the head. */
function macroCard(parent, key, title, hint, bindKey) {
  const c = sect(parent, title, hint, key);
  const on = settings[key] === true;
  c.card.classList.add('macro');
  c.card.classList.toggle('on', on);
  c.tag.textContent = on ? 'ON' : 'OFF';
  if (bindKey && settings[bindKey]) c.side.insertBefore(el('kbd', null, prettyBind(settings[bindKey])), c.tag);
  return c;
}

/**
 * The keys of a list as tiles – [1][Q][+]. A click on + waits for a key or a mouse button (any of
 * the five, the left one included), × on a tile takes it out again. A key is in a list only once.
 */
function keyChips(kind, keys, onAdd, onRemove) {
  const g = el('div', 'seg multi chips');
  g.dataset.picks = kind;
  keys.forEach((k) => {
    const t = el('button', 'on', keyName(k));
    t.dataset.key = k;
    t.title = keyLabel(k);
    const x = el('span', 'x', '×');
    x.title = 'Take ' + keyName(k) + ' out';
    x.onclick = (e) => { e.stopPropagation(); onRemove(k); };
    t.appendChild(x);
    g.appendChild(t);
  });
  const add = el('button', 'add', '+');
  add.dataset.keys = '';                             // records a key: it needs the keyboard
  add.title = 'Add a key';
  let rec = false, took = false;
  const stopRec = () => { rec = false; add.classList.remove('rec'); add.textContent = '+'; };
  const take = (k) => {
    if (!k) return;
    stopRec();
    if (keys.includes(k)) { add.textContent = keyName(k) + ' is in'; setTimeout(() => { if (!rec) add.textContent = '+'; }, 1200); return; }
    onAdd(k);
  };
  add.onclick = (e) => {
    e.preventDefault();
    if (took) { took = false; return; }              // the click that follows a mouse button taken
    if (rec) return;                                 // the click that starts listening is no key
    rec = true; add.classList.add('rec'); add.textContent = 'press a key …';
    typeIn(add);
  };
  // while listening, a mouse button on the tile is taken as that button
  add.onmousedown = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    took = e.button === 0;                           // only the left button clicks afterwards
    take({ 0: 'Mouse1', 2: 'Mouse2', 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button]);
  };
  // the click of a left button taken comes right after its mouseup – only that one is swallowed
  add.onmouseup = () => { if (took) setTimeout(() => { took = false; }, 0); };
  add.oncontextmenu = (e) => { if (rec) e.preventDefault(); };
  add.onkeydown = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopRec(); return; }
    const c = e.code;
    const k = /^Digit\d$/.test(c) ? c.slice(5) : /^Key[A-Z]$/.test(c) ? c.slice(3)
      : c === 'Space' ? 'Space' : /^Shift/.test(c) ? 'Shift' : null;
    if (k && KEY_CHOICES.includes(k)) take(k);
    else add.textContent = 'not that one …';
  };
  add.onblur = stopRec;
  g.appendChild(add);
  return g;
}

/**
 * Lock's keys, one row each: grip · on/off · key · lock switch · seconds. Lock on (the default)
 * holds the key down and greys the seconds; lock off presses it again after them. A key switched
 * off stays in the list with its settings but is left out until switched on again. The order is
 * the priority of the timed keys – they always go before the held ones; drag a row by its grip.
 */
function lockRows(keys) {
  const box = el('div', 'lockrows');
  const set = (i, patch) => saveChar({ lockKeys: keys.map((x, j) => {
    if (j !== i) return x;
    const y = Object.assign({}, x, patch);
    if (!y.off) delete y.off;                     // only a switched off key carries it
    return y;
  }) });
  let from = -1;
  let prio = 0;
  keys.forEach((e, i) => {
    const row = el('div', 'lockrow' + (e.lock ? ' held' : '') + (e.off ? ' off' : ''));
    row.dataset.key = e.key;
    const grip = el('span', 'grip');
    grip.title = 'Drag to change the order — timed keys go first, top to bottom';
    grip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
    // only the grip drags – the slider in the row has to stay draggable on its own
    grip.onmousedown = () => { row.draggable = true; };
    grip.onmouseup = () => { row.draggable = false; };
    row.ondragstart = (ev) => { from = i; row.classList.add('drag'); try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.key); } catch (_) {} };
    row.ondragend = () => { row.draggable = false; row.classList.remove('drag'); box.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); };
    row.ondragover = (ev) => { if (from < 0) return; ev.preventDefault(); row.classList.add('over'); };
    row.ondragleave = () => row.classList.remove('over');
    row.ondrop = (ev) => {
      ev.preventDefault();
      const a = from; from = -1;
      if (a < 0 || a === i) return;
      const list = keys.slice();
      list.splice(i, 0, list.splice(a, 1)[0]);
      saveChar({ lockKeys: list });
    };
    row.appendChild(grip);
    const pw = el('button', 'kon' + (e.off ? '' : ' on'));
    pw.title = e.off ? 'Switched off — click to use it again' : 'Switch off for now — it stays in the list';
    pw.setAttribute('aria-pressed', e.off ? 'false' : 'true');
    pw.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v8M6.3 7.2a7 7 0 1 0 11.4 0"/></svg>';
    pw.appendChild(el('span', null, e.off ? 'OFF' : 'ON'));
    pw.onclick = () => set(i, { off: !e.off });
    row.appendChild(pw);
    const name = el('b', 'kname', keyName(e.key));
    name.title = keyLabel(e.key);
    row.appendChild(name);
    const what = el('span', 'kwhat', e.off ? 'off' : e.lock ? 'held' : 'timed · ' + (++prio) + '.');
    row.appendChild(what);
    const lab = el('label', 'klock');
    lab.appendChild(el('span', null, 'Lock'));
    const s = sw(e.lock, (v) => set(i, { lock: v }));
    s.title = e.lock ? 'Held down — off to press it on a timer' : 'On a timer — on to hold it down';
    lab.appendChild(s);
    row.appendChild(lab);
    // pressed again every … – 5.2, 5,2, 10, 1:12 (m:ss), 15m10s; a tenth of a second up to an hour
    const r = timeField(null, Number(e.sec) || 1, fmtSec, (t) => { const v = parseDuration(t); return v != null && v >= 0.1 && v <= 3600 ? Math.round(v * 10) / 10 : null; },
      (v) => set(i, { sec: v }));
    r.classList.add('ksec');
    r.disabled = e.lock;
    r.title = e.lock ? 'Switch lock off to press it on a timer' : 'Pressed again every … — 5.2, 10, 1:12 (m:ss) or 15m10s';
    row.appendChild(r);
    box.appendChild(row);
  });
  if (keys.some((e) => !e.off && !e.lock) && keys.some((e) => !e.off && e.lock)) {
    box.appendChild(el('div', 'ghint', 'Timed keys always go out on time, top to bottom — the held ones stay down meanwhile.'));
  }
  return box;
}

/** A macro's on switch – switching it on first asks "use at your own risk". */
function riskSwitch(b, key, label, hint) {
  const on = settings[key] === true;
  const row = opt(b, 'On', hint, sw(on, (v) => {
    if (!v) { save({ [key]: false }); return; }
    riskAsk = { key, label };
    render();
  }));
  row.dataset.macro = key;
  return row;
}
function riskDialog() {
  const shade = el('div', 'ishade risk');
  const cancel = () => { riskAsk = null; render(); };
  shade.onclick = (e) => { if (e.target === shade) cancel(); };
  const m = el('div', 'imodal');
  const head = el('div', 'ihead');
  head.appendChild(el('h3', null, 'Use at your own risk'));
  m.appendChild(head);
  const body = el('div', 'ibody');
  body.appendChild(el('p', null, riskAsk.label + ' sends input to Diablo IV for you. Blizzard does not allow automated input — using it can get your account flagged or banned.'));
  body.appendChild(el('p', null, 'Only switch it on if you accept that risk.'));
  m.appendChild(body);
  const foot = el('div', 'ifoot');
  foot.appendChild(el('span', 'sp'));
  const no = btn('Cancel', cancel);
  const yes = btn('I understand, switch on', () => { const k = riskAsk.key; riskAsk = null; save({ [k]: true }); }, 'pri');
  yes.id = 'riskYes';
  foot.appendChild(no); foot.appendChild(yes);
  m.appendChild(foot);
  shade.appendChild(m);
  shade.tabIndex = -1;
  shade.onkeydown = (e) => { if (e.key === 'Escape') cancel(); };
  setTimeout(() => no.focus(), 0);
  return shade;
}

// The list in use – only known keys, each key once, lock on unless switched off; empty until keys are added.
function lockList() {
  const seen = new Set();
  return (Array.isArray(settings.lockKeys) ? settings.lockKeys : []).filter((e) => {
    if (!e || !KEY_CHOICES.includes(e.key) || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  }).map((e) => Object.assign({ key: e.key, lock: e.lock !== false, sec: Number(e.sec) > 0 ? Number(e.sec) : 1 }, e.off === true ? { off: true } : {}));
}
/** Lock's keys switched on, as they are pressed ("1234") – red while it runs, gold while it waits; nothing moves. */
function lockKeys(paused) {
  const keys = lockList().filter((e) => !e.off);
  const box = el('span', 'lkeys', keys.map((e) => keyName(e.key)).join('') || '–');
  box.title = keys.map((e) => keyLabel(e.key) + (e.lock ? ' — held' : ' — every ' + fmtSec(e.sec))).join('\n') + (paused ? '\n(waiting)' : '');
  return box;
}

// Characters: [{ name, lockKeys }]; the one in use is also what the settings hold, so
// the helper needs to know nothing about characters.
const curKeys = () => ({ lockKeys: lockList() });
function charList() {
  const list = Array.isArray(settings.macroChars) ? settings.macroChars.filter((c) => c && typeof c === 'object') : [];
  return list.length ? list.map((c) => Object.assign({}, c)) : [Object.assign({ name: 'Character 1' }, curKeys())];
}
const charAt = () => Math.max(0, Math.min(charList().length - 1, Number(settings.macroChar) || 0));
/** A change to the lists (or the name) – into the settings and into the character in use. */
function saveChar(patch, rename) {
  const chars = charList();
  const i = charAt();
  chars[i] = Object.assign({}, chars[i], curKeys(), patch, rename ? { name: rename } : {});
  return save(Object.assign({}, patch, { macroChars: chars, macroChar: i }));
}
/** The character's lists into the settings – what the helper runs on. */
const loadChar = (c) => ({
  lockKeys: Array.isArray(c.lockKeys) ? c.lockKeys.map((e) => Object.assign({}, e)) : [],
});
function switchChar(i) {
  const chars = charList();
  const at = charAt();
  chars[at] = Object.assign({}, chars[at], curKeys());          // what was set stays with the old one
  const c = chars[i] || chars[0];
  return save(Object.assign({ macroChars: chars, macroChar: chars.indexOf(c) }, loadChar(c)));
}
function newChar() {
  const chars = charList();
  chars[charAt()] = Object.assign({}, chars[charAt()], curKeys());
  let n = chars.length + 1;
  while (chars.some((c) => c.name === 'Character ' + n)) n++;
  chars.push(Object.assign({ name: 'Character ' + n }, curKeys()));          // starts as a copy
  return save({ macroChars: chars, macroChar: chars.length - 1 });
}
function deleteChar() {
  const chars = charList();
  if (chars.length < 2) return null;
  chars.splice(charAt(), 1);
  return save(Object.assign({ macroChars: chars, macroChar: 0 }, loadChar(chars[0])));
}

// Takes a mouse button (the two thumb buttons, the wheel button) or a single key.
let clickState = '';
const prettyBind = (b) => (/^Mouse[0-9]$/.test(String(b || '')) ? 'Mouse ' + String(b).slice(5) : (b || 'not set'));
function bindField(key) {
  const f = el('div', 'hk', prettyBind(settings[key]));
  f.tabIndex = 0;
  f.title = 'Click here, then press the button or key you want';
  f.onfocus = () => { f.dataset.val = f.textContent; f.textContent = 'press a button …'; f.classList.add('rec'); };
  f.onblur = () => { f.classList.remove('rec'); if (f.textContent === 'press a button …') f.textContent = f.dataset.val || 'not set'; };
  // mouse buttons: 1 = wheel, 3 = thumb back (Mouse4), 4 = thumb forward (Mouse5).
  // Left and right stay free, otherwise the field could not be clicked at all.
  f.onmousedown = (e) => {
    const name = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button];
    if (!name) return;
    e.preventDefault(); e.stopPropagation();
    f.textContent = 'Mouse ' + name.slice(5);
    save({ [key]: name });
    f.blur();
  };
  f.onkeydown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { f.textContent = f.dataset.val || 'not set'; f.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { f.textContent = 'not set'; save({ [key]: '' }); f.blur(); return; }
    const k = bindName(e);
    if (k) { f.textContent = k; save({ [key]: k }); f.blur(); }
  };
  return f;
}
// One key, without modifiers – the helper polls a single key, not a combination.
function bindName(e) {
  return codeKey(e.code, { Tab: 'Tab', CapsLock: 'CapsLock', Delete: 'Delete' });
}
/** A key code -> the name the helper and Electron use (letters, digits, F-keys, the common rest). */
function codeKey(c, more) {
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  return Object.assign({ Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }, more)[c] || null;
}
function hkField(key) {
  const f = el('div', 'hk', settings[key] || 'not set');
  f.tabIndex = 0;
  f.dataset.key = key;
  f.onfocus = () => { f.dataset.val = f.textContent; f.textContent = 'press keys …'; f.classList.add('rec'); api.hotkeyCapture(true); };
  f.onblur = () => { f.classList.remove('rec'); if (f.textContent === 'press keys …') f.textContent = f.dataset.val || 'not set'; api.hotkeyCapture(false); };
  f.onkeydown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { f.textContent = f.dataset.val || 'not set'; f.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { f.textContent = 'not set'; save({ [key]: '' }); f.blur(); return; }
    const a = accel(e);
    // a combination – or an F-key alone, which games leave free
    if (a && (a.indexOf('+') > 0 || /^F\d{1,2}$/.test(a))) { f.textContent = a; save({ [key]: a }); f.blur(); }
  };
  return f;
}
const accel = (e) => {
  const key = codeKey(e.code, { Enter: 'Return', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/' });
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
};

function setTrade(root) {
  let b;
  b = sect(root, 'Account').body;
  const line = opt(b, 'diablo.trade', 'Checking …', [
    btn('Sign in', () => openSection('page', 'https://diablo.trade/signin')),
    btn('Sign out', async () => { await api.authLogout(); setMsg('Signed out.'); }),
  ]);
  const st = line.querySelector('.txt span');
  st.id = 'authLine';
  api.authStatus().then((s) => {
    st.textContent = s.loggedIn ? 'Signed in — the session is kept' : s.cookies ? 'Cookies found, but no session' : 'Not signed in — chat and listings need it';
    st.classList.toggle('good', !!s.loggedIn);
  });
  b = sect(root, 'Item search').body;
  opt(b, 'Open the search in', 'In the overlay it fills the field; in the browser the name is on the clipboard',
    seg([['internal', 'Overlay'], ['browser', 'Browser']], settings.tradeOpenMode || 'internal', (v) => save({ tradeOpenMode: v })));
  opt(b, 'Press Enter after filling in', 'Overlay only — searches right away',
    sw(!!settings.pressEnter, (v) => save({ pressEnter: v })));
  b = sect(root, 'If signing in does not work').body;
  const ta = el('textarea'); ta.rows = 3; ta.placeholder = 'name=value; name2=value2  (or rows from the browser dev tools)';
  ta.hidden = !cookieBox;
  const apply = btn('Apply', async () => { const r = await api.authImport(ta.value); ta.value = ''; cookieBox = false; setMsg(r.imported ? r.imported + ' cookie(s) applied.' : 'No valid cookies found.'); }, 'pri');
  apply.hidden = !cookieBox;
  const paste = btn(cookieBox ? 'Cancel' : 'Paste …', () => { cookieBox = !cookieBox; render(); });
  opt(b, 'Paste cookies', 'From your browser, if the sign-in window does not work', [paste]);
  if (cookieBox) { const box = el('div', 'cookiebox'); box.appendChild(ta); box.appendChild(apply); b.appendChild(box); }
  opt(b, 'Browser userscript', 'Fills the search field in your own browser too (Tampermonkey)',
    btn('Copy', async () => { await api.copyUserscript(); setMsg('Userscript copied — paste it into Tampermonkey.'); }));
}

function setData(root) {
  let b;
  b = sect(root, 'Game data').body;
  opt(b, 'Boss loot, crafting, item database, activities',
    dataInfo || ((loot.sections || []).length + ' loot sections · ' + (craft.tables || []).length + ' crafting tables · ' + activities.length + ' activities'),
    btn('Reload now', () => { api.refreshData(); setMsg('Reloading …'); }, 'pri'));
  opt(b, 'Data folder', 'Settings, caches, login, builds and map progress — copy it to take everything along',
    btn('Open', () => api.openDataDir()));
  opt(b, 'Map progress', 'Your marks in the map tool, saved to map-progress.json',
    btn('Restore', async () => { const n = await api.mapRestore(); setMsg(n ? n + ' entries restored into the map.' : 'Nothing to restore.'); }));
  b = sect(root, 'Backup').body;
  const dir = settings.backupDir || '';
  opt(b, 'Folder', dir || 'None chosen — a OneDrive or Dropbox folder keeps a copy off this PC',
    [btn(dir ? 'Change …' : 'Choose …', async () => { const d = await api.pickBackupDir(); if (d) { await save({ backupDir: d }); refreshBackupAt(); } })]
      .concat(dir ? [btn('Open', () => api.openBackupDir())] : []));
  const now = btn('Back up now', () => api.runBackup(), 'pri');                     // backup-done redraws it
  now.disabled = !dir;
  opt(b, 'Settings, builds and map progress',
    !dir ? 'Choose a folder first' : backupAt ? 'Last backup ' + new Date(backupAt).toLocaleString() + ' · the newest 10 are kept' : 'No backup yet · the newest 10 are kept', now);
  const auto = opt(b, 'Every day', 'One backup a day, when the overlay starts',
    sw(settings.backupAuto === true, (v) => save({ backupAuto: v })));
  auto.classList.toggle('off', !dir);
  b = sect(root, 'Updates').body;
  const u = updateInfo;
  const state = !u ? 'Not checked yet' : u.error ? 'Check failed — ' + u.error : u.newer ? 'Version ' + u.latest + ' is out' : 'Up to date';
  const ub = [btn('Check now', async () => { setMsg('Checking …'); onUpdate(await api.checkUpdates()); setMsg(''); })];
  if (u && u.newer) ub.push(btn('Download ' + u.latest, () => api.openUpdate(), 'pri'));
  opt(b, 'D4 Overlay ' + (appVersion || ''), state, ub);
  opt(b, 'Look for updates', 'Once a day on GitHub — nothing is downloaded or installed by itself',
    sw(settings.updateCheck !== false, (v) => save({ updateCheck: v })));
  b = sect(root, 'Advanced').body;
  const path = el('input'); path.type = 'text'; path.value = settings.d4Path || ''; path.className = 'wide';
  path.onchange = () => save({ d4Path: path.value });
  opt(b, 'Diablo IV path', 'For the launch button and to find the game', [path,
    btn('Browse …', async () => { const p = await api.pickExe(); if (p) { path.value = p; save({ d4Path: p }); } })]);
  const title = el('input'); title.type = 'text'; title.value = settings.d4WindowTitle || '';
  title.onchange = () => save({ d4WindowTitle: title.value });
  opt(b, 'Window title', 'How the game window is recognised', title);
}
/** A line on what just happened – under the settings, and in the line at the foot (the page is long). */
function setMsg(t) { setMsgText = t; if (t) footNote(t, 'ok'); render(); }
function refreshBackupAt() {
  api.lastBackup().then((t) => { backupAt = Number(t) || 0; if (section === 'settings') render(); });
}
/** A newer version: a dot on the settings icon until it is installed. */
function onUpdate(r) {
  updateInfo = r || null;
  $('updDot').hidden = !(updateInfo && updateInfo.newer);
  if (section === 'settings') render();
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
  ['wb', 'World boss'], ['ht', 'Helltide'], ['ct', 'Own timer'], ['miss', 'To farm'], ['settings', 'Settings'], ['quit', 'Quit']];
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
  $('ct').onclick = (e) => { e.stopPropagation(); startCt(true); };
  $('ct').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); startCt(false); };
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
  api.onLayout(({ manual }) => {
    $('app').classList.toggle('manual', !!manual);
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
  api.onTimerRestart(() => { if (settings.ctTimer !== false) startCt(true); });
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
})();
