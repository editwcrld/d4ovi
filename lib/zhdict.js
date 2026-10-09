'use strict';
// Chinese -> English for build titles (d2core.com is a Chinese site; its titles and variant
// names are written by players: "S15-无限-冰灌箭雨(5-6分钟天塔150)").
//
// The game names come from maxroll's game data, which exists in both languages under the same
// ids (data.enus.json / data.zhcn.json): items, aspects, skills, sets, glyphs, classes. On top
// of that a short glossary of the words players use in titles (天塔 = Pit, 速刷 = speed farm …).
// Translation is longest match first; what is not in the dictionary stays as it is.
const fs = require('fs');

const EN_URL = 'https://assets-ng.maxroll.gg/d4-tools/game/data.enus.json';
const ZH_URL = 'https://assets-ng.maxroll.gg/d4-tools/game/data.zhcn.json';
const MAX_AGE = 7 * 24 * 3600 * 1000;
const VERSION = 1;

// Build jargon – what is not a game name. Longer entries win over the one-character ones.
const GLOSSARY = {
  '天塔': 'Pit', '深坑': 'Pit', '炼狱大军': 'Infernal Hordes', '地狱狂潮': 'Helltide', '噩梦地下城': 'Nightmare Dungeon',
  '地下城': 'Dungeon', '世界首领': 'World Boss', '巢穴首领': 'Lair Boss', '首领': 'Boss', '暗城': 'Undercity', '低语': 'Whispers',
  '速刷': 'speed farm', '刷图': 'farming', '刷怪': 'farming', '推层': 'pushing', '高层': 'high tier', '开荒': 'starter',
  '起步': 'starter', '毕业': 'endgame', '过渡': 'transition', '平民': 'budget', '新手': 'beginner', '无暗金': 'no mythics',
  '巅峰盘': 'paragon', '巅峰': 'paragon', '变体': 'variant', '版本': 'version', '赛季': 'Season', '构筑': 'build',
  '一键宏': 'one-button macro', '一键': 'one-button', '宏': 'macro', '分钟': 'min', '秒': 's', '层': 'tier',
  '冰灌': 'Cold Imbuement', '毒灌': 'Poison Imbuement', '暗灌': 'Shadow Imbuement', '灌注': 'Imbuement',
  '双持': 'dual wield', '弓弩': 'bow/crossbow', '弓': 'bow', '弩': 'crossbow', '双手': 'two-handed',
  '同样强大': 'equally strong', '强大': 'strong', '推荐': 'recommended', '极速': 'fast', '快速': 'fast', '高伤': 'high damage',
  '爆发': 'burst', '生存': 'survival', '坦克': 'tank', '召唤': 'summon', '暗金': 'mythic', '传奇': 'legendary', '威能': 'aspect',
  '符文之语': 'runeword', '符文': 'rune', '套装': 'set', '宝石': 'gem', '流派': 'build', '流': 'build', '版': 'version',
  '含': 'incl.', '和': 'and', '与': 'and', '或': 'or', '无': 'no', '纯': 'pure', '新': 'new', '老': 'old',
  // short forms of skill and class names (the full ones come from the game data)
  '冰球': 'Frozen Orb', '电球': 'Ball Lightning', '球电': 'Ball Lightning', '连电': 'Chain Lightning', '冰片': 'Ice Shards',
  '陨石': 'Meteor', '旋风': 'Whirlwind', '先祖锤': 'Hammer of the Ancients', '大锤': 'Hammer of the Ancients',
  '穿刺': 'Penetrating Shot', '穿透': 'Penetrating Shot', '回旋': 'Twisting Blades', '快刀': 'Flurry', '龙卷': 'Tornado',
  '祝福锤': 'Blessed Hammer', '祝锤': 'Blessed Hammer', '狼人': 'Werewolf', '熊人': 'Werebear', '风暴': 'storm',
  '闪电': 'lightning', '残暴': 'Ferocious', '死灵': 'Necromancer', '野蛮': 'Barbarian', '圣骑': 'Paladin', '德鲁': 'Druid',
  '冰': 'cold', '火': 'fire', '雷': 'lightning', '电': 'lightning', '毒': 'poison', '暗': 'shadow', '物理': 'physical', '神圣': 'holy',
};
// full-width punctuation -> ASCII
const PUNCT = { '（': '(', '）': ')', '，': ', ', '、': ', ', '：': ': ', '；': '; ', '。': '. ', '【': '[', '】': ']',
  '！': '!', '？': '?', '～': '~', '「': '"', '」': '"', '《': '"', '》': '"', '　': ' ', '＋': '+', '－': '-', '／': '/' };

const CJK = /[㐀-鿿豈-﫿]/;
const hasCjk = (s) => CJK.test(String(s || ''));

let file = null;
let dict = null;
let dictAt = 0;

const setDict = (d) => { dict = d || {}; };

function configure(opts) {
  if (opts && opts.file) file = opts.file;
  try {
    const c = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (c && c.version === VERSION && c.dict) { setDict(c.dict); dictAt = c.fetchedAt || 0; }
  } catch (_) { /* built on the first d2core import */ }
}

/**
 * The dictionary from the two game data files: every name that exists in both languages.
 * @param {object} en  data.enus.json
 * @param {object} zh  data.zhcn.json
 */
function build(en, zh) {
  const out = {};
  const add = (z, e) => {
    z = String(z || '').trim(); e = String(e || '').trim();
    if (z.length < 2 || !e || !hasCjk(z) || hasCjk(e) || out[z]) return;
    out[z] = e;
  };
  const pairs = (sec, pick) => {
    const a = (en && en[sec]) || {}, b = (zh && zh[sec]) || {};
    for (const id of Object.keys(b)) if (a[id]) pick(b[id], a[id], id);
  };
  // skills first: the title of a build is mostly its skill
  pairs('skills', (z, e) => add(z.name, e.name));
  pairs('items', (z, e, id) => { if (/unique|runeword/i.test(id)) add(z.name, e.name); });
  pairs('affixes', (z, e, id) => {
    if (!/^legendary_/i.test(id)) return;
    // "余劲尚存之" + 威能 = Aspect of Aftermath; the short form is used in titles as well
    if (z.suffix && e.suffix) { add(z.suffix + '威能', 'Aspect ' + e.suffix); add(z.suffix.replace(/[之的]$/, ''), e.suffix.replace(/^of /, '')); }
    if (z.prefix && e.prefix) { add(z.prefix + '威能', e.prefix + ' Aspect'); add(z.prefix.replace(/[之的]$/, ''), e.prefix); }
  });
  pairs('itemSets', (z, e) => add(z.name, e.name));
  pairs('paragonGlyphs', (z, e) => add(z.name, e.name));
  pairs('paragonNodes', (z, e) => add(z.name, e.name));
  pairs('classes', (z, e) => add(z.nameMale, e.nameMale));
  pairs('mercenaries', (z, e) => add(z.name, e.name));
  return out;
}

/** The glossary always applies; the game names on top of it once they are loaded. */
function current() {
  return Object.assign({}, dict || {}, GLOSSARY);
}

/**
 * A title from Chinese into English. Pieces that are translated are spaced from their
 * neighbours; anything unknown is kept.
 */
function translate(text, d) {
  let s = String(text || '');
  if (!hasCjk(s) && !/[（），、：；。【】！？～「」《》　＋－／]/.test(s)) return s.trim();
  s = s.replace(/[（），、：；。【】！？～「」《》　＋－／]/g, (c) => PUNCT[c]);
  const words = d || current();
  let longest = 1;
  for (const k of Object.keys(words)) if (k.length > longest) longest = k.length;
  const parts = [];                               // [text, translated]
  let i = 0, raw = '';
  while (i < s.length) {
    let hit = '';
    if (CJK.test(s[i])) {
      for (let n = Math.min(longest, s.length - i); n >= 1; n--) {
        const k = s.substr(i, n);
        if (words[k]) { hit = k; break; }
      }
    }
    if (hit) {
      if (raw) { parts.push([raw, false]); raw = ''; }
      parts.push([words[hit], true]);
      i += hit.length;
    } else raw += s[i++];
  }
  if (raw) parts.push([raw, false]);
  let out = '';
  parts.forEach(([t, tr], k) => {
    // a translated word gets a space on both sides, except next to a dash, slash or bracket
    if (k && (tr || parts[k - 1][1]) && !/[\s\-/([]$/.test(out) && !/^[\s\-/,.;:!?)\]]/.test(t)) out += ' ';
    out += t;
  });
  return out.replace(/\s+/g, ' ').replace(/([A-Za-z0-9])\(/g, '$1 (').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')')
    .replace(/\s+([,;:!?])/g, '$1').trim();
}

/** Loads (or builds, the first time) the dictionary. Without it the glossary still works. */
async function load(net, log) {
  if (dict && Date.now() - dictAt < MAX_AGE) return current();
  try {
    const [a, b] = await Promise.all([net.fetch(EN_URL), net.fetch(ZH_URL)]);
    if (!a.ok || !b.ok) throw new Error('HTTP ' + (a.ok ? b.status : a.status));
    setDict(build(await a.json(), await b.json()));
    dictAt = Date.now();
    try { fs.writeFileSync(file, JSON.stringify({ version: VERSION, fetchedAt: dictAt, dict })); } catch (_) {}
    if (log) log('zh dictionary:', Object.keys(dict).length, 'names');
  } catch (e) {
    if (log) log('zh dictionary failed:', e.message);
    if (!dict) setDict({});
  }
  return current();
}

module.exports = { configure, load, build, translate, current, hasCjk, GLOSSARY, EN_URL, ZH_URL };
