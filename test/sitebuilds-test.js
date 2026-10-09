// Import from d4builds.gg and d2core.com, the Chinese titles, and the shared slot logic. No network:
// the sites' answers are faked in the shape they really have.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { norm } = require('../lib/d4guides');
const { fitter, buildName } = require('../lib/buildfit');
const d4b = require('../lib/d4buildsgg');
const d2c = require('../lib/d2core');
const zh = require('../lib/zhdict');
const mb = require('../lib/maxbuild');
const bi = require('../lib/buildimport');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'd4sb-'));
// d2core's database as if it was fetched a minute ago – the importers use it, nothing goes online
fs.writeFileSync(path.join(tmp, 'd2db.json'), JSON.stringify({ version: require('../lib/d2coredb').VERSION, fetchedAt: Date.now(), build: '1',
  affix: {}, affixId: {}, socket: {}, tree: {}, skills: {}, paragon: { boards: {}, nodes: {}, glyphs: {} }, talisman: { items: {}, sets: {}, affix: {} } }));
require('../lib/d2coredb').configure({ file: path.join(tmp, 'd2db.json') });
const ITEMS = ["Cowl of the Nameless", 'Enigma', "Gladiator's Triumph", 'Shrouded Gift', 'Beastfall Boots', "Banished Lord's Talisman",
  "Scoundrel's Kiss", 'Insight', 'Spirit', 'Word of Hakan', "Leoric's Crown", "Tibault's Will", 'Infinity', 'Signet of Pelghain'];
const ASPECTS = ['Aspect of Aftermath', 'Aspect of Frozen Memories', 'Aspect of Inner Calm', 'Ferocious Aspect', "Earthstriker's Aspect", 'Impairing Aspect'];
const catalog = {
  items: ITEMS.map((name, i) => ({ id: String(i), name, n: norm(name) })),
  aspects: ASPECTS.map((name, i) => ({ id: 'a' + i, name, n: norm(name) })),
};

// ---- shared ---------------------------------------------------------------------------
{
  const f = fitter(catalog);
  assert.strictEqual(f.item('scoundrel’s kiss'), "Scoundrel's Kiss", 'curly apostrophe and case do not matter');
  assert.strictEqual(f.aspect('Aftermath'), 'Aspect of Aftermath', 'short aspect name');
  assert.strictEqual(f.aspect('Ferocious'), 'Ferocious Aspect');
  assert.strictEqual(f.item('Not An Item'), '');
  // rogue: bow, then two blades – all three kept: Weapon, Off-Hand, Weapon 2
  f.put('Weapon', { item: 'Infinity' });
  f.put('Weapon', { aspects: ['Aspect of Frozen Memories'] }, true);
  f.put('Weapon', { item: 'Spirit' }, true);
  f.put('Ring', { item: 'Signet of Pelghain' });
  f.put('Ring', { aspects: ['Aspect of Aftermath'] });
  f.put('Ring', { item: "Scoundrel's Kiss" });
  const r = f.result();
  assert.deepStrictEqual(r.slots, { Weapon: { item: 'Infinity' }, 'Off-Hand': { aspects: ['Aspect of Frozen Memories'] }, 'Weapon 2': { item: 'Spirit' },
    Ring1: { item: 'Signet of Pelghain' }, Ring2: { aspects: ['Aspect of Aftermath'] } });
  assert.deepStrictEqual(r.extra, ["Scoundrel's Kiss"]);
  // a two-handed second weapon never goes into the off-hand
  const g = fitter(catalog);
  g.put('Weapon', { item: 'Insight' }); g.put('Weapon', { item: 'Infinity' }, false);
  assert.deepStrictEqual(g.result().slots, { Weapon: { item: 'Insight' }, 'Weapon 2': { item: 'Infinity' } });
}
assert.strictEqual(buildName('Ice Spikes Sorc', 'Endgame'), 'Ice Spikes Sorc – Endgame');
assert.strictEqual(buildName('1-Button RoA Rogue (S15)', 'Standard Build (2)'), '1-Button RoA Rogue… – Standard Build (2)', 'the title gives way');
assert.strictEqual(buildName('x', 'Infinity bow cold Rain of Arrows (incl. paragon)'), 'Infinity bow cold Rain of Arrows (incl.…');
assert.ok(buildName('A very long title of a build guide', 'Starter').length <= 40);
console.log('ok  names matched to the catalog, slots, dual wield, build names');

// ---- d4builds.gg ---------------------------------------------------------------------------
assert.deepStrictEqual(d4b.parseUrl('https://d4builds.gg/builds/9b97893d-ff28-403d-9b80-e30a22cf3163/?var=1'),
  { id: '9b97893d-ff28-403d-9b80-e30a22cf3163', variant: 1 });
assert.deepStrictEqual(d4b.parseUrl('d4builds.gg/builds/9B97893D-FF28-403D-9B80-E30A22CF3163'), { id: '9b97893d-ff28-403d-9b80-e30a22cf3163', variant: 0 });
assert.strictEqual(d4b.parseUrl('https://d4builds.gg/builds/abc'), null);
assert.deepStrictEqual(d4b.plain({ mapValue: { fields: { a: { stringValue: 'x' }, n: { integerValue: '3' }, z: { nullValue: null },
  l: { arrayValue: { values: [{ booleanValue: true }, { stringValue: 'y' }] } } } } }), { a: 'x', n: 3, z: null, l: [true, 'y'] });

const s = (v) => (v == null ? { nullValue: null } : { stringValue: v });
const map = (o) => ({ mapValue: { fields: Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v && v.mapValue || v && v.arrayValue ? v : s(v)])) } });
const gearMain = { Helm: 'Cowl of the Nameless', 'Chest Armor': 'Enigma', Gloves: "Gladiator's Triumph", Pants: 'Shrouded Gift',
  Boots: 'Beastfall Boots', Amulet: 'Aspect of Inner Calm', 'Ring 1': 'Aspect of Aftermath', 'Ring 2': "Scoundrel's Kiss",
  'Ranged Weapon': 'Insight', 'Dual-Wield Weapon 1': 'Aspect of Frozen Memories', 'Dual-Wield Weapon 2': 'Spirit',
  Weapon: null, Offhand: null, 'Bludgeoning Weapon': null, 'Slashing Weapon': null };
const DOC = { fields: {
  name: s('1-Button RoA Rogue (S15)  '), class: s('Rogue'), variantName: s('Standard Build'),
  gear: map(gearMain),
  sanctification: map({ Amulet: { arrayValue: { values: [s("Earthstriker's Aspect"), s(null)] } } }),
  variants: { arrayValue: { values: [map({ variantName: 'Standard Build',
    gear: map(Object.assign({}, gearMain, { Amulet: 'Word of Hakan', Boots: 'Unknown Boots of Nowhere' })) })] } },
} };
const fakeNet = (routes) => ({ fetch: async (url, opts) => {
  const r = routes(url, opts);
  return { ok: r.status === undefined || r.status === 200, status: r.status || 200, json: async () => r.body };
} });

(async () => {
  let asked = '';
  const r = await d4b.load(fakeNet((u) => { asked = u; return { body: DOC }; }),
    'https://d4builds.gg/builds/9b97893d-ff28-403d-9b80-e30a22cf3163/?var=1', catalog);
  assert.ok(asked.startsWith(d4b.DOC_URL) && asked.endsWith('9b97893d-ff28-403d-9b80-e30a22cf3163'), 'reads the Firestore document');
  assert.strictEqual(r.title, '1-Button RoA Rogue (S15)');
  assert.strictEqual(r.cls, 'Rogue');
  assert.deepStrictEqual(r.variants.map((v) => v.variant), ['Standard Build', 'Standard Build (2)'], 'same names told apart');
  assert.strictEqual(r.preselect, 1, '?var=1 is the first entry of "variants"');
  const [v0, v1] = r.variants;
  assert.deepStrictEqual(v0.slots, {
    Helm: { item: 'Cowl of the Nameless' }, 'Chest Armor': { item: 'Enigma' }, Gloves: { item: "Gladiator's Triumph" },
    Pants: { item: 'Shrouded Gift' }, Boots: { item: 'Beastfall Boots' },
    Amulet: { aspects: ['Aspect of Inner Calm', "Earthstriker's Aspect"] },
    Ring1: { aspects: ['Aspect of Aftermath'] }, Ring2: { item: "Scoundrel's Kiss" },
    Weapon: { item: 'Insight', base: 'Ranged Weapon' }, 'Off-Hand': { aspects: ['Aspect of Frozen Memories'], base: 'Dual-Wield Weapon' },
    'Weapon 2': { item: 'Spirit', base: 'Dual-Wield Weapon' },
  }, 'uniques, runewords, aspects, sanctified second aspect, three weapons');
  assert.deepStrictEqual(v0.extra, [], 'all three weapons kept');
  assert.deepStrictEqual(v1.slots.Amulet, { item: 'Word of Hakan' });
  assert.deepStrictEqual(v1.missing, ['Unknown Boots of Nowhere'], 'unknown names are reported');
  await assert.rejects(d4b.load(fakeNet(() => ({ status: 404 })), 'https://d4builds.gg/builds/9b97893d-ff28-403d-9b80-e30a22cf3163/', catalog), /does not exist/);
  console.log('ok  d4builds.gg: Firestore document -> variants, ?var, sanctified aspect');

  // ---- Chinese -> English ----------------------------------------------------------------
  const EN = { skills: { Rogue_RainofArrows: { name: 'Rain of Arrows' }, Rogue_ColdImbue: { name: 'Cold Imbuement' } },
    items: { Runeword_Infinity_Bow: { name: 'Infinity' }, Helm_Unique_Generic_005: { name: "Leoric's Crown" }, Helm_Rare_1: { name: 'Cap' } },
    affixes: { legendary_rogue_153_x2: { suffix: 'of Aftermath' }, legendary_spiritborn_013_x2: { prefix: 'Ferocious' } },
    classes: { 3: { nameMale: 'Rogue' } } };
  const ZH = { skills: { Rogue_RainofArrows: { name: '箭雨' }, Rogue_ColdImbue: { name: '冰霜灌注' } },
    items: { Runeword_Infinity_Bow: { name: '无限' }, Helm_Unique_Generic_005: { name: '李奥瑞克的王冠' }, Helm_Rare_1: { name: '帽子' } },
    affixes: { legendary_rogue_153_x2: { suffix: '余劲尚存之' }, legendary_spiritborn_013_x2: { prefix: '残暴' } },
    classes: { 3: { nameMale: '游侠' } } };
  const dict = zh.build(EN, ZH);
  assert.strictEqual(dict['无限'], 'Infinity');
  assert.strictEqual(dict['余劲尚存之威能'], 'Aspect of Aftermath');
  assert.strictEqual(dict['残暴威能'], 'Ferocious Aspect');
  assert.strictEqual(dict['游侠'], 'Rogue');
  assert.strictEqual(dict['帽子'], undefined, 'rare items are not taken');
  const words = Object.assign({}, dict, zh.GLOSSARY);
  const tr = (t) => zh.translate(t, words);
  assert.strictEqual(tr('S15-无限-冰灌箭雨(5-6分钟天塔150)'), 'S15-Infinity-Cold Imbuement Rain of Arrows (5-6 min Pit 150)');
  assert.strictEqual(tr('无限弓冰箭雨(含巅峰盘)'), 'Infinity bow cold Rain of Arrows (incl. paragon)');
  assert.strictEqual(tr('残暴弓弩版（同样强大）'), 'Ferocious bow/crossbow version (equally strong)', 'full-width brackets');
  assert.strictEqual(tr('游侠 未知词 速刷'), 'Rogue 未知词 speed farm', 'unknown words are kept');
  assert.strictEqual(tr('Plain English (S15)'), 'Plain English (S15)');
  console.log('ok  Chinese titles: game names from both languages + glossary');

  // ---- d2core.com --------------------------------------------------------------------------
  assert.deepStrictEqual(d2c.parseUrl('https://www.d2core.com/d4/planner?bd=23TM&lang=enUS'), { bd: '23TM' });
  assert.deepStrictEqual(d2c.parseUrl('d2core.com/d4/planner?lang=enUS&bd=1xYz'), { bd: '1xYz' });
  assert.strictEqual(d2c.parseUrl('https://www.d2core.com/d2r/planner?bd=23TM'), null, 'Diablo II builds are not ours');
  assert.ok(/^timestamp=1700000000000;appAccessKeyId=1;appSign=diablocore;sign=[\w-]+\.[\w-]+\.[\w-]+$/.test(d2c.appSource(1700000000000)), 'signed app header');

  const piece = (itemType, key, type, more) => Object.assign({ itemType, key, type, itemPower: 900, sockets: [] }, more);
  const GEAR = {
    0: piece('Helm', 'Helm_Unique_Generic_005', 'uniqueItem', { name: '李奥瑞克的王冠' }),
    1: piece('ChestArmor', 'Runeword_Enigma', 'uniqueItem'),
    3: piece('Legs', 'Pants_Unique_Generic_102', 'uniqueItem'),
    5: piece('Bow', 'Runeword_Infinity_Bow', 'uniqueItem'),
    8: piece('Amulet', 'Affix_legendary_spiritborn_013_x2', 'legendary', { transfiguredAspect: 'Affix_legendary_barb_014_x2' }),
    9: piece('Ring', 'Affix_legendary_rogue_153_x2', 'legendary'),
    10: piece('Ring', 'Ring_Unique_Generic_105_x2', 'uniqueItem'),
    12: piece('Sword', 'Affix_legendary_coldUser_001_x2', 'legendary'),
    13: piece('Sword', 'Runeword_Spirit_1HSword', 'uniqueItem'),
    4: piece('Boots', 'Boots_Unique_Rogue_999', 'uniqueItem'),
  };
  const NAMES = {
    items: { Helm_Unique_Generic_005: "Leoric's Crown", Runeword_Enigma: 'Enigma', Pants_Unique_Generic_102: "Tibault's Will",
      Runeword_Infinity_Bow: 'Infinity', Ring_Unique_Generic_105_x2: 'Signet of Pelghain', Runeword_Spirit_1HSword: 'Spirit' },
    aspects: { legendary_spiritborn_013_x2: 'Ferocious Aspect', legendary_barb_014_x2: "Earthstriker's Aspect",
      legendary_rogue_153_x2: 'Aspect of Aftermath', legendary_coldUser_001: 'Aspect of Frozen Memories' },
  };
  const b = d2c.toBuild({ name: 'Infinity bow speed farm', gear: GEAR }, catalog, NAMES, 'S15-Infinity', 'Rogue');
  assert.deepStrictEqual(b.slots, {
    Helm: { item: "Leoric's Crown" }, 'Chest Armor': { item: 'Enigma' }, Pants: { item: "Tibault's Will" },
    Weapon: { item: 'Infinity', base: 'Bow' }, Amulet: { aspects: ['Ferocious Aspect', "Earthstriker's Aspect"] },
    Ring1: { aspects: ['Aspect of Aftermath'] }, Ring2: { item: 'Signet of Pelghain' },
    'Off-Hand': { aspects: ['Aspect of Frozen Memories'], base: 'Sword' }, 'Weapon 2': { item: 'Spirit', base: 'Sword' },
  }, 'game ids -> English names, transfigured aspect second; bow + two swords, each with its kind');
  assert.deepStrictEqual(b.extra, [], '"_x2" ids fall back to the plain aspect, all three weapons kept');
  assert.deepStrictEqual(b.missing, ['Boots_Unique_Rogue_999'], 'an id without a name is reported');
  assert.strictEqual(b.name, 'S15-Infinity – Infinity bow speed farm');

  // the whole load: anonymous sign-in, token, cloud function – then names and titles in English
  fs.writeFileSync(path.join(tmp, 'names.json'), JSON.stringify({ v: 2, fetchedAt: Date.now(), names: NAMES.items, aspects: NAMES.aspects, glyphs: {} }));
  fs.writeFileSync(path.join(tmp, 'zh.json'), JSON.stringify({ version: 1, fetchedAt: Date.now(), dict }));
  mb.configure({ namesFile: path.join(tmp, 'names.json') });
  zh.configure({ file: path.join(tmp, 'zh.json') });
  const calls = [];
  const cloud = fakeNet((url, opts) => {
    if (url !== 'https://tcb-api.tencentcloudapi.com/web?env=' + d2c.ENV) throw new Error('unexpected ' + url);
    assert.ok(/sign=/.test(opts.headers['X-TCB-App-Source']), 'every request is signed');
    const body = JSON.parse(opts.body);
    calls.push(body.action);
    if (body.action === 'auth.signInAnonymously') return { body: { uuid: 'u1', refresh_token: 'r1' } };
    if (body.action === 'auth.fetchAccessTokenWithRefreshToken') { assert.strictEqual(body.refresh_token, 'r1'); return { body: { access_token: 't1' } }; }
    assert.strictEqual(body.function_name, 'function-planner-queryplandetail');
    assert.deepStrictEqual(JSON.parse(body.request_data), { bd: '23TM', enableVariant: true });
    assert.strictEqual(body.access_token, 't1');
    return { body: { data: { response_data: JSON.stringify({ data: { _id: '23TM', game: 'd4', char: 'Rogue', deleted: false,
      title: 'S15-无限-冰灌箭雨(5-6分钟天塔150)',
      variants: [{ name: '无限弓速刷', gear: GEAR }, { name: '空的', gear: {} }] } }) } } };
  });
  const r2 = await bi.load(cloud, 'https://www.d2core.com/d4/planner?bd=23TM&lang=enUS', catalog);
  assert.deepStrictEqual(calls, ['auth.signInAnonymously', 'auth.fetchAccessTokenWithRefreshToken', 'functions.invokeFunction']);
  assert.strictEqual(r2.site, 'd2core.com');
  assert.strictEqual(r2.title, 'S15-Infinity-Cold Imbuement Rain of Arrows (5-6 min Pit 150)');
  assert.strictEqual(r2.original, 'S15-无限-冰灌箭雨(5-6分钟天塔150)', 'the Chinese title is kept for reference');
  assert.strictEqual(r2.cls, 'Rogue');
  assert.strictEqual(r2.variants.length, 1, 'a variant without gear is left out');
  assert.strictEqual(r2.variants[0].variant, 'Infinity bow speed farm');
  assert.strictEqual(r2.variants[0].original, '无限弓速刷');
  // a second import reuses the token
  calls.length = 0;
  await bi.load(cloud, 'https://www.d2core.com/d4/planner?bd=23TM', catalog);
  assert.deepStrictEqual(calls, ['functions.invokeFunction'], 'signed in once');
  console.log('ok  d2core.com: anonymous CloudBase call -> variants with English names and titles');

  // ---- stats, skills, paragon --------------------------------------------------------------------
  const db = require('../lib/d2coredb');
  assert.strictEqual(db.statText('+[{VALUE} * 100|1%|] Attack Speed', 0.1), '+10.0% Attack Speed');
  assert.strictEqual(db.statText('+[{VALUE}] Maximum Life', 1500), '+1,500 Maximum Life');
  assert.strictEqual(db.statText('x[{VALUE}*100|%|] Vulnerable Damage Multiplier', 0.28), 'x28% Vulnerable Damage Multiplier');
  assert.strictEqual(db.statText('+[{vALUE2}] Maximum Resource', 20), '+20 Maximum Resource');
  assert.strictEqual(db.statText('[{VALUE}|1|] Seconds', 2.5), '2.5 Seconds');
  assert.strictEqual(db.statText('+[{VALUE}*alert(1)] x', 2), '+? x', 'only numbers and products, nothing evaluated');
  const DB = { affix: { AttackSpeed: '+[{VALUE} * 100|1%|] Attack Speed', Tempered_Generic_LifeMax_Tier3: '+[{VALUE}] Maximum Life' },
    socket: { Item_Gem_Emerald_08: 'Horadric Emerald' },
    skills: { 7: { name: 'Rain of Arrows', icon: 914686433, cls: 'Rogue' } },
    paragon: { boards: { Paragon_Rogue_00: { name: 'Start', cls: 'Rogue', rows: Array.from({ length: 21 }, (_, r) => (r === 0 ? Array(21).fill('').map((x, c) => (c === 10 ? 'Generic_Gate' : '')).join(',') : r === 1 ? Array(21).fill('').map((x, c) => (c === 10 ? 'A' : '')).join(',') : ',,,,,,,,,,,,,,,,,,,,')) },
      Paragon_Rogue_07: { name: 'Exploit Weakness', cls: 'Rogue', rows: [] }, Paragon_Sorc_07: { name: 'Exploit Weakness', cls: 'Sorcerer', rows: [] } },
    glyphs: { ParagonGlyph_052: { name: 'Versatility' } } } };
  assert.deepStrictEqual(d2c.itemExtras({ mods: [{ name: 'AttackSpeed', value: 0.1, greater: true }, { name: 'Tempered_Generic_LifeMax_Tier3', value: 1500 }, { name: 'Unknown', value: 1 }],
    sockets: [{ key: 'Item_Gem_Emerald_08' }] }, DB),
  { stats: [{ t: '+10.0% Attack Speed', g: 1 }, { t: '+1,500 Maximum Life', tmp: 1 }], sockets: ['Horadric Emerald'] }, 'd2core: rolled stats, greater, tempered, sockets');
  const sk = d2c.skillsOf({ skill: { 7: 15, '7_9': 1, '7_8': 0 }, equipSkills: [{ key: 'rogue_rain_of_arrows', icon: 914686433, rank: 15, mods: ['Crashing Waves'] }, { key: 'rogue_dark_shroud', icon: 1, rank: 1 }] }, DB);
  assert.deepStrictEqual(sk.ranks, { 7: 15, '7_9': 1 }, 'ranks kept, unspent ones dropped');
  assert.deepStrictEqual(sk.bar.map((x) => x.name + '/' + x.id), ['Rain of Arrows/7', 'Dark Shroud/0'], 'names by icon, else from the key');
  const pg = d2c.paragonOf({ paragon: { Paragon_Rogue_01: { index: 1, x: 0, y: -1, rotate: 1, glyph: { '5_15_Generic_Socket': 'ParagonGlyph_059' }, glyphRank: { '5_15_Generic_Socket': 150 }, data: ['10_19_Generic_Normal_Dex'] },
    Paragon_Rogue_00: { index: 0, x: 0, y: 0, rotate: 0, data: ['14_10_StartNodeRogue'] }, Paragon_Rogue_09: { deleted: true, data: [] } } });
  assert.deepStrictEqual(pg.boards.map((x) => [x.k, x.x, x.y, x.rot, x.glyph, x.glyphRank, x.nodes]),
    [['Paragon_Rogue_00', 0, 0, 0, '', 0, [[14, 10]]], ['Paragon_Rogue_01', 0, -1, 1, 'ParagonGlyph_059', 150, [[10, 19]]]], 'd2core boards in order, deleted ones out');
  const d4 = d4b.itemExtras({ newStats: { Helm: ['Cooldown Reduction', null, 'Maximum Resource'] }, greaterAffixes: { Helm: [1, null, null] },
    temperingStats: { Helm: ['Maximum Life (Worldly Endurance - Defensive)'] }, newGems: { Helm: ['Emerald', null] } }, 'Helm');
  assert.deepStrictEqual(d4, { stats: [{ t: 'Cooldown Reduction', g: 1 }, { t: 'Maximum Resource' }, { t: 'Maximum Life', tmp: 1 }], sockets: ['Emerald'] }, 'd4builds: names, greater, tempering, gems');
  const dp = d4b.paragonOf({ paragon: { selectedTiles: ['startingboard_r2c11', 'exploitweakness_r1c1'],
    boards: [{ name: 'Starting Board', x: 0, y: 0, rotation: 0 }, { name: 'Exploit Weakness', x: 0, y: 1, rotation: 270, glyph: 'Versatility', glyphLevel: 100 }, { name: 'Unknown Board', x: 1, y: 1 }] } }, 'Rogue', DB);
  assert.deepStrictEqual(dp.boards.map((x) => [x.k, x.x, x.y, x.rot, x.glyph || '']), [['Paragon_Rogue_00', 0, 0, 0, ''], ['Paragon_Rogue_07', 0, -1, 3, 'ParagonGlyph_052']],
    'd4builds: boards by name of the class, y turned upside down, degrees -> quarter turns, glyph by name');
  assert.deepStrictEqual(dp.boards[0].nodes, [[1, 10], [0, 10]], 'tiles counted from 1; the gate next to a taken tile counts as taken');
  const tree = db.slimTree({ Rogue: { nodes: [{ id: 1, pos: { x: 0, y: 0 }, root: 1 }, { id: 2, pos: { x: 10.4, y: 5 }, root: 2 },
    { id: 3, pos: { x: 20, y: 0 }, reward: { type: 0, id: 7, ranks: 15 } }, { id: 4, pos: { x: 30, y: 0 }, reward: { type: 1, id: 7, mod: 9, ranks: 3 }, connections: [{ node1: 2, node2: 3, corners: [{ x: 25, y: 1 }] }] }],
  connections: [{ node1: 0, node2: 1 }, { node1: 1, node2: 2 }, { node1: 2, node2: 1 }] } });
  assert.deepStrictEqual(tree.Rogue.nodes.map((n) => n.k), ['root', 'link', 'skill', 'mod'], 'root 1 starts a branch, root 2 is a crossing');
  assert.deepStrictEqual(tree.Rogue.links, [[0, 1], [1, 2], [2, 3, 25, 1]], 'links from tree and nodes merged, no doubles, corners kept');
  console.log('ok  stats as text, skills, paragon (d2core + d4builds onto the same boards), skill tree');

  // ---- saved with the build ---------------------------------------------------------------------
  const builds = require('../lib/builds');
  const saved = builds.cleanBuild({ name: 'x', cls: 'Rogue',
    slots: { Helm: { item: "Leoric's Crown", stats: [{ t: '+10.0% Attack Speed', g: 1, junk: 5 }], sockets: ['Horadric Emerald'] } },
    source: { site: 'd2core.com', url: 'https://www.d2core.com/d4/planner?bd=23TM', title: 'S15' }, skills: sk, paragon: pg });
  assert.deepStrictEqual(saved.slots.Helm, { item: "Leoric's Crown", stats: [{ t: '+10.0% Attack Speed', g: 1 }], sockets: ['Horadric Emerald'] });
  assert.ok(saved.source && saved.skills.ranks['7_9'] === 1 && saved.paragon.boards.length === 2, 'source, skills and paragon kept');
  assert.strictEqual(builds.cleanBuild({ name: 'y', source: { url: 'https://evil.example/x' } }).source, undefined, 'only links to the three build sites');
  const code = builds.toCode(saved);
  const back = builds.parseImport(code)[0];
  assert.ok(!back.slots.Helm.stats && back.source.url === saved.source.url, 'a build code stays short: gear + link back');
  console.log('ok  stats, link, skills and paragon saved with the build');

  // ---- runewords show their runes as the source -------------------------------------------------
  const farm = require('../lib/farm');
  const fc = path.join(tmp, 'farm.json');
  fs.writeFileSync(fc, JSON.stringify({ version: 1, fetchedAt: Date.now(), data: {
    items: [{ kind: 'item', id: '1', name: 'Enigma', n: 'enigma', slot: 'Chest Armor', type: 'Chest Armor', rarity: 'Unique', cls: 'All' }],
    aspects: [{ kind: 'aspect', id: '2', name: 'Aspect of X', n: 'aspect of x', short: 'X', cat: 'Offensive', cls: 'All', slots: ['Ring'], dungeon: 'Maugan&#x27;s Works', region: 'Kehjistan' }] } }));
  farm.configure({ cacheFile: fc, tipFile: path.join(tmp, 'tips.json') });
  const fcat = farm.catalog({ sections: [] }, { tables: [{ cols: ['Runes', 'Base Item', 'Runecraft'], rows: [['‍Jah + ‍Ith + Ber', 'Chest Armor', 'Enigma']] }] });
  assert.strictEqual(fcat.items[0].src[0].recipe, 'Jah + Ith + Ber', 'runes from the crafting sheet, without zero-width joiners');
  assert.strictEqual(fcat.aspects[0].src[0].src, "Dungeon: Maugan's Works", 'entities in old caches decoded');
  console.log('ok  runeword recipes and dungeon names in the farm list');

  // ---- maxroll: stats by affix id, skill tree by node id, paragon, charms -------------------------
  const MDB = {
    affix: { S04_Life: '+[{VALUE}] Maximum Life', S04_Resource_Max_AllClasses: '+[{vALUE2}] Maximum Resource', Tempered_Generic_LifeMax_Tier3: '+[{VALUE}] Maximum Life',
      CharmRes: '+[{VALUE2}] Cold Resistance' },
    affixId: { 1829592: 'S04_Life', 1834105: 'S04_Resource_Max_AllClasses', 1862295: 'Tempered_Generic_LifeMax_Tier3', 2546083: 'CharmRes' },
    socket: { S15_SoulSplinter_Andariel_04: 'Abyssal Splinter of Anguish' },
    skills: { 7: { name: 'Rain of Arrows', icon: 11, mods: { 9: { name: 'Crashing Waves' } } } },
    tree: { Rogue: { nodes: [{ k: 'skill', id: 7, nid: 245, pw: 'Rogue_RainofArrows' }, { k: 'mod', id: 7, mod: 9, nid: 23 }, { k: 'link', nid: 3 }], links: [] } },
    paragon: { boards: {}, nodes: {}, glyphs: { ParagonGlyph_059: { name: 'Devious' } } },
    talisman: {
      items: {
        Talisman_Seal_MythicUnique_03: { name: 'Seal of the Diamond Mind', q: 'Mythic', type: 'HoradricSeal', set: '', d: ['Reduces the number of Charms needed for Set bonuses by 1 (to a minimum of 2).'] },
        Talisman_Charm_Set_Rogue_05_01: { name: 'Linta of the Sightless', q: 'Set', type: 'Charm', set: 'Talisman_Rogue_05', d: [] },
        Talisman_Charm_Set_Rogue_05_02: { name: 'Phoba of the Sightless', q: 'Set', type: 'Charm', set: 'Talisman_Rogue_05', d: [] },
      },
      sets: { Talisman_Rogue_05: { name: 'Legacy of the Sightless', bonuses: [{ n: 2, d: ['two'] }, { n: 3, d: ['three'] }, { n: 5, d: ['five'] }] } },
      affix: {},
    },
  };
  assert.strictEqual(db.statText('+[{vALUE2}] Maximum Resource', [30]), '+30 Maximum Resource', 'VALUE2 with one roll takes it');
  assert.strictEqual(db.statText('+[{VALUE1}] to [{VALUE2}]', [3, 7]), '+3 to 7', 'two rolls');
  const mx = mb.toBuild({ name: 'Endgame', items: { 4: 0, 20: 1, 21: 2, 22: 3 }, skillBar: ['Rogue_RainofArrows', 'Rogue_Unknown'],
    skillTree: { steps: [{ data: { 245: 15, 23: 1, 3: 1, 999: 4 } }] },
    paragon: { steps: [{ data: [{ id: 'Paragon_Rogue_00', nodes: { 10: 1, 31: 1, 52: 0 }, rotation: 0, position: { x: 0, y: 0 }, glyph: 'Rare_059_Dexterity_Main', glyphLevel: 100 },
      { id: 'Paragon_Rogue_03', nodes: { 441: 1 }, rotation: 7, position: { x: 1, y: -1 } }] }] } },
  [{ id: 'Helm_Unique_Generic_005', explicits: [{ nid: 1829592, values: [1812.5] }, { nid: 1834105, values: [30], greater: true }, { nid: 42, values: [1] }],
    tempered: [{ nid: 1862295, values: [2250], greater: true }], sockets: ['S15_SoulSplinter_Andariel_04'] },
  { id: 'Talisman_Seal_MythicUnique_03' }, { id: 'Talisman_Charm_Set_Rogue_05_01', explicits: [{ nid: 2546083, values: [3000] }] }, { id: 'Talisman_Charm_Set_Rogue_05_02' }],
  { nameOf: (id) => ({ Helm_Unique_Generic_005: "Leoric's Crown" })[id] || '', aspectName: () => '', glyphName: (id) => ({ Rare_059_Dexterity_Main: 'Devious' })[id] || '', db: MDB },
  'Cold RoA', 'Rogue');
  assert.deepStrictEqual(mx.slots.Helm, { item: "Leoric's Crown",
    stats: [{ t: '+1,812.5 Maximum Life' }, { t: '+30 Maximum Resource', g: 1 }, { t: '+2,250 Maximum Life', g: 1, tmp: 1 }], sockets: ['Abyssal Splinter of Anguish'] },
  'maxroll: rolls by affix id, unknown ids left out, tempering, sockets');
  assert.deepStrictEqual(mx.skills.ranks, { 7: 15, '7_9': 1 }, 'maxroll: node ids -> the same keys d2core uses');
  assert.deepStrictEqual(mx.skills.bar.map((x) => [x.name, x.rank, x.mods.join(',')]), [['Rain of Arrows', 15, 'Crashing Waves'], ['Unknown', 0, '']], 'skill bar with rank and taken modifiers');
  assert.deepStrictEqual(mx.paragon.boards.map((x) => [x.k, x.x, x.y, x.rot, x.glyph || '', x.nodes]),
    [['Paragon_Rogue_00', 0, 0, 0, 'ParagonGlyph_059', [[0, 10], [1, 10]]], ['Paragon_Rogue_03', 1, -1, 3, '', [[21, 0]]]], 'maxroll paragon: index -> row/column, turns, glyph by name');
  assert.strictEqual(mx.charms.seal.name, 'Seal of the Diamond Mind');
  assert.deepStrictEqual(mx.charms.list.map((c) => [c.name, c.set, c.stats.map((s) => s.t).join()]),
    [['Linta of the Sightless', 'Legacy of the Sightless', '+3,000 Cold Resistance'], ['Phoba of the Sightless', 'Legacy of the Sightless', '']]);
  assert.deepStrictEqual(mx.charms.sets[0].bonuses.map((b) => b.on), [true, true, false], 'two charms + the seal (one fewer needed): the 3 bonus is on, the 5 is not');
  const named = db.charmsOf(MDB, [{ name: 'Linta of the Sightless', stats: [{ t: 'Maximum Resource' }] }, { name: 'Some Unknown Charm' }]);
  assert.deepStrictEqual(named.list.map((c) => [c.name, c.q]), [['Linta of the Sightless', 'Set'], ['Some Unknown Charm', '']], 'd4builds: charms by name, unknown ones kept by name');
  console.log('ok  maxroll: rolled stats, skill tree, paragon, charms; set bonuses with the seal');

  // ---- which site ----------------------------------------------------------------------------
  assert.strictEqual(bi.siteOf('https://maxroll.gg/d4/planner/uyz7y00t#4'), 'maxroll.gg');
  assert.strictEqual(bi.siteOf('https://d4builds.gg/builds/9b97893d-ff28-403d-9b80-e30a22cf3163/?var=1'), 'd4builds.gg');
  assert.strictEqual(bi.siteOf('https://www.d2core.com/d4/planner?bd=23TM'), 'd2core.com');
  assert.strictEqual(bi.siteOf('https://example.com'), '');
  await assert.rejects(bi.load(cloud, 'https://example.com', catalog), /maxroll\.gg, d4builds\.gg, infinitybuilds\.gg or d2core\.com/);
  console.log('ok  links go to the right site');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
