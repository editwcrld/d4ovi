'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog, shell, clipboard, net } = require('electron');
const path = require('path');
const fs = require('fs');
const { startWatcher } = require('./lib/winwatch');
const { scrapeMaxroll, VERSION: LOOT_VERSION } = require('./lib/maxroll');
const { scrapeCrafting, VERSION: CRAFT_VERSION } = require('./lib/crafting');
const trade = require('./lib/trade');
const views = require('./lib/views');
const auth = require('./lib/auth');
const items = require('./lib/items');
const d4g = require('./lib/d4guides');
const acts = require('./lib/activities');
const mythics = require('./lib/mythics');
const mapstore = require('./lib/mapstore');
const farm = require('./lib/farm');
const builds = require('./lib/builds');
const maxbuild = require('./lib/maxbuild');
const buildimport = require('./lib/buildimport');
const guideinfo = require('./lib/guideinfo');
const zhdict = require('./lib/zhdict');
const d2db = require('./lib/d2coredb');
const icons = require('./lib/icons');
const builder = require('./lib/builder');
const builderipc = require('./lib/builderipc');
const place = require('./lib/place');
const clicker = require('./lib/clicker');
const features = require('./lib/features');
const Settings = require('./lib/settings');
const tray = require('./lib/tray');
const updates = require('./lib/updates');
const backup = require('./lib/backup');
const VERSION = require('./package.json').version;   // app.getVersion() is Electron's when started from elsewhere
// what this build has: MACROS leaves out the whole tab, the others each macro on its own
const MACROS = {
  clickSpam: !!(features.MACROS && features.CLICK_SPAM),
  lock: !!(features.MACROS && features.LOCK),
};
MACROS.any = MACROS.clickSpam || MACROS.lock;
const S = require('./renderer/search');          // same search logic the overlay uses
const userscript = require('./lib/userscript');

// ---------- where data lives ----------
// Portable build: keep everything next to the .exe so the folder can be copied/carried
// (settings, caches, diablo.trade login, map progress). No write access there
// (e.g. inside "Program Files")? Then fall back to %APPDATA%.
(function chooseDataDir() {
  const portable = process.env.PORTABLE_EXECUTABLE_DIR;
  if (!portable) return;
  const dir = path.join(portable, 'D4-Overlay-Data');
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    app.setPath('userData', dir);
  } catch (_) { /* stays in %APPDATA% */ }
})();


// Everything scales with the screen: on a large display the text, icons and spacing grow,
// on 1920x1080 they stay at the base size (up to 4K: twice). The user can nudge it further
// (text size setting).
function zoomFor(wa) {
  const fromScreen = Math.max(1, Math.min(wa.height / 1080, 2));
  const wish = Number(settings.textScale) || 1;
  return Math.round(fromScreen * wish * 100) / 100;
}
let curZoom = 1;
function applyZoom() {
  if (!overlay || overlay.isDestroyed()) return curZoom;
  const wa = screen.getDisplayMatching({ x: barX, y: barY, width: curW, height: curH }).workArea;
  const z = zoomFor(wa);
  if (z !== curZoom) {
    curZoom = z;
    overlay.webContents.setZoomFactor(z);
    views.setZoom(z);
    dlog('Zoom =', z, '(screen ' + wa.width + 'x' + wa.height + ', text scale ' + (settings.textScale || 1) + ')');
  }
  return curZoom;
}

const BAR_WIDTH = 300;                   // until the overlay reports its real size
const BAR_HEIGHT = 52;
// The open panel is made for the room left of the game's inventory, skill tree and paragon:
// 820 × 600 at 1080p (CSS pixels – the zoom grows it with the screen), smaller or larger by the
// "Panel size" setting – or tall and narrow like a phone (393 × 850, "mobile") – or the size
// dragged by hand. Every page works down to the phone's width.
const PANEL_SIZES = { small: { w: 700, h: 510 }, medium: { w: 820, h: 600 }, large: { w: 985, h: 720 }, mobile: { w: 393, h: 850 } };
const PANEL_MIN = { w: 360, h: 400 };

let settings = Settings.load({}).settings;
let overlay = null;
let lastState = { title: '', proc: '', pid: 0, running: false };
let stopWatcher = null;
let hideTicks = 0;
let loot = { sections: [], fetchedAt: 0 };
let craft = { tables: [], fetchedAt: 0 };
// Layout: position of the bar itself plus the direction things open in
let barX = 0, barY = 0, curH = BAR_HEIGHT, curW = BAR_WIDTH;
let strip = { w: BAR_WIDTH, h: BAR_HEIGHT };   // the closed bar's last reported size (CSS pixels)
let capturing = false;                   // a hotkey is being recorded in the settings
let isIdle = false;                      // the overlay reported "nothing open" – the bar is a strip
let centreIdle = true;                   // no place dragged for the pill yet -> keep it centred
let hiddenByHand = false;               // hidden from the tray – stays hidden until shown there again
let placeLock = 0;                       // size reports that must not move the bar (just placed)

const userFile = (n) => path.join(app.getPath('userData'), n);
const send = (ch, payload) => { if (overlay && !overlay.isDestroyed()) overlay.webContents.send(ch, payload); };
const sendAuthInfo = () => auth.status().then((s) => send('auth-info', s.loggedIn ? 'diablo.trade: signed in' : 'diablo.trade: not signed in'));

// Diagnostics (console + <data>\overlay-log.txt). Past 1 MB the log starts over; the one
// before stays as overlay-log.old.txt.
const LOG_MAX = 1024 * 1024;
let logLines = 0;
function dlog(...a) {
  const line = new Date().toISOString().slice(11, 23) + ' ' + a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ');
  console.log('[d4]', line);
  try {
    const f = userFile('overlay-log.txt');
    if (logLines++ % 100 === 0 && fs.existsSync(f) && fs.statSync(f).size > LOG_MAX) fs.renameSync(f, userFile('overlay-log.old.txt'));
    fs.appendFileSync(f, line + '\r\n');
  } catch (_) {}
}

function loadSettings() {
  let raw = {};
  try { raw = JSON.parse(fs.readFileSync(userFile('settings.json'), 'utf8')); } catch (_) { /* first start */ }
  const r = Settings.load(raw);
  settings = r.settings;
  if (r.changed) saveSettingsFile();
}
function saveSettingsFile() {
  try { fs.writeFileSync(userFile('settings.json'), JSON.stringify(settings, null, 2)); } catch (_) {}
}

// ---------- detecting Diablo IV ----------
// The game process is "Diablo IV.exe"; the launcher is NOT the game.
function gameProcNames() {
  const base = path.win32.basename(settings.d4Path || '', '.exe');
  const names = new Set(['Diablo IV']);
  if (base && !/launcher/i.test(base)) names.add(base);
  return Array.from(names);
}
// The helper only clicks while the game window is in front, so it needs to know it.
let lockRunning = false;                 // what the helper last said: lock on or off
function restartClicker() {
  const p = clicker.start(settings, gameProcNames()[0], dlog, {
    spam: (on, button) => {
      send('click-spam', { on, button });
      dlog('click spam', on ? button + ' button, ' + Math.round(1000 / clicker.delayFor(settings.clickCps)) + '/s' : 'stopped');
    },
    lock: (on) => { lockRunning = on; send('lock-state', { on, paused: false }); dlog('lock', on ? 'on' : 'off'); },
    // a pause only ever shows while lock runs – a late "goes on" must not bring the tag back
    pause: (paused, why) => {
      if (!lockRunning) return;
      send('lock-state', { on: true, paused, why });
      dlog('lock', paused ? 'waits (' + (why ? why + ' open' : 'left click') + ')' : 'goes on');
    },
  }, MACROS);
  lockRunning = false;
  send('lock-state', { on: false, paused: false });     // a restarted helper starts switched off
  dlog('Macros:', !MACROS.any ? 'not in this build' : p.usable
    ? (p.on ? clicker.label(settings.clickLeftBind) + ' = left, ' + clicker.label(settings.clickRightBind) + ' = right, '
      + (Number(settings.clickCps) || 15) + '/s' : 'no click spam')
      + (p.vkLock ? '; lock ' + settings.lockKeys.map((e) => e.key + (e.lock === false ? ' every ' + e.sec + ' s' : ' held')).join(', ') + ' on ' + settings.lockBind : '')
      + ', only while "' + p.title + '" is in front'
    : 'off');
  return p;
}

function restartWatcher() {
  if (stopWatcher) stopWatcher();
  stopWatcher = startWatcher(gameProcNames(), onWindowState,
    (e) => send('notice', { text: 'Window detection: ' + e.message, kind: 'error' }), onMouseDown);
}
function onWindowState(st) {
  lastState = st;
  const procs = gameProcNames().map((n) => n.toLowerCase());
  const d4Focused = st.title.trim().toLowerCase() === settings.d4WindowTitle.trim().toLowerCase()
    || procs.includes((st.proc || '').toLowerCase());
  const oursFocused = st.pid === process.pid && overlay && !overlay.isDestroyed() && overlay.isFocused();
  const show = settings.visibility === 'always' || d4Focused || oursFocused
    || (settings.visibility === 'running' && st.running);
  if (!overlay || overlay.isDestroyed()) return;
  if (hiddenByHand) { if (overlay.isVisible()) overlay.hide(); }
  else if (show) {
    hideTicks = 0;
    if (!overlay.isVisible()) overlay.showInactive();
  } else if (overlay.isVisible() && ++hideTicks >= 2) {   // debounce against flicker
    overlay.hide();
  }
  send('status', { d4Active: d4Focused, running: st.running, title: st.title });
}

// ---------- window & layout ----------
// Two places are remembered: where the closed bar sits (by default centred at the top, out of
// the way) and where the open panel sits (by default top left – the room left of the game's
// inventory). Dragging the window always writes to the place of the state it is in.
const onScreen = (p) => place.onScreen(p, screen.getAllDisplays());

function defaultPlace(idle) {
  const wa = screen.getPrimaryDisplay().workArea;
  return idle
    ? { x: Math.round(wa.x + (wa.width - strip.w * curZoom) / 2), y: wa.y + 8 }
    : { x: wa.x + 16, y: wa.y + 64 };
}
function checkCentre() { centreIdle = !onScreen(settings.posIdle); }
function placeFor(idle) {
  const p = idle ? settings.posIdle : settings.posOpen;
  return onScreen(p) ? { x: p.x, y: p.y } : defaultPlace(idle);
}
function rememberPlace() {
  const p = { x: barX, y: barY };
  if (isIdle) settings.posIdle = p; else settings.posOpen = p;
}

/** Switches between the two states and moves the window to that state's place. */
function setIdleState(on) {
  if (on === isIdle || !overlay || overlay.isDestroyed()) return;
  rememberPlace();                       // keep the place of the state we are leaving
  isIdle = on;
  checkCentre();
  placeLock = 3;                         // the next size reports keep this place
  const p = placeFor(on);
  barX = p.x; barY = p.y;
  dlog(on ? 'Closed: the strip' : 'Open: the panel', '→', barX + ',' + barY);
  applySize(strip.w, strip.h, !on);
  saveSettingsFile();
}

/** The open panel in screen pixels: the size dragged by hand, else 820 × 600 by "Panel size" – on the screen. */
function panelBox(z, wa) {
  const m = settings.panelSize && settings.panelSize.w > 0 ? settings.panelSize : null;
  const p = PANEL_SIZES[settings.windowSize] || PANEL_SIZES.medium;
  const w = m ? m.w : p.w, h = m ? m.h : p.h;
  return { w: Math.min(Math.round(w * z), wa.width), h: Math.min(Math.round(h * z), wa.height), manual: !!m };
}

// Closed, the window is just the bar – a strip, where it was put (a strip never put anywhere stays
// centred while its width changes – but not while its sections slide out under the mouse, hold).
// Open, it is the panel at the open place. Either way it is kept on the screen and the place
// follows that.
function applySize(barW, barH, open, hold) {
  if (!overlay || overlay.isDestroyed()) return;
  const wa = screen.getDisplayMatching({ x: barX, y: barY, width: curW, height: curH }).workArea;
  const z = applyZoom();
  let w, h, manual = false;
  if (open) {
    const p = panelBox(z, wa);
    w = p.w; h = p.h; manual = p.manual;
  } else {
    strip = { w: barW, h: barH };
    w = Math.max(44, Math.min(Math.round(barW * z), wa.width));
    h = Math.max(36, Math.min(Math.round(barH * z), wa.height));
    if (!hold) barX = place.barLeft({ barX, bw: w, prevBw: curW, wa, idle: true, centre: centreIdle, fixed: placeLock > 0 });
  }
  barX = Math.max(wa.x, Math.min(barX, wa.x + wa.width - w));
  barY = Math.max(wa.y, Math.min(barY, wa.y + wa.height - h));
  if (placeLock > 0) placeLock--;
  overlay.setBounds({ x: barX, y: barY, width: w, height: h });
  curW = w; curH = h;
  rememberPlace();
  send('layout', { manual });
}

function createOverlay() {
  const pos = placeFor(false);
  barX = pos.x; barY = pos.y;
  overlay = new BrowserWindow({
    width: BAR_WIDTH, height: BAR_HEIGHT, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, show: false, focusable: false,
    alwaysOnTop: true, title: 'D4 Overlay', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setOpacity(Number(settings.opacity) || 1);
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.on('moved', () => {
    const [x, y] = overlay.getPosition();
    barX = x; barY = y;
    rememberPlace();
    if (isIdle) centreIdle = false;       // dragged by hand -> keep exactly this spot
    saveSettingsFile();
  });
  // the focus went elsewhere (alt-tab, another window): the keyboard is the game's again
  overlay.on('blur', () => setKeyboard(null));
  if (settings.visibility === 'always') overlay.once('ready-to-show', () => overlay.showInactive());
}

// ---------- focus: the game keeps it ----------
// The overlay is not focusable, so a click on it leaves the game in front (and lock running).
// It takes the keyboard only while something in it is typed into – a text field or a key to
// record (asked for by the overlay, "ui"), or an embedded page clicked into ("view") – and gives
// it back as soon as that is over, the focus goes elsewhere or the mouse goes down outside.
const keyboard = { ui: false, view: false };
/** who: 'ui' | 'view' (on or off), or null to give the keyboard back altogether. */
function setKeyboard(who, on) {
  if (who) keyboard[who] = !!on; else keyboard.ui = keyboard.view = false;
  if (!overlay || overlay.isDestroyed()) return;
  if (keyboard.ui || keyboard.view) {
    overlay.setFocusable(true);
    if (!overlay.isVisible()) overlay.show();
    overlay.focus();
    if (keyboard.view) views.focus(); else overlay.webContents.focus();
    // Windows may refuse to hand the focus over (foreground lock) – then typing cannot work; say so
    setTimeout(() => { if (overlay && !overlay.isDestroyed() && (keyboard.ui || keyboard.view) && !overlay.isFocused()) dlog('keyboard: Windows did not give the overlay the focus'); }, 300);
  } else if (overlay.isFocusable()) {
    if (overlay.isFocused()) overlay.blur();            // back to the window below – the game
    overlay.setFocusable(false);
  }
}
/** A mouse button pressed by hand anywhere (lib/winwatch.js): outside the overlay it is a click into the game. */
function onMouseDown(pt) {
  if (!overlay || overlay.isDestroyed() || !overlay.isVisible() || inDialog) return;
  const p = screen.screenToDipPoint({ x: pt[0], y: pt[1] }), b = overlay.getBounds();
  if (p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height) return;
  setKeyboard(null);
  send('click-outside');                                  // the panel closes (or, pinned, fades)
}
ipcMain.on('overlay:keyboard', (_e, on) => setKeyboard('ui', on));

// our own file dialogs are clicked into – that is not a click into the game
let inDialog = 0;
async function withDialog(fn) {
  inDialog++;
  try { return await fn(); } finally { setTimeout(() => { inDialog = Math.max(0, inDialog - 1); }, 300); }
}

// ---------- hotkeys ----------
function registerHotkeys() {
  globalShortcut.unregisterAll();
  if (capturing) return [];              // while recording nothing may swallow the keys
  const errors = [];
  const reg = (acc, fn, label) => {
    if (!acc) return;
    try { if (!globalShortcut.register(acc, fn)) errors.push(label + ': "' + acc + '" is already taken'); }
    catch (_) { errors.push(label + ': "' + acc + '" is not a valid combination'); }
  };
  // the overlay comes up without the focus – only the search takes the keyboard, to type into
  const front = () => { if (overlay && !overlay.isDestroyed() && !overlay.isVisible()) overlay.showInactive(); };
  reg(settings.hotkeySearch, () => { setKeyboard('ui', true); send('focus-search'); }, 'Search');
  reg(settings.hotkeyToggle, () => { front(); send('toggle'); }, 'Show/hide');
  reg(settings.hotkeyMap, () => { front(); send('open-section', 'maptool'); }, 'Map tool');
  reg(settings.hotkeyFarm, () => { front(); send('open-section', 'farm'); }, 'Builds');
  // the own timer starts (over) without taking the focus from the game
  reg(settings.hotkeyTimer, () => send('timer-restart'), 'Own timer');
  reg(settings.hotkeySkills, () => { front(); send('open-build-view', 'skills'); }, 'Build skills');
  reg(settings.hotkeyParagon, () => { front(); send('open-build-view', 'paragon'); }, 'Build paragon');
  return errors;
}

// ---------- maxroll data ----------
function loadCache(name, fallback) {
  try { return JSON.parse(fs.readFileSync(userFile(name), 'utf8')); } catch (_) { return fallback; }
}
function dataInfo() {
  send('data-info', {
    text: items.count() + ' items · ' + (loot.sections || []).length + ' loot sections · '
      + (craft.tables || []).length + ' crafting tables · ' + acts.count() + ' activities · '
      + mythics.count() + ' iconic mythics · ' + farm.count() + ' farm entries',
  });
}

// The two maxroll cheat sheets (boss loot, crafting): read in a hidden window once a day, or
// when the scraper changed (version), and cached in the data folder.
const busy = new Set();
async function refreshSheet(force, { key, cur, version, scrape, url, cache, loading, done, fail }) {
  if (busy.has(key)) return cur;
  const stale = !cur.fetchedAt || cur.version !== version || Date.now() - cur.fetchedAt > 24 * 3600 * 1000;
  if (!force && !stale) return cur;
  busy.add(key);
  if (loading) send('notice', { text: loading, kind: 'info' });
  try {
    const got = await scrape(BrowserWindow, url);
    fs.writeFileSync(userFile(cache), JSON.stringify(got));
    done(got);
    return got;
  } catch (e) {
    send('notice', { text: fail + ': ' + e.message, kind: 'error' });
    return cur;
  } finally { busy.delete(key); dataInfo(); }
}
const refreshLoot = (force) => refreshSheet(force, {
  key: 'loot', cur: loot, version: LOOT_VERSION, scrape: scrapeMaxroll, url: settings.maxrollUrl, cache: 'maxroll-cache.json',
  loading: 'Loading boss loot from maxroll.gg …', fail: 'Maxroll import failed',
  done: (l) => {
    loot = l;
    send('loot', loot);
    send('farm-ready');                     // the drop sources come from this sheet
    send('notice', { text: 'Boss loot updated (' + loot.sections.length + ' sections)', kind: 'ok' });
  },
});
const refreshCraft = (force) => refreshSheet(force, {
  key: 'craft', cur: craft, version: CRAFT_VERSION, scrape: scrapeCrafting, url: settings.craftingUrl, cache: 'crafting-cache.json',
  fail: 'Crafting import failed',
  done: (c) => { craft = c; send('craft', craft); dlog('Crafting loaded:', craft.tables.length, 'tables'); },
});

async function refreshAll(force) {
  items.refresh(net, force)
    .then((r) => { dlog('Item database:', r.count, r.updated ? '(reloaded)' : '(current)'); if (r.updated) send('items-ready'); dataInfo(); })
    .catch((e) => dlog('Item database failed:', e.message));
  d4g.refresh(net, force, dlog)
    .then((r) => { dlog('d4guides extras:', r.count); if (r.updated) send('items-ready'); })
    .catch((e) => dlog('d4guides failed:', e.message));
  acts.refresh(net, force, dlog)
    .then(() => { send('activities', acts.all()); dataInfo(); })
    .catch((e) => dlog('Activities failed:', e.message));
  farm.refresh(net, force, dlog, () => send('farm-ready'))
    .then((r) => { dlog('Farm list:', r.count, r.updated ? '(reloaded)' : '(current)'); if (r.updated) send('farm-ready'); dataInfo(); })
    .catch((e) => dlog('Farm list failed:', e.message));
  mythics.refresh(net, force, dlog)
    .then((r) => { if (r.updated) send('items-ready'); dataInfo(); })
    .catch((e) => dlog('Iconic mythics failed:', e.message));
  await refreshLoot(force);
  await refreshCraft(force);
}

// ---------- IPC ----------
ipcMain.handle('settings:get', () => settings);
const CLICK_KEYS = ['clickSpam', 'clickLeftBind', 'clickRightBind', 'clickCps', 'lockOn', 'lockKeys', 'lockBind',
  'd4WindowTitle', 'd4Path'];
ipcMain.handle('app:features', () => ({ macros: MACROS.any, clickSpam: MACROS.clickSpam, lock: MACROS.lock }));
ipcMain.handle('settings:save', (_e, patch) => {
  const before = JSON.stringify([settings.d4Path, settings.tradeUrl]);
  const clickBefore = JSON.stringify(CLICK_KEYS.map((k) => settings[k]));
  settings = { ...settings, ...patch };
  checkCentre();
  saveSettingsFile();
  const errors = registerHotkeys();
  if (JSON.stringify([settings.d4Path, settings.tradeUrl]) !== before) {
    restartWatcher();
    trade.startTimer(() => settings, onTimer);
  }
  if (JSON.stringify(CLICK_KEYS.map((k) => settings[k])) !== clickBefore) restartClicker();
  if (overlay && !overlay.isDestroyed()) overlay.setOpacity(Number(settings.opacity) || 1);
  applyZoom();
  if (lastState) onWindowState(lastState);
  return { settings, errors };
});

ipcMain.handle('loot:get', () => loot);
ipcMain.handle('craft:get', () => craft);
ipcMain.handle('activities:get', () => acts.all());
ipcMain.handle('runewords:get', () => d4g.byLabel('Runeword'));
ipcMain.handle('data:refresh', () => refreshAll(true));

// Every picture by name (lib/icons.js) – built again only when one of its sources changed
let iconMap = { key: '', map: {} };
function iconsNow() {
  const d2 = d2db.cached();
  const cat = farm.catalog(loot, craft);
  const key = [items.count(), items.age(), d4g.count(), d4g.age(), cat.items.length, cat.aspects.length, d2 ? d2.fetchedAt : 0].join('|');
  if (iconMap.key !== key) {
    iconMap = { key, map: icons.build({ catalog: cat.items, aspects: cat.aspects, guides: d4g.all(), items: items.all(), d2: (d2 && d2.icons) || {}, glyphs: items.glyphIcons() }) };
  }
  return iconMap.map;
}
ipcMain.handle('icons:get', () => iconsNow());

// Search across both sources: maxroll supplies power/level/description (local, instant),
// d4guides supplies icon, rarity, category and the detail page.
ipcMain.handle('items:search', async (_e, q) => {
  const { term, kinds } = S.parseQuery(String(q || ''));
  const out = [], seen = new Set();
  const hayOf = (e) => [e.type, e.rarity, e.cat, e.catLabel, e.url, e.set].filter(Boolean).join(' ');
  const useful = (fields, hasPower) => (fields || []).filter((x) =>
    !/rarity/i.test(x.label) && !/^([-–—]|n\/a)$/i.test(x.value.trim()) && !(hasPower && /effect/i.test(x.label)));
  const pickRarity = (g) => { const f = (g.fields || []).find((x) => /rarity/i.test(x.label)); return f ? f.value : ''; };

  // One entry for the overlay: game data + d4guides extras + (for mythics) how to obtain it.
  const decorate = (it, g) => {
    const e = Object.assign({}, it, g ? {
      icon: g.icon || it.icon, url: g.url,
      fields: useful(g.fields, !!it.power),
      rarity: it.rarity || g.rarity || pickRarity(g),
    } : {});
    const my = mythics.info(e.name, e.rarity);
    if (my) Object.assign(e, { rarity: my.label, obtain: my.obtain, obtainNote: my.note, iconic: my.iconic });
    return e;
  };

  if (!S.showItems(kinds)) return [];

  // "iconic" (or "iconic mythic") without a name: the complete list from maxroll's equipment page
  if (!term && kinds.indexOf('iconic') >= 0) {
    const rest = kinds.filter((k) => k !== 'iconic' && k !== 'mythic' && k !== 'unique' && k !== 'item');
    for (const name of mythics.names()) {
      const e = decorate(items.get(name) || { name, type: '', rarity: 'Mythic Unique', level: 0, power: '', effects: [], desc: '', set: '' }, d4g.get(name));
      if (S.matchesKinds(hayOf(e), rest)) out.push(e);
    }
    return out;
  }

  const guides = await d4g.searchLive(net, term, 'en').catch(() => []);
  const gByName = new Map(guides.map((g) => [g.n, g]));

  for (const it of items.search(term, 25)) {
    const key = items.norm(it.name);
    const e = decorate(it, gByName.get(key) || d4g.get(it.name));
    if (!S.matchesKinds(hayOf(e), kinds)) continue;
    seen.add(key);
    out.push(e);
  }
  for (const g of guides) {
    if (seen.has(g.n)) continue;
    const e = decorate({
      name: g.name, type: g.catLabel, rarity: g.rarity || pickRarity(g),
      level: 0, power: '', effects: [], desc: '', set: '',
    }, g);
    if (!S.matchesKinds(hayOf(e), kinds)) continue;
    seen.add(g.n);
    out.push(e);
  }
  // Exact name first, across both sources
  const qn = items.norm(term);
  const rank = (e) => { const n = items.norm(e.name); return n === qn ? 0 : n.startsWith(qn) ? 1 : 2; };
  out.sort((a, b) => rank(a) - rank(b));
  return out.slice(0, 25);   // the overlay shows everything, no "N more"
});

ipcMain.handle('trade:open', async (_e, name) => {
  try { return await trade.openTrade(String(name || ''), settings); }
  catch (e) { send('notice', { text: 'diablo.trade: ' + e.message, kind: 'error' }); return null; }
});
ipcMain.handle('d4:pick', async () => {
  const r = await withDialog(() => dialog.showOpenDialog(overlay, { properties: ['openFile'], filters: [{ name: 'Programs', extensions: ['exe'] }] }));
  return r.canceled ? null : r.filePaths[0];
});
/** Starts the game (or its launcher) – shell.openPath answers with an error text, empty when it worked. */
async function launchD4() {
  const err = await shell.openPath(settings.d4Path || '');
  dlog('Start Diablo IV:', settings.d4Path, err ? '– ' + err : 'ok');
  if (err) send('notice', { text: 'Diablo IV did not start: ' + err + ' — check the path in Settings › Data', kind: 'error' });
  return err;
}
ipcMain.handle('d4:launch', () => launchD4());
ipcMain.handle('userscript:copy', () => { clipboard.writeText(userscript); return true; });
ipcMain.on('clipboard:write', (_e, t) => clipboard.writeText(String(t || '')));
ipcMain.on('data:open-dir', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('map:restore', () => views.withMap((wc) => mapstore.restore(wc, true)));

// ---------- farm list & builds ----------
ipcMain.handle('farm:get', () => farm.catalog(loot, craft));
ipcMain.handle('farm:tooltip', (_e, type, id) => farm.tooltip(net, String(type || ''), String(id || '')));
ipcMain.handle('farm:css', () => farm.tooltipCss());
ipcMain.handle('builds:get', () => builds.load());
// the game data the builder keeps: names of class mechanics and mercenaries, the uniques' own affixes
const builderData = () => builder.current() || builder.load(net, () => d2db.currentBuild(net), dlog);
// A build link (maxroll guide / planner, d4builds.gg, infinitybuilds.gg, d2core.com) -> its variants, ready to be added as builds
ipcMain.handle('builds:link', async (_e, url) => {
  try { return await buildimport.load(net, String(url || ''), farm.catalog(loot, craft), dlog, builderData); }
  catch (e) { dlog('build import failed:', e.message); return { error: e.message }; }
});
ipcMain.handle('builds:save', (_e, d) => builds.save(d));
// What the guide's authors say about a build – breakpoints, rotation, why it works (lib/guideinfo.js):
// its own guide by its link, else the guides of its main skill
ipcMain.handle('builds:sheet', (_e, q) => {
  const o = q || {};
  const own = o.url ? guideinfo.sheetFor(String(o.url)) : null;
  if (own) return Object.assign(own, { own: true });
  const other = guideinfo.sheetsForSkill(String(o.cls || ''), String(o.skill || ''))[0];
  return other ? Object.assign(other, { own: false }) : null;
});
// Skill tree and paragon boards for the build views – d2core's database, fetched on first use
ipcMain.handle('builds:tree', async (_e, cls) => {
  try { return d2db.treeFor(await d2db.load(net, dlog), String(cls || '')); } catch (e) { return { error: e.message }; }
});
ipcMain.handle('builds:paragon', async (_e, keys) => {
  try { return d2db.paragonFor(await d2db.load(net, dlog), Array.isArray(keys) ? keys.map(String).slice(0, 14) : []); }
  catch (e) { return { error: e.message }; }
});
// The build's page on its site, in the default browser – only the build sites
ipcMain.handle('builds:open-source', (_e, url) => {
  const u = String(url || '');
  if (!/^https:\/\/(www\.)?(maxroll\.gg|d4builds\.gg|infinitybuilds\.gg|d2core\.com)\//i.test(u)) return false;
  shell.openExternal(u);
  return true;
});
ipcMain.handle('builds:code', (_e, b) => { const c = builds.toCode(b); clipboard.writeText(c); return c; });
// Text (a build code or JSON) -> builds added to the saved ones
function importBuilds(text) {
  const got = builds.parseImport(text);
  return { added: got.length, data: got.length ? builds.save(builds.merge(builds.load(), got)) : builds.load() };
}
ipcMain.handle('builds:import-text', (_e, text) => importBuilds(text));

// ---------- builder: pick a class and a skill, get a build – lib/builder.js, lib/builderipc.js ----------
const builderApi = builderipc.create({ net, log: (...a) => dlog(...a), catalog: () => farm.catalog(loot, craft), importBuilds });
ipcMain.handle('builder:catalog', () => builderApi.catalog());
ipcMain.handle('builder:plan', (_e, cls, key, opts) => builderApi.plan(String(cls || ''), String(key || ''), opts || {}));
ipcMain.handle('builder:proven', (_e, cls, key) => builderApi.proven(String(cls || ''), String(key || '')));
ipcMain.handle('builder:save', (_e, cls, key, picks) => builderApi.save(String(cls || ''), String(key || ''), picks || {}));
ipcMain.handle('builder:preview', (_e, cls, key, picks) => builderApi.preview(String(cls || ''), String(key || ''), picks || {}));
ipcMain.handle('builds:export', async () => {
  const r = await withDialog(() => dialog.showSaveDialog(overlay, {
    defaultPath: path.join(app.getPath('documents'), 'd4-builds.json'),
    filters: [{ name: 'Builds', extensions: ['json'] }],
  }));
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, JSON.stringify(builds.load(), null, 1));
  return r.filePath;
});
ipcMain.handle('builds:import-file', async () => {
  const r = await withDialog(() => dialog.showOpenDialog(overlay, { properties: ['openFile'], filters: [{ name: 'Builds', extensions: ['json', 'txt'] }] }));
  if (r.canceled || !r.filePaths[0]) return null;
  let text = '';
  try { text = fs.readFileSync(r.filePaths[0], 'utf8'); } catch (_) { /* unreadable: nothing added */ }
  return importBuilds(text);
});

ipcMain.on('overlay:resize', (_e, barW, h, open, hold) => applySize(barW, h, !!open, !!hold));
ipcMain.on('overlay:idle', (_e, on) => setIdleState(!!on));
ipcMain.on('overlay:panel-size', (_e, size) => {
  if (!size || !size.w) { settings.panelSize = null; }
  else {
    settings.panelSize = { w: Math.max(PANEL_MIN.w, Math.round(size.w)), h: Math.max(PANEL_MIN.h, Math.round(size.h)) };
  }
  saveSettingsFile();
  applySize(strip.w, strip.h, true);
});
// Dragging the panel's corner: the top left stays, the corner follows the cursor (read here, in
// screen pixels – the renderer's own coordinates move with the window).
let sizeDrag = null;
ipcMain.on('overlay:resize-drag', (_e, phase) => {
  if (!overlay || overlay.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = overlay.getBounds();
  if (phase === 'start') { sizeDrag = { ox: b.x + b.width - p.x, oy: b.y + b.height - p.y }; return; }
  if (!sizeDrag) return;
  if (phase === 'end') { sizeDrag = null; saveSettingsFile(); return; }
  const z = curZoom || 1;
  const wa = screen.getDisplayMatching(b).workArea;
  const w = Math.min(p.x + sizeDrag.ox - b.x, wa.x + wa.width - b.x);
  const h = Math.min(p.y + sizeDrag.oy - b.y, wa.y + wa.height - b.y);
  settings.panelSize = { w: Math.max(PANEL_MIN.w, Math.round(w / z)), h: Math.max(PANEL_MIN.h, Math.round(h / z)) };
  applySize(strip.w, strip.h, true);
});
let hoverWatch = null, hoverIn = null;
ipcMain.on('overlay:hover-watch', (_e, on) => {
  clearInterval(hoverWatch); hoverWatch = null; hoverIn = null;
  if (!on) return;
  hoverWatch = setInterval(() => {
    if (!overlay || overlay.isDestroyed() || !overlay.isVisible()) return;
    const p = screen.getCursorScreenPoint(), b = overlay.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    if (inside !== hoverIn) { hoverIn = inside; send('cursor-inside', inside); }
  }, 120);
});
ipcMain.on('overlay:opacity', (_e, v) => {
  if (overlay && !overlay.isDestroyed()) overlay.setOpacity(Math.max(0.3, Math.min(1, Number(v) || 1)));
});
ipcMain.on('status:refresh', () => {
  dataInfo();
  sendAuthInfo();
  send('chat-unread', lastUnread);
});
ipcMain.on('app:quit', () => app.quit());
ipcMain.on('hotkey:capture', (_e, on) => {
  capturing = !!on;
  const errs = registerHotkeys();
  if (!capturing) errs.forEach((t) => send('notice', { text: t, kind: 'error' }));
});

ipcMain.on('view:show', (_e, kind, url, heading) => {
  if (!overlay) return;
  views.show(overlay, kind, url, typeof heading === 'string' ? heading.slice(0, 200) : null);
  // one diablo.trade button: opening it counts as having seen the chat (one click away there)
  if (kind === 'chat' || kind === 'listings') markChatSeen();
});
ipcMain.on('view:bounds', (_e, r) => {
  if (!r) return;
  views.setBounds({ x: r.x * curZoom, y: r.y * curZoom, width: r.width * curZoom, height: r.height * curZoom });
});
ipcMain.on('view:hide', () => { views.hide(); setKeyboard('view', false); });

ipcMain.handle('auth:status', () => auth.status());
ipcMain.handle('auth:import', async (_e, text) => {
  const n = await auth.importCookies(text);
  if (n) { views.reload(); trade.reloadTimer(); }
  return { imported: n, status: await auth.status() };
});
ipcMain.handle('auth:logout', async () => { await auth.logout(); views.reload(); trade.reloadTimer(); return auth.status(); });

// ---------- tray & updates ----------
function setHiddenByHand(on) {
  hiddenByHand = !!on;
  dlog(on ? 'Hidden from the tray' : 'Shown from the tray');
  if (!overlay || overlay.isDestroyed()) return;
  if (on) overlay.hide();
  else { overlay.showInactive(); if (lastState) onWindowState(lastState); }
}
function openFromTray(name) {
  hiddenByHand = false;
  if (!overlay || overlay.isDestroyed()) return;
  setKeyboard('ui', true);                   // opened from the tray: the game is not in front anyway
  send('open-section', name);
  tray.refresh();
}
let lastUpdate = null;
/** Asks GitHub; on a newer version the overlay shows it (Settings › Data and a dot on Settings). */
async function checkUpdates(byHand) {
  lastUpdate = await updates.check(net, VERSION);
  settings.updateCheckedAt = Date.now();
  saveSettingsFile();
  dlog('Update check:', lastUpdate.error ? 'failed – ' + lastUpdate.error : lastUpdate.newer ? lastUpdate.latest + ' available' : 'up to date');
  send('update-info', lastUpdate);
  if (byHand) {
    send('notice', lastUpdate.error ? { text: 'Update check: ' + lastUpdate.error, kind: 'error' }
      : lastUpdate.newer ? { text: 'Version ' + lastUpdate.latest + ' is out — Settings › Data has the link.', kind: 'ok' }
        : { text: 'D4 Overlay ' + lastUpdate.current + ' is up to date.', kind: 'ok' });
  }
  return lastUpdate;
}
ipcMain.handle('updates:check', () => checkUpdates(false));
ipcMain.handle('updates:last', () => lastUpdate);
ipcMain.handle('app:version', () => VERSION);
ipcMain.on('updates:open', () => {
  const u = lastUpdate && lastUpdate.url;
  shell.openExternal(/^https:\/\/github\.com\//.test(u || '') ? u : updates.PAGE);
});

// ---------- backup ----------
function runBackup(byHand) {
  try {
    saveSettingsFile();                        // what is on screen goes along
    const r = backup.run(app.getPath('userData'), settings.backupDir, { keep: 10 });
    dlog('Backup:', r.dir, r.files.join(', '));
    if (byHand) send('notice', { text: 'Backup saved — ' + r.files.length + ' files in ' + path.basename(r.dir), kind: 'ok' });
    send('backup-done', Date.now());
    return { ok: true, dir: r.dir, at: Date.now() };
  } catch (e) {
    dlog('Backup failed:', e.message);
    send('notice', { text: 'Backup failed: ' + e.message, kind: 'error' });
    return { ok: false, error: e.message };
  }
}
ipcMain.handle('backup:pick', async () => {
  const r = await withDialog(() => dialog.showOpenDialog(overlay, { title: 'Folder for the backups', properties: ['openDirectory', 'createDirectory'] }));
  return r.canceled ? null : r.filePaths[0];
});
ipcMain.handle('backup:run', () => runBackup(true));
ipcMain.handle('backup:last', () => backup.lastAt(settings.backupDir));
ipcMain.on('backup:open', () => { if (settings.backupDir) shell.openPath(settings.backupDir); });

// ---------- world boss timer & chat badge ----------
// Prefer the unread counter from diablo.trade's own endpoint. If it does not report one,
// "newer than last seen" counts as unread so at least the red 1 shows up.
let lastUnread = 0, loggedKeys = false, hadTimer = null;
function onTimer(d) {
  send('world-boss', d);
  // tells apart "page changed" from "overlay does not show it" when the timer stays empty
  if (hadTimer !== (d.secs != null)) { hadTimer = d.secs != null; dlog('World boss timer', hadTimer ? 'read: ' + d.text : 'NOT found on the page'); }
  if (d.keys && !loggedKeys) { loggedKeys = true; dlog('Chat fields:', d.keys); }
  let unread = d.unread || 0;
  if (!unread && d.newest && d.newest > (settings.chatSeenAt || 0)) unread = 1;
  if (unread !== lastUnread) { lastUnread = unread; send('chat-unread', unread); }
}
function markChatSeen() {
  settings.chatSeenAt = Date.now();
  saveSettingsFile();
  lastUnread = 0;
  send('chat-unread', 0);
}

// ---------- start ----------
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.whenReady().then(() => {
    loadSettings();
    loot = loadCache('maxroll-cache.json', loot);
    craft = loadCache('crafting-cache.json', craft);

    items.configure({ cacheFile: userFile('items-cache.json') });
    d4g.configure({ cacheFile: userFile('d4guides-cache.json') });
    acts.configure({ cacheFile: userFile('activities-cache.json') });
    mythics.configure({ cacheFile: userFile('mythics-cache.json') });
    mapstore.configure({ file: userFile('map-progress.json'), log: dlog });
    farm.configure({ cacheFile: userFile('farm-cache.json'), tipFile: userFile('farm-tooltips.json') });
    builds.configure({ file: userFile('builds.json'), log: dlog });
    maxbuild.configure({ namesFile: userFile('maxroll-names.json') });
    zhdict.configure({ file: userFile('zh-dict.json') });
    d2db.configure({ file: userFile('d2core-db.json') });
    // the pictures of gems, runes, splinters, charms and seals come with it – fetched once a week
    d2db.load(net, dlog).then(() => send('icons-ready')).catch(() => {});
    builder.configure({ file: userFile('builder-db.json') });

    views.setLogger(dlog);
    views.setOnEscape(() => send('escape'));
    views.setOnKeyboard(() => setKeyboard('view', true));
    views.setOnLoading((on) => send('view-loading', !!on));
    views.setMapHooks({
      onReady: (wc) => mapstore.restore(wc, false),   // fresh PC: play the file back in
      onLeave: (wc) => mapstore.save(wc),             // leaving the map: write the file
    });

    dlog('Start, data folder =', app.getPath('userData'),
      process.env.PORTABLE_EXECUTABLE_DIR ? '(portable, next to the .exe)' : '(user profile)');

    trade.prepareSession();
    auth.watch(dlog, (names) => {
      send('notice', { text: 'Login saved (' + names.length + ' cookie' + (names.length === 1 ? '' : 's') + ') — kept after a restart.', kind: 'ok' });
      sendAuthInfo();
    });
    auth.persistSession().then((n) => { if (n.length) dlog('Login made permanent at start:', n.join(', ')); });
    sendAuthInfo();

    createOverlay();
    tray.create({ hidden: () => hiddenByHand, setHidden: setHiddenByHand, open: openFromTray, launch: launchD4,
      checkUpdates: () => checkUpdates(true), quit: () => app.quit() });
    // the daily backup, at the start
    if (settings.backupAuto && settings.backupDir && Date.now() - backup.lastAt(settings.backupDir) > 20 * 3600 * 1000) {
      setTimeout(() => runBackup(false), 20000);
    }
    // once a day at most, a little after the start
    if (settings.updateCheck !== false && Date.now() - (settings.updateCheckedAt || 0) > 20 * 3600 * 1000) {
      setTimeout(() => checkUpdates(false), 15000);
    }
    restartWatcher();
    restartClicker();
    registerHotkeys();

    overlay.webContents.once('did-finish-load', () => {
      send('loot', loot);
      send('craft', craft);
      send('activities', acts.all());
      dataInfo();
      refreshAll(false);
    });
    trade.startTimer(() => settings, onTimer);
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    clicker.stop();
    if (stopWatcher) stopWatcher();
    trade.stopTimer();
    tray.destroy();
    saveSettingsFile();
  });
  app.on('window-all-closed', () => app.quit());
}
