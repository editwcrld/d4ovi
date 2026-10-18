const S = require('../renderer/search');
const sections = [
  { name: 'Grigoire, The Galvanic Saint', drops: [{ cls: 'Barbarian', name: 'Rage of Harrogath', note: '' }, { cls: 'Multiple Classes', name: 'Penitent Greaves', note: '' }] },
  { name: 'Echo of Varshan', drops: [{ cls: 'Druid', name: "Vasily's Prayer", note: '' }, { cls: 'Rogue', name: 'Eyes in the Dark', note: '' }] },
  { name: 'Mythic Uniques', drops: [{ cls: 'Mehrere Klassen', name: 'Harlequin Crest', note: 'All' }] },
];
const t = (q) => console.log(JSON.stringify(q).padEnd(26), '->', S.search(sections, q).map((g) => g.sec.name + ' [' + g.items.map((i) => i.name).join(', ') + ']').join(' | ') || '(nichts)');
t('vasilys prayer'); t("Vasily's"); t('penitent'); t('grigoire'); t('harlequin'); t('rage of harrogat'); t('xyz');

// keywords alone: "boss loot" names an area, "iconic mythic" the list of Iconic Mythics
const assert = require('assert');
assert.deepStrictEqual(S.parseQuery('iconic mythic'), { term: '', kinds: ['iconic', 'mythic'] }, 'iconic mythic: the whole list');
assert.deepStrictEqual(S.parseQuery('iconic'), { term: '', kinds: ['iconic'] });
assert.deepStrictEqual(S.parseQuery('iconic uniques'), { term: '', kinds: ['iconic', 'unique'] });
assert.deepStrictEqual(S.parseQuery('iconic harlequin'), { term: 'harlequin', kinds: ['iconic'] }, 'with a name: narrowed');
assert.deepStrictEqual(S.parseQuery('mythic'), { term: 'mythic', kinds: [] }, 'mythic alone stays a word to search for');
assert.deepStrictEqual(S.parseQuery('boss loot'), { term: '', kinds: ['boss'] });
assert.ok(S.showItems(['iconic', 'mythic']) && !S.showBoss(['iconic', 'mythic']), 'the iconic list: items only');
console.log('ok  keywords alone: boss loot, iconic mythic');
