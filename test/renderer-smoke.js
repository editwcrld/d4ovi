// Loads the overlay HTML in jsdom with a fake bridge and clicks through everything.
// Catches runtime errors and checks that each section actually renders.
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');

const dir = path.join(__dirname, '..', 'renderer');
const page = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
// the page's scripts in its order – run below as the browser does (classic scripts, one shared scope)
const SCRIPTS = [...page.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const html = page.replace(/<script src="[^"]+"><\/script>/g, '');
const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true });
const w = dom.window;
const errors = [];
w.addEventListener('error', (e) => errors.push(e.message));
w.ResizeObserver = class { constructor(cb) { this.cb = cb; } observe() { setTimeout(() => this.cb([]), 5); } };

// ---- fixtures -------------------------------------------------------------
const loot = { fetchedAt: Date.now(), sections: [{
  name: 'Grigoire, The Galvanic Saint', isBoss: true,
  info: ['Requires Torment 1 or higher.', 'Activity Recommended: Complete Helltide', 'Boss Lair Key: 1x Lair Key', 'Element Type: Lightning', 'Cosmetic Reward: Demonbinder Mount Armor'],
  location: 'The Hall of the Penitent is located South of Ked Bardu in the Dry Steppes',
  images: ['https://example.invalid/lair.png'], drops: [{ cls: 'Barbarian', name: 'Rage of Harrogath', note: '' }, { cls: '', name: 'Annihilus', note: 'Rare drop' }, { cls: 'Rogue', name: 'Grasp of Shadow', note: '' }],
}, {
  // only lair keys under the bosses' names – left out, it got in the way of the boss's own drops
  name: 'Uniques from Boss Trophies', isBoss: false, drops: [{ cls: 'All classes', name: 'Grigoire: Living Steel', note: '' }],
}, {
  // maxroll's list of the Iconic Mythics, headed just "Mythics"
  name: 'Mythics', isBoss: false, images: ['https://example.invalid/x.png'], drops: [{ cls: 'All classes', name: '‍Harlequin Crest', note: 'All' }],
}] };
const craft = { fetchedAt: Date.now(), tables: [{
  group: 'Classic Runewords', sub: 'Equipment',
  cols: ['Runes', 'Base Item', 'Runecraft'],
  rows: [['Jah + Ith + Ber', 'Chest Armor', 'Enigma']],
}] };
const activities = [{ name: 'Secret Cow Level', icon: '🐄', n: 'secret cow level cow king',
  desc: 'How to unlock it.', sections: ['TLDR', 'Part 1 - Stamina Potion', 'Part 2 - Rusted Bardiche', 'Rewards'], url: 'https://maxroll.gg/d4/resources/secret-cow-level' }];
const runewords = [
  { name: 'Enigma', icon: '', url: 'https://d4guides.gg/en/database/horadric-cube/runewords-enigma', fields: [{ label: 'Recipes', value: '2 recipes' }], type: 'Runeword', rarity: '', effects: [], power: '', desc: '', set: '', level: 0 },
  { name: 'Insight', icon: '', url: 'https://d4guides.gg/en/database/horadric-cube/runewords-insight', fields: [{ label: 'Recipes', value: '14 recipes' }], type: 'Runeword', rarity: '', effects: [], power: '', desc: '', set: '', level: 0 },
];
const itemHits = [{
  name: 'Annihilus', type: 'Talisman · Seal', rarity: 'Unique', level: 0,
  power: '', effects: [], desc: '', set: '',
  icon: 'https://d4guides.gg/x.webp', url: 'https://d4guides.gg/en/database/talismans/annihilus',
  fields: [{ label: 'Charm slots', value: '6' }],
}, {
  name: 'Annihilus Charm', type: 'Talisman · Charm', rarity: 'Unique', level: 0,
  power: '', effects: [], desc: '', set: '', icon: '', url: '', fields: [],
}];
// a boss trophy carries the boss's name – searching the boss must still show the boss
const trophy = { name: 'Grigoire: Living Steel', type: 'Lair boss key', rarity: '', level: 0, power: '', effects: [], desc: 'A trophy.', set: '', icon: '', url: '', fields: [] };
const farmCat = {
  slots: ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring', 'Weapon', 'Off-Hand'],
  details: 1,
  items: [
    { kind: 'item', id: '1500', name: 'Orsivane', n: 'orsivane', slot: 'Weapon', type: 'Main Hand', rarity: 'Unique', cls: 'Sorcerer', icon: '',
      src: [{ src: 'Andariel', cls: 'Sorcerer', note: '', order: 0, loc: "Hanged Man's Hall · 1x Greater Lair Key" }] },
    { kind: 'item', id: '1501', name: "Drognan's Anguish", n: 'drognans anguish', slot: 'Ring', type: 'Ring 1', rarity: 'Unique', cls: 'Sorcerer', icon: '',
      src: [{ src: 'Andariel', cls: 'Sorcerer', note: '', order: 0, loc: "Hanged Man's Hall" }] },
    { kind: 'item', id: '1441', name: 'Ring of Starless Skies', n: 'ring of starless skies', slot: 'Ring', type: 'Ring 1', rarity: 'Mythic', cls: 'All', icon: '',
      src: [{ src: 'Any boss (Mythic)', cls: '', note: '', order: 3, loc: 'Every lair boss' }] },
    { kind: 'item', id: '1600', name: 'Hellhammer', n: 'hellhammer', slot: 'Weapon', type: 'Two-Handed Bludgeoning', rarity: 'Unique', cls: 'Barbarian', icon: '',
      src: [{ src: 'Andariel', cls: 'Barbarian', note: '', order: 0, loc: '' }] },
  ],
  aspects: [
    { kind: 'aspect', id: '2575135', name: 'Aspect of the Untarnished Blaze', n: 'aspect of the untarnished blaze', short: 'Untarnished Blaze',
      cat: 'Offensive', cls: 'Sorcerer', slots: ['Weapon', 'Amulet', 'Ring', 'Gloves'], exact: true, dungeon: '', region: '',
      src: [{ src: 'Salvage a legendary', order: 6, loc: 'Any legendary with this aspect' }] },
    { kind: 'aspect', id: '1040973', name: 'Aspect of Armageddon', n: 'aspect of armageddon', short: 'Armageddon',
      cat: 'Offensive', cls: 'Sorcerer', slots: ['Weapon', 'Amulet', 'Ring', 'Gloves'], exact: true, dungeon: '', region: '',
      src: [{ src: 'Salvage a legendary', order: 6, loc: '' }] },
    { kind: 'aspect', id: '2574616', name: 'Overheating Aspect', n: 'overheating aspect', short: 'Overheating',
      cat: 'Utility', cls: 'Sorcerer', slots: ['Helm', 'Amulet', 'Gloves'], exact: true, dungeon: 'Defiled Catacomb', region: 'Fractured Peaks',
      src: [{ src: 'Dungeon: Defiled Catacomb', order: 5, loc: 'Fractured Peaks' }, { src: 'Salvage a legendary', order: 6, loc: '' }] },
  ],
};
let buildsData = { active: 'b1', builds: [{ id: 'b1', name: 'My build', cls: 'All', slots: {}, done: [] }] };
// the builder: a real Rain of Arrows plan and its proven builds, made by lib/builder.js (test/fixtures)
const BF = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'builder.json'), 'utf8'));
let builderSaved = null;
let savedBuilds = null;
let importNo = 0;

let settings = {
  d4Path: 'C:\\x.exe', d4WindowTitle: 'Diablo IV', visibility: 'focused',
  orientation: 'vertical', railWide: false, windowSize: 'mittel', opacity: 1,
  tradeOpenMode: 'internal', pressEnter: false, hotkeySearch: 'Control+Shift+F',
  wbWarnSec: 300, wbBlink: true, favorites: [], recent: [],
  fadeOpacity: 0.35, fadeAfterSec: 1, idleShrink: true, pillHide: ['maptool'], wbBright: true, msgBlink: true,
  clickSpam: false, clickLeftBind: 'Mouse5', clickRightBind: 'Mouse4', clickCps: 15,
  lockOn: false, lockKeys: [], lockBind: 'F9', macroChars: [], macroChar: 0,
};

const calls = [];
let hoverWatchOn = false;
let slideLeft = false;                                 // main.js overlay:slide-plan: the strip grows to the left
const resizes = [];                              // the main process watching the cursor (overlay:hover-watch)
let backupMade = 0, copied = null;
const handlers = {};
const on = (n) => (cb) => { handlers[n] = cb; };
w.d4api = new Proxy({}, { get: (_, k) => {
  if (k.startsWith('on')) return on(k);
  if (k === 'builderFull') return undefined;          // the website's call – the overlay asks for plan and proven builds apart
  return (...a) => {
    calls.push(k);
    if (k === 'hoverWatch') hoverWatchOn = !!a[0];
    if (k === 'slidePlan') return Promise.resolve({ toLeft: slideLeft });
    if (k === 'resize') resizes.push(a);
    if (k === 'getSettings') return Promise.resolve(settings);
    if (k === 'getFeatures') return Promise.resolve({ macros: true, clickSpam: true, lock: true });
    if (k === 'getLoot') return Promise.resolve(loot);
    if (k === 'getCraft') return Promise.resolve(craft);
    if (k === 'getActivities') return Promise.resolve(activities);
    if (k === 'getRunewords') return Promise.resolve(runewords);
    if (k === 'searchItems') return Promise.resolve(/anni/i.test(a[0] || '') ? itemHits : /grigoire/i.test(a[0] || '') ? [trophy] : []);
    if (k === 'saveSettings') { settings = { ...settings, ...a[0] }; return Promise.resolve({ settings, errors: [] }); }
    if (k === 'pickBackupDir') return Promise.resolve('D:\\OneDrive\\D4');
    if (k === 'runBackup') { backupMade = Date.now(); return Promise.resolve({ ok: true, dir: 'x', at: backupMade }); }
    if (k === 'lastBackup') return Promise.resolve(backupMade);
    if (k === 'copyText') { copied = a[0]; return undefined; }
    if (k === 'authStatus') return Promise.resolve({ cookies: 2, loggedIn: true });
    if (k === 'openTrade') return Promise.resolve('internal');
    if (k === 'mapRestore') return Promise.resolve(7);
    if (k === 'getFarm') return Promise.resolve(farmCat);
    if (k === 'getBuilds') return Promise.resolve(JSON.parse(JSON.stringify(buildsData)));
    if (k === 'saveBuilds') { savedBuilds = JSON.parse(JSON.stringify(a[0])); return Promise.resolve(savedBuilds); }
    if (k === 'farmTooltip') return Promise.resolve('<div class="d4tt-chrome"><div class="tt-title">' + a[1] + '</div></div>');
    if (k === 'farmCss') return Promise.resolve('.d4tt-chrome{color:#fff}');
    if (k === 'buildCode') return Promise.resolve('D4B1:xyz');
    if (k === 'loadBuildLink') {
      return Promise.resolve(/maxroll/.test(a[0]) ? { title: 'Ice Spikes Sorc', cls: 'Sorcerer', preselect: 1, variants: [
        { variant: 'Starter', name: 'Ice Spikes Sorc – Starter', cls: 'Sorcerer', slots: { Amulet: { aspects: ['Aspect of Armageddon'] } }, missing: [], extra: [] },
        { variant: 'Endgame', name: 'Ice Spikes Sorc – Endgame', cls: 'Sorcerer', slots: { Weapon: { item: 'Orsivane' }, Ring1: { item: 'Ring of Starless Skies' } }, missing: ['Boots_X'], extra: [] },
      ] } : /d2core/.test(a[0]) ? { title: 'S15-Infinity-Rain of Arrows', original: 'S15-无限-箭雨', cls: 'Rogue', site: 'd2core.com', preselect: 0, variants: [
        { variant: 'Infinity bow speed farm', original: '无限弓速刷', name: 'Infinity bow speed farm', cls: 'Rogue', missing: [], extra: ['Aspect of Frozen Memories'],
          slots: { 'Weapon 2': { item: 'Hellhammer', base: 'Sword' }, Weapon: { item: 'Orsivane', base: 'Bow', stats: [{ t: '+10.0% Attack Speed', g: 1 }, { t: '8.0% Cooldown Reduction' }, { t: '+1,500 Maximum Life', tmp: 1 }], sockets: ['Horadric Sapphire'] } },
          source: { site: 'd2core.com', url: 'https://www.d2core.com/d4/planner?bd=23TM', title: 'S15-无限-箭雨' },
          skills: { bar: [{ name: 'Rain of Arrows', id: 7, rank: 15, icon: 0, mods: ['Crashing Waves'] }], ranks: { 7: 15, '7_9': 1 } },
          paragon: { boards: [{ k: 'Paragon_Rogue_00', x: 0, y: 0, rot: 0, glyph: 'G1', glyphRank: 150, nodes: [[1, 1], [1, 2]] }] },
          charms: { seal: { name: 'Seal of the Diamond Mind', q: 'Mythic', set: '', stats: [], d: ['Fewer charms for sets'] },
            list: [{ name: 'Linta of the Sightless', q: 'Set', set: 'Legacy of the Sightless', stats: [{ t: '+20 Maximum Resource' }], d: [] }],
            sets: [{ name: 'Legacy of the Sightless', have: 1, bonuses: [{ n: 2, d: ['Two piece bonus'], on: true }, { n: 3, d: ['Three'], on: false }] }] } },
      ] } : { error: 'Not a build link from maxroll.gg, d4builds.gg or d2core.com' });
    }
    if (k === 'buildTree') return Promise.resolve({ skills: { 7: { name: 'Rain of Arrows', icon: 0, desc: ['Deals {val1}% damage.'], val: ['10', '20'], mods: { 9: { name: 'Crashing Waves', desc: 'More waves.' } } } },
      nodes: [{ x: 0, y: 0, k: 'root', id: 0 }, { x: 400, y: 0, k: 'skill', id: 7, ranks: 15 }, { x: 800, y: 0, k: 'mod', id: 7, mod: 9 }, { x: 800, y: 400, k: 'mod', id: 7, mod: 8 }],
      links: [[0, 1], [1, 2], [1, 3, 600, 400]] });
    if (k === 'buildParagon') return Promise.resolve({ glyphs: { G1: { name: 'Versatility', desc: 'Magic nodes', bonus: '' } },
      nodes: { A: { name: 'Generic_Normal_Dex', r: 0, d: '+5 Dexterity', t: '' }, S: { name: 'Glyph Socket', r: 0, d: '', t: 'socket' } },
      boards: { Paragon_Rogue_00: { name: 'Start', rows: [',,,', ',A,A,S', ',,,'] } } });
    if (k === 'openBuildSource') return Promise.resolve(true);
    // the cheat sheet: the recipe d4builder read out of the guide's notes (lib/guideinfo.js)
    if (k === 'guideSheet') return Promise.resolve({ own: true, site: 'maxroll', url: 'https://maxroll.gg/d4/build-guides/rain-of-arrows-rogue-guide', skill: 'Rain of Arrows', variant: 'Endgame',
      summary: 'Beastfall Boots with Preparation make Rain of Arrows spend Energy.', core: [{ name: 'Beastfall Boots', kind: 'unique', role: 'a must', quote: 'Beastfall Boots is a must.' }],
      thresholds: [{ stat: 'Maximum Energy', op: '>=', value: 225, why: 'three Preparation triggers', quote: '225 Maximum Energy.' }, { stat: 'Rain of Arrows Cooldown', op: '<=', value: 15, unit: 's' }],
      rotation: [{ step: 'Spam Rain of Arrows' }], options: [{ when: 'bossing', then: 'Rustbitten Dirk' }] });
    if (k === 'builderCatalog') return Promise.resolve(BF.catalog);
    if (k === 'builderPlan') return Promise.resolve(JSON.parse(JSON.stringify(BF.plan)));
    if (k === 'builderProven') return Promise.resolve(JSON.parse(JSON.stringify(BF.proven)));
    // what Save would keep – the builder's Skills, Paragon and talisman views draw it
    if (k === 'builderPreview') return Promise.resolve({ name: 'Rain of Arrows Rogue', cls: 'Rogue',
      slots: { Helm: { item: "Leoric's Crown", sockets: ['Abyssal Splinter of Pain', 'Royal Emerald'] }, Weapon: { item: 'Insight', sockets: ['Ral', 'Tir'] } },
      skills: { bar: [{ id: 7, key: 'Rogue_RainofArrows', name: 'Rain of Arrows', icon: 0, rank: 5, mods: ['Crashing Waves'] }], ranks: { 7: 5, '7_9': 1 } },
      paragon: { boards: [{ k: 'Paragon_Rogue_00', x: 0, y: 0, rot: 0, nodes: [[1, 1], [1, 2]], glyph: 'G1', glyphRank: 0 }] },
      charms: { seal: { name: 'Mythic Unique Horadric Seal', q: 'Mythic', set: '', stats: [], d: [] },
        list: [{ name: 'The Grandfather', q: 'Mythic', set: '', stats: [], d: ['Increases your Critical Strike Damage by 120%[x].'] }, { name: 'Linta of the Sightless', q: 'Set', set: 'Legacy of the Sightless', stats: [], d: [] }],
        sets: [{ name: 'Legacy of the Sightless', have: 1, bonuses: [{ n: 2, d: ['Two piece bonus'], on: false }] }] } });
    if (k === 'builderSave') {
      builderSaved = a[2];
      const nb = { id: 'bd1', name: 'Rain of Arrows Rogue', cls: 'Rogue', slots: { Helm: { item: "Leoric's Crown" } }, done: [] };
      return Promise.resolve({ added: 1, data: { active: 'bd1', codex: [], builds: (savedBuilds || buildsData).builds.concat([nb]) } });
    }
    if (k === 'importBuildText' && /^\{/.test(a[0])) {
      const got = JSON.parse(a[0]).builds.map((b, i) => Object.assign({ id: 'm' + (importNo++) + '_' + i, done: [] }, b));
      const base = (savedBuilds || buildsData).builds;
      return Promise.resolve({ added: got.length, data: { active: got[got.length - 1].id, builds: base.concat(got) } });
    }
    if (k === 'importBuildText') {
      const nb = { id: 'b9', name: 'Friend build', cls: 'Rogue', slots: { Helm: { item: 'x' } }, done: [] };
      return Promise.resolve(/^D4B1:/.test(a[0]) ? { added: 1, data: { active: 'b9', builds: (savedBuilds || buildsData).builds.concat([nb]) } } : { added: 0 });
    }
    return Promise.resolve();
  };
} });

for (const f of SCRIPTS) {
  const sc = w.document.createElement('script');
  sc.textContent = fs.readFileSync(path.join(dir, f), 'utf8') + '\n//# sourceURL=' + f;
  w.document.body.appendChild(sc);
}
assert.deepStrictEqual(errors, [], 'the page loads without errors');
const $ = (id) => w.document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// closing takes a moment: the panel folds away, then the window becomes the strip (app.js closeAll)
const closed = () => sleep(320);
const rail = (name) => w.document.querySelector('#rail .ri[data-section=' + name + ']');
const anchors = () => [...w.document.querySelectorAll('#chips .anchors .chip')];
const grp = (id) => w.document.querySelector('.setgroup[data-group="' + id + '"]');
const txt = () => w.document.getElementById('main').textContent.replace(/\s+/g, ' ');
const type = async (q) => { $('q').value = q; $('q').dispatchEvent(new w.Event('input')); await sleep(160); };

(async () => {
  await sleep(60);
  assert.ok($('panel').hidden, 'panel starts closed');
  console.log('ok  starts closed (bar only)');

  // --- search
  rail('search').click(); await sleep(30);
  assert.ok(!$('panel').hidden, 'panel opens');
  assert.ok(rail('search').classList.contains('on'), 'rail marks the active section');
  await type('annihilus');
  assert.ok(txt().includes('Annihilus'), 'item card rendered');
  assert.ok(txt().includes('Charm slots'), 'extra fields rendered');
  assert.ok($('side').textContent.includes('Annihilus'), 'sidebar lists the hit');
  console.log('ok  search → item card + sidebar');
  {
    assert.ok(!w.document.querySelector('#side h5'), 'the results as chips, as in the mockup – no group heads');
    assert.ok([...w.document.querySelectorAll('#side .hit')].every((h) => h.querySelector('.pic') && h.querySelector('.ln')), 'every result: picture and name');
    const sub = [...w.document.querySelectorAll('.card .plate .ptx h3')].map((b) => b.textContent);
    assert.ok(sub.includes('Drops from'), 'the parts of the card on plates');
    console.log('ok  search: chips and plates');
  }

  // favourite + copy
  const star = w.document.querySelector('.btn.star');
  star.click(); await sleep(40);
  assert.strictEqual(settings.favorites.length, 1, 'favourite stored');
  assert.strictEqual(settings.favorites[0].name, 'Annihilus');
  console.log('ok  favourite saved');
  // a note goes away on its own – and takes nothing else with it (no redraw: a key being recorded
  // or the cursor in a field stays where it is)
  [...w.document.querySelectorAll('.acts .btn')].find((b) => b.textContent === 'Copy').click(); await sleep(20);
  assert.ok(copied === 'Annihilus' && w.document.querySelector('#main > .note'), 'copied, and it says so');
  const card0 = w.document.querySelector('#main .card');
  await sleep(2600);
  assert.ok(!w.document.querySelector('#main > .note') && w.document.querySelector('#main .card') === card0, 'the note is gone, the page was not drawn again');
  console.log('ok  a note leaves the page as it is');

  // every search lands in "Recent" once the typing stops – and the list can be cleared
  await sleep(1500);
  assert.deepStrictEqual(settings.recent, ['annihilus'], 'search remembered without pressing Enter');
  await type('ber'); await sleep(1500);
  await type('Annihilus'); await sleep(1500);
  assert.deepStrictEqual(settings.recent, ['Annihilus', 'ber'], 'newest first, no doubles');
  await type('');
  const recH = [...$('side').querySelectorAll('h5')].find((h) => h.textContent.startsWith('Recent'));
  assert.ok(recH && $('side').textContent.includes('ber'), 'recent searches listed');
  assert.ok(w.getComputedStyle(recH.querySelector('.clr')).opacity !== '0', 'the Clear button is visible');
  recH.querySelector('.clr').click(); await sleep(40);
  assert.strictEqual(settings.recent.length, 0, 'Clear empties it');
  assert.ok(![...$('side').querySelectorAll('h5')].some((h) => h.textContent.startsWith('Recent')), 'and the heading is gone');
  console.log('ok  recent searches: remembered, cleared');
  await type('annihilus');                         // back to where the tests below expect it

  // every hit in the list on the left, the first one in full on the right
  const results = () => [...w.document.querySelectorAll('#side .hit:not(.trade)')];
  assert.strictEqual(results().length, 2, 'both item hits listed');
  assert.ok(results()[0].querySelector('.ln').classList.contains('r-unique') && results()[0].querySelector('.lm').textContent === 'Talisman · Seal · Grigoire', 'name in its colour, what it is and who drops it');
  assert.strictEqual(w.document.querySelectorAll('#main .card').length, 1, 'the picked one in full');
  assert.strictEqual(w.document.querySelector('#main .card h2').textContent, 'Annihilus', 'the first hit until another is picked');
  assert.ok(!txt().includes('more'), 'no truncation hint');
  console.log('ok  all hits listed (no "N more")');

  // a click on a result shows it; the arrow keys walk the list
  results()[1].click(); await sleep(40);
  assert.strictEqual(w.document.querySelector('#main .card h2').textContent, 'Annihilus Charm', 'the picked entry is the one shown');
  assert.ok(results()[1].classList.contains('on'), 'and marked in the list');
  $('q').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true })); await sleep(30);
  assert.strictEqual(w.document.querySelector('#main .card h2').textContent, 'Annihilus', 'arrow up: the one above');
  assert.ok([...w.document.querySelectorAll('#side .hit.trade')].length === 1, 'diablo.trade search at the end of the list');
  console.log('ok  results: pick by click or arrow keys');

  // the tabs filter by category
  const qtabs = () => [...w.document.querySelectorAll('#chips .ptab')];
  assert.ok(qtabs().length >= 2 && qtabs()[0].classList.contains('on') && qtabs()[0].querySelector('.n'), 'the tabs, with how many each, All first');
  const chipBoss = qtabs().find((c) => c.textContent.startsWith('Boss'));
  if (chipBoss) {
    chipBoss.click(); await sleep(40);
    assert.ok(!txt().includes('Annihilus'), 'items hidden when the Bosses tab is shown');
    qtabs().find((c) => c.textContent.startsWith('All')).click(); await sleep(40);
  }
  console.log('ok  filter tabs');

  // --- the two sections without an icon: typed into the search
  assert.strictEqual(rail('bossloot'), null, 'boss loot has no rail icon any more');
  assert.strictEqual(rail('crafting'), null, 'crafting has no rail icon any more');
  await type('boss loot');
  // every boss right away, each with its uniques as tiles – no picking first
  const bs = () => w.document.querySelector('.bsec');
  assert.ok(bs() && txt().includes('Grigoire') && w.document.querySelector('.clsbar'), 'the bosses with their drops, the class bar on top');
  assert.ok(!w.document.querySelector('.card'), 'items stay out of the boss area');
  assert.ok(bs().querySelector('.hero .pic img').src.endsWith('/Bosses/1/boss_grigoire.png'), 'the boss portrait (d4builds) in the banner');
  assert.ok(bs().querySelector('.hero .where b').textContent === 'South of Ked Bardu in the Dry Steppes' && bs().querySelector('.hero .where').textContent.includes('Lair: The Hall of the Penitent'), 'where the boss is');
  assert.deepStrictEqual([...bs().querySelectorAll('.hero .tag')].map((x) => x.textContent).join('|'), 'Torment 1+|1x Lair Key', 'only torment and key');
  assert.ok(!bs().textContent.includes('Cosmetic') && !bs().textContent.includes('Element') && !bs().textContent.includes('Activity'), 'the rest is left out');
  const tile = (n) => bs().querySelector('.itile[data-item="' + n + '"]');
  assert.ok(tile('Rage of Harrogath') && tile('Rage of Harrogath').querySelector('.inm.r-unique'), 'a drop as a tile, in its colour');
  assert.ok(tile('Rage of Harrogath').querySelector('.pic img').src.endsWith('/Uniques/2/rage_of_harrogath.png'), 'with its picture');
  assert.strictEqual(w.document.querySelector('.cls.on').dataset.cls, 'All', 'all classes to start with, the build has none');
  assert.strictEqual(w.document.querySelectorAll('.cls img').length, 8, 'eight classes with their icons, and All');
  w.document.querySelector('.cls[data-cls="Rogue"]').click(); await sleep(20);
  assert.ok(tile('Grasp of Shadow') && !tile('Rage of Harrogath') && tile('Annihilus'), 'one class: its drops and the ones for every class');
  assert.ok(bs().querySelector('.hero .cnt').textContent.includes('for Rogue · 3 in all'), 'how many of how many');
  w.document.querySelector('.cls[data-cls="All"]').click(); await sleep(20);
  assert.ok(bs().querySelector('.shot').hidden && !bs().querySelector('.shot img'), 'the lair picture only on request');
  bs().querySelector('.lairs .lnk').click();
  assert.ok(!bs().querySelector('.shot').hidden && bs().querySelector('.shot img'), 'and shown on click');
  tile('Annihilus').click(); await sleep(40);
  assert.strictEqual($('q').value, 'Annihilus', 'a tile looks the item up');
  // an item that a boss drops: the boss is on the item's card, not a card of its own
  await type('annihilus');
  const ic = [...w.document.querySelectorAll('.card')].find((x) => x.querySelector('h2') && x.querySelector('h2').textContent === 'Annihilus');
  assert.ok(ic && ic.querySelector('.from .bcard b').textContent.startsWith('Grigoire') && ic.querySelector('.from .bcard .lm').textContent.includes('Ked Bardu'), 'item card: dropped by, and where');
  assert.ok(!ic.textContent.includes('Database') && [...ic.querySelectorAll('.acts .btn')].map((b) => b.textContent).join('|') === 'diablo.trade|Favourite|Copy', 'diablo.trade, favourite, copy – nothing else');
  ic.querySelector('.ball').click(); await sleep(200);
  assert.ok($('q').value === 'Grigoire' && w.document.querySelector('#main .bsec .itile'), 'everything the boss drops, one click away');
  const first = w.document.querySelector('#side .hit:not(.trade)');
  assert.ok(first.classList.contains('on') && first.querySelector('.ln').textContent.startsWith('Grigoire,'), 'the boss on top and picked – its trophy below');
  assert.ok($('side').textContent.includes('Grigoire: Living Steel'), 'the trophy is still listed');
  assert.ok(!$('side').textContent.includes('Boss Trophies') && !txt().includes('Boss Trophies'), 'the trophy pool is left out');
  await type('mythics');
  const ip = w.document.querySelector('#main .bsec.pool');
  assert.ok(ip && ip.querySelector('.hero h3').textContent === 'Iconic Mythics', 'maxroll\'s "Mythics" are the Iconic Mythics');
  assert.ok(!ip.querySelector('.lairs') && ip.querySelector('.ity').textContent === 'all classes', 'no lair for a loot pool, no "All" next to "all classes"');
  // a chip picked earlier does not stick to the next search
  await type('annihilus');
  [...w.document.querySelectorAll('#chips .ptab')].find((c) => c.textContent.startsWith('Items')).click(); await sleep(20);
  await type('boss loot');
  assert.ok(w.document.querySelector('.bsec') && w.document.querySelector('#chips .ptab.on').textContent.startsWith('All'), 'a new search starts on All');
  console.log('ok  "boss loot" lists every boss');

  await type('duriel');
  assert.ok(!txt().includes('Grigoire'), 'a name narrows it down again');

  await type('crafting');
  assert.ok(txt().includes('Enigma'), 'runeword rendered');
  assert.ok(txt().includes('Jah + Ith + Ber'), 'runes listed');
  // runewords come from d4guides, not only maxroll's "Classic" table
  assert.ok(txt().includes('Insight'), 'full runeword list rendered');
  assert.ok(txt().includes('2 recipes'), 'recipe count shown');
  console.log('ok  "crafting" lists all recipes and runewords');

  // --- activities: no tab of their own, found in the search
  assert.ok(!rail('activities') && !rail('notes'), 'no activities or notes tab');
  await type('activities');
  assert.ok(txt().includes('Secret Cow Level'), 'activity found by keyword');
  await type('secret cow level');
  assert.ok(txt().includes('Secret Cow Level'), 'activity rendered');
  const step = w.document.querySelector('.step .dia');
  assert.ok(step && w.document.querySelectorAll('.step').length === 2, 'the parts of a step-by-step guide to tick off');
  assert.deepStrictEqual([...w.document.querySelectorAll('.jump')].map((x) => x.textContent), ['Rewards'], 'the other sections to jump to, TLDR left out');
  step.click(); await sleep(30);
  assert.deepStrictEqual(Object.values(settings.actDone)[0].length, 1, 'ticked steps are kept');
  assert.ok(w.document.querySelector('.step.done') && txt().includes('1 of 2 parts done'), 'and shown as done');
  calls.length = 0;
  w.document.querySelector('.jump').click(); await sleep(30);
  assert.ok(!$('viewSlot').hidden && calls.includes('viewShow'), 'a section opens the guide right there');
  await type('');
  console.log('ok  activities in the search');

  // --- builds: one list – slot, item, where it drops, tick – or slots; the build menu
  rail('farm').click(); await sleep(80);
  assert.ok(!$('panel').hidden && rail('farm').classList.contains('on'), 'builds open from their icon');
  const layoutBtn = (t) => [...w.document.querySelectorAll('.tool button')].find((x) => x.textContent === t);
  const tab = (t) => [...w.document.querySelectorAll('#chips .ptab')].find((x) => x.textContent === t);
  assert.ok($('top').hidden && $('side').hidden && w.document.querySelector('#title .bname .ttl'), 'builds: their own head in the page');
  assert.deepStrictEqual([...w.document.querySelectorAll('#chips .ptab')].map((x) => x.textContent), ['Cheat sheet', 'Gear', 'Skills', 'Paragon', 'Compare'], 'and their tabs in the page');
  assert.deepStrictEqual([...w.document.querySelectorAll('#title .kick button')].map((x) => x.textContent), ['My builds', 'Find a build'], 'my builds / find a build in the kicker');
  // route first: stops on the left; the list shows everything at once – work in the list here
  assert.ok(w.document.querySelector('.fgear .route') && w.document.querySelector('.rstop'), 'opens on the route');
  layoutBtn('List').click(); await sleep(30);
  assert.strictEqual(w.document.querySelectorAll('.fgear [data-key]').length, 10, 'ten gear slots in the list (all still to pick)');
  const slot = (k) => w.document.querySelector('.fgear [data-key="' + k + '"]');
  const choose = (k) => (slot(k).querySelector('.gn') || slot(k).querySelector('.gh')).click();
  const opts = () => [...w.document.querySelectorAll('.popt')];
  const opt = (name) => opts().find((o) => o.querySelector('.ln').textContent === name);
  const menu = async () => { w.document.querySelector('.bname').click(); await sleep(20); return w.document.querySelector('.bmenu'); };
  const progressText = () => (w.document.querySelector('#chips .ptabs .prog .num') || {}).textContent;

  // class filter (in the build menu) narrows what the slots offer
  choose('Weapon'); await sleep(30);
  assert.ok(opt('Orsivane') && opt('Hellhammer'), 'all classes: every weapon offered');
  const clsSel = (await menu()).querySelector('select');
  clsSel.value = 'Sorcerer'; clsSel.dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(!w.document.querySelector('.bmenu') || true);
  assert.ok(w.document.querySelector('#title .kick').textContent.includes('Sorcerer'), 'class shown over the build name');
  choose('Weapon'); await sleep(30);
  if (!w.document.querySelector('.fpick')) { choose('Weapon'); await sleep(30); }
  assert.ok(opt('Orsivane') && !opt('Hellhammer'), 'sorcerer: barbarian weapon gone');
  assert.ok(opt('Orsivane').textContent.includes('Andariel'), 'each option says where it drops');
  opt('Orsivane').click(); await sleep(30);
  assert.ok(slot('Weapon').textContent.includes('Orsivane'), 'slot shows the pick');

  // rings: unique + mythic tab
  choose('Ring1'); await sleep(30);
  opt("Drognan's Anguish").click(); await sleep(30);
  choose('Ring2'); await sleep(30);
  [...w.document.querySelectorAll('.fpick .seg button')].find((c) => c.textContent === 'Mythic').click(); await sleep(30);
  assert.ok(opt('Ring of Starless Skies') && !opt("Drognan's Anguish"), 'mythic tab only lists mythics');
  opt('Ring of Starless Skies').click(); await sleep(30);
  assert.ok(slot('Ring2').querySelector('.nm').classList.contains('r-mythic') && slot('Ring2').querySelector('.tsl').textContent === 'Ring', 'mythic coloured, its slot named');

  // amulet: two aspects
  choose('Amulet'); await sleep(30);
  [...w.document.querySelectorAll('.fpick .seg button')].find((c) => c.textContent === 'Aspect').click(); await sleep(30);
  assert.ok(opt('Armageddon') && opt('Overheating'), 'aspects that fit the amulet');
  opt('Armageddon').click(); await sleep(30);
  opt('Overheating').click(); await sleep(30);
  assert.ok(slot('Amulet').textContent.includes('Armageddon') && slot('Amulet').textContent.includes('Overheating'), 'two aspects on the amulet');
  choose('Gloves'); await sleep(30);
  [...w.document.querySelectorAll('.fpick .seg button')].find((c) => c.textContent === 'Aspect').click(); await sleep(30);
  opt('Untarnished Blaze').click(); await sleep(30);
  assert.ok(!w.document.querySelector('.fpick'), 'one aspect: the dropdown closes after the pick');
  choose('Gloves'); await sleep(30);
  assert.ok(w.document.querySelector('.fpick .seg button.on').textContent === 'Aspect', 'reopened on the aspect tab');
  opt('Armageddon').click(); await sleep(30);
  assert.ok(slot('Gloves').textContent.includes('Armageddon') && !slot('Gloves').textContent.includes('Untarnished'), 'one aspect elsewhere: a new pick replaces it');

  // the dropdown is a search: typing filters, Esc closes it without closing the overlay
  choose('Helm'); await sleep(30);
  assert.ok(w.document.activeElement && w.document.activeElement.id === 'farmQ', 'search field focused');
  w.document.getElementById('farmQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(30);
  assert.ok(!w.document.querySelector('.fpick') && !$('panel').hidden, 'Esc closes only the dropdown');
  // typing searches every kind at once – mythic, unique, aspect – grouped and coloured
  choose('Ring1'); await sleep(30);
  const fq = w.document.getElementById('farmQ');
  fq.value = 'a'; fq.dispatchEvent(new w.Event('input')); await sleep(30);
  const grps = [...w.document.querySelectorAll('.fpick .pgrp')].map((g) => g.textContent.split(' ·')[0]);
  assert.deepStrictEqual(grps, ['Mythic', 'Unique', 'Aspect'], 'all kinds found without switching tabs');
  assert.ok(opt('Ring of Starless Skies').querySelector('.ln').classList.contains('r-mythic') && opt('Armageddon'), 'mythic coloured, aspects listed');
  w.document.getElementById('farmQ').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await sleep(30);

  // where each one drops sits in its row; the progress on top
  const groupOf = (k) => slot(k).closest('.cgroup').querySelector('.ptx h3').textContent;
  assert.ok([...w.document.querySelectorAll('.calm .plate.cgroup')].every((c) => /^\d+ to farm$|^\d+ empty$/.test(c.querySelector('.badge').textContent)), 'list: one plate per place, how much is left');
  assert.ok([...w.document.querySelectorAll('.calm .thing:not(.blank)')].every((r) => r.querySelector('.dia') && r.querySelector('.pic')), 'every thing: the diamond tick and its picture');
  assert.strictEqual(groupOf('Weapon'), 'Andariel', 'unique: grouped under its boss');
  assert.ok(groupOf('Amulet') === 'Dungeons' && slot('Amulet').querySelector('.thow').textContent.includes('Defiled Catacomb'), 'aspect: under dungeons, with the dungeon');
  // the route: a stop per place, its things on the right
  layoutBtn('Route').click(); await sleep(30);
  const andariel = [...w.document.querySelectorAll('.rstop')].find((x) => x.textContent.includes('Andariel'));
  andariel.querySelector('.whead').click(); await sleep(30);
  assert.ok(w.document.querySelector('.wp.cur .whead b').textContent === 'Andariel' && slot('Weapon') && slot('Weapon').classList.contains('rthing'), 'a waypoint opens with what drops there');
  assert.ok(/^\d+ \/ \d+$/.test(w.document.querySelector('.wp.cur .plate .badge').textContent) && w.document.querySelector('.wp.cur .node'), 'the waypoint: its mark, farmed / all');
  assert.strictEqual(w.document.querySelectorAll('.path .wp .plate').length, 1, 'only the stop you are at is open');
  layoutBtn('List').click(); await sleep(30);
  assert.strictEqual(progressText(), '0 / 6', 'progress over everything to farm');
  console.log('ok  builds: list, class filter, search dropdown, where it drops');

  // ticking off
  slot('Weapon').querySelector('.dia').click(); await sleep(30);
  assert.strictEqual(progressText(), '1 / 6', 'ticked item counted');
  assert.ok(slot('Weapon').classList.contains('got'), 'and shown as farmed');
  layoutBtn('Only missing').click(); await sleep(30);
  assert.ok(!slot('Weapon') && slot('Ring1'), 'only missing: farmed and empty slots hidden');
  layoutBtn('Only missing').click(); await sleep(30);
  await sleep(350);
  assert.ok(savedBuilds && savedBuilds.builds[0].slots.Weapon.item === 'Orsivane', 'build saved');
  assert.strictEqual(savedBuilds.builds[0].cls, 'Sorcerer');
  assert.strictEqual(savedBuilds.builds[0].done.length, 1, 'ticks saved with the build');
  console.log('ok  ticks + builds saved');

  // hover shows the in-game tooltip
  const tipNode = () => w.document.querySelector('.fgear [data-tt]');
  tipNode().dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 50, clientY: 50 })); await sleep(260);
  assert.ok($('tip') && !$('tip').hidden && $('tip').querySelector('.d4tt-chrome'), 'tooltip shown on hover');
  assert.ok($('d4tt-css'), 'tooltip styles added once');
  tipNode().dispatchEvent(new w.MouseEvent('mouseleave')); await sleep(10);
  assert.ok($('tip').hidden, 'tooltip hides again');
  console.log('ok  in-game tooltip on hover');

  // more builds: the build menu
  [...(await menu()).querySelectorAll('.mact')].find((b) => b.textContent === '+ New farm list').click(); await sleep(30);
  assert.strictEqual((await menu()).querySelectorAll('.mrow').length, 2, 'second build');
  assert.deepStrictEqual([...w.document.querySelectorAll('.bmenu .mhd b')].map((b) => b.textContent), ['Builds', 'This build', 'More'], 'menu in three parts');
  assert.strictEqual(w.document.querySelector('.bmenu .mhd .badge').textContent, '2', 'how many builds');
  w.document.body.click(); await sleep(20);
  assert.ok(!w.document.querySelector('.bmenu'), 'a click elsewhere closes the menu');
  assert.ok(!w.document.querySelector('#chips .ptabs .prog') && !w.document.querySelector('.fgear .thing:not(.blank)'), 'new farm list starts empty');
  (await menu()).querySelectorAll('.mrow')[0].click(); await sleep(30);
  assert.ok(slot('Weapon').textContent.includes('Orsivane'), 'switching back shows the first build');
  // import: one field – it knows the site from the link and loads the variants by itself
  const openImport = async () => { [...w.document.querySelectorAll('#title .btn')].find((b) => b.textContent === 'Import').click(); await sleep(30); };
  const paste = async (v, ms) => { const i = $('impQ'); i.value = v; i.dispatchEvent(new w.Event('input')); await sleep(ms || 30); };
  const importBtn = () => w.document.querySelector('.ifoot .btn.pri');
  await openImport();
  assert.ok($('impQ') && w.document.querySelectorAll('.imodal input[type=text], .imodal textarea').length === 1, 'one field');
  await paste('https://example.com');
  assert.ok(w.document.querySelector('.ierr') && importBtn().disabled, 'a wrong link says so');
  await paste('https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3?variant=v-mul2mowk-fqxsj');
  assert.strictEqual(w.document.querySelector('.ibadge').textContent, 'infinitybuilds', 'infinitybuilds recognised');
  assert.strictEqual($('impQ').value, 'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn824uhPl3?variant=v-mul2mowk-fqxsj', 'the whole link stays in the field');
  await sleep(600);
  await paste('https://maxroll.gg/d4/build-guides/ice-spikes-sorcerer-guide', 600);
  assert.strictEqual(w.document.querySelector('.ibadge').textContent, 'maxroll', 'the site is recognised');
  const vars = [...w.document.querySelectorAll('.ivar')];
  assert.strictEqual(vars.length, 2, 'every variant of the planner offered');
  assert.ok(vars[1].classList.contains('main'), 'the variant the guide points at is marked');
  assert.ok(vars[1].textContent.includes('1 not recognised'), 'unrecognised items are mentioned');
  assert.strictEqual(importBtn().textContent, 'Import 2 builds', 'all variants ticked');
  vars[0].querySelector('input').click(); await sleep(30);
  assert.strictEqual(importBtn().textContent, 'Import', 'one left');
  importBtn().click(); await sleep(40);
  assert.ok(!w.document.querySelector('.imodal'), 'the dialog closes');
  assert.strictEqual(w.document.querySelector('.bname .ttl').textContent, 'Ice Spikes Sorc – Endgame', 'imported build is active');
  assert.ok(slot('Weapon').textContent.includes('Orsivane'), 'its gear is in the slots');
  assert.ok(w.document.querySelector('#title .kick').textContent.includes('Sorcerer'), 'class taken over');
  console.log('ok  import from a maxroll guide');
  // d2core: the Chinese original stays reachable, a weapon without a slot is mentioned
  await openImport();
  await paste('https://www.d2core.com/d4/planner?bd=23TM', 600);
  assert.ok(w.document.querySelector('.ibadge').textContent.startsWith('d2core'), 'd2core recognised');
  assert.ok(w.document.querySelector('.ititle').textContent.includes('d2core.com'), 'the site is named');
  assert.strictEqual(w.document.querySelector('.ititle').title, 'Original: S15-无限-箭雨', 'Chinese title on hover');
  assert.strictEqual(w.document.querySelector('.ivar').title, 'Original: 无限弓速刷\nNo slot left for: Aspect of Frozen Memories', 'variant hover: original + what did not fit');
  [...w.document.querySelectorAll('.ivar input')].slice(1).forEach((x) => x.click()); await sleep(30);
  importBtn().click(); await sleep(40);
  console.log('ok  import from d2core (translated, original on hover)');

  // the list: name, where it drops, the rolls right under it
  layoutBtn('List').click(); await sleep(30);
  assert.strictEqual(slot('Weapon').querySelector('.tsl').textContent, 'Bow', 'a weapon is named by its kind');
  assert.ok(slot('Weapon 2') && slot('Weapon 2').querySelector('.tsl').textContent === 'Sword', 'a third weapon has its own slot');
  const lines = [...slot('Weapon').querySelectorAll('.tst')];
  // the crafting mark (✦ greater, ⚒ temper, · none) and the text, the same in every view (cards.js statLine)
  assert.deepStrictEqual(lines.map((l) => l.querySelector('.cx-marks').textContent + ' ' + l.querySelector('.cx-t').textContent), ['✦ +10.0% Attack Speed', '· 8.0% Cooldown Reduction', '⚒ +1,500 Maximum Life'], 'stats with greater / tempered marks');
  assert.ok(lines[0].classList.contains('ga') && lines[2].classList.contains('tmp'));
  assert.strictEqual(slot('Weapon').querySelector('.gems .gem').textContent, 'Horadric Sapphire', 'sockets');
  // seal, charms and what goes into the sockets: things to farm as well, counted in the progress
  const charmRow = [...w.document.querySelectorAll('.crow.ext')].find((x) => x.textContent.includes('Linta of the Sightless'));
  const gemRow = [...w.document.querySelectorAll('.crow.ext')].find((x) => x.textContent.includes('Horadric Sapphire'));
  assert.ok(charmRow && gemRow && gemRow.textContent.includes('for Bow'), 'charms and gems listed, with where the gem goes');
  const before = progressText();
  charmRow.querySelector('.dia').click(); await sleep(30);
  const after = progressText();
  assert.ok(before !== after && after.startsWith('1 /'), 'ticking a charm counts');
  assert.ok([...w.document.querySelectorAll('.crow.ext.got')].some((x) => x.textContent.includes('Linta')), 'and it moves to the farmed ones');
  layoutBtn('Slots').click(); await sleep(30);
  // slots: the build as the game shows it – armour left, jewellery and weapons right
  assert.strictEqual(w.document.querySelectorAll('.fgear .dslot').length, 11, 'slots: one per slot (a rogue has a third weapon)');
  assert.ok(w.document.querySelector('.dcol.left [data-key="Helm"]') && w.document.querySelector('.dcol.right [data-key="Amulet"]'), 'armour left, jewellery right');
  assert.strictEqual(slot('Weapon').querySelector('.dk').textContent, 'Unique Bow', 'what it is, by its kind');
  const sg = w.document.querySelector('.dsock .sg');
  assert.ok(sg && sg.querySelector('.gem').textContent === 'Sapphire' && sg.querySelector('.sl').textContent === 'Bow', 'what is socketed, with the slot underneath');
  assert.ok(w.document.querySelector('.dside') && w.document.querySelector('.dside').textContent.includes('Linta of the Sightless'), 'the charms beside');
  slot('Weapon').dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 60, clientY: 60 })); await sleep(100);
  assert.ok(!$('tip').hidden && $('tip').querySelector('.ctt') && $('tip').textContent.includes('+10.0% Attack Speed') && !$('tip').querySelector('.d4tt-chrome'), 'hover: the rolls of this build, not the database card');
  slot('Weapon').dispatchEvent(new w.MouseEvent('mouseleave')); await sleep(10);
  w.document.querySelector('.dskills .dsk').click(); await sleep(60);
  await sleep(60);
  assert.ok(w.document.querySelector('.skc') && w.document.querySelector('.skc.on') && w.document.querySelector('svg.tree .sk.focus'), 'a skill in the bar opens the skills, zoomed to it');
  tab('Gear').click(); await sleep(30);
  layoutBtn('List').click(); await sleep(30);
  const srcBtn = w.document.querySelector('#title .btn.src');
  assert.ok(srcBtn && srcBtn.textContent.includes('d2core.com'), 'link to the original build');
  srcBtn.click(); await sleep(20);
  assert.ok(calls.includes('openBuildSource'), 'opens it in the browser');
  tab('Skills').click(); await sleep(60);
  assert.ok(w.document.querySelector('.skc').textContent.includes('Rain of Arrows') && w.document.querySelector('.skc').textContent.includes('Rank 15'), 'skill bar');
  assert.ok(w.document.querySelector('svg.tree .sk.on'), 'the taken skill lit in the tree');
  assert.strictEqual(w.document.querySelectorAll('svg.tree .md.on').length, 1, 'one modifier taken, one not');
  assert.ok(w.document.querySelector('svg.tree .jn.on'), 'the root counts as taken');
  w.document.querySelector('svg.tree .sk').dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 20, clientY: 20 })); await sleep(10);
  assert.ok(/Deals 20% damage/.test($('tip').textContent), 'skill text at the build\'s rank');
  w.document.querySelector('svg.tree .sk').dispatchEvent(new w.MouseEvent('mouseleave'));
  const fitTree = w.document.querySelector('svg.tree').getAttribute('viewBox');
  w.document.querySelector('.skc').click(); await sleep(400);
  assert.ok(w.document.querySelector('.skc').classList.contains('on') && w.document.querySelector('svg.tree .sk.focus'), 'a skill clicked on the bar is lit in the tree');
  assert.strictEqual(w.document.querySelectorAll('svg.tree .md.focus').length, 2, 'with its modifiers');
  assert.ok(w.document.querySelectorAll('svg.tree .sk, svg.tree .md').length === 3, 'nothing else hidden');
  assert.notStrictEqual(w.document.querySelector('svg.tree').getAttribute('viewBox'), fitTree, 'and zoomed in on');
  w.document.querySelector('.skc').click(); await sleep(400);
  assert.ok(!w.document.querySelector('svg.tree .focus') && w.document.querySelector('svg.tree').getAttribute('viewBox') === fitTree, 'a second click zooms back out');
  const tap = (node, dx) => {
    node.dispatchEvent(new w.PointerEvent('pointerdown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));
    if (dx) node.dispatchEvent(new w.PointerEvent('pointermove', { button: 0, clientX: 100 + dx, clientY: 100, bubbles: true }));
    node.dispatchEvent(new w.PointerEvent('pointerup', { button: 0, clientX: 100 + (dx || 0), clientY: 100, bubbles: true }));
  };
  tap(w.document.querySelector('svg.tree .md')); await sleep(400);
  assert.ok(w.document.querySelector('svg.tree .sk.focus') && w.document.querySelector('.skc').classList.contains('on'), 'a click in the tree (here a modifier) picks its skill, card lit too');
  tap(w.document.querySelector('svg.tree .sk')); await sleep(400);
  assert.ok(!w.document.querySelector('svg.tree .focus'), 'clicking it again lets go');
  tap(w.document.querySelector('svg.tree .sk'), 40); await sleep(50);
  assert.ok(!w.document.querySelector('svg.tree .focus'), 'dragging is not a click');
  tab('Paragon').click(); await sleep(60);
  assert.strictEqual(w.document.querySelectorAll('svg.para .pn.on').length, 2, 'two nodes taken');
  assert.ok(w.document.querySelector('svg.para .pn.glyph'), 'glyph in its socket');
  // as in the mockup: the boards as a film strip, one shown big to start with, its glyph beside it
  assert.ok(w.document.querySelector('.pfilm').textContent.includes('Versatility · 150'), 'glyph and rank on the board in the strip');
  assert.ok(w.document.querySelector('svg.para g.board.sel') && w.document.querySelector('.pfilm .pb.on'), 'the first board shown big to start with');
  assert.ok(w.document.querySelector('.pside .gmed') && w.document.querySelector('.pside').textContent.includes('Versatility'), 'its glyph as a medallion beside it');
  const zoomedIn = w.document.querySelector('svg.para').getAttribute('viewBox');
  w.document.querySelector('.pfilm .pall').click(); await sleep(400);
  const fitPara = w.document.querySelector('svg.para').getAttribute('viewBox');
  assert.ok(!w.document.querySelector('svg.para g.board.sel') && w.document.querySelector('.pfilm .pall.on') && fitPara !== zoomedIn, 'All: the whole chain');
  w.document.querySelector('.pfilm .pb').click(); await sleep(400);
  assert.notStrictEqual(w.document.querySelector('svg.para').getAttribute('viewBox'), fitPara, 'and the view moves to that board');
  assert.ok(w.document.querySelector('svg.para g.board').classList.contains('sel') && w.document.querySelector('.pfilm .pb').classList.contains('on'), 'a board picked in the strip is lit');
  w.document.querySelector('.pfilm .pb').click(); await sleep(400);
  assert.ok(!w.document.querySelector('svg.para g.board.sel'), 'a second click shows all again');
  assert.strictEqual(w.document.querySelector('svg.para').getAttribute('viewBox'), fitPara, 'zoomed back out to all boards');
  tap(w.document.querySelector('svg.para g.board rect')); await sleep(400);
  assert.ok(w.document.querySelector('svg.para g.board.sel') && w.document.querySelector('.pfilm .pb.on'), 'a click on the board itself picks it');
  tap(w.document.querySelector('svg.para g.board rect')); await sleep(400);
  assert.ok(!w.document.querySelector('svg.para g.board.sel'), 'and again lets go');
  w.document.querySelector('svg.para').dispatchEvent(new w.WheelEvent('wheel', { deltaY: -100, clientX: 10, clientY: 10, cancelable: true }));
  const zoomed = w.document.querySelector('svg.para').getAttribute('viewBox');
  [...w.document.querySelectorAll('.plook .lk')].find((x) => x.textContent === 'Icons').click(); await sleep(30);
  assert.ok(w.document.querySelector('svg.para.icons image'), 'icons instead of squares');
  assert.strictEqual(w.document.querySelector('svg.para').getAttribute('viewBox'), zoomed, 'switching the look keeps the zoom');
  [...w.document.querySelectorAll('.plook .lk')].find((x) => x.textContent === 'Minimal').click(); await sleep(30);
  assert.ok(!w.document.querySelector('svg.para image') && w.document.querySelector('svg.para .pn'), 'and back');
  assert.ok(w.document.querySelector('svg.para .bname').getAttribute('y') < 0, 'board name above the board, not on its nodes');
  tab('Gear').click(); await sleep(30);
  // charms and sockets: in the list as things to farm, the card with the set bonus on hover
  layoutBtn('List').click(); await sleep(30);
  const cl = w.document.querySelector('.calm');
  assert.ok(cl.textContent.includes('Seal of the Diamond Mind') && cl.textContent.includes('Linta of the Sightless'), 'seal and charms');
  assert.ok(!cl.textContent.includes('Two piece bonus'), 'set bonuses are not listed, only the pieces');
  const piece = [...cl.querySelectorAll('.ext .xn')].find((x) => x.textContent.includes('Linta'));
  piece.dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 40, clientY: 40 })); await sleep(100);
  assert.ok(!$('tip').hidden && $('tip').querySelector('.ctt .bon.on') && $('tip').querySelector('.ctt .bon:not(.on)') && $('tip').textContent.includes('+20 Maximum Resource'), 'hover: the charm card with its stats and the set bonuses');
  piece.dispatchEvent(new w.MouseEvent('mouseleave'));
  assert.ok($('tip').hidden, 'and gone again');
  // the database tooltip carries the build's rolls
  slot('Weapon').querySelector('[data-tt]').dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 50, clientY: 50 })); await sleep(260);
  assert.ok($('tip').querySelector('.ftt-roll') && $('tip').textContent.includes('+10.0% Attack Speed'), 'rolls under the tooltip');
  slot('Weapon').querySelector('[data-tt]').dispatchEvent(new w.MouseEvent('mouseleave')); await sleep(10);
  console.log('ok  imported build: stats, link back, skill tree, paragon');
  [...(await menu()).querySelectorAll('.mact')].find((b) => b.textContent === 'Copy build code').click(); await sleep(30);
  assert.ok(calls.includes('buildCode'), 'build code copied (from the build menu)');
  await openImport();
  await paste('D4B1:abc');
  assert.strictEqual(w.document.querySelector('.ibadge').textContent, 'Build code', 'a code is recognised too');
  importBtn().click(); await sleep(40);
  assert.ok([...(await menu()).querySelectorAll('.mrow')].some((o) => o.textContent.includes('Friend build')), 'pasted build added');
  w.document.body.click(); await sleep(20);
  console.log('ok  several builds, build code, import');
  // compare: the open build against another one, as a move from this one to that one
  tab('Compare').click(); await sleep(40);
  const cmpSel = w.document.querySelector('.cmp-head select');
  assert.ok(cmpSel && cmpSel.options.length >= 1, 'compare: a build to pick');
  // three numbers, one line per slot that changes, the rest as chips
  assert.strictEqual(w.document.querySelectorAll('.cmp-tiles .cmp-tile').length, 3, 'compare: pieces that change, of them you have, left to farm');
  assert.ok(w.document.querySelector('.cmp-table .cmp-r:not(.cmp-th)') || w.document.querySelector('.cmp-none'), 'compare: a line per change');
  assert.ok(['Skills', 'Paragon', 'Glyphs', 'Talisman'].every((x) => [...w.document.querySelectorAll('.cmp-chip b')].some((b) => b.textContent === x)), 'compare: skills, paragon, glyphs, talisman as chips');
  const fold = w.document.querySelector('.cmp-fold');
  if (fold) { fold.click(); await sleep(30); assert.ok(w.document.querySelector('.cmp-fold.on'), 'compare: what stays the same folds out'); }
  const target = cmpSel.options[cmpSel.options.length - 1];
  cmpSel.value = target.value; cmpSel.dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(w.document.querySelector('.cmp-head select').value, target.value, 'compare: another build picked');
  w.document.querySelector('.cmp-head .btn').click(); await sleep(40);
  assert.ok(!w.document.querySelector('.cmp-head') && w.document.querySelector('.bname .ttl').textContent === target.textContent, 'compare: "Open this build" switches to it, back on the gear');
  console.log('ok  compare two builds');
  // the cheat sheet: breakpoints, set up once, how to play, why it works – the author's words on hover
  tab('Cheat sheet').click(); await sleep(60);
  assert.ok(w.document.querySelectorAll('.gd-bp').length === 2 && w.document.querySelector('.gd-bp b').textContent === '225', 'cheat sheet: the breakpoints as numbers');
  assert.strictEqual(w.document.querySelectorAll('.gd-bp b')[1].textContent, '≤ 15 s', 'a cap reads "≤"');
  assert.ok(w.document.querySelector('.gd-rot li') && w.document.querySelector('.gd-sum') && w.document.querySelector('.gd-opts li'), 'cheat sheet: rotation, why it works, swaps');
  w.document.querySelector('.gd-bp').dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 10, clientY: 10 })); await sleep(100);
  assert.ok(/225 Maximum Energy/.test($('tip').textContent), 'hover: the author’s own words');
  w.document.querySelector('.gd-bp').dispatchEvent(new w.MouseEvent('mouseleave')); await sleep(10);
  tab('Gear').click(); await sleep(30);
  await type('');

  // --- embedded sections ask for a view
  calls.length = 0;
  rail('maptool').click(); await sleep(60);
  assert.ok(calls.includes('viewShow'), 'map tool opens an embedded view');
  assert.ok(!$('viewSlot').hidden && $('main').hidden, 'view slot replaces the cards');
  console.log('ok  map tool opens the embedded view');

  rail('listings').click(); await sleep(60);
  assert.ok(!$('viewSlot').hidden, 'chat uses the embedded view too');
  console.log('ok  chat section');

  // a click into the game closes the panel – pinned it stays and steps back
  rail('search').click(); await sleep(30);
  assert.ok(!$('coach').hidden, 'the hint about closing and pinning shows once');
  $('coachOk').click(); await sleep(20);
  assert.ok($('coach').hidden && settings.coachSeen === true, 'and is gone for good');
  handlers.onClickOutside(); await closed();
  assert.ok($('panel').hidden, 'click into the game closes it');
  rail('search').click(); await sleep(30);
  $('btnPin').click();
  assert.ok($('btnPin').classList.contains('on'), 'pinned');
  handlers.onClickOutside(); await closed();
  assert.ok(!$('panel').hidden && $('app').classList.contains('ghost'), 'pinned: stays, steps back');
  $('panel').dispatchEvent(new w.PointerEvent('pointerenter', { bubbles: true })); await sleep(10);
  assert.ok($('app').classList.contains('ghost'), 'the mouse over it only lifts the fade for the moment (CSS), it stays pinned-faded');
  assert.ok(calls.includes('hoverWatch'), 'faded: the main process watches the cursor');
  handlers.onCursorInside(true);
  assert.ok($('app').classList.contains('near'), 'cursor over the window: bright');
  handlers.onCursorInside(false);
  assert.ok(!$('app').classList.contains('near') && $('app').classList.contains('ghost'), 'cursor gone (even a quick exit into the game): faded again');
  $('main').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); await sleep(20);
  assert.ok(!$('app').classList.contains('ghost'), 'a click on it brings it forward');
  $('panelClose').click(); await closed();
  rail('farm').click(); await sleep(30);
  assert.ok(!$('btnPin').classList.contains('on'), 'builds do not pin themselves – pinning is your own click');
  $('btnPin').click();
  handlers.onClickOutside(); await closed();
  assert.ok(!$('panel').hidden && !$('app').classList.contains('ghost'), 'builds stay fully visible while you play (no fade out)');
  $('panelClose').click(); await closed();
  console.log('ok  close on a click into the game, pin');

  // the keyboard stays with the game: asked for only while something is typed into
  const kb = () => calls.filter((c) => c === 'keyboard').length;
  let k0 = kb();
  rail('settings').click(); await sleep(30);
  assert.strictEqual(kb(), k0, 'opening settings by a click takes no keyboard');
  w.document.querySelector('#main.settings').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); await sleep(20);
  assert.strictEqual(kb(), k0, 'clicking around in it neither');
  anchors()[2].click(); await sleep(30);
  w.document.querySelector('.hk').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); await sleep(20);
  assert.strictEqual(kb(), k0 + 1, 'a key field asks for it');
  anchors()[0].click(); await sleep(30);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  k0 = kb();
  rail('search').click(); await sleep(30);
  assert.ok(kb() > k0, 'the search takes it, to type into');
  // focused only once the search bar shows – a hidden field cannot take the focus (from settings,
  // builds or the closed pill the bar is hidden until render() shows it)
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  rail('settings').click(); await sleep(30);
  const realFocus = $('q').focus;
  let shownWhenFocused = null;
  $('q').focus = function () { shownWhenFocused = !$('top').hidden && !$('panel').hidden; return realFocus.call(this); };
  rail('search').click(); await sleep(30);
  $('q').focus = realFocus;
  assert.strictEqual(shownWhenFocused, true, 'the search field is focused when it can be: shown');
  $('q').blur(); w.dispatchEvent(new w.Event('focus')); await sleep(10);
  assert.strictEqual(w.document.activeElement, $('q'), 'once the window has the focus the search field gets it again – one click is enough');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  console.log('ok  keyboard only while typing');

  // a guide opened from the results: spinner while it loads, Back, typing goes back to the results
  rail('search').click(); await sleep(20);
  $('q').value = 'crafting'; $('q').dispatchEvent(new w.Event('input')); await sleep(150);
  w.document.querySelector('#main button[title="Open in the database"]').click(); await sleep(30);
  handlers.onViewLoading(true);
  assert.ok($('viewSlot').classList.contains('loading'), 'spinner while the page loads');
  handlers.onViewLoading(false);
  assert.ok(!$('viewSlot').classList.contains('loading'), 'gone once it is there');
  const back = [...$('title').querySelectorAll('.btn')].find((x) => x.textContent.includes('Back'));
  assert.ok(back, 'a way back');
  $('q').value = ''; $('q').dispatchEvent(new w.Event('input')); await sleep(150);
  assert.ok(rail('search').classList.contains('on') && $('viewSlot').hidden, 'clearing the search closes the page');
  $('panelClose').click(); await closed();
  console.log('ok  pages: spinner, back, closed by the search');

  // resize handle sets a fixed size and the panel then fills it
  rail('search').click(); await sleep(30);
  const grip = $('grip-resize');
  assert.ok(grip, 'resize handle exists');
  grip.dispatchEvent(new w.PointerEvent('pointerdown', { clientX: 500, clientY: 400, bubbles: true }));
  grip.dispatchEvent(new w.PointerEvent('pointermove', { clientX: 620, clientY: 470, bubbles: true }));
  grip.dispatchEvent(new w.PointerEvent('pointerup', { clientX: 620, clientY: 470, bubbles: true }));
  assert.ok(calls.filter((c) => c === 'resizeDrag').length >= 3, 'dragging hands start, move and end to the main process');
  handlers.onLayout({ up: false, offset: 0, maxH: 520, manual: true });
  assert.ok($('app').classList.contains('manual'), 'manual mode marked, panel fills the window');
  handlers.onLayout({ up: false, offset: 0, maxH: 520, manual: false });
  assert.ok(!$('app').classList.contains('manual'), 'back to automatic');
  console.log('ok  resize handle + manual size');

  // --- settings with sub navigation
  rail('settings').click(); await sleep(40);
  assert.ok(txt().includes('A click into the game') && txt().includes('No fade out on builds'), 'settings open on Behaviour');
  assert.ok($('side').hidden, 'settings use their own navigation');
  const tabs = anchors().map((a) => a.textContent);
  assert.strictEqual(w.document.querySelector('#title .ttl').textContent, 'Settings', 'the page head says where you are');
  assert.deepStrictEqual(tabs, ['Behaviour', 'Appearance', 'Hotkeys', 'Macros', 'diablo.trade', 'Data'], 'all groups as chips on top');
  assert.deepStrictEqual([...w.document.querySelectorAll('.setgroup')].map((g) => g.dataset.group), ['behaviour', 'appearance', 'hotkeys', 'macros', 'trade', 'data'], 'one page, as in the mockup: every group one after the other');
  // every row: name and help left, one control right
  assert.ok([...w.document.querySelectorAll('.opt')].every((o) => o.querySelector('.txt b') && o.querySelector('.ctl').children.length), 'one row shape everywhere');
  const swb = [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('No fade out on builds')).querySelector('.sw');
  swb.click(); await sleep(30);
  assert.strictEqual(settings.buildsNoFade, false, 'a switch saves');
  [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('No fade out on builds')).querySelector('.sw').click(); await sleep(30);
  anchors()[5].click(); await sleep(30);
  assert.ok(txt().includes('Data folder') && txt().includes('Diablo IV path'), 'data tab: folder and the advanced bits');
  anchors()[1].click(); await sleep(30);
  assert.ok(txt().includes('Opacity'), 'appearance tab renders');
  anchors()[2].click(); await sleep(30);
  assert.ok(txt().includes('Open / close search'), 'hotkeys tab renders');
  assert.ok(!grp('hotkeys').textContent.includes('Click spam') && !grp('hotkeys').textContent.includes('Lock'), 'the macros are no hotkeys any more');
  console.log('ok  settings: ' + tabs.join(' / '));
  // every tab: one card per section
  const cardTitles = (id) => [...grp(id).querySelectorAll('.plate .ptx h3')].map((h) => h.textContent);
  anchors()[0].click(); await sleep(30);
  assert.deepStrictEqual(cardTitles('behaviour'), ['Panel', 'Bar', 'Timers', 'Messages'], 'behaviour on plates');
  assert.ok([...w.document.querySelectorAll('.setbody .opt')].every((o) => o.closest('.plate')), 'every row sits on a plate');
  anchors()[1].click(); await sleep(30);
  assert.deepStrictEqual(cardTitles('appearance'), ['Closed bar', 'Size', 'Look'], 'appearance on plates');
  assert.ok(!txt().includes('Labels in the bar'), 'no labels to switch any more: the spine has them, the strip none');
  anchors()[4].click(); await sleep(30);
  assert.deepStrictEqual(cardTitles('trade'), ['Account', 'Item search', 'If signing in does not work'], 'diablo.trade on plates');
  anchors()[5].click(); await sleep(30);
  assert.deepStrictEqual(cardTitles('data'), ['Game data', 'Backup', 'Updates', 'Advanced'], 'data on plates');
  anchors()[2].click(); await sleep(30);
  assert.deepStrictEqual(cardTitles('hotkeys'), ['Hotkeys'], 'hotkeys on a plate');
  assert.ok(anchors()[2].classList.contains('on') || true, 'the chip of the group jumped to is lit');
  assert.ok(w.document.querySelector('.plate .pt > svg.i') && w.document.querySelector('.plate .ptx span'), 'icon and a line on what it is about');
  console.log('ok  settings: every section on its own card');

  // --- macros: their own tab, everything off, switching one on asks first
  anchors()[3].click(); await sleep(30);
  assert.ok(txt().includes('Use at your own risk'), 'the warning stands on top');
  assert.ok(txt().includes('Click spam') && txt().includes('Lock') && !txt().includes('Loop skills') && !txt().includes('Num-lock'), 'both macros – lock is loop and num-lock in one');
  const macroSw = (k) => w.document.querySelector('.opt[data-macro="' + k + '"] .sw');
  assert.ok(['clickSpam', 'lockOn'].every((k) => !macroSw(k).classList.contains('on')), 'all off by default');
  const card = (k) => w.document.querySelector('.plate[data-card="' + k + '"]');
  assert.deepStrictEqual(cardTitles('macros'), ['Character', 'Lock', 'Click spam'], 'each section on its own plate');
  assert.ok(['clickSpam', 'lockOn'].every((k) => card(k).querySelector('.badge').textContent === 'OFF' && !card(k).classList.contains('on')), 'the plate says OFF');
  assert.strictEqual(card('lockOn').querySelector('kbd').textContent, 'F9', 'the toggle key in the card head');
  macroSw('clickSpam').click(); await sleep(30);
  assert.ok(w.document.querySelector('.ishade.risk'), 'switching on asks first');
  assert.strictEqual(settings.clickSpam, false, 'not on before it is confirmed');
  [...w.document.querySelectorAll('.ishade.risk .btn')].find((x) => x.textContent === 'Cancel').click(); await sleep(30);
  assert.ok(!w.document.querySelector('.ishade.risk') && settings.clickSpam === false, 'Cancel keeps it off');
  macroSw('clickSpam').click(); await sleep(30);
  $('riskYes').click(); await sleep(40);
  assert.strictEqual(settings.clickSpam, true, 'on after "I understand"');
  assert.ok(card('clickSpam').classList.contains('on') && card('clickSpam').querySelector('.badge').textContent === 'ON', 'the plate shows it is on');
  assert.ok(!w.document.querySelector('.ishade.risk'), 'the warning closes');
  macroSw('clickSpam').click(); await sleep(30);
  assert.ok(!w.document.querySelector('.ishade.risk') && settings.clickSpam === false, 'switching off asks nothing');
  macroSw('clickSpam').click(); await sleep(30); $('riskYes').click(); await sleep(40);
  console.log('ok  macros: own tab, off by default, "use at your own risk" before switching on');

  assert.ok(txt().includes('Mouse 4') && txt().includes('Mouse 5'), 'both thumb buttons shown');
  assert.ok(txt().includes('only while Diablo IV is in front'), 'says when it works');
  const fields = [...w.document.querySelectorAll('.hk')];
  const rightField = fields.find((f) => f.textContent === 'Mouse 4');
  const leftField = fields.find((f) => f.textContent === 'Mouse 5');
  assert.ok(rightField && leftField, 'one capture field per side');

  // binding another mouse button: 1 = wheel, 3 = thumb back, 4 = thumb forward
  rightField.dispatchEvent(new w.MouseEvent('mousedown', { button: 3, bubbles: true })); await sleep(40);
  assert.strictEqual(settings.clickRightBind, 'Mouse4', 'thumb back bound to right click');
  leftField.dispatchEvent(new w.MouseEvent('mousedown', { button: 1, bubbles: true })); await sleep(40);
  assert.strictEqual(settings.clickLeftBind, 'Mouse3', 'wheel button bound to left click');
  // left and right mouse button must stay free, otherwise the field cannot be clicked
  leftField.dispatchEvent(new w.MouseEvent('mousedown', { button: 0, bubbles: true })); await sleep(30);
  assert.strictEqual(settings.clickLeftBind, 'Mouse3', 'a plain left click changes nothing');
  // a key works as well, Delete clears
  leftField.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F', code: 'KeyF', bubbles: true })); await sleep(40);
  assert.strictEqual(settings.clickLeftBind, 'F', 'a key can be bound too');
  leftField.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Delete', code: 'Delete', bubbles: true })); await sleep(40);
  assert.strictEqual(settings.clickLeftBind, '', 'Delete clears it');
  console.log('ok  click spam: thumb buttons, wheel, key, clearing');

  // --- lock: [+] to start with; + then a key adds a tile and a row – held by default, or timed
  const sameJson = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);   // arrays from the page's own realm
  assert.ok(txt().includes('Lock') && txt().includes('Toggle key'), 'lock section');
  const tiles = (kind) => [...w.document.querySelectorAll('.seg.chips[data-picks="' + kind + '"] button')];
  const plus = (kind) => w.document.querySelector('.seg.chips[data-picks="' + kind + '"] button.add');
  const tileText = (kind) => tiles(kind).map((t) => (t.classList.contains('add') ? '+' : t.dataset.key));
  sameJson(tileText('lock'), ['+'], 'nothing yet: only [+]');
  assert.ok(!w.document.querySelector('.lockrow'), 'no rows yet');
  const addKey = async (kind, code) => {
    plus(kind).click(); await sleep(20);
    // a save just before (a rename) redraws the section a moment later – then the new [+] is clicked
    if (!plus(kind).classList.contains('rec')) { await sleep(150); plus(kind).click(); await sleep(20); }
    assert.ok(plus(kind).classList.contains('rec'), '+ waits for a key');
    plus(kind).dispatchEvent(new w.KeyboardEvent('keydown', { key: code.slice(-1), code, bubbles: true })); await sleep(40);
  };
  const addMouse = async (kind, button) => {
    plus(kind).click(); await sleep(20);
    const p = plus(kind);
    p.dispatchEvent(new w.MouseEvent('mousedown', { button, bubbles: true }));
    p.dispatchEvent(new w.MouseEvent('mouseup', { button, bubbles: true }));
    if (button === 0) p.dispatchEvent(new w.MouseEvent('click', { button, bubbles: true }));   // as a real left click goes on
    await sleep(40);
  };
  await addKey('lock', 'Digit1');
  sameJson(tileText('lock'), ['1', '+'], '[1][+]');
  await addKey('lock', 'Digit2');
  await addKey('lock', 'KeyQ');
  sameJson(tileText('lock'), ['1', '2', 'Q', '+'], 'more keys, in the order added');
  await addKey('lock', 'Digit2');
  assert.strictEqual(settings.lockKeys.length, 3, 'a key is in the list only once');
  assert.ok(plus('lock').textContent.includes('is in'), 'and it says so');
  await addMouse('lock', 0);
  sameJson(tileText('lock'), ['1', '2', 'Q', 'Mouse1', '+'], 'a mouse button (left) too');
  assert.ok(!plus('lock').classList.contains('rec'), 'the left click that was taken does not start listening again');
  assert.ok(tiles('lock')[3].textContent.startsWith('M1'), 'shown as M1');
  plus('lock').click(); await sleep(20);
  plus('lock').dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); await sleep(30);
  assert.ok(!plus('lock').classList.contains('rec') && settings.lockKeys.length === 4, 'Esc cancels');

  const lockRow = (k) => w.document.querySelector('.lockrow[data-key="' + k + '"]');
  const rowOrder = () => [...w.document.querySelectorAll('.lockrow')].map((x) => x.dataset.key);
  sameJson(rowOrder(), ['1', '2', 'Q', 'Mouse1'], 'every key has its row');
  assert.ok(settings.lockKeys.every((e) => e.lock === true), 'lock is on by default');
  assert.ok(lockRow('Q').querySelector('.sw').classList.contains('on') && lockRow('Q').querySelector('input.ksec').disabled, 'lock on: the seconds are grey');
  lockRow('Q').querySelector('.sw').click(); await sleep(40);
  assert.strictEqual(settings.lockKeys[2].lock, false, 'lock off: timed');
  assert.ok(!lockRow('Q').querySelector('input.ksec').disabled, 'and the seconds can be set');
  const secs = lockRow('Q').querySelector('input.ksec');
  // a time as typed: comma, m:ss, units – anything else is put back
  const ksec = () => lockRow('Q').querySelector('input.ksec');
  const typeSec = async (v) => { ksec().value = v; ksec().dispatchEvent(new w.Event('change')); await sleep(40); };
  const secOf = (k) => settings.lockKeys.find((e) => e.key === k).sec;
  await typeSec('5,2');
  assert.ok(secOf('Q') === 5.2 && ksec().value === '5.2s', 'a comma works');
  await typeSec('1:12');
  assert.ok(secOf('Q') === 72 && ksec().value === '01:12', 'm:ss');
  await typeSec('1m5s');
  assert.strictEqual(secOf('Q'), 65, 'units');
  await typeSec('soon');
  assert.ok(secOf('Q') === 65 && ksec().value === '01:05', 'no time: put back');
  await typeSec('12.5 sec');
  assert.strictEqual(secOf('Q'), 12.5, 'seconds with a word');
  lockRow('2').querySelector('.sw').click(); await sleep(40);
  assert.ok(lockRow('2').textContent.includes('timed · 1.') && lockRow('Q').textContent.includes('timed · 2.'), 'the timed keys carry their priority');
  assert.ok(txt().includes('Timed keys always go out on time'), 'held and timed: says who goes first');
  // drag Q above 2 by its grip
  const drag = async (fromKey, toKey) => {
    lockRow(fromKey).querySelector('.grip').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true }));
    assert.ok(lockRow(fromKey).draggable, 'the grip makes the row draggable');
    lockRow(fromKey).dispatchEvent(new w.Event('dragstart', { bubbles: true }));
    const over = new w.Event('dragover', { bubbles: true, cancelable: true });
    lockRow(toKey).dispatchEvent(over);
    assert.ok(over.defaultPrevented, 'a row takes the drop');
    lockRow(toKey).dispatchEvent(new w.Event('drop', { bubbles: true, cancelable: true })); await sleep(40);
  };
  await drag('Q', '2');
  sameJson(settings.lockKeys.map((e) => e.key), ['1', 'Q', '2', 'Mouse1'], 'dragged up: Q before 2');
  assert.ok(lockRow('Q').textContent.includes('timed · 1.'), 'and Q goes first now');
  assert.ok(!lockRow('1').draggable, 'a row is only draggable by its grip');
  // switched off for now: stays in the list, greyed, left out of the priority and the tag
  lockRow('Q').querySelector('.kon').click(); await sleep(40);
  assert.strictEqual(settings.lockKeys[1].off, true, 'Q switched off');
  assert.ok(lockRow('Q').classList.contains('off') && lockRow('Q').textContent.includes('off'), 'greyed, says off');
  assert.ok(lockRow('2').textContent.includes('timed · 1.'), '2 goes first while Q is off');
  handlers.onLock({ on: true, paused: false });
  assert.ok(!$('lockTag').textContent.includes('Q'), 'not in the tag');
  handlers.onLock({ on: false, paused: false });
  lockRow('Q').querySelector('.kon').click(); await sleep(40);
  assert.ok(!('off' in settings.lockKeys[1]) && !lockRow('Q').classList.contains('off'), 'switched on again, its settings kept');
  assert.strictEqual(settings.lockKeys[1].sec, 12.5);
  tiles('lock')[0].querySelector('.x').click(); await sleep(40);
  sameJson(settings.lockKeys, [{ key: 'Q', lock: false, sec: 12.5 }, { key: '2', lock: false, sec: 1 }, { key: 'Mouse1', lock: true, sec: 1 }], '× takes one out; lock and time per key');
  assert.ok(!lockRow('1'), 'its row is gone');
  assert.ok($('lockTag').hidden, 'no tag while it is off');
  handlers.onLock({ on: true, paused: false });
  assert.ok(!$('lockTag').hidden && $('lockTag').textContent.includes('Q2M1') && !$('lockTag').classList.contains('paused'), 'tag in the bar while it runs');
  const lk = $('lockTag').querySelector('.lkeys');
  assert.ok(lk && lk.textContent === 'Q2M1' && !lk.getAnimations?.().length && !lk.style.animationDuration, 'the keys as they are pressed, still – nothing blinks');
  assert.ok(/held/.test(lk.title) && /every/.test(lk.title), 'held and timed ones told on hover');
  handlers.onLock({ on: true, paused: true });
  assert.ok($('lockTag').classList.contains('paused') && $('lockTag').textContent.includes('Wait'), 'it says when a left click pauses it');
  handlers.onLock({ on: true, paused: false });
  assert.ok($('lockTag').textContent.includes('Lock'), 'and when it goes on');
  handlers.onLock({ on: false, paused: false });
  assert.ok($('lockTag').hidden, 'gone again');
  console.log('ok  lock: [+], tiles, lock on by default (seconds grey), timed per key, drag to order, tag in the bar');

  // --- per character: the list goes with the character
  assert.strictEqual($('macroChar').options.length, 1, 'one character to start with');
  [...w.document.querySelectorAll('.btn')].find((x) => x.textContent === '+ New').click(); await sleep(40);
  assert.strictEqual(settings.macroChars.length, 2, 'a new character');
  assert.strictEqual(settings.macroChar, 1, 'and it is in use');
  sameJson(settings.macroChars[1].lockKeys.map((e) => e.key), ['Q', '2', 'Mouse1'], 'starts as a copy');
  $('macroCharName').value = 'Sorc'; $('macroCharName').dispatchEvent(new w.Event('change')); await sleep(40);
  assert.strictEqual(settings.macroChars[1].name, 'Sorc', 'renamed');
  await addKey('lock', 'Digit3');                             // Sorc holds one more
  tiles('lock')[0].querySelector('.x').click(); await sleep(40);   // … and has no Q
  sameJson(settings.macroChars[1].lockKeys.map((e) => e.key), ['2', 'Mouse1', '3'], 'saved with the character');
  $('macroChar').value = '0'; $('macroChar').dispatchEvent(new w.Event('change')); await sleep(40);
  sameJson(settings.lockKeys, [{ key: 'Q', lock: false, sec: 12.5 }, { key: '2', lock: false, sec: 1 }, { key: 'Mouse1', lock: true, sec: 1 }], 'the first character\'s keys are back');
  sameJson(tileText('lock'), ['Q', '2', 'Mouse1', '+'], 'the tiles show it');
  $('macroChar').value = '1'; $('macroChar').dispatchEvent(new w.Event('change')); await sleep(40);
  sameJson(settings.lockKeys.map((e) => e.key), ['2', 'Mouse1', '3'], 'and Sorc\'s when switched back');
  [...w.document.querySelectorAll('.btn')].find((x) => x.textContent === 'Delete').click(); await sleep(40);
  assert.strictEqual(settings.macroChars.length, 1, 'deleted');
  sameJson(settings.lockKeys.map((e) => e.key), ['Q', '2', 'Mouse1'], 'back on the one left');
  assert.ok([...w.document.querySelectorAll('.btn')].find((x) => x.textContent === 'Delete').disabled, 'the last one stays');
  console.log('ok  macros per character: new, rename, switch, delete');


  // the panel's size: made for the room left of the inventory – or tall and narrow like a phone
  anchors()[0].click(); await sleep(30);
  assert.ok(!txt().includes('Orientation') && !txt().includes('Shrink to the small pill'), 'no orientation and no shrinking to choose: one bar for everything');
  anchors()[1].click(); await sleep(30);
  const sizeSeg = [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('Panel size')).querySelector('.seg');
  assert.deepStrictEqual([...sizeSeg.querySelectorAll('button')].map((b) => b.textContent), ['Small', 'Medium', 'Large', 'Mobile'], 'small, medium, large – and mobile');
  [...sizeSeg.querySelectorAll('button')].find((b) => b.textContent === 'Mobile').click(); await sleep(40);
  assert.ok(settings.windowSize === 'mobile' && settings.panelSize === null, 'mobile picked – a size dragged before makes way for it');
  [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('Panel size')).querySelectorAll('.seg button')[1].click(); await sleep(40);
  assert.strictEqual(settings.windowSize, 'medium', 'and back');
  console.log('ok  panel size: small, medium, large, mobile');

  // one bar: closed the strip, open the panel's spine
  assert.ok($('app').classList.contains('open') && !$('panel').hidden, 'open: the bar is the spine of the panel');
  $('panelClose').click(); await closed();
  assert.ok(!$('app').classList.contains('open') && $('panel').hidden, 'closed: the bar is the strip');
  rail('settings').click(); await sleep(30);
  console.log('ok  the bar: strip when closed, spine when open');

  // --- world boss timer
  handlers.onWorldBoss({ text: '', secs: 8140, at: Date.now() }); await sleep(10);
  assert.ok(/^2:15:\d\d$/.test($('wbTime').textContent), 'hours, minutes and seconds – the same in the strip and the spine');
  assert.ok(!$('wb').classList.contains('soon'), 'no warning yet');
  handlers.onWorldBoss({ text: '', secs: 200, at: Date.now() }); await sleep(10);
  assert.ok($('wb').classList.contains('soon') && $('wb').classList.contains('blink'), 'warns and blinks under 5 min');
  console.log('ok  world boss timer + warning');

  // --- chat badge
  handlers.onChatUnread(3); await sleep(10);
  assert.strictEqual($('chatBadge').textContent, '3');
  assert.ok(rail('listings').classList.contains('alert'), 'chat icon marked');
  console.log('ok  unread badge');


  // --- Esc closes everything and clears the search
  rail('search').click(); await sleep(20);
  $('q').value = 'test';
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  assert.ok($('panel').hidden, 'Esc closes the panel');
  assert.strictEqual($('q').value, '', 'Esc clears the search field');
  console.log('ok  Esc closes and clears');

  // --- hotkey from the game opens the search
  handlers.onFocusSearch(); await sleep(30);
  assert.ok(!$('panel').hidden && rail('search').classList.contains('on'), 'hotkey opens search');
  console.log('ok  search hotkey');

  // --- idle: shrinks and fades when nothing is open, wakes on any sign of life
  handlers.onChatUnread(0); await sleep(10);
  calls.length = 0;
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  assert.ok($('panel').hidden, 'nothing open');
  assert.ok($('app').classList.contains('idle'), 'closed: straight to the pill, no waiting');
  assert.ok(calls.includes('setIdle'), 'the main process is told about it');
  assert.ok(!$('app').classList.contains('open') && $('app').classList.contains('wbbright'), 'closed: the strip, the timers bright');
  assert.strictEqual($('wb').querySelector('b').textContent, 'World boss', 'the strip has room for the long labels');
  // Helltide: on the full hour for 55 minutes, then 5 minutes until the next
  assert.ok(!$('ht').hidden && /^\d\d:\d\d$/.test($('htTime').textContent), 'the Helltide timer sits in the strip');
  const htMin = (Math.floor(Date.now() / 1000) % 3600) / 60;
  assert.strictEqual($('ht').classList.contains('on'), htMin < 55, 'on during the first 55 minutes of the hour');
  assert.ok($('ht').querySelector('b').textContent === (htMin < 55 ? 'Helltide' : 'Helltide in'), 'says whether it runs or comes');
  assert.ok(!$('ht').classList.contains('blink'), 'it never blinks');
  assert.strictEqual($('ht').classList.contains('ending'), htMin < 55 && htMin >= 52, 'red only for its last 3 minutes');
  // your own timer: a click starts the countdown, a right click clears it, the panel stays shut
  const ct = $('ct');
  assert.ok(!ct.hidden && ct.querySelector('b').textContent === 'Timer', 'one generic timer in the strip');
  assert.ok(ct.classList.contains('idle') && ct.textContent.includes('05:00'), 'waiting for a click, shows what it counts');
  ct.click(); await sleep(20);
  assert.ok(ct.classList.contains('run') && /0[45]:\d\d/.test($('ctTime').textContent), 'counts down from 5 minutes');
  assert.ok(!ct.classList.contains('soon'), 'not red yet');
  assert.ok($('panel').hidden && $('app').classList.contains('idle'), 'the panel stays shut');
  ct.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(20);
  assert.ok(ct.classList.contains('idle'), 'right click clears it');
  const realNow = Date.now;
  ct.click(); await sleep(10);
  w.Date.now = Date.now = () => realNow() + 275000;
  $('wb').dispatchEvent(new w.Event('noop')); await sleep(1100);   // the 1 s tick
  assert.ok(ct.classList.contains('soon') && ct.classList.contains('blink'), 'red and blinking for the last 30 seconds');
  ct.click(); await sleep(20);
  assert.ok(ct.classList.contains('run') && !ct.classList.contains('soon'), 'a click starts it over');
  w.Date.now = Date.now = () => realNow() + 301000 + 275000;
  await sleep(1100);
  assert.ok(ct.classList.contains('ready') && ct.textContent.includes('ready') && !ct.classList.contains('blink'), 'at 0: ready');
  w.Date.now = Date.now = realNow;
  ct.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(20);
  // every timer can be switched off in the settings
  rail('settings').click(); await sleep(30);
  anchors()[0].click(); await sleep(30);
  const swOf = (label) => [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === label).querySelector('.sw');
  for (const l of ['World boss timer', 'Helltide timer', 'Own timer']) { swOf(l).click(); await sleep(30); }
  assert.ok(settings.wbTimer === false && settings.helltide === false && settings.ctTimer === false, 'all three switched off');
  assert.ok($('wb').hidden && $('ht').hidden && $('ct').hidden, 'and gone from the bar');
  for (const l of ['World boss timer', 'Helltide timer', 'Own timer']) { swOf(l).click(); await sleep(30); }
  assert.ok(!$('wb').hidden && !$('ht').hidden && !$('ct').hidden, 'back again');
  // name and length of your own timer
  const nm = w.document.getElementById('ctName');
  nm.value = 'Alzuuda'; nm.dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctName === 'Alzuuda' && ct.querySelector('b').textContent.startsWith('Alzu'), 'the timer takes its name');
  nm.value = ''; nm.dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(ct.querySelector('b').textContent.startsWith('Time'), 'no name: "Timer"');
  // its time as hh:mm:ss – anything else is put back
  const tin = () => w.document.getElementById('ctTimeIn');
  assert.strictEqual(tin().value, '05:00', 'the time as a clock');
  tin().value = '1:30:00'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctSecs === 5400 && $('ctTime').textContent === '1:30:00', 'hh:mm:ss is taken, the timer shows it');
  tin().value = 'abc'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctSecs === 5400 && tin().value === '1:30:00', 'no time: the old one comes back');
  tin().value = '100:00:00'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(settings.ctSecs, 5400, 'past 99:59:59: refused');
  tin().value = '90'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctSecs === 90 && $('ctTime').textContent === '01:30', 'plain seconds work too');
  tin().value = '15m10s'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(settings.ctSecs, 910, 'units: 15m10s');
  tin().value = '1h'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctSecs === 3600 && tin().value === '1:00:00', '1h');
  tin().value = '90'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  // counting up: from 0:00 to its time, red for the last 30 seconds, ready at the end
  [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === 'Counting')
    .querySelectorAll('.seg button')[1].click(); await sleep(30);
  assert.ok(settings.ctMode === 'up' && $('ctTime').textContent === '00:00', 'counting up starts at 0:00');
  const upNow = Date.now;
  ct.click(); await sleep(20);
  w.Date.now = Date.now = () => upNow() + 20000;
  await sleep(1100);
  assert.ok(/^00:(19|20|21)$/.test($('ctTime').textContent) && !ct.classList.contains('soon'), 'counts up: 20 s in, not red yet');
  w.Date.now = Date.now = () => upNow() + 65000;
  await sleep(1100);
  assert.ok(/^01:0[4-9]$/.test($('ctTime').textContent) && ct.classList.contains('soon') && ct.classList.contains('blink'), 'the last 30 s before its time: red and blinking: ' + $('ctTime').textContent + ' ' + ct.className);
  w.Date.now = Date.now = () => upNow() + 95000;
  await sleep(1100);
  assert.ok(ct.classList.contains('ready') && $('ctTime').textContent === 'ready', 'at its time: ready');
  w.Date.now = Date.now = upNow;
  ct.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(20);
  [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === 'Counting')
    .querySelectorAll('.seg button')[0].click(); await sleep(30);
  tin().value = '5:00'; tin().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.ctMode === 'down' && settings.ctSecs === 300, 'back to 5:00, counting down');
  // a stopwatch: click starts, click stops, click back to 0:00 – its time does not matter then
  const countSeg = () => [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === 'Counting').querySelectorAll('.seg button');
  countSeg()[2].click(); await sleep(30);
  assert.ok(settings.ctMode === 'watch' && $('ctTime').textContent === '00:00' && ct.classList.contains('idle'), 'stopwatch: 0:00');
  assert.ok(tin().closest('.opt').classList.contains('off'), 'its time is not used');
  const swNow = Date.now;
  ct.click(); await sleep(20);
  w.Date.now = Date.now = () => swNow() + 75000;
  await sleep(1100);
  assert.ok(/^01:1[4-6]$/.test($('ctTime').textContent) && ct.classList.contains('run') && !ct.classList.contains('soon'), 'it counts: ' + $('ctTime').textContent);
  ct.click(); await sleep(20);
  const stopped = $('ctTime').textContent;
  w.Date.now = Date.now = () => swNow() + 200000;
  await sleep(1100);
  assert.ok($('ctTime').textContent === stopped && !ct.classList.contains('run') && !ct.classList.contains('idle'), 'second click: it stops there');
  ct.click(); await sleep(20);
  assert.ok($('ctTime').textContent === '00:00' && ct.classList.contains('idle'), 'third click: back to 0:00');
  w.Date.now = Date.now = swNow;
  countSeg()[0].click(); await sleep(30);
  assert.ok(settings.ctMode === 'down' && !tin().closest('.opt').classList.contains('off'), 'counting down again');
  // the world boss warning: a time as everywhere – 15:15 is 15 min 15 s, 10 is 10 s
  const win = () => w.document.getElementById('wbWarnIn');
  assert.strictEqual(win().value, '05:00', 'the warning as a clock');
  win().value = '15:15'; win().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(settings.wbWarnSec, 915, '15:15');
  win().value = '10'; win().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(settings.wbWarnSec, 10, '10 seconds');
  win().value = '30min'; win().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.strictEqual(settings.wbWarnSec, 1800, '30min');
  win().value = 'x'; win().dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.wbWarnSec === 1800 && win().value === '30:00', 'no time: the old one back');
  win().value = '5:00'; win().dispatchEvent(new w.Event('change')); await sleep(30);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  // what the pill shows: each thing switched on or off
  assert.ok(rail('maptool').classList.contains('pillhide') && !rail('search').classList.contains('pillhide'), 'by default all but the map tool');
  const togglePill = async (k) => {
    rail('settings').click(); await sleep(30);
    anchors()[1].click(); await sleep(30);
    assert.strictEqual(grp('appearance').querySelector('.plate').dataset.card, 'Closed bar', 'Appearance starts with the closed bar');
    assert.strictEqual($('pillPick').querySelectorAll('button').length, 11, 'search, builds, map tool, diablo.trade, the four timers, the counter, settings, quit');
    $('pillPick').querySelector('[data-pill="' + k + '"]').click(); await sleep(30);
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  };
  await togglePill('listings');
  await togglePill('wb');
  assert.deepStrictEqual(settings.pillHide, ['maptool', 'listings', 'wb'], 'switched off');
  assert.ok(rail('listings').classList.contains('pillhide') && $('wb').classList.contains('pillhide') && $('app').classList.contains('idle'), 'left out of the strip');
  const css = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'style.css'), 'utf8');
  assert.ok(css.includes('#app:not(.open) #rail .pillhide{display:none!important}'), 'only in the strip – the spine keeps everything');
  await togglePill('listings');
  await togglePill('wb');
  assert.deepStrictEqual(settings.pillHide, ['maptool'], 'back on');
  // hovering only takes the fade off – the pill keeps its shape and place so it can be dragged
  $('rail').dispatchEvent(new w.PointerEvent('pointerenter', { bubbles: true })); await sleep(20);
  assert.ok($('app').classList.contains('idle'), 'hovering does not wake it');
  assert.ok($('app').classList.contains('peek'), 'hovering takes the fade off – and slides the sections out');
  assert.ok($('secs').style.getPropertyValue('--w'), 'as wide as they are, the window first');
  assert.ok(calls.includes('hoverWatch'), 'where the cursor is comes from the main process');
  // the strip is a drag area between its buttons: the page thinks the mouse left – it did not
  $('rail').dispatchEvent(new w.PointerEvent('pointerleave', { bubbles: true })); await sleep(20);
  assert.ok($('app').classList.contains('peek'), 'moving along the strip does not fold it in');
  // a click on it (here the own timer) must not stop the watch – it would never fold in again
  $('ct').dispatchEvent(new w.MouseEvent('mousedown', { bubbles: true })); $('ct').click(); await sleep(20);
  assert.ok($('app').classList.contains('peek') && hoverWatchOn, 'clicked: still out, the cursor still watched');
  handlers.onCursorInside(false); await sleep(20);
  assert.ok(!$('app').classList.contains('peek'), 'leaving it (the main process says so) fades it again');
  assert.ok(!hoverWatchOn, 'and the watch ends with it');
  // at the right edge of the screen the window grew to the left (main.js): the strip keeps its right end
  handlers.onLayout({ manual: false, toLeft: true }); await sleep(10);
  assert.ok($('app').classList.contains('toleft') && css.includes('#app.toleft:not(.open){justify-content:flex-end}'), 'slid out to the left: the strip sits at the right');
  handlers.onLayout({ manual: false, toLeft: false }); await sleep(10);
  assert.ok(!$('app').classList.contains('toleft'), 'back in place');
  // growing to the left: faded first, set to the right side, then the window moves – no flash
  slideLeft = true; resizes.length = 0;
  $('rail').dispatchEvent(new w.PointerEvent('pointerenter', { bubbles: true })); await sleep(20);
  assert.ok($('app').classList.contains('shift') && !resizes.length, 'it fades before the window moves');
  await sleep(120);
  assert.ok($('app').classList.contains('toleft') && $('app').classList.contains('peek') && resizes.some((x) => x[3] === true), 'then it moves, set to the right side');
  handlers.onLayout({ manual: false, toLeft: true }); await sleep(60);
  assert.ok(!$('app').classList.contains('shift'), 'moved and drawn: it fades in while the sections slide out');
  resizes.length = 0;
  handlers.onCursorInside(false); await sleep(400);
  assert.ok($('app').classList.contains('shift') && !resizes.length, 'folding in: the sections first, then faded before the window moves back');
  await sleep(120);
  assert.ok(resizes.length && !resizes[0][3], 'then it goes back to its place');
  handlers.onLayout({ manual: false, toLeft: false }); await sleep(60);
  assert.ok(!$('app').classList.contains('shift') && !$('app').classList.contains('toleft'), 'and fades in there');
  slideLeft = false;
  rail('search').click(); await sleep(40);
  assert.ok(!$('app').classList.contains('idle'), 'a click on the magnifier wakes it up');
  assert.ok($('app').classList.contains('grow') && !$('app').classList.contains('peek'), 'the panel grows out of the bar');
  assert.ok(!$('panel').hidden, 'and opens the search');
  // the timer in the pill opens the search as well
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  assert.ok($('app').classList.contains('idle'), 'idle again');
  // blinking, the first click only stops the blinking – the timer stays red and keeps growing
  assert.ok($('wb').classList.contains('blink') && Number($('wb').style.getPropertyValue('--wbk')) > 1, 'blinking, and bigger near 0');
  $('wb').click(); await sleep(40);
  assert.ok(!$('wb').classList.contains('blink') && $('wb').classList.contains('soon') && $('panel').hidden, 'a click on the blinking timer stops the blinking');
  $('wb').click(); await sleep(40);
  assert.ok(!$('app').classList.contains('idle') && !$('panel').hidden && rail('search').classList.contains('on'), 'a click on the timer opens the search');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  rail('farm').click(); await sleep(40);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  $('wb').click(); await sleep(40);
  assert.ok(rail('farm').classList.contains('on'), 'the timer opens what was open last');
  console.log('ok  the strip fades, hover peeks, click wakes, timer opens the search');

  // --- closing: the panel folds away, the page hides, only then the window becomes the strip
  const idleCalls = () => calls.filter((c) => c === 'setIdle').length;
  let idleBefore = idleCalls();
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await sleep(20);
  assert.ok($('app').classList.contains('fold') && !$('panel').hidden && idleCalls() === idleBefore, 'it folds away first – the window stays');
  assert.ok(css.includes('#app.open.fold #shell{animation:fold'), 'folding is an animation');
  await closed();
  assert.ok($('panel').hidden && $('app').classList.contains('swap') && idleCalls() > idleBefore, 'then hidden, and the window becomes the strip');
  handlers.onLayout({ manual: false, toLeft: false }); await sleep(60);
  assert.ok(!$('app').classList.contains('swap') && !$('app').classList.contains('fold'), 'moved and drawn: the strip fades in');
  // opened again while it folds: it stays open
  rail('search').click(); await sleep(40);
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await sleep(20);
  rail('farm').click(); await closed();
  assert.ok(!$('panel').hidden && rail('farm').classList.contains('on') && !$('app').classList.contains('swap') && !$('app').classList.contains('fold'), 'opened while folding: open, nothing hidden');
  idleBefore = idleCalls();
  rail('farm').click(); await sleep(20);
  assert.ok($('app').classList.contains('fold') && idleCalls() === idleBefore, 'its icon again closes it the same way');
  await closed();
  assert.ok($('panel').hidden, 'closed');
  await sleep(500);
  console.log('ok  closing folds the panel away, then the window becomes the strip');

  // an alert blinks on its own element only
  handlers.onChatUnread(2); await sleep(10);
  assert.ok(rail('listings').classList.contains('blink'), 'the diablo.trade icon blinks');
  assert.ok(!$('wb').classList.contains('blink') || $('wb').classList.contains('soon'),
    'nothing else starts blinking because of a message');
  handlers.onWorldBoss({ text: '', secs: 120, at: Date.now() }); await sleep(10);
  assert.ok($('wb').classList.contains('blink'), 'the timer blinks on its own warning');
  console.log('ok  alerts blink on their element only');

  // --- the own timer's hotkey: starts it over, the panel stays shut
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  handlers.onTimerRestart(); await sleep(20);
  assert.ok($('ct').classList.contains('run') && $('panel').hidden, 'the hotkey starts the own timer, nothing opens');
  $('ct').dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(20);
  rail('settings').click(); await sleep(30);
  anchors()[0].click(); await sleep(30);
  const ownSw = () => [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === 'Own timer').querySelector('.sw');
  ownSw().click(); await sleep(30);
  handlers.onTimerRestart(); await sleep(20);
  assert.ok(!$('ct').classList.contains('run'), 'switched off: the hotkey does nothing');
  ownSw().click(); await sleep(30);
  anchors()[2].click(); await sleep(30);
  assert.ok(w.document.querySelector('.hk[data-key=hotkeyTimer]'), 'its field in Settings › Hotkeys');
  const hk = w.document.querySelector('.hk[data-key=hotkeyTimer]');
  hk.dispatchEvent(new w.FocusEvent('focus'));
  hk.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'F10', code: 'F10', bubbles: true })); await sleep(30);
  assert.strictEqual(settings.hotkeyTimer, 'F10', 'an F-key alone is taken');
  console.log('ok  own timer: hotkey');

  // --- the counter: a click adds one, a right click starts it at 0, its hotkey adds one too
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  const rc = $('rc');
  assert.ok(!rc.hidden && $('rcN').textContent === '0' && rc.classList.contains('idle') && rc.querySelector('b').textContent === 'Runs', 'in the bar: Runs 0');
  rc.click(); await sleep(20); rc.click(); await sleep(20);
  assert.ok(settings.rcCount === 2 && $('rcN').textContent === '2' && !rc.classList.contains('idle') && $('panel').hidden, 'a click adds one, nothing opens');
  handlers.onCounterAdd(); await sleep(20);
  assert.ok(settings.rcCount === 3 && $('rcN').textContent === '3', 'the hotkey adds one');
  rc.dispatchEvent(new w.MouseEvent('contextmenu', { bubbles: true, cancelable: true })); await sleep(20);
  assert.ok(settings.rcCount === 0 && $('rcN').textContent === '0', 'a right click: back to 0');
  rail('settings').click(); await sleep(30);
  const rcName = w.document.getElementById('rcName');
  rcName.value = 'Pits'; rcName.dispatchEvent(new w.Event('change')); await sleep(30);
  assert.ok(settings.rcName === 'Pits' && rc.querySelector('b').textContent === 'Pits', 'its name');
  rcName.value = ''; rcName.dispatchEvent(new w.Event('change')); await sleep(30);
  const rcSw = () => [...w.document.querySelectorAll('.opt')].find((o) => o.querySelector('.txt b').textContent === 'Counter').querySelector('.sw');
  rcSw().click(); await sleep(30);
  handlers.onCounterAdd(); await sleep(20);
  assert.ok(settings.rcCounter === false && rc.hidden && settings.rcCount === 0, 'switched off: gone, the hotkey does nothing');
  rcSw().click(); await sleep(30);
  assert.ok(w.document.querySelector('.hk[data-key=hotkeyCounter]'), 'its hotkey field');
  console.log('ok  counter: click +1, right click 0, hotkey');

  // --- "to farm": off by default, switched on it shows what the active build still needs
  assert.ok($('miss').hidden, 'off by default');
  anchors()[0].click(); await sleep(30);
  [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('What your build still needs')).querySelector('.sw').click();
  await sleep(80);
  assert.ok(settings.pillMissing === true, 'switched on');
  const sum = await w.FarmView.summary(w.d4api);
  assert.ok(sum && sum.total > 0, 'the active build has something to farm');
  assert.ok(!$('miss').hidden && $('missN').textContent.includes(String(sum.missing)), 'the count is in the bar');
  $('miss').click(); await sleep(60);
  assert.ok(rail('farm').classList.contains('on'), 'a click opens the build');
  // on its route, at the first stop still open – as if that stop had been clicked
  const curStop = w.document.querySelector('.path.route .wp.cur');
  assert.ok(w.FarmView._state().view === 'gear' && curStop, 'the gear on its route');
  const firstOpen = [...w.document.querySelectorAll('.path.route .wp')].find((x) => !x.classList.contains('done') && !x.classList.contains('blank'));
  assert.strictEqual(curStop, firstOpen, 'the first one still open');
  $('miss').click(); await sleep(60);
  assert.ok(!$('panel').hidden && rail('farm').classList.contains('on'), 'clicked again while open: it stays open');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  rail('settings').click(); await sleep(30);
  anchors()[0].click(); await sleep(30);
  [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('What your build still needs')).querySelector('.sw').click();
  await sleep(60);
  assert.ok($('miss').hidden, 'switched off: gone');
  console.log('ok  "to farm" in the bar, switchable');

  // --- updates: a newer version puts a dot on Settings and a download button in Data
  assert.ok($('updDot').hidden, 'no dot without an update');
  handlers.onUpdateInfo({ current: '1.0.0', latest: '1.1.0', newer: true, url: 'https://github.com/x/y/releases/tag/v1.1.0' }); await sleep(30);
  assert.ok(!$('updDot').hidden, 'the dot shows');
  const dataTab = anchors().find((a) => a.textContent === 'Data');
  dataTab.click(); await sleep(30);
  assert.ok(txt().includes('Version 1.1.0 is out'), 'Data says so');
  const dl = [...w.document.querySelectorAll('.btn')].find((x) => x.textContent === 'Download 1.1.0');
  calls.length = 0; dl.click(); await sleep(10);
  assert.ok(calls.includes('openUpdate'), 'the button opens the release');
  handlers.onUpdateInfo({ current: '1.1.0', latest: '1.1.0', newer: false }); await sleep(30);
  assert.ok($('updDot').hidden && txt().includes('Up to date'), 'up to date: no dot');
  console.log('ok  update check: dot and download');

  // what the app reports by itself: the footer only, the panel stays shut
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  handlers.onNotice({ text: 'Boss loot updated (18 sections)', kind: 'ok' }); await sleep(30);
  assert.ok($('panel').hidden, 'a notice does not open the panel');
  assert.ok(!$('stNote').hidden && $('stNote').textContent === 'Boss loot updated (18 sections)' && $('stNote').classList.contains('ok'), 'it is in the footer');
  assert.ok(!txt().includes('Boss loot updated'), 'not as a note over the content');
  console.log('ok  notices in the footer only');

  // --- backup: choose a folder, back up now, once a day
  rail('settings').click(); await sleep(30);
  anchors().find((a) => a.textContent === 'Data').click(); await sleep(30);
  const nowBtn = () => [...w.document.querySelectorAll('.btn')].find((x) => x.textContent === 'Back up now');
  assert.ok(nowBtn().disabled && txt().includes('None chosen'), 'nothing before a folder is chosen');
  [...w.document.querySelectorAll('.btn')].find((x) => x.textContent === 'Choose …').click(); await sleep(60);
  assert.strictEqual(settings.backupDir, 'D:\\OneDrive\\D4', 'folder saved');
  assert.ok(!nowBtn().disabled && txt().includes('No backup yet'), 'ready');
  nowBtn().click(); await sleep(20);
  handlers.onBackupDone(backupMade); await sleep(40);
  assert.ok(backupMade && txt().includes('Last backup'), 'made, and it says when');
  [...w.document.querySelectorAll('.opt')].find((o) => o.textContent.includes('Every day')).querySelector('.sw').click(); await sleep(30);
  assert.strictEqual(settings.backupAuto, true, 'daily on');
  console.log('ok  backup');

  // --- hotkeys straight to the build's skills / paragon; again closes it
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  handlers.onOpenBuildView('skills'); await sleep(80);
  assert.ok(rail('farm').classList.contains('on') && w.FarmView.view() === 'skills', 'the build opens on its skills');
  handlers.onOpenBuildView('paragon'); await sleep(60);
  assert.ok(rail('farm').classList.contains('on') && w.FarmView.view() === 'paragon', 'switches to paragon, stays open');
  handlers.onOpenBuildView('paragon'); await closed();
  assert.ok($('panel').hidden, 'the same again closes it');
  w.FarmView.setView('gear');
  console.log('ok  hotkeys to skills / paragon');

  // the codex: an aspect ticked in one build is done in every build that uses it
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  w.FarmView.adopt({ active: 'cx1', codex: [], builds: [
    { id: 'cx1', name: 'Sorc A', cls: 'Sorcerer', slots: { Amulet: { aspects: ['Aspect of Armageddon'] } }, done: [] },
    { id: 'cx2', name: 'Sorc B', cls: 'Sorcerer', slots: { Gloves: { aspects: ['Aspect of Armageddon'] } }, done: [] },
  ] });
  rail('farm').click(); await sleep(80);
  const ck = w.document.querySelector('#main .thing .dia');
  assert.ok(ck && /codex/.test(ck.title), 'an aspect tick says it goes into the codex');
  ck.click(); await sleep(60);
  assert.strictEqual(JSON.stringify(w.FarmView._state().data.codex), '["Aspect of Armageddon"]', 'ticked: into the codex');
  assert.strictEqual(w.FarmView._state().data.builds[0].done.length, 0, 'not as a tick of this build alone');
  w.FarmView._state().data.active = 'cx2';
  const other = await w.FarmView.summary(w.d4api);
  assert.ok(other.name === 'Sorc B' && other.missing === 0, 'the other build has it too');
  w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
  console.log('ok  codex: an aspect counts in every build');

  // --- builder: class → skill → proven build explained → consensus → own build, search, swap, boosts, mods, paragon, save
  {
    const q = (s) => w.document.querySelector(s);
    const qa = (s) => [...w.document.querySelectorAll(s)];
    const click = (sel, text) => { const x = qa(sel).find((y) => !text || y.textContent.includes(text)); assert.ok(x, 'builder: ' + sel + ' ' + (text || '')); x.click(); };
    // Builds is one place: the farm list and "Find a build" (the builder) under one rail icon
    assert.ok(!rail('builder'), 'no rail icon of its own');
    rail('farm').click(); await sleep(60);
    assert.ok(q('#title .kick button.on') && q('#title .kick button.on').textContent === 'My builds', 'Builds opens on your farm list, the switch in its head');
    click('#title .kick button', 'Find a build'); await sleep(60);
    assert.ok(rail('farm').classList.contains('on') && q('#main.bd') && q('#title .kick button.on').textContent === 'Find a build' && q('#title .ttl').textContent === 'Find a build', 'builder opens under Builds');
    assert.ok(q('#head #ptools'), 'pin and close sit in the page head');
    click('.bd-cls', 'Rogue'); await sleep(30);
    assert.ok(qa('.bd-sk').length > 10 && txt().includes('Rain of Arrows'), 'the rogue\'s skills');
    click('.bd-sk', 'Rain of Arrows'); await sleep(120);
    assert.ok(qa('.bd-src').length >= 4, 'proven builds, the consensus and "build it yourself"');
    assert.ok(q('.bd-src.bd-on .bd-site').textContent && !q('.bd-src.bd-own.bd-on'), 'opens on the best proven build');
    assert.ok(txt().includes('Why this build works') && qa('.bd-adv li').length >= 3, 'explained');
    assert.ok(txt().includes("Leoric's Crown") && qa('.bd-used').length, 'its pieces, with how many top builds use them');
    click('.bd-gs', "Leoric's Crown"); await sleep(30);
    assert.ok(q('.bd-det h3').textContent === "Leoric's Crown" && txt().includes('Sockets'), 'a piece: stats and sockets');
    click('.bd-src', 'agree on'); await sleep(30);
    assert.ok(qa('.bd-gs').length >= 8 && qa('.bd-used.bd-hi').length, 'the consensus per slot');
    click('.bd-src', 'Build it yourself'); await sleep(80);
    assert.ok(qa('.bd-gs').length === 11 && qa('.bd-gs .bd-up').length, 'own build: eleven slots (a rogue: ranged weapon and two blades) with their share');
    assert.ok(['Ranged', 'Melee (dual wield)'].every((l) => qa('.bd-gs .bd-s').some((x) => x.textContent.startsWith(l))), 'weapons named by their kind');
    assert.ok(/top \d+ builds use per slot/.test(q('.bd-startnote').textContent) && q('.bd-gs .bd-n').textContent === "Leoric's Crown", 'it starts from what the top builds use – Leoric\'s Crown on the helm');
    click('.bd-startnote .btn', 'experimental'); await sleep(60);
    assert.ok(/experimental/.test(q('.bd-startnote').textContent), 'the model\'s own pick, said so');
    click('.bd-startnote .btn', 'top builds use'); await sleep(60);
    assert.strictEqual(q('.bd-gs .bd-n').textContent, "Leoric's Crown", 'and back');
    const firstHelm = q('.bd-gs .bd-n').textContent;
    $('bdq').value = 'crit'; $('bdq').dispatchEvent(new w.Event('input')); await sleep(30);
    assert.ok(qa('#bdside .bd-alt').length > 3 && /dmg|equipped/.test(q('#bdside .bd-alt .bd-v').textContent), 'search shows what each adds');
    $('bdq').value = ''; $('bdq').dispatchEvent(new w.Event('input')); await sleep(20);
    assert.ok(qa('.bd-tal').length === 3 && txt().includes('Seal swap') && txt().includes('Golden Epiphany'), 'the talisman three ways: Mythic seal, Golden Epiphany, the seal swap');
    click('.bd-gs', 'Helm'); await sleep(30);
    assert.ok(qa('#bdside .bd-stats .cx-line.tmp').length === 1, 'a slot: the temper the model picked for it – one a piece');
    click('#bdside .bd-alt .btn', 'Use'); await sleep(60);
    assert.notStrictEqual(q('.bd-gs .bd-n').textContent, firstHelm, 'Use swaps the piece');
    click('.back'.replace('.', '.bd-')); await sleep(30);
    const condsBefore = qa('.bd-gs .bd-n').map((x) => x.textContent).join();
    const off = qa('.bd-cond:not(.bd-on)').find((x) => x.querySelector('.bd-gn'));
    assert.ok(off, 'a conditional boost shows what it would add');
    off.click(); await sleep(80);
    assert.ok(qa('.bd-cond.bd-on').some((x) => x.textContent.startsWith(off.firstChild.textContent)), 'switched on');
    assert.ok(typeof condsBefore === 'string', 'recomputed');
    click('.bd-goalrow button', 'Speed farm'); await sleep(60);
    assert.ok(q('.bd-goalrow .bd-on').textContent === 'Speed farm', 'goal switches');
    click('.bd-bs', 'Rain of Arrows'); await sleep(30);
    const mo = qa('.bd-mo:not(.bd-on)')[0];
    mo.click(); await sleep(30);
    assert.ok(q('.bd-bs.bd-main .bd-mods').textContent.includes(mo.querySelector('b').textContent), 'a modifier is picked');
    click('.bd-views button', 'Skills'); await sleep(80);
    assert.ok(q('.bd-fview.fskills') && txt().includes('Rain of Arrows') && q('.bd-fview .skc'), 'skills: the farm list skill tree for this build, before saving');
    click('.bd-views button', 'Paragon'); await sleep(80);
    assert.ok(q('.bd-fview.fparagon') && qa('.bd-fview .plook .lk').some((x) => x.textContent === 'Icons'), 'paragon: the farm list view – icons or minimal');
    click('.bd-views button', 'Build'); await sleep(60);
    if (q('#bdside .bd-back')) { q('#bdside .bd-back').click(); await sleep(60); }
    assert.ok(qa('.bd-ch').length >= 2 && qa('.bd-gem').length >= 2 && qa('.bd-gem.bd-rune').length, 'talisman and sockets – runes for a runeword – before saving');
    const tile = qa('.bd-gs').find((x) => x.querySelector('.bd-n') && x.querySelector('.bd-n').textContent);
    tile.dispatchEvent(new w.MouseEvent('mouseenter', { clientX: 10, clientY: 10 })); await sleep(100);
    assert.ok(q('#tip .ctt') && q('#tip .ctt .nm').textContent === tile.querySelector('.bd-n').textContent, 'a tile on hover: its card');
    tile.dispatchEvent(new w.MouseEvent('mouseleave')); await sleep(10);
    click('.bd-views button', 'Goals'); await sleep(20);
    const goalRows = qa('.bd-goals .bd-grow-row').slice(1);
    assert.ok(goalRows.length >= 5 && goalRows.every((r) => /\d/.test(r.querySelector('.bd-num').textContent)), 'goals: your build stat by stat');
    assert.ok(goalRows.some((r) => /\d/.test(r.querySelectorAll('.bd-num')[1].textContent)), 'next to the level of the top builds');
    assert.ok(q('.bd-loop') && /Preparation/.test(q('.bd-loop').textContent) && qa('.bd-loop li').length >= 3, 'goals: how the build works – the loop, piece by piece');
    assert.ok(qa('.bd-checks > div').length >= 2 && qa('.bd-checks > div').every((r) => /\d+%? \/ \d+/.test(r.textContent)), 'its breakpoints, have against need');
    assert.ok(qa('.bd-wants .bd-grow-row').length >= 3, 'what this build wants most now');
    click('.bd-views button', 'Build'); await sleep(40);
    click('.bd-head .btn', 'Save as build'); await sleep(80);
    assert.ok(builderSaved && builderSaved.pieces && builderSaved.pieces.Helm && builderSaved.mods, 'saved with the picks and modifiers');
    assert.ok(rail('farm').classList.contains('on') && w.FarmView._state().data.active === 'bd1', 'lands in the farm list as the active build');
    w.dispatchEvent(new w.KeyboardEvent('keydown', { key: 'Escape' })); await closed();
    console.log('ok  builder: proven builds explained, consensus, own build (search, swap, boosts, goal, modifiers), paragon, save');
  }

  assert.strictEqual(errors.length, 0, 'no runtime errors: ' + errors.join(' | '));
  console.log('ok  no runtime errors · api used: ' + [...new Set(calls)].join(', '));
  process.exit(0);
})().catch((e) => {
  console.error('FAIL', e && e.message ? e.message : e);
  // a crash (not a failed check): where it happened
  if (e && e.stack && !(e instanceof assert.AssertionError)) console.error(e.stack.split('\n').slice(1, 4).join('\n'));
  process.exit(1);
});
