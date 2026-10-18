'use strict';
// Embedded web pages inside the overlay: diablo.trade (chat, listings, sign-in),
// the maxroll map tool and any guide/database page opened from a card.
// These are the real pages with your own login — answering a message or editing a
// listing works exactly as it does in a browser, just without the ads.
const { WebContentsView, shell } = require('electron');
const { PARTITION } = require('./auth');
const adblock = require('./adblock');
const pagetrim = require('./pagetrim');

const URLS = {
  chat: 'https://diablo.trade/chat',
  listings: 'https://diablo.trade/user/listings',
  signin: 'https://diablo.trade/signin',
  map: 'https://maxroll.gg/d4/map-tool',
};
const ALLOWED_HOSTS = /(^|\.)(diablo\.trade|maxroll\.gg|d4guides\.gg|d4builds\.gg|d2core\.com|discord\.com|google\.com|battle\.net|blizzard\.com|twitch\.tv)$/i;

let view = null;
let kind = null;
let pageUrl = null;      // last page opened via kind "page"
let last = null;         // last bounds – applied again when the view opens
let onEsc = null;
let onKeyboard = null;   // the page was clicked into – it wants the keyboard (main.js setKeyboard)
// The overlay does not take the focus by a click (main.js), so the page says when it is clicked:
// a line on its console the view listens for.
const CLICKED = '__d4ovi:clicked';
let mapHooks = { onReady: null, onLeave: null };
let log = () => {};
let seq = 0;
let zoom = 1;
// A new page loads hidden: the old one (say diablo.trade) must not show while the guide
// comes in. The overlay draws a spinner in the meantime.
let shown = false, loading = false, revealTimer = null;
let heading = null;      // a guide's section to scroll to once it is there
let onLoading = () => {};
function setOnLoading(fn) { onLoading = fn || (() => {}); }
function reveal() {
  if (!loading) return;
  loading = false;
  clearTimeout(revealTimer);
  if (view && shown) view.setVisible(true);
  onLoading(false);
}

function setLogger(fn) { log = fn || (() => {}); }
function setOnEscape(fn) { onEsc = fn; }
function setOnKeyboard(fn) { onKeyboard = fn; }
/** The keyboard into the page – once it has it (main.js setKeyboard). */
function focus() { if (view && shown && !view.webContents.isDestroyed()) view.webContents.focus(); }
function setZoom(z) { zoom = Number(z) || 1; if (view && !view.webContents.isDestroyed()) view.webContents.setZoomFactor(zoom); }
function setMapHooks(h) { mapHooks = Object.assign({ onReady: null, onLeave: null }, h || {}); }

function ensure(win) {
  if (view) return view;
  view = new WebContentsView({ webPreferences: { partition: PARTITION, contextIsolation: true } });
  view.setBackgroundColor('#0b0a09');
  win.contentView.addChildView(view);
  const wc = view.webContents;
  const id = ++seq;
  log('view created #' + id);
  wc.setZoomFactor(zoom);   // embedded pages scale with the screen too

  // Esc inside the embedded page should close the overlay panel too
  wc.on('before-input-event', (_e, input) => {
    if (input.type === 'keyDown' && input.key === 'Escape' && onEsc) onEsc();
  });
  // On the very first open the view is still 0x0 while the page finishes loading, and
  // Chromium paints nothing. So re-apply the last known bounds once it is loaded.
  wc.on('console-message', (_e, _level, msg) => { if (msg === CLICKED && onKeyboard) onKeyboard(); });
  wc.on('did-finish-load', () => {
    adblock.inject(wc);
    wc.executeJavaScript('document.addEventListener("mousedown", () => console.debug(' + JSON.stringify(CLICKED) + '), true)').catch(() => {});
    // e.g. press the map tool's own maximize button – the map is shown once that is done
    pagetrim.apply(wc, kind, log).then(() => { if (kind === 'map') reveal(); });
    if (heading) { pagetrim.scrollToHeading(wc, heading); heading = null; }
    setBounds(last);
    if (kind === 'map' && mapHooks.onReady) Promise.resolve(mapHooks.onReady(wc)).catch(() => {});
  });
  wc.on('did-navigate', (_e, url) => log('#' + id + ' navigated -> ' + url));
  wc.on('dom-ready', () => { if (kind !== 'map') setTimeout(reveal, 120); });
  wc.on('did-fail-load', (_e, code, desc, url, main) => {
    // only the page itself: blocked ads in sub frames are expected, -3 is a redirect that goes on
    if (!main || code === -3) return;
    log('#' + id + ' load failed ' + code + ' ' + desc + ' ' + url);
    reveal();
  });
  wc.on('render-process-gone', (_e, d) => log('#' + id + ' renderer gone: ' + (d && d.reason)));
  wc.setWindowOpenHandler(({ url }) => {
    try {
      if (ALLOWED_HOSTS.test(new URL(url).hostname)) wc.loadURL(url);   // keep OAuth popups inside
      else shell.openExternal(url);
    } catch (_) { /* ignore */ }
    return { action: 'deny' };
  });
  return view;
}

/** Run something with the map page's webContents, if the map is currently loaded. */
function withMap(fn) {
  if (!view || view.webContents.isDestroyed() || kind !== 'map') return 0;
  return fn(view.webContents);
}
/** Write the map progress to disk before the map disappears. */
function saveMapIfOpen() {
  if (kind === 'map' && mapHooks.onLeave) withMap((wc) => Promise.resolve(mapHooks.onLeave(wc)).catch(() => {}));
}

function show(win, k, url, head) {
  const v = ensure(win);
  const wc = v.webContents;
  const target = k === 'page' ? (url || pageUrl) : (URLS[k] || URLS.chat);
  const reload = kind !== k || (k === 'page' && target !== pageUrl);
  if (kind === 'map' && k !== 'map') saveMapIfOpen();      // leaving the map
  if (k === 'page') pageUrl = target;
  log('show ' + k + ' | was ' + kind + ' | reload: ' + reload);
  win.contentView.addChildView(v);                        // bring to front
  shown = true;
  if (last) setBounds(last);
  if (reload && target) {
    kind = k;
    loading = true;
    v.setVisible(false);
    onLoading(true);
    clearTimeout(revealTimer);
    revealTimer = setTimeout(reveal, k === 'map' ? 15000 : 9000);   // slow page: show what is there
    heading = head || null;
    wc.loadURL(target).catch(() => {});
  } else {
    v.setVisible(!loading);
    if (head) pagetrim.scrollToHeading(wc, head);         // the same guide: just jump there
  }
}

function hide() {
  if (!view) return;
  saveMapIfOpen();
  shown = false;
  view.setVisible(false);
}

function setBounds(r) {
  if (!r) return;
  last = r;
  if (!view) return;
  view.setBounds({
    x: Math.round(r.x), y: Math.round(r.y),
    width: Math.max(10, Math.round(r.width)), height: Math.max(10, Math.round(r.height)),
  });
}

function reload() { if (view && !view.webContents.isDestroyed()) view.webContents.reload(); }

function destroy(win) {
  if (!view) return;
  try { win.contentView.removeChildView(view); view.webContents.close(); } catch (_) {}
  view = null; kind = null;
}

module.exports = { setOnLoading, show, hide, setBounds, reload, destroy, setLogger, setOnEscape, setOnKeyboard, focus, setMapHooks, setZoom, withMap, saveMapIfOpen, URLS };
