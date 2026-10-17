'use strict';
// Builds from maxroll.gg: a build guide or a planner link becomes farm list builds.
//
//   guide page   maxroll.gg/d4/build-guides/…   server rendered; carries the link to its planner
//                profile ("d4/planner/uyz7y00t#4") and chips that name items by game id
//   planner      planners.maxroll.gg/profiles/d4/<id>   public JSON: one entry per variant
//                (Leveling, Starter, Endgame …), each with the items per gear slot
//   names        data.enus.json – the English strings of maxroll's game data; the item names
//                (season items included) by game id
//
// A unique comes in by name; a legendary by its aspects, whose ids are the same ids d4guides
// uses, so they match the farm list catalog directly.
const fs = require('fs');
const path = require('path');

const { buildName } = require('./buildfit');
const d2db = require('./d2coredb');
const guideinfo = require('./guideinfo');

const PROFILE_URL = 'https://planners.maxroll.gg/profiles/d4/';
const NAMES_URL = 'https://assets-ng.maxroll.gg/d4-tools/game/data.enus.json';
const NAMES_MAX_AGE = 7 * 24 * 3600 * 1000;

let namesFile = null;
let names = null;           // { 'Helm_Unique_Generic_005': "Leoric's Crown", 'Runeword_Enigma': 'Enigma', … }
let glyphIds = {};          // maxroll's glyph ids -> names ("Rare_059_Dexterity_Main": "Devious")
let aspectIds = {};         // { 'legendary_rogue_153_x2': 'Aspect of Aftermath', … } – d2core names aspects this way
let namesAt = 0;

function configure(opts) {
  if (opts && opts.namesFile) namesFile = opts.namesFile;
  try {
    const c = JSON.parse(fs.readFileSync(namesFile, 'utf8'));
    // a cache from before the aspects were kept is fetched again
    if (c && c.v === 2 && c.names && c.aspects && c.glyphs) { names = c.names; aspectIds = c.aspects; glyphIds = c.glyphs; namesAt = c.fetchedAt || 0; }
  } catch (_) { /* fetched on the first import */ }
}

/** A legendary affix of the game data -> the aspect's name ("Ferocious" -> "Ferocious Aspect"). */
function aspectOfAffix(a) {
  if (!a) return '';
  if (a.prefix) return a.prefix + ' Aspect';
  if (a.suffix) return 'Aspect ' + a.suffix;
  return '';
}

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };
const unent = (s) => String(s || '').replace(/&#x27;|&#39;|&amp;|&lt;|&gt;|&quot;/g, (e) => ENT[e]);

/** What the user pasted: a planner link (with the variant after #) or a guide page. */
function parseUrl(input) {
  const t = String(input || '').trim();
  const p = t.match(/maxroll\.gg\/d4\/planner\/([a-z0-9]{4,16})(?:#(\d+))?/i);
  if (p && /\d/.test(p[1])) return { kind: 'planner', id: p[1], variant: p[2] ? Number(p[2]) : 0 };
  if (/^[a-z0-9]{6,12}$/i.test(t) && /\d/.test(t)) return { kind: 'planner', id: t, variant: 0 };
  if (/^https?:\/\/(www\.)?maxroll\.gg\/d4\//i.test(t)) return { kind: 'guide', url: t.split('#')[0] };
  return null;
}

/** Planner profiles a guide links to, in page order. */
function plannerIds(html) {
  const out = [];
  for (const m of String(html).matchAll(/d4\/planner\/([a-z0-9]{4,16})(?:#(\d+))?/gi)) {
    if (!/\d/.test(m[1])) continue;                 // menu links like "d4/planner/builds", ids always have a digit
    if (!out.some((x) => x.id === m[1])) out.push({ id: m[1], variant: m[2] ? Number(m[2]) : 0 });
  }
  return out;
}

/** Item chips on a guide page: game id -> name. */
function embedNames(html) {
  const map = {};
  const s = String(html);
  for (const m of s.matchAll(/"text":"([^"]{1,80})","embedType":"d4-item","id":"([A-Za-z0-9_]+)"/g)) map[m[2]] = unent(m[1]);
  for (const m of s.matchAll(/data-d4-id="([A-Za-z0-9_]+)"\s+data-d4-text="([^"]{1,80})"/g)) map[m[1]] = map[m[1]] || unent(m[2]);
  return map;
}

/** Which of our slots an item goes into, from its game id ("S14_Ring_Unique_…", "1HFocus_Legendary_…"). */
function slotOfId(id) {
  const base = String(id || '').replace(/^(S\d+_|X\d+_)+/, '');
  // season and event tags may come first ("S05_BSK_Helm_Unique_…"): the first part that names a slot counts
  const parts = base.split('_').map((x) => x.toLowerCase());
  const known = /^(helm|chest|gloves|pants|legs|boots|ring|amulet|talisman|rune|gem|offhand|1h|2h|bow|crossbow|staff|wand|glaive|polearm|scythe|quarterstaff|sword|mace|axe|dagger|flail)/;
  const head = parts.find((x) => known.test(x)) || parts[0];
  if (/^talisman|^rune|^gem|soulsplinter/.test(head) || /^talisman/i.test(base)) return '';
  const fixed = { helm: 'Helm', chest: 'Chest Armor', gloves: 'Gloves', pants: 'Pants', legs: 'Pants', boots: 'Boots', ring: 'Ring', amulet: 'Amulet' };
  if (fixed[head]) return fixed[head];
  if (/^1h(focus|shield|totem)|^offhand/.test(head)) return 'Off-Hand';
  if (/^(1h|2h)|bow|crossbow|staff|wand|glaive|polearm|scythe|quarterstaff|sword|mace|axe|dagger/.test(head)) return 'Weapon';
  return '';
}

/** The kind of weapon an id names: "2HCrossbow_…" -> "Crossbow", "S05_BSK_1HSword_…" -> "Sword". */
function weaponOfId(id) {
  const m = String(id || '').match(/(?:^|_)(1H|2H)?(Bow|Crossbow|Sword|Axe|Mace|Dagger|Staff|Wand|Polearm|Scythe|Glaive|Quarterstaff|Flail)(?:_|$)/i);
  if (!m) return '';
  const kind = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase();
  return (m[1] && m[1].toUpperCase() === '2H' && !/bow|staff|polearm|glaive|quarterstaff/i.test(kind) ? 'Two-Handed ' : '') + kind;
}

/**
 * One planner variant -> a farm list build.
 * @param {object} variant    planner profile entry ({name, items: {slotNo: index}})
 * @param {Array}  pool       the planner's item list (data.items)
 * @param {object} ctx        { nameOf(id), aspectName(nid) }
 */
function toBuild(variant, pool, ctx, title, cls) {
  const slots = {};
  const missing = [];
  const extra = [];
  const order = Object.keys(variant.items || {}).map(Number).sort((a, b) => a - b);
  for (const no of order) {
    const it = pool[variant.items[no]];
    if (!it || !it.id) continue;
    // runewords carry no slot in their id ("Runeword_Enigma") – the item list knows it
    const slot = slotOfId(it.id) || (/^Runeword_/i.test(it.id) && ctx.slotOf ? ctx.slotOf(ctx.nameOf(it.id), it.id) : '');
    if (!slot) continue;                                       // talisman, charms, runes …
    let entry = null;
    const asp = (Array.isArray(it.aspects) ? it.aspects : []).map((a) => ctx.aspectName(a.nid)).filter(Boolean);
    if ((it.aspects || []).length > asp.length) missing.push('aspect on ' + slot);
    if (/unique|^Runeword_/i.test(it.id)) {
      // a unique keeps its name – an aspect on it is one transfigured onto it
      const name = ctx.nameOf(it.id);
      if (name) entry = Object.assign({ item: name }, itemExtras(it, ctx.db), asp.length ? { tf: asp[0] } : {}); else missing.push(it.id);
    } else if (asp.length) entry = Object.assign({ aspects: asp.slice(0, 2) }, itemExtras(it, ctx.db));
    if (!entry) continue;
    let key = slot;
    if (slot === 'Ring') key = slots.Ring1 ? 'Ring2' : 'Ring1';
    if (slot === 'Weapon') {
      const kind = weaponOfId(it.id);
      if (kind) entry.base = kind;
      // more weapons: a one-handed one into the off-hand (dual wield), the rest into Weapon 2 and 3
      if (slots.Weapon) key = [/(^|_)1H/i.test(it.id) ? 'Off-Hand' : '', 'Weapon 2', 'Weapon 3'].find((k) => k && !slots[k]) || '';
    }
    if (!key || slots[key]) { extra.push(entry.item || entry.aspects.join(' + ')); continue; }
    slots[key] = entry;
  }
  const db = ctx.db;
  // charms and the seal sit in the item list as well ("Talisman_Charm_…", "Talisman_Seal_…")
  const charms = order.map((no) => pool[variant.items[no]]).filter((it) => it && /^Talisman_/i.test(it.id))
    .map((it) => ({ key: it.id, explicits: it.explicits }));
  return {
    name: buildName(title, variant.name),
    cls, slots, missing, extra,
    skills: skillsOf(variant, cls, db), paragon: paragonOf(variant, ctx), charms: d2db.charmsOf(db, charms),
  };
}

/** Rolled stats (by affix id), tempering and sockets of one planner item, as text. */
function itemExtras(it, db) {
  if (!db) return {};
  const stats = d2db.statsFromIds(db, it.explicits).concat(d2db.statsFromIds(db, it.tempered, true));
  const sockets = (Array.isArray(it.sockets) ? it.sockets : []).map((k) => db.socket[k]).filter(Boolean);
  return Object.assign({}, stats.length ? { stats } : {}, sockets.length ? { sockets } : {});
}

/** The last step of the planner's skill tree (ranks by the game's node id) and the skill bar. */
function skillsOf(variant, cls, db) {
  const steps = (variant.skillTree && variant.skillTree.steps) || [];
  const last = steps.length ? steps[steps.length - 1].data : null;
  const ranks = db && last ? d2db.ranksFromNodes(db, cls, last) : {};
  const bar = d2db.barFromKeys(db, cls, variant.skillBar, ranks);
  return bar.length || Object.keys(ranks).length ? { bar, ranks } : null;
}

/**
 * The last step of the planner's paragon: board keys as d2core has them, the same grid and
 * turns (clockwise quarters), nodes as "row * 21 + column", glyphs by maxroll's own id.
 */
function paragonOf(variant, ctx) {
  const steps = (variant.paragon && variant.paragon.steps) || [];
  const last = steps.length ? steps[steps.length - 1].data : null;
  if (!Array.isArray(last)) return null;
  const boards = last.filter((b) => b && b.id).map((b) => Object.assign({
    k: String(b.id), x: Number(b.position && b.position.x) || 0, y: Number(b.position && b.position.y) || 0,
    rot: ((Number(b.rotation) || 0) % 4 + 4) % 4,
    nodes: Object.keys(b.nodes || {}).filter((k) => b.nodes[k]).map(Number).filter(Number.isFinite).map((i) => [Math.floor(i / 21), i % 21]),
  }, (() => {
    const g = b.glyph && d2db.glyphByName(ctx.db, ctx.glyphName(b.glyph));
    return g ? { glyph: g, glyphRank: Number(b.glyphLevel) || 0 } : {};
  })()));
  return boards.length ? { boards } : null;
}

const CLASS_NAMES = ['Sorcerer', 'Druid', 'Barbarian', 'Rogue', 'Necromancer', 'Spiritborn', 'Paladin', 'Warlock'];

async function loadNames(net, log) {
  if (names && Date.now() - namesAt < NAMES_MAX_AGE) return names;
  try {
    const res = await net.fetch(NAMES_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const slim = {};
    // only what can be worn – keeps the cache small; runewords ("Runeword_Enigma") count as uniques
    for (const [id, v] of Object.entries(j.items || {})) {
      if (v && v.name && ((slotOfId(id) && /unique/i.test(id)) || /^Runeword_/.test(id))) slim[id] = v.name;
    }
    const asp = {};
    for (const [id, v] of Object.entries(j.affixes || {})) if (/^legendary_/i.test(id) && aspectOfAffix(v)) asp[id] = aspectOfAffix(v);
    const gl = {};
    for (const [id, v] of Object.entries(j.paragonGlyphs || {})) if (v && v.name) gl[id] = v.name;
    names = slim; aspectIds = asp; glyphIds = gl; namesAt = Date.now();
    try { fs.writeFileSync(namesFile, JSON.stringify({ v: 2, fetchedAt: namesAt, names, aspects: aspectIds, glyphs: glyphIds })); } catch (_) {}
    if (log) log('maxroll item names:', Object.keys(names).length, 'aspects:', Object.keys(aspectIds).length);
  } catch (e) {
    if (log) log('maxroll item names failed:', e.message);
    if (!names) names = {};
  }
  return names;
}

/**
 * Reads a guide or planner link.
 * @param {{fetch:Function}} net
 * @param {string} input   what the user pasted
 * @param {object} catalog farm.catalog() – for the aspect ids
 * @returns {Promise<{title, cls, variants: Array, preselect: number}>}
 */
async function load(net, input, catalog, log) {
  const src = parseUrl(input);
  if (!src) throw new Error('Not a maxroll build guide or planner link');
  let chips = {};
  let ids = [];
  if (src.kind === 'guide') {
    const res = await net.fetch(src.url);
    if (!res.ok) throw new Error('Guide page: HTTP ' + res.status);
    const html = await res.text();
    ids = plannerIds(html);
    chips = embedNames(html);
    if (!ids.length) throw new Error('No planner build found on that page');
  } else ids = [{ id: src.id, variant: src.variant }];

  const [nameMap, db] = await Promise.all([loadNames(net, log), d2db.load(net, log).catch(() => null)]);
  const aspects = new Map(((catalog && catalog.aspects) || []).map((a) => [String(a.id), a.name]));
  const ctx = {
    nameOf: (id) => chips[id] || nameMap[id] || '',
    aspectName: (nid) => aspects.get(String(nid)) || '',
    glyphName: (id) => glyphIds[id] || '',
    // a runeword's slot from the item list; a weapon runeword names its kind in the id ("…_Bow")
    slotOf: (name, id) => {
      const n = String(name || '').toLowerCase();
      const it = ((catalog && catalog.items) || []).find((x) => x.name.toLowerCase() === n);
      if (/_(1H|2H)?(Bow|Crossbow|Sword|Axe|Mace|Dagger|Staff|Wand|Polearm|Scythe|Glaive|Quarterstaff)/i.test(id)) return 'Weapon';
      return it ? it.slot : '';
    },
    db,
  };

  const variants = [];
  let title = '', cls = 'All', preselect = 0;
  for (const p of ids.slice(0, 3)) {                          // a guide rarely links more than one
    const res = await net.fetch(PROFILE_URL + encodeURIComponent(p.id));
    if (!res.ok) { if (log) log('maxroll planner', p.id, 'HTTP ' + res.status); continue; }
    const j = await res.json();
    let d;
    try { d = typeof j.data === 'string' ? JSON.parse(j.data) : j.data; } catch (_) { continue; }
    if (!d || !Array.isArray(d.profiles)) continue;
    const pc = CLASS_NAMES.find((c) => new RegExp('^' + c, 'i').test(j.class || '')) || 'All';
    if (!title) { title = j.name || 'maxroll build'; cls = pc; }
    const at = p.variant ? p.variant - 1 : (Number(d.activeProfile) || 0);
    d.profiles.forEach((v, i) => {
      const b = toBuild(v, d.items || [], ctx, j.name || title, pc);
      if (!Object.keys(b.slots).length) return;
      if (p === ids[0] && i === at) preselect = variants.length;
      // the planner opens on a variant by its number after "#" (counted from 1)
      variants.push(Object.assign(b, { variant: v.name || 'Build', guide: guideinfo.extract('maxroll.gg', v),
        source: { site: 'maxroll.gg', url: 'https://maxroll.gg/d4/planner/' + p.id + '#' + (i + 1), title: j.name || title } }));
    });
  }
  if (!variants.length) throw new Error('The planner has no gear to import');
  return { title, cls, variants, preselect };
}

/** Item and aspect names by game id, for the other build sites that use the same ids (d2core). */
async function gameNames(net, log) {
  await loadNames(net, log);
  return { items: names || {}, aspects: aspectIds || {} };
}

module.exports = { configure, load, parseUrl, plannerIds, embedNames, slotOfId, weaponOfId, toBuild, aspectOfAffix, gameNames, CLASS_NAMES, PROFILE_URL, NAMES_URL };
