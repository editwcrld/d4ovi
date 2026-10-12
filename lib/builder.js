'use strict';
// Builder: pick a class and the skill you want to play – it puts together what goes with it.
//
//   maxroll game data (data.min.json)  skills with their tags, aspects, uniques, charm sets,
//                                      key passives – every one of them carries the game's own
//                                      tags ("Skill_Channeled", "FILTER_Spender_Barb_Whirlwind",
//                                      "Archetype_Sorcerer_Shock_Signature" …)
//   d2core affix file                  what can roll on which slot for which class, the tempers
//   d2core database (lib/d2coredb)     glyph and paragon board texts
//   maxroll endgame tier list          proven guides for a skill
//
// Synergy is worked out from those tags and texts, not typed in by hand, so a new season's
// aspects are scored the day the data is there. The rules about what a stat is worth come from
// the damage formula (README → Builder) and are the only hand-made part.
const fs = require('fs');
const DM = require('./dmgmodel');
const OPT = require('./optimizer');
const d2db = require('./d2coredb');

const DATA_URL = 'https://assets-ng.maxroll.gg/d4-tools/game/data.min.json';
const TIER_URL = 'https://maxroll.gg/d4/tierlists/endgame-tier-list';
const MAX_AGE = 7 * 24 * 3600 * 1000;
const TIER_AGE = 24 * 3600 * 1000;
const VERSION = 1;

// the game's class order (classFilter, data.classes keys)
const CLASSES = ['Sorcerer', 'Druid', 'Barbarian', 'Rogue', 'Necromancer', 'Spiritborn', 'Paladin', 'Warlock'];
const MAIN_STAT = { Sorcerer: 'Intelligence', Druid: 'Willpower', Barbarian: 'Strength', Rogue: 'Dexterity',
  Necromancer: 'Intelligence', Spiritborn: 'Dexterity', Paladin: 'Strength', Warlock: 'Willpower' };
// what one point of the main stat is worth (d4guides, patch 3.2.1): % damage per 10 points
const STAT_PER10 = { Barbarian: 0.8, Druid: 1.625, Necromancer: 1.625, Paladin: 1.625, Sorcerer: 1.625, Rogue: 1.25, Spiritborn: 1.25, Warlock: 1.25 };
const ELEMENTS = ['Physical', 'Fire', 'Lightning', 'Cold', 'Poison', 'Shadow', 'Holy'];
// the words a description uses for an element besides its own name
const ELEMENT_WORDS = {
  Physical: ['Physical', 'Bleed', 'Bleeding'], Fire: ['Fire', 'Burning', 'Pyromancy', 'Hellfire'],
  Lightning: ['Lightning', 'Shock', 'Crackling Energy'], Cold: ['Cold', 'Frost', 'Chill', 'Frozen', 'Freeze'],
  Poison: ['Poison', 'Poisoned', 'Poisoning'], Shadow: ['Shadow', 'Darkness', 'Abyss'], Holy: ['Holy', 'Divine'],
};
// itemLabels on aspects -> our slots
const LABEL_SLOT = { 0: 'Weapon', 15: 'Off-Hand', 16: 'Helm', 17: 'Chest Armor', 19: 'Ring', 26: 'Amulet', 28: 'Gloves', 29: 'Boots', 30: 'Pants' };
// item types (maxroll and d2core use the same names) -> our slots
const TYPE_SLOT = { Helm: 'Helm', ChestArmor: 'Chest Armor', Gloves: 'Gloves', Legs: 'Pants', Boots: 'Boots', Amulet: 'Amulet', Ring: 'Ring',
  Shield: 'Off-Hand', Focus: 'Off-Hand', FocusBookOffHand: 'Off-Hand', OffHandTotem: 'Off-Hand', DruidOffhand: 'Off-Hand' };
const WEAPON_TYPES = /^(Sword|Sword2H|Axe|Axe2H|Mace|Mace2H|Mace2HDruid|Bow|Crossbow|Crossbow2H|Dagger|Staff|StaffDruid|StaffSorcerer|Scythe|Scythe2H|Polearm|Wand|Glaive|Quarterstaff|Flail|Amazon_Spear|Sword_Phase_Blade|Axe_Berserker_Axe)$/;
const slotOfType = (t) => TYPE_SLOT[t] || (WEAPON_TYPES.test(t) ? 'Weapon' : '');
// the slots of a build, the d2core item type standing for each when asking what rolls there
const GEAR = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand'];
const POOL_TYPE = { Helm: 'Helm', 'Chest Armor': 'ChestArmor', Gloves: 'Gloves', Pants: 'Legs', Boots: 'Boots', Amulet: 'Amulet', Ring: 'Ring' };
const WEAPON_OF = { Sorcerer: 'Wand', Druid: 'Mace2HDruid', Barbarian: 'Sword2H', Rogue: 'Dagger', Necromancer: 'Sword', Spiritborn: 'Glaive', Paladin: 'Mace', Warlock: 'Sword' };
const OFFHAND_OF = { Sorcerer: 'Focus', Druid: 'DruidOffhand', Necromancer: 'FocusBookOffHand', Paladin: 'Shield', Rogue: 'Dagger', Warlock: 'FocusBookOffHand' };
const CAT_OF = { FILTER_Legendary_Offensive: 'Offensive', FILTER_Legendary_Defensive: 'Defensive', FILTER_Legendary_Utility: 'Utility',
  FILTER_Legendary_Resource: 'Resource', FILTER_Legendary_Movement: 'Mobility' };

// Skill_ tags -> the words aspects and passives use for that group of skills
const FAMILY = {
  Skill_Primary_Basic: ['Basic'], Skill_Primary_Core: ['Core'], Skill_Primary_Ultimate: ['Ultimate'],
  Skill_Channeled: ['Channeled', 'Channeling'], Skill_Shout: ['Shout'], Skill_DualWield: ['Dual Wield'],
  Skill_Bludgeoning: ['Bludgeoning'], Skill_Slashing: ['Slashing'], Skill_Ancient: ['Ancient'],
  Skill_Marksman: ['Marksman'], Skill_Cutthroat: ['Cutthroat'], Skill_Imbueable: ['Imbued', 'Imbuement'], Skill_Trap: ['Trap'], Skill_Grenade: ['Grenade'],
  Skill_Bone: ['Bone'], Skill_Blood: ['Blood'], Skill_Shadow: ['Darkness'], Skill_Darkness: ['Darkness'], Skill_Corruption: ['Corruption'],
  Skill_Primary_Summoning: ['Minion', 'Summon'], Skill_Primary_Minion: ['Minion'],
  Skill_Nature_Magic: ['Nature Magic'], Skill_Nature_Magic_Earth: ['Earth'], Skill_Nature_Magic_Storm: ['Storm'],
  Skill_Shapeshifting: ['Shapeshifting'], Skill_Bear: ['Werebear'], Skill_Wolf: ['Werewolf'],
  Skill_Spirit_Plains: ['Jaguar'], Skill_Spirit_Forest: ['Gorilla'], Skill_Spirit_Soil: ['Centipede'], Skill_Spirit_Sky: ['Eagle'],
  Skill_Zealot: ['Zealot'], Skill_Juggernaut: ['Juggernaut'], Skill_Disciple: ['Disciple'], Skill_Divine: ['Judicator', 'Divine'],
  Skill_Hellfire: ['Hellfire'], Skill_Abyss: ['Abyss'], Skill_Occult: ['Occult'], Skill_Demonology: ['Demon'],
  Skill_Greater_Demon: ['Greater Demon'], Skill_Lesser_Demon: ['Lesser Demon'],
};
// a Sorcerer's element is a skill family of its own
const SORC_FAMILY = { Fire: 'Pyromancy', Lightning: 'Shock', Cold: 'Frost' };

let file = null;
let db = null;
let pending = null;

function configure(opts) {
  if (opts && opts.file) file = opts.file;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && c.version === VERSION && c.classes) db = c;
  } catch (_) { /* fetched on first use */ }
}

// ---- text -------------------------------------------------------------------------------
/** A formula from the game data worked out, when it is plain arithmetic once the rank is in; NaN otherwise. */
function evalFormula(expr, rank) {
  let s = String(expr == null ? '' : expr)
    .replace(/CurrentLegendaryRank\(\)/g, String(rank))
    .replace(/FloatRandomRangeWithInterval\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g, '$1')
    .replace(/FloatRandomRange\(\s*[\d.]+\s*,\s*([\d.]+)\s*\)/g, '$1');
  if (!/^[\d.+\-*/() ]+$/.test(s)) return NaN;
  try { const v = Function('"use strict";return (' + s + ')')(); return Number.isFinite(v) ? v : NaN; } catch (_) { return NaN; }
}

/**
 * The game's markup turned into a line to read: "{c_number}[Affix_Value_1*100|%x|]{/c}" -> "30%[x]".
 * Values that need the item level or the character are written as "#".
 */
function cleanDesc(desc, values) {
  const vals = values || [];
  // {if:…}A{else}B{/if}: the plain item's text is B; {if:…}A{/if} without else only colours A
  let s = String(desc || '');
  const IF = /\{if:[^}]*\}((?:(?!\{if:|\{\/if\}|\{else\}).)*)(?:\{else\}((?:(?!\{if:|\{\/if\}).)*))?\{\/if\}/s;
  for (let i = 0; i < 50 && IF.test(s); i++) s = s.replace(IF, (_, a, b) => (b != null ? b : a));
  s = s.replace(/\[([^\][|]*)\|([^\]|]*)\|?\]/g, (_, expr, fmt) => {
    let e = expr;
    e = e.replace(/Affix_Value_(\d)/g, (m, n) => (vals[n - 1] != null ? String(vals[n - 1]) : m));
    const v = evalFormula(e, 1);
    const pct = /%/.test(fmt), mul = /x/.test(fmt), plus = /\+/.test(fmt);
    const num = Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '#';
    return num + (pct ? '%' : '') + (mul ? '[x]' : plus && pct ? '[+]' : '');
  });
  return s.replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\{[^{}]*\}/g, '').replace(/\r?\n+/g, ' ').replace(/\s+/g, ' ').replace(/ ([,.;:])/g, '$1').trim();
}

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wordRe = (w) => new RegExp('\\b' + esc(w) + '(?:\'s?|s)?\\b', 'i');
const has = (text, w) => wordRe(w).test(text);

// ---- slimming -----------------------------------------------------------------------------
function aspectName(a) {
  if (a.prefix) return a.prefix.replace(/\s+$/, '') + ' Aspect';
  if (a.suffix) return 'Aspect ' + a.suffix.replace(/^\s+/, '');
  return '';
}
const classesOf = (f) => (Array.isArray(f) ? CLASSES.filter((c, i) => f[i]) : CLASSES.slice());
const clsLabel = (list) => (list.length >= 7 ? 'All' : list.join(' / '));

/** The values an affix rolls to at its best, for its description. */
function affixValues(a) {
  const rank = Math.max(...(a.maximumRank || [1]).filter((x) => x > 0), 1);
  return (a.attributes || []).map((x) => evalFormula(x.value, rank)).map((v) => (Number.isFinite(v) ? v : null));
}

/** Skills of a class: active skills with their category, element and tags; key passives. */
function slimClasses(data) {
  const out = {};
  // "…_Mod_RainofArrows_UpgradeB" -> variant, "…_Side1/2" or "…_Upgrade1/2" -> pair a, 3/4 -> pair b.
  // Modifier ids repeat across skills, so they are kept per skill.
  const modGroup = {};
  for (const [k, r] of Object.entries(data.skillTreeRewards || {})) {
    if (!r || r.type !== 1 || !r.mod) continue;
    modGroup[r.power + ':' + r.mod] = /_Upgrade[A-Z]$/.test(k) ? 'variant' : /_(Side|Upgrade)[12]$/.test(k) ? 'a' : /_(Side|Upgrade)[34]$/.test(k) ? 'b' : '';
  }
  for (const [i, c] of Object.entries(data.classes || {})) {
    const name = CLASSES[Number(i)];
    if (!name) continue;
    const cats = (data.skillCategories || {})[i] || null;
    const tree = (data.skillTrees || {})[c.tree] || { nodes: [] };
    const skills = [];
    for (const key of c.skills || []) {
      const s = data.skills[key];
      if (!s) continue;
      const catName = String((cats && cats[s.category]) || String(s.primaryTag || '').replace('Skill_Primary_', '') || '').replace(/_/g, ' ');
      const raw = String(s.desc || '');
      skills.push({
        key, name: s.name, cat: catName, el: s.damageType >= 0 ? ELEMENTS[s.damageType] || '' : '',
        tags: (s.tags || []).concat(s.primaryTag ? [s.primaryTag] : []),
        cd: /Cooldown:/i.test(raw), cost: /Cost:/i.test(raw), gen: /Generate /i.test(raw),
        dot: (s.tags || []).includes('Search_DoT') || /over \{?c?_?\w*\}?\[?[^\]]*\]?\s*seconds/i.test(raw),
        desc: cleanDesc(raw.replace(/^[\s\S]*?\n(?=[^{\n]*[a-z]{4})/, '')),
        // variant (one of three) and two pairs of upgrades (one of each) – how the tree offers them
        mods: (s.mods || []).map((m) => ({ id: m.id, name: m.name, desc: cleanDesc(m.desc), tags: m.tags || [], group: modGroup[key + ':' + m.id] || '' })),
      });
    }
    // key passives: one-rank passives in the tree
    const keyp = [];
    const seen = new Set();
    for (const n of tree.nodes || []) {
      const r = (data.skillTreeRewards || {})[n.rewardId];
      if (!r || r.type !== 2 || r.ranks !== 1 || seen.has(r.power)) continue;
      const s = data.skills[r.power];
      if (!s || !s.name) continue;
      seen.add(r.power);
      keyp.push({ key: r.power, name: s.name, desc: cleanDesc(s.desc).slice(0, 600), tags: s.tags || [] });
    }
    out[name] = {
      main: MAIN_STAT[name], resource: ((data.uiStrings || {}).resourceType || {})[c.primaryResource && c.primaryResource.type] || '',
      skills, keyPassives: keyp, boards: c.paragonBoards || [],
    };
  }
  return out;
}

/** Legendary aspects – the newest of each name, with the slots they fit and their category. */
function slimAspects(data) {
  const byName = new Map();
  for (const [key, a] of Object.entries(data.affixes || {})) {
    if (!a || a.magicType !== 1 || !a.desc || !a.power) continue;
    const cat = (a.tags || []).map((t) => CAT_OF[t]).find(Boolean);
    const name = aspectName(a);
    if (!cat || !name) continue;
    const prev = byName.get(name);
    if (prev && prev.id > a.id) continue;
    byName.set(name, {
      id: a.id, key, name, cat, cls: classesOf(a.classFilter), tags: a.tags || [],
      slots: [...new Set((a.itemLabels || []).map((l) => LABEL_SLOT[l]).filter(Boolean))],
      desc: cleanDesc(a.desc, affixValues(a)),
    });
  }
  return [...byName.values()].map((a) => { delete a.id; return a; });
}

/** Uniques and mythics that sit in a gear slot, with their power and the skill ranks they give. */
function slimUniques(data, d2affix) {
  const byName = new Map();
  for (const [key, it] of Object.entries(data.items || {})) {
    if (!it || (it.magicType !== 2 && it.magicType !== 4) || !it.name) continue;
    const slot = slotOfType(it.type);
    if (!slot) continue;
    const ex = (it.explicits || []).map((k) => [k, data.affixes[k]]).filter((x) => x[1]);
    const power = ex.find(([, a]) => a.desc && (a.power === key || a.magicType >= 2)) || ex.find(([, a]) => a.desc);
    if (!power) continue;
    const ranks = ex.map(([k]) => (d2affix[k] && d2affix[k].skill) || '').filter(Boolean);
    const prev = byName.get(it.name + '|' + slot);
    if (prev && prev.id > it.id) continue;
    byName.set(it.name + '|' + slot, {
      id: it.id, key, name: it.name, slot, type: it.type, mythic: it.magicType === 4, cls: classesOf(it.classFilter),
      tags: power[1].tags || [], desc: cleanDesc(power[1].desc, affixValues(power[1])), ranks,
    });
  }
  return [...byName.values()].map((u) => { delete u.id; return u; });
}

/** Charm sets with their bonuses. */
function slimSets(data) {
  const out = [];
  for (const [key, s] of Object.entries(data.itemSets || {})) {
    if (!s || !s.name) continue;
    const m = key.match(/^Talisman_([A-Za-z]+)_/);
    const short = m ? m[1].toLowerCase() : '';
    const cls = CLASSES.find((c) => c.toLowerCase().startsWith(short.slice(0, 4))) || 'All';
    out.push({ key, name: s.name, cls: cls === 'All' ? ['All'] : [cls],
      bonuses: (s.bonuses || []).map((b) => { const a = data.affixes[b.affix] || {}; return { n: b.required, desc: cleanDesc(a.desc || '', affixValues(a)), tags: a.tags || [] }; }) });
  }
  return out;
}

// tempers carry no class list – their key names it ("Tempered_…_Skill_Rogue_Flurry_Tier3"), or none for all
const KEY_CLASS = { Barb: 'Barbarian', Barbarian: 'Barbarian', Druid: 'Druid', Rogue: 'Rogue', Sorc: 'Sorcerer', Sorcerer: 'Sorcerer',
  Necro: 'Necromancer', Necromancer: 'Necromancer', Spiritborn: 'Spiritborn', Paladin: 'Paladin', Warlock: 'Warlock' };
function classOfKey(key) {
  const m = String(key).match(/_(Barb|Barbarian|Druid|Rogue|Sorc|Sorcerer|Necro|Necromancer|Spiritborn|Paladin|Warlock)(?=_|$)/);
  return m ? [KEY_CLASS[m[1]]] : CLASSES;
}

/** d2core's affix file: what rolls on each slot per class, the tempers, and affix key -> skill. */
function slimAffixFile(j) {
  const list = (j && j.affix) || [];
  const pools = {};   // cls -> type -> [{d, tags, skill}]
  const tempers = {}; // cls -> [{d, g, types, skill}]
  const byKey = {};
  for (const a of list) {
    if (!a || !a.key || !a.desc) continue;
    const skill = a.relatedSkill && a.relatedSkill.key ? a.relatedSkill.key : '';
    byKey[a.key] = { skill };
    if (a.unique || a.special || a.transfigured) continue;
    const classes = Array.isArray(a.charType) && a.charType.length ? a.charType : classOfKey(a.key);
    const e = { d: String(a.desc).replace(/\s+/g, ' ').trim(), skill, tags: a.tags || [] };
    for (const c of classes) {
      if (a.tempered) {
        (tempers[c] = tempers[c] || []).push(Object.assign({ g: a.groupName || '', types: a.itemType || [] }, e));
        continue;
      }
      const p = (pools[c] = pools[c] || {});
      for (const t of a.itemType || []) {
        const l = (p[t] = p[t] || []);
        if (!l.some((x) => x.d === e.d)) l.push(e);
      }
    }
  }
  return { pools, tempers, byKey };
}

// ---- d2core's item files: newer than maxroll's game data (runewords, Leoric's Crown …) ----------
/** "{c_random}[75 - 90]%[x]{/c}" -> "90%[x]": d2core's markup gone, ranges at their best roll. */
const d2text = (s) => String(s || '').replace(/\{[^{}]*\}/g, '').replace(/\[([\d.,]+)\s*-\s*([\d.,]+)\]/g, '$2').replace(/\s+/g, ' ').trim();
const d2classes = (list) => { const c = (list || []).filter((x) => CLASSES.includes(x)); return c.length ? c : CLASSES.slice(); };
const ASPECT_SLOTS = { Offensive: ['Weapon', 'Gloves', 'Amulet', 'Ring', 'Off-Hand'], Defensive: ['Helm', 'Chest Armor', 'Pants', 'Amulet', 'Off-Hand'],
  Utility: ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Off-Hand'], Mobility: ['Boots', 'Amulet'], Resource: ['Ring', 'Amulet'] };

/**
 * Uniques (with their fixed stats) and aspects from d2core. A unique's power is the line written
 * in the unique / mythic colour, every other line is a stat it always has.
 */
function slimD2Items(uniqueFile, aspectFile, mrAspects) {
  const list = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
  const slotsByName = new Map((mrAspects || []).map((a) => [a.name, a.slots]));
  const uniques = [];
  const seen = new Set();
  for (const u of list(uniqueFile)) {
    const slot = slotOfType(u.equipType);
    if (!u || !u.name || !slot || seen.has(u.name + '|' + slot)) continue;
    seen.add(u.name + '|' + slot);
    const lines = (u.affixesDesc || []).map(String);
    const power = lines.filter((l) => /\{c_(unique|mythic)\}/.test(l)).map(d2text).join(' ');
    const stats = lines.filter((l) => !/\{c_(unique|mythic)\}/.test(l)).map(d2text).concat((u.implict || []).map(d2text));
    uniques.push({ key: u.key, name: u.name, slot, type: u.equipType, mythic: !!u.isMythic, runeword: !!u.isRuneword, cls: d2classes(u.char),
      tags: u.keywordIds || [], desc: power || stats.join(' · '), stats, ranks: [],
      runes: (u.runewordRecipe || []).map((r) => r.engName || r.name) });
  }
  const aspects = list(aspectFile).filter((a) => a && a.name).map((a) => ({
    key: a.key, name: a.name, cat: a.aspectType || 'Utility', cls: d2classes(a.char), tags: a.filters || [],
    slots: slotsByName.get(a.name) || ASPECT_SLOTS[a.aspectType] || ASPECT_SLOTS.Utility, desc: d2text(a.affixesDesc),
  }));
  return { uniques, aspects };
}

/**
 * Soul splinters and gems by name, with what they do where they sit: a gem's line for weapons,
 * armour and jewellery; a splinter's always-on stat and its jewellery power.
 */
function slimSockets(splinterFile, gemFile) {
  const list = (x) => (Array.isArray(x) ? x : Object.values(x || {}));
  const out = {};
  for (const s of list(splinterFile)) {
    if (!s || !s.name) continue;
    out[s.name] = { kind: 'splinter', stat: d2text(s.desc), jewelry: d2text(String(s.affixDesc || '').replace(/^Jewelry:\s*/, '')) };
  }
  for (const g of list(gemFile)) {
    if (!g || !g.name) continue;
    const line = (k) => d2text(((g.affixesDesc || []).find((l) => new RegExp('^' + k + ':').test(l)) || '').replace(/^\w+:\s*/, ''));
    out[g.name] = { kind: 'gem', weapon: line('Weapon'), armor: line('Armor'), jewelry: line('Jewelry') };
  }
  return out;
}

function slim(data, affixFile, d2items) {
  const af = slimAffixFile(affixFile);
  const mrAspects = slimAspects(data);
  const d2i = d2items && d2items.unique && d2items.aspect ? slimD2Items(d2items.unique, d2items.aspect, mrAspects) : null;
  return {
    version: VERSION, game: data.version || '', items: d2i ? 'd2core' : 'maxroll',
    classes: slimClasses(data), aspects: d2i ? d2i.aspects : mrAspects, uniques: d2i ? d2i.uniques : slimUniques(data, af.byKey), sets: slimSets(data),
    pools: af.pools, tempers: af.tempers,
    sockets: d2items && d2items.splinter ? slimSockets(d2items.splinter, d2items.gem) : {},
    // which classes may socket a glyph (d2core keeps glyphs without a class)
    glyphClass: Object.fromEntries(Object.values(data.paragonGlyphs || {}).filter((g) => g && g.name).map((g) => [g.name, classesOf(g.classFilter)])),
  };
}

// ---- tier list -----------------------------------------------------------------------------
/** maxroll's tier list keeps its entries as JSON in the page: name, link, tier. */
function parseTierList(html) {
  const out = [];
  const seen = new Set();
  const re = /"name":"([^"]{2,80})","icon":"d4\/([a-z]+)"[^{}]*?"link":"(https:\/\/maxroll\.gg\/d4\/build-guides\/[a-z0-9-]+)","tier":"([A-Z])"/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    if (seen.has(m[3])) continue;
    seen.add(m[3]);
    const cls = CLASSES.find((c) => c.toLowerCase() === m[2]) || '';
    out.push({ name: m[1], cls, url: m[3], tier: m[4] });
  }
  return out;
}

/** The guides of a tier list whose name carries the skill ("Cold Rain of Arrows Rogue"). */
function guidesFor(tiers, cls, skillName) {
  const n = String(skillName).toLowerCase();
  const short = n.replace(/^(the|command) /, '');
  return (tiers || []).filter((t) => t.cls === cls && (t.name.toLowerCase().includes(n) || (short.length > 4 && t.name.toLowerCase().includes(short))
    || t.url.includes('/' + n.replace(/[^a-z0-9]+/g, '-') + '-')))
    .sort((a, b) => 'SABCD'.indexOf(a.tier) - 'SABCD'.indexOf(b.tier));
}

// ---- scoring --------------------------------------------------------------------------------
/** Everything about the main skill the scoring looks at. */
function profileOf(cdb, cls, skill) {
  const tags = new Set(skill.tags);
  const fam = [];
  for (const t of tags) for (const w of FAMILY[t] || []) if (!fam.includes(w)) fam.push(w);
  if (skill.cat && !fam.includes(skill.cat)) fam.unshift(skill.cat);
  if (cls === 'Sorcerer' && SORC_FAMILY[skill.el]) fam.push(SORC_FAMILY[skill.el]);
  const el = skill.el;
  const others = cdb.skills.filter((s) => s.key !== skill.key).map((s) => s.name).filter((nm) => !has(skill.name, nm) && nm.length > 3);
  const crit = !(skill.dot && !tags.has('Skill_Imbueable'));
  const minion = tags.has('Skill_Primary_Summoning') || tags.has('Search_Minion');
  return {
    cls, name: skill.name, key: skill.key, cat: skill.cat, el, fam, tags, others,
    elWords: el ? ELEMENT_WORDS[el] : [],
    noun: skill.name.replace(/^The /, ''),
    spender: skill.cost, generator: skill.gen, cooldown: skill.cd || /Ultimate/.test(skill.cat), dot: skill.dot, crit, minion,
    channeled: tags.has('Skill_Channeled'),
    vulnerable: skill.mods.some((m) => m.tags.includes('Keyword_Vulnerable')) || tags.has('Keyword_Vulnerable'),
    overpower: ['Barbarian', 'Druid', 'Paladin'].includes(cls),
  };
}

const ANY_ELEMENT = Object.entries(ELEMENT_WORDS);

/**
 * How well a text (aspect, unique power, set bonus, glyph …) goes with the main skill.
 * @returns {{score:number, why:string[], needs:string}}
 */
function scoreText(p, text, tags) {
  const t = String(text || '');
  const tg = new Set(tags || []);
  let score = 0;
  const why = [];
  const noun = p.noun.replace(/[^A-Za-z' ]/g, '');
  const spender = [...tg].find((x) => /^FILTER_Spender_/.test(x));
  if (has(t, noun) || (spender && spender.replace(/^FILTER_Spender_[A-Za-z]+_/, '').toLowerCase() === noun.replace(/[^A-Za-z]/g, '').toLowerCase())) {
    score += 100; why.push('Made for ' + p.name);
  } else if (spender) {
    score -= 40;
  }
  const famHit = p.fam.filter((w) => has(t, w + ' Skill') || has(t, w + ' Skills') || (w.length > 5 && has(t, w)));
  if (famHit.length) { score += 40 + 10 * Math.min(famHit.length - 1, 2); why.push('Works on ' + famHit.slice(0, 2).join(' / ') + ' skills'); }
  // a whole other group of skills ("Basic Skills deal …") while ours is not one of them
  const groups = ['Basic', 'Core', 'Ultimate', 'Defensive', 'Mastery', 'Conjuration', 'Brawling', 'Weapon Mastery', 'Macabre', 'Corruption', 'Curse',
    'Agility', 'Subterfuge', 'Imbuement', 'Companion', 'Wrath', 'Potency', 'Focus', 'Justice', 'Valor', 'Aura', 'Archfiend', 'Sigil', 'Shout'];
  const foreign = groups.filter((g) => !p.fam.includes(g) && new RegExp('\\b' + g + ' Skills?\\b').test(t));
  if (foreign.length && !famHit.length && score < 100) score -= 25;
  // the element
  const ours = p.elWords.some((w) => has(t, w));
  const theirs = ANY_ELEMENT.filter(([e]) => e !== p.el).filter(([, ws]) => ws.some((w) => new RegExp('\\b' + esc(w) + '\\b').test(t)));
  if (ours && p.el) { score += 20; why.push(p.el + ' damage'); }
  else if (theirs.length && !famHit.length && score < 100 && /\b(Skills?|damage)\b/.test(t)) score -= 35;
  // another skill named by its name – it needs that skill on the bar
  const named = p.others.find((nm) => new RegExp('\\b' + esc(nm) + '\\b').test(t));
  let needs = '';
  if (named && score < 100) { score -= 30; needs = named; }
  // general mechanics
  const mult = /\[x\]/.test(t);
  const generic = tg.has('FILTER_Build_All_Generic') || tg.has('FILTER_Build_' + p.cls.slice(0, 4) + '_Generic');
  if (mult && score >= 0 && !named && !foreign.length) { score += 12; if (!why.length) why.push('Damage multiplier [x]'); }
  if (generic && score >= 0 && !named) score += 6;
  if (/Vulnerable/.test(t)) { score += 6; if (why.length < 3) why.push('Vulnerable'); }
  if (/Critical Strike/.test(t)) { if (p.crit) score += 6; else score -= 10; }
  if (/Overpower/.test(t)) score += p.overpower ? 5 : -10;
  if (/Cooldown/.test(t) && p.cooldown) { score += 8; if (why.length < 3) why.push('Cooldowns'); }
  if (/(Damage Over Time|over \d+ seconds)/i.test(t) && p.dot) score += 8;
  if (/\bChannel/.test(t) && !p.channeled && score < 100) score -= 20;
  if (/\b(Minion|Minions)\b/.test(t)) score += p.minion ? 20 : -15;
  if (/Lucky Hit/.test(t)) score += 2;
  if (/\b(Fury|Mana|Energy|Spirit|Essence|Vigor|Faith|Wrath|Resource)\b/.test(t) && p.spender) score += 4;
  return { score, why: why.slice(0, 3), needs };
}

/** What a stat on gear is worth for this skill – the damage formula in short, as numbers 0–100. */
function statValue(p, d, slot) {
  const s = String(d);
  const R = (v, why) => ({ v, why });
  if (new RegExp('to ' + esc(p.name) + '$', 'i').test(s)) return R(100, 'ranks of your main skill raise its skill % – one of the strongest stats');
  if (/to All Skills/i.test(s)) return R(88, 'ranks to every skill, the main one included');
  const fam = p.fam.find((w) => new RegExp('to ' + esc(w) + ' Skills', 'i').test(s));
  if (fam) return R(92, 'ranks to ' + fam + ' skills – your main skill is one');
  if (/^\+.*to [A-Z]/.test(s) && !/Skills?$/.test(s)) return R(4, '');
  if (/to \w+( \w+)? Skills/.test(s)) return R(8, '');
  if (/Critical Strike Damage Multiplier/i.test(s)) return p.crit ? R(86, 'own [x] bucket on every critical strike') : R(5, 'your main skill cannot crit');
  if (/Critical Strike Chance/i.test(s)) return p.crit ? R(82, 'more crits – 100% is the hard cap') : R(5, '');
  if (/Vulnerable Damage Multiplier/i.test(s)) return R(80, 'own [x] bucket against Vulnerable enemies (x1.2 baseline)');
  if (/Damage Over Time Multiplier/i.test(s)) return p.dot ? R(84, 'your skill deals damage over time') : R(6, '');
  if (/All Damage Multiplier/i.test(s)) return R(74, '[x] for everything – shares its bucket with the element multipliers');
  const elm = s.match(/(\w+) Damage Multiplier/);
  if (elm) return elm[1] === p.el ? R(77, p.el + ' is your damage type') : R(3, '');
  if (new RegExp(esc(MAIN_STAT[p.cls]) + '$').test(s)) return R(70, 'main stat – its own multiplier');
  if (/Strength|Intelligence|Dexterity|Willpower/.test(s)) return R(6, '');
  if (/Cooldown Reduction/i.test(s)) return p.cooldown ? R(78, 'your rotation lives on cooldowns') : R(46, 'buffs and defensive skills back sooner');
  if (/Attack Speed/i.test(s)) return p.cooldown && !p.spender ? R(30, '') : R(72, 'more casts per second (capped at 100% attack + 100% cast speed)');
  if (/Maximum Life/i.test(s)) return R(64, 'survive – Life is the base of Toughness');
  if (/Resistance to All Elements/i.test(s)) return R(58, 'every resistance at once');
  if (/Damage Reduction$/i.test(s)) return R(60, 'damage reduction multiplies with every other source');
  if (/^\+.*Armor$/i.test(s)) return R(55, 'Armor reduces all physical damage');
  if (/Movement Speed/i.test(s)) return R(slot === 'Boots' ? 76 : 40, 'speed – clears faster, dodges more');
  if (/Maximum Evade Charges|Evade's Cooldown/i.test(s)) return R(50, 'more evades');
  if (/Maximum Resource/i.test(s)) return p.spender ? R(62, 'bigger pool for your spender') : R(20, '');
  if (/Resource Cost Reduction/i.test(s)) return p.spender ? R(60, 'more casts per pool') : R(15, '');
  if (/Resource Generation|Regeneration$|On Kill$/i.test(s) && /(Resource|Fury|Mana|Energy|Spirit|Essence|Vigor|Faith|Wrath)/i.test(s)) return p.spender ? R(52, 'keeps your resource up') : R(12, '');
  if (/Lucky Hit Chance/i.test(s)) return R(36, 'helps every "Lucky Hit:" effect');
  if (/Dodge/i.test(s)) return R(40, 'avoid hits altogether');
  if (/Weapon Damage/i.test(s)) return R(48, 'raises the base every skill hit scales from');
  if (/Resistance$/i.test(s)) return R(28, 'one resistance – keep them balanced');
  if (/Fortify|Barrier Generation/i.test(s)) return R(32, '');
  if (/Impairment Reduction/i.test(s)) return R(34, 'out of crowd control sooner');
  if (/Life On Hit|Life on Kill|Life Regeneration|Healing Received/i.test(s)) return R(30, 'sustain');
  if (/Thorns/i.test(s)) return R(4, '');
  return R(10, '');
}

/** The best stats for a slot from what can roll there for the class. */
function slotStats(dbx, p, slot, n) {
  const pool = (dbx.pools[p.cls] || {});
  const type = slot === 'Weapon' ? WEAPON_OF[p.cls] : slot === 'Off-Hand' ? OFFHAND_OF[p.cls] : POOL_TYPE[slot.replace(/\d$/, '')];
  const list = (type && pool[type]) || [];
  return list.map((a) => Object.assign({ d: a.d }, statValue(p, a.d, slot)))
    .filter((x) => x.v >= 30).sort((a, b) => b.v - a.v).slice(0, n || 4);
}

/** Tempers worth making on a slot: the ones that name the skill or its family come first. */
function slotTempers(dbx, p, slot) {
  const type = slot === 'Weapon' ? WEAPON_OF[p.cls] : slot === 'Off-Hand' ? OFFHAND_OF[p.cls] : POOL_TYPE[slot.replace(/\d$/, '')];
  const seen = new Set();
  return (dbx.tempers[p.cls] || []).filter((t) => t.types.includes(type)).map((t) => {
    const sc = scoreText(p, t.d, t.tags);
    const sv = statValue(p, t.d.replace(/\[[^\]]*\]/g, '#'), slot);
    return { d: t.d, g: t.g, v: Math.max(sc.score, sv.v - 20) + (t.skill === p.key ? 60 : 0) };
  }).filter((t) => t.v >= 40 && !seen.has(t.d) && seen.add(t.d)).sort((a, b) => b.v - a.v).slice(0, 2);
}

// ---- the plan --------------------------------------------------------------------------------
const tierOf = (sc) => (sc >= 100 ? 'core' : sc >= 40 ? 'synergy' : sc >= 15 ? 'good' : '');

/**
 * Everything the builder shows for one class and main skill.
 * @param dbx    the slimmed data (slim())
 * @param extra  { d2 (d2core db), tiers (tier list), known (names the farm list knows) }
 */
function plan(dbx, cls, skillKey, extra) {
  const x = extra || {};
  const cdb = dbx.classes[cls];
  const skill = cdb && cdb.skills.find((s) => s.key === skillKey);
  if (!skill) return null;
  const p = profileOf(cdb, cls, skill);
  // the farm list's names (and the slot a unique sits in) – what is in the game now
  const known = x.known || null;
  const ok = (name, slot) => !known || (known.has(String(name).toLowerCase()) && (!slot || !known.get || !known.get(String(name).toLowerCase()) || known.get(String(name).toLowerCase()) === slot));
  const fits = (list) => list.includes(cls) || list.includes('All');

  // aspects and uniques, scored
  const aspects = dbx.aspects.filter((a) => fits(a.cls) && ok(a.name)).map((a) => Object.assign({ kind: 'aspect' }, a, scoreText(p, a.desc, a.tags)));
  const uniques = dbx.uniques.filter((u) => fits(u.cls) && ok(u.name, u.slot)).map((u) => {
    const s = scoreText(p, u.desc, u.tags);
    if (u.ranks.includes(skill.key)) { s.score += 30; s.why.unshift('+ranks to ' + skill.name); }
    if (u.mythic && s.score >= 0 && !s.needs) { s.score += 20; s.why.push('Mythic'); }
    return Object.assign({ kind: 'unique' }, u, s);
  });
  // the archetype most of the fitting aspects belong to lifts the rest of it
  const arch = {};
  for (const a of aspects.concat(uniques)) if (a.score >= 40) for (const t of a.tags) { const m = t.match(/^Archetype_[A-Za-z]+_([A-Za-z]+)_/); if (m) arch[m[1]] = (arch[m[1]] || 0) + a.score; }
  const archetype = Object.entries(arch).sort((a, b) => b[1] - a[1]).map((e) => e[0])[0] || '';
  if (archetype) {
    for (const a of aspects.concat(uniques)) {
      if (a.tags.some((t) => t.includes('_' + archetype + '_')) && a.score >= 0 && a.score < 100) { a.score += 15; if (a.why.length < 3) a.why.push(archetype + ' archetype'); }
    }
  }
  const rank = (a, b) => b.score - a.score || a.name.localeCompare(b.name);
  aspects.sort(rank);
  uniques.sort(rank);

  const bar = skillBar(cdb, p, skill);
  const opt = fillGear(cls, p, skill, aspects, uniques, dbx, x, bar, cdb);
  const gear = opt.gear;
  const keyPassives = cdb.keyPassives.map((k) => Object.assign({}, k, scoreText(p, k.desc, k.tags))).sort(rank).slice(0, 3);
  const sets = dbx.sets.filter((s) => s.cls.includes(cls) || s.cls.includes('All')).map((s) => {
    const r = s.bonuses.reduce((acc, b) => { const sc = scoreText(p, b.desc, b.tags); acc.score += sc.score; sc.why.forEach((w) => !acc.why.includes(w) && acc.why.push(w)); return acc; }, { score: 0, why: [] });
    return Object.assign({}, s, r);
  }).sort(rank).slice(0, 3);
  const paragon = paragonFor(x.d2, cls, p, cdb.boards);
  const guides = guidesFor(x.tiers, cls, skill.name);
  const barMods = chooseMods(cdb, bar, opt.prof, opt.final, opt.on);
  const talisman = talismanSets(dbx, cls, opt.prof, opt.final, opt.on);
  const paragon2 = paragonPlan(x.d2, cls, opt.prof, cdb, opt.final, opt.on, dbx.glyphClass);

  return {
    cls, main: cdb.main, resource: cdb.resource, statPer10: STAT_PER10[cls],
    skill: { key: skill.key, name: skill.name, cat: skill.cat, el: skill.el, desc: skill.desc, dot: skill.dot, cd: p.cooldown, spender: p.spender,
      crit: p.crit, channeled: p.channeled, family: p.fam, mods: skill.mods.slice(0, 7) },
    archetype, guides, bar, keyPassives, gear, sets, paragon, conditions: opt.on, balance: opt.balance, summary: opt.summary,
    conditionList: DM.CONDITIONS.map(([id, label]) => ({ id, label })), engine: opt.engine, barMods, talisman, paragonPlan: paragon2, _prof: opt.prof,
    picks: {
      uniques: uniques.filter((u) => u.score >= 40).slice(0, 10).map(pickOut),
      aspects: aspects.filter((a) => a.score >= 40).slice(0, 14).map(pickOut),
      defensive: aspects.filter((a) => a.cat === 'Defensive' && a.score >= 0).slice(0, 5).map(pickOut),
    },
    targets: targetsFor(p, cls),
    tips: tipsFor(p, cls, bar),
  };
}

const pickOut = (a) => ({ kind: a.kind, name: a.name, desc: a.desc, slot: a.slot || '', slots: a.slots || [], cat: a.cat || '', mythic: !!a.mythic,
  score: a.score, tier: tierOf(a.score), why: a.why, needs: a.needs });

/** The conditions the build itself provides, and the ones a normal rotation keeps up – switched on by default. */
function defaultConditions(p, bar, cdb) {
  const on = { buff: true, stacks: true, luckyhit: true, crit: p.crit };
  if (p.channeled) on.channel = true;
  if (/2H|Glaive|Quarterstaff|Polearm/.test(WEAPON_OF[p.cls] || '')) on.twohand = true;
  const barSkills = bar.map((b) => cdb.skills.find((s) => s.key === b.key)).filter(Boolean);
  if (p.vulnerable || barSkills.some((s) => s.tags.includes('Keyword_Vulnerable') || s.mods.some((m) => m.tags.includes('Keyword_Vulnerable')))) on.vulnerable = true;
  if (barSkills.some((s) => s.tags.includes('Keyword_Berserk'))) on.berserk = true;
  if (barSkills.some((s) => s.tags.includes('Keyword_Barrier'))) on.barrier = true;
  if (barSkills.some((s) => s.tags.includes('Keyword_Unstoppable'))) on.unstoppable = true;
  if (bar.some((b) => /Ultimate/.test((cdb.skills.find((s) => s.key === b.key) || {}).cat || ''))) on.ultimate = true;
  return on;
}

/**
 * The gear by the damage model: every unique, mythic and aspect is read into effects, then the
 * optimizer fills the slots with what adds the most damage and toughness together.
 */
function fillGear(cls, p, skill, aspects, uniques, dbx, x, bar, cdb) {
  const prof = { p, noun: p.noun, groups: p.fam.concat(p.channeled ? ['Channeled'] : []), el: p.el, minion: p.minion, mainStat: MAIN_STAT[cls], dot: !p.crit, channeled: p.channeled,
    otherSkills: cdb.skills.filter((s) => s.key !== skill.key).map((s) => s.name).filter((n) => n.length > 3 && !new RegExp('\\b' + esc(n) + '\\b').test(skill.name)) };
  const on = Object.assign(defaultConditions(p, bar, cdb), x.on || {});
  const balance = x.balance == null ? 0.6 : x.balance;
  const slots = OPT.GEAR.filter((s) => !(s === 'Off-Hand' && (cls === 'Spiritborn' || cls === 'Barbarian')));
  const slotsOf = (list) => list.map((s) => (s === 'Ring' ? 'Ring' : s));
  const cands = aspects.map((a) => ({ name: a.name, kind: 'aspect', mythic: false, slots: slotsOf(a.slots), cat: a.cat, desc: a.desc, why: a.why, effects: DM.parseEffects(a.desc, prof) }))
    .concat(uniques.map((u) => ({ name: u.name, kind: 'unique', mythic: u.mythic, slots: [u.slot], desc: u.desc, why: u.why,
      effects: DM.parseEffects(u.desc, prof).concat(u.ranks.includes(skill.key) ? [{ kind: 'rank', v: 2, cond: [], scope: 'skill', text: '+ranks to ' + skill.name }] : [])
        // the stats a unique always has count like any roll
        .concat((u.stats || []).map((t) => { const r = DM.rollOf(t, prof); return r ? { kind: 'roll', k: r.k, v: r.v, cond: [], scope: 'all', text: t } : null; }).filter(Boolean)),
      stats: u.stats || [], runeword: !!u.runeword, runes: u.runes || [] })));
  const st0 = Object.assign(DM.baseState(STAT_PER10[cls]), {
    dot: !p.crit, limit: p.cooldown && !p.spender ? 'cooldown' : 'speed', stat: Number(x.mainStat) || 0,
  });
  const pools = {};
  const pool = dbx.pools[cls] || {};
  for (const s of slots) {
    const kind = s.replace(/\d$/, '');
    const type = kind === 'Weapon' ? WEAPON_OF[cls] : kind === 'Off-Hand' ? OFFHAND_OF[cls] : POOL_TYPE[kind];
    pools[kind] = ((type && pool[type]) || []).map((e) => e.d);
  }
  const rolls = OPT.pickStats(pools, prof, st0, balance);
  const { placed } = OPT.fillGear(cands, rolls.state, on, balance, slots);
  const sh = OPT.shares(cands, placed, rolls.state, on, balance);
  const gear = {};
  const pieceOut = (c) => c && { kind: c.kind, name: c.name, mythic: c.mythic, desc: c.desc, cat: c.cat || '', why: c.why || [],
    effects: c.effects.filter((e) => e.scope !== 'other').map((e) => ({ kind: e.kind, v: e.v, cond: e.cond })) };
  for (const s of slots) {
    const c = placed[s];
    const v = sh.out[s] || {};
    gear[s] = {
      piece: pieceOut(c), dmg: v.dmg || 0, tough: v.tough || 0, dmgIf: v.dmgIf || 0, needs: v.needs || [], proc: !!v.proc, unsure: !!v.unsure,
      alts: (v.alts || []).map((a) => Object.assign(pieceOut(a.c), { dmg: a.dmg, tough: a.tough, dmgIf: a.dmgIf, needs: a.needs })),
      stats: (rolls.stats[s] || []).map((r) => ({ d: r.d, k: r.r.k })),
      tempers: slotTempers(dbx, p, s),
    };
  }
  const base = DM.damage(st0), fin = DM.damage(sh.full);
  return { gear, on, balance, summary: {
    dmgX: fin.dps / base.dps, toughX: DM.toughness(sh.full) / DM.toughness(st0), factors: fin.f, state: sh.full,
  },
  prof, final: sh.full,
  // what the overlay needs to recompute on its own – a switched condition, a swapped piece, the search
  engine: { slots, base: st0, state: rolls.state, cands: cands.map((c) => ({ name: c.name, kind: c.kind, mythic: c.mythic, slots: c.slots, cat: c.cat || '', desc: c.desc, effects: c.effects,
    counted: c.effects.some((e) => (e.scope !== 'other' || e.kind === 'vuln') && e.kind !== 'proc' && e.kind !== 'scaled') })) } };
}

// what a modifier is good for when the model cannot put a number on it
const MOD_UTILITY = [
  [/Unstoppable/, 'Unstoppable'], [/Barrier/, 'Barrier'], [/Fortify|Fortified/, 'Fortify'], [/Cooldown/, 'shorter cooldown'],
  [/Overpower/, 'Overpower'], [/Generate|Fury|Mana|Energy|Spirit|Essence|Vigor|Faith|Wrath|Resource/, 'resource'], [/Lucky Hit/, 'Lucky Hit'],
  [/Stun|Freeze|Immobiliz|Knock|Daze|Slow|Chill|Pull/, 'crowd control'], [/Movement Speed/, 'speed'],
];

/**
 * The modifiers for each skill on the bar: one variant, one of each upgrade pair – the one that
 * adds the most to the build (damage, toughness, Vulnerable), otherwise the most useful.
 */
function chooseMods(cdb, bar, prof, state, on) {
  return bar.map((b) => {
    const s = cdb.skills.find((x) => x.key === b.key);
    if (!s) return Object.assign({}, b, { mods: [] });
    const rate = (m) => {
      const w = DM.worth(state, DM.parseEffects(m.desc, prof), on);
      const util = MOD_UTILITY.filter(([re]) => re.test(m.desc)).map(([, l]) => l);
      const vuln = m.tags.includes('Keyword_Vulnerable') && !(state.vulnUp >= 100);
      return { name: m.name, desc: m.desc, group: m.group, dmg: w.dmg, tough: w.tough, util, vuln,
        v: Math.log(1 + w.dmg / 100) + 0.6 * Math.log(1 + w.tough / 100) + (vuln ? 0.15 : 0) + util.length * 0.01 };
    };
    const opts = s.mods.filter((m) => m.group).map(rate);
    const pick = (g) => opts.filter((o) => o.group === g).sort((x, y) => y.v - x.v);
    const groups = ['variant', 'a', 'b'].map((g) => ({ group: g, options: pick(g) })).filter((g) => g.options.length);
    return Object.assign({}, b, { mods: groups.map((g) => Object.assign({ chosen: g.options[0].name }, g)) });
  });
}

/** Charm sets: every bonus read like an aspect; full set and the 2-piece bonus, by what they add. */
function talismanSets(dbx, cls, prof, state, on) {
  return dbx.sets.filter((s) => s.cls.includes(cls) || s.cls.includes('All')).map((s) => {
    const all = s.bonuses.flatMap((b) => DM.parseEffects(b.desc, prof));
    const w = DM.worth(state, all, on);
    return { name: s.name, bonuses: s.bonuses.map((b) => ({ n: b.n, desc: b.desc })), dmg: w.dmg, tough: w.tough, dmgIf: w.dmgIf, needs: w.needs,
      v: Math.log(1 + w.dmg / 100) + 0.6 * Math.log(1 + w.tough / 100) };
  }).sort((a, b) => b.v - a.v).slice(0, 4);
}

// ---- paragon -------------------------------------------------------------------------------
/** A paragon node's lines ("+10.0% Non-Physical Damage", "+10 Intelligence") as model effects. */
function nodeEffects(desc, prof, mainStat) {
  const out = [];
  for (const line of String(desc || '').split(/\n/)) {
    const t = line.trim();
    let m;
    if ((m = new RegExp('^\\+(\\d+) ' + mainStat + '$').exec(t))) { out.push({ kind: 'stat', v: Number(m[1]), cond: [], scope: 'all' }); continue; }
    if ((m = /^\+([\d.]+)% Critical Strike Damage$/.exec(t))) { out.push({ kind: 'csdp', v: Number(m[1]), cond: prof.dot ? ['crit'] : [], scope: 'all' }); continue; }
    if ((m = /^\+([\d.]+)% Maximum Life$/.exec(t))) { out.push({ kind: 'life', v: Number(m[1]), cond: [], scope: 'all' }); continue; }
    if ((m = /^\+?([\d.]+)% Damage Reduction(.*)$/.exec(t))) { out.push({ kind: 'dr', v: Number(m[1]), cond: DM.parseEffects('x ' + m[2], prof).length ? [] : [], scope: 'all' }); continue; }
    if ((m = /^\+([\d.]+)% (.*)Damage(.*)$/.exec(t))) {
      const what = m[2].trim(), rest = m[3].trim();
      let ok = !what || what === 'Non-Physical' ? (what !== 'Non-Physical' || prof.el !== 'Physical') : what === prof.el || prof.groups.includes(what.replace(/ Skill$/, '')) || (what === 'Damage Over Time' && prof.dot);
      if (/^(Physical|Fire|Cold|Lightning|Poison|Shadow|Holy)$/.test(what)) ok = what === prof.el;
      const cond = /Vulnerable/.test(what + rest) ? ['vulnerable'] : /Elite/.test(rest) ? ['elite'] : /Close/.test(rest) ? ['close'] : /Distant/.test(rest) ? ['distant'] : /Crowd Controlled|Stunned|Slowed|Chilled/.test(rest) ? ['cc'] : /Healthy/.test(rest) ? ['healthy'] : /Injured/.test(rest) ? ['injured'] : [];
      if (/Vulnerable/.test(what)) ok = true;
      if (ok) out.push({ kind: 'add', v: Number(m[1]), cond, scope: 'all' });
    }
  }
  return out;
}

/** The value of a node on top of a state, as a number to rank by (damage and toughness together). */
function nodeValue(state, effects, on) {
  if (!effects.length) return 0;
  let s = state;
  for (const e of effects) {
    if (e.cond.some((c) => !on[c])) continue;
    if (e.kind === 'stat') s = Object.assign({}, s, { stat: s.stat + e.v });
    else if (e.kind === 'csdp') s = Object.assign({}, s, { csdp: s.csdp + e.v });
    else s = DM.apply(s, e, on);
  }
  const d = OPT.delta(state, s);
  return Math.log(1 + d.dmg / 100) + 0.6 * Math.log(1 + d.tough / 100);
}

const GRID = 21;
/**
 * A suggested way through one board: the order in which to take its nodes, from the entry gate –
 * glyph socket and the rare nodes around it first, the legendary node, then whatever adds most per point.
 * Every node on the way is counted (you cannot skip a node to reach the next).
 */
function boardPath(par, board, prof, mainStat, state, on, opts) {
  const cell = (r, c) => { const k = String(board.rows[r] || '').split(',')[c]; return k && par.nodes[k] ? k : ''; };
  const at = (r, c) => r >= 0 && c >= 0 && r < GRID && c < GRID && cell(r, c);
  // entry: the gate at the bottom middle (start board: its start node)
  let start = null;
  for (let r = GRID - 1; r >= 0 && !start; r--) for (let c = 0; c < GRID && !start; c++) {
    const n = par.nodes[cell(r, c)];
    if (n && (n.t === 'start' || (r === GRID - 1 && n.t === 'gate'))) start = [r, c];
  }
  if (!start) return null;
  const value = new Map();
  const key = (r, c) => r * GRID + c;
  for (let r = 0; r < GRID; r++) for (let c = 0; c < GRID; c++) {
    const k = cell(r, c);
    if (!k) continue;
    const n = par.nodes[k];
    let v = nodeValue(state, n.r >= 4 ? DM.parseEffects(n.d, prof) : nodeEffects(n.d, prof, mainStat), on);
    if (n.t === 'socket') v += opts.socketValue;
    value.set(key(r, c), v);
  }
  const taken = new Set([key(start[0], start[1])]);
  const order = [{ r: start[0], c: start[1] }];
  const steps = Math.min(opts.points, 120);
  while (order.length < steps) {
    // shortest way from what is taken to every node (BFS), then the best value per point
    const prev = new Map(), dist = new Map();
    const q = [...taken];
    q.forEach((k) => dist.set(k, 0));
    while (q.length) {
      const k = q.shift(); const r = Math.floor(k / GRID), c = k % GRID;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (!at(rr, cc)) continue;
        const kk = key(rr, cc);
        if (dist.has(kk)) continue;
        dist.set(kk, dist.get(k) + 1); prev.set(kk, k); q.push(kk);
      }
    }
    let best = null;
    for (const [k, d] of dist) {
      if (!d) continue;
      let v = 0; let x = k; while (!taken.has(x)) { v += value.get(x) || 0; x = prev.get(x); }
      const score = v / d;
      if (score > 0 && (!best || score > best.score)) best = { k, score };
    }
    if (!best) break;
    const path = []; let x = best.k; while (!taken.has(x)) { path.unshift(x); x = prev.get(x); }
    for (const k of path) { if (order.length >= steps) break; taken.add(k); order.push({ r: Math.floor(k / GRID), c: k % GRID }); }
  }
  // the next board hangs on the gate at the top – the way there comes last
  if (opts.exit) {
    let gate = -1;
    for (let c = 0; c < GRID; c++) { const n = par.nodes[cell(0, c)]; if (n && n.t === 'gate') gate = key(0, c); }
    if (gate >= 0 && !taken.has(gate)) {
      const prev = new Map(); const seen = new Set(taken); const q = [...taken];
      while (q.length && !seen.has(gate)) {
        const k = q.shift(); const r = Math.floor(k / GRID), c = k % GRID;
        for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const rr = r + dr, cc = c + dc; const kk = key(rr, cc);
          if (!at(rr, cc) || seen.has(kk)) continue;
          seen.add(kk); prev.set(kk, k); q.push(kk);
        }
      }
      const path = []; let x = gate; while (prev.has(x) && !taken.has(x)) { path.unshift(x); x = prev.get(x); }
      for (const k of path) { taken.add(k); order.push({ r: Math.floor(k / GRID), c: k % GRID, exit: true }); }
    }
  }
  return order;
}

/** Boards, glyphs and the order of nodes per board, all by what they add to this build. */
function paragonPlan(d2, cls, prof, cdb, state, on, glyphClass) {
  const par = d2 && d2.paragon;
  if (!par) return null;
  const mainStat = MAIN_STAT[cls];
  const boards = [];
  for (const k of cdb.boards || []) {
    const b = par.boards[k];
    if (!b) continue;
    const keys = new Set();
    for (const row of b.rows) for (const n of String(row).split(',')) if (n) keys.add(n);
    const leg = [...keys].map((n) => par.nodes[n]).find((n) => n && n.r >= 4);
    const start = /_00$/.test(k);
    const v = leg ? nodeValue(state, DM.parseEffects(leg.d, prof), on) : 0;
    boards.push({ key: k, name: b.name, start, node: leg ? leg.name : '', desc: leg ? leg.d : '', v, effects: leg ? DM.parseEffects(leg.d, prof).map((e) => ({ kind: e.kind, v: e.v, cond: e.cond })) : [] });
  }
  const chosen = boards.filter((b) => b.start).concat(boards.filter((b) => !b.start).sort((a, b) => b.v - a.v).slice(0, 4));
  // glyphs: their bonus line is read like an aspect; only the class's own (maxroll's class list)
  const glyphs = Object.entries(par.glyphs).filter(([, g]) => !glyphClass || !glyphClass[g.name] || glyphClass[g.name].includes(cls)).map(([k, g]) => {
    const fx = DM.parseEffects(g.bonus, prof);
    const own = new RegExp('\\b' + mainStat + '\\b').test(g.desc) || !/(Strength|Intelligence|Dexterity|Willpower)/.test(g.desc);
    return { key: k, name: g.name, desc: g.desc, bonus: g.bonus, v: own ? nodeValue(state, fx, on) : -1 };
  }).filter((g) => g.v >= 0).sort((a, b) => b.v - a.v || scoreText(prof.p, b.desc + ' ' + b.bonus, []).score - scoreText(prof.p, a.desc + ' ' + a.bonus, []).score).slice(0, chosen.length);
  const out = chosen.map((b, i) => {
    const board = par.boards[b.key];
    const order = boardPath(par, board, prof, mainStat, state, on, { points: 80, socketValue: glyphs[i] ? glyphs[i].v : 0, exit: i < chosen.length - 1 });
    const nodes = {};
    for (const row of board.rows) for (const n of String(row).split(',')) if (n && par.nodes[n]) nodes[n] = par.nodes[n];
    return Object.assign({}, b, { rows: board.rows, nodes, order: order || [], glyph: glyphs[i] || null });
  });
  return { boards: out, glyphs, others: boards.filter((b) => !b.start && !chosen.includes(b)).sort((a, b) => b.v - a.v).slice(0, 4) };
}

/** The skills to put next to the main one, each with its role and why. */
function skillBar(cdb, p, main) {
  const shared = (s) => s.tags.filter((t) => /^Skill_/.test(t) && p.tags.has(t) && t !== 'Skill_Mobility').length + (s.el && s.el === p.el ? 1 : 0);
  const taken = new Set([main.key]);
  const bar = [{ key: main.key, name: main.name, role: 'Main skill', why: main.cat + (main.el ? ' · ' + main.el : '') }];
  const pick = (role, filter, why, bonus) => {
    const c = cdb.skills.filter((s) => !taken.has(s.key) && filter(s)).map((s) => ({ s, v: shared(s) * 10 + (bonus ? bonus(s) : 0) })).sort((a, b) => b.v - a.v)[0];
    if (!c) return;
    taken.add(c.s.key);
    bar.push({ key: c.s.key, name: c.s.name, role, why: typeof why === 'function' ? why(c.s) : why });
  };
  if (p.spender) pick('Generator', (s) => s.gen && /Basic/.test(s.cat), (s) => 'builds ' + (cdb.resource || 'resource') + ' for ' + main.name + (shared(s) ? ', shares its tags' : ''));
  pick('Defensive', (s) => /Defensive|Subterfuge|Aura|Macabre/.test(s.cat) || s.tags.some((t) => /Keyword_(Unstoppable|Barrier|Immune)/.test(t)),
    (s) => 'keeps you alive' + (s.tags.includes('Keyword_Unstoppable') ? ' – Unstoppable' : s.tags.includes('Keyword_Barrier') ? ' – Barrier' : ''),
    (s) => (s.tags.includes('Keyword_Unstoppable') ? 8 : 0) + (s.tags.includes('Keyword_Barrier') ? 6 : 0));
  if (!p.vulnerable) {
    pick('Vulnerable', (s) => s.tags.includes('Keyword_Vulnerable') || s.mods.some((m) => m.tags.includes('Keyword_Vulnerable')),
      'makes enemies Vulnerable – x1.2 damage and turns on every Vulnerable bonus');
  }
  pick('Mobility', (s) => s.tags.includes('Skill_Mobility') && !/Ultimate/.test(s.cat), 'gets you out and around');
  if (!/Ultimate/.test(main.cat)) pick('Ultimate', (s) => /Ultimate/.test(s.cat), (s) => (shared(s) ? 'shares tags with ' + main.name : 'strongest cooldown'));
  while (bar.length < 6) {
    const before = bar.length;
    pick('Support', (s) => s.cat !== 'Basic' || !p.spender, (s) => (shared(s) ? 'shares tags with ' + main.name : 'fills the bar'), (s) => (s.tags.includes('Search_Damage') ? 2 : 0));
    if (bar.length === before) break;
  }
  return bar.slice(0, 6);
}

/** Paragon: the class boards and glyphs whose texts suit the skill (from d2core's texts). */
function paragonFor(d2, cls, p, boardKeys) {
  const par = d2 && d2.paragon;
  if (!par) return null;
  const boards = [];
  for (const k of boardKeys || []) {
    const b = par.boards[k];
    if (!b || /_00$/.test(k)) continue;
    const keys = new Set();
    for (const row of b.rows) for (const n of String(row).split(',')) if (n) keys.add(n);
    const leg = [...keys].map((n) => par.nodes[n]).find((n) => n && n.r >= 4);
    if (!leg) continue;
    const sc = scoreText(p, leg.d, []);
    boards.push({ key: k, name: b.name, node: leg.name, desc: leg.d, score: sc.score, why: sc.why });
  }
  boards.sort((a, b) => b.score - a.score);
  const glyphs = Object.entries(par.glyphs).map(([k, g]) => {
    const t = g.desc + ' ' + g.bonus;
    const sc = scoreText(p, t, []);
    const main = new RegExp('\\b' + esc(MAIN_STAT[cls]) + '\\b').test(t);
    return { key: k, name: g.name, desc: g.desc, bonus: g.bonus, score: sc.score + (main ? 10 : 0), why: sc.why };
  }).filter((g) => g.score > 0 && classGlyph(g, cls)).sort((a, b) => b.score - a.score);
  return { boards: boards.slice(0, 4), glyphs: glyphs.slice(0, 5) };
}
// d2core keeps no class on a glyph; one built on another class's main stat is not for this one
function classGlyph(g, cls) {
  const t = g.desc + ' ' + g.bonus;
  const stats = ['Strength', 'Intelligence', 'Dexterity', 'Willpower'].filter((s) => new RegExp('\\b' + s + ' purchased').test(t));
  return !stats.length || stats.includes(MAIN_STAT[cls]);
}

/** The numbers to aim for, each with why – from the damage and defence formulas. */
function targetsFor(p, cls) {
  const t = [];
  if (p.crit) t.push({ stat: 'Critical Strike Chance', goal: 'as high as you can get it – 100% is the cap', why: 'Crits multiply by x1.5 plus your Crit Damage multipliers. Every point above 100% is wasted.' });
  else t.push({ stat: 'Critical Strike', goal: 'skip it', why: p.name + ' deals damage over time – damage over time cannot crit, so Crit Chance and Crit Damage do nothing for it.' });
  if (p.cooldown) t.push({ stat: 'Cooldown Reduction', goal: 'about 50–60% for a cooldown rotation', why: 'Every source multiplies with the others, so each one adds a bit less. Aim for the point where your key buffs and ' + p.name + ' are always up.' });
  if (!p.cooldown || p.spender) t.push({ stat: 'Attack Speed', goal: 'up to the next breakpoint', why: 'Capped at 100% Attack Speed plus 100% Cast Speed. Skills animate in whole frames, so speed between two breakpoints changes nothing. Planner sites list the frames per weapon.' });
  if (p.spender) t.push({ stat: 'Maximum Resource / Cost Reduction', goal: 'enough to cast without pauses', why: 'A spender that runs dry does no damage. Check your pool first if your damage feels uneven.' });
  t.push({ stat: 'Vulnerable', goal: 'near 100% uptime', why: 'Vulnerable enemies take x1.2 damage on its own, and every Vulnerable Damage Multiplier counts on top.' + (p.vulnerable ? ' ' + p.name + ' can apply it itself (see its modifiers).' : '') });
  if (p.overpower) t.push({ stat: 'Overpower', goal: '4 stacks (the base cap)', why: 'Each stack adds +15% damage to the additive bucket and lasts 4 seconds.' });
  t.push({ stat: 'Resistances', goal: 'balanced, all six', why: 'Damage reduction = R / (R × 10/9 + 1136) at level 70: 1136 gives 47%, 3000 gives 67%, 5000 gives 75%. There is no hard cap any more (since Season 11), but each point adds less.' });
  t.push({ stat: 'Armor', goal: '10,000–20,000+', why: 'Reduction = A / (A × 10/9 + 5678): 10,000 Armor gives 60%, 20,000 gives 72%. Every Strength point adds 2 Armor.' });
  t.push({ stat: MAIN_STAT[cls], goal: 'as much as the slots allow', why: 'Main stat is its own multiplier: +' + STAT_PER10[cls] + '% damage per 10 points for a ' + cls + '.' });
  return t;
}

/** Things a first build tends to forget. */
function tipsFor(p, cls, bar) {
  const tips = [
    'Turn on Options → Gameplay → Advanced Tooltip Information – only then does the game show [x] (multiplier) and [+] (additive) on every bonus.',
    '[+] bonuses are all added into one pool; once that pool is big, another +20% hardly shows. [x] bonuses multiply – late in the game they are worth far more.',
    'A conditional bonus is only worth its uptime: +60% against Vulnerable at 10% uptime is less than +30% that always applies.',
    'Skill ranks raise the skill % itself, which multiplies everything else – "+X to ' + p.name + '" is among the best rolls.',
    'Weapon damage is the base every skill hit is built on: a +X roll on a weapon with Y average damage is worth X / Y more. Flat damage effects (Thorns and the like) ignore it.',
    'Only one crafted mythic can be worn – pick the one that fits the build, not the rarest.',
    'Tempers and masterworking come last – first get the right aspects into the codex and the uniques in place.',
  ];
  if (!p.crit) tips.push(p.name + ' deals damage over time: Crit Chance and Crit Damage do nothing for it. Damage Over Time multipliers do.');
  if (p.spender) tips.push(p.name + ' costs ' + (bar.find((b) => b.role === 'Generator') ? 'resource – the generator on your bar refills it' : 'resource – keep an eye on Maximum Resource and Cost Reduction'));
  if (p.cooldown) tips.push('A cooldown build gains more from Cooldown Reduction than from Attack Speed.');
  tips.push('Keep one Unstoppable skill or effect on the bar – crowd control kills more often than damage.');
  return tips;
}

/** A build in the shape the farm list keeps, from a plan – gear only (the skills are added in main with d2core ids). */
/** "x[26 - 50]% Critical Strike Damage Multiplier" -> "x50% Critical Strike Damage Multiplier" – the roll to look for. */
const bestRoll = (d) => String(d).replace(/\[([\d.,]+)\s*-\s*([\d.,]+)\]/g, '$2').replace(/\s+/g, ' ').trim();

/** A build in the shape the farm list keeps, from a plan – gear only. */
function toBuild(pl, name) {
  const slots = {};
  for (const [s, g] of Object.entries(pl.gear)) {
    if (!g.piece) continue;
    const stats = g.stats.slice(0, 3).map((x) => ({ t: bestRoll(x.d) })).concat(g.tempers.slice(0, 1).map((x) => ({ t: bestRoll(x.d), tmp: 1 })));
    slots[s] = Object.assign(g.piece.kind === 'unique' ? { item: g.piece.name } : { aspects: [g.piece.name] }, stats.length ? { stats } : {});
  }
  return { name: name || (pl.skill.name + ' ' + pl.cls).slice(0, 40), cls: pl.cls, slots };
}

/**
 * The whole build the player made in the builder, for the farm list: gear (their own picks where
 * they swapped), the skill bar with its modifiers (lit in the skill tree view), the paragon boards
 * with glyphs and nodes (drawn by the paragon view, boards stacked gate to gate) and the charm set.
 * @param picks  { pieces: {slot: name}, mods: {"<bar index><group>": modifier}, on, goal, name }
 */
function buildFor(dbx, cls, skillKey, picks, extra) {
  const x = Object.assign({}, extra || {}, { on: (picks && picks.on) || undefined });
  const pl = plan(dbx, cls, skillKey, x);
  if (!pl) return null;
  const d2 = x.d2;
  const pk = picks || {};
  const byName = new Map(pl.engine.cands.map((c) => [c.name, c]));
  const slots = {};
  for (const s of pl.engine.slots) {
    const g = pl.gear[s] || { stats: [], tempers: [] };
    const nm = (pk.pieces && pk.pieces[s]) || (g.piece && g.piece.name);
    if (!nm) continue;
    const c = byName.get(nm);
    const stats = g.stats.slice(0, 3).map((r) => ({ t: bestRoll(r.d) })).concat(g.tempers.slice(0, 1).map((r) => ({ t: bestRoll(r.d), tmp: 1 })));
    slots[s] = Object.assign((c ? c.kind : g.piece && g.piece.kind) === 'unique' ? { item: nm } : { aspects: [nm] }, stats.length ? { stats } : {});
  }
  const out = { name: (pk.name || pl.skill.name + ' ' + cls).slice(0, 40), cls, slots };
  // skills: the bar, a rank in each, the main skill at 5; one point in every chosen modifier
  if (d2 && d2.tree && d2.tree[cls]) {
    const nodes = d2.tree[cls].nodes;
    const ranks = {};
    pl.barMods.forEach((b, i) => {
      const n = nodes.find((t) => t.pw === b.key);
      if (!n) return;
      ranks[n.id] = i === 0 ? 5 : 1;
      const sk = d2.skills[n.id];
      for (const g of b.mods) {
        const want = (pk.mods && pk.mods[i + g.group]) || g.chosen;
        const modId = sk && Object.keys(sk.mods || {}).find((id) => sk.mods[id].name === want);
        if (modId) ranks[n.id + '_' + modId] = 1;
      }
    });
    out.skills = { bar: d2db.barFromKeys(d2, cls, pl.barMods.map((b) => b.key), ranks), ranks };
  }
  // paragon: the start board at the bottom, every next one above it, joined at the gates
  if (pl.paragonPlan && pl.paragonPlan.boards.length) {
    out.paragon = { boards: pl.paragonPlan.boards.map((b, i) => Object.assign({ k: b.key, x: 0, y: -i, rot: 0, nodes: b.order.map((o) => [o.r, o.c]) },
      b.glyph ? { glyph: b.glyph.key, glyphRank: 0 } : {})) };
  }
  // charms: the best set, as many of its pieces as its biggest bonus asks for
  const set = pl.talisman && pl.talisman[0];
  if (d2 && d2.talisman && set) {
    const key = Object.keys(d2.talisman.sets).find((k) => d2.talisman.sets[k].name === set.name);
    const need = Math.max(...set.bonuses.map((b) => b.n), 2);
    const pieces = Object.entries(d2.talisman.items).filter(([, it]) => it.set === key && !/seal/i.test(it.type)).slice(0, need).map(([k]) => ({ key: k }));
    const ch = pieces.length ? d2db.charmsOf(d2, pieces) : null;
    if (ch) out.charms = ch;
  }
  return out;
}

// ---- loading -------------------------------------------------------------------------------
async function fetchDb(net, d2build, log) {
  const res = await net.fetch(DATA_URL);
  if (!res.ok) throw new Error('game data: HTTP ' + res.status);
  const data = await res.json();
  let affixFile = { affix: [] };
  const d2items = {};
  if (d2build) {
    const get = async (name) => {
      const r = await net.fetch(`https://cloudstorage.d2core.com/data/d4/${d2build.build}/${name}_enUS.json?env=prod&v=${d2build.rev}`);
      if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
      return r.json();
    };
    try { affixFile = await get('affix'); } catch (e) { if (log) log('builder: d2core affixes failed:', e.message); }
    try { d2items.unique = await get('uniqueItem'); d2items.aspect = await get('aspect'); } catch (e) { if (log) log('builder: d2core items failed, maxroll\'s instead:', e.message); }
    try { d2items.splinter = await get('soulSplinter'); d2items.gem = await get('gem'); } catch (e) { if (log) log('builder: d2core sockets failed:', e.message); }
  }
  const out = Object.assign(slim(data, affixFile, d2items), { fetchedAt: Date.now(), tiers: (db && db.tiers) || [], tiersAt: (db && db.tiersAt) || 0 });
  if (log) log('builder data:', out.aspects.length, 'aspects,', out.uniques.length, 'uniques,', Object.keys(out.pools).length, 'class pools');
  return out;
}

async function refreshTiers(net, log) {
  try {
    const res = await net.fetch(TIER_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const t = parseTierList(await res.text());
    if (t.length >= 10) { db.tiers = t; db.tiersAt = Date.now(); }
  } catch (e) { if (log) log('builder: tier list failed:', e.message); }
}

/** The data, fetched on first use and once a week (the tier list once a day); an old copy beats none. */
async function load(net, d2build, log) {
  if (db && Date.now() - db.fetchedAt < MAX_AGE && Date.now() - (db.tiersAt || 0) < TIER_AGE) return db;
  if (!pending) {
    pending = (async () => {
      if (!db || Date.now() - db.fetchedAt >= MAX_AGE) {
        try { db = await fetchDb(net, typeof d2build === 'function' ? await d2build() : d2build, log); }
        catch (e) { if (log) log('builder data failed:', e.message); if (!db) throw e; }
      }
      if (Date.now() - (db.tiersAt || 0) >= TIER_AGE) await refreshTiers(net, log);
      try { fs.writeFileSync(file, JSON.stringify(db)); } catch (_) {}
      return db;
    })().finally(() => { pending = null; });
  }
  return pending;
}

/** Classes and their skills for the picker, each skill with the guides that play it. */
function catalog(dbx) {
  const out = [];
  for (const c of CLASSES) {
    const x = dbx.classes[c];
    if (!x) continue;
    out.push({ cls: c, main: x.main, resource: x.resource,
      skills: x.skills.filter((s) => s.el || s.tags.includes('Skill_Primary_Summoning')).map((s) => {
        const g = guidesFor(dbx.tiers, c, s.name);
        return { key: s.key, name: s.name, cat: s.cat, el: s.el, desc: s.desc.slice(0, 220), tier: g.length ? g[0].tier : '' };
      }) });
  }
  return out;
}

// ---- why a proven build works ------------------------------------------------------------
const LEORIC = "Leoric's Crown";
const JEWELRY = /^(Amulet|Ring)/;
const PROVIDES = [
  ['berserk', /\b(gain|grants?|always|become) Berserking|Berserking for/i], ['fortified', /\bFortif(y|ied)\b/i], ['barrier', /\bBarrier\b/i],
  ['overpower', /\b(gain|grants?) (\d+ )?(stacks? of )?Overpower|Overpower stack/i], ['unstoppable', /\bUnstoppable\b/i],
];
const scale = (effects, f) => effects.map((e) => (e.v && e.kind !== 'teleport' ? Object.assign({}, e, { v: e.v * f }) : e));

/**
 * A proven build (an imported variant) worked out with the damage model: what each piece adds –
 * its power, its stats, what sits in its sockets – and in plain words why the build works.
 * @param variant  { slots: {slot: {item|aspects, stats, sockets}}, skills: {bar}, charms }
 */
function explainBuild(dbx, cls, skillKey, variant, extra) {
  const pl = plan(dbx, cls, skillKey, extra);
  if (!pl) return null;
  const prof = pl._prof;
  const cdb = dbx.classes[cls];
  const byName = new Map(pl.engine.cands.map((c) => [c.name.toLowerCase(), c]));
  const leoric = Object.entries(variant.slots || {}).some(([s, x]) => /^Helm/.test(s) && x.item === LEORIC);
  const roll = (t) => { const r = DM.rollOf(t, prof); return r ? { kind: 'roll', k: r.k, v: r.v, cond: [], scope: 'all', text: t } : null; };

  // the pieces with everything they bring
  const pieces = [];
  for (const [slot, x] of Object.entries(variant.slots || {})) {
    const names = x.item ? [x.item] : (x.aspects || []);
    const rolls = (x.stats || []).map((s) => roll(s.t)).filter(Boolean);
    const sockets = [];
    for (const so of x.sockets || []) {
      const d = dbx.sockets && dbx.sockets[so];
      if (!d) { sockets.push({ name: so, effects: [], text: '' }); continue; }
      const jewel = JEWELRY.test(slot) || (/^Helm/.test(slot) && leoric);
      let fx = [], text = '';
      if (d.kind === 'splinter') {
        text = jewel ? d.jewelry : d.stat;
        fx = jewel ? DM.parseEffects(d.jewelry, prof) : [];
        const st = roll(d.stat); if (st) fx.push(st);
      } else {
        text = /^(Weapon|Off-Hand)/.test(slot) ? d.weapon : JEWELRY.test(slot) ? d.jewelry : d.armor;
        const r = roll(text); if (r) fx.push(r);
      }
      // Leoric's Crown: the helm counts as jewellery and its sockets work half as much again
      if (/^Helm/.test(slot) && leoric) fx = scale(fx, 1.5);
      sockets.push({ name: so, kind: d.kind, text, effects: fx, boosted: /^Helm/.test(slot) && leoric });
    }
    names.forEach((nm, i) => {
      const c = byName.get(String(nm).toLowerCase());
      pieces.push({
        slot, name: nm, kind: c ? c.kind : (x.item ? 'unique' : 'aspect'), mythic: !!(c && c.mythic), desc: c ? c.desc : '',
        known: !!c, effects: (c ? c.effects : []).concat(i === 0 ? rolls : []), sockets: i === 0 ? sockets : [],
        stats: i === 0 ? (x.stats || []).map((s) => s.t) : [],
      });
    });
  }
  // the bar and its modifiers
  const bar = ((variant.skills && variant.skills.bar) || []).map((b) => {
    const s = cdb.skills.find((k) => k.name.toLowerCase() === String(b.name).toLowerCase());
    const mods = (b.mods || []).map((m) => (s && s.mods.find((x) => x.name === m)) || { name: m, desc: '', tags: [] });
    return { name: b.name, key: s ? s.key : '', mods: mods.map((m) => ({ name: m.name, desc: m.desc, tags: m.tags })) };
  });
  // what the build itself switches on
  const on = Object.assign({}, pl.conditions);
  const texts = pieces.map((p) => p.desc).concat(bar.flatMap((b) => b.mods.map((m) => m.desc)), pieces.flatMap((p) => p.sockets.map((s) => s.text)));
  for (const [id, re] of PROVIDES) if (texts.some((t) => re.test(t))) on[id] = true;
  if (bar.some((b) => b.mods.some((m) => (m.tags || []).includes('Keyword_Vulnerable'))) || pieces.some((p) => p.effects.some((e) => e.kind === 'vuln'))) on.vulnerable = true;

  const all = (p) => p.effects.concat(...p.sockets.map((s) => s.effects));
  const stateOf = (list) => list.reduce((st, p) => all(p).reduce((s, e) => DM.apply(s, e, on), st), pl.engine.base);
  const full = stateOf(pieces);
  const share = (p) => OPT.delta(stateOf(pieces.filter((x) => x !== p)), full);
  const rows = pieces.map((p) => Object.assign({}, p, share(p)));
  // Leoric's own share: its sockets without the boost and as plain armour gems
  if (leoric) {
    const helm = rows.find((r) => r.name === LEORIC);
    if (helm) {
      const plainHelm = Object.assign({}, helm, { sockets: helm.sockets.map((s) => Object.assign({}, s, { effects: s.kind === 'splinter' ? s.effects.filter((e) => e.kind === 'roll').map((e) => Object.assign({}, e, { v: e.v / 1.5 })) : scale(s.effects, 1 / 1.5) })) });
      Object.assign(helm, OPT.delta(stateOf(pieces.map((x) => (x.name === LEORIC ? plainHelm : x))), full));
    }
  }

  // in words
  const f = DM.damage(full).f;
  const lines = [];
  const pct = (v) => (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '%';
  const dmgTop = rows.filter((r) => r.dmg > 1).sort((a, b) => b.dmg - a.dmg).slice(0, 4);
  if (dmgTop.length) lines.push({ k: 'damage', t: 'Damage comes from ' + dmgTop.map((r) => r.name + ' (' + pct(r.dmg) + ')').join(', ') + '.' });
  if (prof.dot) {
    const hf = rows.find((r) => r.sockets.some((s) => /Hellfire/.test(s.name)));
    lines.push({ k: 'crit', t: pl.skill.name + ' deals damage over time and cannot crit' + (hf ? ' – so the Splinter of Hellfire\'s "lose 100% Critical Strike Chance" costs nothing and its 50%[x] is pure gain.' : ' – crit stats are left out on purpose.') });
  } else {
    lines.push({ k: 'crit', t: 'Crits: about ' + Math.round(f.chance * 100) + '% chance, a crit hits ×' + f.critF.toFixed(1) + ' – so crit chance and crit damage multipliers both pull their weight.' });
  }
  if (on.vulnerable) {
    const src = rows.filter((r) => r.effects.some((e) => e.kind === 'vuln')).map((r) => r.name).concat(bar.filter((b) => b.mods.some((m) => (m.tags || []).includes('Keyword_Vulnerable'))).map((b) => b.name + ' (' + b.mods.find((m) => (m.tags || []).includes('Keyword_Vulnerable')).name + ')'));
    if (src.length) lines.push({ k: 'vuln', t: 'Vulnerable (×1.2 and every Vulnerable bonus) comes from ' + src.slice(0, 3).join(', ') + '.' });
  }
  const toughTop = rows.filter((r) => r.tough > 1).sort((a, b) => b.tough - a.tough).slice(0, 3);
  if (toughTop.length) lines.push({ k: 'tough', t: 'It stays alive through ' + toughTop.map((r) => r.name + ' (' + pct(r.tough) + ' toughness)').join(', ') + ' – damage reduction sources multiply.' });
  const fast = rows.filter((r) => r.speed > 1).sort((a, b) => b.speed - a.speed);
  if (fast.length) lines.push({ k: 'speed', t: 'Speed: ' + fast.slice(0, 3).map((r) => r.name + (r.effects.some((e) => e.kind === 'teleport') ? ' (Evade becomes Teleport)' : ' (' + pct(r.speed) + ' speed)')).join(', ') + ' – this is what clears maps fast.' });
  const spl = rows.flatMap((r) => r.sockets.filter((s) => s.kind === 'splinter').map((s) => Object.assign({ at: r.name }, s)));
  if (leoric) lines.push({ k: 'leoric', t: 'Leoric\'s Crown makes the helm count as jewellery: the soul splinters in it (' + spl.filter((s) => s.boosted).map((s) => s.name.replace('Abyssal Splinter of ', '')).join(', ') + ') work 50% stronger – worth ' + pct((rows.find((r) => r.name === LEORIC) || {}).dmg || 0) + ' damage and ' + pct((rows.find((r) => r.name === LEORIC) || {}).tough || 0) + ' toughness here.' });
  if (spl.length) lines.push({ k: 'splinter', t: 'Soul splinters: ' + spl.map((s) => s.name.replace('Abyssal Splinter of ', '') + ' – ' + s.text).slice(0, 4).join(' · ') });
  const relies = [...new Set(rows.flatMap((r) => r.effects.flatMap((e) => e.cond)))].filter((c) => on[c] && !['buff', 'stacks', 'luckyhit', 'crit'].includes(c));
  if (relies.length) lines.push({ k: 'cond', t: 'It relies on: ' + relies.map((c) => ((DM.CONDITIONS.find((x) => x[0] === c) || [])[1] || c)).join(', ') + ' – the build makes these happen itself.' });
  const unknown = rows.filter((r) => !r.known || !r.effects.some((e) => e.kind !== 'proc' && e.kind !== 'scaled'));
  if (unknown.length) lines.push({ k: 'other', t: 'Not counted by the model (utility, procs or newer than the data): ' + unknown.map((r) => r.name).join(', ') + '.' });

  return {
    skill: pl.skill, on, lines, bar,
    gear: rows.map((r) => ({ slot: r.slot, name: r.name, kind: r.kind, mythic: r.mythic, desc: r.desc, dmg: r.dmg, tough: r.tough, speed: r.speed,
      stats: r.stats, sockets: r.sockets.map((s) => ({ name: s.name, kind: s.kind || '', text: s.text, boosted: !!s.boosted })) })),
    totals: { crit: Math.max(0, Math.round(f.chance * 100)), critX: +f.critF.toFixed(2), vulnX: +f.vulnF.toFixed(2), cdr: Math.round(full.cdr), as: Math.round(full.as),
      ranks: full.rank - 1, dr: Math.round((1 - full.dr.reduce((a, d) => a * (1 - d / 100), 1)) * 100), move: Math.round(full.move), teleport: !!full.teleport },
  };
}

module.exports = { explainBuild, buildFor, configure, load, catalog, plan, toBuild, slim, cleanDesc, evalFormula, parseTierList, guidesFor, scoreText, profileOf, statValue,
  slimAffixFile, CLASSES, VERSION };
