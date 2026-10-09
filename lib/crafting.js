'use strict';
// Liest die Crafting-Übersicht von maxroll.gg (Mythic Crafting, Amalgamation, Gem-/Rune-Conversion,
// klassische Runenwörter, Accessory Cache). Die Seite besteht aus Tabellen – jede Tabelle wird mit ihrer
// Überschrift übernommen, damit man im Overlay nach "Enigma", "Jah" oder "Amulet" suchen kann.

const VERSION = 1;

function extractCrafting(document, location) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const STOP_RE = /^(summary|changelog|related post|follow us|credits)/i;

  // Zellen enthalten aneinandergeklebte Item-Chips ("3x Resplendent Spark3x Eom…").
  // Deshalb pro Kindelement trennen und je nach Inhalt als Formel ("Jah + Ith + Ber") oder Liste zusammensetzen.
  function cellText(td) {
    const parts = [];
    let buf = '';
    for (const c of td.childNodes) {
      if (c.nodeType === 3) buf += c.textContent;
      else if (c.nodeType === 1) { buf += c.textContent; parts.push(norm(buf)); buf = ''; }
    }
    if (norm(buf)) parts.push(norm(buf));
    const list = parts.filter(Boolean);
    if (!list.length) return norm(td.textContent);
    // Neue Zutat beginnt mit einer Menge ("3x …", "150x …") -> aufzählen; sonst gehört es zum Vorherigen
    // ("5x Any Rare" + "Runes") bzw. ist eine Formel ("Jah" + "+ Ith").
    return list.reduce((acc, p, i) => (i === 0 ? p : acc + (/^\d/.test(p) ? ' · ' : ' ') + p), '');
  }

  const tables = [];
  let h2 = '', sub = '';
  for (const e of Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,table'))) {
    if (e.closest('nav,header,footer,aside,script,style,[role="navigation"]')) continue;
    const tag = e.tagName.toLowerCase();
    if (tag !== 'table') {
      const text = norm(e.textContent);
      if (STOP_RE.test(text)) break;
      if (tag === 'h1' || tag === 'h2') { h2 = text; sub = ''; } else sub = text;
      continue;
    }
    const rows = Array.from(e.rows).map((r) => Array.from(r.cells).map(cellText));
    if (rows.length < 2) continue;
    const cols = rows[0];
    const body = rows.slice(1).filter((r) => r.some((c) => c));
    if (!body.length) continue;
    tables.push({ group: h2, sub, cols, rows: body });
  }
  return { url: location.href, fetchedAt: Date.now(), tables };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function scrapeCrafting(BrowserWindow, url) {
  const win = new BrowserWindow({
    show: false, width: 1280, height: 2000,
    webPreferences: { partition: 'maxroll', backgroundThrottling: false, contextIsolation: true },
  });
  try {
    await win.loadURL(url);
    let result = null;
    for (let i = 0; i < 8 && !result; i++) {
      await sleep(i === 0 ? 2500 : 1500);
      await win.webContents.executeJavaScript(
        '(async()=>{const h=document.body.scrollHeight;for(let y=0;y<h;y+=900){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,60));}window.scrollTo(0,0);})()'
      );
      const json = await win.webContents.executeJavaScript(`JSON.stringify((${extractCrafting.toString()})(document, location))`);
      const r = JSON.parse(json);
      if (r.tables.length >= 4) { r.version = VERSION; result = r; }
    }
    if (!result) throw new Error('Keine Crafting-Tabellen gefunden (Seitenstruktur geändert?)');
    return result;
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
}

module.exports = { scrapeCrafting, extractCrafting, VERSION };
