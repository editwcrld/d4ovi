'use strict';
const { app, BrowserWindow, globalShortcut, ipcMain, screen, dialog, shell, clipboard, net: electronNet } = require('electron');
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
const zhdict = require('./lib/zhdict');
const d2db = require('./lib/d2coredb');
const builder = require('./lib/builder');
const searchipc = require('./lib/searchipc');
const buildsipc = require('./lib/buildsipc');
const windowplace = require('./lib/windowplace');
const clicker = require('./lib/clicker');
const features = require('./lib/features');
const Settings = require('./lib/settings');
const tray = require('./lib/tray');
const updates = require('./lib/updates');
const backup = require('./lib/backup');
// every request of every module: a site that does not answer fails after a while (lib/netfetch.js)
const net = require('./lib/netfetch').wrap(electronNet);
const VERSION = require('./package.json').version;   // app.getVersion() is Electron's when started from elsewhere
// what this build has: MACROS leaves out the whole tab, the others each macro on its own
const MACROS = {
  clickSpam: !!(features.MACROS && features.CLICK_SPAM),
  lock: !!(features.MACROS && features.LOCK),
};
MACROS.any = MACROS.clickSpam || MACROS.lock;
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
/** The zoom for this screen, applied to the page and the embedded views when it changes. */
function applyZoom(wa) {
  const z = zoomFor(wa);
  if (z !== curZoom && overlay && !overlay.isDestroyed()) {
    curZoom = z;
    overlay.webContents.setZoomFactor(z);
    views.setZoom(z);
    dlog('Zoom =', z, '(screen ' + wa.width + 'x' + wa.height + ', text scale ' + (settings.textScale || 1) + ')');
  }
  return curZoom;
}

let settings = Settings.load({}).settings;
let overlay = null;
let lastState = { title: '', proc: '', pid: 0, running: false };
let stopWatcher = null;
let hideTicks = 0;
let loot = { sections: [], fetchedAt: 0 };
let craft = { tables: [], fetchedAt: 0 };
let capturing = false;                   // a hotkey is being recorded in the settings
let hiddenByHand = false;               // hidden from the tray – stays hidden until shown there again

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

// ---------- window & layout – lib/windowplace.js ----------
const win = windowplace.create({
  settings: () => settings,
  screen: {
    matching: (rect) => screen.getDisplayMatching(rect).workArea,
    primary: () => screen.getPrimaryDisplay().workArea,
    displays: () => screen.getAllDisplays(),
  },
  zoom: applyZoom,
  setBounds: (b) => { if (overlay && !overlay.isDestroyed()) overlay.setBounds(b); },
  layout: (m) => send('layout', m),
  save: () => saveSettingsFile(),
  log: (...a) => dlog(...a),
});

function createOverlay() {
  const pos = win.start();
  overlay = new BrowserWindow({
    width: pos.width, height: pos.height, x: pos.x, y: pos.y,
    frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, show: false, focusable: false,
    alwaysOnTop: true, title: 'D4 Overlay', backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setOpacity(Number(settings.opacity) || 1);
  overlay.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  overlay.on('moved', () => { const [x, y] = overlay.getPosition(); win.moved(x, y); });
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
  reg(settings.hotkeyCounter, () => send('counter-add'), 'Counter');
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
  win.checkCentre();
  saveSettingsFile();
  const errors = registerHotkeys();
  if (JSON.stringify([settings.d4Path, settings.tradeUrl]) !== before) {
    restartWatcher();
    trade.startTimer(() => settings, onTimer);
  }
  if (JSON.stringify(CLICK_KEYS.map((k) => settings[k])) !== clickBefore) restartClicker();
  if (overlay && !overlay.isDestroyed()) overlay.setOpacity(Number(settings.opacity) || 1);
  win.rezoom();                           // the text size may have changed
  if (lastState) onWindowState(lastState);
  return { settings, errors };
});

ipcMain.handle('loot:get', () => loot);
ipcMain.handle('craft:get', () => craft);
ipcMain.handle('activities:get', () => acts.all());
ipcMain.handle('runewords:get', () => d4g.byLabel('Runeword'));
ipcMain.handle('data:refresh', () => refreshAll(true));

// the search and the pictures by name – lib/searchipc.js
searchipc.register(ipcMain, { net, catalog: () => farm.catalog(loot, craft) });

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

// ---------- farm list, builds, builder – lib/buildsipc.js ----------
buildsipc.register(ipcMain, {
  net, log: (...a) => dlog(...a), catalog: () => farm.catalog(loot, craft), clipboard, shell,
  saveDialog: (o) => withDialog(() => dialog.showSaveDialog(overlay, o)),
  openDialog: (o) => withDialog(() => dialog.showOpenDialog(overlay, o)),
  documents: () => app.getPath('documents'),
});

ipcMain.on('overlay:resize', (_e, barW, h, open, hold) => win.applySize(barW, h, !!open, !!hold));
// which way the strip will grow sliding out to this width (CSS px) – asked before, so the page can
// set itself to the window's right side first and hide the move (renderer/strip.js peek)
ipcMain.handle('overlay:slide-plan', (_e, cssW) => win.slidePlan(cssW));
ipcMain.on('overlay:idle', (_e, on) => win.setIdle(!!on));
ipcMain.on('overlay:panel-size', (_e, size) => { win.panelSize(size); saveSettingsFile(); });
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
  const z = win.zoom() || 1;
  const wa = screen.getDisplayMatching(b).workArea;
  const w = Math.min(p.x + sizeDrag.ox - b.x, wa.x + wa.width - b.x);
  const h = Math.min(p.y + sizeDrag.oy - b.y, wa.y + wa.height - b.y);
  win.panelSize({ w: w / z, h: h / z });
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
