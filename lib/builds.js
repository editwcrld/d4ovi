'use strict';
// Saved builds for the farm list.
//
// They live in builds.json in the data folder – the folder that sits next to the portable
// .exe – so copying that folder (or only this file) takes them to another PC, the same way
// map-progress.json carries the map marks. On top of that a single build can be passed on as
// a short text code (clipboard) and all of them exported to / imported from a file.
const fs = require('fs');
const path = require('path');

const VERSION = 1;
const CODE_PREFIX = 'D4B1:';
const MAX_BUILDS = 50;
const MAX_DONE = 200;                     // a build has ~12 slots, 2 aspects, 11 charms, ~20 sockets – far below
const SLOT_KEYS = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand', 'Weapon 2', 'Weapon 3'];
const CLASSES = ['All', 'Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];

let file = null;
let log = () => {};

function configure(opts) {
  if (opts && opts.file) file = opts.file;
  if (opts && opts.log) log = opts.log;
}

const str = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').trim().slice(0, max || 80);
const newId = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/**
 * One slot: either a unique/mythic item or up to two aspects. An imported item also brings its
 * rolled stats (g = greater affix, tmp = tempered) and what sits in its sockets.
 */
function cleanSlot(s) {
  if (!s || typeof s !== 'object') return null;
  let out = null;
  if (s.item) out = { item: str(s.item) };
  else {
    const aspects = (Array.isArray(s.aspects) ? s.aspects : []).map((a) => str(a)).filter(Boolean).slice(0, 2);
    if (aspects.length) out = { aspects };
  }
  if (!out) return null;
  if (s.base) out.base = str(s.base, 30);          // the kind of weapon ("Bow", "Sword")
  const stats = (Array.isArray(s.stats) ? s.stats : []).filter((x) => x && x.t).slice(0, 14)
    .map((x) => Object.assign({ t: str(x.t, 120) }, x.g ? { g: 1 } : {}, x.tmp ? { tmp: 1 } : {}));
  if (stats.length) out.stats = stats;
  const sockets = (Array.isArray(s.sockets) ? s.sockets : []).map((x) => str(x, 60)).filter(Boolean).slice(0, 4);
  if (sockets.length) out.sockets = sockets;
  return out;
}

const int = (v, lo, hi) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo; };
const KEY = /^[A-Za-z0-9_]{1,60}$/;

/** Where an imported build came from, so the overlay can link back to it. */
function cleanSource(s) {
  if (!s || typeof s !== 'object' || !/^https:\/\/(www\.)?(maxroll\.gg|d4builds\.gg|d2core\.com)\//i.test(String(s.url || ''))) return null;
  return { site: str(s.site, 20), url: str(s.url, 300), title: str(s.title, 120) };
}

/** Equipped skills, and – from d2core – the ranks spent in the skill tree ("skillId" / "skillId_modId"). */
function cleanSkills(s) {
  if (!s || typeof s !== 'object') return null;
  const bar = (Array.isArray(s.bar) ? s.bar : []).slice(0, 8).map((x) => ({
    name: str(x && x.name, 60), id: int(x && x.id, 0, 1e10), rank: int(x && x.rank, 0, 99), icon: int(x && x.icon, 0, 1e10),
    mods: (Array.isArray(x && x.mods) ? x.mods : []).map((m) => str(m, 60)).filter(Boolean).slice(0, 4),
  })).filter((x) => x.name);
  const ranks = {};
  if (s.ranks && typeof s.ranks === 'object') {
    for (const [k, v] of Object.entries(s.ranks).slice(0, 500)) if (/^\d{1,12}(_\d{1,12})?$/.test(k) && Number(v) > 0) ranks[k] = int(v, 0, 99);
  }
  if (!bar.length && !Object.keys(ranks).length) return null;
  return Object.assign({ bar }, Object.keys(ranks).length ? { ranks } : {});
}

/** Seal, charms (name, quality, set, rolled stats, effect) and the sets they make up. */
function cleanCharms(c) {
  if (!c || typeof c !== 'object') return null;
  const lines = (a, n, max) => (Array.isArray(a) ? a : []).map((x) => str(x, max || 300)).filter(Boolean).slice(0, n);
  const charm = (x) => (x && x.name ? {
    name: str(x.name, 60), q: str(x.q, 12), set: str(x.set, 60),
    stats: (Array.isArray(x.stats) ? x.stats : []).filter((s) => s && s.t).slice(0, 8).map((s) => ({ t: str(s.t, 120) })),
    d: lines(x.d, 4),
  } : null);
  const seal = charm(c.seal);
  const list = (Array.isArray(c.list) ? c.list : []).map(charm).filter(Boolean).slice(0, 10);
  const sets = (Array.isArray(c.sets) ? c.sets : []).slice(0, 6).filter((s) => s && s.name).map((s) => ({
    name: str(s.name, 60), have: int(s.have, 0, 10),
    bonuses: (Array.isArray(s.bonuses) ? s.bonuses : []).slice(0, 6).map((b) => ({ n: int(b && b.n, 0, 10), d: lines(b && b.d, 4), on: !!(b && b.on) })),
  }));
  return seal || list.length ? { seal, list, sets } : null;
}

/** Paragon boards as d2core names them, placed on a board grid (x right, y down), turned clockwise. */
function cleanParagon(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.boards)) return null;
  const boards = p.boards.slice(0, 14).filter((b) => b && KEY.test(String(b.k || ''))).map((b) => Object.assign(
    { k: String(b.k), x: int(b.x, -20, 20), y: int(b.y, -20, 20), rot: int(b.rot, 0, 3) },
    b.glyph && KEY.test(String(b.glyph)) ? { glyph: String(b.glyph), glyphRank: int(b.glyphRank, 0, 999) } : {},
    { nodes: (Array.isArray(b.nodes) ? b.nodes : []).slice(0, 441)
      .filter((n) => Array.isArray(n) && n.length === 2).map((n) => [int(n[0], 0, 20), int(n[1], 0, 20)]) },
  ));
  return boards.length ? { boards } : null;
}

/** Brings a build from a file, a code or the overlay into a known shape. */
function cleanBuild(b) {
  if (!b || typeof b !== 'object') return null;
  const slots = {};
  for (const k of SLOT_KEYS) {
    const s = cleanSlot(b.slots && b.slots[k]);
    if (s) slots[k] = s;
  }
  const out = {
    id: /^[a-z0-9]{4,24}$/i.test(String(b.id || '')) ? String(b.id) : newId(),
    name: str(b.name, 40) || 'Build',
    cls: CLASSES.includes(b.cls) ? b.cls : 'All',
    slots,
    done: [],
    updatedAt: Number(b.updatedAt) || Date.now(),
  };
  const source = cleanSource(b.source);
  const skills = cleanSkills(b.skills);
  const paragon = cleanParagon(b.paragon);
  const charms = cleanCharms(b.charms);
  if (source) out.source = source;
  if (skills) out.skills = skills;
  if (paragon) out.paragon = paragon;
  if (charms) out.charms = charms;
  // only ticks for what the build still holds – a swapped item must not leave its tick behind
  const keys = tickKeys(out);
  out.done = [...new Set((Array.isArray(b.done) ? b.done : []).map((x) => str(x)))].filter((k) => keys.has(k)).slice(0, MAX_DONE);
  return out;
}

/**
 * Everything in a build that can be ticked off, by the key the farm list uses: the item or
 * aspect name, "c:<charm>" for the seal and the charms, "s:<gem/rune>" for what sits in a socket.
 */
function tickKeys(b) {
  const keys = new Set();
  for (const s of Object.values(b.slots || {})) {
    if (s.item) keys.add(s.item);
    (s.aspects || []).forEach((a) => keys.add(a));
    (s.sockets || []).forEach((x) => keys.add('s:' + x));
  }
  const ch = b.charms;
  if (ch && ch.seal) keys.add('c:' + ch.seal.name);
  ((ch && ch.list) || []).forEach((c) => keys.add('c:' + c.name));
  return keys;
}

function empty() {
  const b = cleanBuild({ name: 'My build' });
  return { version: VERSION, active: b.id, builds: [b] };
}

function clean(d) {
  if (!d || typeof d !== 'object' || !Array.isArray(d.builds)) return empty();
  const builds = d.builds.map(cleanBuild).filter(Boolean).slice(0, MAX_BUILDS);
  if (!builds.length) return empty();
  const seen = new Set();
  for (const b of builds) { while (seen.has(b.id)) b.id = newId(); seen.add(b.id); }
  const active = builds.some((b) => b.id === d.active) ? d.active : builds[0].id;
  return { version: VERSION, active, builds };
}

function load() {
  try { return clean(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch (_) { return empty(); }
}

function save(d) {
  const out = clean(d);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(Object.assign({ savedAt: new Date().toISOString() }, out), null, 1));
  } catch (e) { log('could not save builds:', e.message); }
  return out;
}

// ---- passing builds on ---------------------------------------------------
/** A single build as a text code that fits into a chat message. */
function toCode(b) {
  const c = cleanBuild(b);
  // the code stays short: gear only – the link back to the site brings the rest
  const s = {};
  for (const [k, v] of Object.entries(c.slots)) s[k] = v.item ? { item: v.item } : { aspects: v.aspects };
  const slim = Object.assign({ n: c.name, c: c.cls, s }, c.source ? { u: c.source } : {});
  return CODE_PREFIX + Buffer.from(JSON.stringify(slim), 'utf8').toString('base64');
}

/**
 * Reads what the user pasted or opened: a build code, a single build or a whole builds.json.
 * @returns {Array} cleaned builds (new ids, so nothing gets overwritten)
 */
function parseImport(text) {
  const t = String(text || '').trim();
  let raw = null;
  if (t.startsWith(CODE_PREFIX)) {
    try {
      const j = JSON.parse(Buffer.from(t.slice(CODE_PREFIX.length).replace(/\s+/g, ''), 'base64').toString('utf8'));
      raw = [{ name: j.n, cls: j.c, slots: j.s, source: j.u }];
    } catch (_) { return []; }
  } else {
    try {
      const j = JSON.parse(t);
      raw = Array.isArray(j) ? j : Array.isArray(j.builds) ? j.builds : [j];
    } catch (_) { return []; }
  }
  return raw.map((b) => cleanBuild(Object.assign({}, b, { id: null }))).filter((b) => b && (Object.keys(b.slots).length || b.name !== 'Build'));
}

/** Adds imported builds; a name that already exists gets " (2)" instead of replacing it. */
function merge(d, incoming) {
  const out = clean(d);
  const names = new Set(out.builds.map((b) => b.name.toLowerCase()));
  for (const b of incoming) {
    let name = b.name, i = 2;
    while (names.has(name.toLowerCase())) name = b.name + ' (' + i++ + ')';
    names.add(name.toLowerCase());
    out.builds.push(Object.assign({}, b, { name }));
  }
  out.builds = out.builds.slice(0, MAX_BUILDS);
  if (incoming.length) out.active = out.builds[out.builds.length - 1].id;
  return out;
}

module.exports = { configure, load, save, clean, cleanBuild, tickKeys, toCode, parseImport, merge, empty, SLOT_KEYS, CLASSES, VERSION };
