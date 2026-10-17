'use strict';
// What a guide says besides the gear – the part a player sets up once and the part that explains it:
//
//   setup   the class mechanic (Specialization, Soul Shard, Enchantments, Oath, Weapon Technique,
//           Spirit Boons …) and the mercenaries (hired, reinforcement, its skill and what sets it off),
//           read from each site's own build data when it is imported
//   recipe  breakpoints, rotation, must-have pieces and why it works – read out of the authors' notes
//           by d4builder (../d4builder/data/recipes, taken over by tools/sync-recipes.js into
//           lib/data/recipes.json), each with the author's own words. Notes in Chinese are read in
//           Chinese there, the recipe is English.
//
// Names come from maxroll's game data (lib/builder.js keeps them as db.names); without it the keys
// are made readable, never left out.
let RECIPES = null;
const recipes = () => {
  if (!RECIPES) { try { RECIPES = require('./data/recipes.json'); } catch (_) { RECIPES = {}; } }
  return RECIPES;
};

// ---- the class mechanic -----------------------------------------------------------------
/** The group a mechanic's game key belongs to – the name the game gives that choice. */
function groupOf(key) {
  const k = String(key || '');
  if (/Talent_Mechanic/i.test(k)) return 'Specialization';
  if (/Sorcerer_Enchantment/i.test(k)) return 'Enchantment';
  if (/Paladin_Oath/i.test(k)) return 'Oath';
  if (/WeaponExpertise/i.test(k)) return 'Weapon Technique';
  if (/Warlock_ClassMechanic_\w+_C$/i.test(k)) return 'Shard Fragment';
  if (/Warlock_ClassMechanic/i.test(k)) return 'Soul Shard';
  if (/Druid_Passive_/i.test(k)) return 'Spirit Boon';
  if (/^spiritborn_.*passive/i.test(k)) return 'Spirit Hall';
  if (/^Necromancer_.*(Passive|Upgrade)/i.test(k)) return 'Book of the Dead';
  return 'Class mechanic';
}
const bare = (k) => String(k || '').replace(/\.pow$/i, '').replace(/^Power_/, '');
const str = (v) => (typeof v === 'string' && v.trim() ? v.trim() : '');

/**
 * A variant's mechanic choices and mercenaries as the site keeps them – keys or names, not resolved yet.
 * @returns {{ mech: [{group?, key?, name?}], merc: {hired, support, skill, trigger} } | null}
 */
function extract(site, v) {
  if (!v || typeof v !== 'object') return null;
  const mech = [];
  const key = (k, group) => { const b = bare(k); if (b && !mech.some((m) => m.key === b)) mech.push(Object.assign({ key: b }, group ? { group } : {})); };
  const named = (n, group) => { const t = str(n); if (t && !mech.some((m) => m.name === t)) mech.push({ name: t, group }); };
  let merc = {};
  if (site === 'maxroll.gg') {
    key(v.specialization); key(v.warlockShard); key(v.warlockFragment); key(v.oath); key(v.technique);
    for (const f of ['enchants', 'spiritBoons', 'animalSpirits', 'minionUpgrades']) (Array.isArray(v[f]) ? v[f] : []).forEach((k) => key(k));
    const m = v.mercenary || {};
    const sk = Array.isArray(m.supportSkills) ? m.supportSkills : [];
    merc = { hired: m.id, support: m.support, skill: sk[0], trigger: sk[1] };
  } else if (site === 'd2core.com') {
    (Array.isArray(v.expertise) ? v.expertise : []).forEach((k) => key(k));
    const m = v.mercenary || {};
    merc = { hired: m.primary, support: m.reinforcement, skill: m.skill, trigger: m.opportunity };
  } else if (site === 'infinitybuilds.gg') {
    const m = v.mechanic || {};
    for (const [f, x] of Object.entries(m)) if (f !== 'type' && typeof x === 'string') key(x);
    const h = v.mercenary || {};
    merc = { hired: h.hired, support: h.reinforcement, skill: h.reinforcementSkill, trigger: h.reinforcementTrigger };
  } else if (site === 'd4builds.gg') {
    named(v.specialization, 'Specialization');
    named(v.expertise, 'Weapon Technique');
    named(v.oaths, 'Oath');
    (Array.isArray(v.enchantments) ? v.enchantments : []).forEach((n) => named(n, 'Enchantment'));
    if (v.boons && typeof v.boons === 'object') for (const list of Object.values(v.boons)) (Array.isArray(list) ? list : []).forEach((n) => named(n, 'Spirit Boon'));
    if (v.spiritHall && typeof v.spiritHall === 'object') ['Primary', 'Secondary'].forEach((s) => named(v.spiritHall[s], 'Spirit Hall'));
    merc = { hired: v.mercenary2, support: v.reinforcement2, skill: v.mercenarySkill2, trigger: v.mercenaryOpportunity2 };
  }
  const m = Object.fromEntries(Object.entries(merc).map(([k, x]) => [k, str(x)]).filter(([, x]) => x && !/^trigger_skill$/i.test(x)));
  if (!mech.length && !Object.keys(m).length) return null;
  return { mech, merc: m };
}

// ---- names -----------------------------------------------------------------------------
// the four mercenaries go by these in every site's data ("MercenaryClass_ShieldBearer", "raheir",
// "Subo, The Drunken Archer")
const MERCS = [['shieldbearer', 'Raheir'], ['berserkercrone', 'Varyana'], ['cursedchild', 'Aldkin'], ['bountyhunter', 'Subo'],
  ['raheir', 'Raheir'], ['varyana', 'Varyana'], ['aldkin', 'Aldkin'], ['subo', 'Subo']];
const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const mercName = (x) => { const l = loose(String(x).split(',')[0]); const hit = MERCS.find(([k]) => l.includes(k)); return hit ? hit[1] : str(x); };
/** "Mercenary_CursedChild_Wither" -> "Wither", "Rogue_RainofArrows" -> "Rain of Arrows" – when the game data has no name. */
const readable = (k) => {
  // the Spirit Hall's guardians carry no name in the game data: "spiritborn_gorilla_sun_passive"
  const sp = /^spiritborn_([a-z]+)_/i.exec(bare(k));
  if (sp) return sp[1][0].toUpperCase() + sp[1].slice(1).toLowerCase() + ' Spirit';
  const last = bare(k).split('_').filter((w) => w && !/^(NPC|Mercenary|Power|Passive|\d+)$/i.test(w)).pop() || bare(k);
  return last.replace(/([a-z])(of|the)([A-Z])/g, '$1 $2 $3').replace(/([a-z])([A-Z])/g, '$1 $2');
};

/**
 * Names for what extract() found. names: maxroll's game data, { skill: {lower-case key: name} }.
 * @returns {{ mech: [{group, name}], merc: {hired, support, skill, trigger} } | null}
 */
function resolve(x, names) {
  if (!x) return null;
  const sk = (names && names.skill) || {};
  const nameOf = (k) => sk[bare(k).toLowerCase()] || '';
  const mech = (x.mech || []).map((m) => (m.key
    ? { group: m.group || groupOf(m.key), name: nameOf(m.key) || readable(m.key) }
    : { group: m.group || 'Class mechanic', name: m.name })).filter((m) => m.name);
  const r = x.merc || {};
  const thing = (v) => (!v ? '' : /[_]/.test(v) ? nameOf(v) || readable(v) : v);
  const merc = Object.fromEntries(Object.entries({
    hired: r.hired && mercName(r.hired), support: r.support && mercName(r.support), skill: thing(r.skill), trigger: thing(r.trigger),
  }).filter(([, v]) => v));
  return mech.length || Object.keys(merc).length ? { mech, merc } : null;
}

// ---- recipes ---------------------------------------------------------------------------
/** A link as the recipes index it: no "www.", no variant in it ("?var=", "?variant=", "#3"), no slash at the end. */
const baseOf = (u) => String(u || '').trim().replace(/^https?:\/\/(www\.)?/i, '').replace(/[?&](var|variant)=[^&#]*/i, '').replace(/#.*$/, '').replace(/[?&]$/, '').replace(/\/$/, '').toLowerCase();
let index = null;
function indexOf() {
  if (index) return index;
  index = { exact: new Map(), base: new Map() };
  for (const [id, r] of Object.entries(recipes())) {
    // a link that names its variant (tools/sync-recipes.js leaves out links several variants share – d2core's)
    for (const [u, v] of Object.entries(r.urls || {})) { index.exact.set(String(u).toLowerCase(), { id, v }); index.base.set(baseOf(u), { id, v: null }); }
    if (r.url) index.base.set(baseOf(r.url), { id, v: null });
  }
  return index;
}

/** The recipe of a build link (a guide, a planner, a site's build, a variant of it): { id, variant } or null. */
function recipeOf(url) {
  const ix = indexOf();
  return ix.exact.get(String(url || '').trim().toLowerCase()) || ix.base.get(baseOf(url)) || null;
}

// a variant's name as the guide gives it – a Chinese one carries d4builder's English in brackets
const variantName = (n) => { const s = String(n || ''); const en = /[㐀-鿿]/.test(s) && /\(([^()]*[a-z][^()]*)\)\s*$/i.exec(s); return en ? en[1] : s; };
const SITE_OF = { maxroll: 'maxroll', d4builds: 'd4builds', infinitybuilds: 'infinitybuilds', d2core: 'd2core' };

/**
 * What the farm list shows of a recipe. For one variant: the lines about other variants are left
 * out; not knowing the variant: every line, the ones about some variants saying which (for).
 * @returns {{ id, site, url, skill, summary, core, thresholds, rotation, options, variant, at } | null}
 */
function sheetOf(id, v) {
  const r = recipes()[id];
  if (!r) return null;
  const mine = (x) => !v || !Array.isArray(x.variants) || !x.variants.length || x.variants.includes(v);
  const plain = (x) => {
    const o = Object.assign({}, x);
    delete o.variants;
    if (!v && Array.isArray(x.variants) && x.variants.length && x.variants.length < Object.keys(r.variants || {}).length) o.for = x.variants.map((k) => variantName((r.variants || {})[k])).filter(Boolean);
    return o;
  };
  return {
    id, site: SITE_OF[id.split('/')[0]] || '', url: r.url || '', title: r.title || '', author: r.author || '', skill: r.skill, cls: r.cls, summary: r.summary,
    variant: v ? variantName((r.variants || {})[v]) : '', at: r.extractedAt || '',
    core: r.core.filter(mine).map(plain), thresholds: r.thresholds.filter(mine).map(plain),
    rotation: r.rotation.filter(mine).map(plain), options: r.options.filter(mine).map(plain),
  };
}
/** The recipe of a build link, for its variant when the link names one. */
function sheetFor(url) {
  const hit = recipeOf(url);
  return hit ? sheetOf(hit.id, hit.v) : null;
}
/** A skill's recipes – for a build made in the builder: maxroll's first, then the other sites. */
function sheetsForSkill(cls, skill) {
  const s = String(skill || '').toLowerCase();
  const order = ['maxroll', 'd4builds', 'infinitybuilds', 'd2core'];
  return Object.entries(recipes()).filter(([, r]) => r.cls === cls && String(r.skill || '').toLowerCase() === s)
    .sort((a, b) => order.indexOf(a[0].split('/')[0]) - order.indexOf(b[0].split('/')[0])).map(([id]) => sheetOf(id, null));
}

module.exports = { extract, resolve, groupOf, recipeOf, sheetFor, sheetsForSkill, baseOf, recipes };
