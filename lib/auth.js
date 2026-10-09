'use strict';
// Login-Verwaltung für diablo.trade: gemeinsame Session für Overlay-Ansichten (Chat/Listings) und Timer-Fenster.
const { session } = require('electron');
const PARTITION = 'persist:trade';
const ORIGIN = 'https://diablo.trade';
const ses = () => session.fromPartition(PARTITION);

// akzeptiert: "name=value; name2=value2" (Cookie-Header), DevTools-Zeilen (Tab-getrennt) oder JSON-Export (Array)
function parseCookies(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  if (t[0] === '[' || t[0] === '{') {
    try {
      const j = JSON.parse(t);
      return (Array.isArray(j) ? j : [j]).filter((c) => c && c.name).map((c) => ({ name: String(c.name), value: String(c.value == null ? '' : c.value) }));
    } catch (_) { /* weiter als Text */ }
  }
  const out = [];
  for (const line of t.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (line.includes('\t')) {
      const c = line.split('\t');
      if (c[0] && c[1] != null) out.push({ name: c[0].trim(), value: c[1].trim() });
      continue;
    }
    for (const part of line.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out.push({ name: part.slice(0, i).trim(), value: part.slice(i + 1).trim() });
    }
  }
  return out.filter((c) => /^[\w.\-]+$/.test(c.name));
}

async function importCookies(text) {
  const list = parseCookies(text);
  const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
  let n = 0;
  for (const c of list) {
    try {
      await ses().cookies.set({ url: ORIGIN, name: c.name, value: c.value, path: '/', secure: true, httpOnly: true, sameSite: 'lax', expirationDate: exp });
      n++;
    } catch (_) { /* ungültiger Cookie überspringen */ }
  }
  return n;
}

async function status() {
  const cookies = await ses().cookies.get({ url: ORIGIN });
  const sessionLike = cookies.filter((c) => /session|auth|token|sid|jwt/i.test(c.name));
  return { cookies: cookies.length, loggedIn: sessionLike.length > 0 };
}

async function logout() {
  await ses().clearStorageData({ origin: ORIGIN });
}

// ---------- Diagnose ----------
const AUTH_RE = /session|auth|token|sid|jwt|csrf/i;

// Cookie-Namen der Session (mit Hinweis, ob nur bis zum Programmende gültig)
async function snapshot() {
  try {
    const cookies = await ses().cookies.get({ url: ORIGIN });
    if (!cookies.length) return '(keine)';
    return cookies.map((c) => c.name + (c.expirationDate ? '' : '[nur Sitzung]')).join(', ');
  } catch (e) { return '(Fehler: ' + e.message + ')'; }
}

// Login-Cookies ohne Ablaufdatum gelten nur bis zum Programmende. Nach dem Anmelden werden sie
// deshalb unverändert, aber mit 30 Tagen Ablauf neu gesetzt -> der Login überlebt den Neustart.
async function persistSession() {
  const names = [];
  try {
    const cookies = await ses().cookies.get({ url: ORIGIN });
    const exp = Math.floor(Date.now() / 1000) + 30 * 86400;
    for (const c of cookies) {
      if (c.expirationDate || !AUTH_RE.test(c.name)) continue;          // schon dauerhaft oder kein Login-Cookie
      const host = String(c.domain || 'diablo.trade').replace(/^\./, '');
      try {
        await ses().cookies.set({
          url: 'https://' + host + (c.path || '/'),
          name: c.name, value: c.value, path: c.path || '/',
          domain: c.hostOnly ? undefined : c.domain,                    // Host-Cookie bleibt Host-Cookie
          secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite || 'lax',
          expirationDate: exp,
        });
        names.push(c.name);
      } catch (_) { /* einzelner Cookie nicht setzbar */ }
    }
    if (names.length) await ses().cookies.flushStore();
  } catch (_) { /* Session noch nicht bereit */ }
  return names;
}

// Meldet jede Änderung an Login-Cookies samt Ursache ('explicit', 'overwrite', 'expired', 'evicted', 'expired-overwrite')
// und macht neu gesetzte Session-Cookies automatisch dauerhaft.
function watch(log, onPersist) {
  let timer = null;
  try {
    ses().cookies.on('changed', (_e, cookie, cause, removed) => {
      if (!/diablo\.trade$/i.test(String(cookie.domain || '').replace(/^\./, ''))) return;
      if (!AUTH_RE.test(cookie.name)) return;
      log('cookie', removed ? 'ENTFERNT' : 'gesetzt', cookie.name,
        'cause=' + cause,
        'expires=' + (cookie.expirationDate ? new Date(cookie.expirationDate * 1000).toISOString().slice(0, 19) : 'nur Sitzung'),
        'sameSite=' + cookie.sameSite, 'secure=' + cookie.secure, 'httpOnly=' + cookie.httpOnly);
      // Neu gesetztes Sitzungs-Cookie -> gesammelt (debounced) dauerhaft machen; das Neusetzen
      // löst selbst ein 'overwrite' aus, das wegen des dann gesetzten Ablaufs nichts mehr auslöst.
      if (removed || cookie.expirationDate) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const names = await persistSession();
        if (names.length) { log('Login dauerhaft gespeichert:', names.join(', ')); if (onPersist) onPersist(names); }
      }, 1500);
    });
  } catch (e) { log('cookie-watch nicht möglich:', e.message); }
}

module.exports = { importCookies, status, logout, parseCookies, snapshot, watch, persistSession, PARTITION, ORIGIN };
