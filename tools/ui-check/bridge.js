// The overlay's bridge (preload.js's window.d4api) for the layout check: answered from the caches
// (data.js), the builder from the test fixture; whatever only the app can do is a no-op.
const D = require('./data.js').load();

const copy = (v) => JSON.parse(JSON.stringify(v));
let settings = Object.assign(D.settings, {
  lockKeys: [{ key: '1', lock: false, sec: 1.6 }, { key: '2', lock: true, sec: 1 }, { key: '3', lock: true, sec: 1 }, { key: '4', lock: true, sec: 1 }],
  windowSize: 'medium', favorites: [{ name: 'Harlequin Crest', type: 'Mythic Unique Helm' }], recent: ['butcher', 'tal rune'],
});
const answers = {
  getSettings: () => settings,
  saveSettings: (p) => { settings = Object.assign({}, settings, p); return { settings, errors: [] }; },
  getFeatures: () => ({ macros: true, clickSpam: true, lock: true }),
  getLoot: () => D.loot,
  getCraft: () => D.craft,
  getActivities: () => [{ name: 'Season Journey', n: 'season journey', slug: 'sj', url: 'https://maxroll.gg/d4', desc: 'What the season asks of you.', sections: ['Part 1 – Start', 'Part 2 – Grind', 'Rewards'] }],
  getRunewords: () => [{ name: 'Enigma', icon: '', url: 'https://d4guides.gg', fields: [{ label: 'Recipe', value: 'Tal + Eth' }] }],
  getFarm: () => D.catalog,
  getBuilds: () => D.builds,
  farmCss: () => D.css,
  farmTooltip: () => '<div style="padding:10px;background:#111;color:#ddd;width:300px">Tooltip</div>',
  // the search: the catalog's items by their first word, with a power and stats to show
  searchItems: (q) => {
    const w = String(q).toLowerCase().split(' ')[0];
    return D.catalog.items.filter((i) => i.n.includes(w)).slice(0, 12).map((i) => Object.assign({}, i, {
      rarity: i.rarity === 'Mythic' ? 'Mythic Unique' : i.rarity,
      power: 'Gain +6 Rank to all Skills.', effects: ['+2,000 Armor', '+100 All Stats', '+20% Damage Reduction'],
    }));
  },
  icons: () => D.icons,
  authStatus: () => ({ loggedIn: false }), lastBackup: () => 0, getVersion: () => '1.0.0', lastUpdate: () => null, guideSheet: () => null,
  buildTree: (cls) => (D.d2 ? D.d2db.treeFor(D.d2, cls) : { error: 'no d2core data' }),
  buildParagon: (keys) => (D.d2 ? D.d2db.paragonFor(D.d2, keys) : { error: 'no d2core data' }),
  builderCatalog: () => D.builder.catalog,
  builderFull: () => ({ plan: copy(D.builder.plan), proven: copy(D.builder.proven) }),
  builderPlan: () => copy(D.builder.plan),
  builderProven: () => copy(D.builder.proven),
  builderPreview: () => ({ name: 'Rain of Arrows Rogue', cls: 'Rogue',
    slots: { Helm: { item: "Leoric's Crown", sockets: ['Abyssal Splinter of Pain', 'Royal Emerald'] }, Weapon: { item: 'Insight', sockets: ['Ral', 'Tir'] } },
    skills: { bar: [{ id: 7, key: 'Rogue_RainofArrows', name: 'Rain of Arrows', icon: 0, rank: 5, mods: ['Crashing Waves'] }], ranks: { 7: 5 } },
    paragon: { boards: [{ k: 'Paragon_Rogue_00', x: 0, y: 0, rot: 0, nodes: [[1, 1], [1, 2]], glyph: 'G1', glyphRank: 0 }] } }),
  saveBuilds: (d) => d,
};
// sent without an answer (fire and forget in preload.js)
const SENDS = new Set(['keyboard', 'resize', 'setIdle', 'viewHide', 'viewShow', 'viewBounds', 'hoverWatch', 'copyText', 'refreshStatus', 'resizeDrag', 'hotkeyCapture']);

/** The bridge for the API the website asks over HTTP (web-check.js). */
const answer = (name, ...a) => (answers[name] ? answers[name](...a) : null);

if (typeof window !== 'undefined') {
  window.d4api = new Proxy({}, { get: (_, k) => {
    if (SENDS.has(k)) return () => {};
    if (String(k).startsWith('on')) return () => {};
    return (...a) => Promise.resolve(answer(k, ...a));
  } });
}

module.exports = { answer };
