'use strict';
// The builds part of the overlay as a website: the farm list and the builder, served by plain
// Node (no Electron). The page is the overlay's own renderer code; what the main process answers
// over IPC there is answered here over HTTP (POST /api/<name> with the arguments as a JSON array).
// Saved builds live in Supabase, one row per device code (web/store.js).
//
//   node web/server.js            PORT, SUPABASE_URL, SUPABASE_KEY, DATA_DIR from the environment
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { AsyncLocalStorage } = require('async_hooks');

const ROOT = path.join(__dirname, '..');
const lib = (n) => require(path.join(ROOT, 'lib', n));
const farm = lib('farm'), builds = lib('builds'), buildimport = lib('buildimport'), guideinfo = lib('guideinfo');
const maxbuild = lib('maxbuild'), zhdict = lib('zhdict'), d2db = lib('d2coredb'), builder = lib('builder'), builderipc = lib('builderipc');
const store = require('./store');

const PORT = Number(process.env.PORT) || 8080;
const DATA = process.env.DATA_DIR || path.join(os.tmpdir(), 'd4web');
const SEED = path.join(__dirname, 'seed');
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
farm.refresh(net, false, log)
  .then((r) => log('Farm list:', r.count, r.updated ? '(reloaded)' : '(current)'))
  .catch((e) => log('Farm list failed:', e.message));

// ---- the calls ------------------------------------------------------------------------------
const who = new AsyncLocalStorage();               // the device code of the request being answered
const owner = () => who.getStore();
const catalog = () => farm.catalog(loot, craft);
const builderData = () => builder.current() || builder.load(net, () => d2db.currentBuild(net), log);

async function importBuilds(text) {
  const got = builds.parseImport(text);
  if (!got.length) return { added: 0, data: builds.clean(await store.get(owner())) };
  return { added: got.length, data: await store.save(owner(), builds.merge(await store.get(owner()), got)) };
}
const builderApi = builderipc.create({ net, log, catalog, importBuilds });

const API = {
  getFarm: catalog,
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
  builderPlan: (cls, key, opts) => builderApi.plan(String(cls || ''), String(key || ''), opts || {}),
  builderProven: (cls, key) => builderApi.proven(String(cls || ''), String(key || '')),
  builderSave: (cls, key, picks) => builderApi.save(String(cls || ''), String(key || ''), picks || {}),
  builderPreview: (cls, key, picks) => builderApi.preview(String(cls || ''), String(key || ''), picks || {}),
};
const NEEDS_OWNER = new Set(['getBuilds', 'saveBuilds', 'importBuildText', 'builderSave']);
const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- files ----------------------------------------------------------------------------------
// Only what the page loads: web/, the renderer's scripts, styles and fonts, the two shared models.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SHARED = new Set(['/lib/dmgmodel.js', '/lib/optimizer.js']);
function staticFile(p) {
  if (p === '/') p = '/web/index.html';
  if (!(SHARED.has(p) || /^\/(web|renderer)\//.test(p))) return null;
  if (p.startsWith('/web/') && !/\.(html|js|css|svg|png|ico)$/.test(p)) return null;   // not the server, the seed or the SQL
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT + path.sep) || /[\\/]web[\\/](server|store)\.js$/.test(f)) return null;
  return TYPES[path.extname(f)] && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}

function send(res, code, body, type) {
  res.writeHead(code, { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(body);
}
const MAX_BODY = 2 * 1024 * 1024;

const server = http.createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (req.method === 'GET' && p === '/healthz') return send(res, 200, 'ok', 'text/plain');
  if (req.method === 'GET') {
    const f = staticFile(p);
    if (!f) return send(res, 404, 'Not found', 'text/plain');
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)], 'cache-control': /\.woff2$/.test(f) ? 'public, max-age=604800' : 'no-cache' });
    return fs.createReadStream(f).pipe(res);
  }
  const m = req.method === 'POST' && /^\/api\/(\w+)$/.exec(p);
  const fn = m && Object.prototype.hasOwnProperty.call(API, m[1]) ? API[m[1]] : null;
  if (!fn) return send(res, 404, JSON.stringify({ error: 'Unknown call' }));
  const dev = String(req.headers['x-owner'] || '');
  if (NEEDS_OWNER.has(m[1]) && !OWNER_RE.test(dev)) return send(res, 400, JSON.stringify({ error: 'No device code' }));
  let size = 0;
  const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { send(res, 413, JSON.stringify({ error: 'Too large' })); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    if (size > MAX_BODY) return;
    let args = [];
    try { args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : []; } catch (_) { return send(res, 400, JSON.stringify({ error: 'Bad JSON' })); }
    if (!Array.isArray(args)) args = [args];
    try {
      const out = await who.run(dev.toLowerCase(), () => fn(...args));
      send(res, 200, JSON.stringify(out === undefined ? null : out));
    } catch (e) {
      log(m[1] + ' failed:', e.message);
      send(res, 500, JSON.stringify({ error: e.message }));
    }
  });
});
server.listen(PORT, () => log('D4 builds on http://localhost:' + PORT, '· data', DATA, '· storage', store.kind()));
