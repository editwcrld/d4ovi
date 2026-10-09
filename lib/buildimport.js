'use strict';
// One entry point for build links: picks the site by the link and hands back the same shape
// every time – { title, cls, variants: [{name, variant, cls, slots, missing, extra}], preselect, site }.
const maxbuild = require('./maxbuild');
const d4buildsgg = require('./d4buildsgg');
const d2core = require('./d2core');

const SITES = [
  { site: 'd4builds.gg', mod: d4buildsgg },
  { site: 'd2core.com', mod: d2core },
  { site: 'maxroll.gg', mod: maxbuild },
];

/** Which site a link belongs to, or '' for none we can read. */
function siteOf(input) {
  const s = SITES.find((x) => x.mod.parseUrl(input));
  return s ? s.site : '';
}

async function load(net, input, catalog, log) {
  const s = SITES.find((x) => x.mod.parseUrl(input));
  if (!s) throw new Error('Not a build link from maxroll.gg, d4builds.gg or d2core.com');
  const r = await s.mod.load(net, input, catalog, log);
  return Object.assign(r, { site: s.site });
}

module.exports = { load, siteOf };
