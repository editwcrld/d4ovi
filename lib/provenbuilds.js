'use strict';
// Proven builds for a skill – the ones players already rely on, from three places:
//
//   maxroll.gg      the endgame tier list (S / A / B …), read by lib/builder.js
//   d2core.com      the planner's "hot" list per class (likes), via its cloud function
//                   "function-planner-queryplanlist" – the same call its build list makes;
//                   every build lists the skills on its bar by the game's keys
//   infinitybuilds  the build list page: a Next.js stream with the 100 most liked builds
//                   (title, class, author, likes, activity, season)
//
// Every one of them opens with the overlay's own importers (lib/buildimport.js); lib/builder.js
// then works out with the damage model why the build works.
const d2core = require('./d2core');
const guideinfo = require('./guideinfo');
const zh = require('./zhdict');

const MAX_AGE = 24 * 3600 * 1000;
const IB_LIST = 'https://infinitybuilds.gg/en/builds';
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];

const cache = new Map();     // key -> { at, value }
async function cached(key, fn) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < MAX_AGE) return c.value;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  return value;
}

/** d2core's hottest builds of a class this season; each with the skill keys on its bar. */
async function d2coreList(net, cls, season) {
  return cached('d2:' + cls + ':' + season, async () => {
    const r = await d2core.callFunction(net, 'function-planner-queryplanlist', {
      pageIndex: 1, pageSize: 100, condition: { game: 'd4', season, char: cls },
      orderBy: ['rawScore', 'desc', '_createTime', 'desc'], enableVariant: true,
    });
    // skills come as "rogue_rain_of_arrows" – kept as bare letters ("rainofarrows") from every variant's bar
    const bare = (k) => String(k || '').toLowerCase().replace(/^[a-z]+_/, '').replace(/[^a-z]/g, '');
    return ((r && r.data) || []).map((b) => ({
      site: 'd2core.com', id: b._id, url: 'https://www.d2core.com/d4/planner?bd=' + b._id, cls: b.char,
      title: String(b.title || ''), likes: Number(b.likeCount) || 0, scene: b.scene || [],
      skills: [...new Set([].concat(b.equipSkills || [], ...(b.variants || []).map((v) => v.equipSkills || [])).map((s) => bare(s && s.key)).filter(Boolean))],
    }));
  });
}

/** The builds of infinitybuilds' list page, out of its React Server Components stream. */
function parseInfinityList(html) {
  const s = String(html || '');
  // the stream is pushed as JSON strings: self.__next_f.push([1,"…"])
  const parts = [];
  const re = /self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g;
  let m;
  while ((m = re.exec(s))) { try { parts.push(JSON.parse('"' + m[1] + '"')); } catch (_) { /* a broken chunk – skip */ } }
  const text = parts.join('');
  const at = text.indexOf('"builds":[');
  if (at < 0) return [];
  // the array ends where its brackets balance
  let depth = 0, end = -1;
  for (let i = at + 9; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') { i++; while (i < text.length && text[i] !== '"') { if (text[i] === '\\') i++; i++; } continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') { depth--; if (!depth) { end = i; break; } }
  }
  if (end < 0) return [];
  let list = [];
  try { list = JSON.parse(text.slice(at + 9, end + 1)); } catch (_) { return []; }
  return list.filter((b) => b && b.slug).map((b) => ({
    site: 'infinitybuilds.gg', id: b.id, url: 'https://infinitybuilds.gg/en/builds/' + b.slug,
    cls: CLASSES.find((c) => c.toLowerCase() === String(b.classId || '').toLowerCase()) || '',
    title: String(b.title || '').trim(), author: b.authorName || '', likes: Number(b.likeCount) || 0,
    activity: b.activity || [], season: b.season || 0, featured: !!b.isFeatured,
  }));
}

async function infinityList(net) {
  return cached('ib', async () => {
    const res = await net.fetch(IB_LIST);
    if (!res.ok) throw new Error('infinitybuilds: HTTP ' + res.status);
    return parseInfinityList(await res.text());
  });
}

const words = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/**
 * The proven builds for one skill, best first: maxroll by tier, then by the players' votes (likes).
 * @param tiers  maxroll's tier list (lib/builder.js)
 * @param max    how many (default 8)
 */
async function forSkill(net, { cls, skillKey, skillName, tiers, season, log, max }) {
  const name = words(skillName);
  const out = [];
  for (const t of tiers || []) {
    if (t.cls === cls && words(t.name).includes(name)) out.push({ site: 'maxroll.gg', url: t.url, title: t.name, tier: t.tier, cls });
  }
  try {
    const d2 = await d2coreList(net, cls, season || 15);
    const bareName = String(skillName).toLowerCase().replace(/[^a-z]/g, '');
    const bareKey = String(skillKey).toLowerCase().replace(/^[a-z]+_/, '').replace(/[^a-z]/g, '');
    for (const b of d2) {
      if (!b.skills.includes(bareName) && !b.skills.includes(bareKey)) continue;
      if (b.likes < 10) continue;
      // the title is Chinese – the glossary turns game words and build jargon into English
      let title = b.title;
      try { title = zh.translate ? zh.translate(b.title) : b.title; } catch (_) { /* keep it */ }
      out.push(Object.assign({}, b, { title, original: b.title }));
    }
  } catch (e) { if (log) log('proven builds: d2core failed:', e.message); }
  try {
    const ib = await infinityList(net);
    // this season's, liked by more than a handful, no copies of someone else's
    for (const b of ib) {
      if (b.cls !== cls || !words(b.title + ' ' + b.url.split('/').pop().replace(/-/g, ' ')).includes(name)) continue;
      if ((season && b.season && b.season < season) || /\(copy\)/i.test(b.title) || (b.likes < 5 && !b.featured)) continue;
      out.push(b);
    }
  } catch (e) { if (log) log('proven builds: infinitybuilds failed:', e.message); }
  // the guides d4builder read for this skill (lib/guideinfo.js) – d4builds' among them, which has no list to ask
  const SITE = { maxroll: 'maxroll.gg', d4builds: 'd4builds.gg', infinitybuilds: 'infinitybuilds.gg', d2core: 'd2core.com' };
  const have = new Set(out.map((b) => (guideinfo.recipeOf(b.url) || {}).id).filter(Boolean));
  for (const s of guideinfo.sheetsForSkill(cls, skillName)) {
    if (have.has(s.id) || !s.url || out.some((b) => guideinfo.baseOf(b.url) === guideinfo.baseOf(s.url))) continue;
    let title = s.title || s.skill + ' ' + cls;
    if (s.site === 'd2core') { try { title = zh.translate ? zh.translate(s.title) || title : title; } catch (_) { /* keep it */ } }
    out.push({ site: SITE[s.site] || s.site, url: s.url, title, original: s.site === 'd2core' ? s.title : '', author: s.author || '', cls, likes: 0, recipe: true });
  }
  const rank = (b) => (b.tier ? 'SABCD'.indexOf(b.tier) * -1000 + 5000 : 0) + (b.likes || 0) + (b.recipe ? 50 : 0);
  out.sort((a, b) => rank(b) - rank(a));
  // the first few: one from each site in turn, so the top of the list is not three d2core builds –
  // after that by votes
  const bySite = new Map();
  for (const b of out) { if (!bySite.has(b.site)) bySite.set(b.site, []); bySite.get(b.site).push(b); }
  const mixed = [];
  for (const l of bySite.values()) if (l.length) mixed.push(l.shift());
  mixed.sort((a, b) => rank(b) - rank(a));
  mixed.push(...[...bySite.values()].flat().sort((a, b) => rank(b) - rank(a)));
  // a d2core title is often Chinese: the author in brackets is kept apart
  for (const b of mixed) if (b.site === 'd2core.com' && !b.author) { const m = /[【[]([^】\]]{1,20})[】\]]/.exec(b.original || b.title); if (m) b.author = m[1]; }
  return mixed.slice(0, max || 8);
}

/**
 * What the proven builds of a skill agree on – the way players learn a build: which unique or
 * aspect sits on which slot in how many of them, which skills and modifiers, which sockets
 * (soul splinters, gems, runes), charm sets, paragon boards and glyphs.
 * @param load  (url) => imported build ({ variants, preselect }) – lib/buildimport.js
 */
async function consensus(list, load, log) {
  // four at a time – one after the other, sixteen builds take as long as their sites together
  const got = new Array(list.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++, b = list[i];
      try {
        const r = await load(b.url);
        const pick = r && r.variants && r.variants[r.preselect || 0] ? r.preselect || 0 : 0;
        const v = (r && r.variants && r.variants[pick]) || null;
        // every variant (starter, endgame, pit push …) stays – the counting below takes the one the site opens on
        if (v) got[i] = { src: b, v, all: r.variants, pick };
      } catch (e) { if (log) log('consensus: could not load', b.url, e.message); }
    }
  };
  await Promise.all([0, 1, 2, 3].map(worker));
  const builds = got.filter(Boolean);
  const n = builds.length;
  const count = (map, key, who) => { if (!key) return; const e = map.get(key) || { name: key, n: 0, by: [] }; e.n++; if (who) e.by.push(who); map.set(key, e); };
  const slots = {};          // slot kind -> Map(name -> {n})
  const pieces = new Map();  // any slot
  const sockets = new Map(), skills = new Map(), mods = new Map(), sets = new Map(), boards = new Map(), glyphs = new Map();
  const kindOf = (s) => (/^Ring/.test(s) ? 'Ring' : /^Weapon/.test(s) ? 'Weapon' : s);
  for (const { src, v } of builds) {
    const who = src.author || src.site;
    const seenHere = new Set();
    for (const [slot, x] of Object.entries(v.slots || {})) {
      const k = kindOf(slot);
      const names = x.item ? [x.item].concat(x.tf ? [x.tf] : []) : x.aspects || [];
      for (const nm of names) {
        if (!slots[k]) slots[k] = new Map();
        count(slots[k], nm, who);
        if (!seenHere.has(nm)) { count(pieces, nm, who); seenHere.add(nm); }
      }
      for (const so of x.sockets || []) count(sockets, so);
    }
    for (const s of (v.skills && v.skills.bar) || []) {
      count(skills, s.name);
      for (const m of s.mods || []) count(mods, s.name + ' · ' + m);
    }
    for (const s of (v.charms && v.charms.sets) || []) count(sets, s.name);
    for (const b of (v.paragon && v.paragon.boards) || []) { count(boards, b.k); if (b.glyph) count(glyphs, b.glyph); }
  }
  const top = (map) => [...map.values()].sort((a, b) => b.n - a.n).map((e) => ({ name: e.name, n: e.n, of: n, by: e.by.slice(0, 6) }));
  return {
    n, builds: builds.map((b) => Object.assign({}, b.src, { variant: b.v.name })),
    slots: Object.fromEntries(Object.entries(slots).map(([k, m]) => [k, top(m)])),
    pieces: top(pieces), sockets: top(sockets), skills: top(skills), mods: top(mods), sets: top(sets), boards: top(boards), glyphs: top(glyphs),
    raw: builds,
  };
}

module.exports = { forSkill, consensus, d2coreList, infinityList, parseInfinityList };
