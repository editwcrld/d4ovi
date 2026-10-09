// Parsing of a d4guides list page (name, icon, link, extra columns) – no network.
const assert = require('assert');
const d4g = require('../lib/d4guides');

const HTML = `
<h2 class="db-section__title">Seals</h2>
<div class="db-table-wrap"><table class="db-table">
  <thead><tr><th>Name</th><th class="hide-mobile">Rarity</th><th class="hide-mobile">Charm slots</th><th>Effect</th></tr></thead>
  <tbody>
    <tr><td><a href="/en/database/talismans/annihilus" class="db-table__link">
      <img src="/assets/img/talismans/seals/1297148016.webp" class="db-table__icon">
      <span class="db-table__name">Annihilus</span></a></td>
      <td class="hide-mobile"><span class="rarity-unique">Unique</span></td>
      <td class="hide-mobile">6</td>
      <td>Unlocks 6 Charm Slots +20.0% All Stats</td></tr>
    <tr><td><a href="/en/database/talismans/horadric-seal" class="db-table__link">
      <span class="db-table__name">Horadric Seal</span></a></td>
      <td class="hide-mobile">Magic</td><td class="hide-mobile">3</td><td>Unlocks 3 charm slots.</td></tr>
  </tbody>
</table></div>`;

const rows = d4g.parseList(HTML, 'talismans', 'Talisman');
assert.strictEqual(rows.length, 2, 'both rows parsed');

const a = rows[0];
assert.strictEqual(a.name, 'Annihilus');
assert.strictEqual(a.section, 'Seals', 'section heading picked up');
assert.strictEqual(a.url, 'https://d4guides.gg/en/database/talismans/annihilus', 'link made absolute');
assert.ok(a.icon.startsWith('https://d4guides.gg/assets/'), 'icon made absolute');
assert.deepStrictEqual(a.fields.map((f) => f.label), ['Rarity', 'Charm slots', 'Effect'], 'columns labelled from the header');
assert.strictEqual(a.fields[1].value, '6');
assert.ok(a.fields[2].value.includes('20.0% All Stats'));

// row without an icon still works
assert.strictEqual(rows[1].name, 'Horadric Seal');
assert.strictEqual(rows[1].icon, '');

// lookup by name is case/apostrophe insensitive
d4g.setExtra(rows);
assert.ok(d4g.get('ANNIHILUS'), 'lookup ignores case');
assert.strictEqual(d4g.get('nope'), null);

console.log('ok  parsed', rows.length, 'rows ·', a.fields.length, 'extra columns · icon + link absolute');
console.log('ok  lookup by name');
