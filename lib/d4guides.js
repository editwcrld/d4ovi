'use strict';
// The d4guides.gg database.
//  - The search runs on the site's own endpoint (/api/v1/db-search.php) and so covers EVERY
//    category in full: items, aspects, gems, runes, skills, talismans / seals,
//    dungeon keys, season powers, materials, glyphs, paragon, affixes, mercenaries …
//  - The list pages of the small categories are saved once on top; they bring
//    extra columns (e.g. "Charm slots", "Effect") that the search shows as well.
//  - The full tooltip with frame and pictures is on the detail page, which the overlay opens.
const fs = require('fs');
const path = require('path');

const BASE = 'https://d4guides.gg';
const SEARCH_URL = BASE + '/api/v1/db-search.php?q=';
const MAX_AGE = 3 * 24 * 3600 * 1000;
const VERSION = 3;

// the endpoint's group keys -> path part and display name
const GROUPS = {
  items: ['items', 'Item'], skills: ['skills', 'Skill'], aspects: ['aspects', 'Aspect'],
  paragon_boards: ['paragon-boards', 'Paragon board'], glyphs: ['glyphs', 'Glyph'],
  runes: ['runes', 'Rune'], gems: ['gems', 'Gem'], temper: ['temper', 'Tempering'],
  affixes: ['affixes', 'Affix'], mercenaries: ['mercenaries', 'Mercenary'], classes: ['classes', 'Class'],
  talismans: ['talismans', 'Talisman'], season_powers: ['season-powers', 'Season power'],
  dungeon_keys: ['dungeon-keys', 'Dungeon key'], crafting_materials: ['crafting-materials', 'Material'],
  fishing: ['fishing', 'Fish'], horadric_cube: ['horadric-cube', 'Horadric cube'],
};
// these list pages deliver their whole table (no limit of 50) -> take the extra columns along
const DETAIL_LISTS = [
  ['talismans', 'Talisman', 'table'],
  ['dungeon-keys', 'Dungeon key', 'table'],
  ['crafting-materials', 'Material', 'table'],
  ['horadric-cube/runewords', 'Runeword', 'groups'],   // the complete runeword list
];

let extra = [];            // extra columns from the list pages
let byNorm = new Map();
let cacheFile = null;
let fetchedAt = 0;

const { norm } = require('./text');

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ', '&times;': '×', '&mdash;': '—', '&ndash;': '–' };
const text = (html) => String(html || '')
  .replace(/<br\s*\/?>/gi, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
  .replace(/&[a-z]+;/gi, (e) => ENT[e.toLowerCase()] || ' ')
  .replace(/\s+/g, ' ')
  .trim();

const abs = (u) => (!u ? '' : /^https?:/i.test(u) ? u : BASE + (u.startsWith('/') ? '' : '/') + u);
const titleCase = (s) => String(s || '').replace(/_/g, ' ').replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** Takes a list page apart: per table row the name, link, icon and the other columns. */
function parseList(html, cat, catLabel) {
  const out = [];
  for (const tm of String(html).matchAll(/<table[^>]*class="[^"]*db-table[^"]*"[^>]*>([\s\S]*?)<\/table>/g)) {
    const table = tm[1];
    const cols = [...table.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((m) => text(m[1]));
    const before = String(html).slice(0, tm.index);
    const hm = [...before.matchAll(/<h2[^>]*class="[^"]*db-section__title[^"]*"[^>]*>([\s\S]*?)<\/h2>/g)].pop();
    const section = hm ? text(hm[1]) : '';

    for (const rm of table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
      const row = rm[1];
      if (/<th[\s>]/.test(row)) continue;
      const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((m) => m[1]);
      if (!cells.length) continue;
      const link = (cells[0].match(/href="([^"]+)"/) || [])[1] || '';
      const name = text((cells[0].match(/class="db-table__name"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || cells[0]);
      if (!name || name.length > 70) continue;
      const icon = (cells[0].match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
      // data-item-id / data-aspect-id: the key the tooltip endpoint wants
      const id = (cells[0].match(/data-[a-z]+-id="(\d+)"/) || [])[1] || '';
      const fields = [];
      for (let i = 1; i < cells.length; i++) {
        const v = text(cells[i]);
        if (v) fields.push({ label: cols[i] || '', value: v });
      }
      out.push({ name, n: norm(name), cat, catLabel, section, url: abs(link), icon: abs(icon), fields, id });
    }
  }
  return out;
}

/**
 * Second page layout: cards instead of table rows (runewords, horadric cube).
 *   <a class="hc2-db__group" href="…"><img …><span class="hc2-db__group-name">Enigma</span>
 *   <span class="hc2-db__group-meta">2 recipes</span></a>
 */
function parseGroups(html, cat, catLabel, section) {
  const out = [];
  for (const m of String(html).matchAll(/<a[^>]*class="[^"]*hc2-db__group[^"]*"[^>]*>([\s\S]*?)<\/a>/g)) {
    const block = m[0];
    const link = (block.match(/href="([^"]+)"/) || [])[1] || '';
    const name = text((block.match(/class="gt"[^>]*>([\s\S]*?)<\/span>/) || [])[1]
      || (block.match(/class="[^"]*hc2-db__group-name[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    if (!name || name.length > 70) continue;
    const icon = (block.match(/<img[^>]+src="([^"]+)"/) || [])[1] || '';
    const meta = text((block.match(/class="[^"]*hc2-db__group-meta[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
    out.push({
      name, n: norm(name), cat, catLabel, section: section || '',
      url: abs(link), icon: abs(icon), fields: meta ? [{ label: 'Recipes', value: meta }] : [],
    });
  }
  return out;
}

function setExtra(l) {
  extra = Array.isArray(l) ? l : [];
  byNorm = new Map();
  for (const e of extra) if (!byNorm.has(e.n)) byNorm.set(e.n, e);
  return extra.length;
}

function configure(opts) {
  if (opts && opts.cacheFile) cacheFile = opts.cacheFile;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION && Array.isArray(c.list)) { setExtra(c.list); fetchedAt = c.fetchedAt || 0; }
  } catch (_) { /* no cache yet */ }
  return extra.length;
}

async function refresh(net, force, log) {
  if (!force && extra.length && Date.now() - fetchedAt < MAX_AGE) return { count: extra.length, updated: false };
  const all = [];
  for (const [cat, label, how] of DETAIL_LISTS) {
    try {
      const res = await net.fetch(`${BASE}/en/database/${cat}`);
      if (!res.ok) { if (log) log('d4guides', cat, 'HTTP ' + res.status); continue; }
      const body = await res.text();
      const rows = how === 'groups' ? parseGroups(body, cat, label, label) : parseList(body, cat, label);
      if (log) log('d4guides', cat + ':', rows.length);
      all.push(...rows);
    } catch (e) { if (log) log('d4guides', cat, 'error: ' + e.message); }
  }
  if (!all.length) throw new Error('No extra columns found');
  const count = setExtra(all);
  fetchedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, fetchedAt, list: extra }));
  } catch (_) {}
  return { count, updated: true };
}

/**
 * Searches d4guides' endpoint (every category, always current).
 * @param {{fetch:Function}} net Electrons net-Modul
 * @param {string} query Suchtext (mind. 2 Zeichen)
 * @param {string} lang 'en' | 'de' – picks the address of the detail page
 */
async function searchLive(net, query, lang) {
  const q = String(query || '').trim();
  if (q.length < 2) return [];
  const l = lang === 'de' ? 'de' : 'en';
  let j;
  try {
    const res = await net.fetch(SEARCH_URL + encodeURIComponent(q));
    if (!res.ok) return [];
    j = await res.json();
  } catch (_) { return []; }
  if (!j || !j.success || !j.data || !Array.isArray(j.data.groups)) return [];

  const out = [];
  for (const g of j.data.groups) {
    const [base, label] = GROUPS[g.key] || [String(g.key).replace(/_/g, '-'), titleCase(g.key)];
    for (const it of g.items || []) {
      if (!it || !it.name) continue;
      const slug = (l === 'de' && it.slug_de) || it.slug;
      const ex = byNorm.get(norm(it.name));
      out.push({
        name: it.name,
        n: norm(it.name),
        cat: g.key,
        catLabel: label + (it.kind && it.kind !== g.key ? ' · ' + titleCase(it.kind) : ''),
        rarity: titleCase(it.rarity || ''),
        icon: abs(it.icon_path || (ex && ex.icon) || ''),
        url: slug ? `${BASE}/${l}/database/${base}/${slug}` : `${BASE}/${l}/database/${base}`,
        fields: ex ? ex.fields : [],
      });
    }
  }
  return out;
}

const get = (name) => byNorm.get(norm(name)) || null;
const count = () => extra.length;
const age = () => fetchedAt;

/** All cached entries of one category label, e.g. byLabel('Runeword'). */
const byLabel = (label) => extra.filter((e) => e.catLabel === label);

/** Every cached entry – for the pictures by name (lib/icons.js). */
const all = () => extra;

module.exports = { configure, refresh, searchLive, get, all, count, age, norm, parseList, parseGroups, byLabel, setExtra, GROUPS, BASE, VERSION };
