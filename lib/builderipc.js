'use strict';
// What the builder section asks the main process for – kept apart from main.js so it can be
// tested without Electron (test/builder-live.js runs it against the real sites).
//
//   catalog()            classes and their skills, with icons and tier marks
//   plan(cls, key, o)    the builder's own plan and everything the page needs to recompute it
//   proven(cls, key)     the proven builds for the skill, imported and explained, and what they agree on
//   save(cls, key, p)    into the farm list: a proven build as imported, or the player's picks
const builder = require('./builder');
const provenbuilds = require('./provenbuilds');
const buildimport = require('./buildimport');
const d2db = require('./d2coredb');

const DAY = 24 * 3600 * 1000;

/**
 * @param deps { net, log, catalog: () => farm catalog, importBuilds: (text) => {added, data} }
 */
function create(deps) {
  const { net } = deps;
  const log = deps.log || (() => {});
  const data = () => builder.load(net, () => d2db.currentBuild(net), log);
  const proven = new Map();          // "cls:key" -> { at, out, variants: Map(url -> variant), usage }

  /** Pictures: skill icons by d2core's ids, item and aspect pictures from the farm list's data. */
  function icons() {
    const cat = deps.catalog();
    const items = new Map((cat.items || []).map((x) => [x.name.toLowerCase(), x.icon || '']));
    const aspects = new Map((cat.aspects || []).map((x) => [x.name.toLowerCase(), x.url ? 'https://d4guides.gg/assets/img/aspects/' + String(x.url).split('/').pop() + '.webp' : '']));
    const known = new Map((cat.items || []).map((x) => [x.name.toLowerCase(), x.slot]).concat((cat.aspects || []).map((x) => [x.name.toLowerCase(), ''])));
    return { piece: (name, kind) => (kind === 'aspect' ? aspects.get(String(name).toLowerCase()) : items.get(String(name).toLowerCase()) || aspects.get(String(name).toLowerCase())) || '', known, cat };
  }
  const skillIcon = (d, cls, key, name) => {
    const nodes = ((d && d.tree && d.tree[cls]) || { nodes: [] }).nodes;
    const n = nodes.find((x) => x.pw === key) || (name && nodes.find((x) => x.k === 'skill' && d.skills[x.id] && d.skills[x.id].name.toLowerCase() === String(name).toLowerCase()));
    return (n && d.skills[n.id] && d.skills[n.id].icon) || 0;
  };
  const both = () => Promise.all([data(), d2db.load(net, log)]);

  async function catalog() {
    const [db, d] = await both();
    return builder.catalog(db).map((c) => Object.assign({}, c, { skills: c.skills.map((s) => Object.assign({}, s, { icon: skillIcon(d, c.cls, s.key, s.name) })) }));
  }

  async function plan(cls, key, opts) {
    const [db, d] = await both();
    const ic = icons();
    const p = builder.plan(db, String(cls), String(key), Object.assign({ d2: d, tiers: db.tiers, known: ic.known }, opts || {}));
    if (!p) return { error: 'Unknown skill' };
    const used = (proven.get(cls + ':' + key) || {}).usage || {};
    return {
      cls: p.cls, main: p.main, resource: p.resource, skill: Object.assign({}, p.skill, { icon: skillIcon(d, p.cls, p.skill.key) }),
      bar: p.barMods.map((b) => Object.assign({}, b, { icon: skillIcon(d, p.cls, b.key, b.name) })),
      gear: Object.fromEntries(Object.entries(p.gear).map(([s, g]) => [s, { stats: g.stats, tempers: g.tempers }])),
      on: p.conditions, conditionList: p.conditionList, talisman: p.talisman, targets: p.targets,
      engine: { slots: p.engine.slots, state: p.engine.state, base: p.engine.base,
        cands: p.engine.cands.map((c) => Object.assign({}, c, { icon: ic.piece(c.name, c.kind), used: used[c.name] || 0 })) },
      paragon: p.paragonPlan && { boards: p.paragonPlan.boards.map((x) => ({ key: x.key, name: x.name, node: x.node, desc: x.desc, rows: x.rows, nodes: x.nodes, order: x.order, glyph: x.glyph })) },
    };
  }

  async function provenFor(cls, key) {
    const id = cls + ':' + key;
    const have = proven.get(id);
    if (have && Date.now() - have.at < DAY) return have.out;
    const [db, d] = await both();
    const sk = db.classes[cls] && db.classes[cls].skills.find((s) => s.key === key);
    if (!sk) return { error: 'Unknown skill' };
    const ic = icons();
    const season = (await d2db.currentBuild(net)).season || 15;
    const list = await provenbuilds.forSkill(net, { cls, skillKey: key, skillName: sk.name, tiers: db.tiers, season, log });
    const cons = await provenbuilds.consensus(list, (u) => buildimport.load(net, u, ic.cat, log), log);
    const usage = Object.fromEntries(cons.pieces.map((e) => [e.name, e.n]));
    const variants = new Map();
    const explained = [];
    for (const { src, v } of cons.raw.slice(0, 4)) {
      const x = builder.explainBuild(db, cls, key, v, { d2: d, tiers: db.tiers, known: ic.known });
      if (!x) continue;
      x.gear.forEach((g) => { g.icon = ic.piece(g.name, g.kind); g.used = usage[g.name] || 0; });
      x.bar.forEach((s) => { s.icon = skillIcon(d, cls, s.key, s.name); });
      variants.set(src.url, v);
      explained.push({ site: src.site, url: src.url, title: src.title, original: src.original || '', author: src.author || (src.site === 'maxroll.gg' ? 'maxroll' : ''),
        tier: src.tier || '', likes: src.likes || 0, variant: v.name, explain: x });
    }
    const out = { proven: explained, consensus: { n: cons.n, slots: cons.slots, sockets: cons.sockets.slice(0, 10), skills: cons.skills.slice(0, 8), sets: cons.sets.slice(0, 4) }, usage };
    proven.set(id, { at: Date.now(), out, variants, usage });
    return out;
  }

  async function save(cls, key, picks) {
    const p = picks || {};
    if (p.url) {
      const v = ((proven.get(cls + ':' + key) || {}).variants || new Map()).get(p.url);
      if (!v) return { error: 'This build is no longer loaded – open it again.' };
      return deps.importBuilds(JSON.stringify({ builds: [{ name: v.name, cls: v.cls, slots: v.slots, source: v.source, skills: v.skills, paragon: v.paragon, charms: v.charms }] }));
    }
    const [db, d] = await both();
    const b = builder.buildFor(db, String(cls), String(key), p, { d2: d, tiers: db.tiers, known: icons().known });
    if (!b) return { error: 'Unknown skill' };
    return deps.importBuilds(JSON.stringify({ builds: [b] }));
  }

  // every call answers – an error comes back as { error } for the page to show
  const safe = (name, fn) => async (...a) => { try { return await fn(...a); } catch (e) { log('builder ' + name + ' failed:', e.message); return { error: e.message }; } };
  return { catalog: safe('catalog', catalog), plan: safe('plan', plan), proven: safe('proven', provenFor), save: safe('save', save) };
}

module.exports = { create };
