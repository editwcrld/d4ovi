// One card shape for every view – the settings' sections, and slimmer in builds and search:
//   [icon]  Title                      [badge]
//           what it is about
//   ─────────────────────────────────────────
//   body
(function (root) {
'use strict';

const ICONS = {
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  armor: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
  skills: 'M13 2L4 14h7l-1 8 9-12h-7z',
  charm: 'M12 3l7 7-7 11-7-11zM5 10h14',
  paragon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  glyph: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  boss: 'M12 3a8 8 0 0 0-8 8c0 3 1.6 5 3.5 6v3h9v-3c1.9-1 3.5-3 3.5-6a8 8 0 0 0-8-8zM9 12h.01M15 12h.01M10 20v-2M14 20v-2',
  rune: 'M12 2l8 5v10l-8 5-8-5V7zM9 9l6 6M15 9l-6 6',
  dungeon: 'M4 21V9l8-6 8 6v12zM10 21v-6h4v6',
  salvage: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  item: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 6 3-6',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  activity: 'M5 21V4M5 4h11l-2 4 2 4H5',
  craft: 'M14 4l6 6-3 3-6-6zM11 7l-8 8 3 3 8-8M3 21l3-3',
  build: 'M4 5h16v14H4zM8 9h8M8 13h5',
};

/**
 * A card.
 * @param {function} el  the views' element maker: el(tag, class, text)
 * @param {object} o     { title, sub, icon (a name above or a path), badge, badgeCls, cls, id }
 * @returns {{ card, head, body, badge }}
 */
function card(el, o) {
  const c = el('section', 'scard' + (o.cls ? ' ' + o.cls : ''));
  if (o.id) c.dataset.card = o.id;
  const head = el('div', 'shead');
  const ic = el('span', 'sicon');
  ic.innerHTML = '<svg viewBox="0 0 24 24"><path d="' + (ICONS[o.icon] || o.icon || ICONS.info) + '"/></svg>';
  head.appendChild(ic);
  const t = el('div', 'stitle');
  t.appendChild(el('h3', null, o.title));
  if (o.sub) t.appendChild(el('span', null, o.sub));
  head.appendChild(t);
  const side = el('div', 'sside');
  const badge = el('span', 'sstate' + (o.badgeCls ? ' ' + o.badgeCls : ''), o.badge == null ? '' : String(o.badge));
  side.appendChild(badge);
  head.appendChild(side);
  c.appendChild(head);
  const body = el('div', 'sbody');
  c.appendChild(body);
  return { card: c, head, body, badge, side };
}

/**
 * The crafting marks on a piece's stat lines – one symbol each, the same everywhere
 * (maxroll.gg/d4/resources/item-crafting):
 *   ✦ greater affix – drops that way          ⚒ temper – Blacksmith, one per item
 *   ★ masterwork – the capstone (+50%) to land here   ↻ enchant – Occultist, rerolls one affix
 *   ◈ transfigure – Horadric Cube, nothing can be changed afterwards
 */
const CRAFT = {
  g: ['✦', 'Greater affix', 'drops that way'],
  tmp: ['⚒', 'Temper', 'Blacksmith · one per item'],
  mw: ['★', 'Masterwork', 'reroll the capstone (+50%) until it lands here'],
  enc: ['↻', 'Enchant', 'Occultist · rerolls one affix'],
  tf: ['◈', 'Transfigure', 'Horadric Cube · last step, locks the item'],
};
const CRAFT_ORDER = ['g', 'mw', 'tmp', 'enc', 'tf'];
const node = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };

/** One stat line: its marks, the text, a temper's manual. x = { t, g, tmp, mw, enc, tf, how } */
function statLine(x, cls) {
  const marks = CRAFT_ORDER.filter((k) => x[k]);
  const l = node('div', (cls || 'st') + ' cx-line' + (x.g || x.mw ? ' ga' : '') + (x.tmp ? ' tmp' : ''));
  const m = node('span', 'cx-marks');
  if (!marks.length) m.appendChild(node('span', 'cx cx-none', '·'));
  marks.forEach((k) => { const s = node('span', 'cx cx-' + k, CRAFT[k][0]); s.title = CRAFT[k][1] + ' – ' + CRAFT[k][2]; m.appendChild(s); });
  l.appendChild(m);
  l.appendChild(node('span', 'cx-t', String(x.t || '')));
  if (x.tmp && x.how) l.appendChild(node('span', 'cx-how', x.how));
  return l;
}
/** The marks the lines use, explained once – under a card or a list. */
function craftLegend(stats) {
  const used = CRAFT_ORDER.filter((k) => (stats || []).some((x) => x && x[k]));
  if (!used.length) return null;
  const d = node('div', 'cx-legend');
  used.forEach((k) => { const s = node('span', 'cx-lg'); s.appendChild(node('span', 'cx cx-' + k, CRAFT[k][0])); s.appendChild(document.createTextNode(CRAFT[k][1] + ' – ' + CRAFT[k][2])); d.appendChild(s); });
  return d;
}

root.SCard = { card, ICONS, CRAFT, statLine, craftLegend };
})(typeof window !== 'undefined' ? window : globalThis);
