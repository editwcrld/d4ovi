'use strict';
// Activities: maxroll.gg guides about events and endgame content.
// For each page we keep the title, the short description and the chapter headings – enough
// to search them and to know what is inside. The full guide opens inside the overlay.
const fs = require('fs');
const path = require('path');

const BASE = 'https://maxroll.gg/d4/';
const MAX_AGE = 3 * 24 * 3600 * 1000;
const VERSION = 1;

// order = order shown in the overlay
const PAGES = [
  ['resources/secret-cow-level', 'Secret Cow Level', '🐄'],
  ['resources/dark-citadel', 'Dark Citadel', '🏰'],
  ['resources/tower-guide', "Artificer's Tower", '🗼'],
  ['resources/echoing-hatred', 'Echoing Hatred', '👁'],
  ['resources/gathering-legions-zone-event-guide', 'Gathering Legions', '⚔'],
  ['getting-started/world-events', 'World Events & Overworld', '🌍'],
];

// chapters that say nothing about the content
const SKIP_SECTION = /^(summary|credits|changelog|video guide|related posts|follow us)/i;

let list = [];
let cacheFile = null;
let fetchedAt = 0;

const { norm } = require('./text');

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#x27;': "'", '&apos;': "'", '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–' };
const text = (html) => String(html || '')
  .replace(/<[^>]*>/g, '')
  .replace(/&#x?[0-9a-f]+;/gi, (e) => {
    const m = e.match(/&#(x?)([0-9a-f]+);/i);
    return String.fromCharCode(parseInt(m[2], m[1] ? 16 : 10));
  })
  .replace(/&[a-z]+;/gi, (e) => ENT[e.toLowerCase()] || ' ')
  .replace(/\s+/g, ' ')
  .trim();

function parse(html, slug, name, icon) {
  const desc = text((html.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '');
  const h1 = text((html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/) || [])[1] || '');
  const sections = [...html.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)]
    .map((m) => text(m[1]))
    .filter((t) => t && t.length < 60 && !SKIP_SECTION.test(t));
  const title = name || h1 || slug;
  return {
    slug, name: title, n: norm(title + ' ' + desc + ' ' + sections.join(' ')),
    icon, url: BASE + slug, desc, sections: [...new Set(sections)].slice(0, 10),
  };
}

function setList(l) { list = Array.isArray(l) ? l : []; return list.length; }

function configure(opts) {
  if (opts && opts.cacheFile) cacheFile = opts.cacheFile;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION && Array.isArray(c.list)) { setList(c.list); fetchedAt = c.fetchedAt || 0; }
  } catch (_) { /* no cache yet */ }
  return list.length;
}

async function refresh(net, force, log) {
  if (!force && list.length && Date.now() - fetchedAt < MAX_AGE) return { count: list.length, updated: false };
  const out = [];
  for (const [slug, name, icon] of PAGES) {
    try {
      const res = await net.fetch(BASE + slug);
      if (!res.ok) { if (log) log('activity', slug, 'HTTP ' + res.status); continue; }
      out.push(parse(await res.text(), slug, name, icon));
    } catch (e) { if (log) log('activity', slug, 'error: ' + e.message); }
  }
  if (!out.length) throw new Error('No activities loaded');
  const count = setList(out);
  fetchedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, fetchedAt, list }));
  } catch (_) {}
  if (log) log('activities loaded:', count);
  return { count, updated: true };
}

/** Searches name, description and chapters ("cow", "zagraal", "leaderboard" …). */
function search(query) {
  const q = norm(query);
  if (!q) return list.slice();
  const tokens = q.split(' ');
  return list.filter((a) => tokens.every((t) => a.n.includes(t)));
}

const all = () => list.slice();
const count = () => list.length;
const age = () => fetchedAt;

module.exports = { configure, refresh, search, all, count, age, parse, setList, PAGES, VERSION };
