'use strict';
// What the website answers – the overlay's main-process calls for the farm list and the builder,
// without Electron. Used by web/server.js (over HTTP) and web/warm.js (the nightly run that works
// out every skill's page ahead of time).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const ROOT = path.join(__dirname, '..');
const lib = (n) => require(path.join(ROOT, 'lib', n));
const farm = lib('farm'), builds = lib('builds'), buildimport = lib('buildimport'), guideinfo = lib('guideinfo');
const maxbuild = lib('maxbuild'), zhdict = lib('zhdict'), d2db = lib('d2coredb'), builder = lib('builder'), builderipc = lib('builderipc');
const store = require('./store');
const icons = lib('icons');

const DATA = process.env.DATA_DIR || path.join(os.tmpdir(), 'd4web');
const SEED = path.join(__dirname, 'seed');
const PROVEN_MAX = 16;                     // proven builds per skill – the overlay shows 8
const CACHE_VERSION = 1;                   // up when the page's shape changes: older entries are not used
const FRESH = 30 * 3600 * 1000;            // the nightly run renews them; past this they are worked out again
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))));
const net = { fetch: (u, o) => fetch(u, o) };

// ---- data: the caches the overlay keeps in its data folder ----------------------------------
// The disk on Render starts empty after every sleep: the seed (copied from the overlay's data
// folder) spares the first visitor the minutes the farm list and the game data take to fetch.
fs.mkdirSync(DATA, { recursive: true });
for (const f of fs.existsSync(SEED) ? fs.readdirSync(SEED) : []) {
  const to = path.join(DATA, f);
  if (!fs.existsSync(to)) fs.copyFileSync(path.join(SEED, f), to);
}
const file = (n) => path.join(DATA, n);
const read = (n, fallback) => { try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (_) { return fallback; } };
// boss loot and runewords: maxroll's cheat sheets, read by a browser window in the overlay – here only the seed
const loot = read('maxroll-cache.json', { sections: [] });
const craft = read('crafting-cache.json', { tables: [] });

farm.configure({ cacheFile: file('farm-cache.json'), tipFile: file('farm-tooltips.json') });
maxbuild.configure({ namesFile: file('maxroll-names.json') });
zhdict.configure({ file: file('zh-dict.json') });
d2db.configure({ file: file('d2core-db.json') });
builder.configure({ file: file('builder-db.json') });

// ---- the calls ------------------------------------------------------------------------------
const who = new AsyncLocalStorage();               // the device code of the request being answered
const owner = () => who.getStore();
const catalog = () => farm.catalog(loot, craft);
const builderData = () => builder.current() || builder.load(net, () => d2db.currentBuild(net), log);
// every thing's picture by name (lib/icons.js): the farm catalog, aspects by their category, and
// d2core's gems, runes, splinters, charms, seals and sets – built again only when they changed
let iconMap = { key: '', map: {} };
async function iconsNow() {
  try { await d2db.load(net, log); } catch (_) { /* the catalog's pictures still come */ }
  const d2 = d2db.cached(), cat = catalog();
  const key = [cat.items.length, cat.aspects.length, d2 ? d2.fetchedAt : 0].join('|');
  if (iconMap.key !== key) iconMap = { key, map: icons.build({ catalog: cat.items, aspects: cat.aspects, d2: (d2 && d2.icons) || {} }) };
  return iconMap.map;
}

async function importBuilds(text) {
  const got = builds.parseImport(text);
  if (!got.length) return { added: 0, data: builds.clean(await store.get(owner())) };
  return { added: got.length, data: await store.save(owner(), builds.merge(await store.get(owner()), got)) };
}
const builderApi = builderipc.create({ net, log, catalog, importBuilds, provenMax: PROVEN_MAX });

// ---- a skill's page: proven builds + own build, worked out once and kept ---------------------
// memory first, then Supabase (written by the nightly run), else worked out here – one at a time
// per skill, however many ask
const pages = new Map();       // "cls:key" -> { at, out }
const working = new Map();     // "cls:key" -> Promise
const cacheKey = (cls, key) => 'full:v' + CACHE_VERSION + ':' + cls + ':' + key;

/** Works the page out and keeps it everywhere. */
async function work(cls, key) {
  const t0 = Date.now();
  const out = await builderApi.full(cls, key);
  if (out.error || (out.plan && out.plan.error)) return out;
  const st = builderApi.state(cls, key);
  pages.set(cls + ':' + key, { at: Date.now(), out });
  log('worked out', cls, key, '–', out.proven && out.proven.proven ? out.proven.proven.length : 0, 'proven builds,', Date.now() - t0, 'ms');
  // the proven builds are in the state already: kept once
  if (st) await store.cachePut(cacheKey(cls, key), { at: Date.now(), plan: out.plan, state: st }).catch((e) => log('cache write failed:', e.message));
  return out;
}

async function full(cls, key) {
  cls = String(cls || ''); key = String(key || '');
  const id = cls + ':' + key;
  const mem = pages.get(id);
  if (mem && Date.now() - mem.at < FRESH) return mem.out;
  if (working.has(id)) return working.get(id);
  const p = (async () => {
    const c = await store.cacheGet(cacheKey(cls, key)).catch((e) => { log('cache read failed:', e.message); return null; });
    if (c && c.plan && c.state && c.state.out) {
      builderApi.adopt(cls, key, c.state);            // saving a proven build and the own build need it here
      // the own build's plan, worked out while the page is read – "Save as build" and the
      // Skills / Paragon preview then answer at once
      setTimeout(() => builderApi.plan(cls, key, {}).catch(() => {}), 50);
      const out = { plan: c.plan, proven: c.state.out };
      pages.set(id, { at: c.at || Date.now(), out });
      // older than a night: shown as it is, renewed in the background
      if (Date.now() - (c.at || 0) > FRESH && !working.has(id + ':bg')) {
        working.set(id + ':bg', work(cls, key).catch(() => {}).finally(() => working.delete(id + ':bg')));
      }
      return out;
    }
    return work(cls, key);
  })();
  working.set(id, p);
  try { return await p; } finally { working.delete(id); }
}

const API = {
  getFarm: catalog,
  icons: () => iconsNow(),
  farmTooltip: (type, id) => farm.tooltip(net, String(type || ''), String(id || '')),
  farmCss: () => farm.tooltipCss(),
  getBuilds: async () => builds.clean(await store.get(owner())),
  saveBuilds: (d) => store.save(owner(), builds.clean(d)),
  buildCode: (b) => builds.toCode(b),
  importBuildText: (t) => importBuilds(String(t || '')),
  loadBuildLink: async (url) => {
    try { return await buildimport.load(net, String(url || ''), catalog(), log, builderData); } catch (e) { return { error: e.message }; }
  },
  guideSheet: (q) => {
    const o = q || {};
    const own = o.url ? guideinfo.sheetFor(String(o.url)) : null;
    if (own) return Object.assign(own, { own: true });
    const other = guideinfo.sheetsForSkill(String(o.cls || ''), String(o.skill || ''))[0];
    return other ? Object.assign(other, { own: false }) : null;
  },
  buildTree: async (cls) => { try { return d2db.treeFor(await d2db.load(net, log), String(cls || '')); } catch (e) { return { error: e.message }; } },
  buildParagon: async (keys) => {
    try { return d2db.paragonFor(await d2db.load(net, log), Array.isArray(keys) ? keys.map(String).slice(0, 14) : []); } catch (e) { return { error: e.message }; }
  },
  builderCatalog: () => builderApi.catalog(),
  builderFull: async (cls, key) => { try { return await full(cls, key); } catch (e) { log('builderFull failed:', e.message); return { error: e.message }; } },
  builderPlan: (cls, key, opts) => builderApi.plan(String(cls || ''), String(key || ''), opts || {}),
  builderProven: (cls, key) => builderApi.proven(String(cls || ''), String(key || '')),
  // saving a proven build needs its variants here – a fresh start after a sleep takes them from the cache first
  builderSave: async (cls, key, picks) => {
    if (picks && picks.url) await full(cls, key);
    return builderApi.save(String(cls || ''), String(key || ''), picks || {});
  },
  builderPreview: async (cls, key, picks) => {
    await full(cls, key).catch(() => {});
    return builderApi.preview(String(cls || ''), String(key || ''), picks || {});
  },
};
const NEEDS_OWNER = new Set(['getBuilds', 'saveBuilds', 'importBuildText', 'builderSave']);

/** The farm list's data (d4guides), fetched again when older than three days. */
const refreshFarm = () => farm.refresh(net, false, log)
  .then((r) => log('Farm list:', r.count, r.updated ? '(reloaded)' : '(current)'))
  .catch((e) => log('Farm list failed:', e.message));

module.exports = { API, NEEDS_OWNER, who, work, builderApi, refreshFarm, log, DATA, store };
