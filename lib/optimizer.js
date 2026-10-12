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
const slotKind = (s) => s.replace(/\d$/, '');
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
function pickStats(pools, prof, st0, balance) {
  const out = {};
  let st = st0;
  for (const slot of GEAR) {
    const list = (pools[slotKind(slot)] || []).map((d) => ({ d, r: rollEffect(d, prof) })).filter((x) => x.r);
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
 * The gear: candidates are { name, kind:'aspect'|'unique', mythic, slots:[...], effects:[...] }.
 * on – the conditions switched on. Returns slot -> piece, and the final state.
 */
function fillGear(cands, st0, on, balance, slots) {
  const free = new Set(slots);
  const used = new Set();
  const placed = {};
  let st = st0;
  let mythic = false;
  const fits = (c, slot) => c.slots.includes(slotKind(slot));
  const stateWith = (base, c) => c.effects.reduce((s, e) => M.apply(s, e, on), base);
  while (free.size) {
    let best = null;
    for (const c of cands) {
      if (used.has(c.name) || (c.mythic && mythic)) continue;
      const slot = [...free].find((s) => fits(c, s));
      if (!slot) continue;
      const v = value(delta(st, stateWith(st, c)), balance);
      // a slot that fewer pieces fit goes first among equals – keeps the flexible ones for later
      if (!best || v > best.v + 1e-9) best = { c, v, slot };
    }
    if (!best) break;
    // put it on the fitting free slot that the fewest other good pieces could take
    const options = [...free].filter((s) => fits(best.c, s));
    const demand = (s) => cands.filter((c) => !used.has(c.name) && c !== best.c && fits(c, s)).length;
    const slot = options.sort((a, b) => demand(a) - demand(b))[0];
    placed[slot] = best.c;
    used.add(best.c.name);
    free.delete(slot);
    if (best.c.mythic) mythic = true;
    st = stateWith(st, best.c);
  }
  return { placed, state: st };
}

/** What each placed piece adds on top of all the others – its share – plus the next best options for its slot. */
function shares(cands, placed, stBase, on, balance) {
  const stateOf = (pieces) => pieces.reduce((s, c) => c.effects.reduce((x, e) => M.apply(x, e, on), s), stBase);
  const all = Object.values(placed);
  const full = stateOf(all);
  const out = {};
  for (const [slot, c] of Object.entries(placed)) {
    const without = stateOf(all.filter((x) => x !== c));
    const d = delta(without, full);
    const w = M.worth(without, c.effects, on);
    const alts = cands.filter((x) => x !== c && x.slots.includes(slotKind(slot)) && !all.includes(x) && !(x.mythic && all.some((y) => y.mythic && y !== c)))
      .map((x) => { const dx = delta(without, x.effects.reduce((s, e) => M.apply(s, e, on), without)); const wx = M.worth(without, x.effects, on); return { c: x, dmg: dx.dmg, tough: dx.tough, dmgIf: wx.dmgIf, needs: wx.needs, v: value(dx, balance) }; })
      .sort((a, b) => b.v - a.v || b.dmgIf - a.dmgIf).slice(0, 8);
    out[slot] = { dmg: d.dmg, tough: d.tough, dmgIf: w.dmgIf, needs: w.needs, proc: w.proc, unsure: w.unsure, alts };
  }
  return { full, out };
}

const api = { rollEffect, applyRoll, pickStats, fillGear, shares, delta, value, GOALS, GEAR, LIFE_BASE };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Optimizer = api;
})(typeof window !== 'undefined' ? window : globalThis);
