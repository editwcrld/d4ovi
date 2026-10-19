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
const guideinfo = require('./guideinfo');

const DAY = 24 * 3600 * 1000;

const MAX_VARIANTS = 8;

/**
 * @param deps { net, log, catalog: () => farm catalog, importBuilds: (text) => {added, data},
 *               provenMax: how many proven builds per skill (default 8) }
 */
function create(deps) {
  const { net } = deps;
  const log = deps.log || (() => {});
  const data = () => builder.load(net, () => d2db.currentBuild(net), log);
  const proven = new Map();          // "cls:key" -> { at, out, variants: Map(url -> variant), usage }

  /** Pictures: skill icons by d2core's ids, item and aspect pictures from the farm list's data. */
  function icons(db) {
    const cat = deps.catalog();
    // an aspect the farm list has no picture of: d2core's own (cloudstorage …/aspect/<icon>.png)
    const d2asp = new Map(((db && db.aspects) || []).filter((a) => a.icon).map((a) => [a.name.toLowerCase(), 'https://cloudstorage.d2core.com/data_img/d4/aspect/' + a.icon + '.png']));
    const norm = (n) => String(n || '').replace(/[\u00a0\u2007\u202f]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
    const items = new Map((cat.items || []).map((x) => [norm(x.name), x.icon || '']));
    const aspects = new Map((cat.aspects || []).map((x) => [norm(x.name), x.url ? 'https://d4guides.gg/assets/img/aspects/' + String(x.url).split('/').pop() + '.webp' : '']));
    const known = new Map((cat.items || []).map((x) => [norm(x.name), x.slot]).concat((cat.aspects || []).map((x) => [norm(x.name), ''])));
    const low = norm;
    return { piece: (name, kind) => (kind === 'aspect' ? aspects.get(low(name)) || d2asp.get(low(name)) : items.get(low(name)) || aspects.get(low(name)) || d2asp.get(low(name))) || '', known, cat };
  }
  const skillIcon = (d, cls, key, name) => {
    const nodes = ((d && d.tree && d.tree[cls]) || { nodes: [] }).nodes;
    const n = nodes.find((x) => x.pw === key) || (name && nodes.find((x) => x.k === 'skill' && d.skills[x.id] && d.skills[x.id].name.toLowerCase() === String(name).toLowerCase()));
    return (n && d.skills[n.id] && d.skills[n.id].icon) || 0;
  };
  const both = () => Promise.all([data(), d2db.load(net, log)]);
  // a plan takes seconds – the same skill with the same options and the same proven builds is worked out once
  const plans = new Map();
  function planOf(db, d, cls, key, opts) {
    const known = proven.get(cls + ':' + key) || {};
    const id = [cls, key, JSON.stringify(opts || {}), known.at || 0].join('|');
    if (plans.has(id)) return plans.get(id);
    const p = builder.plan(db, String(cls), String(key), Object.assign({ d2: d, tiers: db.tiers, known: icons(db).known, reference: known.reference || null, paragonUse: known.paragonUse || null }, opts || {}));
    plans.set(id, p);
    if (plans.size > 24) plans.delete(plans.keys().next().value);
    return p;
  }

  async function catalog() {
    const [db, d] = await both();
    // guides: the maxroll tier entry and the other sites' guides d4builder read (lib/guideinfo.js)
    return builder.catalog(db).map((c) => Object.assign({}, c, { skills: c.skills.map((s) => Object.assign({}, s, { icon: skillIcon(d, c.cls, s.key, s.name),
      guides: guideinfo.sheetsForSkill(c.cls, s.name).length || (s.tier ? 1 : 0) })) }));
  }

  async function plan(cls, key, opts) {
    const [db, d] = await both();
    const ic = icons(db);
    // with the proven builds known, every piece is measured at the level they reach
    const known = proven.get(cls + ':' + key) || {};
    const reference = known.reference || null;
    // boards and glyphs the top builds use come first in the paragon plan (planOf passes them)
    const p = planOf(db, d, cls, key, opts);
    if (!p) return { error: 'Unknown skill' };
    const used = (proven.get(cls + ':' + key) || {}).usage || {};
    return {
      cls: p.cls, main: p.main, resource: p.resource, skill: Object.assign({}, p.skill, { icon: skillIcon(d, p.cls, p.skill.key) }),
      bar: p.barMods.map((b) => Object.assign({}, b, { icon: skillIcon(d, p.cls, b.key, b.name) })),
      gear: Object.fromEntries(Object.entries(p.gear).map(([s, g]) => [s, { stats: g.stats, tempers: g.tempers }])),
      on: p.conditions, conditionList: p.conditionList, talisman: p.talisman, targets: p.targets, reference,
      // the skill's loop and what it hangs on, the talisman in its three ways
      loop: p.loop, loopPassive: p.loopPassive, facts: p.facts, tag: p.tag, charms: p.charms, choices: p.choices, sockets: p.sockets, runeWhy: p.runeWhy,
      engine: { slots: p.engine.slots, labels: p.engine.labels, state: p.engine.state, base: p.engine.base, plain: p.engine.plain, rolls: p.engine.rolls, statOpts: p.engine.statOpts,
        cands: p.engine.cands.map((c) => Object.assign({}, c, { icon: ic.piece(c.name, c.kind), used: used[c.name] || 0 })) },
      paragon: p.paragonPlan && { fromTop: p.paragonPlan.fromTop, boards: p.paragonPlan.boards.map((x) => ({ key: x.key, name: x.name, node: x.node, desc: x.desc, rows: x.rows, nodes: x.nodes, order: x.order, glyph: x.glyph, used: x.used || 0, of: x.of || 0 })) },
    };
  }

  async function provenFor(cls, key) {
    const id = cls + ':' + key;
    const have = proven.get(id);
    if (have && Date.now() - have.at < DAY) return have.out;
    const [db, d] = await both();
    const sk = db.classes[cls] && db.classes[cls].skills.find((s) => s.key === key);
    if (!sk) return { error: 'Unknown skill' };
    const ic = icons(db);
    const season = (await d2db.currentBuild(net)).season || 15;
    // the sites that could not be asked (offline, a firewall): said on the page, and nothing is kept for a day
    const failed = [];
    const siteOf = (u) => { try { return new URL(u).host.replace(/^www\./, '').replace(/\.(gg|com)$/, ''); } catch (_) { return 'a site'; } };
    const list = await provenbuilds.forSkill(net, { cls, skillKey: key, skillName: sk.name, tiers: db.tiers, season, log, max: deps.provenMax || 8, failed });
    const cons = await provenbuilds.consensus(list, (u) => buildimport.load(net, u, ic.cat, log, () => db).catch((e) => { failed.push(siteOf(u)); throw e; }), log);
    const usage = Object.fromEntries(cons.pieces.map((e) => [e.name, e.n]));
    const variants = new Map();
    const explained = [];
    // one plan of the skill for all of them (no reference yet – that is what they are measured for)
    const base = builder.plan(db, cls, key, { d2: d, tiers: db.tiers, known: ic.known });
    const explainOne = (v) => {
      const x = builder.explainBuild(db, cls, key, v, { d2: d, tiers: db.tiers, known: ic.known, plan: base });
      if (!x) return null;
      x.gear.forEach((g) => { g.icon = ic.piece(g.name, g.kind); g.used = usage[g.name] || 0; });
      x.bar.forEach((s) => { s.icon = skillIcon(d, cls, s.key, s.name); });
      return x;
    };
    // the guides' own names for their variants: "Cold Rain of Arrows … – Endgame" -> "Endgame"
    const short = (n) => String(n || '').split(/\s+[–-]\s+/).pop().trim() || String(n || '');
    for (const { src, v, all, pick } of cons.raw) {
      const x = explainOne(v);
      if (!x) continue;
      const vs = (all || [v]).slice(0, MAX_VARIANTS);
      const at = Math.min(pick || 0, vs.length - 1);
      variants.set(src.url, vs);
      // what the author says: breakpoints, how it plays, why it works (lib/guideinfo.js)
      const sheetOf = (w) => guideinfo.sheetFor((w.source && w.source.url) || src.url) || guideinfo.sheetFor(src.url);
      // every variant of the guide (starter, endgame, pit push …), each explained on its own
      const opts = vs.map((w, i) => {
        const wx = i === at ? x : explainOne(w);
        return wx ? { i, name: short(w.name), explain: wx, sheet: sheetOf(w), setup: w.setup || null } : null;
      }).filter(Boolean);
      explained.push({ site: src.site, url: src.url, title: src.title, original: src.original || '', author: src.author || (src.site === 'maxroll.gg' ? 'maxroll' : ''),
        tier: src.tier || '', likes: src.likes || 0, variant: v.name, explain: x, sheet: sheetOf(v), setup: v.setup || null, pick: at, variants: opts });
    }
    const reference = builder.referenceOf(explained.slice(0, 4).map((e) => e.explain));
    const unreachable = [...new Set(failed)];
    const out = { proven: explained, consensus: { n: cons.n, slots: cons.slots, sockets: cons.sockets.slice(0, 10), skills: cons.skills.slice(0, 8), sets: cons.sets.slice(0, 4) }, usage, reference, unreachable };
    // kept for a day – unless a site could not be asked: then the next visit asks again
    proven.set(id, { at: unreachable.length ? 0 : Date.now(), out, variants, usage, reference, paragonUse: { boards: cons.boards, glyphs: cons.glyphs } });
    return out;
  }

  /** The build as the farm list keeps it – a proven one as imported, or the player's picks. */
  async function farmBuild(cls, key, picks) {
    const p = picks || {};
    if (p.url) {
      const vs = ((proven.get(cls + ':' + key) || {}).variants || new Map()).get(p.url);
      const v = vs && (vs[Number(p.variant) || 0] || vs[0]);
      if (!v) return { error: 'This build is no longer loaded – open it again.' };
      return { name: v.name, cls: v.cls, slots: v.slots, source: v.source, skills: v.skills, paragon: v.paragon, charms: v.charms, setup: v.setup };
    }
    const [db, d] = await both();
    const known = proven.get(cls + ':' + key) || {};
    const b = builder.buildFor(db, String(cls), String(key), p, { d2: d, tiers: db.tiers, known: icons(db).known, reference: known.reference || null, paragonUse: known.paragonUse || null, plan: planOf(db, d, cls, key, {}) });
    return b || { error: 'Unknown skill' };
  }
  async function save(cls, key, picks) {
    const b = await farmBuild(cls, key, picks);
    if (b.error) return b;
    return deps.importBuilds(JSON.stringify({ builds: [b] }));
  }
  /** The same, not saved – what the builder shows as skill tree, paragon, charms and sockets before it goes into the farm list. */
  async function preview(cls, key, picks) {
    const b = await farmBuild(cls, key, picks);
    if (b.error) return b;
    // the skill icons for the bar, as the farm list draws them
    const [, d] = await both();
    if (b.skills && b.skills.bar) b.skills.bar = b.skills.bar.map((x) => Object.assign({}, x, { icon: x.icon || skillIcon(d, cls, x.key, x.name) }));
    return b;
  }

  /** The proven builds and the plan measured against them – both at once, for a page that shows them together. */
  async function full(cls, key) {
    const pr = await provenFor(cls, key);
    const p = await plan(cls, key, {});
    return { plan: p, proven: pr };
  }
  /** What provenFor worked out, as plain JSON – to keep it elsewhere (web/server.js: Supabase) … */
  function state(cls, key) {
    const s = proven.get(cls + ':' + key);
    return s ? Object.assign({}, s, { variants: Object.fromEntries(s.variants) }) : null;
  }
  /** … and to take it back, so saving and the own build work as if it had been worked out here. */
  function adopt(cls, key, s) {
    if (!s || !s.out) return;
    proven.set(cls + ':' + key, Object.assign({}, s, { at: Date.now(), variants: new Map(Object.entries(s.variants || {})) }));
  }

  // every call answers – an error comes back as { error } for the page to show
  const safe = (name, fn) => async (...a) => { try { return await fn(...a); } catch (e) { log('builder ' + name + ' failed:', e.message); return { error: e.message }; } };
  return { catalog: safe('catalog', catalog), plan: safe('plan', plan), proven: safe('proven', provenFor), full: safe('full', full), save: safe('save', save), preview: safe('preview', preview), state, adopt };
}

module.exports = { create };
