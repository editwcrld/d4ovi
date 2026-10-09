// Import from infinitybuilds.gg. No network: the build page is faked in the shape the site
// really serves – the build inside Next.js' Server Components stream, split over script chunks.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { norm } = require('../lib/d4guides');
const d2db = require('../lib/d2coredb');
const mb = require('../lib/maxbuild');
const ib = require('../lib/infinitybuilds');
const bi = require('../lib/buildimport');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd4ib-'));
// d2core's database as if it was fetched a minute ago – nothing goes online
fs.writeFileSync(path.join(tmp, 'd2db.json'), JSON.stringify({ version: d2db.VERSION, fetchedAt: Date.now(), build: '1',
  affix: {
    S04_CritChance: '+[{VALUE}*100|1%|] Critical Strike Chance', S04_Life: '+[{VALUE}] Maximum Life', AttackSpeed: '+[{VALUE} * 100|1%|] Attack Speed',
    Talisman_Charm_Resistance_Single_Fire: '+[{VALUE2}] Fire Resistance',
  },
  affixId: {},
  socket: { Item_Gem_Ruby_08: 'Horadric Ruby', Rune_Condition_Bomb: 'Igni' },
  tree: { Warlock: { nodes: [
    { x: 0, y: 0, k: 'skill', id: 100, mod: 0, ranks: 5, nid: 891, pw: 'Warlock_BurningSkull' },
    { x: 0, y: 0, k: 'mod', id: 100, mod: 5, ranks: 1, nid: 892, pw: '' },
  ], links: [] } },
  skills: { 100: { name: 'Burning Skull', icon: 7, cls: 'Warlock', desc: [], val: null, mods: { 5: { name: 'Searing', desc: '' } } } },
  paragon: {
    boards: { Paragon_Warlock_00: { name: 'Start', cls: 'Warlock', rows: [] }, Paragon_Warlock_03: { name: 'Dynamism', cls: 'Warlock', rows: [] },
      Paragon_Warlock_06: { name: 'Greater Hex', cls: 'Warlock', rows: [] } },
    nodes: {}, glyphs: { ParagonGlyph_120: { name: 'Eldritch Sight', desc: '', bonus: '' } },
  },
  talisman: {
    items: {
      Talisman_Seal_MythicUnique_03: { name: 'Seal of the Diamond Mind', q: 'Mythic', type: 'Seal', set: '', d: [] },
      Talisman_Charm_Set_Warlock_02_02: { name: "Fer of Abaddon's Flesh", q: 'Set', type: 'Charm', set: 'Talisman_Warlock_02', d: [] },
    },
    sets: { Talisman_Warlock_02: { name: 'Flesh of Abaddon', bonuses: [{ n: 2, d: ['two'] }] } },
    affix: {},
  },
}));
d2db.configure({ file: path.join(tmp, 'd2db.json') });
// maxroll's English names by game id – the site names gear in its author's language
fs.writeFileSync(path.join(tmp, 'names.json'), JSON.stringify({ v: 2, fetchedAt: Date.now(), glyphs: {},
  names: { Helm_Unique_Generic_005: "Leoric's Crown" },
  aspects: { legendary_warlock_010_x2: 'Aspect of Aftermath' } }));
mb.configure({ namesFile: path.join(tmp, 'names.json') });

const ITEMS = ["Leoric's Crown", 'Azurewrath'];
const ASPECTS = ['Aspect of Aftermath', 'Ferocious Aspect'];
const catalog = {
  items: ITEMS.map((name, i) => ({ id: String(i), name, n: norm(name) })),
  aspects: ASPECTS.map((name, i) => ({ id: 'a' + i, name, n: norm(name) })),
};

// ---- links -------------------------------------------------------------------------------
assert.deepStrictEqual(ib.parseUrl('https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3'), { slug: 'mekunas-blazing-scream-warlock-rn824uhPl3' });
assert.deepStrictEqual(ib.parseUrl('infinitybuilds.gg/ko/builds/-ccsaGnt_Q?tab=gear'), { slug: '-ccsaGnt_Q' });
assert.deepStrictEqual(ib.parseUrl('https://www.infinitybuilds.gg/builds/BmZSjuDOub'), { slug: 'BmZSjuDOub' });
assert.deepStrictEqual(ib.parseUrl('https://infinitybuilds.gg/en/builds/rn824uhPl3?tab=paragon&variant=v-mul2mowk-fqxsj'), { slug: 'rn824uhPl3', variant: 'v-mul2mowk-fqxsj' });
assert.strictEqual(ib.parseUrl('https://infinitybuilds.gg/en/builds/new'), null, 'the planner is no build');
assert.strictEqual(ib.parseUrl('https://infinitybuilds.gg/en/builds'), null);
assert.strictEqual(bi.siteOf('https://infinitybuilds.gg/en/builds/rn824uhPl3'), 'infinitybuilds.gg');
console.log('ok  links');

// ---- the page ----------------------------------------------------------------------------
const VARIANT = {
  id: 'v-1', name: 'Endgame',
  gear: [
    { kind: 'mythic', slot: 'helm', itemId: 'item-helm-unique-generic-005-itm', itemName: '레오릭의 왕관',
      affixes: [{ affixId: 'affix-s04-critchance', value: 8.5, greater: true, tempered: false },
        { affixId: 'affix-attackspeed', value: 10, removed: true, tempered: false },
        { affixId: 'affix-s04-life', value: 1500, greater: true, tempered: true },
        { affixId: 'affix-unknown', value: 3, tempered: false },
        { affixId: 'affix-runeword-fastercastrate-25pct', value: 0, tempered: false },
        { affixId: 'affix-helm-unique-generic-005', value: 50, tempered: false }],
      sockets: ['item-gem-ruby-08-itm', 'item-rune-condition-bomb-itm', 'item-nothing-itm'] },
    { kind: 'unique', slot: 'boots', itemId: 'item-boots-unique-nowhere-001-itm', itemName: 'Boots of Nowhere', affixes: [] },
    { kind: 'custom_legendary', slot: 'offhandWeapon', itemId: 'item-x1-1hsword-legendary-generic-14-itm', aspectId: 'aspect-asp-legendary-unknown-1-asp', itemName: 'Ferocious Aspect', affixes: [] },
    { kind: 'custom_legendary', slot: 'ring1', itemId: 'item-ring-legendary-generic-032-itm', aspectId: 'aspect-asp-legendary-warlock-010-asp', itemName: '여파의 위상', affixes: [] },
    { kind: 'mythic', slot: 'weapon', itemId: 'item-1hsword-unique-generic-100-itm', itemName: '푸른 서슬', affixes: [] },
  ],
  skillIcons: ['burning_skull', 'command_vanguard_demon'],
  skills: { skills: { 'warlock::skill-891': 5, 'warlock::skill-892': 1, 'warlock::skill-999': 2 }, levelingPath: [] },
  paragon: {
    // the third board is listed before the one it hangs on
    slots: [
      { boardId: 'paragon-board::paragon-warlock-06', rotation: 3, selfGateId: 'paragon-board::paragon-warlock-06::210', parentGateId: 'paragon-board::paragon-warlock-03::230' },
      { boardId: 'paragon-board::paragon-warlock-03', rotation: 2, selfGateId: 'paragon-board::paragon-warlock-03::430', parentGateId: 'paragon-board::paragon-warlock-00::10' },
    ],
    glyphs: { 'paragon-board::paragon-warlock-00::136': 'glyph::rare-120-willpower-main' },
    activeNodes: ['paragon-board::paragon-warlock-00::10', 'paragon-board::paragon-warlock-00::31', 'paragon-board::paragon-warlock-03::52', 'paragon-board::paragon-warlock-06::440'],
  },
  talisman: {
    seal: 'item-talisman-seal-mythicunique-03-itm', sealAffixes: ['affix-s04-critchance', null], sealAffixValues: [5, null], sealAffixGreater: [],
    charms: ['Talisman_Charm_Set_Warlock_02_02', null], charmMythic: [null, null],
    charmAffixes: [['affix-talisman-charm-resistance-single-fire']], charmAffixValues: [[null]], charmAffixGreater: [[true]],
  },
};
const BUILD = {
  id: 'c1', title: "Mekuna's Blazing Scream ", classId: 'warlock', shareSlug: 'mekunas-blazing-scream-warlock-rn824uhPl3', description: '$54',
  snapshot: { meta: {}, gameId: 'diablo4', classId: 'warlock', variants: '$undefined' }, gear: null,
  variants: [VARIANT, { id: 'v-2', name: 'Empty', gear: [] }, Object.assign({}, VARIANT, { id: 'v-3', gear: VARIANT.gear.slice(0, 1) })],
};

/** A page the way Next.js sends it: rows "id:json\n", a text row "id:T<hex bytes>,…" without a newline, in chunks. */
function page(build) {
  const text = '<p>Héllo – a description\nover two lines</p>';
  const stream = '0:["$","$L1",null,{}]\n' + '54:T' + Buffer.byteLength(text, 'utf8').toString(16) + ',' + text
    + '50:' + JSON.stringify(['$', 'div', null, { children: [['$', 'nav', null, {}], ['$', '$L4e', null, { build, buildStatus: 'published' }]] }]) + '\n';
  const cut = Math.floor(stream.length / 2);
  const push = (s) => '<script>self.__next_f.push([1,' + JSON.stringify(s) + '])</script>';
  return '<html><body><script>(self.__next_f=self.__next_f||[]).push([0])</script>' + push(stream.slice(0, cut)) + push(stream.slice(cut)) + '</body></html>';
}

// what tools.infinitybuilds.gg answers for the build's ids
const DATA = { dataset: {
  gear: {
    items: [{ id: 'item-1hsword-unique-generic-100-itm', label: 'Azurewrath' }],
    aspects: [{ id: 'aspect-asp-legendary-unknown-1-asp', label: 'Ferocious Aspect' }],
    affixes: [
      { id: 'affix-unknown', label: 'Thorns', kind: 'magic', valueRange: { min: 1, max: 5 } },
      { id: 'affix-runeword-fastercastrate-25pct', label: 'Attack Speed', kind: 'magic', isPercent: true, valueRange: { min: 25, max: 25 } },
      { id: 'affix-helm-unique-generic-005', label: 'Leoric', kind: 'unique', isPercent: true, valueRange: { min: 20, max: 60 } },
      { id: 'affix-talisman-charm-resistance-single-fire', label: 'Fire Resistance', kind: 'magic', valueRange: { min: 2275, max: 2800 } },
    ],
  },
  skills: { nodes: [{ id: 'warlock-1093', sourceId: 'Warlock_Command_Vanguard_Demon.pow', label: 'Command Abodian' }] },
} };
const isData = (u) => u.startsWith(ib.TOOLS + '/api/games/diablo4/build-data?');

const fakeNet = (routes) => ({ fetch: async (url) => {
  const r = routes(url);
  if (!r) throw new Error('unexpected ' + url);
  return { ok: (r.status || 200) === 200, status: r.status || 200, text: async () => r.body, json: async () => JSON.parse(r.body) };
} });

assert.strictEqual(ib.extract(page(BUILD)).title, BUILD.title, 'the build comes out of the stream, past the text row');
assert.strictEqual(ib.extract('<html>no stream</html>'), null);

(async () => {
  let asked = '', dataQuery = null;
  const r = await bi.load(fakeNet((u) => {
    if (isData(u)) { dataQuery = new URL(u).searchParams; return { body: JSON.stringify(DATA) }; }
    asked = u;
    return { body: page(BUILD) };
  }), 'https://infinitybuilds.gg/de/builds/mekunas-blazing-scream-warlock-rn824uhPl3', catalog);
  assert.strictEqual(asked, 'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3', 'always the English page');
  assert.ok(dataQuery && dataQuery.get('classId') === 'warlock' && dataQuery.get('locale') === 'en', 'the site\'s data in English');
  assert.ok(dataQuery.get('aspectIds').split(',').includes('aspect-asp-legendary-warlock-010-asp')
    && dataQuery.get('affixIds').split(',').includes('affix-talisman-charm-resistance-single-fire')
    && dataQuery.get('itemIds').split(',').includes('Talisman_Charm_Set_Warlock_02_02'), 'asked for the build\'s ids');
  assert.strictEqual(r.site, 'infinitybuilds.gg');
  assert.strictEqual(r.title, "Mekuna's Blazing Scream");
  assert.strictEqual(r.cls, 'Warlock');
  assert.deepStrictEqual(r.variants.map((v) => v.variant), ['Endgame', 'Endgame (2)'], 'empty variant left out, same names told apart');
  assert.strictEqual(r.preselect, 0);
  const v = r.variants[0];
  assert.deepStrictEqual(v.source, { site: 'infinitybuilds.gg', url: 'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3?variant=v-1', title: "Mekuna's Blazing Scream" });
  assert.deepStrictEqual(v.slots, {
    Helm: { item: "Leoric's Crown",
      stats: [{ t: '+8.5% Critical Strike Chance', g: 1 }, { t: '+3 Thorns' }, { t: '+25% Attack Speed' }, { t: '+1,500 Maximum Life', g: 1, tmp: 1 }],
      sockets: ['Horadric Ruby', 'Igni'] },
    Ring1: { aspects: ['Aspect of Aftermath'] },
    Weapon: { item: 'Azurewrath', base: 'Sword' },
    'Off-Hand': { aspects: ['Ferocious Aspect'], base: 'Sword' },
  }, 'English names by game id (the site\'s, maxroll\'s), the page\'s name as fallback; shown values -> stat texts, else the site\'s name for the stat; '
    + 'a runeword\'s fixed line (0) at its value; removed lines and unique powers left out; one-handed blade into the off-hand');
  assert.deepStrictEqual(v.missing, ['Boots of Nowhere'], 'an unknown item is reported');
  assert.deepStrictEqual(v.skills.ranks, { 100: 5, '100_5': 1 }, 'tree nodes are the game\'s node ids');
  assert.deepStrictEqual(v.skills.bar.map((x) => [x.name, x.rank, x.id, x.mods.join()]),
    [['Burning Skull', 5, 100, 'Searing'], ['Command Abodian', 0, 0, '']], 'skill bar by key; one not in the tree by the site\'s name');
  assert.deepStrictEqual(v.paragon.boards.map((b) => [b.k, b.x, b.y, b.rot, b.glyph || '', b.nodes]), [
    ['Paragon_Warlock_00', 0, 0, 0, 'ParagonGlyph_120', [[0, 10], [1, 10]]],
    ['Paragon_Warlock_03', 0, -1, 2, '', [[2, 10]]],
    ['Paragon_Warlock_06', 1, -1, 3, '', [[20, 20]]],
  ], 'boards placed beside the parent\'s gate (top -> above, right -> to the right), nodes on the unturned board, glyph by number');
  assert.strictEqual(v.charms.seal.name, 'Seal of the Diamond Mind');
  assert.deepStrictEqual(v.charms.seal.stats, [{ t: '+5.0% Critical Strike Chance' }]);
  assert.deepStrictEqual(v.charms.list.map((c) => [c.name, c.set, c.stats]), [["Fer of Abaddon's Flesh", 'Flesh of Abaddon', [{ t: '+3,500 Fire Resistance', g: 1 }]]],
    'charms by game key; a stat without a roll at its best (greater: a quarter more), as the site shows it');
  console.log('ok  infinitybuilds.gg: page stream -> variants with gear, stats, skills, paragon, charms');

  // "?variant=" picks the variant; without the site's data the import still works
  const r2 = await bi.load(fakeNet((u) => (isData(u) ? { status: 500 } : { body: page(BUILD) })),
    'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3?variant=v-3', catalog);
  assert.strictEqual(r2.preselect, 1, 'the linked variant is preselected');
  assert.strictEqual(r2.variants[1].source.url, 'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3?variant=v-3');
  const w = r2.variants[0];
  assert.deepStrictEqual(w.slots.Helm.stats.map((x) => x.t), ['+8.5% Critical Strike Chance', '+1,500 Maximum Life']);
  assert.ok(w.missing.includes('푸른 서슬'), 'the Korean name finds nothing');
  assert.deepStrictEqual(w.skills.bar.map((x) => x.name), ['Burning Skull', 'Command Vanguard Demon'], 'spelt out from the key');
  assert.deepStrictEqual(w.charms.list[0].stats, [{ t: '+# Fire Resistance', g: 1 }], 'no range: "#"');
  console.log('ok  link to a variant; without the site\'s data');

  assert.strictEqual(ib.gearValue(10, { valueRange: { min: 8, max: 10 } }), 10);
  assert.strictEqual(ib.gearValue(250, { valueRange: { min: 20, max: 30 } }), 25, 'tenfold read as the tenth');
  assert.strictEqual(ib.gearValue(80, { valueRange: { min: 40, max: 40 } }), 80, 'kept when the tenth does not fit');
  assert.strictEqual(ib.charmValue(null, { valueRange: { min: 3, max: 4 }, isPercent: true }, true), 5);
  assert.strictEqual(ib.charmValue(2, { valueRange: { min: 2, max: 3 } }, true), 2, 'a saved roll wins');
  assert.strictEqual(ib.siteLine({ label: 'to Hellfire Skills', kind: 'skillrank' }, 4), '+4 to Hellfire Skills');
  console.log('ok  rolls the way the site shows them');

  await assert.rejects(bi.load(fakeNet(() => ({ status: 404 })), 'https://infinitybuilds.gg/en/builds/gone', catalog), /does not exist/);
  await assert.rejects(bi.load(fakeNet(() => ({ body: '<html></html>' })), 'https://infinitybuilds.gg/en/builds/x1234', catalog), /No build/);
  const poe = Object.assign({}, BUILD, { snapshot: { gameId: 'poe2' } });
  await assert.rejects(bi.load(fakeNet(() => ({ body: page(poe) })), 'https://infinitybuilds.gg/en/builds/x1234', catalog), /not a Diablo 4 build/);
  console.log('ok  missing build, empty page, Path of Exile 2 build');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
