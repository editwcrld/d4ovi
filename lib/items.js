'use strict';
// The item database for the search: uniques, mythics, charms, sets, legendaries, gems, runes,
// lair keys / summoning items, materials … – with type, level, effect and description.
// The source is the game data maxroll.gg serves for its planner (English, as in the game).
const fs = require('fs');
const path = require('path');

const DATA_URL = 'https://assets-ng.maxroll.gg/d4-tools/game/data.min.json';
const MAX_AGE = 7 * 24 * 3600 * 1000;      // changes only with patches
const VERSION = 5;                          // 4: the item's picture (maxroll's image id) · 5: names without the game's codes
// maxroll keeps every item's picture under the game data's image id
const ICON_URL = 'https://assets-ng.maxroll.gg/d4-tools/images/webp/';

// keep the raw data's placeholders / test entries out
const JUNK_RE = /^\(|\bPTR\b|\bPH\b|\bQA\b|\bTEST\b|\bDNT\b|^\[|placeholder|unused/i;
// magicType in the game data
const RARITY = { 1: 'Magic', 2: 'Unique', 3: 'Legendary', 4: 'Mythic Unique' };
// types that do not look like gear but matter
const TYPE_LABEL = {
  BossSummoning: 'Lair boss key', Gem: 'Gem', Rune: 'Rune', Sigil: 'Sigil',
  Elixir: 'Elixir', Incense: 'Incense', Consumable: 'Consumable',
  CraftingMaterial: 'Material', TemperManual: 'Tempering manual', Charm: 'Charm',
};

let list = [];           // [{name, n, type, rarity, level, power, effects[], desc, flavor, set}]
let byNorm = new Map();
let cacheFile = null;
let fetchedAt = 0;

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Spiel-Markup entfernen: {icon:…}, {c_xyz}…{/c}, {if:…}{else}{/if}, {u}…{/u}
// sowie Rechenplatzhalter wie "[(Weapon_Damage_Min_Total+…)||]" -> "…"
function clean(s) {
  return String(s || '')
    .replace(/\{[^{}]*\}/g, '')                 // every control code in braces
    .replace(/\[[^\][]*\|[^\][]*\]/g, '…')      // placeholders with a formula (always contain "|")
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([,.;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// fills the number placeholders in effect templates: "x[{value}*100|%|] damage" + value 0.24 -> "x24% damage"
function fillLabel(label, attrs) {
  const v = attrs && attrs.length ? attrs[0].value : null;
  return clean(String(label || '').replace(/\[\{value\}([^\]]*)\]/g, (_, spec) => {
    if (v == null) return '…';
    const m = spec.match(/\*\s*([\d.]+)/);
    let x = m ? v * Number(m[1]) : v;
    x = Math.round(x * 10) / 10;
    return /\|%\|/.test(spec) ? x + '%' : String(x);
  }));
}

function build(data) {
  const items = data.items || {};
  const affixes = data.affixes || {};
  const types = data.itemTypes || {};
  const sets = data.itemSets || {};

  // set membership turned around: item id -> set name
  const setOfItem = new Map();
  for (const [, s] of Object.entries(sets)) {
    for (const b of s.bonuses || []) {
      const a = affixes[b.affix];
      if (a && a.power) setOfItem.set(a.power, s.name);
    }
  }

  const out = [];
  const seen = new Set();
  for (const [id, it] of Object.entries(items)) {
    // names carry the game's codes too ("{icon:Cube_TooltipIcon, 2} Raw Primordial Dust")
    const name = it && it.name && clean(it.name);
    if (!name || name.length < 2 || name.length > 60 || JUNK_RE.test(name)) continue;
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    const typeName = TYPE_LABEL[it.type] || (types[it.type] && types[it.type].name) || it.type || '';
    const rarity = RARITY[it.magicType] || '';

    // unique / mythic power: the affix that points at exactly this item
    let power = '';
    for (const ex of it.explicits || []) {
      const a = affixes[ex];
      if (a && a.desc && (a.power === id || !power)) { power = clean(a.desc); if (a.power === id) break; }
    }

    // gems: the three socket effects (weapon / armour / jewellery)
    const effects = (it.socketedEffects || []).map((e) => fillLabel(e.label, e.attributes)).filter(Boolean);

    // runes bring their own effect (plus offering / cooldown)
    if (it.rune) {
      if (it.rune.desc) power = clean(it.rune.desc);
      const bits = [];
      if (it.rune.value) bits.push('Offering ' + it.rune.value);
      if (it.rune.cooldown) bits.push('Cooldown ' + it.rune.cooldown + ' s');
      if (bits.length) effects.unshift(bits.join(' · '));
    }

    out.push({
      name, n: key, type: typeName, rarity,
      level: it.levelRequirement || 0,
      power, effects,
      desc: clean(it.desc || ''),
      flavor: clean(it.flavor || '').slice(0, 300),
      set: setOfItem.get(id) || '',
      icon: it.image ? ICON_URL + it.image + '.webp' : '',
    });
  }

  // the sets themselves are no items – added as entries of their own, so they can be searched for
  for (const [, s] of Object.entries(sets)) {
    const name = s && s.name && clean(s.name);
    if (!name || JUNK_RE.test(name)) continue;
    const key = norm(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const effects = (s.bonuses || []).map((b) => {
      const a = affixes[b.affix];
      return a && a.desc ? `${b.required} pieces: ${clean(a.desc)}` : '';
    }).filter(Boolean);
    out.push({ name, n: key, type: 'Set', rarity: '', level: 0, power: '', effects, desc: '', flavor: '', set: '' });
  }
  return out;
}

function setList(l) {
  list = Array.isArray(l) ? l : [];
  byNorm = new Map();
  for (const e of list) if (!byNorm.has(e.n)) byNorm.set(e.n, e);
  return list.length;
}

function configure(opts) {
  if (opts && opts.cacheFile) cacheFile = opts.cacheFile;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION && Array.isArray(c.list)) { setList(c.list); fetchedAt = c.fetchedAt || 0; }
  } catch (_) { /* no cache yet */ }
  return list.length;
}

// net.fetch (Electron) runs on Chromium's network stack – no extra package needed.
async function refresh(net, force) {
  if (!force && list.length && Date.now() - fetchedAt < MAX_AGE) return { count: list.length, updated: false };
  const res = await net.fetch(DATA_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const built = build(await res.json());
  if (built.length < 1000) throw new Error('Unerwartet wenige Items (' + built.length + ')');
  const count = setList(built);
  fetchedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, fetchedAt, list }));
  } catch (_) {}
  return { count, updated: true };
}

/**
 * Finds the items for a search – exact first, then "starts with", then "contains".
 * @returns {Array} at most `limit` entries
 */
function search(query, limit) {
  const q = norm(query);
  if (!q || q.length < 2 || !list.length) return [];
  const exact = byNorm.get(q);
  const starts = [], has = [];
  for (const e of list) {
    if (e === exact) continue;
    if (e.n.startsWith(q)) starts.push(e);
    else if (e.n.includes(q)) has.push(e);
    if (starts.length > 60) break;
  }
  const rank = (e) => (e.rarity === 'Mythic Unique' ? 0 : e.rarity === 'Unique' ? 1 : e.power || e.effects.length || e.desc ? 2 : 3);
  const byRank = (a, b) => rank(a) - rank(b) || a.name.length - b.name.length;
  return [].concat(exact ? [exact] : [], starts.sort(byRank), has.sort(byRank)).slice(0, limit || 6);
}

const get = (name) => byNorm.get(norm(name)) || null;
const count = () => list.length;
const age = () => fetchedAt;

/** Every item – for the pictures by name (lib/icons.js). */
const all = () => list;

module.exports = { configure, refresh, search, get, all, count, age, norm, build, setList, DATA_URL, ICON_URL, VERSION };
