'use strict';
// One entry point for build links: picks the site by the link and hands back the same shape
// every time – { title, cls, variants: [{name, variant, cls, slots, missing, extra}], preselect, site }.
const maxbuild = require('./maxbuild');
const d4buildsgg = require('./d4buildsgg');
const d2core = require('./d2core');
const infinitybuilds = require('./infinitybuilds');
const builds = require('./builds');
const guideinfo = require('./guideinfo');

const SITES = [
  { site: 'd4builds.gg', mod: d4buildsgg },
  { site: 'd2core.com', mod: d2core },
  { site: 'infinitybuilds.gg', mod: infinitybuilds },
  { site: 'maxroll.gg', mod: maxbuild },
];

/** Which site a link belongs to, or '' for none we can read. */
function siteOf(input) {
  const s = SITES.find((x) => x.mod.parseUrl(input));
  return s ? s.site : '';
}

/**
 * A unique's own affixes in the order d4builds counts them: its class's main stat, then its fixed
 * affixes ("+2 to Imbuement Skills"); a runeword: its stats. A legendary has none.
 */
function ownAffixes(u, cls) {
  if (!u) return [];
  const main = require('./builder').MAIN_STAT[cls];
  return u.runeword ? (u.stats || []).slice() : (main ? [main] : []).concat(u.stats || []);
}

async function load(net, input, catalog, log, getData) {
  const s = SITES.find((x) => x.mod.parseUrl(input));
  if (!s) throw new Error('Not a build link from maxroll.gg, d4builds.gg, infinitybuilds.gg or d2core.com');
  const r = await s.mod.load(net, input, catalog, log);
  // one temper per piece, whatever the site saved; the mechanic and the mercenaries by their game names
  // data: the game data (lib/builder.js) as the caller has it – the names of mechanics and mercenaries,
  // the uniques' own affixes; without it the keys are made readable, the gaps stay empty
  const data = (getData && await Promise.resolve().then(getData).catch(() => null)) || null;
  const names = (data && data.names) || null;
  const uniques = new Map(((data && data.uniques) || []).map((u) => [u.name.toLowerCase(), u]));
  for (const v of r.variants || []) {
    for (const x of Object.values(v.slots || {})) {
      if (!x) continue;
      // d4builds: the gaps in its stat rows are the item's own affixes
      if (x.pos) { x.stats = d4buildsgg.stats(x.pos, ownAffixes(uniques.get(String(x.item || '').toLowerCase()), v.cls || r.cls)); delete x.pos; }
      if (Array.isArray(x.stats)) x.stats = builds.oneTemper(x.stats);
      if (x.stats && !x.stats.length) delete x.stats;
    }
    const setup = guideinfo.resolve(v.guide, names);
    delete v.guide;
    if (setup) v.setup = setup;
  }
  return Object.assign(r, { site: s.site });
}

module.exports = { load, siteOf };
