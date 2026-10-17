// Import from maxroll: links, guide page bits, planner variants -> builds. No network.
const assert = require('assert');
const mb = require('../lib/maxbuild');

// ---- links ---------------------------------------------------------------------
assert.deepStrictEqual(mb.parseUrl('https://maxroll.gg/d4/planner/uyz7y00t#4'), { kind: 'planner', id: 'uyz7y00t', variant: 4 });
assert.deepStrictEqual(mb.parseUrl('maxroll.gg/d4/planner/uyz7y00t'), { kind: 'planner', id: 'uyz7y00t', variant: 0 });
assert.strictEqual(mb.parseUrl('https://maxroll.gg/d4/build-guides/ice-spikes-sorcerer-guide#gear').kind, 'guide');
assert.strictEqual(mb.parseUrl('https://maxroll.gg/d4/build-guides/ice-spikes-sorcerer-guide#gear').url, 'https://maxroll.gg/d4/build-guides/ice-spikes-sorcerer-guide');
assert.strictEqual(mb.parseUrl('https://example.com/x'), null, 'other sites are refused');
assert.strictEqual(mb.parseUrl('hello'), null);
console.log('ok  guide and planner links recognised');

// ---- guide page ------------------------------------------------------------------
const PAGE = `<a href="/d4/planner/builds">Builds</a> … <a href="https://maxroll.gg/d4/planner/uyz7y00t#4">Open in planner</a>
  <script>{"text":"Leoric's Crown","embedType":"d4-item","id":"Helm_Unique_Generic_005"}</script>
  <span data-d4-id="Pants_Unique_Generic_102" data-d4-text="Tibault&#x27;s Will">Tibault's Will</span>
  <a href="/d4/planner/uyz7y00t#2">again</a>`;
assert.deepStrictEqual(mb.plannerIds(PAGE), [{ id: 'uyz7y00t', variant: 4 }], 'menu link skipped, one profile, first variant mark wins');
assert.deepStrictEqual(mb.embedNames(PAGE), { Helm_Unique_Generic_005: "Leoric's Crown", Pants_Unique_Generic_102: "Tibault's Will" }, 'item chips: id -> name');
console.log('ok  guide page: planner link + item names');

// ---- slots from game ids -------------------------------------------------------------
const cases = {
  Helm_Unique_Generic_005: 'Helm', Chest_Unique_Sorc_002: 'Chest Armor', S14_Ring_Unique_Generic_104: 'Ring',
  '1HFocus_Legendary_Generic_005': 'Off-Hand', '1HSword_Legendary_Generic_001': 'Weapon', '2HAxe_Unique_Barb_001': 'Weapon',
  Pants_Unique_Generic_102: 'Pants', Amulet_Legendary_Generic_001: 'Amulet',
  Talisman_Seal_MythicUnique_03: '', Talisman_Charm_Unique_Amulet_Unique_Generic_101: '', S15_SoulSplinter_Andariel_04: '',
};
for (const [id, slot] of Object.entries(cases)) assert.strictEqual(mb.slotOfId(id), slot, id);
console.log('ok  slots from game ids (talisman and splinters left out)');

// ---- a planner variant -> build ---------------------------------------------------------
const pool = [
  { id: 'Helm_Unique_Generic_005', mythic: true },
  { id: 'Chest_Unique_Sorc_002' },
  { id: '1HFocus_Legendary_Generic_005', aspects: [{ nid: 2574550 }] },
  { id: '1HSword_Legendary_Generic_001', aspects: [{ nid: 2574575 }] },
  { id: 'S14_Ring_Unique_Generic_104' },
  { id: 'Ring_Unique_Sorc_100' },
  { id: 'Amulet_Legendary_Generic_001', aspects: [{ nid: 2575303 }, { nid: 2575334 }] },
  { id: 'Talisman_Seal_MythicUnique_03' },
  { id: 'Boots_Unique_Sorc_999' },                                   // unknown to the name list
];
const variant = { name: 'Endgame', items: { 4: 0, 5: 1, 6: 2, 7: 3, 16: 4, 17: 5, 18: 6, 20: 7, 15: 8 } };
const NAMES = { Helm_Unique_Generic_005: "Leoric's Crown", Chest_Unique_Sorc_002: 'Raiment of the Infinite',
  S14_Ring_Unique_Generic_104: 'Ring of Starless Skies', Ring_Unique_Sorc_100: 'Blue Rose' };
const ASPECTS = { 2574550: 'Blasting Aspect', 2574575: 'Aspect of Merciless Cold', 2575303: 'Lingering Aspect', 2575334: 'Aspect of Biting Cold' };
const b = mb.toBuild(variant, pool, { nameOf: (id) => NAMES[id] || '', aspectName: (n) => ASPECTS[n] || '' }, 'Ice Spikes Sorc', 'Sorcerer');
assert.strictEqual(b.name, 'Ice Spikes Sorc – Endgame');
assert.strictEqual(b.cls, 'Sorcerer');
assert.deepStrictEqual(b.slots, {
  Helm: { item: "Leoric's Crown" },
  'Chest Armor': { item: 'Raiment of the Infinite' },
  'Off-Hand': { aspects: ['Blasting Aspect'] },
  Weapon: { aspects: ['Aspect of Merciless Cold'], base: 'Sword' },
  Ring1: { item: 'Ring of Starless Skies' },
  Ring2: { item: 'Blue Rose' },
  Amulet: { aspects: ['Lingering Aspect', 'Aspect of Biting Cold'] },
}, 'uniques by name, legendaries by aspect, two rings, two amulet aspects, talisman left out');
assert.deepStrictEqual(b.missing, ['Boots_Unique_Sorc_999'], 'an unknown item is reported, not guessed');
console.log('ok  planner variant -> build');

// a unique with an aspect transfigured onto it stays the unique – the aspect goes along as ◈
{
  const t = mb.toBuild({ name: 'T', items: { 6: 0 } }, [{ id: 'Amulet_Unique_Rogue_100', aspects: [{ nid: 2575334 }] }],
    { nameOf: (id) => (id === 'Amulet_Unique_Rogue_100' ? 'Word of Hakan' : ''), aspectName: (n) => ASPECTS[n] || '' }, 'T', 'Rogue');
  assert.deepStrictEqual(t.slots, { Amulet: { item: 'Word of Hakan', tf: 'Aspect of Biting Cold' } }, 'unique + transfigured aspect');
  // the masterwork capstone's affix is the one marked "upgrade": 1
  const db = { affixId: { 1: 'S04_CDR', 2: 'S04_MaxRes' }, affix: { S04_CDR: '[{VALUE}*100|1%|] Cooldown Reduction', S04_MaxRes: '+[{VALUE}|~|] Maximum Resource' } };
  const st = require('../lib/d2coredb').statsFromIds(db, [{ nid: 1, values: [0.14], upgrade: 1 }, { nid: 2, values: [30], greater: true, upgrade: 0 }]);
  assert.deepStrictEqual(st.map((x) => [x.g || 0, x.mw || 0]), [[0, 1], [1, 0]], 'maxroll: ★ on the affix with upgrade 1');
  console.log('ok  unique + transfigured aspect, masterwork');
}

// dual wield: a second one-handed weapon lands in the off-hand, a third in Weapon 2 – each with its kind
const dw = mb.toBuild({ name: 'DW', items: { 7: 0, 8: 1, 9: 2 } },
  [{ id: '1HAxe_Unique_Barb_001' }, { id: '1HSword_Unique_Barb_002' }, { id: '2HMace_Unique_Barb_003' }],
  { nameOf: (id) => ({ '1HAxe_Unique_Barb_001': 'A', '1HSword_Unique_Barb_002': 'B', '2HMace_Unique_Barb_003': 'C' })[id], aspectName: () => '' }, 'Barb', 'Barbarian');
assert.deepStrictEqual(dw.slots, { Weapon: { item: 'A', base: 'Axe' }, 'Off-Hand': { item: 'B', base: 'Sword' }, 'Weapon 2': { item: 'C', base: 'Two-Handed Mace' } });
assert.deepStrictEqual(dw.extra, [], 'a barbarian arsenal fits');
console.log('ok  dual wield + extra weapons');

// season tags in the id ("S05_BSK_…") – the helm still is a helm; weapons keep their kind
assert.strictEqual(mb.slotOfId('S05_BSK_Helm_Unique_Generic_001'), 'Helm');
assert.strictEqual(mb.slotOfId('S05_BSK_1HSword_Unique_Generic_001'), 'Weapon');
assert.strictEqual(mb.weaponOfId('2HCrossbow_Legendary_Generic_001'), 'Crossbow');
assert.strictEqual(mb.weaponOfId('2HAxe_Unique_Barb_001'), 'Two-Handed Axe');
{
  // rogue: crossbow + two blades – three weapons, none lost
  const pool2 = [{ id: '2HCrossbow_Legendary_Generic_001', aspects: [{ nid: 1 }] }, { id: '1HDagger_Unique_Rogue_003_x2' }, { id: 'S05_BSK_1HSword_Unique_Generic_001' }, { id: 'S05_BSK_Helm_Unique_Generic_001' }];
  const names2 = { '1HDagger_Unique_Rogue_003_x2': "Etna's Lost Dagger", S05_BSK_1HSword_Unique_Generic_001: 'Some Sword', S05_BSK_Helm_Unique_Generic_001: 'Some Helm' };
  const r = mb.toBuild({ name: 'x', items: { 4: 3, 10: 0, 11: 1, 12: 2 } }, pool2, { nameOf: (id) => names2[id] || '', aspectName: () => 'Ferocious Aspect' }, 'T', 'Rogue');
  assert.strictEqual(r.slots.Helm.item, 'Some Helm', 'season-tagged helm imported');
  assert.deepStrictEqual([r.slots.Weapon.base, r.slots['Off-Hand'].base, r.slots['Weapon 2'].base], ['Crossbow', 'Dagger', 'Sword'], 'three weapons with their kind');
  assert.strictEqual(r.extra.length, 0);
}
console.log('ok  season-tagged ids, three weapons');
