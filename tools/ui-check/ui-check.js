// The real overlay at every window size, every page: a screenshot of each and the layout check
// (check.js) – text and buttons that overlap, spill out of their box or out of the window.
//   npm run ui-check                       every size, every page
//   npm run ui-check -- mobile             one size (user medium mobile small mid large)
//   npm run ui-check -- mobile bd-         one size, the pages whose name starts so ("-" for every size)
// Screenshots and report.json land in tools/ui-check/out/. The data is the app's own (data.js).
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const check = require('./check.js');
const { ROOT } = require('./data.js');

const OUT = path.join(__dirname, 'out');
// width, height, name – the panel's sizes (main.js PANEL_SIZES), a phone and the size it was laid out for
const SIZES = [[941, 769, 'user'], [820, 600, 'medium'], [393, 850, 'mobile'], [560, 420, 'small'], [700, 510, 'mid'], [1100, 760, 'large']];
// name, steps (run in the page, one by one – the helpers are below)
const FIND = `open('farm'); clickText('.kick button', 'Find a build')`;
const PLAN = `${FIND}; clickHas('.bd-cls', 'Rogue'); clickHas('.bd-sk', 'Rain of Arrows')`;
const SCREENS = [
  ['strip', 'closed'],
  ['search-empty', `open('search')`],
  ['search-item', `open('search'); typeQ('harlequin')`],
  ['search-boss', `open('search'); typeQ('butcher')`],
  ['bossloot', `open('search'); typeQ('boss loot')`],
  ['crafting', `open('search'); typeQ('crafting')`],
  ['route', `open('farm'); layout('route')`],
  ['list', `open('farm'); layout('list')`],
  ['slots', `open('farm'); layout('slots')`],
  ['picker', `open('farm'); layout('route'); clickSel('.thing .gn')`],
  ['menu', `open('farm'); clickSel('.bname')`],
  ['import', `open('farm'); clickText('#title button', 'Import')`],
  ['skills', `open('farm'); tab('skills')`],
  ['paragon', `open('farm'); tab('paragon')`],
  ['guide', `open('farm'); tab('guide')`],
  ['compare', `open('farm'); tab('compare')`],
  ['builder', FIND],
  ['bd-skillpick', `${FIND}; clickHas('.bd-cls', 'Rogue')`],
  ['bd-plan', PLAN],
  ['bd-own', `${PLAN}; clickHas('.bd-src', 'Build it yourself')`],
  ['bd-skills', `${PLAN}; clickHas('.bd-views button', 'Skills')`],
  ['bd-goals', `${PLAN}; clickHas('.bd-views button', 'Goals')`],
  ['set-behaviour', `open('settings')`],
  ['set-appearance', `open('settings'); tab('appearance')`],
  ['set-hotkeys', `open('settings'); tab('hotkeys')`],
  ['set-macros', `open('settings'); tab('macros')`],
  ['set-trade', `open('settings'); tab('trade')`],
  ['set-data', `open('settings'); tab('data')`],
  ['maptool', `open('maptool')`],
];
const HELPERS = `(() => {
  window.open_ = (s) => { const b = document.querySelector('#rail .ri[data-section="' + s + '"]'); if (b) b.click(); };
  window.typeQ = (v) => { const q = document.getElementById('q'); q.value = v; q.dispatchEvent(new Event('input')); };
  window.layout = (l) => { const b = document.querySelector('.tool [data-layout="' + l + '"]'); if (b) b.click(); };
  window.tab = (t) => { const b = document.querySelector('#chips .ptab[data-tab="' + t + '"], .anchors [data-group="' + t + '"]'); if (b) b.click(); };
  window.clickSel = (s) => { const b = document.querySelector(s); if (b) b.click(); };
  window.clickHas = (s, t) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.includes(t)); if (b) b.click(); };
  window.clickText = (s, t) => { const b = [...document.querySelectorAll(s)].find((x) => x.textContent.trim() === t); if (b) b.click(); };
})()`;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const sizeF = process.argv[2] && process.argv[2] !== '-' ? process.argv[2] : null;
  const scrF = process.argv[3] || null;
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  const win = new BrowserWindow({ width: 820, height: 600, useContentSize: true, show: false,
    webPreferences: { offscreen: true, preload: path.join(__dirname, 'bridge.js'), contextIsolation: false, sandbox: false } });
  let errs = [];
  win.webContents.on('console-message', (e, level, msg, line, src) => {
    if (level >= 2 && !/Security|Autofill|Failed to load resource|net::|deprecated/.test(msg)) errs.push(msg + ' ' + path.basename(src || '') + ':' + line);
  });
  const js = (s) => win.webContents.executeJavaScript(s).catch((e) => 'ERR ' + e.message);
  for (const [w, h, label] of SIZES.filter((s) => !sizeF || s[2] === sizeF)) {
    for (const [id, steps] of SCREENS.filter((s) => !scrF || s[0].startsWith(scrF))) {
      win.setContentSize(w, h);
      errs = [];
      await win.loadFile(path.join(ROOT, 'renderer', 'index.html')).catch((e) => errs.push('load: ' + e.message));
      await wait(700);
      await js(HELPERS);
      if (steps === 'closed') {
        // the closed strip, slid out: the app gives its window the strip's own width (main.js applySize)
        await js(`document.getElementById('app').classList.add('idle', 'peek')`);
        await wait(400);
        const sw = await js(`Math.ceil(document.getElementById('rail').scrollWidth)`);
        if (sw > w) win.setContentSize(sw, h);
      } else {
        if (id !== 'builder') await js(`document.getElementById('coachOk') && document.getElementById('coachOk').click()`);
        for (const step of steps.replace(/open\(/g, 'open_(').split(';').map((x) => x.trim()).filter(Boolean)) {
          await js(step);
          await wait(/^(typeQ|open_|clickHas)/.test(step) ? 800 : 350);
        }
      }
      await wait(900);
      const bad = await js(check('#app'));
      fs.writeFileSync(path.join(OUT, label + '-' + id + '.png'), (await win.webContents.capturePage()).toPNG());
      report.push({ size: label, screen: id, bad, errs });
      if ((bad && bad.length) || errs.length) console.log('--', label, id, '\n  ' + [].concat(errs.map((x) => 'JS: ' + x), bad || []).join('\n  '));
    }
  }
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  const failed = report.filter((r) => (r.bad && r.bad.length) || r.errs.length).length;
  console.log('checked', report.length, 'screens;', failed, 'with findings – screenshots in', path.relative(ROOT, OUT));
  app.exit(failed ? 1 : 0);
});
