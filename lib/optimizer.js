'use strict';
// Puts a build together with the damage model (lib/dmgmodel.js): which unique, mythic or aspect
// goes on which slot and which stats to look for, by what each adds to damage and toughness.
//
// Greedy, like a player would do it with Path of Building open: start from the game's base
// values, add the stat rolls the slots allow, then fill one slot at a time with the piece that
// adds the most – each pick changes what the next one is worth (two [+] bonuses share a pool,
// a second crit multiplier is worth less than the first …). Afterwards every piece is valued by
// taking it out again, which is what the player sees as its share.
(function (root) {
const M = typeof require === 'function' && typeof module === 'object' ? require('./dmgmodel') : root.DmgModel;

const LIFE_BASE = M.LIFE_BASE;
const GEAR = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand'];
const slotKind = (s) => s.replace(/ ?\d$/, '');
// tempers a piece takes
const TEMPERS = 1;
/** Whether a piece fits a slot – by its own list (builder: weapon kinds per class) or by the slot's kind. */
const fits = (c, slot) => (c.fit ? c.fit.includes(slot) : c.slots.includes(slotKind(slot)));
// the off-hand a two-hander leaves empty
const BLOCKED = { name: '', kind: 'blocked', mythic: false, slots: [], effects: [] };
const num = (s) => Number(String(s).replace(/,/g, ''));
const top = (d) => { const m = String(d).match(/\[([\d.,]+)\s*-\s*([\d.,]+)\]/); return m ? num(m[2]) : (String(d).match(/[\d.,]+/) ? num(String(d).match(/[\d.,]+/)[0]) : 0); };

// stat lines and how they change the state live in the model, shared with the uniques' fixed stats
const rollEffect = (d, prof) => M.rollOf(d, prof);
const applyRoll = (st, r) => M.applyRoll(st, r);

/** Damage and toughness change between two states, in %. */
const delta = (a, b) => ({ dmg: (M.damage(b).dps / M.damage(a).dps - 1) * 100, tough: (M.toughness(b) / M.toughness(a) - 1) * 100,
  speed: (M.speed(b) / M.speed(a) - 1) * 100 });
/**
 * What a goal weighs: damage always counts fully; toughness and speed by the goal.
 *   push  – the Pit: damage and toughness       speed – farming: speed matters as much as toughness
 *   boss  – one target: damage, a bit of toughness
 */
const GOALS = { push: { t: 0.6, m: 0 }, speed: { t: 0.35, m: 0.6 }, boss: { t: 0.45, m: 0 } };
/** One number to rank by: damage and toughness both multiply what a build can do; balance 0–1 weighs toughness. */
const value = (d, w) => {
  const g = typeof w === 'object' && w ? w : { t: w == null ? 0.6 : w, m: 0 };
  return Math.log(Math.max(0.01, 1 + d.dmg / 100)) + g.t * Math.log(Math.max(0.01, 1 + d.tough / 100)) + (g.m || 0) * Math.log(Math.max(0.01, 1 + (d.speed || 0) / 100));
};

/** Stats the plan aims for on each slot: the three rolls that add the most from the base state. */
function pickStats(pools, prof, st0, balance, slots) {
  const out = {};
  let st = st0;
  for (const slot of slots || GEAR) {
    const list = (pools[slot] || pools[slotKind(slot)] || []).map((d) => ({ d, r: rollEffect(d, prof) })).filter((x) => x.r);
    const chosen = [];
    for (let i = 0; i < 3; i++) {
      let best = null;
      for (const x of list) {
        if (chosen.some((c) => c.r.k === x.r.k)) continue;
        const v = value(delta(st, applyRoll(st, x.r)), balance);
        if (!best || v > best.v) best = { x, v };
      }
      if (!best || best.v <= 0) break;
      chosen.push(best.x);
      st = applyRoll(st, best.x.r);
    }
    out[slot] = chosen;
  }
  return { stats: out, state: st };
}

/**
 * What a slot brings. A legendary carries its rolled stats and its aspect; a unique (or runeword)
 * has fixed stats instead of rolls – its own stats replace the slot's, they never come on top.
 * An empty slot stands for a legendary with the rolls and no aspect yet.
 * @param rolls  slot -> the roll effects the plan aims for there
 */
// tempers (e.temper) go on a unique as well
const slotEffects = (slot, c, rolls) => (c && c.kind === 'blocked' ? [] : c && c.kind === 'unique' ? c.effects.concat(((rolls && rolls[slot]) || []).filter((e) => e.temper))
  : ((rolls && rolls[slot]) || []).concat(c ? c.effects : []));

/**
 * The stats for each slot, picked for the build as it stands – with every other piece and stat
 * in place, so a slot gets what this build lacks: crit damage where it crits, Maximum Resource
 * where a loop spends the pool, the cooldown its loop needs. Three affixes on a legendary (a
 * unique has its own), one temper on either – a piece takes one.
 * @param opts    slot -> [{ d, g, e }] – e a roll effect (kind 'roll', temper: true for a temper)
 * @param placed  slot -> piece (fillGear)
 * @returns slot -> roll effects
 */
function pickRolls(opts, st0, on, balance, slots, placed, rolls0) {
  const rolls = Object.assign({}, rolls0 || {});
  for (const slot of slots) {
    const c = placed && placed[slot];
    if (c && c.kind === 'blocked') { rolls[slot] = []; continue; }
    rolls[slot] = [];
    let st = stateOf(st0, placed || {}, on, rolls, slots);
    const chosen = [];
    const room = { affix: c && c.kind === 'unique' ? 0 : 3, temper: TEMPERS };
    for (;;) {
      let best = null;
      for (const o of opts[slot] || []) {
        const kind = o.e.temper ? 'temper' : 'affix';
        if (!room[kind] || chosen.some((x) => x.d === o.d || (o.e.temper && x.e.temper && x.g === o.g))) continue;
        const v = value(delta(st, M.apply(st, o.e, on)), balance);
        if (v > 1e-6 && (!best || v > best.v)) best = { o, v, kind };
      }
      if (!best) break;
      chosen.push(best.o);
      room[best.kind]--;
      st = M.apply(st, best.o.e, on);
    }
    rolls[slot] = chosen.map((o) => o.e);
  }
  return rolls;
}

/** The state with these pieces on these slots (every slot of `slots` counts, filled or not). */
function stateOf(st0, placed, on, rolls, slots) {
  // one working copy for the whole build – each effect changes it in place
  let s = M.cloneState(st0);
  for (const slot of slots) for (const e of slotEffects(slot, placed[slot], rolls)) s = M.apply(s, e, on, true);
  return s;
}

/**
 * Breakpoints are steps: one +20 Maximum Energy is worth little, the 300 a loop needs are worth a
 * lot. For every breakpoint the loop misses (cycle().checks), the stat that closes it is put on
 * slot after slot – in place of the roll there that costs least – until it is met; the whole
 * build decides whether that beats what the step-by-step pick had.
 */
// the stats that close each breakpoint (dmgmodel cycle().checks)
const CHASE = { pool: ['maxres'], cdr: ['cdr'], rank: ['rank'], uptime: ['cdr'], barUp: ['cdr'], sustain: ['regen', 'resgen', 'rcr', 'lhres'] };
function chase(opts, st0, on, balance, slots, placed, rolls) {
  let cur = rolls;
  const valueOf = (r) => value(delta(st0, stateOf(st0, placed, on, r, slots)), balance);
  for (let round = 0; round < 3; round++) {
    const open = M.damage(stateOf(st0, placed, on, cur, slots)).cycle.checks.filter((c) => !c.ok && CHASE[c.id]);
    if (!open.length) break;
    let improved = false;
    // each breakpoint alone, and all of them on top of each other – a loop often needs both
    let acc = cur;
    const tries = [];
    for (const chk of open) {
      const ks = CHASE[chk.id];
      for (const from of [cur, acc]) {
      let r = Object.assign({}, from);
      for (const slot of slots) {
        const c = placed[slot];
        if (c && c.kind === 'blocked') continue;
        const mine = r[slot] || [];
        // the best option of that stat this slot can have and does not yet
        // of the stats that close it, the one this slot can have that does the most here
        const here = stateOf(st0, placed, on, r, slots);
        const opt = (opts[slot] || []).filter((o) => ks.includes(o.e.k) && !mine.some((e) => e.text === o.d) && !(c && c.kind === 'unique' && !o.e.temper))
          .map((o) => ({ o, v: value(delta(here, M.apply(here, o.e, on)), balance) })).sort((a, b) => b.v - a.v).map((x) => x.o)[0];
        if (!opt) continue;
        // it goes in place of the roll of its kind (affix or temper) that costs least
        const same = mine.map((e, i) => ({ e, i })).filter((x) => !!x.e.temper === !!opt.e.temper && (!opt.e.temper || x.e.g === opt.g || !mine.some((y) => y.temper && y.g === opt.g)));
        const room = opt.e.temper ? mine.filter((e) => e.temper).length < TEMPERS : (c && c.kind === 'unique' ? false : mine.filter((e) => !e.temper).length < 3);
        let next;
        if (room && !(opt.e.temper && mine.some((e) => e.temper && e.g === opt.g))) next = mine.concat(opt.e);
        else {
          if (!same.length) continue;
          const cost = (x) => valueOf(Object.assign({}, r, { [slot]: mine.filter((_, j) => j !== x.i) }));
          const drop = same.sort((a, b) => cost(b) - cost(a))[0];
          next = mine.filter((_, j) => j !== drop.i).concat(opt.e);
        }
        r = Object.assign({}, r, { [slot]: next });
        const now = M.damage(stateOf(st0, placed, on, r, slots)).cycle.checks.find((x) => x.id === chk.id && x.skill === chk.skill);
        if (!now || now.ok) break;
      }
      tries.push(r);
      if (from === acc) acc = r;
      }
    }
    for (const r of tries) if (valueOf(r) > valueOf(cur) + 1e-9) { cur = r; improved = true; }
    if (!improved) break;
  }
  return cur;
}

/**
 * The gear: candidates are { name, kind:'aspect'|'unique', mythic, slots:[...], effects:[...] }.
 * on – the conditions switched on; rolls – slot -> roll effects (see slotEffects).
 * Returns slot -> piece, and the final state.
 */
function fillGear(cands, st0, on, balance, slots, rolls, fixed) {
  const placed = Object.assign({}, fixed || {});
  // a two-hander given beforehand already leaves its off-hand empty
  for (const c of Object.values(fixed || {})) for (const b of c.blocks || []) if (placed.Weapon === c && !placed[b]) placed[b] = BLOCKED;
  const free = new Set(slots.filter((s) => !placed[s]));
  const used = new Set(Object.values(placed).map((c) => c.name));
  let mythic = Object.values(placed).some((c) => c.mythic);
  while (free.size) {
    const now = stateOf(st0, placed, on, rolls, slots);
    // per free slot: everything else as it is – the candidate goes in on top of that
    const rest = {};
    for (const s of free) rest[s] = stateOf(st0, Object.assign({}, placed, { [s]: null }), on, Object.assign({}, rolls, { [s]: [] }), slots);
    let best = null;
    for (const c of cands) {
      if (used.has(c.name) || (c.mythic && mythic)) continue;
      for (const slot of free) {
        if (!fits(c, slot)) continue;
        // a two-hander needs its off-hand free – and takes it with it
        const blocks = slot === 'Weapon' && c.blocks ? c.blocks.filter((b) => slots.includes(b)) : [];
        if (blocks.some((b) => placed[b])) continue;
        let st = slotEffects(slot, c, rolls).reduce((x, e) => M.apply(x, e, on, true), M.cloneState(rest[slot]));
        if (blocks.length) st = stateOf(st0, Object.assign({}, placed, { [slot]: c }, Object.fromEntries(blocks.map((b) => [b, BLOCKED]))), on, rolls, slots);
        const v = value(delta(now, st), balance);
        if (!best || v > best.v + 1e-9) best = { c, v, slot };
      }
    }
    if (!best) break;
    // among the slots it fits equally well, the one fewer other pieces could take
    const options = [...free].filter((s) => fits(best.c, s));
    const demand = (s) => cands.filter((c) => !used.has(c.name) && c !== best.c && fits(c, s)).length;
    const slot = best.c.kind === 'unique' ? best.slot : options.sort((a, b) => demand(a) - demand(b))[0];
    placed[slot] = best.c;
    used.add(best.c.name);
    free.delete(slot);
    if (slot === 'Weapon') for (const b of best.c.blocks || []) if (free.has(b)) { placed[b] = BLOCKED; free.delete(b); }
    if (best.c.mythic) mythic = true;
  }
  return { placed, state: stateOf(st0, placed, on, rolls, slots) };
}

/**
 * What each placed piece adds – its share: the build against the same build with a plain
 * legendary (its rolls, no aspect) on that slot – plus the next best options for the slot.
 */
function shares(cands, placed, st0, on, balance, rolls, slots) {
  const all = slots || Object.keys(placed);
  const full = stateOf(st0, placed, on, rolls, all);
  const out = {};
  // a slot a two-hander takes with it has no share of its own
  const freed = (slot, x) => (slot === 'Weapon' && x.blocks ? Object.fromEntries(x.blocks.filter((b) => all.includes(b)).map((b) => [b, BLOCKED])) : {});
  for (const [slot, c] of Object.entries(placed)) {
    if (c.kind === 'blocked') continue;
    // without it: a plain legendary there – and the off-hand back if it was a two-hander
    const back = slot === 'Weapon' && c.blocks ? Object.fromEntries(c.blocks.map((b) => [b, null])) : {};
    const without = stateOf(st0, Object.assign({}, placed, { [slot]: null }, back), on, rolls, all);
    const d = delta(without, full);
    const mine = slotEffects(slot, c, rolls);
    const w = M.worth(without, c.effects, on);
    const others = Object.values(placed).filter((x) => x !== c);
    const alts = cands.filter((x) => x !== c && fits(x, slot) && !others.includes(x) && !(x.mythic && others.some((y) => y.mythic)))
      .map((x) => {
        const st = stateOf(st0, Object.assign({}, placed, { [slot]: x }, back, freed(slot, x)), on, rolls, all);
        const dx = delta(full, st);
        const wx = M.worth(without, x.effects, on);
        return { c: x, dmg: dx.dmg, tough: dx.tough, speed: dx.speed, dmgIf: wx.dmgIf, needs: wx.needs, v: value(dx, balance) };
      })
      .sort((a, b) => b.v - a.v || b.dmgIf - a.dmgIf).slice(0, 8);
    out[slot] = { dmg: d.dmg, tough: d.tough, speed: d.speed, dmgIf: w.dmgIf, needs: w.needs, proc: w.proc, unsure: w.unsure, alts, n: mine.length };
  }
  return { full, out };
}

const api = { rollEffect, applyRoll, pickStats, pickRolls, chase, fillGear, shares, stateOf, slotEffects, fits, BLOCKED, delta, value, GOALS, GEAR, LIFE_BASE };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Optimizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
