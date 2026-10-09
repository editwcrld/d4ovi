// Comparing two builds – mostly two variants of one guide (Starter → Endgame). Read as a
// move from the open build to the other one: which slots change (old → new, and where the new
// one drops), which skills, charms and paragon boards are swapped, and what is left to farm.
// The diff is plain data (tested in Node); render() draws it in the farm list.
(function (root) {
'use strict';

const SLOT_KEYS = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand', 'Weapon 2', 'Weapon 3'];
const LABEL = { 'Chest Armor': 'Chest', Ring1: 'Ring', Ring2: 'Ring 2' };

/** What sits in a slot: the item, or its aspects. */
const parts = (s) => (!s ? [] : s.item ? [s.item] : (s.aspects || []).slice());
const stats = (s) => ((s && s.stats) || []).map((x) => x.t);
/** Items of a list that are not in the other one (each counted, so "Ruby ×2" vs "Ruby ×1" shows). */
function minus(a, b) {
  const left = b.slice();
  return a.filter((x) => { const i = left.indexOf(x); if (i < 0) return true; left.splice(i, 1); return false; });
}
function split(a, b) {
  return { both: a.filter((x) => b.includes(x)), onlyA: minus(a, b), onlyB: minus(b, a) };
}
/** Swaps in the order they come: [old, new]; one side may run out ([old, null] / [null, new]). */
function pairs(sp) {
  const n = Math.max(sp.onlyA.length, sp.onlyB.length);
  return Array.from({ length: n }, (_, i) => [sp.onlyA[i] || null, sp.onlyB[i] || null]);
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
    parts(s).forEach(add);
    (s.sockets || []).forEach((x) => add('s:' + x));
  });
  const ch = b.charms;
  if (ch && ch.seal) add('c:' + ch.seal.name);
  ((ch && ch.list) || []).forEach((c) => add('c:' + c.name));
  return keys;
}
/** How often each gem / rune / splinter is socketed in a build. */
function socketCounts(b) {
  const n = {};
  SLOT_KEYS.forEach((k) => ((b.slots && b.slots[k] && b.slots[k].sockets) || []).forEach((x) => { n[x] = (n[x] || 0) + 1; }));
  return n;
}

const charmNames = (b) => (b.charms ? [].concat(b.charms.seal ? [b.charms.seal.name] : [], (b.charms.list || []).map((c) => c.name)) : []);
const boardKeys = (b) => ((b.paragon && b.paragon.boards) || []).map((x) => x.k);
const glyphKeys = (b) => ((b.paragon && b.paragon.boards) || []).map((x) => x.glyph).filter(Boolean);

/**
 * @returns {{slots: Array, same: number, changed: number, skills: object, charms: object,
 *            boards: object, glyphs: object, need: string[], have: string[], sockets: object}}
 */
function diff(a, b) {
  const slots = [];
  SLOT_KEYS.forEach((key) => {
    const sa = a.slots && a.slots[key], sb = b.slots && b.slots[key];
    if (!sa && !sb) return;
    const pa = parts(sa), pb = parts(sb);
    const state = !sa ? 'added' : !sb ? 'removed' : pa.join('|') === pb.join('|') ? 'same' : 'changed';
    const label = (sb && sb.base) || (sa && sa.base) || LABEL[key] || key;
    const st = split(stats(sa), stats(sb));
    const so = split((sa && sa.sockets) || [], (sb && sb.sockets) || []);
    slots.push({ key, label, a: pa.join(' + '), b: pb.join(' + '), partsA: pa, partsB: pb, state,
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
    seal: b.charms && b.charms.seal ? b.charms.seal.name : '',
    boards: split(boardKeys(a), boardKeys(b)),
    glyphs: split(glyphKeys(a), glyphKeys(b)),
    need: keysB.filter((k) => !done.has(k)),
    have: keysB.filter((k) => done.has(k)),
    sockets: socketCounts(b),
    done,
  };
}

// ---------------------------------------------------------------- drawing
let withId = null;            // the build compared with (kept while the build stays the same)
let forId = null;
let open = {};                // folded-out parts: { rolls: true, same: true }
let names = null;             // paragon board and glyph names, once d2core's database answered

const RCLS = { Mythic: 'r-mythic', Unique: 'r-unique', Runeword: 'r-rune', Legendary: 'r-legendary' };
const ARROW = '<svg viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></svg>';
/** d2core's board keys without names yet: "Paragon_Rogue_03" -> "Board 03". */
const boardName = (k) => (names && names.boards && names.boards[k] && names.boards[k].name) || String(k).replace(/^Paragon_[A-Za-z]+_/, 'Board ').replace(/_/g, ' ');
const glyphName = (k) => (names && names.glyphs && names.glyphs[k] && names.glyphs[k].name) || String(k).replace(/^ParagonGlyph_/, 'Glyph ');

/**
 * @param {HTMLElement} box
 * @param {object} a       the open build
 * @param {object} ctx     { el, builds, rerender(), choose(id), look(name) -> {rarity, where}, api }
 */
function render(box, a, ctx) {
  const el = ctx.el;
  const look = ctx.look || (() => ({}));
  box.classList.add('fcmp');
  const others = ctx.builds.filter((x) => x.id !== a.id);
  if (!others.length) {
    box.appendChild(el('div', 'empty', 'Only one build — import the other variants of a guide (Import, tick them all) or duplicate this one to compare.'));
    return;
  }
  if (forId !== a.id || !others.some((x) => x.id === withId)) { forId = a.id; withId = partner(ctx.builds, a).id; open = {}; }
  const b = others.find((x) => x.id === withId);
  const d = diff(a, b);
  wantNames(a, b, ctx);

  // ---- from this build to that one
  const head = el('div', 'cmp-head');
  const from = el('div', 'cmp-from');
  from.appendChild(el('span', 'k', 'From'));
  from.appendChild(el('b', null, a.name));
  head.appendChild(from);
  head.insertAdjacentHTML('beforeend', '<span class="cmp-arrow">' + ARROW + '</span>');
  const to = el('label', 'cmp-to');
  to.appendChild(el('span', 'k', 'To'));
  const sel = el('select');
  others.forEach((x) => { const o = el('option', null, x.name); o.value = x.id; if (x.id === b.id) o.selected = true; sel.appendChild(o); });
  sel.onchange = () => { withId = sel.value; open = {}; ctx.rerender(); };
  to.appendChild(sel);
  head.appendChild(to);
  head.appendChild(el('span', 'sp'));
  const go = el('button', 'ab', 'Open this build');
  go.title = 'Switch to “' + b.name + '”';
  go.onclick = () => ctx.choose(b.id);
  head.appendChild(go);
  box.appendChild(head);

  const body = el('div', 'cmp-body');
  box.appendChild(body);
  const page = el('div', 'cmp-page');
  body.appendChild(page);

  // one calm line: what moves, and how much is left
  const swaps = (sp) => Math.max(sp.onlyA.length, sp.onlyB.length);
  const facts = [[d.changed, 'gear slot', 'gear slots'], [swaps(d.skills), 'skill', 'skills'], [swaps(d.charms), 'charm', 'charms'], [swaps(d.boards), 'paragon board', 'paragon boards']]
    .filter(([n]) => n).map(([n, one, many]) => n + ' ' + (n === 1 ? one : many));
  const sum = el('div', 'cmp-sum');
  sum.appendChild(el('span', null, facts.length ? 'Changes: ' + facts.join(' · ') : 'The two builds are the same.'));
  sum.appendChild(el('b', d.need.length ? 'left' : 'left none', d.need.length ? d.need.length + ' left to farm' : 'Nothing left to farm'));
  page.appendChild(sum);

  // ---- gear: every change as "old → new", and where the new one drops
  const changed = d.slots.filter((s) => s.state !== 'same');
  const rolls = d.slots.filter((s) => s.state === 'same' && (s.statsOnlyA.length || s.statsOnlyB.length || s.socketsA.length || s.socketsB.length));
  const same = d.slots.filter((s) => s.state === 'same');
  const gear = section(page, el, 'Gear', changed.length ? changed.length + ' of ' + d.slots.length + ' slots change' : 'no slot changes',
    { icon: 'armor', badge: changed.length ? changed.length + ' change' + (changed.length === 1 ? '' : 's') : 'same', badgeCls: changed.length ? 'warn' : 'ok' });
  changed.forEach((s) => {
    const blk = el('div', 'cmp-blk');
    const row = el('div', 'cmp-row');
    row.appendChild(el('span', 'slot', s.label));
    row.appendChild(names_(el, s.partsA, look, 'old'));
    row.insertAdjacentHTML('beforeend', '<span class="arr">' + ARROW + '</span>');
    row.appendChild(names_(el, s.partsB, look, 'new'));
    row.appendChild(whereOf(el, s.partsB, look, d.done));
    blk.appendChild(row);
    if (s.socketsA.length || s.socketsB.length) blk.appendChild(sockLine(el, s));
    gear.appendChild(blk);
  });
  if (rolls.length) {
    const t = fold(gear, el, 'rolls', 'Same item, other rolls', rolls.length, ctx);
    if (open.rolls) {
      rolls.forEach((s) => {
        const r = el('div', 'cmp-roll');
        r.appendChild(el('span', 'slot', s.label));
        const c = el('div', 'what');
        c.appendChild(names_(el, s.partsB, look, 'new'));
        s.statsOnlyA.forEach((x) => c.appendChild(el('div', 'st out', x)));
        s.statsOnlyB.forEach((x) => c.appendChild(el('div', 'st in', x)));
        if (s.socketsA.length || s.socketsB.length) c.appendChild(sockLine(el, s));
        r.appendChild(c);
        gear.appendChild(r);
      });
    }
    t.title = 'Rolls and sockets that differ on an item both builds use';
  }
  if (same.length) {
    const t = fold(gear, el, 'same', 'Unchanged', same.length, ctx);
    if (open.same) {
      const g = el('div', 'cmp-same');
      same.forEach((s) => {
        const c = el('span', 'chip');
        c.appendChild(el('i', null, s.label));
        c.appendChild(names_(el, s.partsB, look, 'new'));
        g.appendChild(c);
      });
      gear.appendChild(g);
    }
    t.title = 'Slots that hold the same thing in both builds';
  }

  // ---- skills, charms, paragon: swaps as "old → new", the rest in one quiet line
  swapSection(page, el, 'Skills', d.skills, (x) => x, 'skills');
  swapSection(page, el, 'Seal & charms', d.charms, (x) => (x === d.seal ? x + ' (seal)' : x), 'charm');
  swapSection(page, el, 'Paragon boards', d.boards, boardName, 'paragon');
  swapSection(page, el, 'Glyphs', d.glyphs, glyphName, 'glyph');

  // ---- what is left to farm for the other build, by where it comes from
  if (d.need.length) {
    const sec = section(page, el, 'Left to farm for “' + b.name + '”', 'Ticked in neither build — by where it comes from',
      { icon: 'target', badge: d.need.length + ' left', badgeCls: 'warn', cls: 'accent' });
    const groups = new Map();
    const put = (g, node) => { if (!groups.has(g)) groups.set(g, []); groups.get(g).push(node); };
    d.need.forEach((k) => {
      if (k.startsWith('s:')) {
        const n = k.slice(2), c = d.sockets[n] || 1;
        put('Gems, runes & splinters', el('span', 'nm gem', n + (c > 1 ? ' ×' + c : '')));
      } else if (k.startsWith('c:')) {
        put('Seal & charms', el('span', 'nm charm', k.slice(2)));
      } else {
        const l = look(k);
        put(l.where || 'Random drop', el('span', 'nm ' + (RCLS[l.rarity] || ''), k));
      }
    });
    // bosses and dungeons first, the general places after them
    const late = /^(gems|seal|salvage|random|any )/i;
    [...groups.keys()].sort((x, y) => late.test(x) - late.test(y)).forEach((g) => {
      const r = el('div', 'cmp-need');
      r.appendChild(el('span', 'cmp-src', g));
      const list = el('div', 'list');
      groups.get(g).forEach((n) => list.appendChild(n));
      r.appendChild(list);
      sec.appendChild(r);
    });
  }
}

/** A section as a slim card (renderer/cards.js) – icon, title, a line, a badge with the count. */
function section(page, el, title, sub, o = {}) {
  if (root.SCard) {
    const c = root.SCard.card(el, { title, sub, icon: o.icon, badge: o.badge, badgeCls: o.badgeCls, cls: 'slim cmp-sec' + (o.cls ? ' ' + o.cls : '') });
    page.appendChild(c.card);
    return c.body;
  }
  const s = el('div', 'cmp-sec');
  const h = el('div', 'cmp-h');
  h.appendChild(el('h3', null, title));
  if (sub) h.appendChild(el('span', null, sub));
  s.appendChild(h);
  page.appendChild(s);
  return s;
}
/** A part of a section that folds out on a click ("Unchanged · 8"). */
function fold(into, el, key, label, n, ctx) {
  const t = el('button', 'cmp-fold' + (open[key] ? ' on' : ''));
  t.appendChild(el('span', 'chev', open[key] ? '▾' : '▸'));
  t.appendChild(el('span', null, label));
  t.appendChild(el('b', null, String(n)));
  t.onclick = () => { open[key] = !open[key]; ctx.rerender(); };
  into.appendChild(t);
  return t;
}
/** Item / aspect names in their rarity colour; nothing there reads "empty". */
function names_(el, list, look, side) {
  const w = el('span', 'nms ' + side);
  if (!list.length) { w.appendChild(el('span', 'none', 'empty')); return w; }
  list.forEach((n, i) => {
    if (i) w.appendChild(el('span', 'plus', '+'));
    w.appendChild(el('span', 'nm ' + (RCLS[look(n).rarity] || ''), n));
  });
  return w;
}
/** Where the new piece drops – or that you have it already. */
function whereOf(el, list, look, done) {
  const w = el('span', 'cmp-src');
  if (!list.length) return w;
  if (list.every((n) => done.has(n))) { w.classList.add('have'); w.textContent = '✓ you have it'; return w; }
  const places = [...new Set(list.filter((n) => !done.has(n)).map((n) => look(n).where).filter(Boolean))];
  w.textContent = places.join(' · ');
  return w;
}
function sockLine(el, s) {
  const l = el('div', 'cmp-sock');
  l.appendChild(el('span', 'k', 'Sockets'));
  if (s.socketsA.length) l.appendChild(el('span', 'out', s.socketsA.join(', ')));
  if (s.socketsA.length && s.socketsB.length) l.insertAdjacentHTML('beforeend', '<span class="arr">' + ARROW + '</span>');
  if (s.socketsB.length) l.appendChild(el('span', 'in', s.socketsB.join(', ')));
  return l;
}
function swapSection(page, el, title, sp, nice, icon) {
  const ps = pairs(sp);
  if (!ps.length && !sp.both.length) return;
  const n = (f) => ps.filter(f).length;
  const what = [[n(([x, y]) => x && y), 'swapped'], [n(([x]) => !x), 'new'], [n(([, y]) => !y), 'removed']]
    .filter(([k]) => k).map(([k, w]) => k + ' ' + w).join(' · ');
  const moves = ps.length;
  const sec = section(page, el, title, what || 'the same in both',
    { icon, badge: moves ? moves + ' change' + (moves === 1 ? '' : 's') : 'same', badgeCls: moves ? 'warn' : 'ok' });
  // same columns as the gear, so every arrow sits under the one above
  ps.forEach(([x, y]) => {
    const blk = el('div', 'cmp-blk');
    const row = el('div', 'cmp-row');
    // one side empty: an addition ("— → X  new") or a removal ("X → —  removed")
    const one = (v, side) => { const s = el('span', 'nms ' + side); s.appendChild(v ? el('span', 'nm', nice(v)) : el('span', 'none', '—')); return s; };
    row.appendChild(el('span', 'slot'));
    row.appendChild(one(x, 'old'));
    row.insertAdjacentHTML('beforeend', '<span class="arr">' + ARROW + '</span>');
    row.appendChild(one(y, 'new'));
    row.appendChild(x && y ? el('span', 'cmp-src') : el('span', 'cmp-src tag ' + (y ? 'add' : 'del'), y ? 'new' : 'removed'));
    blk.appendChild(row);
    sec.appendChild(blk);
  });
  if (sp.both.length) sec.appendChild(el('div', 'cmp-kept', 'Kept: ' + sp.both.map(nice).join(' · ')));
}

/** Board and glyph names come from d2core's database – asked once, then drawn again. */
let asked = '';
function wantNames(a, b, ctx) {
  const keys = [...new Set(boardKeys(a).concat(boardKeys(b)))];
  const id = keys.join('|');
  if (!keys.length || !ctx.api || !ctx.api.buildParagon || asked === id) return;
  asked = id;
  Promise.resolve(ctx.api.buildParagon(keys)).then((r) => {
    if (r && !r.error) { names = { boards: r.boards || {}, glyphs: r.glyphs || {} }; ctx.rerender(); }
  }).catch(() => {});
}

const api = { diff, partner, pairs, tickKeys, guideOf, render, SLOT_KEYS };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.BuildCompare = api;
})(typeof window !== 'undefined' ? window : globalThis);
