'use strict';
// What the search asks the main process for – kept apart from main.js like lib/builderipc.js:
//   icons:get     every picture by name (lib/icons.js), built again only when a source changed
//   items:search  maxroll's game data (power, level, text – local, instant) and d4guides' extras
//                 (icon, rarity, category, its page), the mythics' "how to obtain" on top
const items = require('./items');
const d4g = require('./d4guides');
const d2db = require('./d2coredb');
const mythics = require('./mythics');
const icons = require('./icons');
const S = require('../renderer/search');          // the same query parsing the overlay uses

/**
 * @param ipc  ipcMain (or anything with handle(channel, fn))
 * @param deps { net, catalog: () => the farm list's catalog (lib/farm.js) }
 */
function register(ipc, deps) {
  let iconMap = { key: '', map: {} };
  function iconsNow() {
    const d2 = d2db.cached();
    const cat = deps.catalog();
    const key = [items.count(), items.age(), d4g.count(), d4g.age(), cat.items.length, cat.aspects.length, d2 ? d2.fetchedAt : 0].join('|');
    if (iconMap.key !== key) {
      iconMap = { key, map: icons.build({ catalog: cat.items, aspects: cat.aspects, guides: d4g.all(), items: items.all(), d2: (d2 && d2.icons) || {}, glyphs: items.glyphIcons() }) };
    }
    return iconMap.map;
  }
  ipc.handle('icons:get', () => iconsNow());
  ipc.handle('items:search', (_e, q) => search(deps.net, String(q || '')));
}

const hayOf = (e) => [e.type, e.rarity, e.cat, e.catLabel, e.url, e.set].filter(Boolean).join(' ');
const useful = (fields, hasPower) => (fields || []).filter((x) =>
  !/rarity/i.test(x.label) && !/^([-–—]|n\/a)$/i.test(x.value.trim()) && !(hasPower && /effect/i.test(x.label)));
const pickRarity = (g) => { const f = (g.fields || []).find((x) => /rarity/i.test(x.label)); return f ? f.value : ''; };

/** One entry for the overlay: game data + d4guides extras + (for mythics) how to obtain it. */
function decorate(it, g) {
  const e = Object.assign({}, it, g ? {
    icon: g.icon || it.icon, url: g.url,
    fields: useful(g.fields, !!it.power),
    rarity: it.rarity || g.rarity || pickRarity(g),
  } : {});
  const my = mythics.info(e.name, e.rarity);
  if (my) Object.assign(e, { rarity: my.label, obtain: my.obtain, obtainNote: my.note, iconic: my.iconic });
  return e;
}

/** The items for a query, exact names first – at most 25 (the overlay shows them all). */
async function search(net, q) {
  const { term, kinds } = S.parseQuery(q);
  const out = [], seen = new Set();
  if (!S.showItems(kinds)) return [];

  // "iconic" (or "iconic mythic") without a name: the complete list from maxroll's equipment page
  if (!term && kinds.indexOf('iconic') >= 0) {
    const rest = kinds.filter((k) => k !== 'iconic' && k !== 'mythic' && k !== 'unique' && k !== 'item');
    for (const name of mythics.names()) {
      const e = decorate(items.get(name) || { name, type: '', rarity: 'Mythic Unique', level: 0, power: '', effects: [], desc: '', set: '' }, d4g.get(name));
      if (S.matchesKinds(hayOf(e), rest)) out.push(e);
    }
    return out;
  }

  const guides = await d4g.searchLive(net, term, 'en').catch(() => []);
  const gByName = new Map(guides.map((g) => [g.n, g]));

  for (const it of items.search(term, 25)) {
    const key = items.norm(it.name);
    const e = decorate(it, gByName.get(key) || d4g.get(it.name));
    if (!S.matchesKinds(hayOf(e), kinds)) continue;
    seen.add(key);
    out.push(e);
  }
  for (const g of guides) {
    if (seen.has(g.n)) continue;
    const e = decorate({
      name: g.name, type: g.catLabel, rarity: g.rarity || pickRarity(g),
      level: 0, power: '', effects: [], desc: '', set: '',
    }, g);
    if (!S.matchesKinds(hayOf(e), kinds)) continue;
    seen.add(g.n);
    out.push(e);
  }
  // exact name first, across both sources
  const qn = items.norm(term);
  const rank = (e) => { const n = items.norm(e.name); return n === qn ? 0 : n.startsWith(qn) ? 1 : 2; };
  out.sort((a, b) => rank(a) - rank(b));
  return out.slice(0, 25);
}

module.exports = { register, search };
