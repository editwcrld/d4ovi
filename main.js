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
const zhdict = require('./lib/zhdict');
const d2db = require('./lib/d2coredb');
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
// on 1920x1080 they stay at the base size. The user can nudge it further (text size setting).
function zoomFor(wa) {
  const fromScreen = Math.max(1, Math.min(wa.height / 1080, 1.5));
  const wish = Number(settings.textScale) || 1;
  return Math.round(fromScreen * wish * 100) / 100;
}
let curZoom = 1;
function applyZoom() {
  if (!overlay || overlay.isDestroyed()) return curZoom;
  const wa = screen.getDisplayMatching({ x: barX, y: barY, width: curBarW, height: BAR_HEIGHT }).workArea;
  const z = zoomFor(wa);
  if (z !== curZoom) {
    curZoom = z;
    overlay.webContents.setZoomFactor(z);
    views.setZoom(z);
    dlog('Zoom =', z, '(screen ' + wa.width + 'x' + wa.height + ', text scale ' + (settings.textScale || 1) + ')');
  }
  return curZoom;
}

const BAR_WIDTH = 300;                   // until the overlay reports its real width
const BAR_HEIGHT = 52;

let settings = Settings.load({}).settings;
let overlay = null;
let lastState = { title: '', proc: '', pid: 0, running: false };
let stopWatcher = null;
let hideTicks = 0;
let loot = { sections: [], fetchedAt: 0 };
let craft = { tables: [], fetchedAt: 0 };
// Layout: position of the bar itself plus the direction things open in
let barX = 0, barY = 0, curH = BAR_HEIGHT, curW = BAR_WIDTH, curBarW = BAR_WIDTH, curOffset = 0, flipUp = false;
let capturing = false;                   // a hotkey is being recorded in the settings
let isIdle = false;                      // the overlay reported "nothing open, nothing touched"
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
function restartClicker() {
  const p = clicker.start(settings, gameProcNames()[0], dlog, {
    spam: (on, button) => {
      send('click-spam', { on, button });
      dlog('click spam', on ? button + ' button, ' + Math.round(1000 / clicker.delayFor(settings.clickCps)) + '/s' : 'stopped');
    },
    lock: (on) => { send('lock-state', { on, paused: false }); dlog('lock', on ? 'on' : 'off'); },
    pause: (paused) => { send('lock-state', { on: true, paused }); dlog('lock', paused ? 'waits (left click)' : 'goes on'); },
  }, MACROS);
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
    (e) => send('notice', { text: 'Window detection: ' + e.message, kind: 'error' }));
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
// Two places are remembered: where the shrunk pill sits (by default centred at the top, out of
// the way) and where the bar sits once it is awake (by default at the left edge). Dragging the
// window always writes to the place of the state it is currently in.
const onScreen = (p) => place.onScreen(p, screen.getAllDisplays());

function defaultPlace(idle) {
  const wa = screen.getPrimaryDisplay().workArea;
  return idle
    ? { x: Math.round(wa.x + (wa.width - (curBarW || BAR_WIDTH)) / 2), y: wa.y + 8 }
    : { x: wa.x + 24, y: wa.y + 120 };
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
  dlog(on ? 'Idle: shrunk to the pill' : 'Awake', '→', barX + ',' + barY);
  applySize(curBarW / curZoom, curH / curZoom, false, false);
  saveSettingsFile();
}

/** Idle the bar is a flat pill, so it is placed like the horizontal one. */
const flatBar = () => settings.orientation === 'horizontal' || (isIdle && settings.idleShrink !== false);
/** Where a window of width w starts: centred under a flat bar, else from the bar – kept on screen. */
function windowLeft(w, bw, wa, flat) {
  return flat
    ? Math.max(wa.x, Math.min(Math.round(barX + bw / 2 - w / 2), wa.x + wa.width - w))
    : Math.max(wa.x, Math.min(barX, wa.x + wa.width - w));
}

// The bar keeps its place; only what opens grows. The two orientations behave differently:
//   vertical   – the rail sits on the left, the panel opens to its right. The window simply
//                starts at the bar and is clamped to the screen; the bar follows that clamp.
//   horizontal – the bar sits on top, the panel opens below (or above when there is no room),
//                growing around the bar's centre. The rail is then shifted inside the window.
// Sizes scale with the screen; the overlay measures in CSS pixels, the window needs real ones.
function applySize(barW, h, open, big) {
  if (!overlay || overlay.isDestroyed()) return;
  const wa = screen.getDisplayMatching({ x: barX, y: barY, width: curBarW, height: BAR_HEIGHT }).workArea;
  const z = applyZoom();
  const horizontal = flatBar();
  const f = { small: 0.85, medium: 1, large: 1.2 }[settings.windowSize] || 1;
  const panelW = Math.max(600, Math.min(Math.round(wa.width * (big ? 0.68 : 0.5) * f), big ? 1500 : 1200));
  const maxH = Math.max(380, Math.min(Math.round(wa.height * (big ? 0.8 : 0.62) * f), 1400));

  const bw = Math.max(44, Math.min(Math.round(barW * z), wa.width));
  const bh = Math.max(44, Math.min(Math.round(h * z), wa.height));          // rail height when closed
  // A size the user dragged wins over the automatic one (until they reset it)
  const manual = open && settings.panelSize && settings.panelSize.w > 0 ? settings.panelSize : null;
  const w = open
    ? Math.min(Math.max(manual ? Math.round(manual.w * z) : panelW, bw), wa.width)
    : bw;
  const wantH = open
    ? (manual ? Math.round(manual.h * z) : Math.min(maxH, Math.round(h * z)))
    : bh;
  const hh = Math.max(44, Math.min(wantH, wa.height));

  let x, y, offset = 0, up = false;
  if (horizontal) {
    barX = place.barLeft({ barX, bw, prevBw: curBarW, wa, idle: isIdle, centre: centreIdle, fixed: placeLock > 0 });
    x = windowLeft(w, bw, wa, true);
    offset = barX - x;
    const below = wa.y + wa.height - (barY + BAR_HEIGHT);
    up = (hh - BAR_HEIGHT) > below && (barY - wa.y) > below;
    y = up ? barY + BAR_HEIGHT - hh : barY;
  } else {
    x = windowLeft(w, bw, wa, false);
    y = Math.max(wa.y, Math.min(barY, wa.y + wa.height - hh));
    barX = x; barY = y;                                                     // the bar follows the clamp
  }

  if (placeLock > 0) placeLock--;
  overlay.setBounds({ x, y, width: w, height: hh });
  curH = hh; curW = w; curBarW = bw; curOffset = offset; flipUp = up;
  rememberPlace();
  send('layout', {
    up, offset: Math.round(offset / z),
    maxH: Math.round((manual ? hh : maxH) / z),      // CSS pixels
    manual: !!manual,
    panelW: Math.round((w - (horizontal ? 0 : bw + 8)) / z),
  });
}

function createOverlay() {
  const pos = placeFor(false);
  barX = pos.x; barY = pos.y;
  overlay = new BrowserWindow({
    width: BAR_WIDTH, height: BAR_HEIGHT, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, show: false,
    alwaysOnTop: true, title: 'D4 Overlay', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setOpacity(Number(settings.opacity) || 1);
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.on('moved', () => {
    const [x, y] = overlay.getPosition();
    barX = x + curOffset;
    barY = settings.orientation === 'horizontal' && flipUp ? y + curH - BAR_HEIGHT : y;
    rememberPlace();
    if (isIdle) centreIdle = false;       // dragged by hand -> keep exactly this spot
    saveSettingsFile();
  });
  // a click into the game takes the focus away: the panel closes (or, pinned, fades back)
  overlay.on('blur', () => { if (!inDialog) send('overlay-blur'); });
  overlay.on('focus', () => send('overlay-focus'));
  if (settings.visibility === 'always') overlay.once('ready-to-show', () => overlay.showInactive());
}

// our own file dialogs take the focus too – that is not a click into the game
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
  const front = () => { if (overlay && !overlay.isDestroyed()) { overlay.show(); overlay.focus(); } };
  reg(settings.hotkeySearch, () => { front(); send('focus-search'); }, 'Search');
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
      icon: g.icon, url: g.url,
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
ipcMain.handle('d4:launch', () => shell.openPath(settings.d4Path));
ipcMain.handle('userscript:copy', () => { clipboard.writeText(userscript); return true; });
ipcMain.on('clipboard:write', (_e, t) => clipboard.writeText(String(t || '')));
ipcMain.on('data:open-dir', () => shell.openPath(app.getPath('userData')));
ipcMain.handle('map:restore', () => views.withMap((wc) => mapstore.restore(wc, true)));

// ---------- farm list & builds ----------
ipcMain.handle('farm:get', () => farm.catalog(loot, craft));
ipcMain.handle('farm:tooltip', (_e, type, id) => farm.tooltip(net, String(type || ''), String(id || '')));
ipcMain.handle('farm:css', () => farm.tooltipCss());
ipcMain.handle('builds:get', () => builds.load());
// A build link (maxroll guide / planner, d4builds.gg, infinitybuilds.gg, d2core.com) -> its variants, ready to be added as builds
ipcMain.handle('builds:link', async (_e, url) => {
  try { return await buildimport.load(net, String(url || ''), farm.catalog(loot, craft), dlog); }
  catch (e) { dlog('build import failed:', e.message); return { error: e.message }; }
});
ipcMain.handle('builds:save', (_e, d) => builds.save(d));
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

ipcMain.on('overlay:resize', (_e, barW, h, open, big) => applySize(barW, h, open, big));
ipcMain.on('overlay:idle', (_e, on) => setIdleState(!!on));
ipcMain.on('overlay:panel-size', (_e, size) => {
  if (!size || !size.w) { settings.panelSize = null; }
  else {
    settings.panelSize = { w: Math.max(360, Math.round(size.w)), h: Math.max(220, Math.round(size.h)) };
  }
  saveSettingsFile();
  applySize(curBarW / curZoom, curH / curZoom, true, size && size.big);
});
// Dragging the panel's corner. The cursor is read here, in screen pixels: the window itself
// moves while it grows (a horizontal bar keeps the panel centred under it), so the
// renderer's own mouse coordinates would drift. The size is solved so the corner stays
// under the mouse.
let sizeDrag = null;
ipcMain.on('overlay:resize-drag', (_e, phase, big) => {
  if (!overlay || overlay.isDestroyed()) return;
  const p = screen.getCursorScreenPoint();
  const b = overlay.getBounds();
  if (phase === 'start') {
    sizeDrag = { ox: b.x + b.width - p.x, oy: b.y + b.height - p.y, y0: p.y, h0: b.height, up: flipUp, big: !!big };
    return;
  }
  if (!sizeDrag) return;
  if (phase === 'end') { sizeDrag = null; saveSettingsFile(); return; }
  const z = curZoom || 1;
  const wa = screen.getDisplayMatching(b).workArea;
  const flat = flatBar();
  const minW = Math.round(360 * z), minH = Math.round(220 * z);
  // where the right edge ends up for a width – the same placement as applySize
  const rightOf = (w) => windowLeft(w, curBarW, wa, flat) + w;
  const right = p.x + sizeDrag.ox;
  let lo = minW, hi = wa.width;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (rightOf(m) <= right) lo = m; else hi = m; }
  const h = sizeDrag.up
    ? sizeDrag.h0 + (p.y - sizeDrag.y0)                     // opened upwards: the bottom is fixed to the bar
    : p.y + sizeDrag.oy - b.y;
  settings.panelSize = { w: Math.round(lo / z), h: Math.round(Math.max(minH, Math.min(h, wa.height)) / z) };
  applySize(curBarW / curZoom, curH / curZoom, true, sizeDrag.big);
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
ipcMain.on('view:hide', () => views.hide());

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
  overlay.show(); overlay.focus();
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

// ---------- backup & notes export ----------
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
// the notes as a text file (Markdown, so the checklist stays a checklist)
ipcMain.handle('notes:save-file', async (_e, text, name) => {
  const r = await withDialog(() => dialog.showSaveDialog(overlay, {
    defaultPath: path.join(app.getPath('documents'), String(name || 'd4-notes').replace(/[\\/:*?"<>|]+/g, '-') + '.md'),
    filters: [{ name: 'Notes', extensions: ['md', 'txt'] }],
  }));
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, String(text || ''));
  return r.filePath;
});

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

    views.setLogger(dlog);
    views.setOnEscape(() => send('escape'));
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
    tray.create({ hidden: () => hiddenByHand, setHidden: setHiddenByHand, open: openFromTray,
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
