// The marks on a piece's stat lines (greater affix, temper, masterwork …) and their legend – and,
// for the code that still asks for it here, the plate (renderer/ui.js, UI.plate).
(function (root) {
'use strict';

const ICONS = root.UI.ICONS;
/** The plate of renderer/ui.js – el is not needed any more, kept for the callers. */
const card = (_el, o) => root.UI.plate(o);

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
