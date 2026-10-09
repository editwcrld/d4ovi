'use strict';
// Liest die Boss-Loot-Tabelle von maxroll.gg aus (läuft in einem unsichtbaren Browserfenster, damit auch JS-gerenderte Inhalte da sind).
// Die Extraktion arbeitet heuristisch auf der Dokumentreihenfolge (Überschrift -> Basic Information -> Klassenlisten),
// damit kleine Layoutänderungen auf maxroll.gg nicht sofort alles kaputt machen.

// Hochzählen, wenn sich die Extraktion ändert -> alte Caches werden automatisch neu geladen.
const VERSION = 3;   // 3: English labels ("All classes")

function extract(document, location) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const CLASS_RE = /^(barbarian|druid|necromancer|rogue|sorcerer|spiritborn|paladin|warlock|multiple classes|all classes)\b/i;
  // Spaltenüberschriften der Pool-Abschnitte, z. B. "Common items (~15% drop rate)"
  const DROP_LABEL_RE = /\b(items?|drops?|runes?|uniques?|rate)\b/i;
  const LOC_RE = /(located|to the (north|south|east|west)|(north|south|east|west)(-?(east|west))? of|near the)/i;
  const MULTI = 'All classes';
  // Abschnitte ohne Loot bzw. Seiten-Beiwerk
  const SKIP_RE = /^(credits|follow us|table of contents|author|bosses overview|we care about your privacy|diablo iv)\b/i;
  const STOP_RE = /^(summary|changelog|related posts)\b/i;   // ab hier kommt nur noch Beiwerk
  // Itemnamen sind kurz und keine Sätze – hält Fließtext aus den Aufzählungen raus
  const isItemish = (t) => t && t.length <= 60 && !/\.\s/.test(t) && !/[.!?]$/.test(t);

  const blocks = [];
  for (const e of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,ul,ol,img,figcaption'))) {
    const tag = e.tagName.toLowerCase();
    if (e.closest('nav,header,footer,aside,script,style,[role="navigation"]')) continue;
    if (tag === 'ul' || tag === 'ol') {
      if (e.parentElement && e.parentElement.closest('ul,ol')) continue;
      const items = Array.from(e.children).filter((c) => c.tagName === 'LI').map((li) => norm(li.textContent)).filter(Boolean);
      blocks.push({ t: 'list', items });
      continue;
    }
    if (e.closest('ul,ol')) continue; // Icons/Embeds innerhalb von Listen
    if (tag === 'img') {
      let src = e.getAttribute('data-src') || e.getAttribute('data-lazy-src') || e.currentSrc || e.getAttribute('src') || '';
      const ss = e.getAttribute('srcset');
      if (!src && ss) src = ss.split(',').pop().trim().split(' ')[0];
      if (!src || src.startsWith('data:')) continue;
      try { src = new URL(src, location.href).href; } catch (_) { continue; }
      const w = e.naturalWidth || parseInt(e.getAttribute('width') || '0', 10) || 0;
      blocks.push({ t: 'img', src, w, alt: norm(e.getAttribute('alt')) });
      continue;
    }
    if (/^h[1-6]$/.test(tag)) { blocks.push({ t: 'h', level: Number(tag[1]), text: norm(e.textContent) }); continue; }
    // Manche Abschnitte (Iconic Mythics) listen ihre Items nicht als <li>, sondern als Item-Chips im Absatz:
    // "<chip>Doombringer</chip> (All but Spiritborn)<chip>El'Druin</chip> (Paladin) …"
    if (tag === 'p') {
      const chips = e.querySelectorAll('[class*="d4-item"]');
      if (chips.length >= 2) {
        const items = [];
        let last = null;
        (function walk(node) {
          for (const c of node.childNodes) {
            if (c.nodeType === 1 && c.matches && c.matches('[class*="d4-item"]')) {
              last = { name: norm(c.textContent), note: '' };
              if (last.name) items.push(last);
            } else if (c.nodeType === 1) walk(c);
            else if (c.nodeType === 3 && last) last.note += c.textContent;
          }
        })(e);
        blocks.push({
          t: 'list',
          items: items.map((i) => {
            const nt = norm(i.note).replace(/^[,;·\s]+|[,;·\s]+$/g, '');
            return /^\(.+\)$/.test(nt) ? i.name + ' ' + nt : i.name;   // "(Druid, Sorc)" wird zur Notiz
          }),
        });
        continue;
      }
    }
    const text = norm(e.textContent);
    if (text) blocks.push({ t: 'p', text });
  }

  // Ebene der Boss-Überschriften = Ebene der nächsthöheren Überschrift vor dem ersten "Basic Information"
  let bossLevel = 2;
  const bi = blocks.findIndex((b) => b.t === 'h' && /^basic information$/i.test(b.text));
  if (bi > 0) {
    for (let i = bi - 1; i >= 0; i--) {
      if (blocks[i].t === 'h' && blocks[i].level < blocks[bi].level) { bossLevel = blocks[i].level; break; }
    }
  }

  const sections = [];
  let cur = null, cls = null, state = '';
  const splitDrop = (txt) => {
    const m = txt.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
    return m ? { name: m[1].trim(), note: m[2].trim() } : { name: txt.trim(), note: '' };
  };
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    // Genau die Boss-Ebene startet einen Abschnitt: H1 (Seitentitel) nicht, H3 ("Mythic Uniques") bleibt beim H2 darüber.
    if (b.t === 'h' && b.level === bossLevel && !/^basic information$/i.test(b.text)) {
      cur = { name: b.text, hasBasic: false, info: [], texts: [], images: [], drops: [] };
      sections.push(cur); cls = null; state = '';
      continue;
    }
    if (!cur) continue;
    if (b.t === 'h' && /^basic information$/i.test(b.text)) { state = 'info'; cls = null; cur.hasBasic = true; continue; }
    const next = blocks[i + 1];
    const label = (b.t === 'h' || b.t === 'p') ? b.text.replace(/:$/, '') : '';
    if ((b.t === 'h' || b.t === 'p') && next && next.t === 'list' && label.length <= 44 &&
        (/:$/.test(b.text) || CLASS_RE.test(label) || DROP_LABEL_RE.test(label))) {
      cls = label; state = 'drops'; continue;
    }
    if (b.t === 'list') {
      // Jede unbeschriftete Liste unter "Basic Information" ist Info, kein Loot
      // (Belial hat zwei davon und gar keine eigene Loot-Liste – sein Table spiegelt den gewählten Boss).
      if (cls === null && state === 'info') { cur.info = cur.info.concat(b.items); continue; }
      for (const it of b.items) { if (isItemish(it)) cur.drops.push(Object.assign({ cls: cls || MULTI }, splitDrop(it))); }
      if (cls !== null) cls = null; // nächste Liste braucht wieder ein eigenes Label
      continue;
    }
    if (b.t === 'img') { cur.images.push(b); continue; }
    if (b.t === 'p' && !/^powered by$/i.test(b.text)) cur.texts.push(b.text);
  }

  const out = [];
  for (const s of sections) {
    if (STOP_RE.test(s.name)) break;
    // Abschnitte ohne "Basic Information" sind die Loot-Pools (New Season Uniques, General Unique Pool,
    // Non-Boss Uniques, Uniques from Boss Trophies, Rune Drops, Mythics) -> die gehören mit in die Suche.
    if ((!s.drops.length && !s.info.length) || SKIP_RE.test(s.name)) continue;
    const location = s.texts.find((t) => LOC_RE.test(t)) || '';
    const notes = s.texts.filter((t) => t !== location).join(' ').slice(0, 600);
    // große Bilder zuerst (Icons/Embeds sind klein), Reihenfolge sonst wie auf der Seite
    const imgs = s.images.filter((x) => x.w === 0 || x.w >= 250).map((x) => x.src);
    out.push({ name: s.name, isBoss: s.hasBasic, info: s.info, location, notes, images: Array.from(new Set(imgs)).slice(0, 4), drops: s.drops });
  }
  return { url: location.href, fetchedAt: Date.now(), sections: out };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeMaxroll(BrowserWindow, url) {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 2000,
    webPreferences: { partition: 'maxroll', backgroundThrottling: false, contextIsolation: true },
  });
  try {
    await win.loadURL(url);
    let result = null;
    for (let i = 0; i < 10 && !result; i++) {
      await sleep(i === 0 ? 2500 : 1500);
      // runterscrollen, damit Lazy-Images ihre echte URL bekommen
      await win.webContents.executeJavaScript(
        '(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=900){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);})()'
      );
      const json = await win.webContents.executeJavaScript(`JSON.stringify((${extract.toString()})(document, location))`);
      const r = JSON.parse(json);
      if (r.sections.length >= 3) { r.version = VERSION; result = r; }   // VERSION gibt es nur hier, nicht im Seitenkontext
    }
    if (!result) throw new Error('Keine Boss-Abschnitte gefunden (Seitenstruktur geändert?)');
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { scrapeMaxroll, extract, VERSION };
