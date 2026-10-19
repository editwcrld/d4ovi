'use strict';
// What the farm list, the builds and the builder ask the main process for – kept apart from main.js
// like lib/builderipc.js (the builder's own part, created here):
//   farm:*      the catalog, an item's tooltip and its stylesheet
//   builds:*    the saved builds: load, save, a link's variants, the guide's notes, skill tree and
//               paragon boards, the build code, import and export (text or file)
//   builder:*   catalog, plan, proven builds, save, preview (lib/builderipc.js)
const fs = require('fs');
const path = require('path');
const farm = require('./farm');
const builds = require('./builds');
const builder = require('./builder');
const buildimport = require('./buildimport');
const guideinfo = require('./guideinfo');
const d2db = require('./d2coredb');
const builderipc = require('./builderipc');

// the build's page opens in the browser only for the build sites
const SOURCE = /^https:\/\/(www\.)?(maxroll\.gg|d4builds\.gg|infinitybuilds\.gg|d2core\.com)\//i;

/** Text (a build code or JSON) -> builds added to the saved ones. */
function importBuilds(text) {
  const got = builds.parseImport(text);
  return { added: got.length, data: got.length ? builds.save(builds.merge(builds.load(), got)) : builds.load() };
}

/**
 * @param ipc  ipcMain (or anything with handle(channel, fn))
 * @param deps { net, log, catalog: () => farm catalog, clipboard, shell,
 *               saveDialog(opts), openDialog(opts) – Electron's dialogs over the overlay,
 *               documents(): the folder an export starts in }
 */
function register(ipc, deps) {
  const { net, log } = deps;
  const str = (v) => String(v || '');
  // the game data the builder keeps: names of class mechanics and mercenaries, the uniques' own affixes
  const builderData = () => builder.current() || builder.load(net, () => d2db.currentBuild(net), log);

  ipc.handle('farm:get', () => deps.catalog());
  ipc.handle('farm:tooltip', (_e, type, id) => farm.tooltip(net, str(type), str(id)));
  ipc.handle('farm:css', () => farm.tooltipCss());

  ipc.handle('builds:get', () => builds.load());
  ipc.handle('builds:save', (_e, d) => builds.save(d));
  // a build link (maxroll guide / planner, d4builds.gg, infinitybuilds.gg, d2core.com) -> its variants
  ipc.handle('builds:link', async (_e, url) => {
    try { return await buildimport.load(net, str(url), deps.catalog(), log, builderData); }
    catch (e) { log('build import failed:', e.message); return { error: e.message }; }
  });
  // what the guide's authors say about a build – its own guide by its link, else its main skill's
  ipc.handle('builds:sheet', (_e, q) => {
    const o = q || {};
    const own = o.url ? guideinfo.sheetFor(str(o.url)) : null;
    if (own) return Object.assign(own, { own: true });
    const other = guideinfo.sheetsForSkill(str(o.cls), str(o.skill))[0];
    return other ? Object.assign(other, { own: false }) : null;
  });
  // skill tree and paragon boards – d2core's database, fetched on first use
  ipc.handle('builds:tree', async (_e, cls) => {
    try { return d2db.treeFor(await d2db.load(net, log), str(cls)); } catch (e) { return { error: e.message }; }
  });
  ipc.handle('builds:paragon', async (_e, keys) => {
    try { return d2db.paragonFor(await d2db.load(net, log), Array.isArray(keys) ? keys.map(String).slice(0, 14) : []); }
    catch (e) { return { error: e.message }; }
  });
  ipc.handle('builds:open-source', (_e, url) => {
    if (!SOURCE.test(str(url))) return false;
    deps.shell.openExternal(str(url));
    return true;
  });
  ipc.handle('builds:code', (_e, b) => { const c = builds.toCode(b); deps.clipboard.writeText(c); return c; });
  ipc.handle('builds:import-text', (_e, text) => importBuilds(text));
  ipc.handle('builds:export', async () => {
    const r = await deps.saveDialog({ defaultPath: path.join(deps.documents(), 'd4-builds.json'), filters: [{ name: 'Builds', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(builds.load(), null, 1));
    return r.filePath;
  });
  ipc.handle('builds:import-file', async () => {
    const r = await deps.openDialog({ properties: ['openFile'], filters: [{ name: 'Builds', extensions: ['json', 'txt'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    let text = '';
    try { text = fs.readFileSync(r.filePaths[0], 'utf8'); } catch (_) { /* unreadable: nothing added */ }
    return importBuilds(text);
  });

  // the builder: pick a class and a skill, get a build
  const api = builderipc.create({ net, log, catalog: deps.catalog, importBuilds });
  ipc.handle('builder:catalog', () => api.catalog());
  ipc.handle('builder:plan', (_e, cls, key, opts) => api.plan(str(cls), str(key), opts || {}));
  ipc.handle('builder:proven', (_e, cls, key) => api.proven(str(cls), str(key)));
  ipc.handle('builder:save', (_e, cls, key, picks) => api.save(str(cls), str(key), picks || {}));
  ipc.handle('builder:preview', (_e, cls, key, picks) => api.preview(str(cls), str(key), picks || {}));
}

module.exports = { register, importBuilds, SOURCE };
