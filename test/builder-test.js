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
    // toughness (maxroll's defence guide): ratings, no caps – 10,000 Armor = 59.6% less of every damage
    const t0 = M.toughness(M.baseState(1));
    const armored = M.toughness(Object.assign(M.baseState(1), { armor: 10000 }));
    assert.strictEqual((armored / t0).toFixed(3), (1 / (1 - 10000 / (10000 * 10 / 9 + 5678))).toFixed(3), 'Armor: A / (A × 10/9 + 5678), against all damage');
    assert.ok(M.toughness(Object.assign(M.baseState(1), { armor: 1e7 })) / t0 < 10.01, 'it nears 90% and never passes it');
    assert.ok(M.toughness(Object.assign(M.baseState(1), { res: { Fire: 3000 } })) / t0 < M.toughness(Object.assign(M.baseState(1), { resAll: 3000 })) / t0, 'one resistance counts for one type of six');
    assert.strictEqual(M.toughness(Object.assign(M.baseState(1), { mainStat: 'Strength', stat: 1000 })), M.toughness(Object.assign(M.baseState(1), { armor: 2000 })), 'Strength: 2 Armor a point');
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
    const lucky = M.parseEffects('Lucky Hit: Your Skills have up to a 100% chance to deal 120%[x] increased damage.', p);
    const at = (lhc) => lucky.reduce((x, e) => M.apply(x, e, { luckyhit: true }), Object.assign(M.baseState(1), { lhc })).sep[0];
    assert.deepStrictEqual([at(12).toFixed(1), at(50), at(null)], ['14.4', 60, 120], 'Lucky Hit: skill Lucky Hit Chance × the effect\'s chance (unknown skill chance: whole)');
    const withGear = lucky.reduce((x, e) => M.apply(x, e, { luckyhit: true }), M.applyRoll(Object.assign(M.baseState(1), { lhc: 12 }), M.rollOf('+[5.0 - 20.0]% Lucky Hit Chance', p))).sep[0];
    assert.strictEqual(withGear.toFixed(2), '17.28', '… × (1 + Lucky Hit Chance from gear)');
    const cs = M.parseEffects("Rain of Arrows' Cast Speed is increased by 50%[+] and Lucky Hit Chance is increased by 50%[x].", prof({ noun: 'Rain of Arrows' }));
    const fast = cs.reduce((x, e) => M.apply(x, e, {}), Object.assign(M.baseState(1), { limit: 'speed', as: 100 }));
    assert.strictEqual(M.damage(fast).f.rate, 2.5, 'cast speed has its own 100% cap next to attack speed');
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
  // ---- mechanics: what makes a build work beyond its numbers – loops, breakpoints, uptime, tags
  {
    // Rain of Arrows (maxroll's Season 15 guide): Beastfall Boots spend the pool, Preparation turns
    // every 75 Energy into 5 s off the cooldown, Aspect of Aftermath refills per rank – 300 Energy
    // and ~60% Cooldown Reduction make it cast back to back
    const roa = { noun: 'Rain of Arrows', groups: ['Ultimate', 'Marksman'], el: 'Physical', otherSkills: ['Penetrating Shot'], cooldown: true, channeled: false };
    const T = {
      beast: 'When you Cast a non-Channeled Ultimate Skill, it Consumes all of your Energy and deals 0.75%[x] increased damage per Energy Consumed. Using a Cooldown restores 25 Energy.',
      after: 'Casting an Ultimate Skill generates 11.0 Energy per Skill Rank it has.',
      prep: "Spend 75 Energy to reduce your Ultimate Skill's Cooldown by 5 seconds. Ultimate Skills grant 15% Damage Reduction for 10 seconds.",
      vehe: 'Casting an Ultimate Skill increases your damage by 55%[x] for 8 seconds.',
    };
    assert.strictEqual(M.parseEffects(T.beast, roa).map((e) => e.kind).join(), 'consume,refill', 'Beastfall: spends the pool, gives 25 back');
    assert.strictEqual(M.parseEffects(T.prep, roa)[0].kind + ':' + M.parseEffects(T.prep, roa)[0].per, 'cdSpend:75', 'Preparation: per 75 spent');
    assert.ok(!M.parseEffects(T.beast, Object.assign({}, roa, { noun: 'Whirlwind', groups: ['Core', 'Channeled'], channeled: true })).some((e) => e.kind === 'consume'), 'a channeled skill does not trigger "a non-Channeled Ultimate"');
    const roaSt = (cdr, maxRes, rank, keys) => keys.reduce((s, k) => M.parseEffects(T[k], roa).reduce((a, e) => M.apply(a, e, {}), s), Object.assign(M.baseState(1.25), { limit: 'cooldown', cd: 50, cdr, maxRes, rank }));
    const full = M.damage(roaSt(61, 300, 30, ['beast', 'prep', 'after']));
    assert.ok(full.cycle.spam && full.cycle.checks.every((c) => c.ok), 'at 300 Energy, 61% Cooldown Reduction and 30 ranks it casts back to back, every breakpoint met');
    assert.strictEqual(full.cycle.checks.find((c) => c.id === 'pool').need, 300, 'the pool it needs: 75 × ⌈19.5 s / 5 s⌉');
    assert.strictEqual(Math.round(full.cycle.checks.find((c) => c.id === 'cdr').need), 60, 'the Cooldown Reduction: a full pool clears 50 s × (1 − 60%)');
    const short = M.damage(roaSt(61, 225, 30, ['beast', 'prep', 'after']));
    assert.ok(!short.cycle.spam && full.dps / short.dps > 3, 'at 225 Energy the loop breaks – a step, not a slope');
    assert.ok(M.damage(roaSt(61, 300, 20, ['beast', 'prep', 'after'])).dps < full.dps / 2, 'too few ranks: Aftermath does not refill the pool');
    const up = M.damage(roaSt(61, 300, 30, ['beast', 'prep', 'after', 'vehe']));
    assert.strictEqual(+(up.dps / full.dps).toFixed(2), 1.55, 'a buff after each cast is up the whole time when the skill casts back to back');
    const loop = M.loop(roaSt(61, 300, 30, ['beast', 'prep', 'after']), [{ name: 'Beastfall Boots', effects: M.parseEffects(T.beast, roa) }, { name: 'Preparation', effects: M.parseEffects(T.prep, roa) }], { skill: 'Rain of Arrows', res: 'Energy' });
    assert.ok(loop.lines.some((l) => /back to back/.test(l)) && loop.checks.length === 3, 'in words, with its breakpoints – pool, cooldown, ranks');
    // a skill that lasts: Cataclysm follows you 8 s – Cooldown Reduction past that adds nothing
    const cata = (cdr) => M.damage(Object.assign(M.baseState(1.625), { limit: 'cooldown', cd: 50, dur: 8, cdr }));
    assert.ok(cata(84).dps > cata(60).dps && Math.abs(cata(90).dps - cata(84).dps) < 1e-9, 'uptime: more Cooldown Reduction counts until it is always up, then not at all');
    assert.strictEqual(Math.round(cata(60).cycle.checks[0].need), 84, 'the breakpoint: 1 − 8 / 50');
    assert.strictEqual(M.damage(Object.assign(M.baseState(1), { limit: 'cooldown', cd: 66.6, noCdr: true, cdr: 50 })).f.rate.toFixed(6), '1.000000', '"does not benefit from Cooldown Reduction"');
    // the pool held, and a bigger pool
    const ww = prof();
    assert.strictEqual(kinds(M.parseEffects('Skills deal 0.50%[x] increased damage per point of Fury you have, but 7% Fury Drains per second while in combat.', ww)), 'perRes:0.5 drain:7', "Ramaladni's: per point of Fury – and its drain");
    const heart = M.parseEffects('Your Primary Resource is increased by 100% but your Maximum Life is reduced by 75%.', ww)[0];
    assert.deepStrictEqual([heart.kind, heart.v, heart.life], ['maxresPct', 100, -75], 'Melted Heart of Selig: double pool, a quarter of the life');
    const ram = (pool) => M.damage(M.apply(Object.assign(M.baseState(0.8), { maxRes: pool }), { kind: 'perRes', v: 0.5, cap: 0, cond: [], scope: 'skill' }, {})).dps;
    assert.strictEqual(+(ram(300) / ram(100)).toFixed(3), +(2.5 / 1.5).toFixed(3), 'per point of the pool: 300 Fury against 100');
    // a tag: the main skill counts as a skill of another group
    const bs = { noun: 'Blazing Scream', groups: ['Core', 'Hellfire'], el: 'Fire', otherSkills: [] };
    assert.strictEqual(kinds(M.parseEffects('Blazing Scream is now an Archfiend Skill and deals 50%[x] increased damage.', bs)), 'tag x:50', 'Elegy: a tag and its own bonus');
    assert.strictEqual(M.parseEffects('Blood Wave is additionally a Bone Skill.', { noun: 'Blood Wave', groups: ['Ultimate', 'Blood'], otherSkills: [] })[0].tag, 'Bone', '"is additionally a Bone Skill"');
    assert.strictEqual(M.parseEffects('Lacerate is also a Core Skill.', bs).length, 0, 'another skill gaining a tag is nothing to ours');
    // tempers: additive bonuses, some of them only now and then
    assert.deepStrictEqual(M.rollOf('+[20 - 40]% Vulnerable Damage', ww), { k: 'add', v: 40, cond: ['vulnerable'] }, 'Vulnerable Damage: [+] while Vulnerable');
    assert.deepStrictEqual(M.rollOf('+[20.0 - 40.0]% Damage to Distant Enemies', ww), { k: 'add', v: 40, cond: ['distant'] }, 'to Distant enemies');
    assert.strictEqual(M.rollOf('+[3.0 - 6.0]% Frost Critical Strike Chance', ww), null, 'Frost crit chance does nothing for Whirlwind');
    assert.deepStrictEqual(M.rollOf('+[3.0 - 6.0]% Frost Critical Strike Chance', prof({ noun: 'Ice Shards', groups: ['Core', 'Frost'] })), { k: 'crit', v: 6 }, '… and is crit chance for a Frost skill');
    assert.deepStrictEqual(M.rollOf('[20.0 - 22.5]% Rain of Arrows Cooldown Reduction', roa), { k: 'cdr', v: 22.5 }, "the skill's own cooldown temper");
    assert.deepStrictEqual(M.rollOf('+[15 - 20] Maximum Resource', ww), { k: 'maxres', v: 20 }, 'Maximum Resource');
    console.log('ok  mechanics: loops and their breakpoints, uptime, the pool, tags, tempers');
  }
  // ---- the resource budget, cooldown chains, buffs counted by their uptime
  {
    // Whirlwind: 6.5 Fury a second, the player's base regeneration entered; a generator fills what regeneration does not
    const ww = (o) => Object.assign(M.baseState(0.8), { limit: 'speed', cost: 6.5, costPerSec: true, baseRegen: 1 }, o);
    assert.strictEqual(M.sustain(ww({ regen: 8 })).share, 1, 'regeneration above the cost: it pays for itself');
    const gen = M.sustain(ww({ gen: 15 }));
    assert.strictEqual(+gen.share.toFixed(3), +((15 + 1) / (6.5 + 15)).toFixed(3), 'the generator fills the rest: m = (G + I) / (S + G)');
    assert.ok(M.damage(ww({ gen: 15, regen: 4 })).dps > M.damage(ww({ gen: 15 })).dps, 'regeneration is damage for a spender');
    assert.ok(M.damage(ww({ gen: 15, rcr: 30 })).dps > M.damage(ww({ gen: 15 })).dps, 'so is Cost Reduction');
    // without the player's value the base pays for one cast a second: what speed adds, the gear pays
    const spear = (o) => Object.assign(M.baseState(1.625), { limit: 'speed', cost: 25 }, o);
    assert.strictEqual(M.sustain(spear({})).share, 1, 'at base speed the assumed base regeneration pays for it');
    assert.ok(M.sustain(spear({ as: 100 })).share < 1 && M.sustain(spear({ as: 100, regen: 25 })).share === 1, 'twice the speed: the gear has to pay the second cast');
    assert.strictEqual(M.rollOf('+[3 - 4] Fury Regeneration', prof()).k, 'regen', 'Fury Regeneration');
    assert.deepStrictEqual(M.rollOf('Lucky Hit: Up to a 15% Chance to Restore +[5 - 12] Primary Resource', prof()), { k: 'lhres', v: 12, chance: 15 }, 'a Lucky Hit restore, with its chance');
    const ram = M.parseEffects("Skills deal 0.50%[x] increased damage per point of Fury you have, but 7% Fury Drains per second while in combat.", prof()).reduce((a, e) => M.apply(a, e, {}), ww({ gen: 15, maxRes: 300 }));
    assert.ok(M.sustain(ram).spend > 6.5 + 20, "Ramaladni's drain: 7% of 300 a second on top of the cost");
    assert.ok(M.parseEffects('Standing still reduces the Cooldown of Mobility Skills by 14.0% per second. After 5 seconds, they become free to Cast.', prof()).every((e) => e.kind !== 'freeCast'), 'another skill becoming free is nothing to the main one');
    assert.strictEqual(M.parseEffects('Your Core Skills are now additionally Basic Skills and free to cast.', prof()).some((e) => e.kind === 'freeCast'), true, 'the main skill free to cast');
    // chains: an Ultimate every 6.25 s taking 10 s off two auras with 12 s cooldowns (Aspect of Apogeic Furor)
    const bar = [{ name: 'Defiance Aura', groups: ['Aura'], cd: 12, dur: 6, gives: { fortified: 6 } }, { name: 'Zenith', groups: ['Ultimate'], cd: 6.25, dur: 0, gives: {} }];
    const pal = { noun: 'Blessed Shield', groups: ['Core'], otherSkills: [] };
    let st = Object.assign(M.baseState(1.625), { bar });
    assert.strictEqual(M.uptimes(st, null).fortified, 0.5, 'without the chain: 6 s out of 12');
    st = M.apply(st, M.parseEffects('Casting an Ultimate Skill reduces the Cooldowns of your other Skills by 10.0 seconds.', pal)[0], {});
    assert.strictEqual(+M.chainTimes(st, null).T['Defiance Aura'].toFixed(2), +(12 / (1 + 10 / 6.25)).toFixed(2), 'with it: T = 12 / (1 + 10 / 6.25)');
    assert.ok(M.uptimes(st, null).fortified > 0.99, 'and the aura is always up');
    const syn = M.parseEffects('Using an Agility Skill reduces the Cooldown of a random Subterfuge Skill by 7.5 seconds, and vice versa.', pal)[0];
    assert.deepStrictEqual([syn.from, syn.to, syn.back], ['Agility', 'one:Subterfuge', true], 'Synergy: both ways, spread over the skills it could be');
    // a buff kept up by a skill on a cooldown counts by its share of the time – and Cooldown Reduction raises it
    const buffed = (cdr) => M.damage(M.apply(Object.assign(M.baseState(1.625), { bar, cdr }), { kind: 'x', v: 100, cond: ['fortified'], scope: 'all' }, { fortified: 'up' })).dps;
    const none = M.damage(M.baseState(1.625)).dps;
    assert.strictEqual(+(buffed(0) / none).toFixed(3), 1.5, '100%[x] while Fortified, up half the time: ×1.5');
    assert.strictEqual(+(buffed(50) / none).toFixed(3), 2, 'at 50% Cooldown Reduction it is always up: ×2');
    console.log('ok  budget, cooldown chains, buffs by their uptime');
  }
  // ---- more casts, enchantments, tempers as the game has them, names as players write them
  {
    const cl = { noun: 'Chain Lightning', groups: ['Core', 'Shock'], el: 'Lightning', otherSkills: ['Spark'], mainStat: 'Intelligence' };
    assert.strictEqual(kinds(M.parseEffects('Casting Chain Lightning has a 50% chance to activate 1 to 5 additional times.', cl)), 'x:150', 'Axial Conduit: 50% × 3 more casts on average');
    const ench = M.parseEffects('Chain Lightning forms automatically after spending 100 Mana.', cl);
    const st = (fx) => fx.reduce((a, e) => M.apply(a, e, {}), Object.assign(M.baseState(1.625), { limit: 'speed', cost: 20 }));
    assert.strictEqual(+(M.damage(st(ench)).dps / M.damage(st([])).dps).toFixed(2), 1.2, 'its enchantment: a free cast for every 100 Mana – 20 a cast: +20%');
    assert.strictEqual(kinds(M.parseEffects('Cast Shock Skill damage leaves enemies Magnetized for 4 seconds, causing them to emit Crackling Energy and receive 60.0%[x] increased Shock damage from you.', cl)), 'x:60(buff)', 'Galvanic Azurite: a Shock bonus, not Crackling Energy\'s');
    assert.deepStrictEqual(M.rollOf('151.3 Intelligence', cl), { k: 'stat', v: 151.3 }, 'an imported main stat without "+"');
    const af = builder.slimAffixFile({ affix: [
      { key: 'Tempered_Hit_Twice_Skill_Rogue_Flurry_Tier3', desc: '+100 All Stats', tempered: true, group: 'Weapons', groupName: 'Agile Augments', itemType: ['Bow'], charType: ['Rogue'] },
      { key: 'Tempered_Crit_Rogue', desc: '+[30 - 50]% Critical Strike Damage', tempered: true, group: 'Offensive', groupName: 'Worldly Finesse', itemType: ['Ring'], charType: ['Rogue'] },
    ] });
    assert.deepStrictEqual(af.tempers.Rogue.map((t) => [t.d, t.cat]), [['+[30 - 50]% Critical Strike Damage', 'Offensive']], 'the "+100 All Stats" placeholders are no tempers; a temper keeps its category');
    console.log('ok  more casts, enchantments, tempers, imported stats');
  }
  // ---- stats for the build as it stands, and the breakpoints chased
  {
    const roa = { noun: 'Rain of Arrows', groups: ['Ultimate'], el: 'Physical', otherSkills: [], cooldown: true, mainStat: 'Dexterity' };
    const fx = (t) => M.parseEffects(t, roa);
    const beast = { name: 'Beastfall Boots', kind: 'unique', mythic: false, slots: ['Boots'], effects: fx('When you Cast a non-Channeled Ultimate Skill, it Consumes all of your Energy and deals 0.75%[x] increased damage per Energy Consumed.') };
    const opt = (d, g) => { const r = M.rollOf(d, roa); return { d, g: g || '', e: { kind: 'roll', k: r.k, v: r.v, cond: r.cond || [], scope: 'all', text: d, temper: g != null, g: g || '' } }; };
    const slots = ['Helm', 'Chest Armor', 'Amulet', 'Boots'];
    const pool = ['+[15 - 20] Maximum Resource', '+[1,226 - 1,450] Maximum Life', '[5.0 - 8.0]% Cooldown Reduction'];
    const opts = Object.fromEntries(slots.map((s) => [s, pool.map((d) => opt(d)).concat(opt('+[30 - 50]% Critical Strike Damage', 'Worldly Finesse'), opt('+[20 - 40]% Vulnerable Damage', 'Worldly Finesse'))]));
    const st0 = Object.assign(M.baseState(1.25), { limit: 'cooldown', cd: 50, crit: 50, mainStat: 'Dexterity' });
    const prep = M.parseEffects("Spend 75 Energy to reduce your Ultimate Skill's Cooldown by 5 seconds.", roa)[0];
    const withPrep = M.apply(st0, prep, {});
    const plain = O.pickRolls(opts, withPrep, {}, 0.6, slots, {}, {});
    const looped = O.pickRolls(opts, withPrep, {}, 0.6, slots, { Boots: beast }, {});
    const n = (r) => Object.values(r).flat().filter((e) => e.k === 'maxres').length;
    assert.ok(n(looped) > n(plain), 'with Beastfall Boots on, Maximum Resource is worth a slot');
    assert.ok(Object.values(looped).every((l) => l.filter((e) => e.temper).length <= 1 && new Set(l.filter((e) => e.temper).map((e) => e.g)).size === l.filter((e) => e.temper).length), 'one temper a piece');
    assert.strictEqual(looped.Boots.filter((e) => !e.temper).length, 0, 'a unique keeps its own stats – only tempers on it');
    console.log('ok  stats: picked for the build as it stands, one temper a piece');
  }
  // ---- one temper per item, whatever the site saved; a skill augment by its name, not "+100 All Stats"
  {
    const builds = require('../lib/builds');
    const d2db = require('../lib/d2coredb');
    const two = [{ t: '+2,000 Armor', tmp: 1 }, { t: '+121 Intelligence' }, { t: '+100 All Stats', tmp: 1 }];
    assert.deepStrictEqual(builds.oneTemper(two).map((x) => x.t), ['+2,000 Armor', '+121 Intelligence'], 'the first temper stays, the second goes');
    const b = builds.cleanBuild({ name: 'x', cls: 'Rogue', slots: { Helm: { item: 'Harlequin Crest', stats: two.concat({ t: 'Cooldown Reduction', mw: 1 }).map((x, i) => (i === 0 ? Object.assign({ how: 'Defensive · Worldly Endurance' }, x) : x)) } } });
    assert.deepStrictEqual(b.slots.Helm.stats, [{ t: '+2,000 Armor', tmp: 1, how: 'Defensive · Worldly Endurance' }, { t: '+121 Intelligence' }, { t: 'Cooldown Reduction', mw: 1 }],
      'saved: one temper, its manual and the masterwork mark kept');
    assert.strictEqual(d2db.affixText('Tempered_Hit_Twice_Skill_Rogue_Flurry_Tier3', '[{VALUE}|~|] All Stats', 100), 'Flurry hits twice – skill augment');
    assert.strictEqual(d2db.affixText('Tempered_PassiveRankBonus_Barb_12_CutToTheBoneTier3', '[{VALUE}|~|] All Stats', 100), 'Cut to the Bone rank bonus – augment');
    assert.strictEqual(d2db.affixText('Tempered_Life_Tier3', '+[{VALUE}|~|] Maximum Life', 1500), '+1,500 Maximum Life', 'a regular temper keeps its text');
    console.log('ok  one temper per item; skill augments by name');
  }
  // ---- what a guide says besides gear: its recipe by link (and variant), the mechanic and mercenaries by name
  {
    const g = require('../lib/guideinfo');
    const s = g.sheetFor('https://maxroll.gg/d4/planner/nq4dbn0q#3');
    assert.ok(s && s.id === 'maxroll/rain-of-arrows-rogue-guide' && s.variant === 'Endgame' && s.thresholds.length && s.rotation.length, 'a planner variant finds its guide\'s recipe');
    assert.ok(s.thresholds.every((t) => !t.for), 'one variant: only its lines');
    const d2 = g.sheetFor('https://www.d2core.com/d4/planner?bd=23Ez');
    assert.ok(d2 && !d2.variant && d2.thresholds.some((t) => t.for && t.for[0] === 'early transition'), 'one link for all variants: every line, the variant\'s ones say which (English, not Chinese)');
    assert.ok(g.sheetsForSkill('Rogue', 'Rain of Arrows').some((x) => x.site === 'd4builds'), 'a skill\'s guides from every site');
    const names = { skill: { rogue_talent_mechanic_t1_n2: 'Preparation', mercenary_cursedchild_wither: 'Field of Languish', rogue_rainofarrows: 'Rain of Arrows' } };
    assert.deepStrictEqual(g.resolve(g.extract('maxroll.gg', { specialization: 'Rogue_Talent_Mechanic_T1_N2',
      mercenary: { id: 'MercenaryClass_ShieldBearer', support: 'MercenaryClass_CursedChild', supportSkills: ['Mercenary_CursedChild_Wither', 'Rogue_RainofArrows'] } }), names),
    { mech: [{ group: 'Specialization', name: 'Preparation' }], merc: { hired: 'Raheir', support: 'Aldkin', skill: 'Field of Languish', trigger: 'Rain of Arrows' } }, 'maxroll: specialization and mercenaries');
    assert.deepStrictEqual(g.resolve(g.extract('d4builds.gg', { specialization: 'Preparation', mercenary2: 'Subo, The Drunken Archer', reinforcement2: 'Varyana, The Berserker Crone', mercenarySkill2: 'Bloodthirst', mercenaryOpportunity2: 'Whirlwind' }), null),
      { mech: [{ group: 'Specialization', name: 'Preparation' }], merc: { hired: 'Subo', support: 'Varyana', skill: 'Bloodthirst', trigger: 'Whirlwind' } }, 'd4builds: by name');
    assert.deepStrictEqual(g.resolve(g.extract('infinitybuilds.gg', { mechanic: { type: 'warlock-soul-shard', shard: 'Warlock_ClassMechanic_Vanguard.pow', fragment: 'Warlock_ClassMechanic_Vanguard_C.pow' } }), null).mech.map((m) => m.group),
      ['Soul Shard', 'Shard Fragment'], 'infinitybuilds: the warlock\'s shard and fragment');
    console.log('ok  guides: recipes by link, mechanic and mercenaries by name');
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e && e.stack ? e.stack : e); process.exit(1); });
