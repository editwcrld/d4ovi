'use strict';
// Mythic Uniques: which ones are "Iconic", and how each kind is obtained.
//
// Source: the maxroll.gg equipment page. Its "Mythic Unique Items" chapter is plain server
// rendered markup, so a fetch plus a little parsing is enough – no browser window needed.
// The item data itself already comes from lib/items.js; this module only adds the two things
// the game data does not know: the Iconic flag and the acquisition text.
const fs = require('fs');
const path = require('path');

const URL = 'https://maxroll.gg/d4/resources/equipment';
const MAX_AGE = 3 * 24 * 3600 * 1000;
const VERSION = 1;

const EMPTY = { intro: '', limit: '', iconic: { names: [], how: '', ways: [] }, normal: { how: '', ways: [] } };
let data = JSON.parse(JSON.stringify(EMPTY));
let iconicSet = new Set();
let cacheFile = null;
let fetchedAt = 0;

const { norm } = require('./text');

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&nbsp;': ' ', '&mdash;': '—', '&ndash;': '–' };
const text = (html) => String(html || '')
  .replace(/<br[^>]*>/gi, ' ')
  .replace(/<[^>]*>/g, '')
  .replace(/&#x?[0-9a-f]+;/gi, (e) => {
    const m = e.match(/&#(x?)([0-9a-f]+);/i);
    return String.fromCharCode(parseInt(m[2], m[1] ? 16 : 10));
  })
  .replace(/&[a-z]+;/gi, (e) => ENT[e.toLowerCase()] || ' ')
  .replace(/\s+/g, ' ')
  .trim();

// Sentences that talk about the web page instead of the game.
const META_RE = /following list|list below|see below|as of season/i;
// … and the ones that actually say how an item is obtained.
const ACQ_RE = /\b(found|find|drop|drops|craft|crafted|acquired|acquire|loot|looted|salvag|cost|costs|upgrad|gamble|obtain|recipe|equip)/i;
const sentences = (s) => String(s || '').split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);
function keep(s) {
  const all = sentences(s).filter((x) => !META_RE.test(x));
  const useful = all.filter((x) => ACQ_RE.test(x));
  return (useful.length ? useful : all).join(' ');
}

/**
 * Reads the "Mythic Unique Items" chapter.
 * Careful: the chapter title also appears in the table of contents, so the real heading is
 * found through its <h2> markup, not through indexOf on the text.
 */
function parse(html) {
  const h2 = [...String(html).matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)];
  const from = h2.findIndex((m) => /mythic unique items/i.test(text(m[1])));
  if (from < 0) throw new Error('"Mythic Unique Items" heading not found');
  const next = h2[from + 1];
  const section = html.slice(h2[from].index, next ? next.index : html.length);

  const out = JSON.parse(JSON.stringify(EMPTY));
  let bucket = null;                                  // null = chapter intro, else iconic|normal
  for (const m of section.matchAll(/<(h3|p|ul)[^>]*>([\s\S]*?)<\/\1>/g)) {
    const tag = m[1], inner = m[2], t = text(inner);
    if (tag === 'h3') {
      bucket = /iconic/i.test(t) ? 'iconic' : /normal/i.test(t) ? 'normal' : null;
      continue;
    }
    if (tag === 'p') {
      if (!t) continue;
      if (!bucket) { out.intro = out.intro ? out.intro + ' ' + t : t; continue; }
      const s = keep(t);
      if (s) out[bucket].how = out[bucket].how ? out[bucket].how + ' ' + s : s;
      continue;
    }
    // <ul>: either a list of item names (one chip per entry) or a list of acquisition ways
    for (const li of inner.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const line = text(li[1]);
      if (!line) continue;
      const chip = text((li[1].match(/class="[^"]*d4-item[^"]*"[^>]*>([\s\S]*?)<\/span>/) || [])[1] || '');
      const isName = chip && norm(chip) === norm(line);
      if (isName && bucket === 'iconic') out.iconic.names.push(line);
      else if (bucket) out[bucket].ways.push(line);
    }
  }
  if (out.iconic.names.length < 5) throw new Error('Only ' + out.iconic.names.length + ' iconic mythics found');
  out.iconic.names = [...new Set(out.iconic.names)];
  // The rule that applies to every mythic: only one self crafted one can be worn.
  out.limit = sentences(out.intro).filter((x) => /equip/i.test(x)).join(' ');
  return out;
}

function setData(d) {
  data = d && d.iconic ? d : JSON.parse(JSON.stringify(EMPTY));
  iconicSet = new Set((data.iconic.names || []).map(norm));
  return iconicSet.size;
}

function configure(opts) {
  if (opts && opts.cacheFile) cacheFile = opts.cacheFile;
  try {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.version === VERSION && c.data) { setData(c.data); fetchedAt = c.fetchedAt || 0; }
  } catch (_) { /* no cache yet */ }
  return iconicSet.size;
}

async function refresh(net, force, log) {
  if (!force && iconicSet.size && Date.now() - fetchedAt < MAX_AGE) return { count: iconicSet.size, updated: false };
  const res = await net.fetch(URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const count = setData(parse(await res.text()));
  fetchedAt = Date.now();
  try {
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: VERSION, fetchedAt, data }));
  } catch (_) {}
  if (log) log('iconic mythics loaded:', count);
  return { count, updated: true };
}

const isIconic = (name) => iconicSet.has(norm(name));

/**
 * What an item of this rarity needs to drop or be crafted.
 * @returns {null|{iconic: boolean, label: string, obtain: string, note: string}} null = not a mythic unique
 */
function info(name, rarity) {
  const mythic = /mythic/i.test(rarity || '') || isIconic(name);
  if (!mythic) return null;
  const ic = isIconic(name);
  const part = ic ? data.iconic : data.normal;
  // Lead sentence + the bullet list: that is the whole "how do I get it" without page chatter.
  const obtain = [sentences(part.how)[0] || '', (part.ways || []).join(' · ')].filter(Boolean).join(' ');
  if (!obtain) return null;
  return { iconic: ic, label: ic ? 'Iconic Mythic Unique' : 'Mythic Unique', obtain, note: data.limit || '' };
}

const all = () => JSON.parse(JSON.stringify(data));
const names = () => (data.iconic.names || []).slice();
const count = () => iconicSet.size;
const age = () => fetchedAt;

module.exports = { configure, refresh, parse, setData, info, isIconic, all, names, count, age, norm, URL, VERSION };
