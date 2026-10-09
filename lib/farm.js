'use strict';
// Farm list: every unique, mythic and legendary aspect with the slot it goes into and where
// it comes from.
//
//   items    – d4guides.gg item list (all uniques + mythics, with slot and class)
//   aspects  – d4guides.gg aspect list; the exact slots and the dungeon that unlocks one are
//              only in its tooltip, so those are fetched once in the background and cached
//   sources  – the maxroll boss loot sheet the overlay already has (lib/maxroll.js)
//
// The in-game looking tooltip on hover is d4guides' own (api/v1/tooltip.php), cleaned up
// and made absolute so it can be shown inside the overlay.
const fs = require('fs');
const path = require('path');
const d4g = require('./d4guides');

const BASE = d4g.BASE;
const MAX_AGE = 3 * 24 * 3600 * 1000;
const VERSION = 1;
const TOOLTIP_CSS = BASE + '/assets/css/tooltip-v2.css';

const SLOTS = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots', 'Amulet', 'Ring', 'Weapon', 'Off-Hand'];
// d4guides' "Slot" column -> our slot
const SLOT_OF = {
  'helm': 'Helm', 'chest armor': 'Chest Armor', 'gloves': 'Gloves', 'pants': 'Pants', 'boots': 'Boots',
  'amulet': 'Amulet', 'ring': 'Ring', 'ring 1': 'Ring', 'ring 2': 'Ring',
  'main hand': 'Weapon', 'off hand': 'Off-Hand', 'off-hand': 'Off-Hand', 'shield': 'Off-Hand',
};
const slotOf = (s) => {
  const k = String(s || '').toLowerCase().trim();
  return SLOT_OF[k] || (/two.handed|weapon/.test(k) ? 'Weapon' : '');
};
// "Allowed Item Types" of an aspect -> our slots
const ASPECT_SLOT = { weapon: ['Weapon'], shield: ['Off-Hand'], 'off-hand': ['Off-Hand'] };
// Until the tooltips are in: what the category allows in almost every case
const CAT_SLOTS = {
  offensive: ['Weapon', 'Amulet', 'Ring', 'Gloves', 'Off-Hand'],
  defensive: ['Helm', 'Chest Armor', 'Pants', 'Amulet', 'Off-Hand'],
  utility: ['Helm', 'Chest Armor', 'Boots', 'Gloves', 'Amulet', 'Pants', 'Off-Hand'],
  resource: ['Ring', 'Amulet'],
  mobility: ['Boots', 'Amulet'],
};

const norm = d4g.norm;
const field = (row, label) => ((row.fields || []).find((f) => f.label.toLowerCase() === label.toLowerCase()) || {}).value || '';
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ' };
const unent = (s) => String(s || '')
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&[a-z]+;/gi, (e) => ENT[e.toLowerCase()] || ' ');
const plain = (html) => unent(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

let data = { items: [], aspects: [] };
let tips = {};                 // 'item:1440' -> cleaned tooltip html
let css = '';
let cacheFile = null, tipFile = null;
let fetchedAt = 0;
let tipsDirty = false;

// ---------------------------------------------------------------- parsing
function toItem(r) {
  const rarity = field(r, 'Rarity');
  const slot = slotOf(field(r, 'Slot'));
  if (!slot || !/unique/i.test(rarity)) return null;     // "Normal" bases and odd rows stay out
  return {
    kind: 'item', id: r.id, name: r.name, n: r.n, slot, type: field(r, 'Slot'),
    rarity: /mythic/i.test(rarity) ? 'Mythic' : 'Unique',
    cls: field(r, 'Class') || 'All', icon: r.icon, url: r.url,
    effect: field(r, 'Unique Effect') || field(r, 'Effect'),
  };
}
function toAspect(r) {
  const cat = field(r, 'Category');
  return {
    kind: 'aspect', id: r.id, name: r.name, n: r.n, short: shortAspect(r.name),
    cat, cls: field(r, 'Class') || 'All', url: r.url,
    effect: field(r, 'Description'),
    slots: CAT_SLOTS[cat.toLowerCase()] || SLOTS.slice(), exact: false, dungeon: '', region: '',
  };
}
/** "Aspect of the Untarnished Blaze" -> "Untarnished Blaze", "Overheating Aspect" -> "Overheating" (what a build planner shows). */
function shortAspect(name) {
  return String(name || '').replace(/^aspect of (the )?/i, '').replace(/[’']s aspect$/i, '').replace(/ aspect$/i, '').trim() || name;
}

/** What an aspect tooltip says beyond the list page: the exact slots and the dungeon that unlocks it. */
function aspectDetails(html) {
  const t = plain(html);
  const out = {};
  const m = t.match(/Allowed Item Types:\s*(.*?)(?:\s+(?:Unlocked|Salvage)\b|$)/i);
  if (m) {
    const slots = new Set();
    for (const part of m[1].split(',')) {
      const k = part.trim().replace(/\.$/, '').toLowerCase();
      (ASPECT_SLOT[k] || [slotOf(k)]).filter(Boolean).forEach((s) => slots.add(s));
    }
    if (slots.size) out.slots = SLOTS.filter((s) => slots.has(s));
  }
  const d = t.match(/Unlocked by completing (.+?) in (.+?)(?:\s+OR\b|\.|$)/i);
  if (d) { out.dungeon = d[1].trim(); out.region = d[2].trim(); }
  return out;
}

// Tooltip html from d4guides: no scripts or handlers, every address absolute.
function cleanHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|style)[^>]*>/gi, '')
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/(src|href)="\//g, '$1="' + BASE + '/')
    .replace(/url\((['"]?)\//g, 'url($1' + BASE + '/');
}
const cleanCss = (s) => String(s || '').replace(/url\((['"]?)\//g, 'url($1' + BASE + '/').replace(/@import[^;]*;/g, '');

// ---------------------------------------------------------------- where things drop
const SHORT_BOSS = (name) => String(name || '').split(',')[0].trim();
const lairKey = (info) => ((info || []).find((x) => /lair key|sigil|compass/i.test(x)) || '').replace(/^Boss Lair Key:\s*/i, '');

/**
 * Turns the boss loot sheet into "name -> where it drops".
 * @returns {Map<string, Array<{src:string, cls:string, note:string, loc:string, order:number}>>}
 */
function dropIndex(loot) {
  const idx = new Map();
  const add = (name, s) => {
    const k = norm(name);
    if (!k) return;
    const l = idx.get(k) || [];
    if (!l.some((x) => x.src === s.src)) l.push(s);
    idx.set(k, l);
  };
  for (const sec of (loot && loot.sections) || []) {
    const name = sec.name || '';
    if (/troph|rune drops/i.test(name)) continue;
    for (const d of sec.drops || []) {
      const item = String(d.name || '').replace(/\s*\([^)]*\)\s*$/, '');
      if (sec.isBoss) {
        add(item, { src: SHORT_BOSS(name), cls: d.cls || '', note: '', order: 0,
          loc: [sec.location, lairKey(sec.info)].filter(Boolean).join(' · ') });
      } else if (/new season/i.test(name)) {
        add(item, { src: 'Capstone dungeons', cls: '', note: d.cls || '', order: 1,
          loc: 'Baal, Mephisto or Diablo capstone — Baal is the quickest run' });
      } else if (/general unique/i.test(name)) {
        add(item, { src: 'Any lair boss', cls: '', note: '', order: 2, loc: 'General Unique Pool — every lair boss can drop it' });
      } else if (/mythic/i.test(name)) {
        add(item, { src: 'Any boss (Mythic)', cls: '', note: '', order: 3, loc: 'Every lair boss, very rare — or the Horadric Cube' });
      } else if (/non.boss/i.test(name)) {
        add(item, { src: 'Random drop / Cube', cls: '', note: '', order: 4, loc: 'No dedicated source — random drop, or the Horadric Cube (common → unique of the same slot)' });
      }
    }
  }
  for (const l of idx.values()) l.sort((a, b) => a.order - b.order);
  return idx;
}

const FALLBACK = { src: 'Random drop / Cube', cls: '', note: '', order: 4, loc: 'No dedicated source — random drop, or the Horadric Cube (common → unique of the same slot)' };
const SALVAGE = { src: 'Salvage a legendary', cls: '', note: '', order: 6, loc: 'Any legendary with this aspect — salvage it to unlock the aspect in the Codex' };

/**
 * Runewords from maxroll's crafting sheet ("Classic Runewords": Runes | Base Item | Runecraft):
 * name -> { runes: "Jah + Ith + Ber", base: "Chest Armor" }.
 */
function runewordIndex(craft) {
  const out = new Map();
  for (const t of (craft && craft.tables) || []) {
    const cols = (t.cols || []).map((c) => String(c).toLowerCase());
    const ri = cols.indexOf('runes'), bi = cols.indexOf('base item'), ni = cols.indexOf('runecraft');
    if (ri < 0 || ni < 0) continue;
    const clean = (s) => String(s || '').replace(/[​-‍﻿]/g, '').trim();   // the sheet has zero-width joiners
    for (const r of t.rows || []) if (r[ni] && r[ri]) out.set(norm(clean(r[ni])), { runes: clean(r[ri]), base: clean(bi >= 0 ? r[bi] : '') });
  }
  return out;
}

/** Everything the overlay needs for the farm list, with the sources filled in. */
function catalog(loot, craft) {
  const idx = dropIndex(loot);
  const rws = runewordIndex(craft);
  // d4guides lists every weapon kind / class variant of a unique on its own row
  // ("Call to Arms" as sword, mace, axe …) – for the farm list one entry per slot is enough.
  const seen = new Map();
  const items = [];
  for (const it of data.items) {
    const k = it.n + '|' + it.slot;
    const prev = seen.get(k);
    // "infinity-bow", "spirit-sword", "infinity-two-handed-axe" -> the kind after the name
    const variant = { id: it.id, icon: it.icon, url: it.url,
      kind: String(it.url || '').split('/').pop().replace(String(it.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-', '') };
    if (prev) {
      prev.variants.push(variant);
      if (prev.type.split(' / ').indexOf(it.type) < 0) prev.type += ' / ' + it.type;
      // class variants: keep them as a list ("Druid / Sorcerer"), "All" wins
      if (prev.cls === 'All' || it.cls === 'All') prev.cls = 'All';
      else if (prev.cls.split(' / ').indexOf(it.cls) < 0) prev.cls += ' / ' + it.cls;
      continue;
    }
    const rw = rws.get(it.n);
    const e = Object.assign({}, it, {
      variants: [variant],
      src: rw
        ? [{ src: 'Runeword', cls: '', note: '', order: 1, recipe: rw.runes, loc: rw.runes + (rw.base ? ' · socketed into ' + rw.base : '') }]
        : idx.get(it.n) || [FALLBACK],
    });
    seen.set(k, e);
    items.push(e);
  }
  const aspects = data.aspects.map((a) => {
    // caches from before kept "Maugan&#x27;s Works" as it came
    const dungeon = unent(a.dungeon), region = unent(a.region);
    return Object.assign({}, a, { dungeon, region,
      src: dungeon
        ? [{ src: 'Dungeon: ' + dungeon, cls: '', note: '', order: 5, loc: region + ' — completing it unlocks the aspect' }, SALVAGE]
        : [SALVAGE],
    });
  });
  return { slots: SLOTS, items, aspects, fetchedAt, details: data.aspects.filter((a) => a.exact).length };
}

// ---------------------------------------------------------------- loading
function setData(d) {
  data = { items: (d && d.items) || [], aspects: (d && d.aspects) || [] };
  return data.items.length + data.aspects.length;
}

function configure(opts) {
  if (opts && opts.cacheFile) cacheFile = opts.cacheFile;
  if (opts && opts.tipFile) tipFile = opts.tipFile;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION) { setData(c.data); fetchedAt = c.fetchedAt || 0; css = c.css || ''; }
  } catch (_) { /* no cache yet */ }
  try { tips = JSON.parse(fs.readFileSync(tipFile, 'utf8')) || {}; } catch (_) { tips = {}; }
  return data.items.length + data.aspects.length;
}

function writeCache() {
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, fetchedAt, css, data }));
  } catch (_) {}
}
function writeTips() {
  if (!tipsDirty || !tipFile) return;
  tipsDirty = false;
  try { fs.writeFileSync(tipFile, JSON.stringify(tips)); } catch (_) {}
}

/** All pages of one list ("Showing 1-50 of 395"). */
async function fetchList(net, cat, label, log) {
  const rows = [];
  for (let page = 1; page <= 30; page++) {
    const res = await net.fetch(`${BASE}/en/database/${cat}${page > 1 ? '?page=' + page : ''}`);
    if (!res.ok) throw new Error(cat + ' page ' + page + ': HTTP ' + res.status);
    const html = await res.text();
    const got = d4g.parseList(html, cat, label);
    rows.push(...got);
    const total = Number(((html.match(/Showing\s+[\d,]+\s*-\s*[\d,]+\s+of\s+([\d,]+)/i) || [])[1] || '0').replace(/,/g, ''));
    if (!got.length || (total && rows.length >= total) || (!total && got.length < 50)) break;
  }
  if (log) log('farm list', cat + ':', rows.length);
  return rows;
}

// d4guides allows about 120 tooltip requests a minute and answers 429 + Retry-After beyond
// that. Every request (background and hover) goes through this gate: ~90 a minute, and a 429
// pauses all of them for as long as the site asks.
const GAP_MS = 650;
let nextAt = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function gate() {
  const wait = nextAt - Date.now();
  nextAt = Math.max(Date.now(), nextAt) + GAP_MS;
  if (wait > 0) await sleep(wait);
}

async function fetchTip(net, type, id, tries) {
  await gate();
  const res = await net.fetch(`${BASE}/api/v1/tooltip.php?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}&lang=en`);
  if (res.status === 429 && (tries || 0) < 3) {
    const secs = Math.max(5, Math.min(120, Number(res.headers.get('retry-after')) || 45));
    nextAt = Math.max(nextAt, Date.now() + secs * 1000);
    return fetchTip(net, type, id, (tries || 0) + 1);
  }
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  const html = j && j.data && j.data.html;
  if (!html) throw new Error('no tooltip');
  return cleanHtml(html);
}

/** The tooltip for one entry – from the cache, otherwise fetched once and kept. */
async function tooltip(net, type, id) {
  const key = type + ':' + id;
  if (tips[key]) return tips[key];
  if (!/^(item|aspect)$/.test(type) || !/^\d+$/.test(String(id))) return '';
  try {
    tips[key] = await fetchTip(net, type, id);
    tipsDirty = true;
    setTimeout(writeTips, 2000);
    return tips[key];
  } catch (_) { return ''; }
}
const tooltipCss = () => css;

/**
 * Reads the aspect tooltips for slots and dungeons, one after the other through the gate –
 * about five minutes once, then everything comes from the cache. Runs in the background;
 * onProgress is called now and then so the list can update.
 */
let filling = false;
async function fillAspects(net, log, onProgress) {
  if (filling) return;
  filling = true;
  let done = 0;
  try {
    for (const a of data.aspects.filter((x) => !x.exact && x.id)) {
      try {
        const key = 'aspect:' + a.id;
        const html = tips[key] || await fetchTip(net, 'aspect', a.id);
        if (!tips[key]) { tips[key] = html; tipsDirty = true; }
        Object.assign(a, aspectDetails(html), { exact: true });
      } catch (_) { /* keeps the category guess, tried again next start */ }
      if (++done % 40 === 0) { writeCache(); writeTips(); if (onProgress) onProgress(done); }
    }
  } finally { filling = false; }
  writeCache(); writeTips();
  if (log) log('farm list: aspect details', data.aspects.filter((a) => a.exact).length + '/' + data.aspects.length);
  if (onProgress) onProgress(done);
}

async function refresh(net, force, log, onProgress) {
  const fresh = data.items.length && Date.now() - fetchedAt < MAX_AGE;
  if (!force && fresh) {
    if (data.aspects.some((a) => !a.exact)) fillAspects(net, log, onProgress).catch(() => {});
    return { count: data.items.length + data.aspects.length, updated: false };
  }
  const items = (await fetchList(net, 'items', 'Item', log)).map(toItem).filter(Boolean);
  const aspects = (await fetchList(net, 'aspects', 'Aspect', log)).map(toAspect);
  if (items.length < 100 || aspects.length < 100) throw new Error('only ' + items.length + ' items / ' + aspects.length + ' aspects');
  // keep what the tooltips already told us
  const old = new Map(data.aspects.filter((a) => a.exact).map((a) => [a.id, a]));
  for (const a of aspects) {
    const o = old.get(a.id);
    if (o) Object.assign(a, { slots: o.slots, dungeon: o.dungeon, region: o.region, exact: true });
  }
  try {
    const res = await net.fetch(TOOLTIP_CSS);
    if (res.ok) css = cleanCss(await res.text());
  } catch (_) { /* tooltips then show without their frame */ }
  setData({ items, aspects });
  fetchedAt = Date.now();
  writeCache();
  fillAspects(net, log, onProgress).catch(() => {});
  return { count: items.length + aspects.length, updated: true };
}

const count = () => data.items.length + data.aspects.length;

module.exports = {
  configure, refresh, catalog, tooltip, tooltipCss, count,
  dropIndex, aspectDetails, cleanHtml, cleanCss, shortAspect, toItem, toAspect, setData, slotOf,
  norm, SLOTS, VERSION,
};
