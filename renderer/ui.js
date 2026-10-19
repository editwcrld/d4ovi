// The overlay's building blocks – the same few everywhere, so every page looks alike
// (renderer/style.css draws them):
//
//   UI.el      an element:  el(tag, class, text)
//   UI.icon    a stroke icon by name
//   UI.pic     a thing's picture by its name – the map of lib/icons.js, for uniques first the
//              d4builds.gg picture; never an empty box
//   UI.line    THE line: one thing – its picture, its name in its rarity's colour, what it is,
//              and on the right a count, a tick or buttons
//   UI.plate   THE plate: a part of a page under its own head (icon, title, a line on it, a badge)
//   UI.tip     THE hover card, one for the whole overlay
//
// Text from other sites only ever goes in as textContent – except the in-game tooltips of
// d4guides.gg, which the main process cleans (lib/farm.js cleanHtml) before they come here.
(function (root) {
'use strict';
const doc = typeof document !== 'undefined' ? document : null;

/** An element: el('div', 'line got', 'text'). */
function el(tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

// ---------------------------------------------------------------- icons
// One stroke style (24 × 24, round caps) for every icon in the overlay.
const ICONS = {
  search: 'M11 17.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM16 16l4.5 4.5',
  builds: 'M6 3.5h8.5l3.5 3.5v13.5H6zM14.5 3.5V7H18M9 11.5l1.4 1.4 2.6-2.6M9 16.5h6',
  map: 'M3 7.2l6-2.7 6 2.7 6-2.7v12.3l-6 2.7-6-2.7-6 2.7zM9 4.5v12.3M15 7.2v12.3',
  trade: 'M4 8.5h16l-1.5 11h-13zM8.5 8.5V7a3.5 3.5 0 0 1 7 0v1.5',
  settings: 'M4 7h10M18 7h2M4 12h3M11 12h9M4 17h7M15 17h5M16 9.1a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM9 14.1a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2zM13 19.1a2.1 2.1 0 1 0 0-4.2 2.1 2.1 0 0 0 0 4.2z',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  pin: 'M9 4h6l-1 5 3 3v2H7v-2l3-3zM12 14v6',
  star: 'M12 3.6l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z',
  copy: 'M9 9h11v11H9zM5.5 15H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v.5',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  down: 'M7 10l5 5 5-5',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  boss: 'M12 3a8 8 0 0 0-8 8c0 3 1.6 5 3.5 6v3h9v-3c1.9-1 3.5-3 3.5-6a8 8 0 0 0-8-8zM9 12h.01M15 12h.01M10 20v-2M14 20v-2',
  lair: 'M4 21V10l8-6 8 6v11M9 21v-6h6v6',
  rune: 'M12 2l8 5v10l-8 5-8-5V7zM9 9l6 6M15 9l-6 6',
  dungeon: 'M4 21V9l8-6 8 6v12zM10 21v-6h4v6',
  salvage: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z',
  charm: 'M12 3l7 7-7 11-7-11zM5 10h14',
  seal: 'M12 3l3 6 6 .5-4.5 4 1.5 6.5L12 17l-6 3 1.5-6.5L3 9.5 9 9z',
  gem: 'M6 3h12l3 6-9 12L3 9zM3 9h18M9 3l3 6 3-6',
  splinter: 'M12 2.5l3.5 8.5-3.5 10.5-3.5-10.5z',
  item: 'M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6z',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  activity: 'M5 21V4M5 4h11l-2 4 2 4H5',
  craft: 'M14 4l6 6-3 3-6-6zM11 7l-8 8 3 3 8-8M3 21l3-3',
  skills: 'M13 2L4 14h7l-1 8 9-12h-7z',
  paragon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  glyph: 'M12 3l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.4l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z',
  target: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM12 12h.01',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.8 1.2V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  build: 'M4 5h16v14H4zM8 9h8M8 13h5',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  key: 'M3 7h18v10H3zM7 11h.01M11 11h.01M15 11h.01M8 14.5h8',
  lock: 'M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5zM12 15v2',
  timer: 'M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM12 9v4l2.5 2.5M9 2h6',
  power: 'M12 3v8M6.3 7.2a7 7 0 1 0 11.4 0',
  person: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4.5 20c.8-3.6 3.8-6 7.5-6s6.7 2.4 7.5 6',
  folder: 'M3 6h6l2 2h10v11H3z',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  warn: 'M12 9v4M12 17h.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  eye: 'M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
};
/** A stroke icon: <svg class="i"> with the named path (or a path given directly). */
function icon(name, cls) {
  const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
  s.setAttribute('aria-hidden', 'true');
  const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', ICONS[name] || name || ICONS.info);
  s.appendChild(p);
  return s;
}

// ---------------------------------------------------------------- pictures
// lib/icons.js builds the map in the main process ({ norm(name): url }); it arrives once the
// data is there and again when it changed. The look-up is the same normalisation as there.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
let iconMap = {};
const MX = 'https://assets-ng.maxroll.gg/d4-tools/images/webp/';
const ASPECT_ICON = MX + '4248954575.webp';                   // the codex's aspect, until the map is here
// d4builds.gg keeps a picture per unique, boss and class under its name (sunderarmor.com)
const PICS = 'https://sunderarmor.com/DIABLO4/';
const clean = (n) => String(n || '').replace(/‍/g, '').trim();
/** "Sea Lord's Fine Gloves" -> …/Uniques/2/sea_lord's_fine_gloves.png */
const uniquePic = (name) => PICS + 'Uniques/2/' + encodeURI(clean(name).toLowerCase().replace(/ /g, '_')) + '.png';
/** "Duriel, King of Maggots" -> boss_duriel, "The Beast in the Ice" -> boss_beast-in-ice, "Echo of Varshan" -> boss_varshan. */
function bossPic(name) {
  const n = clean(name).split(',')[0].toLowerCase().replace(/^echo of /, '').split(' ').filter((w) => w && w !== 'the').join('-');
  return n ? PICS + 'Bosses/1/boss_' + encodeURI(n) + '.png' : '';
}
const classPic = (cls) => PICS + 'Classes/2/' + String(cls).toLowerCase() + '.png';
const skillPic = (id) => (id ? 'https://cloudstorage.d2core.com/data_img/d4/skill/' + id + '.png' : '');
const isUrl = (u) => /^https?:/.test(u || '');

/** A paragon glyph's round picture – legendary (orange) from rank 46 on, rare (green) before. */
const glyphPic = (name, rank) => iconMap[((Number(rank) || 0) >= 46 ? 'glyph+:' : 'glyph:') + norm(name)] || iconMap['glyph:' + norm(name)] || '';
/** The picture the map knows for a name – a boss trophy ("Duriel: Shard of Agony") by its item. */
function iconOf(name, kind) {
  const k = norm(name);
  if (iconMap[k]) return iconMap[k];
  const tail = String(name || '').split(':').slice(1).join(':');
  if (tail && iconMap[norm(tail)]) return iconMap[norm(tail)];
  return kind === 'aspect' ? ASPECT_ICON : '';
}
/** Where a thing's picture may come from, the best first. */
function picUrls(name, kind, url) {
  const known = iconOf(name, kind);
  const list = [];
  if (kind === 'boss') list.push(bossPic(name));
  else if (kind === 'class') list.push(classPic(name));
  else if (!kind || kind === 'unique' || kind === 'mythic' || kind === 'item') list.push(uniquePic(name));
  list.push(url, known);
  return [...new Set(list.filter(isUrl))];
}
/** What stands in a box whose pictures all failed – the kind's own icon, never an empty square. */
const KIND_ICON = { boss: 'boss', aspect: 'charm', gem: 'gem', rune: 'rune', splinter: 'splinter', charm: 'charm', seal: 'seal', skill: 'skills', class: 'person', set: 'charm', pool: 'target',
  search: 'search', trade: 'trade', craft: 'craft', activity: 'activity', thing: 'item' };
/** A picture element: the first source that loads. */
function img(src, onFail) {
  const im = el('img');
  im.alt = '';
  im.referrerPolicy = 'no-referrer';
  im.decoding = 'async';
  im.loading = 'lazy';
  im.onerror = () => { im.remove(); if (onFail) onFail(); };
  im.src = src;
  return im;
}
/**
 * A thing's picture in a box.
 * @param {string} name
 * @param {object} [o]  { kind: unique|mythic|aspect|gem|rune|splinter|charm|seal|boss|class|skill|pool,
 *                        url: a picture the caller knows, cls: the box's class (default "pic") }
 */
function pic(name, o) {
  o = o || {};
  const box = el('span', o.cls || 'pic');
  const urls = o.kind === 'skill' ? [o.url].filter(isUrl) : picUrls(name, o.kind, o.url);
  const next = (i) => {
    if (i >= urls.length) { box.classList.add('none'); box.appendChild(icon(KIND_ICON[o.kind] || 'item')); return; }
    box.appendChild(img(urls[i], () => next(i + 1)));
  };
  next(0);
  return box;
}

// ---------------------------------------------------------------- the line and the plate
/** The rarity's class for a name: r-mythic, r-unique, r-legendary, r-set, r-rune, r-magic, r-gem. */
function rcls(r) {
  const s = String(r || '').toLowerCase();
  if (/mythic/.test(s)) return 'r-mythic';
  if (/runeword|rune/.test(s)) return 'r-rune';
  if (/set/.test(s)) return 'r-set';
  if (/unique/.test(s)) return 'r-unique';
  if (/legendary|aspect/.test(s)) return 'r-legendary';
  if (/magic/.test(s)) return 'r-magic';
  if (/gem|splinter/.test(s)) return 'r-gem';
  return '';
}
/**
 * THE line.
 * @param {object} o  { name, rarity, sub, pic: Node | { name, kind, url } | false, end: Node|string,
 *                      tick: { on, title, onClick }, on, got, cls, title, onClick, tag: 'div'|'button'|'a' }
 * @returns {HTMLElement}  .line > [.dia] .pic .l-tx(.ln .lm) [.l-end]
 */
function line(o) {
  const r = el(o.tag || (o.onClick ? 'button' : 'div'), 'line' + (o.on ? ' on' : '') + (o.got ? ' got' : '') + (o.cls ? ' ' + o.cls : ''));
  if (o.tick) r.appendChild(tick(o.tick));
  if (o.pic !== false) r.appendChild(o.pic instanceof Node ? o.pic : pic((o.pic && o.pic.name) || o.name, o.pic || {}));
  const tx = el('span', 'l-tx');
  const n = el('span', 'ln ' + rcls(o.rarity), o.name);
  tx.appendChild(n);
  if (o.sub) tx.appendChild(el('span', 'lm', o.sub));
  r.appendChild(tx);
  if (o.end != null && o.end !== '') {
    const e = el('span', 'l-end');
    if (o.end instanceof Node) e.appendChild(o.end); else e.textContent = String(o.end);
    r.appendChild(e);
  }
  r.title = o.title != null ? o.title : o.name + (o.sub ? ' — ' + o.sub : '');
  if (o.onClick) r.onclick = o.onClick;
  return r;
}
/** The game's diamond tick. */
function tick(o) {
  const b = el('button', 'dia' + (o.on ? ' on' : ''));
  b.type = 'button';
  b.title = o.title || (o.on ? 'Got it — click to undo' : 'Got it');
  b.setAttribute('aria-pressed', o.on ? 'true' : 'false');
  b.setAttribute('aria-label', 'Farmed');
  b.onclick = (e) => { e.stopPropagation(); if (o.onClick) o.onClick(!o.on); };
  return b;
}
/**
 * THE plate.
 * @param {object} o  { title, sub, icon (a name or a path), badge, badgeCls, cls, id }
 * @returns {{ card, head, body, badge, side }}
 */
function plate(o) {
  const c = el('section', 'plate' + (o.cls ? ' ' + o.cls : ''));
  if (o.id) c.dataset.card = o.id;
  const head = el('div', 'pt');
  if (o.icon) head.appendChild(icon(o.icon));
  const t = el('div', 'ptx');
  t.appendChild(el('h3', null, o.title));
  if (o.sub) t.appendChild(el('span', null, o.sub));
  head.appendChild(t);
  const side = el('div', 'pend');
  const badge = el('span', 'badge' + (o.badgeCls ? ' ' + o.badgeCls : ''), o.badge == null ? '' : String(o.badge));
  side.appendChild(badge);
  head.appendChild(side);
  c.appendChild(head);
  const body = el('div', 'pc');
  c.appendChild(body);
  return { card: c, head, body, badge, side };
}

// ---------------------------------------------------------------- buttons
/** A button: btn('Import', fn, 'pri') – classes: pri (the one main action), ghost, icon, on, danger. */
function btn(label, onClick, cls, iconName) {
  const b = el('button', 'btn' + (cls ? ' ' + cls : ''));
  b.type = 'button';
  if (iconName) b.appendChild(icon(iconName));
  if (label) b.appendChild(el('span', null, label));
  if (onClick) b.onclick = onClick;
  return b;
}
/** An icon-only button with its name as the tooltip. */
function iconBtn(title, iconName, onClick, cls) {
  const b = btn('', onClick, 'icon' + (cls ? ' ' + cls : ''), iconName);
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}
/** Segments: seg([[value, label, title, off]], current, onPick, cls). */
function seg(options, value, onPick, cls) {
  const g = el('div', 'seg' + (cls ? ' ' + cls : ''));
  options.forEach(([v, label, title, off]) => {
    const b = el('button', (String(v) === String(value) ? 'on' : '') + (off ? ' none' : ''), label);
    b.type = 'button';
    if (title) b.title = title;
    b.onclick = () => onPick(v);
    g.appendChild(b);
  });
  return g;
}
/** Page tabs: small caps with the red diamond under the one shown. */
function tabs(options, value, onPick) {
  const g = el('nav', 'ptabs');
  options.forEach(([v, label, title, off, n]) => {
    const b = el('button', 'ptab' + (v === value ? ' on' : '') + (off ? ' none' : ''));
    b.type = 'button';
    b.dataset.tab = v;
    b.appendChild(el('span', null, label));
    if (n != null) b.appendChild(el('b', 'n', String(n)));
    if (title) b.title = title;
    b.onclick = () => onPick(v);
    g.appendChild(b);
  });
  return g;
}

// ---------------------------------------------------------------- the hover card
// One for the whole overlay: next to the mouse, always inside the window.
let tipEl = null, tipFor = null, tipTimer = null;
function tipBox() {
  if (!tipEl) { tipEl = el('div'); tipEl.id = 'tip'; tipEl.hidden = true; doc.body.appendChild(tipEl); }
  return tipEl;
}
function tipMove(e) {
  if (!tipEl || tipEl.hidden || !e) return;
  const w = tipEl.offsetWidth || 320, h = tipEl.offsetHeight || 160;
  const vw = root.innerWidth, vh = root.innerHeight;
  let x = e.clientX + 16, y = e.clientY + 14;
  if (x + w > vw - 6) x = Math.max(6, e.clientX - w - 16);
  if (y + h > vh - 6) y = Math.max(6, vh - h - 6);
  tipEl.style.left = x + 'px';
  tipEl.style.top = y + 'px';
}
/**
 * Shows the card: content is a Node, or { html } for the in-game tooltip from d4guides.gg
 * (cleaned in the main process), or { title, sub, lines } for a short one.
 */
function tipShow(e, content, cls) {
  const t = tipBox();
  t.className = cls || '';
  t.textContent = '';
  if (content instanceof Node) t.appendChild(content);
  else if (content && content.html != null) t.innerHTML = content.html;
  else if (content) {
    t.appendChild(el('b', 'tt', content.title || ''));
    if (content.sub) t.appendChild(el('i', 'ts', content.sub));
    (content.lines || []).filter(Boolean).forEach((l) => t.appendChild(el('p', null, l)));
  }
  t.hidden = false;
  tipMove(e);
}
function tipHide() { clearTimeout(tipTimer); tipFor = null; if (tipEl) tipEl.hidden = true; }
/**
 * A card on hover: build() makes it when the mouse comes (it may return a promise – the card shows
 * once it is there, if the mouse is still on the node).
 */
function tipBind(node, build, cls, delay) {
  node.dataset.tip = '1';
  node.addEventListener('mouseenter', (e) => {
    tipFor = node;
    const at = { clientX: e.clientX, clientY: e.clientY };
    clearTimeout(tipTimer);
    tipTimer = setTimeout(async () => {
      const c = await build();
      if (tipFor !== node || !c) return;
      tipShow(at, c, cls);
    }, delay == null ? 120 : delay);
  });
  node.addEventListener('mousemove', (e) => { if (tipFor === node) tipMove(e); });
  node.addEventListener('mouseleave', () => { if (tipFor === node) tipHide(); });
}
// a card whose node was drawn away goes as soon as the mouse moves elsewhere
if (doc) doc.addEventListener('mousemove', (e) => { if (tipEl && !tipEl.hidden && tipFor && !tipFor.isConnected) tipHide(); else if (tipEl && !tipEl.hidden && !tipFor) tipMove(e); });

root.UI = {
  el, icon, ICONS, pic, img, line, tick, plate, btn, iconBtn, seg, tabs, rcls, norm,
  uniquePic, bossPic, classPic, skillPic, iconOf, glyphPic,
  setIcons: (m) => { iconMap = m && typeof m === 'object' ? m : {}; },
  tip: { show: tipShow, move: tipMove, hide: tipHide, bind: tipBind },
};
})(typeof window !== 'undefined' ? window : globalThis);
