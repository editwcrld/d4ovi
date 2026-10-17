'use strict';
// Builds from infinitybuilds.gg.
//
//   link     infinitybuilds.gg/en/builds/<slug>-<id>[?variant=v-…]  (any language path)
//   data     a Next.js page: the build comes inside the page's React Server Components stream
//            (self.__next_f.push([1, "…"]) chunks). Joined, the stream is rows of "id:json"
//            (text rows "id:T<hex length>,…" carry long HTML); one row holds the page's props
//            with build.variants – every variant complete: gear, skills, paragon, talisman.
//   names    tools.infinitybuilds.gg/api/games/diablo4/build-data – the site's tooltips: English
//            names, roll ranges, skills d2core does not have (the Warlock's commands)
//
// The ids are the game's own keys, written the site's way: "affix-s04-critchance" is
// S04_CritChance, "paragon-board::paragon-warlock-03" Paragon_Warlock_03, "item-gem-ruby-08-itm"
// Item_Gem_Ruby_08, a skill tree node "warlock::skill-891" the game's node 891 (the ids maxroll
// saves ranks by). Gear carries a name in its author's language ("itemName") – only a fallback.
//
// Paragon: a board's nodes are counted on the board as drawn unturned (row * 21 + column), but
// the gates a board hangs on ("selfGateId" / "parentGateId") are named by where they sit after
// turning – the parent's gate says on which side the next board goes.
const { fitter, buildName } = require('./buildfit');
const d2db = require('./d2coredb');
const guideinfo = require('./guideinfo');
const mb = require('./maxbuild');

const SITE = 'https://infinitybuilds.gg';
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];
const N = 21;

// the site's gear slots -> ours, in the order they are filled; dual wield blades may go into the off-hand
const SLOTS = [
  ['helm', 'Helm'], ['chest', 'Chest Armor'], ['gloves', 'Gloves'], ['pants', 'Pants'], ['boots', 'Boots'],
  ['amulet', 'Amulet'], ['ring1', 'Ring'], ['ring2', 'Ring'],
  ['weapon', 'Weapon'], ['offhand', 'Off-Hand'], ['twoHander', 'Weapon'], ['mainhand', 'Weapon'], ['offhandWeapon', 'Weapon'],
];

/** The build's slug from an infinitybuilds.gg link, and the variant it opens on ("?variant=v-…"). */
function parseUrl(input) {
  const t = String(input || '').trim();
  const m = t.match(/infinitybuilds\.gg\/(?:[a-z]{2}(?:-[a-z]{2,4})?\/)?builds\/([A-Za-z0-9_-]{4,160})/i);
  if (!m || /^(new|edit)$/i.test(m[1])) return null;
  const v = t.match(/[?&]variant=([A-Za-z0-9_-]{1,80})/);
  return Object.assign({ slug: m[1] }, v ? { variant: v[1] } : {});
}

// ---- page -----------------------------------------------------------------------------
/** The page's Server Components stream, as rows of JSON text (the long text rows are skipped). */
function rscRows(html) {
  let s = '';
  for (const m of String(html).matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) {
    try { s += JSON.parse('"' + m[1] + '"'); } catch (_) { /* a chunk we cannot read – its row fails below */ }
  }
  const buf = Buffer.from(s, 'utf8');
  const rows = [];
  let i = 0;
  while (i < buf.length) {
    const c = buf.indexOf(0x3a, i);                       // ':'
    if (c < 0) break;
    if (buf[c + 1] === 0x54) {                            // 'T' – the length counts UTF-8 bytes, no newline follows
      const comma = buf.indexOf(0x2c, c);
      const len = parseInt(buf.subarray(c + 2, comma).toString('latin1'), 16);
      if (comma < 0 || !Number.isFinite(len)) break;
      i = comma + 1 + len;
      continue;
    }
    let nl = buf.indexOf(0x0a, c);
    if (nl < 0) nl = buf.length;
    rows.push(buf.subarray(c + 1, nl).toString('utf8'));
    i = nl + 1;
  }
  return rows;
}

/** The build object (with its variants) from a build page. */
function extract(html) {
  for (const r of rscRows(html)) {
    if (!r.includes('"variants"') || !r.includes('"gear"')) continue;
    let j;
    try { j = JSON.parse(r); } catch (_) { continue; }
    let hit = null;
    const walk = (x, depth) => {
      if (hit || !x || typeof x !== 'object' || depth > 60) return;
      if (!Array.isArray(x) && x.build && Array.isArray(x.build.variants)) { hit = x.build; return; }
      for (const v of Object.values(x)) walk(v, depth + 1);
    };
    walk(j, 0);
    if (hit) return hit;
  }
  return null;
}

// ---- the site's own game data ----------------------------------------------------------------
// The page draws its tooltips from tools.infinitybuilds.gg: asked for a build's ids it answers
// with their English names, the stats' roll ranges and the class's skills ("Command Abodian").
const TOOLS = 'https://tools.infinitybuilds.gg';

/** Every item, aspect and stat id the build's variants name. */
function idsOf(b) {
  const items = new Set(), aspects = new Set(), affixes = new Set();
  const add = (set, x) => { if (typeof x === 'string' && x) set.add(x); };
  for (const v of (b && b.variants) || []) {
    for (const g of (v && v.gear) || []) {
      add(items, g && g.itemId);
      add(aspects, g && g.aspectId);
      ((g && g.transfigurationAspectIds) || []).forEach((x) => add(aspects, x));
      for (const a of (g && g.affixes) || []) add(affixes, a && a.affixId);
    }
    const t = (v && v.talisman) || {};
    [t.seal].concat(t.charms || [], t.charmMythic || []).forEach((x) => add(items, x));
    [].concat(t.sealAffixes || [], ...(t.charmAffixes || [])).forEach((x) => add(affixes, x));
  }
  return { items, aspects, affixes };
}

/** The site's data for this build, or null – everything then comes from d2core and maxroll alone. */
async function siteData(net, b, log) {
  const ids = idsOf(b);
  const q = new URLSearchParams({ classId: String(b.classId || '').toLowerCase(), mode: 'view', shape: '2', locale: 'en' });
  const list = (s) => [...s].sort().join(',');
  if (ids.items.size) q.set('itemIds', list(ids.items));
  if (ids.aspects.size) q.set('aspectIds', list(ids.aspects));
  if (ids.affixes.size) q.set('affixIds', list(ids.affixes));
  try {
    const res = await net.fetch(TOOLS + '/api/games/diablo4/build-data?' + q.toString());
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    if (log) log('infinitybuilds data:', e.message);
    return null;
  }
}

const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Lookups into the site's data by id (skills by their key, "command_vanguard_demon"); undefined when missing. */
function siteTables(j) {
  const d = (j && j.dataset) || {};
  const g = d.gear || {};
  const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((x) => x && x.id).map((x) => [String(x.id).toLowerCase(), x]));
  const items = byId(g.items), aspects = byId(g.aspects), affixes = byId(g.affixes);
  const skills = new Map();
  for (const n of (d.skills && d.skills.nodes) || []) {
    const k = loose(String((n && n.sourceId) || '').replace(/\.pow$/i, '').replace(/^[A-Za-z]+_/, ''));
    if (k && n.label && !skills.has(k)) skills.set(k, n.label);
  }
  const at = (m) => (id) => m.get(String(id || '').toLowerCase());
  return { item: at(items), aspect: at(aspects), affix: at(affixes), skill: (key) => skills.get(loose(key)) };
}

/** Lowest and highest roll of a stat, over every slot it can sit on. */
function rangeOf(a) {
  const lo = [], hi = [];
  for (const r of [a && a.valueRange].concat(Object.values((a && a.valueRangeBySlot) || {}))) {
    if (r && Number.isFinite(r.min)) lo.push(r.min);
    if (r && Number.isFinite(r.max)) hi.push(r.max);
  }
  return hi.length ? { lo: lo.length ? Math.min(...lo) : 0, hi: Math.max(...hi) } : null;
}

/**
 * A gear roll the way the site reads it: 0 marks a fixed line (a runeword's) – its one value;
 * a number ten times too large is read as the tenth when that fits the range.
 */
function gearValue(value, a) {
  const r = rangeOf(a);
  if (value == null || !Number.isFinite(Number(value))) return r ? r.hi : null;
  const v = Number(value);
  if (!r || r.hi <= 0 || (a && a.valueOverride)) return v;
  if (v === 0 && r.lo > 0) return r.hi;
  if (v > 1.001 * r.hi && v / 10 <= 1.001 * r.hi && v / 10 >= r.lo / 1.001) return v / 10;
  return v;
}

/** A charm or seal stat comes without its roll: the site shows the best one, a quarter more when greater. */
function charmValue(value, a, greater) {
  if (value != null && Number.isFinite(Number(value))) return Number(value);
  const max = a && a.valueRange && a.valueRange.max;
  if (!Number.isFinite(max)) return null;
  const n = max * (greater ? 1.25 : 1);
  return a.isPercent ? Number(n.toFixed(1)) : Math.round(n);
}

/** A stat d2core has no text for, from the site's name for it: "+25% Attack Speed" (never a unique's power). */
function siteLine(a, value) {
  if (!a || !a.label || a.kind === 'unique' || value == null || !Number.isFinite(Number(value))) return '';
  const n = Number(value);
  const shown = a.isPercent ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) + '%' : Math.round(n).toLocaleString('en-US');
  return '+' + shown + ' ' + a.label;
}

// ---- ids --------------------------------------------------------------------------------
/** A key of one of d2core's tables, matched without regard to case ("s04_critchance" -> "S04_CritChance"). */
function finder(table) {
  const m = new Map(Object.keys(table || {}).map((k) => [k.toLowerCase(), k]));
  return (...tries) => { for (const t of tries) { const k = m.get(String(t).toLowerCase()); if (k) return k; } return ''; };
}

/** "affix-s04-critchance" -> "s04_critchance", "item-gem-ruby-08-itm" -> "item_gem_ruby_08". */
const gameKey = (id, prefix) => String(id || '').replace(prefix ? new RegExp('^' + prefix + '-') : /$^/, '').replace(/-(itm|asp)$/i, '').replace(/-/g, '_');

/** Lookups into d2core's database for this build; every one gives '' when it is not there. */
function lookups(db) {
  const aff = finder(db && db.affix);
  const sock = finder(db && db.socket);
  const tal = finder(db && db.talisman && db.talisman.items);
  const board = finder(db && db.paragon && db.paragon.boards);
  const glyph = finder(db && db.paragon && db.paragon.glyphs);
  return {
    affix: (id) => aff(gameKey(id, 'affix')),
    socket: (id) => sock(gameKey(id), gameKey(id, 'item')),
    talisman: (id) => tal(gameKey(id), gameKey(id, 'item')),
    // without the database the key is spelt out: "paragon-warlock-03" -> "Paragon_Warlock_03"
    board: (id) => {
      const k = gameKey(String(id || '').replace(/^paragon-board::/, ''));
      return board(k) || (db ? '' : k.split('_').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('_'));
    },
    // "glyph::rare-120-willpower-main" -> ParagonGlyph_120
    glyph: (id) => { const n = String(id || '').match(/(\d{1,4})/); return n ? glyph('ParagonGlyph_' + n[1].padStart(3, '0'), 'ParagonGlyph_' + n[1]) : ''; },
  };
}

/**
 * A stat line. The site keeps the value as shown in game (8.5 for 8.5 %), d2core's templates
 * want the game's number (0.085) where they multiply by 100. Without a value (charms list only
 * the stat) the numbers become "#".
 */
function statLine(db, key, value) {
  const tpl = key && db && db.affix[key];
  if (!tpl) return '';
  if (value == null || !Number.isFinite(Number(value))) {
    return String(tpl).replace(/\[([^\]]*)\]/g, (_, inner) => (/\{v?value\d?\}/i.test(inner) ? '#' + (/%/.test(inner.split('|')[1] || '') ? '%' : '') : '[' + inner + ']'))
      .replace(/\{v?value\d?\}/gi, '#').replace(/\{br\}/gi, ' ').replace(/\s+/g, ' ').trim();
  }
  const v = /\{v?value\d?\}\s*\*\s*100/i.test(tpl) ? Number(value) / 100 : Number(value);
  return d2db.affixText(key, tpl, v);
}

// ---- build ------------------------------------------------------------------------------
/** A stat's text: d2core's wording, else the site's name for it. */
const lineOf = (db, look, site, id, value) => statLine(db, look.affix(id), value) || siteLine(site.affix(id), value);

/** Rolled stats (greater, tempered), the transfiguration and what sits in the sockets. */
function itemExtras(g, db, look, site = siteTables(null)) {
  const stats = [];
  const tempered = [];
  let mwDone = false;
  for (const a of Array.isArray(g.affixes) ? g.affixes : []) {
    if (!a || a.removed) continue;                         // a line the item no longer has
    const info = site.affix(a.affixId);
    const t = lineOf(db, look, site, a.affixId, gearValue(a.value, info && Object.assign({}, info, { valueOverride: a.valueOverride })));
    if (!t) continue;
    // the masterwork capstone's affix (the first line with it), the affix a transfiguration added (◈)
    const mw = !mwDone && g.masterworkFinalAffixId && a.affixId === g.masterworkFinalAffixId;
    if (mw) mwDone = true;
    const s = Object.assign({ t }, a.greater ? { g: 1 } : {}, a.tempered ? { tmp: 1 } : {}, mw ? { mw: 1 } : {}, a.transfigured ? { tf: 1 } : {});
    (a.tempered ? tempered : stats).push(s);
  }
  const sockets = (Array.isArray(g.sockets) ? g.sockets : []).map((k) => {
    const key = look.socket(k);
    return key ? db.socket[key] : '';
  }).filter(Boolean);
  const all = stats.concat(tempered);
  return Object.assign({}, all.length ? { stats: all } : {}, sockets.length ? { sockets } : {});
}

/**
 * English names by the game's ids: the site's own first, else maxroll's –
 * "item-gloves-unique-rogue-98-itm" -> Gloves_Unique_Rogue_98,
 * "aspect-asp-legendary-warlock-010-asp" -> legendary_warlock_010 (maxroll adds _x1 / _x2).
 * @param {object} names  maxbuild.gameNames(): { items: {id: name}, aspects: {id: name} }
 */
function namer(names, site = siteTables(null)) {
  const items = finder(names && names.items);
  const aspects = finder(names && names.aspects);
  const label = (x) => (x && typeof x.label === 'string' ? x.label.trim() : '');
  return {
    item: (id) => {
      const k = items(gameKey(id, 'item'));
      return label(site.item(id)) || (k ? names.items[k] : '');
    },
    aspect: (id) => {
      const k = gameKey(String(id || '').replace(/^aspect-asp-/i, ''));
      const hit = aspects(k, k + '_x2', k + '_x1', k.replace(/_x\d$/i, ''));
      return label(site.aspect(id)) || (hit ? names.aspects[hit] : '');
    },
  };
}

/**
 * One variant -> a farm list build.
 * @param {object} v        the variant ({name, gear, skills, skillIcons, paragon, talisman})
 * @param {object} catalog  farm.catalog()
 * @param {object} names    maxbuild.gameNames() – the site names gear in its author's language
 *                          ("검투사의 승리"), the ids give the English name
 */
function toBuild(v, catalog, names, title, cls, db, site = siteTables(null)) {
  const fit = fitter(catalog);
  const look = lookups(db);
  const en = namer(names, site);
  const bySlot = {};
  for (const g of Array.isArray(v && v.gear) ? v.gear : []) if (g && g.slot) bySlot[g.slot] = g;
  const known = new Set(SLOTS.map((s) => s[0]));
  const order = SLOTS.concat(Object.keys(bySlot).filter((s) => !known.has(s)).map((s) => [s, '']));
  for (const [theirs, ours] of order) {
    const g = bySlot[theirs];
    if (!g) continue;
    const gid = gameKey(g.itemId);
    const slot = ours || mb.slotOfId(gid.replace(/^item_/i, ''));
    if (!slot) continue;
    const shown = String(g.itemName || '').trim();
    const legendary = g.kind === 'custom_legendary' || !!g.aspectId;
    const name = (legendary ? en.aspect(g.aspectId) : en.item(g.itemId)) || shown;
    if (!name) continue;
    let entry = null;
    const item = !legendary && fit.item(name);
    const aspect = !item && fit.aspect(name);
    // an aspect transfigured onto the piece: a unique's own, a legendary's second
    const tfId = ((g.transfigurationAspectIds) || [])[0];
    const tfName = tfId && en.aspect(tfId);
    const tf = tfName && fit.aspect(tfName);
    if (tfId && !tf) fit.missing(tfName || tfId);
    if (item) entry = Object.assign({ item }, itemExtras(g, db, look, site), tf ? { tf } : {});
    else if (aspect) entry = Object.assign({ aspects: [aspect].concat(tf && tf !== aspect ? [tf] : []) }, itemExtras(g, db, look, site));
    else { fit.missing(name); continue; }
    if (slot === 'Weapon') { const kind = mb.weaponOfId(gid); if (kind) entry.base = kind; }
    fit.put(slot, entry, slot === 'Weapon' && /(^|_)1h/i.test(gid));
  }
  const r = fit.result();
  return Object.assign({ name: buildName(title, v && v.name), cls }, r, {
    skills: skillsOf(v, cls, db, site), paragon: paragonOf(v, db, look), charms: charmsOf(v, db, look, site),
  });
}

/**
 * Ranks by the game's node ids ("warlock::skill-891": 15) and the skill bar, which the site
 * names in lower case ("chain_totem") – found in the tree by the skill's key (Warlock_ChainTotem).
 */
function skillsOf(v, cls, db, site = siteTables(null)) {
  const s = (v && v.skills) || {};
  const byNode = {};
  for (const [k, r] of Object.entries(s.skills || {})) {
    const m = String(k).match(/skill-(\d+)$/);
    if (m && Number(r) > 0) byNode[m[1]] = Number(r);
  }
  const ranks = db ? d2db.ranksFromNodes(db, cls, byNode) : {};
  const t = db && db.tree && db.tree[cls];
  const icons = (Array.isArray(v && v.skillIcons) ? v.skillIcons : []).filter(Boolean);
  const keys = icons.map((n) => {
    const hit = t && t.nodes.find((x) => x.pw && loose(x.pw.replace(/^[A-Za-z]+_/, '')) === loose(n));
    // not in the tree (a command, a class mechanic): its name spelt out from the key
    return hit ? hit.pw : cls + '_' + String(n).split('_').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join('');
  });
  // a skill d2core's tree does not hold takes the site's name ("command_vanguard_demon" is Command Abodian)
  const bar = d2db.barFromKeys(db, cls, keys, ranks).map((b, i) => (b.id ? b : Object.assign(b, { name: site.skill(icons[i]) || b.name })));
  return bar.length || Object.keys(ranks).length ? { bar, ranks } : null;
}

/** Which side of a board a gate is on, as a step on the grid: top (0,-1), right, bottom, left. */
function gateStep(id) {
  const i = Number(String(id || '').split('::').pop());
  if (!Number.isFinite(i)) return null;
  const r = Math.floor(i / N), c = i % N;
  if (r === 0) return [0, -1];
  if (r === N - 1) return [0, 1];
  if (c === 0) return [-1, 0];
  if (c === N - 1) return [1, 0];
  return null;
}

const boardOf = (id) => String(id || '').split('::').slice(0, 2).join('::');

/**
 * The boards on d2core's grid: the start board at 0,0, each next one beside the gate of its
 * parent it hangs on; turns in clockwise quarters, nodes as [row, column] on the unturned board.
 */
function paragonOf(v, db, look) {
  const p = v && v.paragon;
  if (!p || !Array.isArray(p.slots)) return null;
  const nodes = {};
  for (const n of Array.isArray(p.activeNodes) ? p.activeNodes : []) {
    const i = Number(String(n).split('::').pop());
    if (Number.isFinite(i) && i >= 0 && i < N * N) (nodes[boardOf(n)] = nodes[boardOf(n)] || []).push([Math.floor(i / N), i % N]);
  }
  const glyphs = {};
  for (const [at, g] of Object.entries(p.glyphs || {})) glyphs[boardOf(at)] = g;
  // the start board hangs on nothing: a parent that is no one's child (or, alone, the one with nodes)
  const children = new Set(p.slots.map((s) => s && s.boardId));
  const start = p.slots.map((s) => s && boardOf(s.parentGateId)).find((b) => b && !children.has(b))
    || Object.keys(nodes).find((b) => !children.has(b));
  if (!start) return null;
  const placed = [{ id: start, x: 0, y: 0, rot: 0 }];
  const at = { [start]: placed[0] };
  let left = p.slots.filter((s) => s && s.boardId);
  // a board can only go down once its parent has (they are listed in order, but do not rely on it)
  for (let guard = 0; left.length && guard < 20; guard++) {
    left = left.filter((s) => {
      const parent = at[boardOf(s.parentGateId)];
      if (!parent) return true;
      const step = gateStep(s.parentGateId) || [0, -1];
      const b = { id: s.boardId, x: parent.x + step[0], y: parent.y + step[1], rot: ((Number(s.rotation) || 0) % 4 + 4) % 4 };
      placed.push(b);
      at[s.boardId] = b;
      return false;
    });
  }
  const out = [];
  for (const b of placed) {
    const k = look.board(b.id);
    if (!k) continue;
    const g = glyphs[b.id] && look.glyph(glyphs[b.id]);
    out.push(Object.assign({ k, x: b.x, y: b.y, rot: b.rot, nodes: nodes[b.id] || [] }, g ? { glyph: g, glyphRank: 0 } : {}));
  }
  return out.length ? { boards: out } : null;
}

/**
 * The seal and charms by game key, with the stats the build names. The build keeps no rolls for
 * them – like the site they show the best roll (from its ranges), or "#" without its data.
 */
function charmsOf(v, db, look, site = siteTables(null)) {
  const t = (v && v.talisman) || {};
  const lines = (ids, vals, greater) => (Array.isArray(ids) ? ids : []).map((id, i) => {
    const g = !!(greater || [])[i];
    const txt = id && lineOf(db, look, site, id, charmValue((vals || [])[i], site.affix(id), g));
    return txt ? Object.assign({ t: txt }, g ? { g: 1 } : {}) : null;
  }).filter(Boolean);
  const pieces = [];
  const seal = t.seal && look.talisman(t.seal);
  if (seal) pieces.push({ key: seal, stats: lines(t.sealAffixes, t.sealAffixValues, t.sealAffixGreater) });
  (Array.isArray(t.charms) ? t.charms : []).forEach((c, i) => {
    const id = c || (Array.isArray(t.charmMythic) ? t.charmMythic[i] : null);
    const key = id && look.talisman(id);
    if (key) pieces.push({ key, stats: lines((t.charmAffixes || [])[i], (t.charmAffixValues || [])[i], (t.charmAffixGreater || [])[i]) });
  });
  return d2db.charmsOf(db, pieces);
}

/**
 * Reads an infinitybuilds.gg link.
 * @returns {Promise<{title, cls, variants: Array, preselect: number}>}
 */
async function load(net, input, catalog, log) {
  const src = parseUrl(input);
  if (!src) throw new Error('Not an infinitybuilds.gg build link');
  // d2core's database turns the ids into stat texts, skills and boards – the gear comes in without it
  const dbP = d2db.load(net, log).catch(() => null);
  const namesP = mb.gameNames(net, log).catch(() => ({ items: {}, aspects: {} }));
  const res = await net.fetch(SITE + '/en/builds/' + encodeURIComponent(src.slug));
  if (res.status === 404) throw new Error('That build does not exist (any more)');
  if (!res.ok) throw new Error('infinitybuilds.gg: HTTP ' + res.status);
  const b = extract(await res.text());
  if (!b) throw new Error('No build found on that page');
  // the site has Path of Exile 2 builds as well
  const game = b.gameId || (b.snapshot && b.snapshot.gameId);
  if (game && game !== 'diablo4') throw new Error('That is not a Diablo 4 build');
  const title = String(b.title || 'infinitybuilds build').replace(/\s+/g, ' ').trim();
  const cls = CLASSES.find((c) => c.toLowerCase() === String(b.classId || '').toLowerCase()) || 'All';
  const [db, names, data] = await Promise.all([dbP, namesP, siteData(net, b, log)]);
  const site = siteTables(data);
  const url = SITE + '/en/builds/' + (b.shareSlug || src.slug);
  const variants = [];
  const seen = {};
  let preselect = 0;
  b.variants.forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    let vn = String(v.name || 'Variant ' + (i + 1)).trim();
    seen[vn] = (seen[vn] || 0) + 1;
    if (seen[vn] > 1) vn += ' (' + seen[vn] + ')';
    const bd = toBuild(Object.assign({}, v, { name: vn }), catalog, names, title, cls, db, site);
    if (!Object.keys(bd.slots).length) return;
    // "?variant=v-…" opens the page on that variant
    const vid = typeof v.id === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v.id) ? v.id : '';
    if (src.variant && vid === src.variant) preselect = variants.length;
    variants.push(Object.assign(bd, { variant: vn, guide: guideinfo.extract('infinitybuilds.gg', v), source: { site: 'infinitybuilds.gg', url: url + (vid ? '?variant=' + vid : ''), title } }));
  });
  if (log) log('infinitybuilds import:', src.slug, variants.length, 'variants');
  if (!variants.length) throw new Error('The build has no gear to import');
  return { title, cls, variants, preselect };
}

module.exports = {
  load, parseUrl, rscRows, extract, toBuild, itemExtras, skillsOf, paragonOf, charmsOf, statLine, gateStep,
  idsOf, siteTables, gearValue, charmValue, siteLine, SITE, TOOLS,
};
