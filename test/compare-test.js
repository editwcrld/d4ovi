// Comparing two builds: the diff behind the Compare tab
const assert = require('assert');
const C = require('../renderer/compare');

const starter = {
  id: 'b1', name: 'Rogue – Starter', cls: 'Rogue',
  source: { site: 'maxroll.gg', url: 'https://maxroll.gg/d4/planner/abc#1' },
  slots: {
    Helm: { item: 'Harlequin Crest', stats: [{ t: '+10% Crit' }], sockets: ['Royal Ruby'] },
    Amulet: { aspects: ['Aspect of A'] },
    Weapon: { item: 'Starter Bow' },
  },
  skills: { bar: [{ name: 'Rain of Arrows' }, { name: 'Dash' }] },
  charms: { seal: { name: 'Seal X' }, list: [{ name: 'Charm 1' }] },
  paragon: { boards: [{ k: 'Paragon_Rogue_00', glyph: 'G1' }] },
  done: ['Harlequin Crest'],
};
const endgame = {
  id: 'b2', name: 'Rogue – Endgame', cls: 'Rogue',
  source: { site: 'maxroll.gg', url: 'https://maxroll.gg/d4/planner/abc#3' },
  slots: {
    Helm: { item: 'Harlequin Crest', stats: [{ t: '+12% Crit' }], sockets: ['Royal Ruby'] },
    Amulet: { aspects: ['Aspect of A', 'Aspect of B'] },
    Weapon: { item: 'Infinity', sockets: ['Jah', 'Ber'] },
    Boots: { aspects: ['Aspect of C'] },
  },
  skills: { bar: [{ name: 'Rain of Arrows' }, { name: 'Shadow Step' }] },
  charms: { seal: { name: 'Seal X' }, list: [{ name: 'Charm 2' }] },
  paragon: { boards: [{ k: 'Paragon_Rogue_00', glyph: 'G1' }, { k: 'Paragon_Rogue_03', glyph: 'G2' }] },
  done: ['Infinity'],
};
const other = { id: 'b3', name: 'Sorc', cls: 'Sorcerer', slots: {} };

assert.strictEqual(C.partner([other, starter, endgame], starter).id, 'b2', 'the default partner is a variant of the same guide');
assert.strictEqual(C.partner([starter, other], starter).id, 'b3', 'otherwise any other build');
console.log('ok  picks another variant of the same guide');

const d = C.diff(starter, endgame);
const slot = (k) => d.slots.find((s) => s.key === k);
assert.strictEqual(slot('Helm').state, 'same');
assert.deepStrictEqual([slot('Helm').statsOnlyA, slot('Helm').statsOnlyB], [['+10% Crit'], ['+12% Crit']], 'same item, other rolls');
assert.strictEqual(slot('Amulet').state, 'changed', 'a second aspect is a change');
assert.strictEqual(slot('Weapon').state, 'changed');
assert.deepStrictEqual(slot('Weapon').socketsB, ['Jah', 'Ber']);
assert.strictEqual(slot('Boots').state, 'added');
assert.strictEqual(d.same, 1); assert.strictEqual(d.changed, 3);
console.log('ok  gear: same, changed, added, rolls and sockets');

assert.deepStrictEqual(d.skills, { both: ['Rain of Arrows'], onlyA: ['Dash'], onlyB: ['Shadow Step'] });
assert.deepStrictEqual(d.charms.onlyB, ['Charm 2']);
assert.deepStrictEqual(d.boards.onlyB, ['Paragon_Rogue_03']);
assert.deepStrictEqual(d.glyphs.onlyB, ['G2']);
console.log('ok  skills, charms, boards, glyphs');

// Harlequin is ticked in the starter, Infinity in the endgame build – neither is still needed
assert.ok(!d.need.includes('Harlequin Crest') && !d.need.includes('Infinity'), 'what either build has ticked is not needed');
assert.deepStrictEqual(d.need.slice().sort(), ['Aspect of A', 'Aspect of B', 'Aspect of C', 'c:Charm 2', 'c:Seal X', 's:Ber', 's:Jah', 's:Royal Ruby'].sort());
console.log('ok  left to farm for the other build');
