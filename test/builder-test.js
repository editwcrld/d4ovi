// The builder's engine: the damage formula, reading item texts, the optimizer, the proven build lists.
//   node test/builder-test.js
const assert = require('assert');
const M = require('../lib/dmgmodel');
const O = require('../lib/optimizer');
const pb = require('../lib/provenbuilds');
const builder = require('../lib/builder');

const prof = (o) => Object.assign({ noun: 'Whirlwind', groups: ['Core', 'Channeled'], el: 'Physical', minion: false, dot: false, channeled: true, mainStat: 'Strength',
  otherSkills: ['Double Swing', 'Leap', 'Upheaval', 'Rend', 'Charge', 'Deep Freeze'] }, o || {});
const kinds = (fx) => fx.map((e) => e.kind + (e.v ? ':' + e.v : '') + (e.scope === 'other' ? '/other' : '') + (e.cond.length ? '(' + e.cond.join('+') + ')' : '')).join(' ');

(async () => {
  // ---- the formula: d4guides' own worked example (Paladin, Holy, Season 15) comes out to the hit
  {
    const st = Object.assign(M.baseState(1.625), { w: 2000, skill: 150, stat: 1000, add: 300, bucket: 40, sep: [30], crit: 40, csdp: 100, csdx: 60, vulnUp: 100, vulnx: 25 });
    assert.strictEqual(Math.round(M.damage(st).hit), 154791, 'the d4guides example: 154,791 per hit');
    assert.strictEqual(+M.damage(st).f.critF.toFixed(3), 3, 'its crit factor: 3.0');
    assert.strictEqual(M.rankValue(10), 2, 'skill rank 10 doubles the rank 1 value (120% -> 240%)');
    assert.strictEqual(+M.rankValue(20).toFixed(2), 3.1, 'rank 20: 372% from 120%');
    const dot = Object.assign({}, st, { dot: true });
    assert.strictEqual(M.damage(dot).f.critAvg, 1, 'damage over time cannot crit');
    console.log('ok  formula: the d4guides example, skill ranks, no crits for damage over time');
  }

  // ---- reading texts
  {
    const p = prof();
    assert.strictEqual(kinds(M.parseEffects('While channeling a Skill, all damage is increased by 70%[x].', p)), 'x:70(channel)', 'Aspect of Channeling: a multiplier while channeling (the builder switches that on for a channeled skill)');
    assert.strictEqual(kinds(M.parseEffects("Double Swing's initial sweep deals 60%[x] increased damage and applies Vulnerable. Subsequent swings deals 120%[x] increased damage and grants Berserking for 3 seconds.", p)).split(' ').filter((x) => x.startsWith('x:')).every((x) => x.includes('/other')), true,
      'Twin Strikes is about Double Swing – the sentence after it too');
    assert.ok(/ccx:65.*cdx:65/.test(kinds(M.parseEffects("Whirlwind's Critical Strike Chance and Critical Strike Damage are increased by 13%[x] for each second it is channeled, up to 65%[x].", p))), 'Dire Whirlwind: crit chance and crit damage, at its maximum');
    assert.strictEqual(kinds(M.parseEffects('You deal 50%[x] increased damage, doubled against Crowd Controlled enemies.', p)), 'x:50', '"doubled against …" does not hang the base on a condition');
    assert.ok(/x:20/.test(kinds(M.parseEffects('Enemies damaged by your Core, Basic, or Ultimate Skills take 20%[x] increased damage from you each.', p))) && !/other/.test(kinds(M.parseEffects('Enemies damaged by your Core, Basic, or Ultimate Skills take 20%[x] increased damage from you each.', p))), 'a list of skill groups counts when one is ours');
    assert.ok(/other/.test(kinds(M.parseEffects('Your Arrow Storms deal 120%[x] increased damage.', prof({ noun: 'Rain of Arrows', groups: ['Ultimate', 'Marksman'] })))), 'a side effect (Arrow Storms) is not the skill');
    const hell = M.parseEffects('You deal 50%[x] increased damage, but lose 100% Critical Strike Chance.', p);
    assert.ok(/cc:-100/.test(kinds(hell)) && /x:50/.test(kinds(hell)), 'Splinter of Hellfire: the multiplier and the lost crits');
    const souls = M.parseEffects('Your kills absorb a soul for 10 seconds. Each soul increases your damage by 2.5%[x] but increases your damage taken by 1%. This effect stacks up to 200 times, but does not refresh.', p);
    let s = Object.assign(M.baseState(0.8), { souls: 40 });
    for (const e of souls) s = M.apply(s, e, {});
    assert.deepStrictEqual([s.sep[0], s.taken], [100, 40], 'Black Soulstone: per soul held, damage and damage taken');
    assert.ok(/teleport/.test(kinds(M.parseEffects("Your Evade is now Sorcerer's Teleport and costs 33 Primary Resource.", p))), 'Enigma: Evade becomes Teleport');
    assert.deepStrictEqual(M.rollOf('x[26 - 50]% Critical Strike Damage Multiplier', p), { k: 'csdx', v: 50 }, 'a stat line at its best roll');
    assert.deepStrictEqual(M.rollOf('+[2 - 3] to Whirlwind', p), { k: 'rank', v: 3 }, 'ranks to the main skill');
    assert.strictEqual(M.rollOf('x22% Fire and Holy Damage Multiplier', p), null, 'a ruby does nothing for physical damage');
    assert.deepStrictEqual(M.rollOf('+100% Main Hand Weapon Damage', p), { k: 'wpct', v: 100 }, 'runeword shields raise the weapon damage');
    assert.strictEqual(M.parseEffects('Lucky Hit: Up to a 40.0% Chance to deliver a Crushing Blow', p)[0].kind, 'proc', 'a proc stays a proc – not a guessed percentage');
    console.log('ok  texts: multipliers, who a sentence is about, conditions, splinters, souls, Teleport, stat lines');
  }

  // ---- the optimizer: one mythic, every slot, the multiplier first, shares that add up to the build
  {
    const fx = (t) => M.parseEffects(t, prof());
    const cands = [
      { name: 'Big Mythic', kind: 'unique', mythic: true, slots: ['Helm'], effects: fx('You deal 100%[x] increased damage.') },
      { name: 'Other Mythic', kind: 'unique', mythic: true, slots: ['Gloves'], effects: fx('You deal 90%[x] increased damage.') },
      { name: 'Channeling', kind: 'aspect', slots: ['Ring', 'Gloves'], effects: fx('While channeling a Skill, all damage is increased by 70%[x].') },
      { name: 'Additive', kind: 'aspect', slots: ['Ring', 'Gloves'], effects: fx('You deal 40%[+] increased damage.') },
      { name: 'Wall', kind: 'aspect', slots: ['Pants'], effects: fx('Gain 40% Damage Reduction.') },
    ];
    const st = M.baseState(0.8);
    const on = { channel: true };
    const r = O.fillGear(cands, st, on, O.GOALS.push, ['Helm', 'Gloves', 'Ring1', 'Pants']);
    const names = Object.values(r.placed).map((c) => c.name);
    assert.strictEqual(names.filter((n) => /Mythic/.test(n)).length, 1, 'only one mythic');
    assert.strictEqual(r.placed.Helm.name, 'Big Mythic', 'the bigger mythic');
    assert.strictEqual(r.placed.Pants.name, 'Wall', 'toughness where only toughness fits');
    assert.ok(names.includes('Channeling') && names.includes('Additive'), 'the rest filled');
    const sh = O.shares(cands, r.placed, st, on, O.GOALS.push);
    assert.ok(Math.abs(sh.out.Helm.dmg - 100) < 0.01, 'a separate [x] adds exactly its value');
    assert.ok(sh.out.Pants.tough > 60 && sh.out.Pants.dmg === 0, '40% damage reduction = +66.7% toughness');
    const noChannel = O.fillGear(cands, st, {}, O.GOALS.push, ['Ring1']);
    assert.strictEqual(noChannel.placed.Ring1.name, 'Additive', 'a condition that is off counts nothing');
    console.log('ok  optimizer: one mythic, multipliers first, toughness, conditions, shares');
  }

  // ---- proven builds: infinitybuilds' list page, maxroll's tier list, what builds agree on
  {
    const inner = JSON.stringify('x:["$","$L52",null,{"builds":[{"id":"a","slug":"mekunas-blazing-scream-warlock-rn","title":"Mekuna\'s Blazing Scream","classId":"warlock","authorName":"Mekuna","activity":["endgame"],"season":15,"likeCount":514,"isFeatured":true},{"id":"b","slug":"x-y","title":"Old","classId":"rogue","authorName":"Z","season":14,"likeCount":3}]}]');
    const html = '<script>self.__next_f.push([1,' + inner + '])</script>';
    const l = pb.parseInfinityList(html);
    assert.strictEqual(l.length, 2, 'both builds read');
    assert.deepStrictEqual([l[0].cls, l[0].author, l[0].likes, l[0].url], ['Warlock', 'Mekuna', 514, 'https://infinitybuilds.gg/en/builds/mekunas-blazing-scream-warlock-rn'], 'class, author, likes, link');
    const tl = builder.parseTierList('{"name":"Whirlwind Barb","icon":"d4/barbarian","iconImageUrl":"x.webp","link":"https://maxroll.gg/d4/build-guides/whirlwind-barbarian-guide","tier":"S"}');
    assert.deepStrictEqual(tl[0], { name: 'Whirlwind Barb', cls: 'Barbarian', url: 'https://maxroll.gg/d4/build-guides/whirlwind-barbarian-guide', tier: 'S' }, 'a maxroll tier list entry');
    const v = (helm, ring) => ({ variants: [{ name: 'v', slots: { Helm: { item: helm }, Ring1: { aspects: [ring] }, Ring2: { aspects: ['Aspect of Aftermath'] } }, skills: { bar: [{ name: 'Rain of Arrows', mods: ['Crashing Waves'] }] }, charms: { sets: [{ name: 'Legacy of the Sightless' }] } }], preselect: 0 });
    const loads = { u1: v("Leoric's Crown", 'Scoundrel\'s Kiss'), u2: v("Leoric's Crown", 'Aspect of Aftermath'), u3: v('Harlequin Crest', 'Scoundrel\'s Kiss') };
    const c = await pb.consensus([{ url: 'u1', site: 'maxroll.gg' }, { url: 'u2', site: 'd2core.com', author: 'A' }, { url: 'u3', site: 'infinitybuilds.gg', author: 'B' }], async (u) => loads[u]);
    assert.strictEqual(c.n, 3, 'three builds');
    assert.deepStrictEqual([c.slots.Helm[0].name, c.slots.Helm[0].n], ["Leoric's Crown", 2], 'the most used helm');
    assert.strictEqual(c.pieces.find((e) => e.name === 'Aspect of Aftermath').n, 3, 'a piece counts once per build, wherever it sits');
    assert.strictEqual(c.mods[0].name, 'Rain of Arrows · Crashing Waves', 'skills and modifiers counted');
    console.log('ok  proven builds: infinitybuilds list, maxroll tier list, consensus per slot');
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });
