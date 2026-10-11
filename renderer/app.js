(function () {
'use strict';
const api = window.d4api;          // (not "api" on window: that would clash with the bridge name)
const S = window.SearchLib;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
/** A picture from another site (sent without a referrer); onFail runs when it does not load. */
function remoteImg(src, onFail) {
  const im = el('img');
  im.referrerPolicy = 'no-referrer';
  im.onerror = () => { im.remove(); if (onFail) onFail(); };
  im.src = src;
  return im;
}
const isUrl = (u) => /^https?:/.test(u || '');
/** Sort order: bosses before loot pools. */
const bossFirst = (x, y) => (y.sec.isBoss ? 1 : 0) - (x.sec.isBoss ? 1 : 0);

// Sections that show an embedded web page instead of our own cards
const EMBEDDED = { chat: 'chat', listings: 'listings', maptool: 'maptool', page: 'page' };

let settings = null;
// what this build has (lib/features.js) – without an answer: no macros
let features = { macros: false, clickSpam: false, lock: false };
let loot = { sections: [], fetchedAt: 0 };
let craft = { tables: [], fetchedAt: 0 };
let activities = [];
let wb = { at: 0, secs: null, text: '' };

let section = null;                // null = closed; otherwise one of the rail sections
let pageUrl = null;                // page opened from a card ("Database" button)
let itemHits = [], itemQuery = null;
let pick = null;                   // entry selected in the sidebar (filters the main view)
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
let detailOpen = false;            // narrow panel: the picked result fills it (with a way back)
/** The class of the build that is open in Builds – boss drops start on it. */
function activeClass() {
  const st = window.FarmView && window.FarmView._state && window.FarmView._state();
  const b = st && st.data && st.data.builds.find((x) => x.id === st.data.active);
  return b && b.cls && b.cls !== 'All' ? b.cls : 'All';
}

// ---------------------------------------------------------------- size reporting
function reportSize() {
  const open = !$('panel').hidden;
  const big = !!EMBEDDED[section] || section === 'farm';   // embedded pages and the farm list get more room
  api.resize(Math.ceil($('rail').getBoundingClientRect().width), Math.ceil($('shell').getBoundingClientRect().height), open, big);
  setTimeout(syncView, 30);
}
function syncView() {
  if (!EMBEDDED[section]) return;
  const r = $('viewSlot').getBoundingClientRect();
  if (r.width > 2) api.viewBounds({ x: r.x, y: r.y, width: r.width, height: r.height });
}

// ---------------------------------------------------------------- idle
// Nothing open and nothing touched for a while: the bar shrinks to the essentials
// (timer · search · diablo.trade · quit · drag handle) and fades to the set opacity.
// The timer keeps its full strength, and an alert blinks on its own element only.
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
  if (!on) $('app').classList.remove('peek');
  api.setIdle(on);
  renderTimers();                                    // the pill has room for the long form
  setTimeout(reportSize, 40);
  setTimeout(reportSize, 280);                       // again once the shrink has run
}
function wake() { setIdle(false); armIdle(); }
// Hovering only takes the fade off: the pill keeps its shape and its place, so it can be
// dragged. Opening it is a deliberate click on an icon (or the search hotkey).
function peek(on) { $('app').classList.toggle('peek', !!on && idle); }

// ---------------------------------------------------------------- timers
// Three timers sit in the bar and the pill: the world boss (read from diablo.trade), the
// Helltide (from the clock) and one of your own (started by a click).
const pad2 = (v) => String(Math.floor(v)).padStart(2, '0');
const fmtLong = (s) => pad2(s / 3600) + 'h ' + pad2((s % 3600) / 60) + 'min ' + pad2(s % 60) + 'sec';
const fmtShort = (s) => pad2(s / 3600) + ':' + pad2((s % 3600) / 60);
const fmtMin = (s) => pad2(s / 60) + 'min ' + pad2(s % 60) + 'sec';
const fmtMs = (s) => pad2(s / 60) + ':' + pad2(s % 60);
/** Room for the long form: the pill, the bar with labels, or the horizontal bar. */
const timersWide = () => idle || $('rail').classList.contains('wide') || $('shell').classList.contains('horizontal');

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
  box.querySelector('b').textContent = wide ? 'World Boss' : 'WB';
  if (wb.secs == null) { e.textContent = wide ? '--h --min --sec' : '--:--'; box.classList.remove('soon', 'blink'); return; }
  const left = Math.max(0, wb.secs - (Date.now() - wb.at) / 1000);
  e.textContent = wide ? fmtLong(left) : fmtShort(left);
  const warn = Number(settings && settings.wbWarnMin);
  const window_ = (isNaN(warn) ? 5 : warn) * 60;
  const soon = left < window_;
  box.classList.toggle('soon', soon);
  box.classList.toggle('blink', soon && !(settings && settings.wbBlink === false) && wbAck !== spawnOf());
  // the closer it gets, the bigger – less in the narrow vertical rail
  const most = wide ? 0.6 : 0.2;
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
  box.querySelector('b').textContent = wide ? (h.on ? 'Helltide' : 'Helltide in') : (h.on ? 'HT' : 'HT in');
  $('htTime').textContent = wide ? fmtMin(h.left) : fmtMs(h.left);
  box.title = h.on ? 'Helltide is on — ends in ' + fmtMin(h.left) : 'No Helltide — the next one starts in ' + fmtMin(h.left);
}

// ---- your own timer: a click starts it (again), a right click clears it; red and blinking
// for the last 30 seconds, "ready" at 0
const CT_WARN = 30;
let ctEnd = 0;                                       // when it runs out (0 = not counting)
const ctSecs = () => Math.round(60 * Math.max(1, Math.min(60, Number(settings && settings.ctMin) || 5)));
const ctName = () => String((settings && settings.ctName) || '').trim() || 'Timer';
function renderCt(wide) {
  const box = $('ct');
  box.hidden = settings && settings.ctTimer === false;
  if (box.hidden) return;
  const left = ctEnd ? Math.ceil((ctEnd - Date.now()) / 1000) : null;
  const state = left == null ? 'idle' : left > 0 ? 'run' : 'ready';
  box.classList.toggle('idle', state === 'idle');
  box.classList.toggle('run', state === 'run');
  box.classList.toggle('ready', state === 'ready');
  box.classList.toggle('soon', state === 'run' && left <= CT_WARN);
  box.classList.toggle('blink', state === 'run' && left <= CT_WARN);
  box.querySelector('b').textContent = wide ? ctName() : ctName().slice(0, 5);
  $('ctTime').textContent = state === 'run' ? fmtMs(left) : state === 'ready' ? 'ready' : fmtMs(ctSecs());
  box.title = ctName() + ' — ' + (state === 'run' ? 'runs out in ' + fmtMs(left) : state === 'ready' ? 'run out' : 'not running')
    + '\nClick: start ' + fmtMs(ctSecs()) + ' (again) · right click: clear';
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
  if (!same) { pick = null; chip = 'all'; detailOpen = false; }
  if (url) pageUrl = url;
  if (name === 'page' && !same) pageFrom = prevSection;

  $('panel').hidden = !section;
  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => b.classList.toggle('on', b.dataset.section === section));

  const embedded = !!EMBEDDED[section];
  $('viewSlot').hidden = !embedded;
  $('main').hidden = embedded;
  if (embedded) {
    const kind = section === 'maptool' ? 'map' : section === 'page' ? 'page' : section;
    api.viewShow(kind, section === 'page' ? pageUrl : null, heading || null);
    [0, 60, 150, 350, 700].forEach((ms) => setTimeout(syncView, ms));
  } else api.viewHide();

  if (section === 'search') { $('q').focus(); $('q').select(); }
  showCoach();
  armIdle();
  render();
}
function closeAll() {
  if (section) { lastSection = section; lastUrl = section === 'page' ? pageUrl : null; }
  section = null; pick = null;
  setPinned(false);
  setGhost(false);
  if (window.FarmView) window.FarmView.hideTip();
  if (window.BuildViews) window.BuildViews.hideTip();
  $('q').value = ''; itemHits = []; itemQuery = '';
  $('panel').hidden = true;
  showCoach();
  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => b.classList.remove('on'));
  api.viewHide();
  armIdle();
  render();
}

function setPinned(on) {
  pinned = !!on;
  $('btnPin').classList.toggle('on', pinned);
  $('btnPin').querySelector('span').textContent = pinned ? 'Pinned' : 'Pin';
}
/** The game got the focus: an open panel closes – pinned (or set to stay) it fades instead. */
function onGameFocus() {
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
  api.hoverWatch(!!on);
}
function showCoach() { $('coach').hidden = !section || !!(settings && settings.coachSeen); }

function showNote(text, kind, ms) {
  note = { text, kind: kind || 'info' };
  clearTimeout(noteTimer);
  if (ms !== 0) noteTimer = setTimeout(() => { note = null; render(); }, ms || 6000);
  if (!section) { section = 'search'; $('panel').hidden = false; document.querySelector('#rail .ri[data-section=search]').classList.add('on'); }
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
  clearTimeout(footTimer);
  footTimer = setTimeout(() => { e.hidden = true; }, kind === 'error' ? 15000 : 8000);
}

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
// Pin and close sit in the section's own header row (search field, build bar), so they never
// cover anything; without such a row (settings) they float top right.
function render() {
  const tools = $('ptools');
  tools.classList.remove('docked');
  $('panel').appendChild(tools);                     // out of the way before the content is cleared
  renderSection();
  const host = !$('top').hidden ? $('top') : section === 'farm' ? $('main').querySelector('.fbar') : section === 'settings' || section === 'notes' ? $('main').querySelector('.sethead') : null;
  if (host) { host.appendChild(tools); tools.classList.add('docked'); }
}
function renderSection() {
  const main = $('main'), side = $('side');
  const sm = document.querySelector('.setmain');
  setScroll.top = sm ? sm.scrollTop : 0;
  main.textContent = ''; side.textContent = '';
  main.classList.remove('farm', 'settings', 'notes');
  $('cols').classList.remove('narrow', 'detail');
  side.classList.toggle('results', section === 'search');
  $('qClear').hidden = !$('q').value;
  const ownPage = section === 'settings' || section === 'farm' || section === 'notes';
  $('top').hidden = !section || ownPage;
  side.hidden = !section || !!EMBEDDED[section] || ownPage;
  $('chips').textContent = '';

  if (!section) { reportSize(); return; }
  if (note) main.appendChild(el('div', 'note ' + note.kind, note.text));

  if (section === 'settings') { renderSettings(main); reportSize(); return; }
  if (section === 'notes') { renderNotes(main); reportSize(); return; }
  if (EMBEDDED[section]) { renderEmbeddedSidebar(); reportSize(); return; }

  if (section === 'farm') { window.FarmView.render(main, farmCtx); reportSize(); return; }
  if (section === 'search') renderSearch(main, side);
  if (section === 'activities') renderActivities(main, side);
  reportSize();
}

// What the farm list (farm.js) may use from here
const farmCtx = {
  get api() { return api; },
  el,
  rerender: () => { if (section === 'farm') render(); },
  note: (t, kind) => showNote(t, kind, 3500),
  openPage: (url) => openSection('page', url),   // a build site page inside the overlay
  status: (t) => { $('stData').textContent = t; },
};

function renderEmbeddedSidebar() {
  if (section === 'page' && pageFrom && pageFrom !== 'page' && !EMBEDDED[pageFrom]) {
    const back = el('button', 'chip', '← Back');
    back.title = 'Back to where you opened it';
    back.onclick = () => openSection(pageFrom);
    $('chips').appendChild(back);
  }
  // The embedded page fills the panel; only the map tool adds a small note line.
  if (section === 'maptool') $('stData').textContent = 'Map tool — your marks are saved automatically';
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

  // Filter chips switch the whole result list; clicking an entry in the sidebar narrows it
  // down to that one card. Both are cleared by picking "All".
  const counts = [['all', 'All', itemHits.length + bosses.length + recipes.length + rws.length + acts.length],
    ['items', 'Items', itemHits.length], ['boss', 'Boss', bosses.length],
    ['crafting', 'Crafting', recipes.length + rws.length], ['activities', 'Activities', acts.length]];
  counts.forEach(([id, label, n], i) => {
    if (i && !n) return;
    const c = el('span', 'chip' + (chip === id ? ' on' : ''), label);
    c.appendChild(el('b', null, String(n)));
    c.onclick = () => { chip = id; if (id !== 'all') pick = null; render(); };
    $('chips').appendChild(c);
  });

  if (!q) {
    if (favs().length) {
      side.appendChild(el('h5', null, 'Favourites'));
      favs().forEach((f) => side.appendChild(sideRow(f.icon, f.name, f.type, () => { $('q').value = f.name; onQuery(); })));
    }
    const rec = (settings && settings.recent) || [];
    if (rec.length) {
      const h = el('h5', 'withx', 'Recent');
      const clr = el('button', 'clr', 'Clear');
      clr.title = 'Delete the recent searches';
      clr.onclick = () => save({ recent: [] });
      h.appendChild(clr);
      side.appendChild(h);
      rec.forEach((r) => side.appendChild(sideRow('↩', r, '', () => { $('q').value = r; onQuery(); })));
    }
    if (!favs().length && !rec.length) side.appendChild(el('div', 'empty', 'Type to search'));
    const hint = el('div', 'empty', 'Items, boss loot, crafting recipes and activities — all in one search.');
    hint.appendChild(el('div', 'meta', 'Try: crafting · boss loot · activities · duriel · ber rune · iconic'));
    main.appendChild(hint);
    return;
  }

  // ---- the results: a list on the left – what it is and where it comes from – and the
  // picked one in full on the right (the first one until you pick another)
  const inChip = (k) => chip === 'all' || chip === k;
  const R = [];
  if (inChip('items')) {
    itemHits.forEach((it) => {
      const from = dropSources(it.name).slice().sort(bossFirst)[0];
      R.push({ key: 'i:' + it.name, group: 'Items', icon: it.icon, glyph: '◆', name: it.name,
        rcls: it.rarity ? 'r-' + it.rarity.split(' ')[0].toLowerCase() : '',
        sub: [it.rarity, it.type].filter(Boolean).join(' · '), src: from ? from.sec.name : '', card: () => itemCard(it) });
    });
  }
  if (inChip('boss')) {
    bosses.forEach((b) => R.push({ key: 'b:' + b.sec.name, group: b.sec.isBoss ? 'Bosses' : 'Loot pools', glyph: b.sec.isBoss ? '☠' : '◆',
      name: b.sec.name, rcls: '', sub: (b.sec.drops || []).length + ' drops', src: b.sec.location ? placeOf(b.sec).where : '', card: () => bossCard(b) }));
  }
  if (inChip('crafting')) {
    rws.forEach((r) => R.push({ key: 'r:' + r.name, group: 'Runewords', icon: r.icon, glyph: '⬡', name: r.name, rcls: 'r-rune',
      sub: 'Runeword', src: ((r.fields && r.fields[0] && r.fields[0].value) || ''), card: () => itemCard(r) }));
    recipes.forEach((r, i) => R.push({ key: 'c:' + i, group: 'Crafting', glyph: '⚒', name: r.table.group + (r.table.sub ? ' · ' + r.table.sub : ''),
      rcls: '', sub: r.rows.length + ' recipes', src: '', card: () => craftCard(r) }));
  }
  if (inChip('activities')) {
    acts.forEach((x) => R.push({ key: 'a:' + x.name, group: 'Activities', glyph: '⚑', name: x.name, rcls: '',
      sub: 'Activity', src: '', card: () => activityCard(x) }));
  }
  resultKeys = R.map((r) => r.key);
  // "boss loot" without a pick shows the bosses as tiles; everything else shows the first hit
  // "crafting" without a pick shows the overview: every runeword with its runes, every table
  const craftArea = area && kinds.indexOf('recipe') >= 0 && !pick;
  const cur = R.find((r) => r.key === pick) || (bossArea || craftArea || !R.length ? null : R[0]);
  shownKey = cur ? cur.key : null;          // the default stays a default – late item hits come first

  let group = null;
  const GROUP_ICON = { Items: 'item', Bosses: 'boss', 'Loot pools': 'target', Runewords: 'rune', Crafting: 'craft', Activities: 'activity' };
  R.forEach((r) => {
    if (r.group !== group) {
      group = r.group;
      const h = el('h5', 'grp');
      h.appendChild(iconTile(GROUP_ICON[group]));
      h.appendChild(el('span', null, group));
      h.appendChild(el('span', 'sstate', String(R.filter((x) => x.group === group).length)));
      side.appendChild(h);
    }
    side.appendChild(resultRow(r, r === cur));
  });
  if (!area) {
    const tl = el('a', 'res trade');
    tl.appendChild(el('span', 'rt', '↗'));
    tl.appendChild(el('span', 'rn', 'Search “' + q + '” on diablo.trade'));
    tl.onclick = () => openTrade(q);
    side.appendChild(tl);
  }

  narrowDetail(main, '← Results');

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
    main.appendChild(el('div', 'meta bhint', 'Pick a boss to see what it drops'));
    main.appendChild(bossGrid(bosses, (b) => { pick = 'b:' + b.sec.name; detailOpen = true; render(); $('main').scrollTop = 0; }));
    return;
  }
  if (bossArea && cur.key.startsWith('b:')) {
    const back = el('a', 'ab', '← All bosses');
    back.style.marginBottom = '10px';
    back.onclick = () => { pick = null; detailOpen = false; render(); };
    main.appendChild(back);
  }
  // the whole crafting area: all runewords as one card when nothing is picked yet
  main.appendChild(cur.card());
}
const isNarrow = () => $('cols').clientWidth > 0 && $('cols').clientWidth < 720;
/** A narrow panel shows the list or the picked one, never both squeezed – the picked one with a way back. */
function narrowDetail(main, backLabel) {
  const narrow = isNarrow();
  $('cols').classList.toggle('narrow', narrow);
  $('cols').classList.toggle('detail', narrow && detailOpen);
  if (narrow && detailOpen) {
    const back = el('button', 'ab back', backLabel);
    back.onclick = () => { detailOpen = false; render(); };
    main.appendChild(back);
  }
}
/** One result in the list: tile, name in its colour, what it is, where it comes from. */
function resultRow(r, on) {
  const a = el('a', 'res' + (on ? ' on' : ''));
  const t = el('span', 'rt');
  if (isUrl(r.icon)) t.appendChild(remoteImg(r.icon, () => { t.textContent = r.glyph; }));
  else t.textContent = r.glyph;
  a.appendChild(t);
  const tx = el('span', 'rx');
  tx.appendChild(el('span', 'rn ' + r.rcls, r.name));
  tx.appendChild(el('span', 'rs', r.sub));
  a.appendChild(tx);
  if (r.src) a.appendChild(el('span', 'rf', r.src));
  a.title = r.name + (r.src ? ' — ' + r.src : '');
  a.onclick = () => { pick = r.key; detailOpen = true; render(); $('main').scrollTop = 0; };
  return a;
}
function sideRow(icon, label, right, onClick, on) {
  const a = el('a', on ? 'on' : null);
  if (isUrl(icon)) a.appendChild(remoteImg(icon));
  else a.appendChild(el('i', null, icon || '◆'));
  a.appendChild(el('em', null, label));
  if (right) a.appendChild(el('b', null, right));
  if (onClick) a.onclick = onClick;
  return a;
}

// ---- cards --------------------------------------------------------------
/** The small icon tile of the cards (renderer/cards.js). */
function iconTile(icon) {
  const ic = el('span', 'sicon');
  ic.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (window.SCard.ICONS[icon] || window.SCard.ICONS.info) + '"/></svg>';
  return ic;
}
/** A part of a card under its own small head – the same look as the cards' heads, smaller. */
function subHead(title, icon, n) {
  const h = el('div', 'csub');
  h.appendChild(iconTile(icon));
  h.appendChild(el('b', null, title));
  if (n != null) h.appendChild(el('span', 'sstate', String(n)));
  return h;
}

function itemCard(it) {
  const c = el('div', 'card');
  const head = el('div', 'ch');
  const ic = el('div', 'ic');
  if (it.icon) ic.appendChild(remoteImg(it.icon, () => { ic.textContent = '◆'; }));
  else ic.textContent = '◆';
  head.appendChild(ic);

  const titles = el('div');
  const h = el('h4', null, it.name);
  if (it.rarity) h.classList.add('r-' + it.rarity.split(' ')[0].toLowerCase());
  titles.appendChild(h);
  const meta = [it.rarity, it.type, it.level ? 'level ' + it.level + '+' : '', it.set ? 'Set: ' + it.set : ''].filter(Boolean);
  if (meta.length) titles.appendChild(el('div', 'meta', meta.join(' · ')));
  head.appendChild(titles);

  const right = el('div', 'right');
  const star = el('button', 'ab icon star' + (isFav(it.name) ? ' on' : ''));
  star.title = 'Favourite';
  star.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z"/></svg>';
  star.onclick = () => toggleFav(it);
  right.appendChild(star);

  const copy = el('button', 'ab icon');
  copy.title = 'Copy name';
  copy.innerHTML = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.2"/><path d="M5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5"/></svg>';
  copy.onclick = () => { api.copyText(it.name); showNote('“' + it.name + '” copied.', 'ok', 2500); };
  right.appendChild(copy);

  const trade = el('button', 'ab', 'diablo.trade');
  trade.onclick = () => openTrade(it.name);
  right.appendChild(trade);

  if (it.url) {
    const db = el('button', 'ab', 'Database');
    db.onclick = () => openSection('page', it.url);
    right.appendChild(db);
  }
  head.appendChild(right);
  c.appendChild(head);

  if (it.power) c.appendChild(el('div', 'pw', it.power));
  if (it.obtain) {
    const g = el('div', 'get');
    g.appendChild(subHead('How to get it', 'target'));
    g.appendChild(el('span', null, it.obtain));
    if (it.obtainNote) g.appendChild(el('span', 'sub', it.obtainNote));
    c.appendChild(g);
  }
  dropsFrom(it.name, c);
  (it.effects || []).forEach((e) => c.appendChild(el('div', 'eff', '• ' + e)));
  const fields = it.fields || [];
  if (fields.length) {
    const g = el('div', 'grid');
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
    if ((m = t.match(/Torment\s*(\d+)/i)) && /requires/i.test(t)) out.push(['Torment ' + m[1] + '+', 'tier']);
    else if ((m = t.match(/Lair Key:\s*(.+)$/i))) out.push([m[1], 'key']);
  });
  return out;
}

/** Where the boss is, what you need to get in – shared by the boss card and an item's "Drops from". */
function placeInfo(sec, into) {
  if (sec.location) {
    const p = placeOf(sec);
    const w = el('div', 'where');
    w.appendChild(el('span', 'pin', '⌖'));
    const tx = el('div');
    tx.appendChild(el('b', null, p.where));
    if (p.lair) tx.appendChild(el('span', null, 'Lair: ' + p.lair));
    w.appendChild(tx);
    into.appendChild(w);
  }
  const facts = bossFacts(sec.info);
  if (facts.length) {
    const fx = el('div', 'facts');
    facts.forEach(([v, k]) => fx.appendChild(el('span', 'fact ' + k, v)));
    into.appendChild(fx);
  }
}
/** The lair screenshot from the guide: on request, it is big. */
function lairMap(sec, into) {
  if (!sec.images || !sec.images[0]) return;
  const tg = el('button', 'maptg', 'Show lair & map');
  const box = el('div', 'shot');
  box.hidden = true;
  tg.onclick = () => {
    if (!box.firstChild) {
      const img = remoteImg(sec.images[0], () => { box.remove(); tg.remove(); });
      img.onload = () => reportSize();
      box.appendChild(img);
    }
    box.hidden = !box.hidden;
    tg.textContent = box.hidden ? 'Show lair & map' : 'Hide lair & map';
    reportSize();
  };
  into.appendChild(tg);
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
  const box = el('div', 'from');
  box.appendChild(subHead('Drops from', 'boss', src.length));
  src.forEach(({ sec, drop }) => {
    const r = el('div', 'src');
    const h = el('div', 'sh');
    h.appendChild(el('span', 'gl', sec.isBoss ? '☠' : '◆'));
    h.appendChild(el('b', null, sec.name));
    const note = [drop.cls, drop.note].filter(Boolean).join(' · ');
    if (note) h.appendChild(el('em', null, note));
    r.appendChild(h);
    placeInfo(sec, r);
    lairMap(sec, r);
    box.appendChild(r);
  });
  into.appendChild(box);
}

function bossCard(r) {
  const sec = r.sec, c = el('div', 'card boss');
  const head = el('div', 'ch');
  head.appendChild(el('div', 'ic', sec.isBoss ? '☠' : '◆'));
  const t = el('div', 'bt');
  t.appendChild(el('h4', null, sec.name));
  t.appendChild(el('div', 'meta', sec.isBoss ? 'Boss' : 'Loot pool'));
  head.appendChild(t);
  c.appendChild(head);
  // where first – that is what you came for
  placeInfo(sec, c);

  if (r.items.length) {
    const dl = el('div', 'drops');
    const all = r.items.length === (sec.drops || []).length;
    // the whole drop list: by class – yours (from the active build) picked first
    const classes = all ? [...new Set(r.items.map((it) => it.cls).filter((x) => x && !/^all/i.test(x)))].sort() : [];
    let items = r.items;
    if (classes.length > 1) {
      const mine = activeClass();
      const want = bossCls || (classes.includes(mine) ? mine : 'All');
      const bar = el('div', 'clsbar');
      ['All'].concat(classes).forEach((c) => {
        const b2 = el('button', 'cls' + (c === want ? ' on' : ''), c);
        b2.onclick = () => { bossCls = c; render(); };
        bar.appendChild(b2);
      });
      if (!bossCls && want === mine) bar.appendChild(el('span', 'meta', 'your build’s class'));
      dl.appendChild(bar);
      if (want !== 'All') items = r.items.filter((it) => !it.cls || it.cls === want || /^all/i.test(it.cls));
    }
    dl.appendChild(subHead(all ? 'Drops' : 'Drops what you searched', 'item', items.length));
    items.forEach((it) => {
      const hit = itemHits.find((x) => x.name === it.name);
      const rar = hit && hit.rarity ? hit.rarity.split(' ')[0].toLowerCase() : /mythic/i.test(it.note || '') ? 'mythic' : 'unique';
      const row = el('div', 'drop');
      const ic = el('span', 'di');
      if (hit && isUrl(hit.icon)) ic.appendChild(remoteImg(hit.icon));
      row.appendChild(ic);
      // a click looks the item up
      const nm = el('span', 'nm r-' + rar, it.name);
      nm.title = 'Search for it';
      nm.onclick = () => { $('q').value = it.name; onQuery(); };
      row.appendChild(nm);
      row.appendChild(el('em', null, [it.cls, it.note].filter(Boolean).join(' · ')));
      const a = el('a', null, '↗'); a.title = 'Search on diablo.trade'; a.onclick = () => openTrade(it.name);
      row.appendChild(a);
      dl.appendChild(row);
    });
    c.appendChild(dl);
  }
  lairMap(sec, c);
  return c;
}

/** "boss loot": every boss as a tile – pick one to see what it drops. */
function bossGrid(list, choose) {
  const wrap = el('div');
  // the bosses first, the loot pools (season uniques, rune drops …) after them
  [['Bosses', list.filter((b) => b.sec.isBoss)], ['Loot pools', list.filter((b) => !b.sec.isBoss)]].forEach(([label, part]) => {
    if (!part.length) return;
    wrap.appendChild(el('div', 'bgh', label));
    wrap.appendChild(tiles(part, choose));
  });
  return wrap;
}
function tiles(list, choose) {
  const g = el('div', 'bgrid');
  list.forEach((b) => {
    const t = el('button', 'btile' + (b.sec.isBoss ? '' : ' pool'));
    const h = el('div', 'tn');
    h.appendChild(el('span', 'gl', b.sec.isBoss ? '☠' : '◆'));
    h.appendChild(el('b', null, b.sec.name));
    t.appendChild(h);
    if (b.sec.location) t.appendChild(el('div', 'tw', placeOf(b.sec).where));
    const facts = bossFacts(b.sec.info).map((x) => x[0]);
    t.appendChild(el('div', 'tm', [(b.sec.drops || []).length + ' drops'].concat(facts).join(' · ')));
    t.onclick = () => choose(b);
    g.appendChild(t);
  });
  return g;
}

function craftCard(m) {
  const t = m.table, c = el('div', 'card');
  const head = el('div', 'ch');
  head.appendChild(el('div', 'ic', '⚒'));
  const ti = el('div');
  ti.appendChild(el('h4', null, t.group + (t.sub ? ' · ' + t.sub : '')));
  ti.appendChild(el('div', 'meta', m.rows.length + ' recipes'));
  head.appendChild(ti); c.appendChild(head);
  m.rows.forEach((row) => {
    const r = el('div', 'recipe');
    row.forEach((cell, i) => {
      if (!cell) return;
      const f = el('div', 'f');
      if (t.cols && t.cols[i]) f.appendChild(el('b', null, t.cols[i]));
      f.appendChild(el('span', null, cell));
      r.appendChild(f);
    });
    c.appendChild(r);
  });
  return c;
}

/** The parts of a step-by-step guide ("Part 1 – …", "Step 2 …"); other guides have none. */
const actSteps = (a) => {
  const parts = (a.sections || []).map((t, i) => [t, i]).filter(([t]) => /^(part|step|stage|quest)\s*\d/i.test(t));
  return parts.length >= 2 ? parts : [];
};
/** An activity: what it is, the parts to tick off (step-by-step guides), and its sections to jump to. */
function activityCard(a) {
  const c = el('div', 'card act');
  const head = el('div', 'ch');
  const t = el('div');
  t.appendChild(el('h4', null, a.name));
  const steps = actSteps(a);
  const done = actDone(a);
  t.appendChild(el('div', 'meta', steps.length ? actProgress(a) + ' of ' + steps.length + ' parts done · maxroll.gg guide' : 'maxroll.gg guide'));
  head.appendChild(t);
  const right = el('div', 'right');
  const open = el('button', 'ab pri', 'Open guide');
  open.onclick = () => openSection('page', a.url);
  right.appendChild(open);
  head.appendChild(right);
  c.appendChild(head);
  if (a.desc) c.appendChild(el('div', 'pw', a.desc));
  if (steps.length) {
    c.appendChild(el('div', 'k2', 'Your progress'));
    const list = el('div', 'steps');
    steps.forEach(([st, i]) => {
      const row = el('label', 'step' + (done.includes(i) ? ' done' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = done.includes(i);
      cb.onchange = () => setActDone(a, i, cb.checked);
      row.appendChild(cb);
      row.appendChild(el('span', null, st));
      const go = el('button', 'ico'); go.title = 'Open the guide here';
      go.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
      go.onclick = (e) => { e.preventDefault(); openSection('page', a.url, st); };
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
      b.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>');
      b.title = 'Open the guide at this section';
      b.onclick = () => openSection('page', a.url, st);
      list.appendChild(b);
    });
    c.appendChild(list);
  }
  return c;
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

// All runewords as one card – every entry opens its page with the exact recipes
function runewordList() {
  const c = el('div', 'card');
  const head = el('div', 'ch');
  head.appendChild(el('div', 'ic', '⚒'));
  const t = el('div');
  t.appendChild(el('h4', null, 'Runewords'));
  t.appendChild(el('div', 'meta', runewords.length + ' runewords · d4guides.gg'));
  head.appendChild(t);
  c.appendChild(head);
  runewords.forEach((r) => {
    const row = el('div', 'drop');
    row.appendChild(el('i'));
    row.appendChild(el('span', null, r.name));
    row.appendChild(el('em', null, (r.fields[0] && r.fields[0].value) || ''));
    const a2 = el('a', null, '↗'); a2.title = 'Open in database'; a2.onclick = () => openSection('page', r.url);
    row.appendChild(a2);
    c.appendChild(row);
  });
  return c;
}

function renderActivities(main, side) {
  if (!activities.length) { main.appendChild(el('div', 'empty', 'Activities are still loading …')); return; }
  side.appendChild(el('h5', null, 'Activities'));
  activities.forEach((a) => {
    const steps = actSteps(a);
    side.appendChild(sideRow('', a.name, steps.length ? actProgress(a) + '/' + steps.length : '', () => { pick = a.name; detailOpen = true; render(); }, pick === a.name));
  });
  narrowDetail(main, '← Activities');
  const chosen = activities.find((a) => a.name === pick) || activities[0];
  main.appendChild(activityCard(chosen));
}

// ---------------------------------------------------------------- notes
// Notes per season: a checklist and free text, kept in the settings (notes.seasons).
function notesOf() {
  const n = (settings && settings.notes) || {};
  const list = Array.isArray(n.seasons) ? n.seasons.filter((x) => x && typeof x === 'object') : [];
  const seasons = (list.length ? list : [{ name: 'Season' }]).map((x) => ({
    name: String(x.name || 'Season'), text: String(x.text || ''),
    items: (Array.isArray(x.items) ? x.items : []).filter((i) => i && i.text).map((i) => ({ text: String(i.text), done: !!i.done })),
  }));
  return { active: Math.max(0, Math.min(seasons.length - 1, Number(n.active) || 0)), seasons };
}
/** quiet: while typing – saved a moment later, nothing redrawn (the cursor stays in the field). */
function saveNotes(n, quiet) {
  if (!quiet) return save({ notes: n });
  settings.notes = n;
  clearTimeout(saveNotes.t);
  saveNotes.t = setTimeout(() => api.saveSettings({ notes: settings.notes }).then((r) => { if (r && r.settings) settings = r.settings; }), 500);
  return Promise.resolve();
}
/** A season as Markdown: its name, the checklist as [ ] / [x], then the text. */
function notesText(x) {
  return ['# ' + x.name, '']
    .concat(x.items.map((i) => '- [' + (i.done ? 'x' : ' ') + '] ' + i.text), x.items.length ? [''] : [])
    .concat(x.text.trim() ? [x.text.trim(), ''] : [])
    .join('\n');
}
function renderNotes(main) {
  main.classList.add('notes');
  const n = notesOf(), cur = n.seasons[n.active];
  const head = el('div', 'sethead');
  head.appendChild(el('h2', null, 'Notes'));
  const copy = btn('Copy', () => { api.copyText(notesText(cur)); showNote('“' + cur.name + '” copied.', 'ok', 2500); });
  copy.title = 'This season as text, for Discord or anywhere else';
  const file = btn('Save as file …', async () => {
    const f = await api.saveNotesFile(n.seasons.map(notesText).join('\n'), 'd4-notes');
    if (f) showNote('Saved: ' + f, 'ok', 4000);
  });
  file.title = 'Every season into one Markdown file';
  head.appendChild(copy);
  head.appendChild(file);
  main.appendChild(head);
  const body = el('div', 'notesbody');

  const bar = el('div', 'nbar');
  const pickS = sel(n.seasons.map((x, i) => [String(i), x.name]), String(n.active), (v) => saveNotes(Object.assign(n, { active: Number(v) })));
  pickS.id = 'noteSeasonPick';
  bar.appendChild(pickS);
  const name = el('input');
  name.type = 'text'; name.id = 'noteSeason'; name.value = cur.name; name.maxLength = 40; name.spellcheck = false;
  name.title = 'Rename this season';
  name.onchange = () => { cur.name = name.value.trim() || 'Season'; saveNotes(n); };
  bar.appendChild(name);
  bar.appendChild(btn('+ Season', () => { n.seasons.push({ name: 'Season ' + (n.seasons.length + 1), text: '', items: [] }); n.active = n.seasons.length - 1; saveNotes(n); }));
  const del = btn('Delete', () => { n.seasons.splice(n.active, 1); n.active = 0; saveNotes(n); });
  del.disabled = n.seasons.length < 2;
  del.title = 'Delete this season with its notes';
  bar.appendChild(del);
  body.appendChild(bar);

  const done = cur.items.filter((i) => i.done).length;
  body.appendChild(subHead('Checklist', 'check', cur.items.length ? done + ' / ' + cur.items.length : null));
  const list = el('div', 'steps nlist');
  cur.items.forEach((it, i) => {
    const row = el('label', 'step' + (it.done ? ' done' : ''));
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = it.done;
    cb.onchange = () => { it.done = cb.checked; saveNotes(n); };
    row.appendChild(cb);
    row.appendChild(el('span', null, it.text));
    const x = el('button', 'ico');
    x.title = 'Remove';
    x.innerHTML = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    x.onclick = (e) => { e.preventDefault(); cur.items.splice(i, 1); saveNotes(n); };
    row.appendChild(x);
    list.appendChild(row);
  });
  const add = el('input');
  add.type = 'text'; add.id = 'noteAdd'; add.maxLength = 200; add.spellcheck = false;
  add.placeholder = 'Add a point — Enter';
  add.onkeydown = (e) => {
    if (e.key !== 'Enter' || !add.value.trim()) return;
    cur.items.push({ text: add.value.trim(), done: false });
    saveNotes(n).then(() => { const f = $('noteAdd'); if (f) f.focus(); });
  };
  list.appendChild(add);
  body.appendChild(list);
  if (done) {
    const clr = btn('Remove the ticked ones', () => { cur.items = cur.items.filter((i) => !i.done); saveNotes(n); });
    clr.classList.add('nclr');
    body.appendChild(clr);
  }

  body.appendChild(subHead('Notes', 'list'));
  const ta = el('textarea', 'ntext');
  ta.id = 'noteText'; ta.rows = 8; ta.value = cur.text; ta.spellcheck = false;
  ta.placeholder = 'Anything — builds to try, trades, what to do next …';
  ta.oninput = () => { cur.text = ta.value; saveNotes(n, true); };
  body.appendChild(ta);
  main.appendChild(body);
}

// ---------------------------------------------------------------- settings
// Five areas; in each, rows of the same shape – name and a line of help on the left, one
// control on the right. Four kinds of control: switch, segments, slider, key field.
const SET_TABS = [
  ['behaviour', 'Behaviour', 'M4 6h10M4 12h16M4 18h7M17 4v4M20 10v4M11 16v4'],
  ['appearance', 'Appearance', 'M12 4a8 8 0 1 0 0 16c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a3 3 0 0 0 3-3c0-4-3.6-7-8-7z'],
  ['hotkeys', 'Hotkeys', 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14.5h8'],
  // only when the build has them (lib/features.js)
  ['macros', 'Macros', 'M12 3v4M12 17v4M3 12h4M17 12h4M6.3 6.3l2.8 2.8M14.9 14.9l2.8 2.8M6.3 17.7l2.8-2.8M14.9 9.1l2.8-2.8', () => features.macros],
  ['trade', 'diablo.trade', 'M4 8.5h16l-1.5 11h-13zM8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5'],
  ['data', 'Data', 'M4 6c0-1.5 3.6-2.5 8-2.5s8 1 8 2.5v12c0 1.5-3.6 2.5-8 2.5s-8-1-8-2.5zM4 6c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5M4 12c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5'],
];
let setScroll = { tab: null, top: 0 };          // filled by render() before the page is cleared
const setTabs = () => SET_TABS.filter((t) => !t[3] || t[3]());
function renderSettings(main) {
  if (!setTabs().some((t) => t[0] === setTab)) setTab = 'behaviour';
  // switching an option redraws the page – it stays where it was scrolled to (same tab only)
  const top = setScroll.tab === setTab ? setScroll.top : 0;
  setScroll.tab = setTab;
  main.classList.add('settings');
  const head = el('div', 'sethead');
  head.appendChild(el('h2', null, 'Settings'));
  main.appendChild(head);
  const wrap = el('div', 'setwrap');
  const nav = el('div', 'setnav');
  setTabs().forEach(([id, label, icon]) => {
    const a = el('a', setTab === id ? 'on' : null);
    a.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
    a.appendChild(el('span', null, label));
    a.onclick = () => { setTab = id; setMsgText = ''; render(); };
    nav.appendChild(a);
  });
  nav.appendChild(el('div', 'snote', 'Changes apply right away.'));
  wrap.appendChild(nav);
  const body = el('div', 'setmain');
  const inner = el('div', 'setbody');
  ({ behaviour: setBehaviour, appearance: setAppearance, hotkeys: setHotkeys, macros: setMacros, trade: setTrade, data: setData })[setTab](inner);
  inner.appendChild(el('div', 'msg', setMsgText));
  body.appendChild(inner);
  wrap.appendChild(body);
  main.appendChild(wrap);
  if (riskAsk) main.appendChild(riskDialog());
  body.scrollTop = top;
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
const btn = (label, fn, cls) => { const b = el('button', 'ab' + (cls ? ' ' + cls : ''), label); b.onclick = fn; return b; };

function setBehaviour(root) {
  let b;
  b = sect(root, 'Panel').body;
  opt(b, 'A click into the game', 'What happens to the open panel — Pin keeps it open either way',
    seg([['close', 'Closes it'], ['keep', 'Keeps it open']], settings.clickGame || 'close', (v) => save({ clickGame: v })));
  opt(b, 'No fade out on builds', 'Pinned builds stay fully visible while you play',
    sw(settings.buildsNoFade !== false, (v) => save({ buildsNoFade: v })));
  b = sect(root, 'Bar').body;
  opt(b, 'Orientation', 'Vertical at the edge, or horizontal on top',
    seg([['horizontal', 'Horizontal'], ['vertical', 'Vertical']], settings.orientation || 'vertical', (v) => save({ orientation: v }).then(applyLayout)));
  opt(b, 'Show the overlay when', 'Otherwise it stays hidden',
    seg([['focused', 'D4 in front'], ['running', 'D4 running'], ['always', 'Always']], settings.visibility || 'focused', (v) => save({ visibility: v })));
  opt(b, 'Shrink to the small pill', 'Closed, only handle, timer, search, builds, diablo.trade, settings and quit stay',
    sw(settings.idleShrink !== false, (v) => save({ idleShrink: v }).then(applyLayout)));
  opt(b, 'What your build still needs', 'A small "to farm" count next to the timers — a click opens the build',
    sw(settings.pillMissing === true, (v) => save({ pillMissing: v }).then(() => { applyLayout(); updateMissing(); })));
  opt(b, 'Pill opacity', 'How far the closed bar fades — the mouse over it brings it back',
    slider(10, 100, Math.round((settings.fadeOpacity == null ? 0.35 : settings.fadeOpacity) * 100), ' %',
      (v) => save({ fadeOpacity: v / 100 }), (v) => document.documentElement.style.setProperty('--fade', v / 100)));
  b = sect(root, 'Timers').body;
  opt(b, 'World boss timer', 'In the bar and the pill',
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
  const cm = opt(b, 'It counts down', 'What a click on it starts',
    slider(1, 60, ctSecs() / 60, ' min', (v) => save({ ctMin: v }).then(renderTimers)));
  [cn, cm].forEach((o) => o.classList.toggle('off', settings.ctTimer === false));
  opt(b, 'Timers always bright', 'They ignore the pill fade',
    sw(settings.wbBright !== false, (v) => save({ wbBright: v }).then(applyLayout)));
  b = sect(root, 'Messages').body;
  opt(b, 'Blink on a new message', 'Only the diablo.trade icon blinks, nothing else',
    sw(settings.msgBlink !== false, (v) => save({ msgBlink: v })));
}

function setAppearance(root) {
  let b;
  b = sect(root, 'Pill').body;
  const only = opt(b, 'Show only timers', settings.idleShrink === false
    ? 'Needs “Shrink to the small pill” (Behaviour › Bar)'
    : 'The small pill shows the timers, settings and ✕ (quit), nothing else — a click on the world boss or Helltide opens the panel',
    sw(settings.pillTimersOnly === true, (v) => save({ pillTimersOnly: v }).then(applyLayout)));
  only.classList.toggle('off', settings.idleShrink === false);
  b = sect(root, 'Size').body;
  opt(b, 'Text size', 'On top of the automatic scaling by screen size',
    seg([[0.9, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], Number(settings.textScale) || 1, (v) => save({ textScale: Number(v) })));
  opt(b, 'Panel size', 'Share of the screen the open panel may use',
    seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']], settings.windowSize || 'medium', (v) => save({ windowSize: v }).then(reportSize)));
  const reset = btn('Reset', () => { api.setPanelSize(null); save({ panelSize: null }); setMsg('Panel size back to automatic.'); });
  reset.id = 'btnResetSize';
  reset.disabled = !settings.panelSize;
  opt(b, 'Your own size', settings.panelSize
    ? settings.panelSize.w + ' × ' + settings.panelSize.h + ' px — drag the bottom right corner to change it'
    : 'Drag the bottom right corner of the panel; narrow, everything goes to one column', reset);
  b = sect(root, 'Look').body;
  opt(b, 'Opacity', 'How much of the game shows through',
    slider(60, 100, Math.round((settings.opacity || 1) * 100), ' %', (v) => save({ opacity: v / 100 }), (v) => api.setOpacity(v / 100)));
  opt(b, 'Labels in the bar', 'Names next to the icons (vertical bar)',
    sw(!!settings.railWide, (v) => save({ railWide: v }).then(applyLayout)));
  opt(b, 'Places', 'The pill and the open bar each remember where you dragged them',
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
    const lk = macroCard(b, 'lockOn', 'Lock', 'Press the toggle key in the game: every key is held down (lock) or pressed again after its time — until you press it again. A left click by hand or left click spam pauses it until you let go.', 'lockBind');
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

// Every settings section sits on a card of its own: icon, title, a line on what it is about –
// the macros add whether they are on and their toggle key.
const SECTIONS = {
  Panel: ['What the open panel does while you play', 'M4 5h16v14H4zM4 9h16'],
  Bar: ['The icon rail, where it sits and how it fades', 'M5 4h4v16H5zM13 8h6M13 12h6M13 16h4'],
  Timers: ['World boss, Helltide and your own timer', 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9 2h6'],
  Messages: ['diablo.trade chat', 'M4 5h16v11H9l-5 4z'],
  Pill: ['The small bar while nothing is open', 'M3 9.5a2.5 2.5 0 0 1 2.5-2.5h13a2.5 2.5 0 0 1 0 5h-13A2.5 2.5 0 0 1 3 9.5zM7 16h10'],
  Size: ['How big the text and the panel are', 'M4 20L20 4M14 4h6v6M10 20H4v-6'],
  Look: ['Opacity, labels and where the bar sits', 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'],
  Hotkeys: ['Shortcuts that work while the game is in front', 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14.5h8'],
  Account: ['Your diablo.trade login', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6'],
  'Item search': ['How a search opens on diablo.trade', 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4'],
  'If signing in does not work': ['Other ways to get your login in', 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z'],
  'Game data': ['Loot, crafting, items — and your own saved data', 'M4 6c0-1.5 3.6-2.5 8-2.5s8 1 8 2.5v12c0 1.5-3.6 2.5-8 2.5s-8-1-8-2.5zM4 6c0 1.5 3.6 2.5 8 2.5s8-1 8-2.5'],
  Backup: ['A copy of what you made, in a folder of your choice', 'M4 7h16v13H4zM4 7l2-3h12l2 3M12 11v6M9 14l3 3 3-3'],
  Updates: ['Whether a newer version is out', 'M12 4v11M7 10l5 5 5-5M5 20h14'],
  Advanced: ['Where the game is and how it is found', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'],
  Character: [null, 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6'],
  'Click spam': [null, 'M9 3v3M3.5 8.5l2.1 2.1M3 14h3M12.5 9.5l7.5 3-3.2 1.3 3 3-1.8 1.8-3-3L13.7 18z'],
  Lock: [null, 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2'],
};
function sect(parent, title, hint, id) {
  const [line, icon] = SECTIONS[title] || [null, 'M5 12h14'];
  const card = el('section', 'scard');
  card.dataset.card = id || title;
  const head = el('div', 'shead');
  const ic = el('span', 'sicon');
  ic.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + icon + '"/></svg>';
  head.appendChild(ic);
  const t = el('div', 'stitle');
  t.appendChild(el('h3', null, title));
  if (hint || line) t.appendChild(el('span', null, hint || line));
  head.appendChild(t);
  const side = el('div', 'sside');
  const tag = el('span', 'sstate');
  side.appendChild(tag);
  head.appendChild(side);
  card.appendChild(head);
  const body = el('div', 'sbody');
  card.appendChild(body);
  parent.appendChild(card);
  return { card, body, tag, side };
}
/** A macro's card: its state (ON / OFF) and its toggle key in the head. */
function macroCard(parent, key, title, hint, bindKey) {
  const c = sect(parent, title, hint, key);
  const on = settings[key] === true;
  c.card.classList.add('macro');
  c.card.classList.toggle('on', on);
  c.tag.textContent = on ? 'ON' : 'OFF';
  c.tag.classList.add(on ? 'on' : 'off');
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
    add.focus();
  };
  // while listening, a mouse button on the tile is taken as that button
  add.onmousedown = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    took = e.button === 0;                           // only the left button clicks afterwards
    take({ 0: 'Mouse1', 2: 'Mouse2', 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button]);
  };
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
    const r = el('input'); r.type = 'range'; r.className = 'range'; r.min = 0.2; r.max = 30; r.step = 0.1; r.value = e.sec;
    r.disabled = e.lock;
    r.title = e.lock ? 'Switch lock off to press it on a timer' : 'Pressed again every …';
    const rv = el('span', 'val', Number(e.sec).toFixed(1) + ' s');
    r.oninput = () => { rv.textContent = Number(r.value).toFixed(1) + ' s'; };
    r.onchange = () => set(i, { sec: Number(r.value) });
    row.appendChild(r);
    row.appendChild(rv);
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
const lockKeysOn = () => lockList().filter((e) => !e.off).map((e) => keyName(e.key)).join('');

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
  opt(b, 'Settings, notes, builds and map progress',
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
function setMsg(t) { setMsgText = t; render(); }
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
function applyLayout() {
  const horizontal = (settings.orientation || 'vertical') === 'horizontal';
  $('shell').classList.toggle('horizontal', horizontal);
  document.documentElement.style.setProperty('--fade', settings.fadeOpacity == null ? 0.35 : settings.fadeOpacity);
  $('app').classList.toggle('shrink', settings.idleShrink !== false);
  $('app').classList.toggle('timersonly', settings.idleShrink !== false && settings.pillTimersOnly === true);
  $('app').classList.toggle('wbbright', settings.wbBright !== false);
  $('rail').classList.toggle('wide', !!settings.railWide && !horizontal);
  $('btnRail').querySelector('span').textContent = settings.railWide ? 'Collapse' : 'Expand';
  $('stHotkey').textContent = settings.hotkeySearch || '—';
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
  chip = 'all'; pick = null; detailOpen = false; bossCls = null;   // a new search starts with everything in view
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
  const big = () => !!EMBEDDED[section] || section === 'farm';
  grip.addEventListener('pointerdown', (e) => {
    from = true;
    try { grip.setPointerCapture(e.pointerId); } catch (_) {}   // not available everywhere
    document.body.classList.add('resizing');
    api.resizeDrag('start', big());
    e.preventDefault();
  });
  grip.addEventListener('pointermove', () => {
    if (!from || frame) return;
    frame = requestAnimationFrame(() => { frame = 0; if (from) api.resizeDrag('move', big()); });
  });
  const stop = (e) => {
    if (!from) return;
    from = null;
    api.resizeDrag('move', big());
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
  loot = (await api.getLoot()) || loot;
  craft = (await api.getCraft()) || craft;
  activities = (await api.getActivities()) || [];
  runewords = (await api.getRunewords()) || [];
  applyLayout();

  document.querySelectorAll('#rail .ri[data-section]').forEach((b) => { b.onclick = () => openSection(b.dataset.section); });
  $('btnRail').onclick = () => save({ railWide: !settings.railWide }).then(applyLayout);
  $('btnQuit').onclick = () => api.quit();
  // the world boss timer: blinking, a click stops the blinking; otherwise the timers are the
  // biggest target in the small pill and open what was open last (or the search)
  const openFromTimer = () => {
    wake();
    if (section) openSection('search');
    else openSection(lastSection || 'search', lastSection === 'page' ? lastUrl : undefined);
  };
  $('wb').onclick = () => {
    if ($('wb').classList.contains('blink')) { wbAck = spawnOf(); renderTimers(); return; }
    openFromTimer();
  };
  $('ht').onclick = openFromTimer;
  $('miss').onclick = () => { wake(); openSection('farm'); };
  // your own timer: a click starts it (over), a right click clears it – the panel stays shut
  $('ct').onclick = (e) => { e.stopPropagation(); startCt(true); };
  $('ct').oncontextmenu = (e) => { e.preventDefault(); e.stopPropagation(); startCt(false); };
  $('panelClose').onclick = closeAll;
  $('btnPin').onclick = () => { setPinned(!pinned); setGhost(false); };
  $('coachOk').onclick = () => { save({ coachSeen: true }); $('coach').hidden = true; };
  api.onBlur(onGameFocus);
  api.onFocus(() => setGhost(false));
  // faded: the main process says when the cursor is over the window – :hover misses a quick exit
  api.onCursorInside((inside) => $('app').classList.toggle('near', !!inside));
  $('qClear').onclick = () => { $('q').value = ''; itemHits = []; itemQuery = ''; onQuery(); render(); $('q').focus(); };
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
      const on = document.querySelector('#side .res.on');
      if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
  });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });
  $('rail').addEventListener('pointerenter', () => peek(true));
  $('rail').addEventListener('pointerleave', () => peek(false));

  api.onLoot((l) => { loot = l || loot; render(); });
  api.onCraft((c) => { craft = c || craft; render(); });
  api.onActivities((a) => { activities = a || activities; render(); });
  api.onFarmReady(() => { if (window.FarmView) window.FarmView.reload(); });
  if (window.FarmView) window.FarmView.onChange = updateMissing;
  api.onItemsReady(async () => { itemQuery = null; runewords = (await api.getRunewords()) || runewords; updateItems($('q').value.trim()); });
  api.onWorldBoss((d) => { wb = d; renderTimers(); });
  // what the app reports by itself (data loaded, login saved, backup …) goes to the footer only –
  // it never opens the panel while you play
  api.onNotice((n) => footNote(n.text, n.kind));
  api.onStatus((s) => {
    const e = $('stD4');
    e.textContent = '';
    e.appendChild(el('i', 'dot' + (s.d4Active || s.running ? '' : ' off')));
    e.appendChild(document.createTextNode(s.d4Active ? 'Diablo IV in foreground' : s.running ? 'Diablo IV running' : 'Diablo IV not found'));
  });
  api.onDataInfo((d) => { dataInfo = d.text; });
  api.onAuthInfo(() => {});
  api.onViewLoading((on) => $('viewSlot').classList.toggle('loading', !!on));
  api.onFocusSearch(() => { wake(); if (section !== 'search') openSection('search'); else { $('q').focus(); $('q').select(); } });
  api.onToggle(() => { wake(); if (section) closeAll(); else openSection('search'); });
  api.onOpenSection((name) => { wake(); openSection(name); });
  api.onEscape(closeAll);
  api.onLayout(({ up, offset, maxH, manual }) => {
    $('app').classList.toggle('manual', !!manual);
    $('app').classList.toggle('up', up);
    $('rail').style.marginLeft = (offset || 0) + 'px';
    if (maxH) {
      const card = Math.max(220, maxH - 56);
      document.documentElement.style.setProperty('--content-max', card + 'px');
      document.documentElement.style.setProperty('--view-h', Math.max(200, card - 96) + 'px');
    }
    setTimeout(syncView, 30);
  });
  api.onClickSpam(({ on, button }) => {
    clickState = on ? 'Clicking now (' + button + ') …' : '';
    const e = $('clickState');
    if (e) e.textContent = clickState;
  });
  // straight to the build's skills or paragon; pressed again on the same page, it closes
  api.onOpenBuildView((v) => {
    wake();
    const fv = window.FarmView;
    if (!fv) return;
    if (section === 'farm' && fv.view() === v) { closeAll(); return; }
    fv.setView(v);
    if (section === 'farm') render(); else openSection('farm');
  });
  api.onTimerRestart(() => { if (settings.ctTimer !== false) startCt(true); });
  api.onUpdateInfo(onUpdate);
  api.onBackupDone((t) => { backupAt = Number(t) || Date.now(); if (section === 'settings') render(); });
  api.onLock(({ on, paused }) => {
    const t = $('lockTag');
    t.hidden = !on;
    t.classList.toggle('paused', !!paused);
    t.title = paused ? 'Lock waits — goes on when you let go of the left button' : 'Lock running — the toggle key stops it';
    t.firstChild.textContent = paused ? 'Wait' : 'Lock';
    t.lastChild.textContent = lockKeysOn() || '–';
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
  const ro = new ResizeObserver(reportSize);
  ro.observe($('shell'));
  ro.observe($('rail'));             // the bar grows too (timer, fonts) – the window must follow
  // the search switches between list + detail and list-then-detail as the panel is resized
  new ResizeObserver(() => {
    const n = isNarrow();
    if ((section === 'search' || section === 'activities') && n !== $('cols').classList.contains('narrow')) render();
  }).observe($('cols'));
  window.addEventListener('resize', syncView);
  render();
}
init();
})();
