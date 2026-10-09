'use strict';
// Shared by the build importers that name their gear in plain words (d4builds.gg, d2core.com):
// matches a name against the farm list catalog and puts each piece into one of our ten slots.
//
// The catalog's spelling wins – the farm list finds an item by its exact name – so a piece the
// catalog does not know is reported as missing instead of being guessed.
const { norm } = require('./d4guides');

/**
 * @param {object} catalog  farm.catalog()
 * @returns {{item, aspect, put, result}}
 */
function fitter(catalog) {
  const items = new Map();
  const aspects = new Map();
  for (const it of (catalog && catalog.items) || []) if (!items.has(it.n || norm(it.name))) items.set(it.n || norm(it.name), it.name);
  for (const a of (catalog && catalog.aspects) || []) aspects.set(a.n || norm(a.name), a.name);

  const slots = {};
  const missing = [];
  const extra = [];
  const label = (e) => e.item || e.aspects.join(' + ');

  return {
    /** The catalog's name of a unique / mythic / runeword, '' when it does not know it. */
    item: (name) => items.get(norm(name)) || '',
    /** The catalog's name of an aspect; "Aftermath" finds "Aspect of Aftermath" as well. */
    aspect: (name) => aspects.get(norm(name)) || aspects.get(norm('Aspect of ' + name)) || aspects.get(norm(name + ' Aspect')) || '',
    missing: (what) => { if (what && !missing.includes(what)) missing.push(what); },
    /**
     * @param {string} slot  Helm, Chest Armor, Gloves, Pants, Boots, Amulet, Ring, Weapon, Off-Hand
     * @param {object} entry {item} or {aspects}
     * @param {boolean} oneHand  a weapon that may go into the off-hand (dual wield)
     */
    put(slot, entry, oneHand) {
      if (!slot || !entry) return;
      let key = slot;
      if (slot === 'Ring') key = slots.Ring1 ? 'Ring2' : 'Ring1';
      // more weapons (rogue: bow + two blades, barbarian: four) – a one-handed one may go into
      // the off-hand, the rest into Weapon 2 and 3; each keeps its kind for the label
      if (slot === 'Weapon' && slots.Weapon) {
        key = [oneHand ? 'Off-Hand' : '', 'Weapon 2', 'Weapon 3'].find((k) => k && !slots[k]) || '';
      }
      if (!key || slots[key]) { extra.push(label(entry)); return; }
      slots[key] = entry;
    },
    result: () => ({ slots, missing, extra }),
  };
}

/**
 * "Title – Variant" within the 40 characters a build name has. The variant is what tells the
 * builds of one guide apart, so the title is shortened first.
 */
function buildName(title, variant, max) {
  max = max || 40;
  const t = String(title || '').trim();
  const v = String(variant || 'Build').trim();
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
  if (!t) return cut(v, max);
  if (t.length + 3 + v.length <= max) return t + ' – ' + v;
  if (v.length > max - 13) return cut(v, max);              // a variant that says it all by itself
  return cut(t, max - 3 - v.length) + ' – ' + v;
}

module.exports = { fitter, buildName };
