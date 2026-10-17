'use strict';
// Builds from d4builds.gg.
//
//   link     d4builds.gg/builds/<uuid>/?var=1
//   data     the site reads its builds straight from Firestore, and the documents are public:
//            firestore.googleapis.com/…/documents/builds/<uuid>
//            The document itself is the first variant (var=0); "variants" holds the others,
//            so ?var=N is variants[N-1].
//
// Gear is stored by name per slot ("Ring 1": "Aspect of Aftermath", "Chest Armor": "Enigma"),
// a uniques, runeword or aspect name in English – the same names the farm list uses.
// "sanctification" carries a second aspect for a slot (the amulet's, mostly).
const { fitter, buildName } = require('./buildfit');
const d2db = require('./d2coredb');
const guideinfo = require('./guideinfo');

const DOC_URL = 'https://firestore.googleapis.com/v1/projects/d4builds-a3254/databases/(default)/documents/builds/';
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];

// d4builds' gear slots -> ours, in the order they are filled; dual wield blades may go into the off-hand
const SLOTS = [
  ['Helm', 'Helm'], ['Chest Armor', 'Chest Armor'], ['Gloves', 'Gloves'], ['Pants', 'Pants'], ['Boots', 'Boots'],
  ['Amulet', 'Amulet'], ['Ring 1', 'Ring'], ['Ring 2', 'Ring'],
  ['Weapon', 'Weapon'], ['Offhand', 'Off-Hand'],
  ['Bludgeoning Weapon', 'Weapon'], ['Slashing Weapon', 'Weapon'], ['Ranged Weapon', 'Weapon'],
  ['Dual-Wield Weapon 1', 'Weapon', true], ['Dual-Wield Weapon 2', 'Weapon', true],
];

/**
 * The build and variant from a d4builds.gg link – by its id (…/builds/<uuid>/) or by a guide's
 * name (…/builds/rain-of-arrows-rogue-endgame/, the id is in the page's data). ?var=N: the variant.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function parseUrl(input) {
  const t = String(input || '').trim();
  const m = t.match(/d4builds\.gg\/builds\/([A-Za-z0-9-]{3,120})/i);
  if (!m) return null;
  const v = t.match(/[?&]var=(\d+)/);
  const key = m[1].toLowerCase();
  return Object.assign(UUID.test(key) ? { id: key } : { slug: key }, { variant: v ? Number(v[1]) : 0 });
}
/** A guide's name -> the build's id, from the page's Gatsby data (pageContext.seoId). */
async function idOfSlug(net, slug) {
  const res = await net.fetch('https://d4builds.gg/page-data/builds/' + encodeURIComponent(slug) + '/page-data.json');
  if (res.status === 404) throw new Error('That build does not exist (any more)');
  if (!res.ok) throw new Error('d4builds.gg: HTTP ' + res.status);
  const j = await res.json();
  const id = j && j.result && j.result.pageContext && j.result.pageContext.seoId;
  if (!id || !UUID.test(id)) throw new Error('d4builds.gg: no build behind "' + slug + '"');
  return id.toLowerCase();
}

/** Firestore's typed JSON ({stringValue: …}, {mapValue: {fields}} …) -> plain values. */
function plain(x) {
  if (!x || typeof x !== 'object') return x;
  if ('stringValue' in x) return x.stringValue;
  if ('integerValue' in x) return Number(x.integerValue);
  if ('doubleValue' in x) return x.doubleValue;
  if ('booleanValue' in x) return x.booleanValue;
  if ('nullValue' in x) return null;
  if ('timestampValue' in x) return x.timestampValue;
  if ('mapValue' in x) {
    const o = {};
    for (const [k, v] of Object.entries(x.mapValue.fields || {})) o[k] = plain(v);
    return o;
  }
  if ('arrayValue' in x) return (x.arrayValue.values || []).map(plain);
  return null;
}

const docOf = (j) => plain({ mapValue: { fields: (j && j.fields) || {} } });

/**
 * One variant (the document or one of its "variants") -> a farm list build.
 * @param {object} v        the variant, plain
 * @param {object} catalog  farm.catalog()
 */
function toBuild(v, catalog, title, cls, db) {
  const fit = fitter(catalog);
  const gear = (v && v.gear) || {};
  const sanct = (v && v.sanctification) || {};
  for (const [theirs, slot, oneHand] of SLOTS) {
    const name = String(gear[theirs] || '').trim();
    if (!name) continue;
    let entry = null;
    const item = fit.item(name);
    const aspect = !item && fit.aspect(name);
    // the aspect transfigured onto the piece (d4builds calls it sanctification): a legendary's second
    // aspect, a unique's own (Earthstriker's Aspect on Word of Hakan)
    const second = (Array.isArray(sanct[theirs]) ? sanct[theirs] : []).filter(Boolean)[0];
    const a2 = second && fit.aspect(second);
    if (second && !a2) fit.missing(second);
    if (item) entry = Object.assign({ item }, itemExtras(v, theirs), a2 ? { tf: a2 } : {});
    else if (aspect) {
      entry = Object.assign({ aspects: [aspect] }, itemExtras(v, theirs));
      if (a2 && a2 !== aspect) entry.aspects.push(a2);
    } else { fit.missing(name); continue; }
    if (slot === 'Weapon' && theirs !== 'Weapon') entry.base = theirs.replace(/ \d$/, '');
    fit.put(slot, entry, oneHand);
  }
  const r = fit.result();
  return Object.assign({ name: buildName(title, v.variantName), cls }, r, {
    skills: skillsOf(v, cls, db), paragon: paragonOf(v, cls, db), charms: charmsOf(v, db),
  });
}

/**
 * Charms by name with the stats d4builds lists for each; the seal is saved only by its effect
 * text, so it is found by that.
 */
function charmsOf(v, db) {
  const t = db && db.talisman;
  const pieces = [];
  const sealText = String((((v && v.seal) || {}).value || []).filter(Boolean)[0] || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (t && sealText) {
    const hit = Object.entries(t.items).find(([, x]) => /seal/i.test(x.type) && x.d.some((l) => l.toLowerCase().replace(/[^a-z0-9]/g, '').startsWith(sealText.slice(0, 40))));
    if (hit) pieces.push({ key: hit[0], stats: [] });
  }
  const cs = (v && v.charmStats) || {};
  (Array.isArray(v && v.charms) ? v.charms : []).forEach((n, i) => {
    if (n) pieces.push({ name: n, stats: (Array.isArray(cs[i]) ? cs[i] : []).filter(Boolean).map((x) => ({ t: String(x) })) });
  });
  return d2db.charmsOf(db, pieces);
}

/**
 * The stats d4builds keeps for a slot, by position: "newStats" holds the affix names the author
 * picked – a gap (null) is the item's own affix at that place, which the site fills from its item
 * data (a unique: its main stat, then its fixed affixes; a runeword: its stats). "greaterAffixes"
 * and "masterworking" mark positions in the same row, the tempers come after the affixes.
 * The gaps are filled by stats() once the item's own affixes are known (lib/buildimport.js).
 */
function itemExtras(v, theirs) {
  const pick = (o) => (o && Array.isArray(o[theirs]) ? o[theirs] : []);
  // "Maximum Life (Worldly Endurance - Defensive)" – the brackets name the recipe: "Defensive · Worldly Endurance"
  const tempers = pick(v.temperingStats).filter(Boolean).map((t) => {
    const m = String(t).match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    const how = m ? m[2].split(/\s+-\s+/).reverse().join(' · ') : '';
    return Object.assign({ t: m ? m[1] : String(t) }, how ? { how } : {});
  });
  const pos = { ns: pick(v.newStats).map((t) => (t ? String(t) : null)), ga: pick(v.greaterAffixes).map((x) => !!x), mw: pick(v.masterworking).map((x) => !!x), tempers };
  const sockets = pick(v.newGems).filter(Boolean).map(String);
  const rows = pos.ns.length || pos.tempers.length;
  const own = stats(pos, []);
  return Object.assign({}, own.length ? { stats: own } : {}, rows ? { pos } : {}, sockets.length ? { sockets } : {});
}
/** The stat lines of one slot – own: the item's own affixes, by position (none for a legendary). */
function stats(pos, own) {
  const out = [];
  const n = Math.max(pos.ns.length, (own || []).length);
  for (let i = 0; i < n; i++) {
    const t = pos.ns[i] || (own || [])[i];
    if (t) out.push(Object.assign({ t }, pos.ga[i] ? { g: 1 } : {}, pos.mw[i] ? { mw: 1 } : {}));
  }
  pos.tempers.forEach((x, j) => out.push(Object.assign({ t: x.t, tmp: 1 }, x.how ? { how: x.how } : {}, pos.ga[n + j] ? { g: 1 } : {}, pos.mw[n + j] ? { mw: 1 } : {})));
  return out;
}

const loose = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '').replace(/[aeiou]/g, '');

/** The skill bar by name; icons and ids come from d2core's skill list when it is there. */
function skillsOf(v, cls, db) {
  const names = (Array.isArray(v && v.skills) ? v.skills : []).filter(Boolean);
  if (!names.length) return null;
  const all = db ? Object.entries(db.skills).filter(([, s]) => !cls || cls === 'All' || s.cls === cls) : [];
  const bar = names.map((n) => {
    const hit = all.find(([, s]) => loose(s.name) === loose(n));
    return { name: String(n), id: hit ? Number(hit[0]) : 0, icon: hit ? hit[1].icon : 0, rank: 0, mods: [] };
  });
  return { bar };
}

/**
 * The paragon boards on d2core's grid. d4builds names the boards ("Exploit Weakness"), counts
 * rows and columns from 1, y upwards and the turn in degrees (clockwise); its tiles skip the
 * gates, so a gate next to a taken tile counts as taken.
 */
function paragonOf(v, cls, db) {
  const p = v && v.paragon;
  const boards = db && db.paragon && db.paragon.boards;
  if (!p || !Array.isArray(p.boards) || !boards) return null;
  const ofClass = Object.entries(boards).filter(([, b]) => b.cls === cls);
  const keyOf = (name) => {
    if (/^start/i.test(name)) return (ofClass.find(([, b]) => b.name === 'Start') || [])[0];
    return (ofClass.find(([, b]) => loose(b.name) === loose(name)) || [])[0];
  };
  const tiles = {};
  for (const t of Array.isArray(p.selectedTiles) ? p.selectedTiles : []) {
    const m = String(t).match(/^(.*)_r(\d+)c(\d+)$/);
    if (m) (tiles[loose(m[1])] = tiles[loose(m[1])] || []).push([Number(m[2]) - 1, Number(m[3]) - 1]);
  }
  const glyphs = Object.entries((db.paragon && db.paragon.glyphs) || {});
  const out = [];
  for (const b of p.boards) {
    const k = b && keyOf(String(b.name || ''));
    if (!k) continue;
    const rows = boards[k].rows.map((r) => String(r).split(','));
    const nodes = tiles[loose(b.name)] || [];
    const taken = new Set(nodes.map(([r, c]) => r + '_' + c));
    rows.forEach((row, r) => row.forEach((cell, c) => {
      if (cell !== 'Generic_Gate' || taken.has(r + '_' + c)) return;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, d]) => taken.has((r + a) + '_' + (c + d)))) nodes.push([r, c]);
    }));
    const g = b.glyph && glyphs.find(([, x]) => loose(x.name) === loose(b.glyph));
    out.push(Object.assign({ k, x: Number(b.x) || 0, y: 0 - (Number(b.y) || 0) || 0, rot: Math.round((Number(b.rotation) || 0) / 90) % 4, nodes },
      g ? { glyph: g[0], glyphRank: Number(b.glyphLevel) || 0 } : {}));
  }
  return out.length ? { boards: out } : null;
}

/**
 * Reads a d4builds.gg link.
 * @returns {Promise<{title, cls, variants: Array, preselect: number}>}
 */
async function load(net, input, catalog, log) {
  const src = parseUrl(input);
  if (!src) throw new Error('Not a d4builds.gg build link');
  if (!src.id) src.id = await idOfSlug(net, src.slug);
  // d2core's database only adds skill icons and the paragon boards – the gear comes in without it
  const dbP = d2db.load(net, log).catch(() => null);
  const res = await net.fetch(DOC_URL + encodeURIComponent(src.id));
  if (res.status === 404) throw new Error('That build does not exist (any more)');
  if (!res.ok) throw new Error('d4builds.gg: HTTP ' + res.status);
  const d = docOf(await res.json());
  const title = String(d.name || 'd4builds build').replace(/\s+/g, ' ').trim();
  const cls = CLASSES.find((c) => c.toLowerCase() === String(d.class || '').toLowerCase()) || 'All';
  const db = await dbP;
  const all = [d].concat(Array.isArray(d.variants) ? d.variants : []);
  const variants = [];
  const seen = {};
  let preselect = 0;
  all.forEach((v, i) => {
    if (!v || typeof v !== 'object') return;
    // the document and its first variant are often both called "Standard Build"
    let vn = String(v.variantName || 'Variant ' + (i + 1)).trim();
    seen[vn] = (seen[vn] || 0) + 1;
    if (seen[vn] > 1) vn += ' (' + seen[vn] + ')';
    const b = toBuild(Object.assign({}, v, { variantName: vn }), catalog, title, cls, db);
    if (!Object.keys(b.slots).length) return;
    if (i === src.variant) preselect = variants.length;
    variants.push(Object.assign(b, { variant: vn, guide: guideinfo.extract('d4builds.gg', v),
      source: { site: 'd4builds.gg', url: 'https://d4builds.gg/builds/' + src.id + '/?var=' + i, title } }));
  });
  if (log) log('d4builds import:', src.id, variants.length, 'variants');
  if (!variants.length) throw new Error('The build has no gear to import');
  return { title, cls, variants, preselect };
}

module.exports = { load, parseUrl, plain, docOf, toBuild, itemExtras, stats, skillsOf, paragonOf, charmsOf, DOC_URL };
