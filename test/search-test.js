const S = require('../renderer/search');
const sections = [
  { name: 'Grigoire, The Galvanic Saint', drops: [{ cls: 'Barbarian', name: 'Rage of Harrogath', note: '' }, { cls: 'Multiple Classes', name: 'Penitent Greaves', note: '' }] },
  { name: 'Echo of Varshan', drops: [{ cls: 'Druid', name: "Vasily's Prayer", note: '' }, { cls: 'Rogue', name: 'Eyes in the Dark', note: '' }] },
  { name: 'Mythic Uniques', drops: [{ cls: 'Mehrere Klassen', name: 'Harlequin Crest', note: 'All' }] },
];
const t = (q) => console.log(JSON.stringify(q).padEnd(26), '->', S.search(sections, q).map((g) => g.sec.name + ' [' + g.items.map((i) => i.name).join(', ') + ']').join(' | ') || '(nichts)');
t('vasilys prayer'); t("Vasily's"); t('penitent'); t('grigoire'); t('harlequin'); t('rage of harrogat'); t('xyz');
