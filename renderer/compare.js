// Comparing two builds – mostly two variants of one guide (Starter → Endgame): which slots
// change, which skills, charms and paragon boards come and go, and what is left to farm for
// the other one. The diff is plain data (tested in Node); render() draws it in the farm list.
(function (root) {
'use strict';

const SLOT_KEYS = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand', 'Weapon 2', 'Weapon 3'];
const LABEL = { Ring1: 'Ring', Ring2: 'Ring 2' };

/** What sits in a slot, as one line: the item, or its aspects. */
const what = (s) => (!s ? '' : s.item || (s.aspects || []).join(' + '));
const stats = (s) => ((s && s.stats) || []).map((x) => x.t);
/** Items of a list that are not in the other one (each counted, so "Ruby ×2" vs "Ruby ×1" shows). */
function minus(a, b) {
  const left = b.slice();
  return a.filter((x) => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; });
}
function split(a, b) {
  return { both: a.filter((x) => b.includes(x)), onlyA: minus(a, b), onlyB: minus(b, a) };
}
/** The build's link without the part that picks the variant – variants of one guide share it. */
const guideOf = (b) => String((b && b.source && b.source.url) || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

/**
 * The build to compare with by default: another variant of the same guide, otherwise one of
 * the same class, otherwise the next one in the list.
 */
function partner(builds, a) {
  const others = (builds || []).filter((x) => x.id !== a.id);
  const g = guideOf(a);
  return (g && others.find((x) => guideOf(x) === g))
    || (a.source && a.source.title && others.find((x) => x.source && x.source.title === a.source.title))
    || (a.cls !== 'All' && others.find((x) => x.cls === a.cls))
    || others[0] || null;
}

/** Everything in a build that can be ticked off – the same keys the farm list uses. */
function tickKeys(b) {
  const keys = [];
  const add = (k) => { if (k && !keys.includes(k)) keys.push(k); };
  SLOT_KEYS.forEach((k) => {
    const s = b.slots && b.slots[k];
    if (!s) return;
    if (s.item) add(s.item);
    (s.aspects || []).forEach(add);
    (s.sockets || []).forEach((x) => add('s:' + x));
  });
  const ch = b.charms;
  if (ch && ch.seal) add('c:' + ch.seal.name);
  ((ch && ch.list) || []).forEach((c) => add('c:' + c.name));
  return keys;
}

function charmNames(b) {
  const ch = b.charms;
  if (!ch) return [];
  return [].concat(ch.seal ? [ch.seal.name + ' (seal)'] : [], (ch.list || []).map((c) => c.name));
}
const boardKeys = (b) => ((b.paragon && b.paragon.boards) || []).map((x) => x.k);
const glyphKeys = (b) => ((b.paragon && b.paragon.boards) || []).map((x) => x.glyph).filter(Boolean);

/**
 * @returns {{slots: Array, same: number, changed: number, skills: object, charms: object,
 *            boards: object, glyphs: object, need: string[], have: string[]}}
 */
function diff(a, b) {
  const slots = [];
  SLOT_KEYS.forEach((key) => {
    const sa = a.slots && a.slots[key], sb = b.slots && b.slots[key];
    if (!sa && !sb) return;
    const wa = what(sa), wb = what(sb);
    const state = !sa ? 'added' : !sb ? 'removed' : wa === wb ? 'same' : 'changed';
    const label = (sb && sb.base) || (sa && sa.base) || LABEL[key] || key;
    const st = split(stats(sa), stats(sb));
    const so = split((sa && sa.sockets) || [], (sb && sb.sockets) || []);
    slots.push({ key, label, a: wa, b: wb, state,
      statsOnlyA: st.onlyA, statsOnlyB: st.onlyB, socketsA: so.onlyA, socketsB: so.onlyB });
  });
  const skills = split(((a.skills && a.skills.bar) || []).map((s) => s.name), ((b.skills && b.skills.bar) || []).map((s) => s.name));
  // what the other build needs that is neither ticked there nor already ticked in this one
  const done = new Set([].concat(a.done || [], b.done || []));
  const keysB = tickKeys(b);
  return {
    slots,
    same: slots.filter((s) => s.state === 'same').length,
    changed: slots.filter((s) => s.state !== 'same').length,
    skills,
    charms: split(charmNames(a), charmNames(b)),
    boards: split(boardKeys(a), boardKeys(b)),
    glyphs: split(glyphKeys(a), glyphKeys(b)),
    need: keysB.filter((k) => !done.has(k)),
    have: keysB.filter((k) => done.has(k)),
  };
}

/** "s:Royal Ruby" -> "Royal Ruby", "c:…" -> the charm. */
const keyName = (k) => String(k).replace(/^[sc]:/, '');
/** d2core's board keys ("Paragon_Sorc_02") read better without the prefix. */
const boardName = (k) => String(k).replace(/^Paragon_[A-Za-z]+_/, '').replace(/_/g, ' ');

// ---------------------------------------------------------------- drawing
let withId = null;            // the build compared with (kept while the build stays the same)
let forId = null;

/**
 * @param {HTMLElement} box
 * @param {object} a       the open build
 * @param {object} ctx     { el, builds, choose(id) }
 */
function render(box, a, ctx) {
  const el = ctx.el;
  box.classList.add('fcmp');
  const others = ctx.builds.filter((x) => x.id !== a.id);
  if (!others.length) {
    box.appendChild(el('div', 'empty', 'Only one build — import the other variants of a guide (Import, tick them all) or duplicate this one to compare.'));
    return;
  }
  if (forId !== a.id || !others.some((x) => x.id === withId)) { forId = a.id; withId = partner(ctx.builds, a).id; }
  const b = others.find((x) => x.id === withId);
  const d = diff(a, b);

  // which build to compare with, and the summary
  const top = el('div', 'cmphead');
  top.appendChild(el('span', 'cmpa', a.name));
  top.appendChild(el('span', 'cmpvs', 'vs'));
  const sel = el('select');
  others.forEach((x) => { const o = el('option', null, x.name + (x.cls !== 'All' ? ' · ' + x.cls : '')); o.value = x.id; if (x.id === b.id) o.selected = true; sel.appendChild(o); });
  sel.onchange = () => { withId = sel.value; ctx.rerender(); };
  top.appendChild(sel);
  top.appendChild(el('span', 'sp'));
  const go = el('button', 'ab', 'Open “' + b.name + '”');
  go.title = 'Switch to the other build';
  go.onclick = () => ctx.choose(b.id);
  top.appendChild(go);
  box.appendChild(top);

  const sum = el('div', 'cmpsum');
  const pill = (t, cls) => sum.appendChild(el('span', 'cpill' + (cls ? ' ' + cls : ''), t));
  pill(d.same + ' of ' + d.slots.length + ' slots the same', d.changed ? '' : 'ok');
  if (d.changed) pill(d.changed + ' slot' + (d.changed === 1 ? '' : 's') + ' change', 'chg');
  const skillSwaps = Math.max(d.skills.onlyA.length, d.skills.onlyB.length);
  if (skillSwaps) pill(skillSwaps + ' skill' + (skillSwaps === 1 ? '' : 's') + ' swapped', 'chg');
  pill(d.need.length ? d.need.length + ' left to farm for “' + b.name + '”' : 'Nothing left to farm for it', d.need.length ? 'need' : 'ok');
  box.appendChild(sum);

  const scroll = el('div', 'cmpbody');
  box.appendChild(scroll);

  // gear, slot by slot – what changes first
  const sec = (title) => { scroll.appendChild(el('div', 'cmpk', title)); };
  sec('Gear');
  const grid = el('div', 'cmpgrid');
  ['', a.name, b.name].forEach((t) => grid.appendChild(el('div', 'cmph', t)));
  const order = { changed: 0, added: 1, removed: 2, same: 3 };
  d.slots.slice().sort((x, y) => order[x.state] - order[y.state]).forEach((s) => {
    grid.appendChild(el('div', 'cmpslot ' + s.state, s.label));
    const cell = (text, onlyStats, onlySock, side) => {
      const c = el('div', 'cmpc ' + s.state + ' ' + side);
      c.appendChild(el('b', null, text || '—'));
      onlyStats.forEach((t) => c.appendChild(el('div', 'cst', (side === 'b' ? '+ ' : '− ') + t)));
      if (onlySock.length) c.appendChild(el('div', 'cst sock', (side === 'b' ? '+ ' : '− ') + '◆ ' + onlySock.join(' · ')));
      grid.appendChild(c);
    };
    cell(s.a, s.state === 'same' ? s.statsOnlyA : [], s.socketsA, 'a');
    cell(s.b, s.state === 'same' ? s.statsOnlyB : [], s.socketsB, 'b');
  });
  scroll.appendChild(grid);

  // skills, charms, paragon: what stays, what goes, what comes
  const lists = (title, sp, nice) => {
    if (!sp.both.length && !sp.onlyA.length && !sp.onlyB.length) return;
    sec(title);
    const row = el('div', 'cmplists');
    [['Only in “' + a.name + '”', sp.onlyA, 'gone'], ['Only in “' + b.name + '”', sp.onlyB, 'new'], ['In both', sp.both, 'kept']].forEach(([h, list, cls]) => {
      const col = el('div', 'cmpcol ' + cls);
      col.appendChild(el('div', 'ch5', h + ' (' + list.length + ')'));
      if (!list.length) col.appendChild(el('div', 'cnone', '—'));
      list.forEach((x) => col.appendChild(el('div', 'cit', nice ? nice(x) : x)));
      row.appendChild(col);
    });
    scroll.appendChild(row);
  };
  lists('Skills', d.skills);
  lists('Seal & charms', d.charms);
  lists('Paragon boards', d.boards, boardName);
  lists('Glyphs', d.glyphs, boardName);

  if (d.need.length) {
    sec('Left to farm for “' + b.name + '”');
    const n = el('div', 'cmpneed');
    d.need.forEach((k) => n.appendChild(el('span', 'cneed', keyName(k))));
    n.appendChild(el('div', 'meta', 'Not ticked in either build. Where each one drops is in the other build’s Gear view.'));
    scroll.appendChild(n);
  }
}

const api = { diff, partner, tickKeys, guideOf, render, SLOT_KEYS };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BuildCompare = api;
})(typeof window !== 'undefined' ? window : globalThis);
