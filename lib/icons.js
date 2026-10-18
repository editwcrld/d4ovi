'use strict';
// One picture per thing, by its name – uniques, mythics, aspects, charms, seals, sets, gems, runes,
// soul splinters, runewords, keys and materials – so the overlay never shows a placeholder.
//
// The sources, the best one first:
//   d4guides.gg   the farm catalog (uniques, mythics, runewords) and its list pages (talismans …)
//   maxroll.gg    the game data: every item's picture id (lib/items.js)
//   d2core.com    the picture ids of gems, runes, splinters, charms, seals and sets (lib/d2coredb.js)
// maxroll serves every game picture under its id, so d2core's ids use the same address.
// An aspect has no picture of its own in the game: the codex shows its category's ("Offensive
// Aspect" …) – maxroll's ItemAspect_<Category>_01 items carry those.

const MX = 'https://assets-ng.maxroll.gg/d4-tools/images/webp/';
const ASPECT = { Offensive: 4248954575, Defensive: 572547939, Utility: 3318026109, Mobility: 718807252, Resource: 2354725649, Weapon: 1862801153 };

// the same as lib/items.js and renderer/ui.js – the renderer looks names up with its own copy
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const mx = (id) => (id ? MX + id + '.webp' : '');
const isUrl = (u) => /^https?:\/\//.test(u || '');

/** An aspect's category picture ("Offensive" -> the red aspect). */
const aspectIcon = (cat) => mx(ASPECT[String(cat || '').trim()] || ASPECT.Offensive);

/**
 * The pictures by normalised name.
 * @param {object} src
 * @param {Array}  [src.catalog]   farm catalog items  [{ name, icon }]
 * @param {Array}  [src.aspects]   farm catalog aspects [{ name, cat }]
 * @param {Array}  [src.guides]    d4guides list entries [{ name, icon }]
 * @param {Array}  [src.items]     maxroll items [{ name, icon }]
 * @param {object} [src.d2]        d2core picture ids { name: id }
 * @returns {{ [norm: string]: string }}
 */
function build(src) {
  const out = {};
  const put = (name, url) => { const k = norm(name); if (k && isUrl(url) && !out[k]) out[k] = url; };
  for (const x of (src && src.catalog) || []) put(x.name, x.icon);
  for (const x of (src && src.guides) || []) put(x.name, x.icon);
  for (const x of (src && src.aspects) || []) put(x.name, aspectIcon(x.cat));
  for (const x of (src && src.items) || []) put(x.name, x.icon);
  for (const [name, id] of Object.entries((src && src.d2) || {})) put(name, mx(id));
  return out;
}

/**
 * A name's picture from a built map – a boss trophy ("Duriel: Shard of Agony") by the part after
 * the colon, an aspect without a known name by its category.
 */
function find(map, name, kind) {
  const k = norm(name);
  if (map[k]) return map[k];
  const tail = String(name || '').split(':').slice(1).join(':');
  if (tail && map[norm(tail)]) return map[norm(tail)];
  if (kind === 'aspect') return aspectIcon('Offensive');
  return '';
}

module.exports = { build, find, norm, aspectIcon, MX, ASPECT };
