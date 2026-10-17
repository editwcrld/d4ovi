'use strict';
// Saved builds of the website, one row per device code, in Supabase (web/supabase.sql).
// The table itself is closed to the publishable key – only the two functions get_builds and
// save_builds reach it, each for one code. Without SUPABASE_URL / SUPABASE_KEY (local testing)
// they stay in memory.
//
// Next to them the worked-out builder pages (proven builds + own build per skill): read with the
// publishable key (get_cache), written only with the secret key (SUPABASE_SECRET) – by the
// server after working one out, and by web/warm.js every night.
const builds = require('../lib/builds');

const URL_ = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
const KEY = String(process.env.SUPABASE_KEY || '');
const SECRET = String(process.env.SUPABASE_SECRET || '');
const mem = new Map();

async function rpc(fn, body) {
  const r = await fetch(URL_ + '/rest/v1/rpc/' + fn, {
    method: 'POST',
    headers: { apikey: KEY, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  if (!r.ok) throw new Error('Supabase ' + fn + ': HTTP ' + r.status + ' ' + text.slice(0, 200));
  return text ? JSON.parse(text) : null;
}

/** The builds of one device code – empty when there are none yet. */
async function get(owner) {
  const d = URL_ && KEY ? await rpc('get_builds', { p_owner: owner }) : mem.get(owner);
  return d ? builds.clean(d) : builds.empty();
}

/** Writes them (cleaned) and hands back what was written. */
async function save(owner, d) {
  const out = Object.assign({ savedAt: new Date().toISOString() }, builds.clean(d));
  if (URL_ && KEY) await rpc('save_builds', { p_owner: owner, p_data: out });
  else mem.set(owner, out);
  return builds.clean(out);
}

/** A worked-out page by its key, or null. */
async function cacheGet(key) {
  if (!URL_ || !KEY) return null;
  return rpc('get_cache', { p_key: key });
}

/** Keeps one – only with the secret key; without it the server keeps it in memory only. */
async function cachePut(key, data) {
  if (!URL_ || !SECRET) return false;
  const r = await fetch(URL_ + '/rest/v1/web_cache?on_conflict=key', {
    method: 'POST',
    headers: { apikey: SECRET, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ key, data, at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error('Supabase cache: HTTP ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return true;
}
const canWrite = () => !!(URL_ && SECRET);

const kind = () => (URL_ && KEY ? 'Supabase ' + URL_ : 'memory (no SUPABASE_URL / SUPABASE_KEY)');

module.exports = { get, save, cacheGet, cachePut, canWrite, kind };
