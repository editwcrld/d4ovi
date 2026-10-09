'use strict';
// Builds from d2core.com (暗黑核, a Chinese Diablo site).
//
//   link     www.d2core.com/d4/planner?bd=23TM
//   data     the planner is a Tencent CloudBase app; a build comes from its cloud function
//            "function-planner-queryplandetail" ({bd, enableVariant}). Reading it needs no
//            account – the site's own web SDK signs in anonymously, and so does this module.
//
// The gear carries the game's own ids ("Helm_Unique_Generic_005", "Affix_legendary_rogue_153_x2"),
// the same ids maxroll's game data uses, so names come from there in English and need no
// translating. Only what players wrote – the build title and the variant names – is Chinese;
// that goes through lib/zhdict.js.
const crypto = require('crypto');
const mb = require('./maxbuild');
const zh = require('./zhdict');
const { fitter, buildName } = require('./buildfit');
const d2db = require('./d2coredb');

const ENV = 'diablocore-4gkv4qjs9c6a0b40';
const API = 'https://tcb-api.tencentcloudapi.com/web?env=' + ENV;
// the site's public app key (it is in its web bundle; CloudBase wants every web request signed with it)
const APP = { sign: 'diablocore', keyId: 1, key: 'ed6fe96e6ca08acf392d360094a58477' };
const TOKEN_TTL = 20 * 60 * 1000;

// d2core item types -> our slots; one-handed weapons may go into the off-hand
const SLOT = { Helm: 'Helm', ChestArmor: 'Chest Armor', Gloves: 'Gloves', Legs: 'Pants', Pants: 'Pants', Boots: 'Boots',
  Amulet: 'Amulet', Ring: 'Ring', Shield: 'Off-Hand', Focus: 'Off-Hand', DruidOffhand: 'Off-Hand', OffHand: 'Off-Hand' };
const ONE_HAND = ['Sword', 'Axe', 'Mace', 'Dagger', 'Wand', 'Scythe'];
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Paladin', 'Rogue', 'Sorcerer', 'Spiritborn', 'Warlock'];

/** "Axe2H" -> "Two-Handed Axe", "Bow" -> "Bow". */
function weaponKind(type) {
  const t = String(type || '');
  const two = /2H/i.test(t);
  const base = t.replace(/[_-]?(1H|2H)[_-]?/ig, '').replace(/([a-z])([A-Z])/g, '$1 $2').trim();
  return (two && !/bow|staff|polearm|glaive|quarterstaff/i.test(base) ? 'Two-Handed ' : '') + base;
}

/** The build code from a d2core.com planner link (or the bare code). */
function parseUrl(input) {
  const t = String(input || '').trim();
  const m = t.match(/d2core\.com\/d4\/planner\/?\?(?:[^#]*&)?bd=([A-Za-z0-9]{2,16})/i);
  return m ? { bd: m[1] } : null;
}

// ---- CloudBase ---------------------------------------------------------------------
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** The X-TCB-App-Source header: a small HS256 token over the app key, as the web SDK makes it. */
function appSource(now) {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ data: {}, timestamp: now, appAccessKeyId: APP.keyId, appSign: APP.sign }));
  const sig = b64u(crypto.createHmac('sha256', APP.key).update(head + '.' + body).digest());
  return `timestamp=${now};appAccessKeyId=${APP.keyId};appSign=${APP.sign};sign=${head}.${body}.${sig}`;
}

async function send(net, action, data) {
  const res = await net.fetch(API, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-TCB-App-Source': appSource(Date.now()), 'X-SDK-Version': '@cloudbase/js-sdk/1.7.2' },
    body: JSON.stringify(Object.assign({ action, dataVersion: '2020-01-10', env: ENV }, data)),
  });
  if (!res.ok) throw new Error('d2core.com: HTTP ' + res.status);
  const j = await res.json();
  if (j && j.code) throw Object.assign(new Error('d2core.com: ' + (j.message || j.code)), { code: j.code });
  return j;
}

let token = null;           // { value, until }

async function accessToken(net) {
  if (token && token.until > Date.now()) return token.value;
  const a = await send(net, 'auth.signInAnonymously', {});
  if (!a.refresh_token) throw new Error('d2core.com: anonymous sign-in refused');
  const b = await send(net, 'auth.fetchAccessTokenWithRefreshToken', { refresh_token: a.refresh_token, anonymous_uuid: a.uuid });
  if (!b.access_token) throw new Error('d2core.com: no access token');
  token = { value: b.access_token, until: Date.now() + TOKEN_TTL };
  return token.value;
}

async function callFunction(net, name, params, again) {
  try {
    const r = await send(net, 'functions.invokeFunction', {
      function_name: name, request_data: JSON.stringify(params), access_token: await accessToken(net),
    });
    const out = r && r.data && r.data.response_data;
    return typeof out === 'string' ? JSON.parse(out) : out;
  } catch (e) {
    if (again || !/TOKEN|AUTH/i.test(String(e.code || e.message))) throw e;
    token = null;                                   // expired – sign in once more
    return callFunction(net, name, params, true);
  }
}

// ---- build -----------------------------------------------------------------------------
/**
 * One d2core variant -> a farm list build.
 * @param {object} v        variant ({name, gear: {slotNo: piece}})
 * @param {object} catalog  farm.catalog()
 * @param {object} names    maxbuild.gameNames(): { items: {id: name}, aspects: {id: name} }
 */
function toBuild(v, catalog, names, title, cls, db) {
  const fit = fitter(catalog);
  const extras = (g) => itemExtras(g, db);
  const gear = (v && v.gear) || {};
  const aspectName = (key) => {
    const id = String(key || '').replace(/^Affix_/, '');
    return names.aspects[id] || names.aspects[id.replace(/_x2$/, '')] || '';
  };
  for (const no of Object.keys(gear).map(Number).sort((a, b) => a - b)) {
    const g = gear[no];
    if (!g || !g.key) continue;
    const type = String(g.itemType || '');
    const slot = SLOT[type] || (type ? 'Weapon' : '');
    let entry = null;
    if (g.type === 'uniqueItem') {
      const en = names.items[g.key] || '';
      const item = en && fit.item(en);
      if (item) entry = Object.assign({ item }, extras(g)); else { fit.missing(en || g.key); continue; }
    } else if (g.type === 'legendary') {
      const en = aspectName(g.key);
      const a = en && fit.aspect(en);
      if (!a) { fit.missing(en || g.key); continue; }
      entry = Object.assign({ aspects: [a] }, extras(g));
      // the transfigured aspect is the second one on the same item (on the amulet, mostly)
      const a2 = g.transfiguredAspect && fit.aspect(aspectName(g.transfiguredAspect));
      if (a2 && a2 !== a) entry.aspects.push(a2);
    } else continue;                                 // rares, empty slots
    if (slot === 'Weapon') entry.base = weaponKind(type);
    fit.put(slot, entry, ONE_HAND.includes(type));
  }
  return Object.assign({ name: buildName(title, v.name), cls }, fit.result(), {
    skills: skillsOf(v, db), paragon: paragonOf(v),
    charms: d2db.charmsOf(db, (Array.isArray(v && v.charms) ? v.charms : []).filter((c) => c && c.key).map((c) => ({ key: c.key, mods: c.mods }))),
  });
}

/** The rolled stats of one piece ("+10.0% Attack Speed", greater / tempered) and its sockets. */
function itemExtras(g, db) {
  if (!db) return {};
  const stats = (Array.isArray(g.mods) ? g.mods : []).map((m) => {
    const tpl = m && db.affix[m.name];
    if (!tpl) return null;
    return Object.assign({ t: d2db.statText(tpl, m.value) }, m.greater ? { g: 1 } : {}, /^Tempered_/i.test(m.name) ? { tmp: 1 } : {});
  }).filter(Boolean);
  const sockets = (Array.isArray(g.sockets) ? g.sockets : []).map((x) => x && db.socket[x.key]).filter(Boolean);
  return Object.assign({}, stats.length ? { stats } : {}, sockets.length ? { sockets } : {});
}

/** The skill bar and every rank spent in the tree ("skillId": rank, "skillId_modId": 1). */
function skillsOf(v, db) {
  const ranks = {};
  for (const [k, r] of Object.entries((v && v.skill) || {})) if (Number(r) > 0) ranks[k] = Number(r);
  const byIcon = new Map();
  if (db) for (const [id, s] of Object.entries(db.skills)) if (s.icon) byIcon.set(s.icon, Object.assign({ id: Number(id) }, s));
  const bar = (Array.isArray(v && v.equipSkills) ? v.equipSkills : []).filter((x) => x && x.key).map((x) => {
    const s = byIcon.get(x.icon);
    const name = s ? s.name : String(x.key).replace(/^[a-z]+_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    return { name, id: s ? s.id : 0, rank: Number(x.rank) || 0, icon: x.icon || 0, mods: (x.mods || []).slice(0, 4) };
  });
  return bar.length || Object.keys(ranks).length ? { bar, ranks } : null;
}

/** The paragon boards: which board, where, turned how far, the glyph, and the nodes taken. */
function paragonOf(v) {
  const boards = Object.entries((v && v.paragon) || {})
    .filter(([, b]) => b && !b.deleted && Array.isArray(b.data))
    .sort((a, b) => (a[1].index || 0) - (b[1].index || 0))
    .map(([k, b]) => ({
      k, x: Number(b.x) || 0, y: Number(b.y) || 0, rot: ((Number(b.rotate) || 0) % 4 + 4) % 4,
      glyph: Object.values(b.glyph || {})[0] || '', glyphRank: Number(Object.values(b.glyphRank || {})[0]) || 0,
      nodes: b.data.map((s) => String(s).split('_').slice(0, 2).map(Number)).filter((n) => n.every(Number.isFinite)),
    }));
  return boards.length ? { boards } : null;
}

/**
 * Reads a d2core.com planner link.
 * @returns {Promise<{title, original, cls, variants: Array, preselect: number}>}
 */
async function load(net, input, catalog, log) {
  const src = parseUrl(input);
  if (!src) throw new Error('Not a d2core.com planner link');
  const [r, names, dict, db] = await Promise.all([
    callFunction(net, 'function-planner-queryplandetail', { bd: src.bd, enableVariant: true }),
    mb.gameNames(net, log),
    zh.load(net, log),
    d2db.load(net, log).catch(() => null),            // without it the gear still comes in, only bare
  ]);
  const d = r && r.data;
  if (!d || d.deleted) throw new Error('That build does not exist (any more)');
  if (d.game && d.game !== 'd4') throw new Error('That is not a Diablo IV build');
  const original = String(d.title || '').trim();
  const title = zh.translate(original, dict) || 'd2core build';
  const cls = CLASSES.find((c) => c.toLowerCase() === String(d.char || '').toLowerCase()) || 'All';
  const variants = [];
  (Array.isArray(d.variants) ? d.variants : []).forEach((v, i) => {
    const vn = zh.translate(v && v.name, dict) || 'Variant ' + (i + 1);
    const b = toBuild(Object.assign({}, v, { name: vn }), catalog, names, title, cls, db);
    if (!Object.keys(b.slots).length) return;
    variants.push(Object.assign(b, { variant: vn, original: String((v && v.name) || ''),
      source: { site: 'd2core.com', url: 'https://www.d2core.com/d4/planner?bd=' + src.bd, title: original } }));
  });
  if (log) log('d2core import:', src.bd, variants.length, 'variants');
  if (!variants.length) throw new Error('The build has no gear to import');
  return { title, original, cls, variants, preselect: 0 };
}

module.exports = { load, parseUrl, toBuild, itemExtras, skillsOf, paragonOf, appSource, ENV };
