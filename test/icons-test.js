// Pictures by name (lib/icons.js): the best source first, aspects by their category, trophies by
// their item, sets by their first piece (lib/d2coredb.js slimIcons).
const assert = require('assert');
const icons = require('../lib/icons');
const d2db = require('../lib/d2coredb');

const MX = icons.MX;
const d2 = d2db.slimIcons(
  [{ name: 'Flawless Horadric Topaz', icon: 11 }],
  { 0: { name: 'Tal', engName: 'Tal', icon: 12 } },
  [{ name: 'Abyssal Splinter of Anguish', engName: 'Abyssal Splinter of Anguish', icon: 13 }],
  { charm: { a: { name: 'Berú of Uncanny Insight', engName: 'Berú of Uncanny Insight', icon: 14, set: 'Talisman_Sorc_03' } },
    seal: { b: { name: 'Mythic Unique Horadric Seal', icon: 15 } },
    itemSets: { Talisman_Sorc_03: { name: "Tiraj's Uncanny Insight" } } });
assert.deepStrictEqual(d2, { 'Flawless Horadric Topaz': 11, Tal: 12, 'Abyssal Splinter of Anguish': 13, 'Berú of Uncanny Insight': 14,
  'Mythic Unique Horadric Seal': 15, "Tiraj's Uncanny Insight": 14 }, 'd2core: gems, runes, splinters, charms, seals – a set by its first piece');

const map = icons.build({
  catalog: [{ name: 'Harlequin Crest', icon: 'https://d4guides.gg/hc.webp' }],
  guides: [{ name: 'Enigma', icon: 'https://d4guides.gg/enigma.webp' }],
  aspects: [{ name: "Storm Splitter's Aspect", cat: 'Offensive' }, { name: "Juggernaut's Aspect", cat: 'Defensive' }],
  items: [{ name: 'Harlequin Crest', icon: MX + '1.webp' }, { name: 'Shard of Agony', icon: MX + '2.webp' }, { name: 'No picture', icon: '' }],
  d2,
});
assert.strictEqual(icons.find(map, 'Harlequin Crest'), 'https://d4guides.gg/hc.webp', 'the catalog wins over the game data');
assert.strictEqual(icons.find(map, 'harlequin crest'), 'https://d4guides.gg/hc.webp', 'any case');
assert.strictEqual(icons.find(map, "Storm Splitter's Aspect"), MX + icons.ASPECT.Offensive + '.webp', 'an aspect: its category');
assert.strictEqual(icons.find(map, "Juggernaut's Aspect"), MX + icons.ASPECT.Defensive + '.webp');
assert.strictEqual(icons.find(map, 'Duriel: Shard of Agony'), MX + '2.webp', 'a trophy: the item after the colon');
assert.strictEqual(icons.find(map, 'Tal'), MX + '12.webp', 'd2core ids on maxroll');
assert.strictEqual(icons.find(map, "Tiraj's Uncanny Insight"), MX + '14.webp', 'a set');
assert.strictEqual(icons.find(map, 'Berú of Uncanny Insight'), MX + '14.webp', 'accents do not matter');
assert.strictEqual(icons.find(map, 'No picture'), '', 'nothing made up');
assert.strictEqual(icons.find(map, 'Some New Aspect', 'aspect'), MX + icons.ASPECT.Offensive + '.webp', 'an unknown aspect still gets an aspect');
console.log('ok  pictures by name: catalog, game data, d2core, aspects, trophies, sets');
