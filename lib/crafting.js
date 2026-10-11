'use strict';
// Reads the crafting cheat sheet from maxroll.gg (mythic crafting, amalgamation, gem / rune conversion,
// classic runewords, accessory cache). The page is made of tables – each one is kept with its
// heading, so the overlay can search for "Enigma", "Jah" or "Amulet".

const VERSION = 1;

function extractCrafting(document, location) {
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const STOP_RE = /^(summary|changelog|related post|follow us|credits)/i;

  // Cells hold item chips glued together ("3x Resplendent Spark3x Eom…").
  // So they are split per child element and joined as a formula ("Jah + Ith + Ber") or a list, by content.
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
    // a new ingredient starts with an amount ("3x …", "150x …") -> listed; anything else belongs to the one before
    // ("5x Any Rare" + "Runes") or is a formula ("Jah" + "+ Ith").
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
