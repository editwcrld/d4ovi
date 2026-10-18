// Farm list: pick a unique, mythic or aspect per slot, see where each one drops, and get one
// list grouped by boss / dungeon. Builds are saved in builds.json next to the app.
// app.js calls FarmView.render(main, ctx) whenever the section is open.
(function () {
'use strict';

const SLOTS = [            // [key, slot of the item data, column]
  ['Helm', 'Helm', 0], ['Amulet', 'Amulet', 1],
  ['Chest Armor', 'Chest Armor', 0], ['Ring1', 'Ring', 1],
  ['Gloves', 'Gloves', 0], ['Ring2', 'Ring', 1],
  ['Pants', 'Pants', 0], ['Weapon', 'Weapon', 1],
  ['Boots', 'Boots', 0], ['Off-Hand', 'Off-Hand', 1],
  ['Weapon 2', 'Weapon', 1], ['Weapon 3', 'Weapon', 1],     // rogue: bow + two blades, barbarian: four weapons
];
/** A slot's name: an imported weapon says what it is ("Bow", "Sword"), the rest by the slot. */
const slotLabel = (b, key) => { const s = b && b.slots[key]; return (s && s.base) || LABEL[key] || key; };
/** Weapon 2 and 3 only where the class carries that many weapons, or when they hold something. */
const slotShown = (b, key) => {
  if (key !== 'Weapon 2' && key !== 'Weapon 3') return true;
  if (b.slots[key]) return true;
  return key === 'Weapon 2' ? b.cls === 'Rogue' || b.cls === 'Barbarian' : b.cls === 'Barbarian';
};
const LABEL = { Ring1: 'Ring', Ring2: 'Ring' };
const CLASSES = ['All', 'Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];
const maxAspects = (key) => (key === 'Amulet' ? 2 : 1);   // a legendary amulet carries two in the planners

let api = null, ctx = null;
let cat = null;                    // { items, aspects, details }
let data = null;                   // { active, builds }
let open = 'Helm', tab = null, q = '';
let pickOpen = false;              // the search dropdown for the open slot
let view = 'gear';                 // guide | gear | skills | paragon | compare
let layout = 'route';              // route (where to go, what you get) | list (all at once) | slots (as in the game)
try { const l = localStorage.getItem('farm.layout'); if (l === 'list' || l === 'slots') layout = l; } catch (_) { /* private storage */ }
let routeAt = null;                // the stop picked in the route
let onlyMissing = false;           // hide what is farmed already
let menuOpen = false;              // the build menu
let gearAt = { key: '', top: 0 };  // where the gear list was scrolled to (kept across redraws)
// a click anywhere else closes the build menu
document.addEventListener('click', () => { if (menuOpen) { menuOpen = false; if (ctx) ctx.rerender(); } });
let saveTimer = null, loading = null;
let imp = { open: false, value: '', busy: false, result: null, error: '', off: new Set() };   // the import dialog

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const build = () => (data && data.builds.find((b) => b.id === data.active)) || null;
/** The aspects in your codex: once you have one, it counts as done in every build. */
const codex = () => (data && Array.isArray(data.codex) ? data.codex : []);
/** What counts as done in a build: its own ticks, and every aspect in the codex. */
const doneOf = (b) => new Set([].concat(b.done || [], codex()));
const itemBy = (name) => cat && cat.items.find((x) => x.name === name);
const aspectBy = (name) => cat && cat.aspects.find((x) => x.name === name);
/**
 * The variant of an item that matches the weapon it sits on: Infinity on a bow is the bow
 * (its tooltip and picture), not the scythe that happens to come first.
 */
function variantOf(it, base) {
  if (!it || !base || !it.variants || it.variants.length < 2) return it;
  const want = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const v = it.variants.find((x) => x.kind === want) || it.variants.find((x) => x.kind.endsWith('-' + want) || want.endsWith('-' + x.kind));
  return v ? Object.assign({}, it, { id: v.id, icon: v.icon, url: v.url }) : it;
}
/** Runewords have no rarity of their own – they are known by their recipe. */
const rarityOf = (it) => (!it ? 'Unique' : it.src && it.src[0] && it.src[0].recipe ? 'Runeword' : it.rarity);
const rcls = (r) => (r === 'Mythic' ? 'r-mythic' : r === 'Unique' ? 'r-unique' : r === 'Runeword' ? 'r-rune' : 'r-legendary');
const forClass = (x, cls) => !cls || cls === 'All' || !x.cls || x.cls === 'All' || x.cls.split(' / ').indexOf(cls) >= 0;

// ---------------------------------------------------------------- data
// The catalog is fetched again when new data arrives; the builds only once – after that the
// overlay holds the truth and writes it back.
async function load() {
  if (loading) return loading;
  loading = (async () => {
    const [c, b] = await Promise.all([api.getFarm(), data ? data : api.getBuilds()]);
    cat = c || { items: [], aspects: [], details: 0 };
    data = data || b;
  })();
  try { await loading; } finally { loading = null; }
}
// The overlay's copy stays the one in use: what comes back from saving is only the cleaned
// file content, and swapping it in would detach the rows already on screen.
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => api.saveBuilds(data), 300);
  if (window.FarmView.onChange) window.FarmView.onChange();
}
function touch() { const b = build(); if (b) b.updatedAt = Date.now(); persist(); ctx.rerender(); }

// ---------------------------------------------------------------- tooltip on hover
// The in-game tooltip from d4guides.gg (with its own stylesheet), in the overlay's one card
let cssDone = false;
const tipCache = new Map();
async function ensureCss() {
  if (cssDone) return;
  cssDone = true;
  const css = await api.farmCss();
  if (!css) { cssDone = false; return; }
  const st = document.createElement('style');
  st.id = 'd4tt-css';
  st.textContent = css;
  document.head.appendChild(st);
}
const hideTip = () => UI.tip.hide();
/**
 * @param {object} [slot]  the build's slot – an imported item brings its rolls, which are shown
 *                         under the database tooltip ("This build's roll")
 */
function wireTip(node, kind, id, slot) {
  if (!id) return;
  const key = kind + ':' + id;
  node.dataset.tt = key;
  UI.tip.bind(node, async () => {
    ensureCss();
    let html = tipCache.get(key);
    if (html == null) { html = (await api.farmTooltip(kind, id)) || ''; tipCache.set(key, html); }
    if (!html) return null;
    const box = document.createElement('div');
    box.innerHTML = html;
    if (slot && (slot.stats || slot.sockets)) box.appendChild(rollBox(slot));
    return box;
  }, 'game', 180);
}

/** The imported item's rolls as a card under the tooltip – text only, it comes from other sites. */
function rollBox(s) {
  const d = document.createElement('div');
  d.className = 'ftt-roll';
  const h = document.createElement('b'); h.textContent = 'This build’s roll'; d.appendChild(h);
  (s.stats || []).forEach((x) => d.appendChild(SCard.statLine(x)));
  if (s.sockets && s.sockets.length) {
    const l = document.createElement('div'); l.className = 'sock'; l.textContent = '◆ ' + s.sockets.join(' · '); d.appendChild(l);
  }
  const lg = SCard.craftLegend(s.stats); if (lg) d.appendChild(lg);
  return d;
}

// ---------------------------------------------------------------- render
// One build at a time: the bar on top (which build, where it is from, how far you are),
// then Gear / Skills / Paragon. The gear is one list – every slot with what goes in it,
// where it drops and a tick when you have it – or, for an overview with the rolls, as slots.
function render(main, c) {
  ctx = c; api = c.api;
  const el = c.el;
  hideTip();
  if (window.BuildViews) window.BuildViews.hideTip();
  if (window.BuildGuide) window.BuildGuide.hideTip();
  main.classList.add('farm');
  if (!cat || !data) {
    main.appendChild(el('div', 'empty', 'Loading your builds …'));
    load().then(() => ctx.rerender());
    return;
  }
  const b = build();
  const wrap = el('div', 'fwrap');
  header(el, b, wrap);
  if (imp.open) {
    main.appendChild(importDialog(el));
    setTimeout(() => {
      const i = document.getElementById('impQ');
      if (!i) return;
      i.style.height = 'auto';
      i.style.height = i.scrollHeight + 'px';                 // as many lines as the link needs
      if (document.activeElement === i) return;
      // the field is drawn anew on every change – the caret stays where it was, not at the end
      const [a, z] = imp.caret || [i.value.length, i.value.length];
      i.focus({ preventScroll: true });
      i.setSelectionRange(Math.min(a, i.value.length), Math.min(z, i.value.length));
    }, 0);
  }
  if (!cat.items.length) {
    wrap.appendChild(el('div', 'empty', 'The item list is still loading from d4guides.gg — this takes a few seconds on the first start.'));
    main.appendChild(wrap);
    return;
  }
  const tb = toolbar(el, b);
  if (ctx.tabs) ctx.tabs.appendChild(tb); else wrap.appendChild(tb);
  if (view === 'guide' && window.BuildGuide) {
    const box = el('div', 'fview');
    wrap.appendChild(box);
    main.appendChild(wrap);
    window.BuildGuide.render(box, b, { api, rerender: ctx.rerender });
    return;
  }
  if (view === 'compare' && window.BuildCompare) {
    const box = el('div', 'fview');
    wrap.appendChild(box);
    main.appendChild(wrap);
    window.BuildCompare.render(box, b, { el, api, builds: data.builds, codex: codex(), rerender: ctx.rerender, look: lookUp, choose: (id) => {
      data.active = id; view = 'gear'; open = 'Helm'; pickOpen = false; routeAt = null; persist(); ctx.rerender();
    } });
    return;
  }
  if (view !== 'gear' && window.BuildViews) {
    const box = el('div', 'fview');
    wrap.appendChild(box);
    main.appendChild(wrap);
    window.BuildViews[view](box, b, ctx);
    return;
  }
  const gear = el('div', 'fgear');
  gear.classList.add('l-' + layout);
  gear.appendChild(layout === 'slots' ? slotsView(el, b) : layout === 'list' ? calmList(el, b) : routeView(el, b));
  if (pickOpen) gear.appendChild(picker(el, b));
  wrap.appendChild(gear);
  wrap.appendChild(gearTool(el));
  main.appendChild(wrap);
  // a redraw (a tick, a row folded out) keeps the place in the list – same build, same view
  const at = b.id + '|' + layout;
  if (gearAt.key === at) gear.scrollTop = gearAt.top;
  gearAt = { key: at, top: gear.scrollTop };
  gear.addEventListener('scroll', () => { gearAt.top = gear.scrollTop; });
  if (pickOpen) placePicker();
  if (cat.details < cat.aspects.length) {
    ctx.status('Aspect slots: ' + cat.details + '/' + cat.aspects.length + ' checked — the rest go by category for now');
  }
}

/** What there is to farm in this build, and how much of it is ticked off. */
function progress(b) {
  const all = entries(b);
  const done = doneOf(b);
  const keys = [...all.items, ...all.aspects].map((e) => e.key).concat(extraStops(b).flatMap((st) => st.things.map((t) => t.doneKey)));
  return { total: keys.length, got: keys.filter((k) => done.has(k)).length };
}

/**
 * The seal and the charms, and the gems, runes and soul splinters for the sockets – each one a
 * thing to farm and tick off like an item ("c:" / "s:" keys in the build's done list).
 */
function extraStops(b) {
  const out = [];
  const ch = b.charms;
  if (ch && (ch.seal || (ch.list || []).length)) {
    const things = [];
    const add = (c, seal) => things.push({ ext: true, key: 'c:' + c.name, doneKey: 'c:' + c.name, name: c.name, pname: c.name, kind: seal ? 'seal' : 'charm', cls: QCLS[c.q] || '',
      label: seal ? 'Seal' : 'Charm', how: c.set || '', stats: (c.stats || []).map((x) => ({ t: x.t })), charm: c, seal,
      set: c.set && (ch.sets || []).find((x) => x.name === c.set) });
    if (ch.seal) add(ch.seal, true);
    (ch.list || []).forEach((c) => add(c, false));
    out.push({ key: 'charms', title: 'Seal & charms', place: 'The talisman — set pieces count towards the set bonus', order: 7, things });
  }
  // every gem, rune and splinter once, with how many and where it goes
  const socks = new Map();
  SLOTS.forEach(([key]) => {
    const sl = b.slots[key];
    (sl && sl.sockets || []).forEach((n) => {
      if (!socks.has(n)) socks.set(n, { n, count: 0, where: [] });
      const e = socks.get(n);
      e.count++;
      if (!e.where.includes(slotLabel(b, key))) e.where.push(slotLabel(b, key));
    });
  });
  const KIND = { rune: ['Runes', 'Rune drops — Helltide, bosses, salvage', 8], gem: ['Gems', 'Drops and the Jeweler', 9], splinter: ['Soul splinters', 'Abyss and boss drops', 10] };
  ['rune', 'gem', 'splinter'].forEach((k) => {
    const list = [...socks.values()].filter((e) => gemKind(e.n) === k);
    if (!list.length) return;
    out.push({ key: 'sock-' + k, title: KIND[k][0], place: KIND[k][1], order: KIND[k][2],
      things: list.map((e) => ({ ext: true, key: 's:' + e.n, doneKey: 's:' + e.n, name: e.n + (e.count > 1 ? ' ×' + e.count : ''), pname: e.n, kind: k,
        cls: 'gemname ' + k, label: k === 'splinter' ? 'Splinter' : k === 'gem' ? 'Gem' : 'Rune', how: 'for ' + e.where.join(', '), stats: [] })) });
  });
  return out;
}

/**
 * The build's head: the kicker (class · site · how many builds), its name – a click opens the
 * menu – and on the right how far you are, the source and Import. In the overlay it is the page's
 * head (ctx.head), on the website the top of the farm list.
 */
function header(el, b, wrap) {
  const host = ctx.head || wrap.appendChild(el('div', 'fhead'));
  host.textContent = '';
  const block = el('div', 'tblock');
  const facts = [b.cls === 'All' ? 'All classes' : b.cls, b.source && b.source.site, data.builds.length + ' build' + (data.builds.length === 1 ? '' : 's')].filter(Boolean).join(' · ');
  block.appendChild(ctx.kicker ? ctx.kicker(facts) : el('div', 'kick', facts));
  // which build: its name, the menu holds the rest (switch, rename, class …)
  const pickB = el('button', 'bname' + (menuOpen ? ' on' : ''));
  pickB.title = 'Your builds – switch, rename, new, export …';
  const h = el('h1', 'ttl', b.name);
  pickB.appendChild(h);
  pickB.appendChild(UI.icon('down'));
  pickB.onclick = (e) => { e.stopPropagation(); menuOpen = !menuOpen; ctx.rerender(); };
  block.appendChild(pickB);
  host.appendChild(block);
  if (menuOpen) host.appendChild(buildMenu(el, b));            // hangs under the head (position: absolute)

  const right = el('div', 'tright');
  const p = progress(b);
  if (p.total) {
    const pr = el('div', 'prog' + (p.got === p.total ? ' done' : ''));
    pr.title = p.got + ' of ' + p.total + ' items and aspects farmed';
    const n = el('span', 'num', String(p.got));
    n.appendChild(el('small', null, ' / ' + p.total));
    pr.appendChild(n);
    const bar = el('span', 'bar');
    const fill = el('i'); fill.style.width = Math.round(p.got / p.total * 100) + '%';
    bar.appendChild(fill);
    pr.appendChild(bar);
    right.appendChild(pr);
  }
  if (b.source && b.source.url) {
    const go = UI.btn(b.source.site || 'Source', () => api.openBuildSource(b.source.url), 'ghost src', 'external');
    go.title = 'Open the original build in your browser' + (b.source.title ? '\n' + b.source.title : '');
    go.dataset.url = b.source.url;
    right.appendChild(go);
  }
  const imb = UI.btn('Import', () => { imp.open = true; ctx.rerender(); }, imp.open ? 'on' : '', 'plus');
  imb.title = 'Load a build from maxroll, d4builds, infinitybuilds or d2core – or a build code';
  right.appendChild(imb);
  host.appendChild(right);
}

/** The build menu: every build to switch to, then what can be done with this one. */
function buildMenu(el, b) {
  const m = el('div', 'bmenu');
  m.onclick = (e) => e.stopPropagation();
  // three parts, each under a small head like the cards elsewhere: the builds, this one, more
  const head = (title, icon, n) => {
    const h = el('div', 'mhd');
    h.appendChild(UI.icon(icon));
    h.appendChild(el('b', null, title));
    if (n != null) h.appendChild(el('span', 'badge', String(n)));
    m.appendChild(h);
  };
  head('Builds', 'list', data.builds.length);
  data.builds.forEach((x) => {
    const r = el('button', 'mrow' + (x.id === b.id ? ' on' : ''));
    r.appendChild(el('span', 'n', x.name));
    r.appendChild(el('span', 'c', x.cls === 'All' ? '' : x.cls));
    r.onclick = () => { data.active = x.id; menuOpen = false; open = 'Helm'; pickOpen = false; routeAt = null; persist(); ctx.rerender(); };
    m.appendChild(r);
  });
  head('This build', 'build');
  const row = (label, ctl) => { const r = el('label', 'mfield'); r.appendChild(el('span', null, label)); r.appendChild(ctl); m.appendChild(r); };
  const name = el('input');
  name.type = 'text'; name.value = b.name; name.maxLength = 40;
  name.onchange = () => { b.name = name.value.trim() || b.name; touch(); };
  row('Name', name);
  const cls = el('select');
  CLASSES.forEach((x) => { const o = el('option', null, x === 'All' ? 'All classes' : x); o.value = x; if (x === b.cls) o.selected = true; cls.appendChild(o); });
  cls.onchange = () => { b.cls = cls.value; touch(); };
  row('Class', cls);
  head('More', 'plus');
  const act = (label, title, fn, cls2) => { const x = el('button', 'mact' + (cls2 ? ' ' + cls2 : ''), label); x.title = title; x.onclick = fn; m.appendChild(x); return x; };
  act('+ New farm list', 'An empty list – pick the items yourself and tick them off', () => {
    const nb = { id: 'b' + Date.now().toString(36), name: 'Farm list ' + (data.builds.length + 1), cls: b ? b.cls : 'All', slots: {}, done: [], updatedAt: Date.now() };
    data.builds.push(nb); data.active = nb.id; open = 'Helm'; menuOpen = false; touch();
  });
  act('Copy build code', 'A short code to paste into a chat or on another PC', async () => {
    menuOpen = false; await api.buildCode(b); ctx.note('Code for “' + b.name + '” copied — paste it into a chat or the other PC.', 'ok');
  });
  act('Export all to file …', 'All builds in one file – builds.json in the data folder holds them too', async () => {
    menuOpen = false; const f = await api.exportBuilds(); if (f) ctx.note('Saved to ' + f, 'ok');
  });
  act('Duplicate', 'Copy this build', () => {
    const nb = JSON.parse(JSON.stringify(b));
    nb.id = 'b' + Date.now().toString(36); nb.name = b.name + ' (copy)';
    data.builds.push(nb); data.active = nb.id; menuOpen = false; touch();
  });
  const del = act('Delete this build', 'Removes it from the list', () => {
    if (del.dataset.armed !== '1') { del.dataset.armed = '1'; del.textContent = 'Click again to delete'; return; }
    data.builds = data.builds.filter((x) => x.id !== b.id);
    if (!data.builds.length) data.builds.push({ id: 'b' + Date.now().toString(36), name: 'My build', cls: 'All', slots: {}, done: [] });
    data.active = data.builds[0].id; menuOpen = false; touch();
  }, 'danger');
  return m;
}

/** The tabs: cheat sheet, gear, skills, paragon, compare. */
function toolbar(el, b) {
  const off = 'Import a build from maxroll, d2core, infinitybuilds or d4builds to see it';
  return UI.tabs([['guide', 'Cheat sheet', 'Breakpoints, what to set up, how to play it and why it works – from the guide'],
    ['gear', 'Gear'], ['skills', 'Skills', b.skills ? '' : off, !b.skills],
    ['paragon', 'Paragon', b.paragon ? '' : off, !b.paragon],
    ['compare', 'Compare', data.builds.length > 1 ? 'Side by side with another build or variant' : 'Needs a second build', data.builds.length < 2]],
  view, (id) => { view = id; pickOpen = false; hideTip(); ctx.rerender(); });
}
/** The gear's floating toolbar: route, list or slots – and only what is still missing. */
function gearTool(el) {
  const t = el('div', 'tool');
  [['route', 'Route', 'Where to go next, and what you get there'], ['list', 'List', 'Everything at once, by where it drops'], ['slots', 'Slots', 'The build as the game shows it']].forEach(([id, label, title]) => {
    const x = el('button', layout === id ? 'on' : '', label);
    x.title = title;
    x.dataset.layout = id;
    x.onclick = () => { layout = id; try { localStorage.setItem('farm.layout', id); } catch (_) {} pickOpen = false; ctx.rerender(); };
    t.appendChild(x);
  });
  t.appendChild(el('span', 'sep'));
  const miss = el('button', onlyMissing ? 'on' : '');
  miss.appendChild(UI.icon('check'));
  miss.appendChild(document.createTextNode('Only missing'));
  miss.title = 'Hide what you already have';
  miss.onclick = () => { onlyMissing = !onlyMissing; ctx.rerender(); };
  t.appendChild(miss);
  return t;
}

// ---- Import: one field – a link from maxroll, d4builds, infinitybuilds or d2core, or a build code; or a file
const SITE_RE = [
  [/maxroll\.gg/i, 'maxroll', 'm'], [/d4builds\.gg/i, 'd4builds', 'd'], [/infinitybuilds\.gg/i, 'infinitybuilds', 'i'],
  [/d2core\.com/i, 'd2core · translated', 'c'],
];
/** What was pasted: a build link (which site), a build code / builds file, or nothing we know. */
function detect(v) {
  const t = String(v || '').trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) {
    const s = SITE_RE.find(([re]) => re.test(t));
    return s ? { kind: 'link', label: s[1], cls: s[2] } : { kind: 'bad' };
  }
  if (/^D4B1:/i.test(t) || /^\s*\{/.test(t)) return { kind: 'code', label: 'Build code', cls: 'k' };
  return { kind: 'bad' };
}
async function loadLink() {
  const url = imp.value.trim();
  imp.busy = true; imp.result = null; imp.error = ''; imp.off = new Set();
  ctx.rerender();
  const r = await api.loadBuildLink(url);
  if (imp.value.trim() !== url) return;              // typed on meanwhile
  imp.busy = false;
  if (!r || r.error) imp.error = (r && r.error) || 'Nothing found at that link.';
  else {
    imp.result = r;
    // a link that names its variant (?var=2, ?variant=…, a planner's #3): only that one is ticked
    if (/[?&](var|variant)=|planner\/[^#]+#\d+/i.test(url) && r.variants.length > 1) r.variants.forEach((_, i) => { if (i !== (r.preselect || 0)) imp.off.add(i); });
  }
  ctx.rerender();
}
function closeImport() { imp = { open: false, value: '', busy: false, result: null, error: '', off: new Set() }; ctx.rerender(); }
async function doImport() {
  const d = detect(imp.value);
  if (d && d.kind === 'code') { took(await api.importBuildText(imp.value.trim())); return; }
  const r = imp.result;
  if (!r) return;
  const vs = r.variants.filter((v, i) => !imp.off.has(i));
  if (!vs.length) return;
  took(await api.importBuildText(JSON.stringify({ builds: vs.map((v) => ({
    name: v.name, cls: v.cls, slots: v.slots, source: v.source, skills: v.skills, paragon: v.paragon, charms: v.charms,
  })) })));
}

function importDialog(el) {
  const shade = el('div', 'ishade');
  shade.onclick = (e) => { if (e.target === shade) closeImport(); };
  const m = el('div', 'imodal');
  // a builds file dropped anywhere on the dialog is read right here
  m.ondragover = (e) => { e.preventDefault(); m.classList.add('drop'); };
  m.ondragleave = () => m.classList.remove('drop');
  m.ondrop = async (e) => {
    e.preventDefault(); m.classList.remove('drop');
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) took(await api.importBuildText(await f.text()));
  };
  const head = el('div', 'ihead');
  head.appendChild(el('h3', null, 'Import a build'));
  const x = UI.iconBtn('Close', 'close', closeImport, 'ghost');
  head.appendChild(x);
  m.appendChild(head);

  const body = el('div', 'ibody');
  body.appendChild(el('label', 'ilab', 'Paste a link or a build code'));
  const d = detect(imp.value);
  const field = el('div', 'ifield' + (d && d.kind === 'bad' ? ' bad' : d ? ' ok' : ''));
  field.appendChild(UI.icon('link'));
  // wraps instead of scrolling sideways, so a long link stays readable as a whole
  const inp = el('textarea');
  inp.id = 'impQ'; inp.rows = 1; inp.spellcheck = false; inp.autocomplete = 'off';
  inp.placeholder = 'https://maxroll.gg/d4/planner/…';
  inp.value = imp.value;
  const keepCaret = () => { imp.caret = [inp.selectionStart, inp.selectionEnd]; };
  inp.onselect = keepCaret; inp.onkeyup = keepCaret; inp.onmouseup = keepCaret;
  inp.oninput = () => {
    if (/[\r\n]/.test(inp.value)) inp.value = inp.value.replace(/\s*[\r\n]+\s*/g, '');   // one link, no line breaks
    keepCaret();
    imp.value = inp.value; imp.result = null; imp.error = '';
    clearTimeout(importDialog.t);
    const k = detect(inp.value);
    if (k && k.kind === 'link') importDialog.t = setTimeout(loadLink, 450);   // a pasted link loads by itself
    ctx.rerender();
  };
  inp.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closeImport(); }
    if (e.key === 'Enter') { e.preventDefault(); const k = detect(inp.value); if (k && k.kind === 'link' && !imp.result) loadLink(); else doImport(); }
  };
  field.appendChild(inp);
  if (d && d.label) field.appendChild(el('span', 'ibadge b-' + d.cls, d.label));
  if (imp.busy) field.appendChild(el('i', 'ispin'));
  body.appendChild(field);
  const hint = el('div', 'ihint');
  hint.appendChild(el('span', null, 'Works with maxroll.gg · d4builds.gg · infinitybuilds.gg · d2core.com (Chinese, translated) · build codes — or drop a builds file here'));
  body.appendChild(hint);
  if (d && d.kind === 'bad') body.appendChild(el('div', 'ierr', 'That is no link from maxroll, d4builds, infinitybuilds or d2core and no build code.'));
  if (imp.error) body.appendChild(el('div', 'ierr', imp.error));

  const r = imp.result;
  if (r) {
    const t = el('div', 'ititle');
    t.appendChild(el('b', null, r.title));
    t.appendChild(el('span', null, r.cls + ' · ' + r.variants.length + ' variant' + (r.variants.length === 1 ? '' : 's') + (r.site ? ' · ' + r.site : '')));
    if (r.original && r.original !== r.title) t.title = 'Original: ' + r.original;   // d2core: the Chinese title
    body.appendChild(t);
    r.variants.forEach((v, i) => {
      const row = el('label', 'ivar' + (i === r.preselect ? ' main' : ''));
      const cb = el('input'); cb.type = 'checkbox'; cb.checked = !imp.off.has(i);
      cb.onchange = () => { if (cb.checked) imp.off.delete(i); else imp.off.add(i); ctx.rerender(); };
      row.appendChild(cb);
      row.appendChild(el('b', null, v.variant));
      const n = Object.keys(v.slots).length;
      const items = Object.values(v.slots).filter((s) => s.item).length;
      const parts = [n + ' slots', items + ' unique' + (items === 1 ? '' : 's')];
      if (v.skills) parts.push('skills'); if (v.paragon) parts.push('paragon');
      if (v.missing.length) parts.push(v.missing.length + ' not recognised');
      row.appendChild(el('span', null, parts.join(' · ')));
      const why = [];
      if (v.original && v.original !== v.variant) why.push('Original: ' + v.original);
      if (v.missing.length) why.push('Not recognised: ' + v.missing.join(', '));
      if (v.extra && v.extra.length) why.push('No slot left for: ' + v.extra.join(', '));
      if (why.length) row.title = why.join('\n');
      body.appendChild(row);
    });
  }
  m.appendChild(body);

  const foot = el('div', 'ifoot');
  const file = UI.btn('Import file …', null, 'ghost');
  file.onclick = async () => { const res = await api.importBuildFile(); if (res) took(res); };
  foot.appendChild(file);
  foot.appendChild(el('span', 'sp'));
  const cancel = UI.btn('Cancel', closeImport);
  foot.appendChild(cancel);
  const n = r ? r.variants.filter((v, i) => !imp.off.has(i)).length : (d && d.kind === 'code' ? 1 : 0);
  const go = UI.btn(n > 1 ? 'Import ' + n + ' builds' : 'Import', null, 'pri');
  go.disabled = !n;
  go.onclick = doImport;
  foot.appendChild(go);
  m.appendChild(foot);
  shade.appendChild(m);
  return shade;
}

function took(r) {
  if (!r || !r.added) { ctx.note('Nothing found to import.', 'error'); return; }
  data = r.data;
  imp = { open: false, value: '', busy: false, result: null, error: '', off: new Set() };
  ctx.note(r.added + ' build' + (r.added === 1 ? '' : 's') + ' added.', 'ok');
  ctx.rerender();
}

// ---- the gear: what goes in each slot, where it drops, ticked when you have it
/** One slot, everything the two views show about it. */
function slotInfo(b, key) {
  const s = b.slots[key];
  if (!s) return { key, s: null };
  const it = s.item ? variantOf(itemBy(s.item), s.base) : null;
  const keys = s.item ? [s.item].concat(s.tf ? [s.tf] : []) : (s.aspects || []);
  const done = doneOf(b);
  let kind, src;
  if (s.item) {
    kind = rarityOf(it);
    src = it ? sourceLine(it.src) : 'Not in the item list any more';
    // the aspect transfigured onto it comes from salvaging or its dungeon, like any aspect
    const ta = s.tf && aspectBy(s.tf);
    if (s.tf) src += ' · ◈ ' + (ta ? ta.short || ta.name : s.tf) + ': ' + (ta ? ta.src.map((y) => y.src).join(' / ') : 'Salvage a legendary');
  } else {
    kind = 'Aspect';
    // every place once, dungeons first ("Dungeon: Forgotten Depths / Salvage a legendary")
    const where = [];
    (s.aspects || []).forEach((n) => { const x = aspectBy(n); (x ? x.src.map((y) => y.src) : ['Salvage a legendary']).forEach((w) => { if (!where.includes(w)) where.push(w); }); });
    src = where.sort((x, y) => /salvage/i.test(x) - /salvage/i.test(y)).join(' / ');
  }
  return { key, s, it, keys, kind, src, got: keys.length > 0 && keys.every((k) => done.has(k)) };
}
function setGot(b, info, on) {
  const set = new Set(b.done || []);
  if (info.s && !info.s.item) {
    // an aspect goes into the codex – done in every build that uses it
    const cx = new Set(codex());
    info.keys.forEach((k) => { if (on) cx.add(k); else { cx.delete(k); set.delete(k); } });
    data.codex = [...cx];
  } else info.keys.forEach((k) => (on ? set.add(k) : set.delete(k)));
  b.done = [...set];
  touch();
}
const KCLS = { Mythic: 'r-mythic', Unique: 'r-unique', Runeword: 'r-rune', Aspect: 'r-legendary' };
/** The name(s) in a slot – a click opens the picker for it. */
function slotNames(el, b, info, cls, noTip) {
  const box = el('div', cls);
  if (!info.s) { box.appendChild(el('span', 'nm empty', 'Choose …')); return box; }
  if (info.s.item) {
    const nm = el('span', 'nm ' + rcls(rarityOf(info.it)), info.s.item);
    if (info.it && !noTip) wireTip(nm, 'item', info.it.id, info.s);
    box.appendChild(nm);
    // + ◈ the aspect transfigured onto the unique
    if (info.s.tf) {
      const a = aspectBy(info.s.tf);
      box.appendChild(el('span', 'plus', '+ ◈'));
      const an = el('span', 'nm r-legendary', a ? a.short : info.s.tf);
      an.title = 'Transfigured onto it (Horadric Cube)';
      if (a && !noTip) wireTip(an, 'aspect', a.id, info.s);
      box.appendChild(an);
    }
  } else {
    info.s.aspects.forEach((n, i) => {
      const a = aspectBy(n);
      if (i) box.appendChild(el('span', 'plus', '+'));
      const nm = el('span', 'nm r-legendary', a ? a.short : n);
      if (a && !noTip) wireTip(nm, 'aspect', a.id, info.s);
      box.appendChild(nm);
    });
  }
  return box;
}
function openPicker(b, key) {
  if (open === key && pickOpen) { pickOpen = false; ctx.rerender(); return; }
  const s = b.slots[key];
  open = key; q = ''; pickOpen = true;
  tab = s && s.aspects ? 'aspect' : s && s.item && itemBy(s.item) && itemBy(s.item).rarity === 'Mythic' ? 'mythic' : 'unique';
  ctx.rerender();
}
/** The game's diamond tick for a slot – an aspect goes into the codex, done in every build. */
function tick(el, b, info) {
  const aspect = info.s && !info.s.item;
  return UI.tick({ on: info.got, onClick: (v) => setGot(b, info, v),
    title: aspect
      ? (info.got ? 'In your codex – done in every build · click to undo' : 'Got it – into the codex, done in every build')
      : (info.got ? 'Farmed – click to undo' : 'Got it') });
}
/** A slot's picture: the item's (as it sits on its weapon), else its first aspect's category. */
function slotPic(info, cls) {
  if (info.s && info.s.item) return UI.pic(info.s.item, { url: info.it && info.it.icon, kind: info.kind === 'Mythic' ? 'mythic' : info.kind === 'Runeword' ? 'rune' : 'unique', cls });
  if (info.s && info.s.aspects && info.s.aspects[0]) return UI.pic(info.s.aspects[0], { kind: 'aspect', cls });
  const box = el0('span', (cls || 'pic') + ' none');
  box.appendChild(UI.icon('plus'));
  return box;
}
const el0 = (tag, cls, text) => UI.el(tag, cls, text);
function clearBtn(el, b, key) {
  const x = el('button', 'xclr');
  x.appendChild(UI.icon('close'));
  x.title = 'Clear this slot';
  x.onclick = (e) => { e.stopPropagation(); delete b.slots[key]; pickOpen = false; touch(); };
  return x;
}

// ---- Route and List: what to farm, by where it drops
/**
 * Every filled slot as one thing to farm, grouped by its first source: a boss ("The Butcher"),
 * the runes of a runeword, a dungeon for an aspect, salvaging. Groups keep the order of the
 * sources (bosses first), the slots not picked yet come last.
 */
function farmStops(b) {
  thingGot.done = doneOf(b);
  const stops = new Map();
  const add = (key, title, place, order, thing) => {
    if (!stops.has(key)) stops.set(key, { key, title, place, order, things: [] });
    const st = stops.get(key);
    st.order = Math.min(st.order, order);
    st.things.push(thing);
  };
  const blank = [];
  SLOTS.forEach(([key]) => {
    if (!slotShown(b, key)) return;
    const info = slotInfo(b, key);
    if (!info.s) { blank.push({ key, info, label: slotLabel(b, key) }); return; }
    const thing = { key, info, label: slotLabel(b, key), stats: (info.s.stats || []), sockets: info.s.sockets || [] };
    if (info.s.item) {
      const src = (info.it && info.it.src) || [];
      const first = src[0] || { src: 'Unknown source', loc: '', order: 9 };
      if (first.recipe) add('rw', 'Runewords', 'Socket the runes into the item', 1, Object.assign(thing, { how: first.recipe }));
      else add('s:' + first.src, first.src, String(first.loc || '').split(' — ').pop() || (src.length > 1 ? 'also: ' + src.slice(1).map((x) => x.src).join(', ') : ''), first.order || 3, thing);
    } else {
      // an aspect: its dungeon unlocks it – or it is salvaged from a legendary
      const dungeon = (info.s.aspects || []).map((n) => aspectBy(n)).find((a) => a && a.dungeon);
      if (dungeon) add('d', 'Dungeons', 'Completing the dungeon unlocks the aspect', 5, Object.assign(thing, { how: (info.s.aspects || []).map((n) => { const a = aspectBy(n); return a && a.dungeon ? a.dungeon + (a.region ? ', ' + a.region : '') : 'salvage'; }).join(' · ') }));
      else add('x', 'Salvage a legendary', 'Any legendary with the aspect — the Codex keeps it', 6, Object.assign(thing, { how: '' }));
    }
  });
  const list = [...stops.values()].concat(extraStops(b)).sort((x, y) => x.order - y.order);
  if (blank.length) list.push({ key: 'blank', title: 'Not picked yet', place: 'Click a slot to choose what goes in', order: 99, things: blank, blank: true });
  return list;
}
const thingGot = (t) => (t.ext ? (t.doneKey && (thingGot.done || new Set()).has(t.doneKey)) : t.info.got);

/** One thing to farm: tick, picture, name in its colour – a click on it picks another – where, its rolls, its sockets. */
function thingRow(el, b, t, cls) {
  if (t.ext) {
    const got = doneOf(b).has(t.doneKey);
    const row = el('div', 'line thing ext' + (cls ? ' ' + cls : '') + (got ? ' got' : ''));
    row.appendChild(UI.tick({ on: got, title: got ? 'Found – click to undo' : 'Got it',
      onClick: () => { const set = new Set(b.done || []); if (got) set.delete(t.doneKey); else set.add(t.doneKey); b.done = [...set]; touch(); } }));
    row.appendChild(UI.pic(t.pname || t.name, { kind: t.kind }));
    const body = el('div', 'l-tx');
    const nm = el('span', 'xn ' + (t.cls || '').replace(/gemname\s*/, 'r-gem '), t.name);
    body.appendChild(nm);
    if (t.how) body.appendChild(el('div', 'thow', t.how));
    (t.stats || []).forEach((x) => body.appendChild(el('div', 'tst', x.t)));
    row.appendChild(body);
    const end = el('span', 'l-end');
    end.appendChild(el('span', 'tsl', t.label));
    row.appendChild(end);
    if (t.charm) wireCard(nm, () => charmCard(t.charm, t.seal, t.set));
    return row;
  }
  const row = el('div', 'line thing' + (cls ? ' ' + cls : '') + (t.info.got ? ' got' : '') + (t.info.s ? '' : ' blank') + (open === t.key && pickOpen ? ' open' : ''));
  row.dataset.key = t.key;
  row.appendChild(t.info.s ? tick(el, b, t.info) : UI.tick({ on: false, onClick: () => {} }));
  if (!t.info.s) row.lastChild.classList.add('none');
  row.appendChild(slotPic(t.info));
  const body = el('div', 'l-tx');
  const names = slotNames(el, b, t.info, 'gn');
  names.title = 'Click to choose another';
  names.onclick = () => openPicker(b, t.key);
  body.appendChild(names);
  if (t.how) body.appendChild(el('div', 'thow', t.how));
  (t.stats || []).forEach((x) => body.appendChild(SCard.statLine(x, 'tst')));
  if (t.sockets && t.sockets.length) {
    const g = el('div', 'gems');
    t.sockets.forEach((x) => g.appendChild(gemChip(el, x)));
    body.appendChild(g);
  }
  row.appendChild(body);
  const end = el('span', 'l-end');
  end.appendChild(el('span', 'tsl', t.label));
  if (t.info.s) end.appendChild(clearBtn(el, b, t.key));
  row.appendChild(end);
  return row;
}
/** A gem, rune or splinter in a socket: its picture and its name in its colour. */
function gemChip(el, name, short) {
  const k = gemKind(name);
  const g = el('span', 'gem ' + k);
  g.appendChild(UI.pic(name, { kind: k }));
  g.appendChild(document.createTextNode(short ? shortGem(name) : name));
  g.title = name;
  return g;
}

/** What kind of place a stop is – its plate's icon. */
const STOP_ICON = { rw: 'rune', d: 'dungeon', x: 'salvage', charms: 'charm', blank: 'plus', 'sock-rune': 'rune', 'sock-gem': 'gem', 'sock-splinter': 'splinter' };
/**
 * A stop as a plate: where, what is there, and how much of it is farmed.
 * @param {number} [open_]  only what is still to farm (the list); else farmed / all (the route)
 */
function stopCard(el, s, cls, open_) {
  const got = s.things.filter(thingGot).length;
  const all = s.things.length;
  const badge = s.blank ? all + ' empty' : open_ != null ? open_ + ' to farm' : got + ' / ' + all;
  const finished = !s.blank && got === all;
  return UI.plate({ title: s.title, sub: s.place, icon: STOP_ICON[s.key] || (String(s.key).startsWith('s:') ? 'boss' : 'item'),
    badge, badgeCls: finished ? 'ok' : 'warn', cls: cls + (finished ? ' done' : '') });
}
/** The waypoint's mark: the boss's portrait where the stop is a boss, else its number – a tick once it is done. */
function stopNode(el, s, n, done) {
  const node = el('span', 'node');
  if (done) { node.appendChild(UI.icon('check')); return node; }
  if (s.blank) { node.appendChild(UI.icon('plus')); return node; }
  const boss = String(s.key).startsWith('s:') && !/^(any|helltide|world|nightmare|the pit|salvage|unknown|iconic)/i.test(s.title);
  if (boss) node.appendChild(UI.img(UI.bossPic(s.title), () => { node.textContent = String(n); }));
  else node.textContent = String(n);
  return node;
}

/** Route: a path with a waypoint per stop – the one you are at opens with what you get there. */
function routeView(el, b) {
  const stops = farmStops(b);
  const wrap = el('div', 'path route');
  if (!stops.length) { wrap.appendChild(el('div', 'empty', 'Nothing to farm yet — pick items in the slots.')); return wrap; }
  const cur = stops.find((s) => s.key === routeAt) || stops.find((s) => !s.blank && s.things.some((t) => !thingGot(t))) || stops[0];
  let n = 0;
  stops.forEach((s) => {
    const got = s.things.filter(thingGot).length;
    const done = !s.blank && got === s.things.length;
    const wp = el('div', 'wp rstop' + (s === cur ? ' cur on' : '') + (done ? ' done' : '') + (s.blank ? ' blank' : ''));
    wp.dataset.stop = s.key;
    wp.appendChild(stopNode(el, s, s.blank ? 0 : ++n, done));
    const wt = el('div', 'wt');
    const head = el('button', 'whead');
    const tx = el('span', 'wtx');
    tx.appendChild(el('b', null, s.title));
    tx.appendChild(el('small', null, s === cur || !done ? s.place || '' : s.things.map((t) => (t.ext ? t.name : t.info.s.item || (t.info.s.aspects || []).map((x) => (aspectBy(x) ? aspectBy(x).short : x)).join(' + '))).join(', ')));
    head.appendChild(tx);
    head.appendChild(el('span', 'wn', s.blank ? s.things.length + ' empty' : got + '/' + s.things.length));
    head.title = s.title + (s.place ? ' — ' + s.place : '');
    head.onclick = () => { routeAt = s.key; pickOpen = false; ctx.rerender(); };
    wt.appendChild(head);
    if (s === cur) {
      const c = UI.plate({ title: s.blank ? 'Choose what goes in' : 'Here you get', badge: s.blank ? '' : got + ' / ' + s.things.length, cls: 'here rdetail' });
      c.card.dataset.stop = s.key;
      s.things.filter((t) => !onlyMissing || !thingGot(t)).forEach((t) => c.body.appendChild(thingRow(el, b, t, 'rthing')));
      if (!c.body.children.length) c.body.appendChild(el('div', 'empty', 'Everything here is farmed.'));
      wt.appendChild(c.card);
    }
    wp.appendChild(wt);
    wrap.appendChild(wp);
  });
  return wrap;
}

/** List: everything still to farm at once, a plate per place – what is farmed sinks to the end. */
function calmList(el, b) {
  const stops = farmStops(b);
  const col = el('div', 'calm');
  const done = [];
  stops.forEach((s) => {
    const open_ = s.things.filter((t) => !thingGot(t));
    s.things.filter(thingGot).forEach((t) => done.push(t));
    if (!open_.length) return;
    const g = stopCard(el, s, 'cgroup', open_.length);
    open_.forEach((t) => g.body.appendChild(thingRow(el, b, t, 'crow')));
    col.appendChild(g.card);
  });
  if (done.length && !onlyMissing) {
    const g = UI.plate({ title: 'Farmed', sub: 'Ticked off — untick one to farm it again', icon: 'check', badge: done.length, badgeCls: 'ok', cls: 'cdone dim done' });
    done.forEach((t) => g.body.appendChild(thingRow(el, b, t, 'crow sm')));
    col.appendChild(g.card);
  }
  if (!col.children.length) col.appendChild(el('div', 'empty', 'Everything is farmed.'));
  return col;
}

/** Slots: the build as the game shows it – armour left, jewellery and weapons right, in the
 *  middle what is socketed where and the skill bar (a click opens the skills), the charms beside. */
function slotsView(el, b) {
  const doll = el('div', 'doll');
  const LEFT = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Weapon'];
  const RIGHT = ['Amulet', 'Ring1', 'Ring2', 'Off-Hand', 'Weapon 2', 'Weapon 3'];
  const col = (keys, side) => {
    const c = el('div', 'dcol ' + side);
    keys.forEach((key) => {
      if (!slotShown(b, key)) return;
      const info = slotInfo(b, key);
      if (onlyMissing && (info.got || !info.s)) return;
      const row = el('div', 'dslot' + (info.got ? ' got' : '') + (info.s ? '' : ' blank') + (open === key && pickOpen ? ' open' : ''));
      row.dataset.key = key;
      row.appendChild(slotPic(info, 'pic gi'));
      const t = el('div', 'dt');
      t.appendChild(slotNames(el, b, info, 'gn', true));
      t.appendChild(el('span', 'dk', info.s ? kindLine(info, slotLabel(b, key)) : slotLabel(b, key)));
      row.appendChild(t);
      if (info.s) row.appendChild(tick(el, b, info));
      row.title = '';
      row.onclick = () => openPicker(b, key);
      // the hover card: what you see in Route and List – the rolls of this build, not the database's
      if (info.s) wireCard(row, () => slotCard(b, key, info));
      c.appendChild(row);
    });
    return c;
  };
  doll.appendChild(col(LEFT, 'left'));

  const mid = el('div', 'dmid');
  mid.appendChild(el('div', 'dmark', b.cls === 'All' ? '' : b.cls));
  // what is socketed where: the gems of one item together, the slot underneath
  const sock = SLOTS.map(([key]) => [key, b.slots[key]]).filter(([, s]) => s && s.sockets && s.sockets.length);
  if (sock.length) {
    const sr = el('div', 'dsock');
    sock.forEach(([key, s]) => {
      const g = el('div', 'sg');
      const chips = el('div', 'sc');
      s.sockets.forEach((x) => chips.appendChild(gemChip(el, x, true)));
      g.appendChild(chips);
      g.appendChild(el('span', 'sl', slotLabel(b, key)));
      g.title = slotLabel(b, key) + ': ' + s.sockets.join(', ');
      sr.appendChild(g);
    });
    mid.appendChild(sr);
  }
  const bar = (b.skills && b.skills.bar) || [];
  if (bar.length) {
    const sk = el('div', 'dskills');
    bar.forEach((x) => {
      const btn = el('button', 'dsk');
      btn.title = x.name + (x.rank ? ' · rank ' + x.rank : '') + ' — open the skills';
      if (x.icon) btn.appendChild(UI.img(UI.skillPic(x.icon), () => { btn.textContent = x.name.slice(0, 2); }));
      else btn.textContent = x.name.slice(0, 2);
      btn.onclick = () => {
        if (window.BuildViews && window.BuildViews.focusSkill) window.BuildViews.focusSkill({ id: x.id, name: x.name });
        view = 'skills'; pickOpen = false; hideTip(); ctx.rerender();
      };
      sk.appendChild(btn);
    });
    mid.appendChild(sk);
  }
  doll.appendChild(mid);
  doll.appendChild(col(RIGHT, 'right'));

  // the seal and the charms, each with its card on hover
  const ch = b.charms;
  if (ch) {
    const side = UI.plate({ title: 'Seal & charms', icon: 'charm', cls: 'dside', badge: (ch.seal ? 1 : 0) + ch.list.length });
    const line = (c, seal) => {
      const r = UI.line({ name: c.name, rarity: c.q, sub: [c.q, seal ? 'Seal' : 'Charm', c.set].filter(Boolean).join(' · '), pic: { name: c.name, kind: seal ? 'seal' : 'charm' }, cls: 'dch sm', title: '' });
      const set = c.set && (ch.sets || []).find((x) => x.name === c.set);
      wireCard(r, () => charmCard(c, seal, set));
      side.body.appendChild(r);
    };
    if (ch.seal) line(ch.seal, true);
    ch.list.forEach((c) => line(c, false));
    doll.appendChild(side.card);
  }
  return doll;
}
/** This build's item as a card: name, what it is, where it drops, its rolls and sockets. */
function slotCard(b, key, info) {
  const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const d = mk('div', 'ctt');
  const names = info.s.item ? [info.s.item].concat(info.s.tf ? ['◈ ' + (aspectBy(info.s.tf) ? aspectBy(info.s.tf).name : info.s.tf)] : []) : (info.s.aspects || []).map((n) => (aspectBy(n) ? aspectBy(n).name : n));
  names.forEach((n) => d.appendChild(mk('div', 'nm ' + (KCLS[info.kind] || ''), n)));
  d.appendChild(mk('div', 'ty', kindLine(info, slotLabel(b, key))));
  if (info.src) {
    const w = mk('div', 'sec');
    w.appendChild(mk('b', 'wh', 'Where it drops'));
    w.appendChild(mk('div', 'st', info.src));
    d.appendChild(w);
  }
  if ((info.s.stats || []).length) {
    const st = mk('div', 'sec');
    info.s.stats.forEach((x) => st.appendChild(SCard.statLine(x)));
    d.appendChild(st);
    const lg = SCard.craftLegend(info.s.stats); if (lg) d.appendChild(lg);
  }
  if ((info.s.sockets || []).length) d.appendChild(mk('div', 'sec sock', '◆ ' + info.s.sockets.join(' · ')));
  d.appendChild(mk('div', 'sec hint', info.got ? 'Farmed · click to choose another' : 'Click to choose another'));
  return d;
}
/** "Mythic Unique Helm", "Runeword Chest Armor", "Legendary Amulet". */
function kindLine(info, label) {
  if (info.kind === 'Aspect') return 'Legendary ' + label;
  if (info.kind === 'Runeword') return 'Runeword · ' + label;
  return (info.kind === 'Mythic' ? 'Mythic Unique ' : 'Unique ') + label;
}
/** The short name of a gem or splinter: "Abyssal Splinter of Anguish" -> "Anguish". */
function shortGem(name) {
  const n = String(name || '');
  const m = n.match(/Splinter of (?:the )?(.+)$/i);
  if (m) return m[1].replace(/^Black /, '');
  return n.replace(/^(Horadric|Royal|Flawless|Grand)\s+/i, '');
}

// ---- under the gear: seal, charms, set bonuses and what is socketed where
const QCLS = { Mythic: 'r-mythic', Unique: 'r-unique', Set: 'r-set', Legendary: 'r-legendary', Magic: 'r-magic' };

/** A card built here (not from the database) in the item tooltip's place. */
const wireCard = (node, build) => UI.tip.bind(node, build, 'card', 60);
/** Seal or charm: name, stats, its text and – for a set piece – the set bonuses, the active ones lit. */
function charmCard(c, seal, set) {
  const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
  const d = mk('div', 'ctt');
  d.appendChild(mk('div', 'nm ' + (QCLS[c.q] || ''), c.name));
  d.appendChild(mk('div', 'ty', [c.q, seal ? 'Seal' : 'Charm'].filter(Boolean).join(' ') + (c.set ? ' · ' + c.set : '')));
  if (c.stats && c.stats.length) {
    const st = mk('div', 'sec');
    c.stats.forEach((x) => st.appendChild(mk('div', 'st', '· ' + x.t)));
    d.appendChild(st);
  }
  if (c.d && c.d.length) {
    const ds = mk('div', 'sec ds');
    c.d.forEach((x) => ds.appendChild(mk('div', null, x)));
    d.appendChild(ds);
  }
  if (set) {
    const sb = mk('div', 'sec set');
    sb.appendChild(mk('b', 'r-set', set.name + ' (' + set.have + ' worn)'));
    set.bonuses.forEach((x) => {
      const r = mk('div', 'bon' + (x.on ? ' on' : ''));
      r.appendChild(mk('span', 'n', '(' + x.n + ')'));
      r.appendChild(mk('span', null, x.d.join(' ')));
      sb.appendChild(r);
    });
    d.appendChild(sb);
  }
  return d;
}
/** Gem, rune or soul splinter – they get their own colour. */
function gemKind(name) {
  if (/splinter/i.test(name)) return 'splinter';
  if (/amethyst|emerald|ruby|topaz|sapphire|diamond|skull/i.test(name)) return 'gem';
  return 'rune';
}

// ---- the search dropdown under the slot that was clicked
function picker(el, b) {
  const slot = SLOTS.find((s) => s[0] === open)[1];
  const cur = b.slots[open] || {};
  if (!tab) tab = cur.aspects ? 'aspect' : 'unique';
  const p = el('div', 'fpick');
  const head = el('div', 'ph');
  head.appendChild(el('b', null, LABEL[open] || open));
  const find = el('div', 'qbox find');
  find.appendChild(UI.icon('search'));
  const inp = el('input');
  inp.id = 'farmQ'; inp.placeholder = 'Search everything for this slot …';
  inp.value = q; inp.spellcheck = false; inp.autocomplete = 'off';
  inp.oninput = () => { q = inp.value; ctx.rerender(); };
  inp.onkeydown = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); pickOpen = false; ctx.rerender(); }
    if (e.key === 'Enter') { const first = p.querySelector('.popt'); if (first) first.click(); }
  };
  find.appendChild(inp);
  head.appendChild(find);
  head.appendChild(UI.seg([['unique', 'Unique'], ['mythic', 'Mythic'], ['aspect', 'Aspect']], tab, (id) => { tab = id; ctx.rerender(); }));
  const close = UI.iconBtn('Close (Esc)', 'close', () => { pickOpen = false; ctx.rerender(); }, 'ghost sm');
  head.appendChild(close);
  p.appendChild(head);

  const list = el('div', 'plist');
  const qn = norm(q);
  const have = cur.aspects || [];
  // the off-hand also takes a second one-handed weapon (dual wield)
  const fits = (it) => it.slot === slot || (open === 'Off-Hand' && it.slot === 'Weapon' && /main hand/i.test(it.type));
  const isRuneword = (it) => it.src && it.src[0] && !!it.src[0].recipe;
  const aspectRow = (a) => {
    const on = have.indexOf(a.name) >= 0;
    const row = UI.line({ tag: 'div', name: a.short, rarity: 'Legendary', sub: a.cat + (a.cls !== 'All' ? ' · ' + a.cls : ''), pic: { name: a.name, kind: 'aspect' },
      end: a.dungeon ? a.dungeon + ' · ' + a.region : 'salvage', cls: 'popt click sm' + (on ? ' picked' : ''), title: '' });
    row.onclick = () => {
      let next = have.slice();
      if (on) next = next.filter((n) => n !== a.name);
      else { next.push(a.name); if (next.length > maxAspects(open)) next = next.slice(-maxAspects(open)); }
      // a new choice is not the imported item any more – its stats go with it,
      // unless only the second aspect on the amulet changed
      if (!next.length) delete b.slots[open];
      else if (next[0] === have[0]) b.slots[open] = Object.assign({}, cur, { aspects: next });
      else b.slots[open] = { aspects: next };
      if (maxAspects(open) === 1) pickOpen = false;
      touch();
    };
    wireTip(row, 'aspect', a.id);
    return row;
  };
  const itemRow = (it) => {
    const row = UI.line({ tag: 'div', name: it.name, rarity: isRuneword(it) ? 'Runeword' : it.rarity, sub: (isRuneword(it) ? 'Runeword · ' : '') + it.type + (it.cls !== 'All' ? ' · ' + it.cls : ''),
      pic: { name: it.name, url: it.icon, kind: isRuneword(it) ? 'rune' : it.rarity === 'Mythic' ? 'mythic' : 'unique' },
      end: sourceLine(it.src), cls: 'popt click sm' + (cur.item === it.name ? ' picked' : ''), title: '' });
    row.onclick = () => { if (cur.item !== it.name) b.slots[open] = { item: it.name }; pickOpen = false; touch(); };
    wireTip(row, 'item', it.id);
    return row;
  };
  const byName = (x, y) => x.name.localeCompare(y.name);
  if (qn) {
    // typing searches everything that fits the slot – no need to pick the right tab first
    const items = cat.items.filter((it) => fits(it) && forClass(it, b.cls) && it.n.includes(qn));
    const groups = [
      ['Mythic', items.filter((it) => it.rarity === 'Mythic').sort(byName), itemRow],
      ['Unique', items.filter((it) => it.rarity !== 'Mythic' && !isRuneword(it)).sort(byName), itemRow],
      ['Runeword', items.filter((it) => it.rarity !== 'Mythic' && isRuneword(it)).sort(byName), itemRow],
      ['Aspect', cat.aspects.filter((a) => a.slots.indexOf(slot) >= 0 && forClass(a, b.cls) && a.n.includes(qn))
        .sort((x, y) => x.short.localeCompare(y.short)), aspectRow],
    ];
    groups.forEach(([label, opts, row]) => {
      if (!opts.length) return;
      list.appendChild(el('div', 'pgrp g-' + label.toLowerCase(), label + ' · ' + opts.length));
      opts.forEach((x) => list.appendChild(row(x)));
    });
    if (!groups.some((g) => g[1].length)) list.appendChild(el('div', 'empty', 'Nothing called “' + q + '” fits this slot' + (b.cls !== 'All' ? ' for ' + b.cls : '') + '.'));
  } else if (tab === 'aspect') {
    const opts = cat.aspects.filter((a) => a.slots.indexOf(slot) >= 0 && forClass(a, b.cls))
      .sort((x, y) => (have.indexOf(y.name) >= 0) - (have.indexOf(x.name) >= 0) || x.short.localeCompare(y.short));
    if (maxAspects(open) > 1) list.appendChild(el('div', 'meta hint', 'Up to two aspects on the amulet — click again to remove one.'));
    opts.forEach((a) => list.appendChild(aspectRow(a)));
    if (!opts.length) list.appendChild(el('div', 'empty', 'No aspect fits this slot' + (b.cls !== 'All' ? ' for ' + b.cls : '') + '.'));
  } else {
    const mythic = tab === 'mythic';
    const opts = cat.items.filter((it) => fits(it) && (it.rarity === 'Mythic') === mythic && forClass(it, b.cls)).sort(byName);
    opts.forEach((it) => list.appendChild(itemRow(it)));
    if (!opts.length) list.appendChild(el('div', 'empty', 'Nothing for this slot' + (b.cls !== 'All' ? ' and ' + b.cls : '') + '.'));
  }
  p.appendChild(list);
  return p;
}

/** The dropdown sits right under its slot and keeps the cursor in the search field. */
function placePicker() {
  const p = document.querySelector('.fpick');
  const s = document.querySelector('.fgear [data-key="' + open + '"]');
  if (!p || !s) return;
  const gear = p.parentElement;
  const top = s.offsetTop + s.offsetHeight + 4;
  p.style.top = Math.max(0, Math.min(top, gear.scrollHeight - 60)) + 'px';
  // a slot low in the list: scroll so the whole dropdown is in view
  const over = p.offsetTop + p.offsetHeight - (gear.scrollTop + gear.clientHeight);
  if (over > 0) gear.scrollTop += over + 8;
  const i = document.getElementById('farmQ');
  if (i) { i.focus({ preventScroll: true }); i.setSelectionRange(q.length, q.length); }
}

/** "Harbinger of Hatred / Any lair boss" – or the runes for a runeword. */
function sourceLine(src) {
  if (!src || !src.length) return '—';
  if (src[0].recipe) return src[0].recipe;
  return src.map((x) => x.src).join(' / ');
}

/** For the compare view: an item's or aspect's rarity and the first place it comes from. */
function lookUp(name) {
  const it = itemBy(name), a = !it && aspectBy(name);
  const src = (it || a || {}).src || [];
  const first = src[0];
  return {
    rarity: it ? rarityOf(it) : a ? 'Legendary' : '',
    where: !first ? '' : first.recipe ? 'Runeword: ' + first.recipe : first.src,
  };
}

// ---- what to farm – uniques with where they drop, then the aspects (for the progress)
function entries(b) {
  const out = { items: [], aspects: [] };
  SLOTS.forEach(([key]) => {
    const s = b.slots[key];
    if (!s) return;
    const slot = slotLabel(b, key);
    if (s.item) {
      const it = itemBy(s.item);
      const src = it ? it.src : [{ src: 'Not in the item list any more', loc: '', order: 9 }];
      out.items.push({ key: s.item, name: s.item, kind: 'item', id: it && it.id, rarity: rarityOf(it), slot,
        where: sourceLine(src), loc: src.map((x) => x.src + (x.loc ? ' — ' + x.loc : '')).join('\n'), order: src[0].order });
    }
    (s.aspects || []).concat(s.item && s.tf ? [s.tf] : []).forEach((n) => {
      const a = aspectBy(n);
      const src = a ? a.src : [{ src: 'Salvage a legendary', loc: '', order: 6 }];
      out.aspects.push({ key: n, name: a ? a.name : n, kind: 'aspect', id: a && a.id, rarity: 'Legendary', slot,
        where: src.map((x) => x.src).join(' / '), loc: src.map((x) => x.src + (x.loc ? ' — ' + x.loc : '')).join('\n'), order: src[0].order });
    });
  });
  return out;
}

window.FarmView = {
  render,
  reload: () => { if (!api) return Promise.resolve(); tipCache.clear(); return load().then(() => { if (ctx) ctx.rerender(); if (window.FarmView.onChange) window.FarmView.onChange(); }); },
  hideTip,
  adopt: (d) => { if (d && d.builds) { data = d; if (window.FarmView.onChange) window.FarmView.onChange(); } },   // builds imported from the settings
  _state: () => ({ cat, data, open, tab, view, pickOpen }),
  /** The active build and what it still needs: { name, total, missing } – null without a build. */
  summary: async (a) => {
    if (!api) api = a;
    if (!cat || !data) await load();
    const b = build();
    if (!b) return null;
    const p = progress(b);
    return { name: b.name, total: p.total, missing: p.total - p.got };
  },
  onChange: null,                                     // set by app.js: a tick or a build changed
  // ---- for the search and boss loot: the same catalog and the same in-game tooltip
  /** Loads the catalog once (it may not have been opened yet). */
  ensure: (a) => { if (!api) api = a; return cat ? Promise.resolve() : load(); },
  /** A unique or mythic by name – { id, rarity, slot, type, cls, icon } – null until loaded or unknown. */
  item: (name) => {
    if (!cat) return null;
    const n = window.SearchLib.norm(name);
    return cat.items.find((x) => x.n === n) || null;
  },
  /** The in-game tooltip on hover, for an item by name. */
  tip: (node, name) => {
    const it = window.FarmView.item(name);
    if (it && it.id) wireTip(node, 'item', it.id);
  },
  view: () => view,
  /** Gear / Skills / Paragon – what the build opens on next. */
  setView: (v) => { if (['guide', 'gear', 'skills', 'paragon'].includes(v)) { view = v; pickOpen = false; hideTip(); } },
};
})();
