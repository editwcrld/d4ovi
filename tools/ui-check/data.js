// What the layout checks show: the overlay's own caches (the data folder the app fills on its first
// start – %APPDATA%\d4-overlay, or D4DATA for another one, e.g. the portable exe's), read with the
// app's own modules, so the pages look as they do in the game. Nothing of it goes into the repo.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const lib = (n) => require(path.join(ROOT, 'lib', n));
const DATA = process.env.D4DATA || path.join(process.env.APPDATA || '', 'd4-overlay');
const file = (n) => path.join(DATA, n);

function readJson(n) {
  try { return JSON.parse(fs.readFileSync(file(n), 'utf8')); } catch (_) { return null; }
}

/** Everything the bridge answers with; throws when the caches are missing. */
function load() {
  const loot = readJson('maxroll-cache.json');
  if (!loot) throw new Error('no data in ' + DATA + ' – start the overlay once (or set D4DATA to its data folder)');
  const craft = readJson('crafting-cache.json') || { tables: [] };
  const farm = lib('farm.js'), items = lib('items.js'), d4g = lib('d4guides.js'), d2db = lib('d2coredb.js'), icons = lib('icons.js');
  farm.configure({ cacheFile: file('farm-cache.json'), tipFile: file('farm-tooltips.json') });
  items.configure({ cacheFile: file('items-cache.json') });
  d4g.configure({ cacheFile: file('d4guides-cache.json') });
  d2db.configure({ file: file('d2core-db.json') });
  // a cache from an older version is taken as it is – it is fetched again only by the app
  const oldItems = readJson('items-cache.json');
  if (!items.count() && oldItems && Array.isArray(oldItems.list)) items.setList(oldItems.list);
  const catalog = farm.catalog(loot, craft);
  const d2 = d2db.cached() || readJson('d2core-db.json');
  return {
    loot, craft, catalog,
    builds: readJson('builds.json') || { builds: [] },
    css: farm.tooltipCss ? farm.tooltipCss() : '',
    d2, d2db,
    // the pictures by name, as main.js iconsNow() builds them
    icons: icons.build({ catalog: catalog.items, aspects: catalog.aspects, guides: d4g.all(), items: items.all(), d2: (d2 && d2.icons) || {}, glyphs: items.glyphIcons() }),
    settings: JSON.parse(JSON.stringify(lib('settings.js').DEFAULTS)),
    builder: JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'fixtures', 'builder.json'), 'utf8')),
  };
}

module.exports = { load, ROOT, DATA };
