'use strict';
// The builds part of the overlay as a website: the farm list and the builder. The page is the
// overlay's own renderer code; what the main process answers over IPC there is answered here
// over HTTP (POST /api/<name> with the arguments as a JSON array) – web/core.js.
// Saved builds and the worked-out builder pages live in Supabase (web/store.js).
//
//   node web/server.js     PORT, SUPABASE_URL, SUPABASE_KEY, SUPABASE_SECRET, DATA_DIR from the environment
const http = require('http');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { API, NEEDS_OWNER, who, refreshFarm, log, DATA, store } = require('./core');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT) || 8080;
const OWNER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---- files ----------------------------------------------------------------------------------
// Only what the page loads: web/, the renderer's scripts, styles and fonts, the two shared models.
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const SHARED = new Set(['/lib/dmgmodel.js', '/lib/optimizer.js']);
const SERVER_ONLY = /[\\/]web[\\/](server|store|core|warm)\.js$/;
function staticFile(p) {
  if (p === '/') p = '/web/index.html';
  if (!(SHARED.has(p) || /^\/(web|renderer)\//.test(p))) return null;
  if (p.startsWith('/web/') && !/\.(html|js|css|svg|png|ico)$/.test(p)) return null;   // not the seed or the SQL
  const f = path.normalize(path.join(ROOT, p));
  if (!f.startsWith(ROOT + path.sep) || SERVER_ONLY.test(f)) return null;
  return TYPES[path.extname(f)] && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null;
}

/** JSON (or text) – packed when the browser takes it: a skill's page is a few hundred KB. */
function send(req, res, code, body, type) {
  const head = { 'content-type': type || 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', vary: 'accept-encoding' };
  if (body.length > 2048 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    head['content-encoding'] = 'gzip';
    res.writeHead(code, head);
    return res.end(zlib.gzipSync(body, { level: 6 }));
  }
  res.writeHead(code, head);
  res.end(body);
}
const MAX_BODY = 2 * 1024 * 1024;

const server = http.createServer((req, res) => {
  let p = '/';
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (_) { return send(req, res, 400, 'Bad path', 'text/plain'); }
  if (req.method === 'GET' && p === '/healthz') return send(req, res, 200, 'ok', 'text/plain');
  if (req.method === 'GET') {
    const f = staticFile(p);
    if (!f) return send(req, res, 404, 'Not found', 'text/plain');
    const type = TYPES[path.extname(f)];
    const head = { 'content-type': type, 'cache-control': /\.woff2$/.test(f) ? 'public, max-age=604800' : 'no-cache', vary: 'accept-encoding' };
    if (/^text\//.test(type) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
      res.writeHead(200, Object.assign(head, { 'content-encoding': 'gzip' }));
      return fs.createReadStream(f).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, head);
    return fs.createReadStream(f).pipe(res);
  }
  const m = req.method === 'POST' && /^\/api\/(\w+)$/.exec(p);
  const fn = m && Object.prototype.hasOwnProperty.call(API, m[1]) ? API[m[1]] : null;
  if (!fn) return send(req, res, 404, JSON.stringify({ error: 'Unknown call' }));
  const dev = String(req.headers['x-owner'] || '');
  if (NEEDS_OWNER.has(m[1]) && !OWNER_RE.test(dev)) return send(req, res, 400, JSON.stringify({ error: 'No device code' }));
  let size = 0;
  const chunks = [];
  req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { send(req, res, 413, JSON.stringify({ error: 'Too large' })); req.destroy(); } else chunks.push(c); });
  req.on('end', async () => {
    if (size > MAX_BODY) return;
    let args = [];
    try { args = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : []; } catch (_) { return send(req, res, 400, JSON.stringify({ error: 'Bad JSON' })); }
    if (!Array.isArray(args)) args = [args];
    try {
      const out = await who.run(dev.toLowerCase(), () => fn(...args));
      send(req, res, 200, JSON.stringify(out === undefined ? null : out));
    } catch (e) {
      log(m[1] + ' failed:', e.message);
      send(req, res, 500, JSON.stringify({ error: e.message }));
    }
  });
});
// a failed fetch somewhere in the background must not take the whole site down
process.on('unhandledRejection', (e) => log('unhandled:', e && e.message ? e.message : String(e)));
server.listen(PORT, () => {
  log('D4 builds on http://localhost:' + PORT, '· data', DATA, '· storage', store.kind(), store.canWrite() ? '(cache writable)' : '(cache read-only)');
  refreshFarm();
});
