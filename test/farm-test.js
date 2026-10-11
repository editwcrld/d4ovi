// Farm list data and saved builds – no network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const farm = require('../lib/farm');
const builds = require('../lib/builds');
const d4g = require('../lib/d4guides');

// ---- list rows -> items / aspects ------------------------------------------
const ITEMS = `<table class="db-table db-table--sortable"><thead><tr>
  <th>Name</th><th>Rarity</th><th>Slot</th><th>Class</th><th>Unique Effect</th></tr></thead><tbody>
  <tr><td><a href="/en/database/items/orsivane" class="db-table__link" data-item-id="1500">
    <img src="/assets/img/items/o.webp"><span class="db-table__name rarity--unique">Orsivane</span></a></td>
    <td data-v="5"><span>Unique</span></td><td>Main Hand</td><td class="hide-mobile">Sorcerer</td><td>Lightning …</td></tr>
  <tr><td><a href="/en/database/items/ring-of-starless-skies" class="db-table__link" data-item-id="1441">
    <span class="db-table__name">Ring of Starless Skies</span></a></td>
    <td><span>Mythic Unique</span></td><td>Ring 1</td><td>All</td><td>Spending …</td></tr>
  <tr><td><a href="/en/database/items/x" data-item-id="9"><span class="db-table__name">Plain Sword</span></a></td>
    <td>Normal</td><td>Main Hand</td><td>All</td><td></td></tr>
  <tr><td><a href="/en/database/items/s" data-item-id="10"><span class="db-table__name">Lidless Wall</span></a></td>
    <td>Unique</td><td>Shield</td><td>Necromancer</td><td></td></tr>
</tbody></table>`;
const rows = d4g.parseList(ITEMS, 'items', 'Item');
assert.strictEqual(rows[0].id, '1500', 'tooltip id picked up from data-item-id');
const items = rows.map(farm.toItem).filter(Boolean);
assert.strictEqual(items.length, 3, 'the "Normal" base stays out');
assert.deepStrictEqual(items.map((i) => i.slot), ['Weapon', 'Ring', 'Off-Hand'], 'slots mapped (main hand, ring 1, shield)');
assert.strictEqual(items[1].rarity, 'Mythic');
assert.strictEqual(items[0].cls, 'Sorcerer');
console.log('ok  item rows: slot, rarity, class, tooltip id');

const ASPECTS = `<table class="db-table"><thead><tr><th>Name</th><th>Category</th><th>Class</th><th>Description</th></tr></thead><tbody>
  <tr><td><a href="/en/database/aspects/aspect-of-the-untarnished-blaze" data-aspect-id="2575135">
    <span class="db-table__name">Aspect of the Untarnished Blaze</span></a></td>
    <td><span class="category-badge category-badge--offensive">Offensive</span></td><td>Sorcerer</td><td>Fire …</td></tr>
  <tr><td><a href="/x" data-aspect-id="2574616"><span class="db-table__name">Overheating Aspect</span></a></td>
    <td>Utility</td><td>Sorcerer</td><td>…</td></tr>
  <tr><td><a href="/x" data-aspect-id="7"><span class="db-table__name">Wyward&#039;s Aspect</span></a></td>
    <td>Utility</td><td>All</td><td>…</td></tr>
</tbody></table>`;
const aspects = d4g.parseList(ASPECTS, 'aspects', 'Aspect').map(farm.toAspect);
assert.deepStrictEqual(aspects.map((a) => a.short), ['Untarnished Blaze', 'Overheating', 'Wyward'], 'short names like a planner shows them');
assert.ok(aspects[0].slots.includes('Weapon') && !aspects[0].slots.includes('Boots'), 'category guess until the tooltip is in');
console.log('ok  aspect rows + short names');

// ---- what an aspect tooltip adds -------------------------------------------
const d1 = farm.aspectDetails('<div>Vigorous Aspect</div><p>Allowed Item Types: Helm, Chest Armor, Pants, Amulet, Shield</p>'
  + '<p>Unlocked by completing Steadfast Barracks in Hawezar OR salvaging a Legendary item with Vigorous Aspect</p>');
assert.deepStrictEqual(d1.slots, ['Helm', 'Chest Armor', 'Pants', 'Amulet', 'Off-Hand']);
assert.strictEqual(d1.dungeon, 'Steadfast Barracks');
assert.strictEqual(d1.region, 'Hawezar');
const d2 = farm.aspectDetails('Allowed Item Types: Weapon, Gloves, Amulet, Ring Salvage a Legendary item with Aspect of Anger Management to unlock');
assert.deepStrictEqual(d2.slots, ['Gloves', 'Amulet', 'Ring', 'Weapon'], 'exceptions to the category come from the tooltip');
assert.ok(!d2.dungeon, 'no dungeon when the tooltip names none');
console.log('ok  aspect tooltip: exact slots + unlocking dungeon');

// ---- tooltip html is made safe and absolute ---------------------------------
const html = farm.cleanHtml('<div onclick="x()" style="background-image:url(/assets/a.webp)"><img src="/assets/i.webp"><script>alert(1)</script><a href="javascript:x">l</a></div>');
assert.ok(!/script|onclick|javascript:/i.test(html), 'scripts and handlers removed');
assert.ok(html.includes('url(https://d4guides.gg/assets/a.webp)') && html.includes('src="https://d4guides.gg/assets/i.webp"'), 'addresses made absolute');
assert.ok(farm.cleanCss("@import url(x.css); .a{src:url('/assets/f.woff2')}").includes("url('https://d4guides.gg/assets/f.woff2')"), 'css urls made absolute');
console.log('ok  tooltip html cleaned');

// ---- sources from the boss loot sheet ----------------------------------------
const loot = { sections: [
  { name: 'New Season 15 Uniques', isBoss: false, drops: [{ cls: 'Common items (~15% drop rate)', name: "Leoric's Crown" }] },
  { name: 'General Unique Pool', isBoss: false, drops: [{ cls: 'All classes', name: "‍Tibault's Will" }] },
  { name: 'Non-Boss Uniques', isBoss: false, drops: [{ cls: 'All classes', name: "Tibault's Will" }] },
  { name: 'Uniques from Boss Trophies', isBoss: false, drops: [{ cls: 'All classes', name: 'Andariel: Pincushioned Doll' }] },
  { name: 'Andariel', isBoss: true, location: "Hanged Man's Hall", info: ['Requires Torment 1', 'Boss Lair Key: 1x Greater Lair Key'],
    drops: [{ cls: 'Sorcerer', name: 'Orsivane' }, { cls: 'Sorcerer', name: "Drognan's Anguish" }] },
  { name: 'Mythics', isBoss: false, drops: [{ cls: 'All classes', name: 'Ring of Starless Skies (All)' }] },
] };
const idx = farm.dropIndex(loot);
assert.strictEqual(idx.get(farm.norm('Orsivane'))[0].src, 'Andariel');
assert.ok(idx.get(farm.norm('Orsivane'))[0].loc.includes('Greater Lair Key'), 'boss location + key');
assert.strictEqual(idx.get(farm.norm("Tibault's Will")).length, 2, 'the invisible joiner before a name does not matter');
assert.strictEqual(idx.get(farm.norm('Ring of Starless Skies'))[0].src, 'Any boss (Mythic)', 'the class note "(All)" is not part of the name');
assert.strictEqual(idx.get(farm.norm("Leoric's Crown"))[0].note, 'Common items (~15% drop rate)', 'season items keep their drop rate');
assert.ok(!idx.has(farm.norm('Andariel: Pincushioned Doll')), 'trophies are not items');

farm.setData({ items, aspects: [Object.assign(aspects[0], { dungeon: 'Steadfast Barracks', region: 'Hawezar' }), aspects[1]] });
const cat = farm.catalog(loot);
assert.strictEqual(cat.items.find((i) => i.name === 'Lidless Wall').src[0].src, 'Random drop / Cube', 'unknown source falls back to random / cube');
assert.strictEqual(cat.aspects[0].src[0].src, 'Dungeon: Steadfast Barracks', 'aspect with a dungeon');
assert.strictEqual(cat.aspects[1].src[0].src, 'Salvage a legendary', 'aspect without one');
console.log('ok  sources: bosses, pools, mythics, season, dungeons');

// the same unique as several weapon kinds / class variants -> one entry per slot
const v = (cls, type, slot) => ({ kind: 'item', id: cls, name: "Ancient's Pledge", n: 'ancients pledge', slot, type, rarity: 'Unique', cls });
farm.setData({ items: [v('Druid', 'Off-Hand', 'Off-Hand'), v('Sorcerer', 'Off-Hand', 'Off-Hand'), v('Necromancer', 'Shield', 'Off-Hand')], aspects: [] });
const merged1 = farm.catalog(loot).items;
assert.strictEqual(merged1.length, 1, 'variants merged');
assert.strictEqual(merged1[0].type, 'Off-Hand / Shield');
assert.strictEqual(merged1[0].cls, 'Druid / Sorcerer / Necromancer', 'classes kept as a list, not widened to All');
console.log('ok  weapon / class variants merged per slot');

// ---- builds -------------------------------------------------------------------
const tmp = path.join(os.tmpdir(), 'd4-builds-test-' + process.pid + '.json');
builds.configure({ file: tmp });
const first = builds.load();
assert.strictEqual(first.builds.length, 1, 'a fresh PC starts with one empty build');

const mine = {
  id: 'abc123', name: 'Sorc Endgame', cls: 'Sorcerer',
  slots: {
    Weapon: { item: 'Orsivane' },
    Amulet: { aspects: ['Aspect of Armageddon', 'Overheating Aspect', 'Third One'] },
    Bogus: { item: 'x' },
    Helm: { foo: 1 },
  },
  done: ['Orsivane'],
};
const saved = builds.save({ active: 'abc123', builds: [mine] });
assert.deepStrictEqual(Object.keys(saved.builds[0].slots).sort(), ['Amulet', 'Weapon'], 'unknown slots and empty slots dropped');
assert.strictEqual(saved.builds[0].slots.Amulet.aspects.length, 2, 'two aspects at most');
assert.deepStrictEqual(builds.load().builds[0].slots, saved.builds[0].slots, 'reads back what it wrote');
assert.ok(JSON.parse(fs.readFileSync(tmp, 'utf8')).savedAt, 'readable file with a timestamp');
console.log('ok  builds saved to builds.json and read back');

// ticks: every thing of a big build is kept, a tick for something no longer in it goes
const big = {
  name: 'Big', slots: {
    Helm: { item: 'Harlequin Crest', sockets: ['Royal Ruby', 'Ber'] },
    Amulet: { aspects: ['Aspect of A', 'Aspect of B'], sockets: ['Royal Skull'] },
    Weapon: { item: 'Infinity', sockets: ['Jah', 'Ith', 'Ber'] },
  },
  charms: { seal: { name: 'Seal X' }, list: Array.from({ length: 10 }, (_, i) => ({ name: 'Charm ' + i })) },
};
const want = ['Harlequin Crest', 'Aspect of A', 'Aspect of B', 'Infinity', 's:Royal Ruby', 's:Ber', 's:Royal Skull', 's:Jah', 's:Ith', 'c:Seal X']
  .concat(big.charms.list.map((c) => 'c:' + c.name));
const ticked = builds.cleanBuild(Object.assign({}, big, { done: want.concat(['Old Helm', 's:Gone']).concat(Array.from({ length: 40 }, (_, i) => 'stale ' + i)) }));
assert.deepStrictEqual(ticked.done.slice().sort(), want.slice().sort(), 'all real ticks kept, stale ones dropped');
console.log('ok  ticks: none lost past 40, stale ones pruned');

const code = builds.toCode(saved.builds[0]);
assert.ok(code.startsWith('D4B1:'), 'build code');
const back = builds.parseImport('  ' + code + '\n');
assert.strictEqual(back.length, 1);
assert.strictEqual(back[0].name, 'Sorc Endgame');
assert.deepStrictEqual(back[0].slots, saved.builds[0].slots, 'code carries every slot');
assert.notStrictEqual(back[0].id, 'abc123', 'imported builds get their own id');
assert.strictEqual(builds.parseImport('D4B1:@@@').length, 0, 'broken code is ignored');
assert.strictEqual(builds.parseImport('hello').length, 0, 'random text is ignored');

const merged = builds.merge(builds.load(), back);
assert.deepStrictEqual(merged.builds.map((b) => b.name), ['Sorc Endgame', 'Sorc Endgame (2)'], 'same name is not overwritten');
assert.strictEqual(merged.active, merged.builds[1].id, 'the imported build becomes active');
// a whole exported file works too
assert.strictEqual(builds.parseImport(JSON.stringify(merged)).length, 2, 'exported file imports all builds');
console.log('ok  build code, file import, no overwriting');

fs.unlinkSync(tmp);
fs.writeFileSync(tmp, '{ broken');
assert.strictEqual(builds.load().builds.length, 1, 'a damaged file does not break the overlay');
fs.unlinkSync(tmp);
console.log('ok  damaged builds.json');

// the codex: aspects owned once count in every build
const two = [
  { id: 'aaaa1', name: 'One', slots: { Amulet: { aspects: ['Aspect of A'] }, Helm: { item: 'Harlequin Crest' } }, done: ['Aspect of A', 'Harlequin Crest'] },
  { id: 'aaaa2', name: 'Two', slots: { Gloves: { aspects: ['Aspect of B'] } }, done: [] },
];
let cx = builds.clean({ active: 'aaaa1', builds: two });
assert.deepStrictEqual(cx.codex, ['Aspect of A'], 'a file from before: ticked aspects go into the codex, items do not');
cx = builds.clean({ active: 'aaaa1', builds: two, codex: ['Aspect of B', 'Aspect of B', '', 7] });
assert.deepStrictEqual(cx.codex, ['Aspect of B', '7'], 'a codex of its own is kept, cleaned');
assert.deepStrictEqual(builds.clean({ active: 'aaaa1', builds: two, codex: [] }).codex, [], 'emptied on purpose: stays empty');
assert.deepStrictEqual(builds.empty().codex, []);
console.log('ok  codex: aspects shared by every build');
