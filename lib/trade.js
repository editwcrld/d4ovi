'use strict';
// diablo.trade: (1) the item search in the default browser (or in a window of the app that fills the field in),
//               (2) a hidden window the world boss timer is read from, and the unread chat messages.
const { BrowserWindow, session, app, shell, clipboard, net: electronNet } = require('electron');
// a site that does not answer fails after a while instead of holding the chat check up (lib/netfetch.js)
const net = require('./netfetch').wrap(electronNet);
const { PARTITION } = require('./auth');
const adblock = require('./adblock');

// diablo.trade shows the event bar (world boss, helltide, legion) only to signed out
// visitors – so the hidden window that reads it must NOT carry the login. The chat count
// needs the opposite, and is fetched from the API with the signed in session.
const TIMER_PARTITION = 'wbtimer';            // no "persist:" – in memory, never signed in

let tradeWin = null;
let timerWin = null;
let timerInterval = null;
let timerReloadAt = 0;

function prepareSession() {
  const ses = session.fromPartition(PARTITION);
  const ua = (app.userAgentFallback || '').replace(/\s*Electron\/\S+/i, '').replace(/\s*d4-overlay\/\S+/i, '');
  if (ua) ses.setUserAgent(ua);
  // diablo.trade sends Windows notifications on new messages – the red number on the button is enough.
  const BLOCKED = new Set(['notifications', 'geolocation', 'media', 'midi', 'midiSysex', 'pointerLock', 'idle-detection']);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(!BLOCKED.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => !BLOCKED.has(perm));
  adblock.install(ses);   // ads in every embedded page
}

const originOf = (u) => { try { return new URL(u).origin; } catch (_) { return 'https://diablo.trade'; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The field is in the DOM before React has hydrated: a value set once is thrown away again meanwhile
// (which is why the field was empty on the first open and only the second try worked).
// So: set it, look, set it again – until the value stays twice in a row.
function fillScript(name) {
  return `(async () => {
    const sel = 'input[placeholder="Quick Search"]';
    const want = ${JSON.stringify(name)};
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const set = (el) => {
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, want);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    let el = null;
    for (let i = 0; i < 80 && !el; i++) { el = document.querySelector(sel); if (!el) await sleep(250); }
    if (!el) return false;
    let stable = 0;
    for (let i = 0; i < 24 && stable < 2; i++) {
      const cur = document.querySelector(sel) || el;   // React may swap the element
      if (cur.value === want) stable++; else { stable = 0; set(cur); }
      await sleep(300);
    }
    return stable >= 2;
  })()`;
}

async function openInternal(name, s) {
  const target = s.tradeUrl || 'https://diablo.trade/listings/items';
  if (!tradeWin || tradeWin.isDestroyed()) {
    tradeWin = new BrowserWindow({
      width: 1280, height: 900, title: 'diablo.trade', autoHideMenuBar: true,
      webPreferences: { partition: PARTITION, contextIsolation: true },
    });
    tradeWin.on('closed', () => { tradeWin = null; });
    tradeWin.webContents.on('did-finish-load', () => adblock.inject(tradeWin.webContents));
    await tradeWin.loadURL(target);
  } else {
    if (tradeWin.isMinimized()) tradeWin.restore();
    if (!tradeWin.webContents.getURL().startsWith(originOf(target))) await tradeWin.loadURL(target);
  }
  tradeWin.show();
  tradeWin.focus();
  const ok = await tradeWin.webContents.executeJavaScript(fillScript(name));
  if (ok && s.pressEnter) {
    const wc = tradeWin.webContents;
    await sleep(400);
    wc.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wc.sendInputEvent({ type: 'char', keyCode: '\r' });
    wc.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
  }
  return ok ? 'internal' : 'internal-nofill';
}

// Default browser: the page opens with "#d4q=<name>" (the userscript fills the field) + the name on the clipboard (fallback: Ctrl+V).
async function openBrowser(name, s) {
  const base = String(s.tradeUrl || 'https://diablo.trade/listings/items').split('#')[0];
  clipboard.writeText(name);
  await shell.openExternal(`${base}#d4q=${encodeURIComponent(name)}`);
  return 'browser';
}

async function openTrade(name, s) {
  return s.tradeOpenMode === 'internal' ? openInternal(name, s) : openBrowser(name, s);
}

// Reads the world boss countdown out of the event bar.
const READ_TIMER = `(() => {
  const label = Array.from(document.querySelectorAll('span,div,p')).find(e => e.children.length === 0 && e.textContent.trim().toLowerCase() === 'world boss');
  if (!label) return { timer: null };
  const box = label.parentElement;
  const v = (box && box.querySelector('.tabular-nums')) || label.nextElementSibling;
  return { timer: v ? v.textContent.trim() : null };
})()`;

// Unread messages come from diablo.trade's own endpoint – the same one the site uses.
// No window involved: the cookies of the signed in session are attached by hand, because
// net.fetch does not count as a same-site request and would leave the SameSite=Lax login out.
async function readChat(origin) {
  const out = { unread: 0, newest: 0, convs: 0, keys: null };
  try {
    const ses = session.fromPartition(PARTITION);
    const cookies = await ses.cookies.get({ url: origin });
    if (!cookies.length) return out;                       // not signed in
    const res = await net.fetch(origin + '/api/chat/conversations?take=50', {
      credentials: 'omit',
      headers: { Cookie: cookies.map((c) => c.name + '=' + c.value).join('; ') },
    });
    if (!res.ok) return out;
    const j = await res.json();
    const list = Array.isArray(j) ? j : (j.conversations || []);
    out.convs = list.length;
    if (list.length) out.keys = Object.keys(list[0]).join(',');
    for (const c of list) {
      // Is there a real unread counter? (the field name is undocumented -> look for it)
      for (const k of Object.keys(c)) {
        const v = c[k];
        if (/unread/i.test(k)) {
          if (typeof v === 'number') out.unread += v;
          else if (v === true) out.unread += 1;
        }
      }
      // Remember when the last message arrived – that is how "something new" is spotted
      const stamps = [c.updatedAt, c.lastMessageAt, c.lastActivityAt, c.lastMessage && (c.lastMessage.createdAt || c.lastMessage.sentAt)];
      for (const t of stamps) { const n = t ? Date.parse(t) : 0; if (n > out.newest) out.newest = n; }
    }
  } catch (_) { /* not signed in, offline, … */ }
  return out;
}

function parseTimer(text) {
  const m = String(text || '').match(/(?:(\d+)\s*d\s*)?(\d{1,2}):(\d{2}):(\d{2})/i);
  if (!m) return null;
  return (Number(m[1] || 0) * 86400) + Number(m[2]) * 3600 + Number(m[3]) * 60 + Number(m[4]);
}

// The page is loaded again every 10 minutes, and while it loads there is nothing to read.
// The last reading keeps counting down meanwhile (the overlay counts from secs + at), so the
// timer does not flash "--:--" – but only for a short while and never past the spawn.
const HOLD_MS = 3 * 60 * 1000;
let lastRead = null;
function holdTimer(read, now) {
  now = now || read.at;
  if (read.secs != null) { lastRead = read; return read; }
  if (lastRead && now - lastRead.at < HOLD_MS && now - lastRead.at < lastRead.secs * 1000) return Object.assign({}, lastRead, { held: true });
  return read;
}

function startTimer(getSettings, onUpdate) {
  stopTimer();
  const ensure = async () => {
    const url = originOf(getSettings().tradeUrl);
    if (!timerWin || timerWin.isDestroyed()) {
      adblock.install(session.fromPartition(TIMER_PARTITION));
      timerWin = new BrowserWindow({
        show: false, width: 1280, height: 800,
        webPreferences: { partition: TIMER_PARTITION, backgroundThrottling: false, contextIsolation: true },
      });
      timerReloadAt = Date.now() + 10 * 60 * 1000;
      timerWin.loadURL(url).catch(() => {});
    } else if (Date.now() > timerReloadAt) {
      timerReloadAt = Date.now() + 10 * 60 * 1000;
      timerWin.loadURL(url).catch(() => {});
    }
  };
  const tick = async () => {
    try {
      const origin = originOf(getSettings().tradeUrl);
      await ensure();
      const chat = await readChat(origin);
      let r = null;
      if (timerWin && !timerWin.isDestroyed() && !timerWin.webContents.isLoading()) {
        r = await timerWin.webContents.executeJavaScript(READ_TIMER);
      }
      const read = { text: (r && r.timer) || '', secs: parseTimer(r && r.timer), at: Date.now() };
      onUpdate(Object.assign(holdTimer(read), {
        unread: chat.unread, newest: chat.newest, convs: chat.convs, keys: chat.keys,
      }));
    } catch (_) { /* next attempt in 15 s */ }
  };
  tick();
  timerInterval = setInterval(tick, 15000);
}

function reloadTimer() { timerReloadAt = 0; }

function stopTimer() {
  if (timerInterval) clearInterval(timerInterval);
  timerInterval = null;
  if (timerWin && !timerWin.isDestroyed()) timerWin.destroy();
  timerWin = null;
}

module.exports = { prepareSession, openTrade, startTimer, stopTimer, reloadTimer, readChat, parseTimer, holdTimer, READ_TIMER, TIMER_PARTITION };
