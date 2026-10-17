// The builder against the real sites – what the overlay's main process does, without Electron.
// Needs the internet, so it is not part of `npm test`:   node test/builder-live.js [data folder]
// The data folder (default: dist/D4-Overlay-Data) gives the farm list and d2core's database;
// the builder's own data is fetched fresh into a temporary file.
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const D = path.resolve(process.argv[2] || path.join(__dirname, '..', 'dist', 'D4-Overlay-Data'));
const farm = require('../lib/farm'); const d2db = require('../lib/d2coredb'); const mb = require('../lib/maxbuild'); const zh = require('../lib/zhdict');
const builder = require('../lib/builder'); const builds = require('../lib/builds'); const ipc = require('../lib/builderipc');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-builder-'));
for (const f of ['d2core-db.json', 'farm-cache.json', 'farm-tooltips.json', 'maxroll-names.json', 'zh-dict.json']) if (fs.existsSync(path.join(D, f))) fs.copyFileSync(path.join(D, f), path.join(tmp, f));
farm.configure({ cacheFile: path.join(tmp, 'farm-cache.json'), tipFile: path.join(tmp, 'farm-tooltips.json') });
d2db.configure({ file: path.join(tmp, 'd2core-db.json') }); mb.configure({ namesFile: path.join(tmp, 'maxroll-names.json') }); zh.configure({ file: path.join(tmp, 'zh-dict.json') });
builder.configure({ file: path.join(tmp, 'builder-db.json') });
builds.configure({ file: path.join(tmp, 'builds.json') });
const read = (f) => { try { return JSON.parse(fs.readFileSync(path.join(D, f), 'utf8')); } catch (_) { return null; } };
const loot = read('maxroll-cache.json'), craft = read('crafting-cache.json');
const net = { fetch: (u, o) => fetch(u, o) };
const api = ipc.create({ net, log: () => {}, catalog: () => farm.catalog(loot, craft),
  importBuilds: (text) => { const got = builds.parseImport(text); return { added: got.length, data: got.length ? builds.save(builds.merge(builds.load(), got)) : builds.load() }; } });

(async () => {
  const t0 = Date.now();
  const cat = await api.catalog();
  assert.ok(Array.isArray(cat) && cat.length === 8, 'eight classes: ' + JSON.stringify(cat).slice(0, 200));
  const db = JSON.parse(fs.readFileSync(path.join(tmp, 'builder-db.json'), 'utf8'));
  console.log('ok  data: game ' + db.game + ', items from ' + db.items + ' (' + db.uniques.length + ' uniques, ' + db.aspects.length + ' aspects, ' + Object.keys(db.sockets).length + ' gems/splinters), tier list ' + db.tiers.length + ' – ' + (Date.now() - t0) + ' ms');
  // every class: its first damage skill with a guide gives a plan with all ten (or nine) slots filled
  for (const c of cat) {
    const s = c.skills.find((x) => x.tier === 'S') || c.skills.find((x) => x.tier === 'A') || c.skills.find((x) => x.cat === 'Core') || c.skills[0];
    const p = await api.plan(c.cls, s.key, {});
    assert.ok(!p.error, c.cls + ' ' + s.name + ': ' + p.error);
    const st = p.engine.state;
    const r = require('../lib/optimizer').fillGear(p.engine.cands, st, p.on, require('../lib/optimizer').GOALS.push, p.engine.slots);
    const filled = Object.keys(r.placed).length;
    assert.ok(filled >= p.engine.slots.length - 1, c.cls + ': slots filled ' + filled + '/' + p.engine.slots.length);
    // the Warlock's commands (soul shards) are not in the skill tree – no icon there, the rest has one
    assert.ok(p.bar.length >= 4 && p.bar.every((b) => b.icon || /^Command /.test(b.name)), c.cls + ': skill bar with icons ' + p.bar.map((b) => b.name + ':' + b.icon).join());
    assert.ok(p.paragon && p.paragon.boards.length >= 3, c.cls + ': paragon boards');
    console.log('ok  ' + c.cls.padEnd(11) + ' ' + s.name.padEnd(20) + Object.values(r.placed).filter((x) => x.kind !== 'blocked').map((x) => x.name).slice(0, 4).join(', ') + ' …');
  }
  // proven builds for Rain of Arrows: found, imported, explained
  const t1 = Date.now();
  const pr = await api.proven('Rogue', 'Rogue_RainofArrows');
  assert.ok(!pr.error && pr.proven.length >= 2 && pr.consensus.n >= 4, 'proven builds: ' + (pr.error || pr.proven.length));
  assert.ok(pr.proven.every((b) => b.explain && b.explain.lines.length >= 3), 'each one explained');
  const helm = pr.consensus.slots.Helm[0];
  console.log('ok  proven Rain of Arrows: ' + pr.proven.map((b) => b.site + (b.tier ? ' ' + b.tier : ' ♥' + b.likes)).join(', ') + ' · consensus of ' + pr.consensus.n + ', helm: ' + helm.name + ' ' + helm.n + '/' + helm.of + ' – ' + (Date.now() - t1) + ' ms');
  // saving: a proven build as imported, and an own one with skills, paragon and charms
  const a = await api.save('Rogue', 'Rogue_RainofArrows', { url: pr.proven[0].url });
  assert.ok(a.added === 1, 'proven build saved');
  const b = await api.save('Rogue', 'Rogue_RainofArrows', { pieces: { Helm: "Leoric's Crown" }, name: 'My Rain of Arrows' });
  assert.ok(b.added === 1, 'own build saved: ' + JSON.stringify(b).slice(0, 200));
  const mine = b.data.builds.find((x) => x.name === 'My Rain of Arrows');
  assert.ok(mine && mine.slots.Helm.item === "Leoric's Crown" && mine.skills && mine.skills.bar.length >= 4 && mine.paragon && mine.paragon.boards.length >= 3 && mine.charms, 'gear, skills, paragon, charms');
  console.log('ok  saved: a proven build as imported, an own one with ' + Object.keys(mine.slots).length + ' slots, ' + mine.skills.bar.length + ' skills, ' + mine.paragon.boards.length + ' boards, ' + mine.charms.list.length + ' charms');
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });
