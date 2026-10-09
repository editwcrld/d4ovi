// Iconic mythic uniques from maxroll's equipment page – no network, fixed input.
// The fixture copies the two traps of the real page: the chapter title also appears in the
// table of contents, and the lists mix item chips with sentences.
const assert = require('assert');
const my = require('../lib/mythics');

const HTML = `<html><body>
<nav class="toc"><ul>
  <li><a href="#unique-items-header">Unique Items</a></li>
  <li><a href="#mythic-unique-items-header">Mythic Unique Items</a></li>
  <li><a href="#transmog-header">Transmog</a></li>
</ul></nav>

<h2 id="unique-items-header">Unique Items</h2>
<p>Unique items have a fixed power.</p>
<h3>Farming Unique Items</h3>
<p>Uniques drop everywhere in World Tier 3 and above.</p>

<h2 id="mythic-unique-items-header">Mythic Unique Items</h2>
<p>As of Season 15, there are two types of Mythic Uniques in Diablo 4, Iconic and normal Mythic
Unique items. All Mythic items that drop can be equipped with no limitation, but you can only
equip one Mythic that you have crafted through the
<a href="https://maxroll.gg/d4/resources/horadric-cube">Horadric Cube</a>.</p>

<h3 id="iconic-mythic-uniques-header"><mark>Iconic Mythic Uniques</mark></h3>
<p>Not all <mark>Mythic </mark>items are Iconic. These items can be found in the wild wherever you
can get other Mythic items, or randomly crafted at the Blacksmith using 3x
<span class="d4-item" data-d4-id="1865358">Resplendent Sparks</span>. The following list is the
complete list of all Iconic Mythic items. </p>
<div><ul class="list-disc">
<li><span><span class="d4-item" data-d4-id="2646289">Andariel&#x27;s Visage</span></span></li>
<li><span><span class="d4-item" data-d4-id="2646277">Ahavarion, Spear of Lycander</span></span></li>
<li><span><span class="d4-item" data-d4-id="2646271">Doombringer</span></span></li>
<li><span><span class="d4-item" data-d4-id="2646273">El&#x27;Druin, Sword of Justice</span></span></li>
<li><span><span class="d4-item" data-d4-id="2646291">Harlequin Crest</span></span></li>
</ul></div>
<div><ul class="list-disc">
<li><span><span class="d4-item" data-d4-id="2646287">Nesekem, the Herald</span></span></li>
<li><span><span class="d4-item" data-d4-id="2629581">Ring of Starless Skies</span></span></li>
<li><span><span class="d4-item" data-d4-id="2646283">The Grandfather</span></span></li>
</ul></div>

<h3 id="normal-mythic-uniques-header">Normal Mythic Uniques</h3>
<p>The normal Mythic unique items can be acquired through various means.</p>
<ul class="list-disc">
<li>Unique item upgrade recipe at the Horadric Cube, which costs 5x
  <span class="d4-item" data-d4-id="1865358">Resplendent Sparks</span>.</li>
<li>Looted from natural drops.</li>
</ul>
<p>As of Season 15, upgrading Unique items to Mythic retains all the GA and stats.</p>

<h2 id="transmog-header">Transmog</h2>
<p>Transmog is unlocked at the wardrobe.</p>
</body></html>`;

const d = my.parse(HTML);

// --- the right chapter, not the table of contents
assert.ok(!/Transmog is unlocked/.test(JSON.stringify(d)), 'stops before the next chapter');
assert.ok(!/fixed power/.test(JSON.stringify(d)), 'starts at the real heading, not the toc entry');

// --- the complete list, across both columns, entities decoded
assert.deepStrictEqual(d.iconic.names, [
  "Andariel's Visage", 'Ahavarion, Spear of Lycander', 'Doombringer', "El'Druin, Sword of Justice",
  'Harlequin Crest', 'Nesekem, the Herald', 'Ring of Starless Skies', 'The Grandfather',
], 'all iconic names in page order');

// --- how to obtain: the sentences that say something, not the page chatter
assert.ok(/found in the wild/.test(d.iconic.how), 'iconic acquisition kept');
assert.ok(!/following list/i.test(d.iconic.how), 'sentence about the page itself dropped');
assert.ok(!/Not all Mythic items are Iconic/.test(d.iconic.how), 'filler sentence dropped');
assert.deepStrictEqual(d.iconic.ways, [], 'the chips are names, not ways');

// --- the normal mythics: sentences stay sentences, bullets stay bullets
assert.strictEqual(d.normal.ways.length, 2, 'two acquisition bullets');
assert.ok(/Resplendent Sparks\./.test(d.normal.ways[0]), 'bullet with an item chip kept whole');
assert.ok(d.normal.ways.every((w) => !/^Resplendent Sparks$/.test(w)), 'chip not mistaken for a way');
assert.ok(/only.*equip one Mythic/i.test(d.limit), 'the equip rule picked out of the intro');

// --- lookup
my.setData(d);
assert.strictEqual(my.count(), 8);
assert.ok(my.isIconic('harlequin crest'), 'lookup ignores case');
assert.ok(my.isIconic("El'Druin, Sword of Justice"), 'lookup ignores the apostrophe');
assert.ok(!my.isIconic('The Empyrean Eye'));

const a = my.info('Harlequin Crest', 'Mythic Unique');
assert.strictEqual(a.iconic, true);
assert.strictEqual(a.label, 'Iconic Mythic Unique');
assert.ok(/found in the wild/.test(a.obtain), 'iconic item gets the iconic text');
assert.ok(/equip one Mythic/.test(a.note));

const b = my.info('The Empyrean Eye', 'Mythic Unique');
assert.strictEqual(b.iconic, false);
assert.strictEqual(b.label, 'Mythic Unique');
assert.ok(/various means/.test(b.obtain) && /Horadric Cube/.test(b.obtain), 'normal item gets lead sentence + bullets');
assert.ok(!/As of Season/.test(b.obtain), 'patch note sentence dropped');

assert.strictEqual(my.info("Leoric's Crown", 'Unique'), null, 'not a mythic');
assert.ok(my.info('Doombringer', ''), 'iconic is recognised even without a rarity');

// --- a page without the chapter must fail loudly instead of saving nothing
assert.throws(() => my.parse('<html><body><h2>Transmog</h2></body></html>'), /not found/);
assert.throws(() => my.parse('<html><body><h2>Mythic Unique Items</h2><h3>Iconic Mythic Uniques</h3></body></html>'), /iconic mythics/);

console.log('ok  parsed', d.iconic.names.length, 'iconic mythics ·', d.normal.ways.length, 'ways for normal ones');
console.log('ok  how-to-obtain text, equip rule, lookup by name, bad pages rejected');
