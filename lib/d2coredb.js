'use strict';
// d2core.com's English game database – stat texts, skill trees, paragon boards.
//
//   cloudstorage.d2core.com/data/d4/<build>/<name>_enUS.json?v=<revision>
//
// The site keeps one complete database per game build; the build and revision numbers are in
// its web bundle and change with patches, so they are read from there once a week (with the
// numbers known at the time of writing as the fallback). Every file is slimmed to what the
// overlay shows and kept in the data folder (d2core-db.json).
const fs = require('fs');

const HOST = 'https://cloudstorage.d2core.com';
const SITE = 'https://www.d2core.com/d4/planner';
const FALLBACK = { build: '73552', rev: '2026100202', season: 15 };
const MAX_AGE = 7 * 24 * 3600 * 1000;
const VERSION = 6;   // 5: runes with their Offering and effects
const CLASSES = ['Sorcerer', 'Druid', 'Barbarian', 'Rogue', 'Necromancer', 'Spiritborn', 'Paladin', 'Warlock'];

let file = null;
let db = null;                 // { version, fetchedAt, build, affix, socket, tree, skills, paragon }
let pending = null;

function configure(opts) {
  if (opts && opts.file) file = opts.file;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && c.version === VERSION && c.affix) db = c;
  } catch (_) { /* fetched on first use */ }
}

// ---- stat texts ---------------------------------------------------------------------------
/** One number in the way the template asks: "1%" = one decimal and a percent sign, "x" a multiplier, "~" = plain. */
function fmtNum(n, fmt) {
  if (!Number.isFinite(n)) return '?';
  const f = String(fmt || '');
  const d = f.match(/\d/);
  const pct = f.includes('%');
  const dec = d ? Number(d[0]) : 0;
  const max = d || pct ? dec : 1;                 // a plain number keeps one decimal if it has one
  const t = n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: max });
  // "%x" is a multiplier – written the game's way, "x10.0%"
  return (f.includes('x') ? 'x' : '') + t + (pct ? '%' : '');
}

/**
 * The value a placeholder stands for: {VALUE} / {VALUE1} the first roll, {VALUE2} the second –
 * or the first when the stat has only one (d2core keeps a single value per stat).
 */
function valueFor(ph, value) {
  const vals = Array.isArray(value) ? value : [value];
  const n = Number((String(ph).match(/(\d)\}$/) || [])[1] || 1);
  const v = vals[n - 1] != null ? vals[n - 1] : vals[0];
  return Number(v);
}

/** "{VALUE} * 100" with the value put in – only a product or a plain number, never eval. */
function calc(expr, value) {
  const parts = String(expr).replace(/\{[a-z0-9_]+\}/gi, (ph) => String(valueFor(ph, value))).split('*').map((x) => Number(x.trim()));
  return parts.every(Number.isFinite) ? parts.reduce((a, b) => a * b, 1) : NaN;
}

/**
 * A stat line from d2core's template and the rolled value (or values):
 *   "+[{VALUE} * 100|1%|] Attack Speed", 0.1  ->  "+10.0% Attack Speed"
 */
function statText(tpl, value) {
  let s = String(tpl || '');
  s = s.replace(/\[([^\]]*)\]/g, (_, inner) => {
    const [expr, fmt] = inner.split('|');
    if (!/\{[a-z0-9_]+\}/i.test(expr)) return '[' + inner + ']';
    return fmtNum(calc(expr, value), fmt == null ? '~' : fmt);
  });
  return s.replace(/{br}/gi, ' ').replace(/\{v?value\d?\}/gi, (ph) => fmtNum(valueFor(ph, value), '~')).replace(/\s+/g, ' ').trim();
}

// A skill augment temper ("Flurry hits twice") has no text in d2core's or maxroll's data – only the
// placeholder "+100 All Stats". Its key says what it is: Tempered_Hit_Twice_Skill_Rogue_Flurry_Tier3.
const AUGMENT = { Hit_Twice: 'hits twice', Double_Damage: 'double damage', Projectiles: 'extra projectiles', Duration: 'longer duration',
  Size: 'larger area', MovementSpeed: 'movement speed', Special: 'special effect' };
const spaced = (s) => String(s).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b(Of|The|And|To)\b/g, (w, x, i) => (i ? w.toLowerCase() : w)).trim();
function augmentText(key) {
  const k = String(key || '');
  let m = k.match(/^Tempered_([A-Za-z_]+?)_Skill_[A-Za-z]+?_([A-Za-z]+)(?:_([A-Za-z_]+?))?_?Tier\d$/);
  if (m) return spaced(m[2]) + ' ' + (AUGMENT[m[1]] || spaced(m[1]).toLowerCase()) + (m[3] ? ' (' + spaced(m[3]).toLowerCase() + ')' : '') + ' – skill augment';
  if (/^Tempered_PassiveRankBonus_/.test(k)) { const last = k.replace(/_?Tier\d$/, '').split('_').pop(); if (/^[A-Z][a-z]/.test(last)) return spaced(last) + ' rank bonus – augment'; }
  // any other shape: its words, without the class and the bookkeeping parts
  const rest = k.replace(/^Tempered_/, '').replace(/_?Tier\d$/, '').split('_')
    .filter((w) => w && !/^(Skill|Tag|X\d|Barb|Barbarian|Druid|Rogue|Sorc|Sorcerer|Necro|Necromancer|Spiritborn|Paladin|Warlock)$/.test(w));
  return rest.length ? spaced(rest.join(' ')) + ' – augment' : '';
}
/** A rolled stat's line by its affix key – a skill augment by its name, not by the placeholder. */
function affixText(key, tpl, value) {
  if (/^Tempered_/i.test(String(key)) && /All Stats/i.test(String(tpl))) { const a = augmentText(key); if (a) return a; }
  return statText(tpl, value);
}

/** Stats saved by affix id with their rolls (maxroll: {nid, values, greater}). */
function statsFromIds(d, list, tempered) {
  return (Array.isArray(list) ? list : []).map((e) => {
    const key = e && d && d.affixId && d.affixId[e.nid];
    const tpl = key && d.affix[key];
    // maxroll marks the affix the masterwork capstone goes to with "upgrade": 1
    return tpl ? Object.assign({ t: affixText(key, tpl, e.values || []) }, e.greater ? { g: 1 } : {}, tempered ? { tmp: 1 } : {}, e.upgrade === 1 ? { mw: 1 } : {}) : null;
  }).filter(Boolean);
}

/** "{c_number}50%{/c}" and friends -> plain text. */
const plain = (s) => String(s || '').replace(/\{br\}/gi, ' ').replace(/\{\/?c(_[a-z]+)?\}|\{\/?[biu]\}|\{icon:[^}]*\}/gi, '').replace(/\[\+\]|\[x\]/g, (m) => (m === '[x]' ? '[x]' : '')).trim();

// ---- slimming ----------------------------------------------------------------------------
function slimAffix(j) {
  const out = {};
  for (const a of (j && j.affix) || []) if (a && a.key) out[a.key] = a.descTpl || a.desc || '';
  return out;
}

/** Affix id -> key (maxroll saves stats by the numeric id). */
function affixIds(...lists) {
  const out = {};
  for (const l of lists) for (const a of l || []) if (a && a.key && a.id) out[a.id] = a.key;
  return out;
}

function slimSockets(...lists) {
  const out = {};
  for (const l of lists) for (const x of Array.isArray(l) ? l : Object.values(l || {})) if (x && x.key) out[x.key] = x.name || x.engName || x.key;
  return out;
}

/**
 * Season 15's runes, a pair in an item: a condition rune gains Offering when its condition is met
 * ("Cast a Skill with a Cooldown" – 50), an effect rune spends it ("Requires 600 Offering … Gain 25%
 * Deadly Strike Chance for 10 seconds", with its own cooldown).
 * @returns [{ name, kind: 'condition'|'effect', value, cd, text, overflow }]
 */
function slimRunes(j) {
  const out = [];
  for (const x of Array.isArray(j) ? j : Object.values(j || {})) {
    if (!x || !x.name || !/Rune$/.test(x.type || '')) continue;
    const lines = (x.affixesDesc || []).map((l) => plain(l.line).replace(/\{\/?c\]?/g, '').trim()).filter(Boolean);
    const body = lines.filter((l) => !/^(Gain|Requires):/.test(l) && !/^Cooldown:/.test(l));
    const cd = (lines.map((l) => /^Cooldown:\s*([\d.]+)/.exec(l)).find(Boolean) || [])[1];
    const text = body.join(' ').replace(/\s*\(Overflow:[^)]*\)/, '').trim();
    const over = (/\(Overflow:\s*([^)]*)\)/.exec(body.join(' ')) || [])[1] || '';
    out.push({ name: x.engName || x.name, kind: /Condition/.test(x.type) ? 'condition' : 'effect', value: Number(x.value) || 0, cd: cd ? Number(cd) : 0, text, overflow: over });
  }
  return out;
}

/** The skill tree per class: node positions, links, and what each node grants. */
function slimTree(j) {
  const out = {};
  for (const cls of CLASSES) {
    const t = j && j[cls];
    if (!t || !Array.isArray(t.nodes)) continue;
    out[cls] = {
      nodes: t.nodes.map((n) => {
        const r = n.reward || null;
        return {
          x: Math.round(n.pos.x), y: Math.round(n.pos.y),
          // root 1 = where a branch starts, root 2 = a crossing on the way
          k: r ? (r.type === 1 ? 'mod' : 'skill') : (n.root === 1 ? 'root' : 'link'),
          id: r ? r.id : 0, mod: r && r.type === 1 ? r.mod : 0, ranks: r ? r.ranks : 0,
          // the game's node id (maxroll saves ranks by it) and the skill's key ("Rogue_RainofArrows")
          nid: n.id, pw: r && r.type !== 1 ? r.power || '' : '',
        };
      }),
      links: [],
    };
    // node1/node2 are positions in the node list, the corners bend the line; the file keeps
    // links both on the tree and on the nodes, so the two lists are merged
    const seen = new Set();
    const add = (c) => {
      if (!(c.node1 < t.nodes.length && c.node2 < t.nodes.length)) return;
      const k = Math.min(c.node1, c.node2) + '-' + Math.max(c.node1, c.node2);
      if (seen.has(k)) return;
      seen.add(k);
      out[cls].links.push([c.node1, c.node2].concat(...(c.corners || []).map((p) => [Math.round(p.x), Math.round(p.y)])));
    };
    (t.connections || []).forEach(add);
    t.nodes.forEach((n) => (n.connections || []).forEach(add));
  }
  return out;
}

/** Skill names, icons and texts by id; the mods by "skill_mod". */
function slimSkills(j) {
  const out = {};
  for (const s of Array.isArray(j) ? j : Object.values(j || {})) {
    if (!s || !s.id) continue;
    out[s.id] = {
      name: s.name, icon: s.icon || 0, cls: s.char || '',
      desc: (s.desc || []).map(plain), val: s.val1 || null,
      mods: Object.fromEntries((s.mods || []).map((m) => [m.id, { name: m.name, desc: (m.desc || []).map(plain).join(' ') }])),
    };
  }
  return out;
}

/** Paragon boards per class (21 x 21 grids of node keys), the nodes and the glyphs. */
function slimParagon(j) {
  const out = { boards: {}, nodes: {}, glyphs: {} };
  const node = (k, n) => {
    out.nodes[k] = { name: n.name || k, r: n.rarity || 0, d: plain(n.desc || ''),
      t: n.gate ? 'gate' : n.socket ? 'socket' : n.start ? 'start' : '', ic: n.iconMask || 0 };
  };
  for (const [part, v] of Object.entries(j || {})) {
    if (!v || typeof v !== 'object' || !v.node) continue;
    for (const [k, n] of Object.entries(v.node)) if (!out.nodes[k]) node(k, n);
    for (const [k, b] of Object.entries(v.board || {})) out.boards[k] = { name: b.name, cls: part, rows: b.data };
    for (const [k, g] of Object.entries(v.glyph || {})) {
      if (!out.glyphs[k]) {
        const lg = g.legendary || {};
        out.glyphs[k] = { name: g.name, desc: plain(g.desc || '').replace(/\{val1\}/g, '…'), bonus: plain(g.bonus || ''),
          // the numbers: "+{val1}%" = base + perLevel × (rank − 1); radius = startingSize + one per size step reached;
          // the bonus needs that much of the attribute in range; the legendary bonus comes at its rank
          tpl: plain(g.desc || ''), base: Number(g.base) || 0, perLevel: Number(g.perLevel) || 0, attrs: g.scalingAttributes || [], divisor: Number(g.scalingDivisor) || 0,
          need: (g.threshold_requirements || []).map((t) => ({ attr: t.name, v: Number(t.value) || 0 })), size: Number(g.startingSize) || 3, steps: g.sizeIncrements || [25, 50],
          legendary: lg.desc ? { tpl: plain(lg.desc), base: Number((lg.scalar || {}).base) || 0, perLevel: Number((lg.scalar || {}).perLevel) || 0, factor: Number((lg.scalar || {}).displayFactor) || 100, at: Number(lg.unlockLevel) || 46 } : null };
      }
    }
  }
  return out;
}

/** Charms and seals by game key, the charm sets with their bonuses, and the charm stat templates. */
function slimTalisman(j) {
  const out = { items: {}, sets: {}, affix: {} };
  const list = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
  for (const c of list(j && j.charm).concat(list(j && j.seal))) {
    if (!c || !c.key) continue;
    out.items[c.key] = { name: c.name || c.engName || c.key, q: c.quality || '', type: c.type || '', set: c.set || '',
      d: (c.affixesDesc || []).map(plain).filter(Boolean) };
  }
  for (const [k, s] of Object.entries((j && j.itemSets) || {})) {
    out.sets[k] = { name: s.name || s.engName || k,
      bonuses: (s.bonuses || []).map((b) => ({ n: b.required, d: (b.affixesDesc || []).map(plain).filter(Boolean) })) };
  }
  for (const a of list(j && j.affixes && j.affixes.charm).concat(list(j && j.affixes && j.affixes.seal))) {
    if (a && a.key) out.affix[a.key] = a.descTpl || a.desc || '';
  }
  return out;
}

// ---- shared by the three importers -----------------------------------------------------------
/**
 * Charms of a build: the seal, each charm (with its rolled stats when there are any) and the sets
 * they make up – a set bonus counts as active when enough charms of it are worn (the seal may
 * lower that number: "Reduces the number of Charms needed for Set bonuses by 1").
 * @param {Array<{key?, name?, mods?}>} pieces  game keys (d2core, maxroll) or names (d4builds)
 */
function charmsOf(d, pieces) {
  const t = d && d.talisman;
  if (!t || !pieces || !pieces.length) return null;
  const byName = new Map(Object.entries(t.items).map(([k, x]) => [x.name.toLowerCase(), k]));
  let seal = null;
  const list = [];
  for (const p of pieces) {
    const key = p.key && t.items[p.key] ? p.key : byName.get(String(p.name || '').toLowerCase());
    const it = key && t.items[key];
    if (!it) { if (p.name) list.push({ name: String(p.name), q: '', set: '', stats: [] }); continue; }
    const stats = p.stats || (p.explicits ? statsFromIds(d, p.explicits) : (p.mods || []).map((m) => {
      const tpl = t.affix[m.name] || d.affix[m.name];
      return tpl ? { t: statText(tpl, m.value) } : null;
    }).filter(Boolean));
    const e = { name: it.name, q: it.q, set: it.set && t.sets[it.set] ? t.sets[it.set].name : '', stats, d: it.d };
    if (/seal/i.test(it.type)) seal = e; else list.push(e);
  }
  const fewer = seal ? Number(((seal.d || []).join(' ').match(/needed for Set bonuses by (\d+)/i) || [])[1] || 0) : 0;
  const sets = [];
  for (const s of Object.values(t.sets)) {
    const have = list.filter((c) => c.set === s.name).length;
    if (!have) continue;
    sets.push({ name: s.name, have, bonuses: s.bonuses.map((b) => ({ n: b.n, d: b.d, on: have >= Math.max(2, b.n - fewer) })) });
  }
  return seal || list.length ? { seal, list, sets } : null;
}

/** Spent ranks keyed the way d2core keeps them ("skillId", "skillId_modId"), from the game's node ids (maxroll). */
function ranksFromNodes(d, cls, byNode) {
  const t = d && d.tree && d.tree[cls];
  if (!t) return {};
  const at = new Map(t.nodes.map((n) => [String(n.nid), n]));
  const out = {};
  for (const [nid, r] of Object.entries(byNode || {})) {
    const n = at.get(String(nid));
    if (!n || !(Number(r) > 0) || !n.id) continue;
    out[n.k === 'mod' ? n.id + '_' + n.mod : String(n.id)] = Number(r);
  }
  return out;
}

/** The skill bar from skill keys ("Rogue_RainofArrows"), with names, icons and the ranks spent. */
function barFromKeys(d, cls, keys, ranks) {
  const t = d && d.tree && d.tree[cls];
  return (keys || []).filter(Boolean).map((k) => {
    const n = t && t.nodes.find((x) => x.pw === k);
    const s = n && d.skills[n.id];
    return { name: s ? s.name : String(k).replace(/^[A-Za-z]+_/, '').replace(/([a-z])([A-Z])/g, '$1 $2'),
      id: n ? n.id : 0, icon: s ? s.icon : 0, rank: n ? (ranks || {})[n.id] || 0 : 0,
      mods: s && n ? Object.keys(ranks || {}).filter((x) => x.startsWith(n.id + '_')).map((x) => (s.mods[x.split('_')[1]] || {}).name).filter(Boolean) : [] };
  });
}

/** A d2core glyph key by the glyph's name ("Devious" -> "ParagonGlyph_…"). */
function glyphByName(d, name) {
  const g = d && d.paragon && Object.entries(d.paragon.glyphs).find(([, x]) => x.name.toLowerCase() === String(name || '').toLowerCase());
  return g ? g[0] : '';
}

// ---- loading -----------------------------------------------------------------------------
/** The build and revision the site currently uses, read from its web bundle. */
// the bundle is large – read once a day; it also names the current season (its build lists filter by it)
let siteInfo = null;
async function currentBuild(net) {
  if (siteInfo && Date.now() - siteInfo.at < 24 * 3600 * 1000) return siteInfo.v;
  try {
    const page = await (await net.fetch(SITE)).text();
    const m = page.match(/src="(\/assets\/index-[^"]+\.js)"/);
    if (!m) return FALLBACK;
    const js = await (await net.fetch('https://www.d2core.com' + m[1])).text();
    const b = js.match(/D4_BUILD_VERSION="(\d+)"/);
    const r = js.match(/D4_DATA_REVISION=(\d+)/);
    const s = js.match(/DEFAULT_BUILD_SEASON_BY_GAME=\{d4:(\d+)/);
    const v = b && r ? { build: b[1], rev: r[1], season: s ? Number(s[1]) : FALLBACK.season } : FALLBACK;
    siteInfo = { at: Date.now(), v };
    return v;
  } catch (_) { return FALLBACK; }
}

async function fetchDb(net, log) {
  const v = await currentBuild(net);
  const get = async (name) => {
    const res = await net.fetch(`${HOST}/data/d4/${v.build}/${name}_enUS.json?env=prod&v=${v.rev}`);
    if (!res.ok) throw new Error(name + ': HTTP ' + res.status);
    return res.json();
  };
  const [affix, tree, skills, paragon, gem, rune, splinter, talisman] = await Promise.all(
    ['affix', 'skilltree', 'skills', 'paragon', 'gem', 'rune', 'soulSplinter', 'talisman'].map(get));
  const out = {
    version: VERSION, fetchedAt: Date.now(), build: v.build,
    affix: slimAffix(affix), socket: slimSockets(gem, rune, splinter), runes: slimRunes(rune),
    tree: slimTree(tree), skills: slimSkills(skills), paragon: slimParagon(paragon), talisman: slimTalisman(talisman),
  };
  // charm and seal stats are stats like any other
  Object.assign(out.affix, out.talisman.affix);
  const tl = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
  out.affixId = affixIds(affix.affix, tl(talisman.affixes && talisman.affixes.charm), tl(talisman.affixes && talisman.affixes.seal));
  if (log) log('d2core database: build', v.build, Object.keys(out.affix).length, 'stats,', Object.keys(out.paragon.boards).length, 'paragon boards');
  try { fs.writeFileSync(file, JSON.stringify(out)); } catch (_) {}
  return out;
}

/** The database, fetched the first time and once a week after that; an old copy beats none. */
async function load(net, log) {
  if (db && Date.now() - db.fetchedAt < MAX_AGE) return db;
  if (!pending) {
    pending = fetchDb(net, log)
      .then((d) => { db = d; return d; })
      .catch((e) => { if (log) log('d2core database failed:', e.message); if (db) return db; throw e; })
      .finally(() => { pending = null; });
  }
  return pending;
}

/** What the skill tree view needs for one class. */
function treeFor(d, cls) {
  const t = d && d.tree && d.tree[cls];
  if (!t) return null;
  const ids = new Set(t.nodes.map((n) => n.id).filter(Boolean));
  const skills = {};
  for (const id of ids) if (d.skills[id]) skills[id] = d.skills[id];
  return { nodes: t.nodes, links: t.links, skills };
}

/** What the paragon view needs for the boards a build uses. */
function paragonFor(d, boardKeys) {
  const p = d && d.paragon;
  if (!p) return null;
  const boards = {};
  const nodes = {};
  for (const k of boardKeys || []) {
    const b = p.boards[k];
    if (!b) continue;
    boards[k] = b;
    for (const row of b.rows) for (const n of String(row).split(',')) if (n && p.nodes[n]) nodes[n] = p.nodes[n];
  }
  return { boards, nodes, glyphs: p.glyphs };
}

module.exports = { configure, load, slimRunes, currentBuild, statText, affixText, augmentText, statsFromIds, fmtNum, plain, treeFor, paragonFor, charmsOf, ranksFromNodes, barFromKeys, glyphByName,
  slimAffix, affixIds, slimTree, slimSkills, slimParagon, slimSockets, slimTalisman, CLASSES, VERSION };
