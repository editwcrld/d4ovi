'use strict';
// The search page: the results, an item's card, where it drops, boss loot, crafting, activities,
// runewords – and the favourites and recent searches.
// One of the overlay's page scripts: they share one scope with app.js (the state, $, el, api, save,
// render …) and are loaded before it (renderer/index.html) – app.js starts the page.

// ---------------------------------------------------------------- search data
async function updateItems(q) {
  if (q === itemQuery) return;
  itemQuery = q;
  const r = q ? await api.searchItems(q) : [];
  if (itemQuery !== q) return;                      // typed on in the meantime
  itemHits = r || [];
  render();
}
const favs = () => (settings && settings.favorites) || [];
const isFav = (name) => favs().some((f) => f.name === name);
function toggleFav(it) {
  const list = favs().slice();
  const i = list.findIndex((f) => f.name === it.name);
  if (i >= 0) list.splice(i, 1);
  else list.unshift({ name: it.name, type: it.type || '', icon: it.icon || '', url: it.url || '' });
  save({ favorites: list.slice(0, 30) });
}
function pushRecent(q) {
  if (!q || q.length < 2) return;
  const list = ((settings && settings.recent) || []).filter((r) => r.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  settings.recent = list.slice(0, 12);
  // saved quietly – the list is only shown with an empty search field, nothing to redraw
  api.saveSettings({ recent: settings.recent }).then((r) => { if (r && r.settings) settings = r.settings; });
}

// ---- search -------------------------------------------------------------
function renderSearch(main, side) {
  const q = $('q').value.trim();
  const { term, kinds } = S.parseQuery(q);
  // "crafting", "boss loot" or "activities" name a whole area instead of one thing
  const area = !term && kinds.length > 0;
  // an item found by name shows its bosses on its own card – a boss gets a card of its own only
  // when the search named the boss, or it drops something no item card shows
  const shownItems = new Set(itemHits.map((it) => S.norm(it.name)));
  const named = (b) => !!term && S.norm(b.sec.name).includes(S.norm(term));
  const bosses = (S.showBoss(kinds) ? S.search(loot.sections, term, area) : [])
    .filter((b) => area || named(b) || !b.items.length || b.items.some((x) => !shownItems.has(S.norm(x.name))));
  const bossArea = area && S.showBoss(kinds);
  if (bossArea) bosses.sort(bossFirst);
  const recipes = S.showCraft(kinds) ? S.searchCraft(craft.tables, term, area) : [];
  const acts = S.showActs(kinds)
    ? (term ? activities.filter((x) => x.n.includes(S.norm(term))) : (area ? activities : []))
    : [];
  const rws = area && kinds.indexOf('recipe') >= 0 ? runewords : [];

  // the tabs switch the whole result list; a result picked in the list shows beside it
  const counts = [['all', 'All', itemHits.length + bosses.length + recipes.length + rws.length + acts.length],
    ['items', 'Items', itemHits.length], ['boss', 'Bosses', bosses.length],
    ['crafting', 'Crafting', recipes.length + rws.length], ['activities', 'Activities', acts.length]];
  if (q) {
    $('chips').appendChild(UI.tabs(counts.filter(([, , n], i) => !i || n).map(([id, label, n]) => [id, label, null, false, n]), chip,
      (id) => { chip = id; if (id !== 'all') pick = null; render(); }));
  }

  if (!q) {
    const hit = (o) => side.appendChild(Object.assign(UI.line(Object.assign({ tag: 'button' }, o)), {}));
    if (favs().length) {
      side.appendChild(el('h5', null, 'Favourites'));
      favs().forEach((f) => hit({ name: f.name, sub: f.type, rarity: f.type, pic: { name: f.name, url: f.icon }, cls: 'hit', onClick: () => { $('q').value = f.name; onQuery(); } }));
    }
    const rec = (settings && settings.recent) || [];
    if (rec.length) {
      const h = el('h5', null, 'Recent');
      const clr = el('button', 'clr', 'Clear');
      clr.title = 'Delete the recent searches';
      clr.onclick = () => save({ recent: [] });
      h.appendChild(clr);
      side.appendChild(h);
      rec.forEach((r) => hit({ name: r, pic: UI.pic(r, { kind: 'search' }), cls: 'hit', onClick: () => { $('q').value = r; onQuery(); } }));
    }
    if (!favs().length && !rec.length) side.appendChild(el('div', 'empty', 'Type to search'));
    const hint = el('div', 'empty', 'Items, boss loot, crafting recipes and activities — all in one search.');
    hint.appendChild(el('div', 'meta', 'Try: crafting · boss loot · activities · duriel · ber rune · iconic mythic'));
    main.appendChild(hint);
    return;
  }

  // ---- the results: a list – what it is and where it comes from – and the picked one in full
  // beside it (the first one until you pick another)
  const inChip = (k) => chip === 'all' || chip === k;
  const R = [];
  const itemRows = !inChip('items') ? [] : itemHits.map((it) => {
    const from = dropSources(it.name).slice().sort(bossFirst)[0];
    return { key: 'i:' + it.name, group: 'Items', name: it.name, rarity: rarityOf(it.name, it), pic: { name: it.name, url: it.icon, kind: kindOf(it) },
      sub: [it.type, from ? from.sec.name.split(',')[0] : ''].filter(Boolean).join(' · '), card: () => itemCard(it) };
  });
  const bossRows = !inChip('boss') ? [] : bosses.slice().sort(bossFirst).map((b) => ({ key: 'b:' + b.sec.name, group: b.sec.isBoss ? 'Bosses' : 'Loot pools',
    name: b.sec.name, rarity: '', pic: { name: b.sec.name, kind: b.sec.isBoss ? 'boss' : 'pool' },
    sub: [(b.sec.drops || []).length + ' drops', b.sec.location ? placeOf(b.sec).where : ''].filter(Boolean).join(' · '), card: () => bossLoot([b]) }));
  // a boss searched by its name ("duriel", "Everything Duriel drops") comes first, and is shown –
  // not its trophy ("Duriel: Shard of Agony"), which only carries the name
  const bossNamed = !!term && bosses.some((b) => b.sec.isBoss && S.norm(b.sec.name).startsWith(S.norm(term)));
  R.push(...(bossNamed ? bossRows.concat(itemRows) : itemRows.concat(bossRows)));
  if (inChip('crafting')) {
    rws.forEach((r) => R.push({ key: 'r:' + r.name, group: 'Runewords', name: r.name, rarity: 'Runeword', pic: { name: r.name, url: r.icon, kind: 'rune' },
      sub: 'Runeword', src: ((r.fields && r.fields[0] && r.fields[0].value) || ''), card: () => itemCard(r) }));
    recipes.forEach((r, i) => R.push({ key: 'c:' + i, group: 'Crafting', name: r.table.group + (r.table.sub ? ' · ' + r.table.sub : ''), pic: UI.pic('', { kind: 'craft' }),
      sub: r.rows.length + ' recipes', card: () => craftCard(r) }));
  }
  if (inChip('activities')) {
    acts.forEach((x) => R.push({ key: 'a:' + x.name, group: 'Activities', name: x.name, pic: UI.pic('', { kind: 'activity' }),
      sub: 'Activity', card: () => activityCard(x) }));
  }
  resultKeys = R.map((r) => r.key);
  // "boss loot" without a pick shows the bosses as tiles; everything else shows the first hit
  // "crafting" without a pick shows the overview: every runeword with its runes, every table
  const craftArea = area && kinds.indexOf('recipe') >= 0 && !pick;
  const cur = R.find((r) => r.key === pick) || (bossArea || craftArea || !R.length ? null : R[0]);
  shownKey = cur ? cur.key : null;          // the default stays a default – late item hits come first

  // the results as chips, in order – the tabs above say how many of each kind there are
  R.forEach((r) => {
    const row = UI.line({ tag: 'button', name: r.name, rarity: r.rarity, sub: r.sub, pic: r.pic, end: r.src || '', on: r === cur, cls: 'hit',
      title: r.name + (r.src ? ' — ' + r.src : ''),
      onClick: () => { pick = r.key; render(); $('main').scrollTop = 0; } });
    row.dataset.key = r.key;
    if (r.key.startsWith('i:') && window.FarmView) window.FarmView.tip(row, r.name);
    side.appendChild(row);
  });
  if (!area) {
    const tl = UI.line({ tag: 'button', name: 'Search “' + q + '” on diablo.trade', pic: UI.pic('', { kind: 'trade' }), cls: 'hit trade', onClick: () => openTrade(q) });
    side.appendChild(tl);
  }

  if (!R.length) {
    main.appendChild(el('div', 'empty', loot.sections.length ? 'No matches.' : 'Data is still loading …'));
    return;
  }
  if (!cur && craftArea) {
    if (rws.length && inChip('crafting')) main.appendChild(runewordList());
    if (inChip('crafting')) recipes.forEach((r) => main.appendChild(craftCard(r)));
    if (inChip('activities')) acts.forEach((x) => main.appendChild(activityCard(x)));
    return;
  }
  if (!cur) {
    // "boss loot": the bosses to pick from, then what the picked one drops
    main.appendChild(bossLoot(bosses));
    return;
  }
  if (bossArea && cur.key.startsWith('b:')) {
    const back = UI.btn('All bosses', () => { pick = null; render(); }, 'ghost', 'left');
    back.style.marginBottom = '10px';
    main.appendChild(back);
  }
  main.appendChild(cur.card());
}

// ---- pictures and rarities ----------------------------------------------
/** "mythic" | "unique" | … – from the item, the catalog, or the loot sheet's note. */
function rarityOf(name, it, note) {
  const r = (it && it.rarity) || ((window.FarmView && window.FarmView.item(name)) || {}).rarity || '';
  if (/mythic/i.test(r) || (!r && /mythic/i.test(note || ''))) return 'mythic';      // "Iconic Mythic Unique" too
  return r ? r.split(' ')[0].toLowerCase() : 'unique';
}
/** What kind of thing an item from the search is – it picks where its picture comes from. */
function kindOf(it) {
  const t = String((it && it.type) || '').toLowerCase(), r = String((it && it.rarity) || '').toLowerCase();
  if (/mythic/.test(r)) return 'mythic';
  if (/unique/.test(r)) return 'unique';
  if (/charm/.test(t)) return 'charm';
  if (/seal/.test(t)) return 'seal';
  if (/gem/.test(t)) return 'gem';
  if (/rune/.test(t)) return 'rune';
  if (/aspect/.test(t)) return 'aspect';
  return 'thing';
}

// ---- an item: its picture, what it does, then who drops it -------------------
function itemCard(it) {
  const c = el('div', 'card');
  const rar = rarityOf(it.name, it);
  const top = el('div', 'entry');
  const art = UI.pic(it.name, { url: it.icon, kind: kindOf(it), cls: 'pic art r-' + rar });
  if (window.FarmView) window.FarmView.tip(art, it.name);          // the in-game tooltip, as in the gear
  top.appendChild(art);
  const tx = el('div', 'etx');
  tx.appendChild(el('h2', 'r-' + rar, it.name));
  const cat = window.FarmView && window.FarmView.item(it.name);
  const cls = cat && cat.cls && cat.cls !== 'All' ? cat.cls : '';
  const meta = [it.rarity, it.type, cls, it.level ? 'level ' + it.level + '+' : '', it.set ? 'Set: ' + it.set : ''].filter(Boolean);
  if (meta.length) tx.appendChild(el('div', 'sub', meta.join(' · ')));
  // what it does, as the game's tooltip shows it
  if (it.power) tx.appendChild(el('div', 'power' + (rar === 'mythic' ? '' : ' u'), it.power));
  if ((it.effects || []).length) {
    const ul = el('ul', 'aff');
    it.effects.forEach((e) => ul.appendChild(el('li', null, e)));
    tx.appendChild(ul);
  }
  const acts = el('div', 'acts');
  acts.appendChild(UI.btn('diablo.trade', () => openTrade(it.name), 'pri', 'trade'));
  const star = UI.btn(isFav(it.name) ? 'Favourite' : 'Favourite', () => toggleFav(it), 'star' + (isFav(it.name) ? ' on' : ''), 'star');
  star.title = isFav(it.name) ? 'A favourite – click to take it out' : 'Keep it with the favourites (empty search)';
  acts.appendChild(star);
  acts.appendChild(UI.btn('Copy', () => { api.copyText(it.name); showNote('“' + it.name + '” copied.', 'ok', 2500); }, '', 'copy'));
  tx.appendChild(acts);
  top.appendChild(tx);
  c.appendChild(top);

  if (it.obtain) {
    const g = el('div', 'get');
    g.appendChild(el('b', null, 'How to get it'));
    g.appendChild(el('span', null, it.obtain));
    if (it.obtainNote) g.appendChild(el('span', 'sub', it.obtainNote));
    c.appendChild(g);
  }
  dropsFrom(it.name, c);
  const fields = it.fields || [];
  if (fields.length) {
    const g = el('div', 'fields');
    fields.forEach((f) => {
      const cell = el('div', 'cell');
      if (f.label) cell.appendChild(el('b', null, f.label));
      cell.appendChild(el('span', null, f.value));
      g.appendChild(cell);
    });
    c.appendChild(g);
  }
  if (it.desc) c.appendChild(el('div', 'desc', it.desc));
  return c;
}

/** "The Glacial Fissure is located South-west of Kyovashad in …" -> where it is, and the lair's name. */
function placeOf(sec) {
  const loc = String(sec.location || '').trim().replace(/\.$/, '');
  // "… is located South of …", sometimes just "… is East of …"
  const m = loc.match(/^(.*?)\s+(?:is|are)\s+(?:located\s+)?(.*)$/i);
  if (!m) return { where: loc, lair: '' };
  const where = m[2].replace(/^(in|at|on)\s+/i, '');
  const lair = m[1].toLowerCase() === String(sec.name || '').toLowerCase() ? '' : m[1];
  return { where: where.charAt(0).toUpperCase() + where.slice(1), lair };
}
/** Only what you need to go there: the torment level and the key. */
function bossFacts(info) {
  const out = [];
  (info || []).forEach((i) => {
    const t = String(i).trim().replace(/\.$/, '');
    let m;
    if ((m = t.match(/Torment\s*(\d+)/i)) && /requires/i.test(t)) out.push(['Torment ' + m[1] + '+', 'red']);
    else if ((m = t.match(/Lair Key:\s*(.+)$/i))) out.push([m[1], 'gold']);
  });
  return out;
}
const factTags = (sec) => {
  const f = bossFacts(sec.info);
  if (!f.length) return null;
  const t = el('div', 'tags');
  f.forEach(([v, k]) => t.appendChild(el('span', 'tag ' + k, v)));
  return t;
};

/** The lair screenshot from the guide: on request, it is big. Only a boss has a lair. */
function lairMap(sec, into, links) {
  if (!sec.isBoss || !sec.images || !sec.images[0]) return;
  const tg = el('button', 'lnk dim', 'Show lair & map');
  const box = el('div', 'shot');
  box.hidden = true;
  tg.onclick = () => {
    if (!box.firstChild) box.appendChild(UI.img(sec.images[0], () => { box.remove(); tg.remove(); }));
    box.hidden = !box.hidden;
    tg.textContent = box.hidden ? 'Show lair & map' : 'Hide lair & map';
  };
  (links || into).appendChild(tg);
  into.appendChild(box);
}

/** Every boss and loot pool that drops an item (by name). */
let dropIndex = { of: null, map: new Map() };
function dropSources(name) {
  if (dropIndex.of !== loot.sections) {
    const map = new Map();
    (loot.sections || []).forEach((sec) => (sec.drops || []).forEach((d) => {
      const k = S.norm(d.name);
      if (!map.has(k)) map.set(k, []);
      if (!map.get(k).some((x) => x.sec === sec)) map.get(k).push({ sec, drop: d });
    }));
    dropIndex = { of: loot.sections, map };
  }
  return dropIndex.map.get(S.norm(name)) || [];
}
/** On the item's card: who drops it and where that boss is – bosses first, then loot pools. */
function dropsFrom(name, into) {
  const src = dropSources(name).slice().sort(bossFirst);
  if (!src.length) return;
  const p = UI.plate({ title: 'Drops from', icon: 'lair', badge: src.length, cls: 'from' });
  const grid = el('div', 'bcards');
  src.forEach(({ sec, drop }) => {
    const card = el('div', 'bcard');
    card.appendChild(UI.pic(sec.name, { kind: sec.isBoss ? 'boss' : 'pool' }));
    const tx = el('div', 'btx');
    tx.appendChild(el('b', null, sec.name));
    const where = sec.location ? placeOf(sec) : null;
    const note = [drop.cls, cleanName(drop.note)].filter((x) => x && !/^(all|multiple) classes$/i.test(x)).join(' · ');
    const line = [where && where.where, where && where.lair ? 'Lair: ' + where.lair : '', note].filter(Boolean).join(' · ');
    if (line) tx.appendChild(el('span', 'lm', line));
    const tags = factTags(sec);
    if (tags) tx.appendChild(tags);
    const links = el('div', 'links');
    const all = el('button', 'lnk ball', 'Everything ' + sec.name.split(',')[0] + ' drops →');
    all.onclick = () => { $('q').value = sec.name.split(',')[0]; onQuery(); };
    links.appendChild(all);
    tx.appendChild(links);
    lairMap(sec, tx, links);
    card.appendChild(tx);
    grid.appendChild(card);
  });
  p.body.appendChild(grid);
  into.appendChild(p.card);
}

// ---- boss loot: every boss (or the one picked) with its uniques as tiles, filtered by class
function activeClass() {
  const st = window.FarmView && window.FarmView._state && window.FarmView._state();
  const b = st && st.data && st.data.builds.find((x) => x.id === st.data.active);
  return b && b.cls && b.cls !== 'All' ? b.cls : 'All';
}
/** The class the drops are shown for: picked here, else the active build's, else all. */
const lootClass = () => bossCls || (CLASSES.includes(activeClass()) ? activeClass() : 'All');
/** A drop for this class: its own, or one for every class. */
const forClass = (d, cls) => cls === 'All' || !d.cls || d.cls === cls || /^(all|multiple)/i.test(d.cls);
function classBar() {
  const cur = lootClass();
  const bar = el('div', 'clsbar clsrow');
  ['All'].concat(CLASSES).forEach((c) => {
    const b = el('button', 'cls' + (c === cur ? ' on' : ''));
    b.dataset.cls = c;
    b.title = c === 'All' ? 'Every class' : c;
    if (c === 'All') b.appendChild(el('span', null, 'All'));
    else b.appendChild(UI.img(UI.classPic(c), () => { b.textContent = c.slice(0, 3); }));
    b.onclick = () => { bossCls = c; render(); };
    bar.appendChild(b);
  });
  if (!bossCls && cur !== 'All') bar.appendChild(el('span', 'meta', cur + ' · your build’s class'));
  return bar;
}
/** One unique: picture, name in its colour, slot – the in-game tooltip on hover, a click looks it up. */
function itemTile(d) {
  const name = cleanName(d.name);
  const cat = window.FarmView && window.FarmView.item(name);
  const rar = rarityOf(name, null, d.note);
  const t = el('button', 'tile itile r-' + rar);
  t.dataset.item = name;
  t.appendChild(UI.pic(name, { url: cat && cat.icon, kind: rar === 'mythic' ? 'mythic' : 'unique' }));
  t.appendChild(el('b', 'inm r-' + rar, name));
  // "(Druid, Sorc)" is worth showing, "All" next to "all classes" is not
  const note = cleanName(d.note).replace(/^\((.*)\)$/, '$1').replace(/^all( classes)?$/i, '');
  const sub = [cat && cat.slot, /^(all|multiple)/i.test(d.cls || '') ? 'all classes' : '', note].filter(Boolean).join(' · ');
  if (sub) t.appendChild(el('small', 'ity', sub));
  t.onclick = () => { UI.tip.hide(); $('q').value = name; onQuery(); };
  if (window.FarmView) window.FarmView.tip(t, name);
  return t;
}
/** A boss with what it drops for the class – the count says how many of how many. */
function bossSection(sec, drops) {
  const cls = lootClass();
  const shown = drops.filter((d) => forClass(d, cls));
  const s = el('section', 'bsec' + (sec.isBoss ? '' : ' pool'));
  const hero = el('div', 'hero');
  hero.appendChild(UI.pic(sec.name, { kind: sec.isBoss ? 'boss' : 'pool' }));
  const tx = el('div', 'htx');
  tx.appendChild(el('h3', null, sec.name));
  if (sec.location) {
    const p = placeOf(sec);
    const w = el('div', 'where');
    w.appendChild(el('b', null, p.where));
    if (p.lair) w.appendChild(document.createTextNode(' · Lair: ' + p.lair));
    tx.appendChild(w);
  }
  const tags = factTags(sec);
  if (tags) tx.appendChild(tags);
  hero.appendChild(tx);
  const end = el('div', 'hend');
  const n = el('div', 'cnt', String(shown.length));
  n.appendChild(el('small', null, shown.length === drops.length ? 'drops' : 'for ' + cls + ' · ' + drops.length + ' in all'));
  end.appendChild(n);
  hero.appendChild(end);
  s.appendChild(hero);
  const g = el('div', 'tiles igrid');
  shown.forEach((d) => g.appendChild(itemTile(d)));
  if (!shown.length) g.appendChild(el('div', 'meta', drops.length ? 'Nothing for ' + cls + ' here.' : 'No drop list for it.'));
  s.appendChild(g);
  const lairs = el('div', 'lairs');
  lairMap(sec, lairs);
  if (lairs.firstChild) s.appendChild(lairs);
  return s;
}
/** "boss loot", or a boss picked: the class bar, then the bosses, the loot pools after them. */
function bossLoot(list) {
  const wrap = el('div', 'bloot');
  wrap.appendChild(classBar());
  list.slice().sort(bossFirst).forEach((b) => wrap.appendChild(bossSection(b.sec, b.items)));
  return wrap;
}

function craftCard(m) {
  const t = m.table;
  const p = UI.plate({ title: t.group + (t.sub ? ' · ' + t.sub : ''), sub: m.rows.length + ' recipes', icon: 'craft' });
  m.rows.forEach((row) => {
    const r = el('div', 'recipe');
    row.forEach((cell, i) => {
      if (!cell) return;
      const f = el('div', 'f');
      if (t.cols && t.cols[i]) f.appendChild(el('b', null, t.cols[i]));
      f.appendChild(el('span', null, cell));
      r.appendChild(f);
    });
    p.body.appendChild(r);
  });
  return p.card;
}

/** The parts of a step-by-step guide ("Part 1 – …", "Step 2 …"); other guides have none. */
const actSteps = (a) => {
  const parts = (a.sections || []).map((t, i) => [t, i]).filter(([t]) => /^(part|step|stage|quest)\s*\d/i.test(t));
  return parts.length >= 2 ? parts : [];
};
/** An activity: what it is, the parts to tick off (step-by-step guides), and its sections to jump to. */
function activityCard(a) {
  const steps = actSteps(a);
  const done = actDone(a);
  const p = UI.plate({ title: a.name, sub: steps.length ? actProgress(a) + ' of ' + steps.length + ' parts done · maxroll.gg guide' : 'maxroll.gg guide', icon: 'activity', cls: 'act' });
  p.side.appendChild(UI.btn('Open guide', () => openSection('page', a.url), 'pri sm'));
  const c = p.body;
  if (a.desc) c.appendChild(el('div', 'pw', a.desc));
  if (steps.length) {
    c.appendChild(el('div', 'k2', 'Your progress'));
    const list = el('div', 'steps');
    steps.forEach(([st, i]) => {
      const row = el('div', 'step' + (done.includes(i) ? ' done' : ''));
      row.appendChild(UI.tick({ on: done.includes(i), title: done.includes(i) ? 'Done – click to undo' : 'Done', onClick: (v) => setActDone(a, i, v) }));
      row.appendChild(el('span', null, st));
      const go = UI.iconBtn('Open the guide here', 'right', (e) => { e.preventDefault(); openSection('page', a.url, st); }, 'ghost sm');
      row.appendChild(go);
      list.appendChild(row);
    });
    c.appendChild(list);
  }
  const rest = (a.sections || []).filter((st) => !steps.some(([x]) => x === st) && !/^tl;?dr/i.test(st));
  if (rest.length) {
    c.appendChild(el('div', 'k2', steps.length ? 'More in the guide' : 'In the guide'));
    const list = el('div', 'jumps');
    rest.forEach((st) => {
      const b = el('button', 'jump');
      b.appendChild(el('span', null, st));
      b.appendChild(UI.icon('right'));
      b.title = 'Open the guide at this section';
      b.onclick = () => openSection('page', a.url, st);
      list.appendChild(b);
    });
    c.appendChild(list);
  }
  return p.card;
}
const actKey = (a) => a.slug || a.name;
const actDone = (a) => ((settings && settings.actDone) || {})[actKey(a)] || [];
/** How many of the guide's parts are ticked off. */
const actProgress = (a) => { const steps = actSteps(a); return actDone(a).filter((i) => steps.some(([, j]) => j === i)).length; };
function setActDone(a, i, on) {
  const all = Object.assign({}, (settings && settings.actDone) || {});
  const cur = new Set(all[actKey(a)] || []);
  if (on) cur.add(i); else cur.delete(i);
  all[actKey(a)] = [...cur].sort((x, y) => x - y);
  save({ actDone: all });
}

// All runewords as one plate – every entry opens its page with the exact recipes
function runewordList() {
  const p = UI.plate({ title: 'Runewords', sub: runewords.length + ' runewords · d4guides.gg', icon: 'rune' });
  runewords.forEach((r) => {
    const open = UI.iconBtn('Open in the database', 'external', () => openSection('page', r.url), 'ghost sm');
    p.body.appendChild(UI.line({ name: r.name, rarity: 'Runeword', sub: (r.fields[0] && r.fields[0].value) || '', pic: { name: r.name, url: r.icon, kind: 'rune' }, end: open, cls: 'drop' }));
  });
  return p.card;
}
