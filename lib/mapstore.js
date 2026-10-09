'use strict';
// Keeping the map tool progress.
//
// The embedded maxroll map tool remembers what you found (altars, side quests,
// waypoints …) by itself – in the page storage, no account needed. That storage lives in
// our data folder, so it already survives a restart.
//
// On top of that we write it to a readable JSON file next to it, for two reasons:
//   1. Moving to another PC: take the file along, done (there is no account).
//   2. A safety net in case the browser data is ever lost.
const fs = require('fs');
const path = require('path');

// Not progress but ads/consent/session noise – kept out of the file.
const SKIP = /consent|cookie|gdpr|ccpa|^ad[-_]|_ga|gtm|amplitude|sentry|tabs-sync|notification-storage/i;

const SNAPSHOT = `(() => {
  const out = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      out[k] = localStorage.getItem(k);
    }
  } catch (e) {}
  return out;
})()`;

const restoreScript = (data) => `(() => {
  const d = ${JSON.stringify(data)};
  let n = 0;
  for (const k of Object.keys(d)) { try { localStorage.setItem(k, d[k]); n++; } catch (e) {} }
  return n;
})()`;

let file = null;
let log = () => {};
let lastWritten = '';

function configure(opts) {
  if (opts && opts.file) file = opts.file;
  if (opts && opts.log) log = opts.log;
}

function read() {
  try {
    const j = JSON.parse(fs.readFileSync(file, 'utf8'));
    return j && typeof j.keys === 'object' ? j : null;
  } catch (_) { return null; }
}

const count = () => { const j = read(); return j ? Object.keys(j.keys).length : 0; };

/** Write the loaded map page storage to the file. */
async function save(wc) {
  if (!wc || wc.isDestroyed() || !file) return 0;
  let all;
  try { all = await wc.executeJavaScript(SNAPSHOT); } catch (_) { return 0; }
  const keys = {};
  for (const k of Object.keys(all || {})) if (!SKIP.test(k)) keys[k] = all[k];
  if (!Object.keys(keys).length) return 0;

  const body = JSON.stringify(keys);
  if (body === lastWritten) return Object.keys(keys).length;   // nothing new
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ savedAt: new Date().toISOString(), keys }, null, 1));
    lastWritten = body;
    log('map progress saved:', Object.keys(keys).length, 'entries');
  } catch (e) { log('could not save map progress:', e.message); }
  return Object.keys(keys).length;
}

/**
 * Play the file back into the page. By default only when nothing is there yet
 * (fresh PC) – otherwise an old state would overwrite the current one.
 * @param {boolean} force true = always restore (the "restore map progress" button)
 */
async function restore(wc, force) {
  if (!wc || wc.isDestroyed() || !file) return 0;
  const saved = read();
  if (!saved || !Object.keys(saved.keys).length) return 0;
  if (!force) {
    let current = {};
    try { current = await wc.executeJavaScript(SNAPSHOT); } catch (_) { return 0; }
    const real = Object.keys(current || {}).filter((k) => !SKIP.test(k));
    if (real.length) return 0;   // this PC already has progress
  }
  let n = 0;
  try { n = await wc.executeJavaScript(restoreScript(saved.keys)); } catch (_) { return 0; }
  log('map progress restored:', n, 'entries from', saved.savedAt);
  return n;
}

module.exports = { configure, save, restore, read, count, SKIP };
