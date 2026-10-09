// Reine Suchlogik (läuft im Overlay und in Node-Tests)
(function (root) {
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

  function lev(a, b) {
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }

  function buildIndex(sections) {
    const idx = [];
    (sections || []).forEach((sec, si) => (sec.drops || []).forEach((d) => idx.push({ si, sec, cls: d.cls, name: d.name, note: d.note, n: norm(d.name) })));
    return idx;
  }

  // -> [{sec, items:[{name, cls, note}], score}] sortiert nach Treffergüte
  function search(sections, query, all) {
    const q = norm(query);
    // "boss loot" has no name in it – then every section is a hit
    if (!q) return all ? (sections || []).map((sec) => ({ sec, score: 10, items: sec.drops || [] })) : [];
    const tokens = q.split(' ');
    const idx = buildIndex(sections);
    const groups = new Map();
    const add = (si, sec, item, score) => {
      const g = groups.get(si) || { sec, items: new Map(), score: 0 };
      const key = item.cls + '|' + item.name;
      if (!g.items.has(key) || g.items.get(key).score < score) g.items.set(key, { ...item, score });
      g.score = Math.max(g.score, score);
      groups.set(si, g);
    };
    for (const it of idx) {
      if (!tokens.every((t) => it.n.includes(t))) continue;
      const score = it.n === q ? 100 : it.n.startsWith(q) ? 80 : (' ' + it.n).includes(' ' + q) ? 60 : 40;
      add(it.si, it.sec, it, score);
    }
    (sections || []).forEach((sec, si) => {
      const bn = norm(sec.name);
      if (!tokens.every((t) => bn.includes(t))) return;
      const drops = sec.drops || [];
      // Abschnitte ohne eigene Loot-Liste (z. B. Belial) trotzdem zeigen – wegen Fundort/Hinweisen
      if (!drops.length) { if (!groups.has(si)) groups.set(si, { sec, items: new Map(), score: 30 }); return; }
      drops.forEach((d) => add(si, sec, d, 30));
    });
    if (!groups.size && q.length >= 4) { // Tippfehler tolerieren
      for (const it of idx) {
        const dist = lev(q, it.n);
        if (dist <= Math.max(2, Math.floor(it.n.length * 0.25))) add(it.si, it.sec, it, 20 - dist);
      }
    }
    return Array.from(groups.values())
      .map((g) => ({ sec: g.sec, score: g.score, items: Array.from(g.items.values()).sort((a, b) => b.score - a.score) }))
      .sort((a, b) => b.score - a.score);
  }

  // Crafting-Tabellen durchsuchen (Runenwörter, Umwandlungen, Mythic-Rezepte)
  // -> [{table, rows}] – Treffer in Zeilen zuerst, sonst die ganze Tabelle, wenn die Überschrift passt
  function searchCraft(tables, query, all) {
    const q = norm(query);
    if (!q) return all ? (tables || []).map((t) => ({ table: t, rows: t.rows || [], score: 10 })) : [];
    const tokens = q.split(' ');
    const out = [];
    for (const t of tables || []) {
      const rows = (t.rows || []).filter((r) => { const h = norm(r.join(' ')); return tokens.every((tok) => h.includes(tok)); });
      if (rows.length) { out.push({ table: t, rows, score: 60 }); continue; }
      const head = norm((t.group || '') + ' ' + (t.sub || '') + ' ' + (t.cols || []).join(' '));
      if (tokens.every((tok) => head.includes(tok))) out.push({ table: t, rows: t.rows || [], score: 30 });
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ---------- Suche eingrenzen ----------
  // "ber rune" -> nur die Rune Ber, "insight runeword" -> nur das Runenwort.
  // Schlagwörter werden aus der Suche entfernt und als Filter benutzt (deutsch und englisch).
  const KIND_WORDS = {
    rune: ['rune', 'runes', 'runen'],
    runeword: ['runeword', 'runewords', 'runenwort', 'runenworter'],
    gem: ['gem', 'gems', 'edelstein', 'edelsteine'],
    aspect: ['aspect', 'aspects', 'aspekt', 'aspekte'],
    skill: ['skill', 'skills', 'fahigkeit'],
    charm: ['charm', 'charms'],
    seal: ['seal', 'seals', 'siegel'],
    talisman: ['talisman', 'talismans', 'talismane'],
    key: ['key', 'keys', 'schlussel'],
    sigil: ['sigil', 'sigils'],
    material: ['material', 'materials', 'materialien'],
    set: ['set', 'sets'],
    unique: ['unique', 'uniques'],
    mythic: ['mythic', 'mythics', 'mythisch'],
    iconic: ['iconic', 'iconics'],
    legendary: ['legendary', 'legendaries', 'legendar'],
    item: ['item', 'items'],
    glyph: ['glyph', 'glyphs', 'glyphe', 'glyphen'],
    affix: ['affix', 'affixes'],
    paragon: ['paragon'],
    mercenary: ['mercenary', 'mercenaries', 'soldner'],
    tribute: ['tribute', 'tributes'],
    boss: ['boss', 'bosses', 'bosse', 'loot', 'drops'],
    recipe: ['recipe', 'recipes', 'rezept', 'rezepte', 'crafting', 'craft'],
    activity: ['activity', 'activities', 'event', 'events'],
  };
  const WORD_TO_KIND = {};
  for (const k of Object.keys(KIND_WORDS)) for (const w of KIND_WORDS[k]) WORD_TO_KIND[w] = k;

  // [muss passen, darf nicht passen] – geprüft wird gegen Typ, Seltenheit, Kategorie und Adresse eines Treffers
  const KIND_RE = {
    rune: [/\brunes?\b|rune of|\/runes\//i, /runeword/i],
    runeword: [/runeword/i, null],
    gem: [/\bgems?\b|edelstein|\/gems\//i, null],
    aspect: [/\baspects?\b|aspekt|\/aspects\//i, null],
    skill: [/\bskills?\b|\/skills\//i, null],
    charm: [/\bcharms?\b/i, null],
    seal: [/\bseals?\b|siegel/i, null],
    talisman: [/talisman/i, null],
    key: [/\bkeys?\b|schlussel|schlüssel|dungeon[-_]keys|bosssummoning/i, null],
    sigil: [/sigil/i, null],
    material: [/material|crafting[-_]materials/i, null],
    set: [/\bset\b/i, null],
    unique: [/unique/i, null],
    mythic: [/mythic/i, null],
    iconic: [/iconic/i, null],
    legendary: [/legendary|legendar/i, null],
    item: [/\/database\/items\/|\bitems?\b|helm|chest|ring|amulet|boots|gloves|pants|shield|focus|totem|sword|axe|mace|bow|crossbow|staff|wand|dagger|scythe|polearm|glaive|weapon/i, null],
    glyph: [/glyph/i, null],
    affix: [/affix/i, null],
    paragon: [/paragon/i, null],
    mercenary: [/mercenar|soldner|söldner/i, null],
    tribute: [/tribute/i, null],
  };
  // Diese Schlagwörter wählen nur den Ergebnisbereich aus, sie beschreiben kein Item
  const SECTION_ONLY = ['boss', 'recipe', 'activity'];

  /** "ber rune" -> { term: 'ber', kinds: ['rune'] } */
  function parseQuery(query) {
    const tokens = norm(query).split(' ').filter(Boolean);
    const kinds = [], rest = [];
    for (const tk of tokens) {
      const k = WORD_TO_KIND[tk];
      if (k) kinds.push(k); else rest.push(tk);
    }
    // Nur Schlagwörter eingetippt ("runes") -> ganz normal danach suchen
    if (!rest.length) {
      // "crafting", "boss loot", "activities" name a result area – show all of it.
      // "rune" or "gem" on the other hand is a word to search for, so it stays the term.
      const only = Array.from(new Set(kinds));
      if (only.length && only.every((k) => SECTION_ONLY.indexOf(k) >= 0)) return { term: '', kinds: only };
      return { term: tokens.join(' '), kinds: [] };
    }
    return { term: rest.join(' '), kinds: Array.from(new Set(kinds)) };
  }

  /** Passt ein Treffer zu allen Schlagwörtern? `hay` = Typ + Seltenheit + Kategorie + Adresse. */
  function matchesKinds(hay, kinds) {
    if (!kinds || !kinds.length) return true;
    const h = String(hay || '');
    return kinds.every((k) => {
      if (SECTION_ONLY.indexOf(k) >= 0) return true;
      const r = KIND_RE[k];
      if (!r) return true;
      return r[0].test(h) && !(r[1] && r[1].test(h));
    });
  }

  // Welche Ergebnisbereiche sollen gezeigt werden?
  const showItems = (kinds) => !kinds.some((k) => SECTION_ONLY.indexOf(k) >= 0);
  const showBoss = (kinds) => !kinds.length || kinds.indexOf('boss') >= 0;
  const showActs = (kinds) => !kinds.length || kinds.indexOf('activity') >= 0;
  const showCraft = (kinds) => !kinds.length ||
    kinds.some((k) => ['recipe', 'runeword', 'rune', 'gem', 'material', 'tribute', 'key', 'sigil'].indexOf(k) >= 0);

  const api = { norm, lev, search, searchCraft, parseQuery, matchesKinds, showItems, showBoss, showCraft, showActs, KIND_WORDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.SearchLib = api;
})(typeof window !== 'undefined' ? window : globalThis);
