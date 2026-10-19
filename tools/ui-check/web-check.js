// The website (web/index.html) with the shared renderer files, its API answered by the same bridge
// as the overlay check – screenshots and the layout check (check.js), desktop and phone.
//   npm run web-check
const { app, BrowserWindow, protocol, net } = require('electron');
const path = require('path');
const fs = require('fs');
const check = require('./check.js');
const { ROOT } = require('./data.js');
const { answer } = require('./bridge.js');

const OUT = path.join(__dirname, 'out');
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.json': 'application/json' };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  // http://web.test/ – the site's files from the repo, /api/<name> from the bridge
  protocol.handle('http', async (req) => {
    const u = new URL(req.url);
    if (u.hostname !== 'web.test') return net.fetch(req, { bypassCustomProtocolHandlers: true });
    if (u.pathname.startsWith('/api/')) {
      return new Response(JSON.stringify(answer(u.pathname.slice(5))), { headers: { 'content-type': 'application/json' } });
    }
    const f = path.join(ROOT, u.pathname === '/' ? 'web/index.html' : u.pathname);
    if (!f.startsWith(ROOT) || !fs.existsSync(f)) return new Response('not found', { status: 404 });
    return new Response(fs.readFileSync(f), { headers: { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' } });
  });
  const win = new BrowserWindow({ width: 1280, height: 860, useContentSize: true, show: false, webPreferences: { offscreen: true } });
  let errs = [], failed = 0;
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2 && !/Security|Failed to load resource|net::/.test(msg)) errs.push(msg + ' ' + path.basename(src || '') + ':' + line);
  });
  const js = (s) => win.webContents.executeJavaScript(s).catch((e) => 'ERR ' + e.message);
  for (const [w, h, label] of [[1280, 860, 'desk'], [393, 850, 'phone']]) {
    win.setContentSize(w, h);
    for (const section of ['farm', 'builder']) {
      errs = [];
      await win.loadURL('http://web.test/');
      await wait(700);
      await js(`document.querySelector('#wtabs [data-s="${section}"]').click()`);
      await wait(1200);
      const bad = await js(check('#app.web'));
      fs.writeFileSync(path.join(OUT, 'web-' + label + '-' + section + '.png'), (await win.webContents.capturePage()).toPNG());
      const found = [].concat(errs.map((x) => 'JS: ' + x), bad || []);
      if (found.length) failed++;
      console.log('--', label, section, found.join('\n  ') || 'clean');
    }
  }
  app.exit(failed ? 1 : 0);
});
