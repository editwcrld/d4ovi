// Skill tree and paragon boards of a build, drawn after d2core.com's planner.
//
//   skills   the skill bar (every source) and – for d2core builds – the whole tree: d2core's node
//            positions and links, the ranks the build spent highlighted
//   paragon  the boards on their grid, turned as in the build, the nodes taken lit up, the glyph
//            in its socket
//
// The tree and the boards come from the main process (d2core's database, see lib/d2coredb.js).
// Everything shown here is text from other sites, so it is only ever set as textContent.
(function () {
'use strict';

const NS = 'http://www.w3.org/2000/svg';
const ICON = (id) => 'https://cloudstorage.d2core.com/data_img/d4/skill/' + id + '.png';
const N = 21;                                  // a paragon board is 21 x 21
const CELL = 10;
const STRETCH = 1.7;                           // skill tree: extra height between the rows
const cache = { tree: {}, paragon: {} };

const svg = (tag, attrs, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};

// ---------------------------------------------------------------- tooltip
// the overlay's one hover card (renderer/ui.js)
const tip = (e, title, sub, lines) => UI.tip.show(e, { title, sub, lines });
const untip = () => UI.tip.hide();
function hover(node, fn) {
  node.addEventListener('mouseenter', (e) => fn(e));
  node.addEventListener('mousemove', (e) => UI.tip.move(e));
  node.addEventListener('mouseleave', untip);
}

// ---------------------------------------------------------------- pan & zoom
/**
 * Wheel zooms around the pointer, dragging moves, the buttons zoom / fit.
 * @param {object} [start]  the view to begin with (kept when a drawing is redone)
 * @returns {{get: function, go: function, onTap: function}}  the current view, a glide to another
 *          one, and onTap(target) – set it to hear clicks that were not drags
 */
function panZoom(root, el, view, box, start) {
  let vb = Object.assign({}, start || box);
  let anim = 0;
  const set = () => view.setAttribute('viewBox', vb.x + ' ' + vb.y + ' ' + vb.w + ' ' + vb.h);
  const go = (to) => {
    clearTimeout(anim);
    const from = Object.assign({}, vb), t0 = Date.now();
    // a timer, not animation frames: those stop while the window is hidden
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 260), e = 1 - Math.pow(1 - k, 3);
      vb = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, w: from.w + (to.w - from.w) * e, h: from.h + (to.h - from.h) * e };
      set();
      if (k < 1) anim = setTimeout(step, 16);
    };
    step();
  };
  const zoom = (f, cx, cy) => {
    clearTimeout(anim);
    const w = Math.min(box.w * 4, Math.max(box.w / 12, vb.w * f));
    const k = w / vb.w;
    vb = { x: cx - (cx - vb.x) * k, y: cy - (cy - vb.y) * k, w, h: vb.h * k };
    set();
  };
  const toView = (e) => {
    const r = view.getBoundingClientRect();
    const s = Math.max(vb.w / (r.width || 1), vb.h / (r.height || 1));         // preserveAspectRatio meet
    return { x: vb.x + vb.w / 2 + (e.clientX - r.left - r.width / 2) * s, y: vb.y + vb.h / 2 + (e.clientY - r.top - r.height / 2) * s, s };
  };
  view.addEventListener('wheel', (e) => { e.preventDefault(); const p = toView(e); zoom(e.deltaY > 0 ? 1.18 : 1 / 1.18, p.x, p.y); }, { passive: false });
  // the pointer is captured while dragging, so nothing has to listen on the window
  // (the click itself would land on the svg: the pointer is captured there)
  const ctl = { get: () => Object.assign({}, vb), go, onTap: null };
  let drag = null;
  view.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    clearTimeout(anim);
    drag = { x: e.clientX, y: e.clientY, vb: Object.assign({}, vb), s: toView(e).s, target: e.target, moved: false };
    try { view.setPointerCapture(e.pointerId); } catch (_) { /* jsdom */ }
    view.classList.add('drag');
  });
  view.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 5) return;
    drag.moved = true;
    untip();
    vb.x = drag.vb.x - (e.clientX - drag.x) * drag.s; vb.y = drag.vb.y - (e.clientY - drag.y) * drag.s; set();
  });
  const stop = () => { drag = null; view.classList.remove('drag'); };
  view.addEventListener('pointerup', (e) => {
    const d = drag;
    stop();
    if (d && !d.moved && ctl.onTap && e.button === 0) ctl.onTap(d.target);
  });
  view.addEventListener('pointercancel', stop);
  const tools = el('div', 'pz');
  [['+', 'Zoom in', () => zoom(1 / 1.4, vb.x + vb.w / 2, vb.y + vb.h / 2)],
    ['−', 'Zoom out', () => zoom(1.4, vb.x + vb.w / 2, vb.y + vb.h / 2)],
    ['⤢', 'Fit', () => go(box)]].forEach(([t, title, fn]) => {
    const b = el('button', 'btn icon', t); b.title = title; b.onclick = fn; tools.appendChild(b);
  });
  root.appendChild(tools);
  set();
  return ctl;
}

function waitFor(box, el, key, store, get, draw) {
  if (store[key]) { draw(store[key]); return; }
  const wait = el('div', 'empty', 'Loading from d2core.com …');
  box.appendChild(wait);
  get().then((d) => {
    if (!d || d.error) { wait.textContent = 'Could not load it from d2core.com' + (d && d.error ? ': ' + d.error : '') + '.'; return; }
    store[key] = d;
    if (wait.isConnected) { wait.remove(); draw(d); }
  });
}

// ---------------------------------------------------------------- skills
/** "{val1}%" with the value at the build's rank. */
const fill = (s, val, rank) => String(s || '').replace(/\{val1\}/g, () => (val && val.length ? val[Math.max(0, Math.min(val.length, rank || 1) - 1)] : '?'));

function skills(box, b, ctx) {
  const el = ctx.el;
  const sk = b.skills;
  box.classList.add('fskills');
  if (!sk) { box.appendChild(el('div', 'empty', 'No skills in this build — import one from d2core.com, maxroll.gg, infinitybuilds.gg or d4builds.gg.')); return; }
  // the page scrolls as a whole: the bar's cards, the passives, then the tree on its plate
  box.classList.add('scroll');
  const bar = el('div', 'sbar sk3');
  let tree = null;                               // the drawn tree, once it is loaded
  let focused = null;                            // the skill id zoomed to
  const cards = [];
  // from the bar or from the tree: zoom to the skill, light its card; again: back out
  const pick = (id) => {
    focused = id != null && id !== focused ? id : null;
    tree.focus(focused);
    cards.forEach((x, j) => x.classList.toggle('on', focused != null && tree.idOf(sk.bar[j]) === focused));
  };
  sk.bar.forEach((s) => {
    const c = el('div', 'skc');
    cards.push(c);
    c.onclick = () => { if (tree && tree.idOf(s) != null) pick(tree.idOf(s)); };
    const ic = el('div', 'sic');
    if (s.icon) ic.appendChild(UI.img(ICON(s.icon)));
    const t = el('div', 't');
    t.appendChild(el('b', null, s.name));
    if (s.rank) {
      // the rank as the game's pips (five), the number beside them
      const r = el('span', 'rk');
      const pips = el('span', 'pips');
      for (let i = 1; i <= 5; i++) pips.appendChild(el('i', i <= s.rank ? 'on' : ''));
      r.appendChild(pips);
      r.appendChild(el('span', null, 'Rank ' + s.rank));
      t.appendChild(r);
    }
    const top = el('div', 'top');
    top.appendChild(ic);
    top.appendChild(t);
    c.appendChild(top);
    // its upgrades in the order they are taken in the game
    if (s.mods && s.mods.length) {
      const ol = el('ol', 'mods');
      s.mods.forEach((m) => ol.appendChild(el('li', null, m)));
      c.appendChild(ol);
    }
    bar.appendChild(c);
  });
  box.appendChild(bar);
  const ranks = sk.ranks || {};
  if (!Object.keys(ranks).length) {
    // d4builds.gg serves its skill tree data encrypted – its own page shows the tree instead
    const note = el('div', 'meta note-soft');
    note.appendChild(document.createTextNode('d4builds.gg keeps its skill tree data encrypted, so the tree comes straight from its page: '));
    if (b.source && /d4builds\.gg/.test(b.source.url) && ctx.openPage) {
      const go = UI.btn('Show the skill tree from d4builds.gg', null, 'pri');
      go.onclick = () => ctx.openPage(b.source.url);
      note.appendChild(go);
    }
    box.appendChild(note);
    return;
  }
  const pass = el('div', 'passives');
  box.appendChild(pass);
  const tp = UI.plate({ title: 'Skill tree', sub: 'Click a skill above or in the tree to find it · wheel zooms, drag moves', icon: 'skills', cls: 'treeplate' });
  const area = el('div', 'canvas');
  tp.body.appendChild(area);
  box.appendChild(tp.card);
  waitFor(area, el, b.cls, cache.tree, () => ctx.api.buildTree(b.cls), (t) => {
    tree = drawTree(area, el, t, ranks, (id) => pick(id));
    if (!tree) return;
    passives(pass, el, t, ranks, sk.bar);
    cards.forEach((c, i) => { if (tree.idOf(sk.bar[i]) != null) { c.classList.add('can'); c.title = 'Click to find it in the tree'; } });
    // the bar in the tree's order: top of the tree first, then down
    cards.map((c, i) => [c, tree.rowOf(sk.bar[i]), i]).sort((a, b) => a[1] - b[1] || a[2] - b[2]).forEach(([c]) => bar.appendChild(c));
    // a skill clicked elsewhere (the bar in the slots view): straight to it
    if (focusNext) { const id = tree.idOf(focusNext); focusNext = null; if (id != null) pick(id); }
  });
}

/** The passives the build takes, as medallions with their rank – key passives in red. */
function passives(box, el, t, ranks, bar) {
  const inBar = new Set((bar || []).map((s) => s.id));
  const list = (t.nodes || []).filter((n) => n.k === 'skill' && ranks[n.id] && !inBar.has(n.id) && t.skills[n.id])
    .filter((n, i, a) => a.findIndex((x) => x.id === n.id) === i);
  if (!list.length) return;
  const p = UI.plate({ title: 'Passives', sub: 'in the order of the tree', icon: 'glyph', badge: list.length });
  const m = el('div', 'medals');
  list.forEach((n) => {
    const s = t.skills[n.id];
    const key = /key passive/i.test((s.desc || []).join(' ')) || n.ranks === 1;
    const d = el('span', 'medal' + (key ? ' key' : ''));
    d.appendChild(el('i', null, String(ranks[n.id])));
    d.appendChild(el('span', null, s.name));
    hover(d, (e) => tip(e, s.name, 'Rank ' + ranks[n.id] + ' / ' + (n.ranks || '?'), (s.desc || []).map((x) => fill(x, s.val, ranks[n.id]))));
    m.appendChild(d);
  });
  p.body.appendChild(m);
  box.appendChild(p.card);
}

function drawTree(area, el, t, ranks, onPick) {
  if (!t || !t.nodes) { area.appendChild(el('div', 'empty', 'No skill tree for this class.')); return null; }
  // the tree is pulled apart in height: the labels above and below a skill need the room
  const nodes = t.nodes.map((n) => Object.assign({}, n, { y: n.y * STRETCH }));
  const rankOf = (n) => (n.k === 'mod' ? ranks[n.id + '_' + n.mod] || 0 : n.k === 'skill' ? ranks[n.id] || 0 : 0);
  // junctions count as taken when they connect taken nodes (two taken neighbours, or the root)
  const nb = nodes.map(() => []);
  t.links.forEach((l) => { nb[l[0]].push(l[1]); nb[l[1]].push(l[0]); });
  const on = nodes.map((n) => rankOf(n) > 0);
  for (let pass = 0; pass < 6; pass++) {
    nodes.forEach((n, i) => {
      if (on[i] || (n.k !== 'link' && n.k !== 'root')) return;
      const c = nb[i].filter((j) => on[j]).length;
      if (c >= 2 || (n.k === 'root' && c >= 1)) on[i] = true;
    });
  }
  const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y);
  const pad = 400;
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
  const view = svg('svg', { class: 'tree', preserveAspectRatio: 'xMidYMid meet' });
  const defs = svg('defs', {}, view);
  const gl = svg('g', { class: 'links' }, view);
  const lineOf = [];
  t.links.forEach((l) => {
    const corners = l.slice(2).map((v, i) => (i % 2 ? v * STRETCH : v));
    const pts = [nodes[l[0]].x, nodes[l[0]].y].concat(corners, [nodes[l[1]].x, nodes[l[1]].y]);
    const p = [];
    for (let i = 0; i < pts.length; i += 2) p.push(pts[i] + ',' + pts[i + 1]);
    lineOf.push(svg('polyline', { points: p.join(' '), class: on[l[0]] && on[l[1]] ? 'on' : '' }, gl));
  });
  const gn = svg('g', { class: 'nodes' }, view);
  const elOf = [];
  nodes.forEach((n, i) => {
    const r = rankOf(n);
    const s = n.k === 'skill' || n.k === 'mod' ? t.skills[n.id] : null;
    if (n.k === 'skill') {
      const g = svg('g', { class: 'sk' + (r ? ' on' : ''), transform: 'translate(' + n.x + ',' + n.y + ')' }, gn);
      elOf[i] = g;
      svg('circle', { r: 330, class: 'halo' }, g);
      svg('circle', { r: 250, class: 'ring' }, g);
      if (s && s.icon) {
        const cp = svg('clipPath', { id: 'sk' + i }, defs);
        svg('circle', { r: 220 }, cp);
        svg('image', { href: ICON(s.icon), x: -220, y: -220, width: 440, height: 440, 'clip-path': 'url(#sk' + i + ')', preserveAspectRatio: 'xMidYMid slice' }, g);
      }
      if (r) {
        const lb = svg('text', { y: 420, class: 'rank' }, g); lb.textContent = r + '/' + (n.ranks || r);
      }
      if (s && r) { const nm = svg('text', { y: -300, class: 'name' }, g); nm.textContent = s.name; }
      hover(g, (e) => tip(e, s ? s.name : 'Skill', (r ? 'Rank ' + r : 'Not taken') + ' / ' + (n.ranks || '?'),
        s ? s.desc.map((d) => fill(d, s.val, r)) : []));
    } else if (n.k === 'mod') {
      const m = s && s.mods && s.mods[n.mod];
      const g = svg('g', { class: 'md' + (r ? ' on' : ''), transform: 'translate(' + n.x + ',' + n.y + ') rotate(45)' }, gn);
      elOf[i] = g;
      svg('rect', { x: -75, y: -75, width: 150, height: 150, rx: 20 }, g);
      hover(g, (e) => tip(e, m ? m.name : 'Modifier', (s ? s.name + ' · ' : '') + (r ? 'taken' : 'not taken'), m ? [m.desc] : []));
    } else {
      svg('circle', { cx: n.x, cy: n.y, r: n.k === 'root' ? 95 : 60, class: 'jn' + (on[i] ? ' on' : '') }, gn);
    }
  });
  area.appendChild(view);
  const pz = panZoom(area, el, view, box);
  const find = (s) => (s ? nodes.findIndex((n) => n.k === 'skill' && (s.id ? n.id === s.id : t.skills[n.id] && t.skills[n.id].name === s.name)) : -1);
  // a click on a skill or one of its modifiers picks that skill
  pz.onTap = (target) => {
    const g = target && target.closest && target.closest('g.sk, g.md');
    const i = g ? elOf.indexOf(g) : -1;
    if (i >= 0 && onPick) onPick(nodes[i].id);
  };
  return {
    idOf: (s) => { const i = find(s); return i >= 0 ? nodes[i].id : null; },
    rowOf: (s) => { const i = find(s); return i >= 0 ? nodes[i].y * 100000 + nodes[i].x : Infinity; },
    /** Lights the skill and its modifiers up and zooms in on them – the branch around stays in view. */
    focus(id) {
      view.querySelectorAll('.focus').forEach((x) => x.classList.remove('focus'));
      const i = id == null ? -1 : find({ id });
      if (i < 0) { pz.go(box); return false; }
      const near = new Set([i]);
      nodes.forEach((n, j) => { if (n.k === 'mod' && n.id === nodes[i].id) near.add(j); });
      near.forEach((j) => elOf[j] && elOf[j].classList.add('focus'));
      t.links.forEach((l, j) => { if (near.has(l[0]) && near.has(l[1])) lineOf[j].classList.add('focus'); });
      // the skill, its modifiers and its neighbours, with room around for the branch
      const pts = [...near].concat(nb[i]).map((j) => nodes[j]);
      const x0 = Math.min(...pts.map((n) => n.x)), x1 = Math.max(...pts.map((n) => n.x));
      const y0 = Math.min(...pts.map((n) => n.y)), y1 = Math.max(...pts.map((n) => n.y));
      const w = Math.max(x1 - x0 + 2600, 5200), h = Math.max(y1 - y0 + 2200, 3600);
      pz.go({ x: (x0 + x1) / 2 - w / 2, y: (y0 + y1) / 2 - h / 2, w, h });
      return true;
    },
  };
}

// ---------------------------------------------------------------- paragon
const turn = (r, c, k) => { for (let i = 0; i < k; i++) [r, c] = [c, N - 1 - r]; return [r, c]; };
const KIND = ['normal', 'normal', 'magic', 'rare', 'legendary'];
const GAP = 3;                                 // empty cells between two boards – room for the name
const PIMG = (f) => 'https://cloudstorage.d2core.com/data_img/d4/paragon/' + f;
const pstate = { icons: false, sel: 0 };   // as in the mockup: one board big to start with – All shows the chain
try { pstate.icons = localStorage.getItem('paragon.icons') === '1'; } catch (_) { /* private storage */ }

function paragon(box, b, ctx) {
  const el = ctx.el;
  const P = b.paragon;
  box.classList.add('fparagon');
  if (!P) { box.appendChild(el('div', 'empty', 'No paragon boards in this build — import it from d2core.com, maxroll.gg, infinitybuilds.gg or d4builds.gg.')); return; }
  if (pstate.sel >= P.boards.length) pstate.sel = -1;
  const keys = P.boards.map((x) => x.k);
  // as in the mockup: the boards as a film strip on top, the one picked big, beside it its glyph
  // and its legendary node – "All" shows the whole chain
  const film = el('div', 'pfilm');
  const row = el('div', 'pmain');
  const area = el('div', 'canvas');
  const side = el('div', 'pside');
  row.appendChild(area);
  row.appendChild(side);
  box.appendChild(film);
  box.appendChild(row);
  waitFor(area, el, keys.join('|'), cache.paragon, () => ctx.api.buildParagon(keys), (d) => show(area, side, film, el, P, d));
}
// drawn again when the look is switched – the boards are already here
function show(area, side, film, el, P, d, at) {
  const drawn = drawParagon(area, el, P, d, at);
  const redraw = () => {
    const keep = drawn && drawn.pz.get();          // the same spot and zoom in the other look
    area.textContent = ''; side.textContent = ''; film.textContent = '';
    show(area, side, film, el, P, d, keep);
  };
  const ui = { drawn, side, film, el, P, d, redraw };
  if (drawn) {
    drawn.pz.onTap = (target) => {
      const g = target && target.closest && target.closest('g.board');
      const i = g ? [...drawn.view.querySelectorAll('g.board')].indexOf(g) : -1;
      if (i >= 0) select(ui, i);
    };
  }
  filmStrip(ui);
  sidePlates(ui);
  // a board picked before: straight to it
  if (drawn && pstate.sel >= 0 && !at && drawn.rects[pstate.sel]) drawn.pz.go(drawn.rects[pstate.sel]);
}

/** Lights one board up (and dims the rest) and moves to it; a second click (or All) shows all again. */
function select(ui, i) {
  pstate.sel = i < 0 || pstate.sel === i ? -1 : i;
  const { drawn } = ui;
  const view = drawn && drawn.view;
  // the whole board with its name and a little room around it, or everything again
  if (drawn) drawn.pz.go(pstate.sel >= 0 && drawn.rects[pstate.sel] ? drawn.rects[pstate.sel] : drawn.box);
  if (view) view.querySelectorAll('g.board').forEach((g, j) => {
    g.classList.toggle('sel', j === pstate.sel);
    g.classList.toggle('dim', pstate.sel >= 0 && j !== pstate.sel);
  });
  ui.film.querySelectorAll('.pb').forEach((r, j) => r.classList.toggle('on', j === pstate.sel));
  const all = ui.film.querySelector('.pall');
  if (all) all.classList.toggle('on', pstate.sel < 0);
  ui.side.textContent = '';
  sidePlates(ui);
}

/** The board's legendary node, when the build takes it. */
function legendaryOf(bd, d) {
  const g = d.boards[bd.k];
  if (!g) return null;
  const rows = g.rows.map((r) => String(r).split(','));
  const leg = bd.nodes.map(([r, c]) => rows[r] && rows[r][c]).find((k) => k && d.nodes[k] && d.nodes[k].r === 4);
  return leg ? d.nodes[leg] : null;
}

/** The film strip: All, then every board – its name, its glyph and how many nodes it takes. */
function filmStrip(ui) {
  const { film, el, P, d } = ui;
  const all = el('button', 'pall' + (pstate.sel < 0 ? ' on' : ''));
  all.appendChild(el('b', null, 'All'));
  all.appendChild(el('small', null, P.boards.reduce((n, bd) => n + bd.nodes.length, 0) + ' nodes'));
  all.title = 'The whole chain';
  all.onclick = () => select(ui, -1);
  film.appendChild(all);
  P.boards.forEach((bd, i) => {
    const g = d.boards[bd.k];
    if (i) film.appendChild(el('span', 'arrow', '›'));
    const b = el('button', 'pb' + (i === pstate.sel ? ' on' : ''));
    b.title = 'Click to show this board';
    b.appendChild(el('b', null, (i + 1) + '. ' + (g ? g.name : bd.k)));
    const gl = bd.glyph && d.glyphs[bd.glyph];
    b.appendChild(el('small', 'gl', gl ? '◈ ' + gl.name + (bd.glyphRank ? ' · ' + bd.glyphRank : '') : bd.nodes.length + ' nodes'));
    b.onclick = () => select(ui, i);
    film.appendChild(b);
  });
}

/** Beside the board: its glyph as a medallion, its legendary node, how it is drawn. */
function sidePlates(ui) {
  const { side, el, P, d } = ui;
  const i = pstate.sel;
  const boards = i >= 0 ? [P.boards[i]] : P.boards;
  // the glyph: the picked board's, or – showing all – every board's
  const gp = UI.plate({ title: i >= 0 ? 'Glyph' : 'Glyphs', icon: 'glyph', cls: 'pglyph' });
  boards.forEach((bd) => {
    const gl = bd.glyph && d.glyphs[bd.glyph];
    if (!gl) return;
    const m = el('div', 'gmed');
    m.appendChild(el('span', 'gm'));
    const t = el('div', 'gtx');
    t.appendChild(el('b', null, gl.name));
    t.appendChild(el('span', null, bd.glyphRank ? 'Rank ' + bd.glyphRank : 'Glyph'));
    m.appendChild(t);
    hover(m, (e) => tip(e, gl.name, 'Glyph' + (bd.glyphRank ? ' · rank ' + bd.glyphRank : ''), [gl.desc, gl.bonus]));
    gp.body.appendChild(m);
  });
  if (!gp.body.children.length) gp.body.appendChild(el('div', 'meta', 'No glyph on this board.'));
  side.appendChild(gp.card);
  // the legendary nodes taken
  const lp = UI.plate({ title: 'Legendary', icon: 'star', cls: 'plegend' });
  boards.forEach((bd) => {
    const n = legendaryOf(bd, d);
    if (!n) return;
    const x = el('div', 'lg', '★ ' + n.name);
    hover(x, (e) => tip(e, n.name, 'Legendary node', [n.d]));
    lp.body.appendChild(x);
  });
  if (lp.body.children.length) side.appendChild(lp.card);
  // how it is drawn
  const look = el('div', 'plook');
  [['Minimal', false], ['Icons', true]].forEach(([label, v]) => {
    const x = el('button', 'lk' + (pstate.icons === v ? ' on' : ''), label);
    x.title = v ? 'The node icons as in the game' : 'Plain squares by rarity';
    x.onclick = () => { if (pstate.icons === v) return; pstate.icons = v; try { localStorage.setItem('paragon.icons', v ? '1' : '0'); } catch (_) {} ui.redraw(); };
    look.appendChild(x);
  });
  side.appendChild(look);
  const total = boards.reduce((n, bd) => n + bd.nodes.length, 0);
  side.appendChild(el('div', 'meta', total + ' nodes taken'));
}

/** The pictures d2core draws a node with: a frame by quality and the icon on top. */
function nodeImages(key, node, kind) {
  if (kind === 'start') return [PIMG('node_type_start.webp')];
  if (kind === 'gate') return [PIMG('node_type_gate_bg.webp'), PIMG('node_type_gate.webp')];
  if (kind === 'socket') return [PIMG('node_type_glyph_bg.webp'), PIMG('node_type_glyph.webp')];
  const q = (String(key).split('_')[1] || 'normal').toLowerCase();
  return [PIMG('node_quality_' + (/^(normal|magic|rare|legendary)$/.test(q) ? q : 'normal') + '.webp')].concat(node.ic ? [PIMG(node.ic + '.webp')] : []);
}

function drawParagon(area, el, P, d, at) {
  const view = svg('svg', { class: 'para' + (pstate.icons ? ' icons' : ''), preserveAspectRatio: 'xMidYMid meet' });
  const lines = svg('g', { class: 'joins' }, view);
  const STEP = N + GAP;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const gates = [];                              // [board, x, y on the plain grid, x, y drawn]
  const rects = [];                              // each board's frame, for zooming to it
  P.boards.forEach((bd, bi) => {
    const g = d.boards[bd.k];
    if (!g) { svg('g', { class: 'board' }, view); return; }
    const ox = bd.x * STEP, oy = bd.y * STEP;
    rects[bi] = { x: (ox - 2) * CELL, y: (oy - GAP - 1) * CELL, w: (N + 4) * CELL, h: (N + GAP + 3) * CELL };
    // the name sits in the gap above the board, never on its nodes
    minX = Math.min(minX, ox); minY = Math.min(minY, oy - GAP); maxX = Math.max(maxX, ox + N); maxY = Math.max(maxY, oy + N);
    const grp = svg('g', { class: 'board' + (bi === pstate.sel ? ' sel' : pstate.sel >= 0 ? ' dim' : '') }, view);
    svg('rect', { x: ox * CELL, y: oy * CELL, width: N * CELL, height: N * CELL, rx: 8, class: 'bg' }, grp);
    // name on the left, glyph on the right – the middle stays free for the line to the next gate
    const lb = svg('text', { x: ox * CELL + 2, y: (oy - 0.9) * CELL, class: 'bname' }, grp);
    lb.textContent = (bi + 1) + '. ' + g.name;
    if (bd.glyph && d.glyphs[bd.glyph]) {
      const gt = svg('text', { x: (ox + N) * CELL - 2, y: (oy - 0.9) * CELL, class: 'bname gname' }, grp);
      gt.textContent = '◈ ' + d.glyphs[bd.glyph].name;
    }
    const rows = g.rows.map((r) => String(r).split(','));
    const taken = new Set(bd.nodes.map(([r, c]) => r + '_' + c));
    rows.forEach((row, r) => row.forEach((key, c) => {
      if (!key) return;
      const node = d.nodes[key] || { name: key, r: 0, d: '', t: '' };
      const [rr, cc] = turn(r, c, bd.rot);
      const x = (ox + cc) * CELL + CELL / 2, y = (oy + rr) * CELL + CELL / 2;
      const kind = node.t || KIND[node.r] || 'normal';
      const on = taken.has(r + '_' + c);
      if (kind === 'gate') gates.push([bi, bd.x * N + cc, bd.y * N + rr, x, y]);
      const glyph = kind === 'socket' && bd.glyph && d.glyphs[bd.glyph];
      let shape;
      if (pstate.icons) {
        shape = svg('g', { class: 'pi ' + kind + (on ? ' on' : '') + (glyph ? ' glyph' : '') }, grp);
        const big = kind === 'legendary' || kind === 'socket' || kind === 'gate' ? 11 : kind === 'rare' ? 10 : 9;
        nodeImages(key, node, kind).forEach((src, i) => {
          const s = i ? big * 0.72 : big;
          svg('image', { href: src, x: x - s / 2, y: y - s / 2, width: s, height: s }, shape);
        });
      } else {
        const cls = 'pn ' + kind + (on ? ' on' : '');
        if (kind === 'gate') shape = svg('rect', { x: x - 3.6, y: y - 3.6, width: 7.2, height: 7.2, transform: 'rotate(45 ' + x + ' ' + y + ')', class: cls }, grp);
        else if (kind === 'socket' || kind === 'start') shape = svg('circle', { cx: x, cy: y, r: 4.4, class: cls }, grp);
        else {
          const s = kind === 'legendary' ? 9 : kind === 'rare' ? 7.6 : kind === 'magic' ? 6.6 : 5.4;
          shape = svg('rect', { x: x - s / 2, y: y - s / 2, width: s, height: s, rx: 1.2, class: cls }, grp);
        }
        if (glyph) shape.classList.add('glyph');
      }
      hover(shape, (e) => (glyph
        ? tip(e, glyph.name, 'Glyph' + (bd.glyphRank ? ' · rank ' + bd.glyphRank : ''), [glyph.desc, glyph.bonus])
        : tip(e, node.name.replace(/^Generic_/, '').replace(/_/g, ' '), on ? 'taken' : 'not taken', node.d ? node.d.split('\n') : [])));
    }));
  });
  // two gates that touch on the plain grid are joined across the gap
  for (let i = 0; i < gates.length; i++) {
    for (let j = i + 1; j < gates.length; j++) {
      const a = gates[i], b = gates[j];
      if (a[0] !== b[0] && Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) === 1) svg('line', { x1: a[3], y1: a[4], x2: b[3], y2: b[4] }, lines);
    }
  }
  if (!Number.isFinite(minX)) { area.appendChild(el('div', 'empty', 'These boards are not in d2core.com\'s database.')); return null; }
  area.appendChild(view);
  const pad = 6;
  const box = { x: (minX * CELL) - pad, y: (minY * CELL) - pad, w: (maxX - minX) * CELL + pad * 2, h: (maxY - minY) * CELL + pad * 2 };
  const pz = panZoom(area, el, view, box, at);
  return { view, pz, box, rects };
}

/** The skill to zoom to when the skills open next ({id, name} of the bar). */
let focusNext = null;
window.BuildViews = { skills, paragon, hideTip: untip, focusSkill: (s) => { focusNext = s || null; }, _turn: turn };
})();
