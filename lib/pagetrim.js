'use strict';
// Makes embedded pages use the overlay window well.
//
// The maxroll map tool already has a "maximize" button that drops the whole website around
// the map – pressing it is far more robust than hiding containers ourselves, and the tool
// then resizes with the window on its own. We just press it once after loading.
// For diablo.trade only a little page padding is trimmed.

// Waits for the button and presses it. Does nothing when the map is already maximized
// (then the icon is "minimize"), so it is safe to run again after every load.
const MAP_MAXIMIZE = `(async () => {
  const find = () => document.querySelector('svg[data-icon="maximize"], svg.fa-maximize');
  const done = () => document.querySelector('svg[data-icon="minimize"], svg.fa-minimize');
  for (let i = 0; i < 60; i++) {
    if (done()) return 'already';
    const svg = find();
    if (svg) {
      const host = svg.closest('button,[role=button],a,div[class*="button"]') || svg.parentElement;
      host.click();
      return 'clicked';
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return 'not found';
})()`;

const TRADE_CSS = `
main, [class*="container"] { padding-top: 4px !important; }
`;

/** Called after a page finished loading. Resolves once the page is ready to be seen. */
function apply(wc, kind, log) {
  if (!wc || wc.isDestroyed()) return Promise.resolve();
  if (kind === 'map') {
    return wc.executeJavaScript(MAP_MAXIMIZE)
      .then((r) => { if (log) log('map tool maximize:', r); })
      .catch(() => {});
  }
  if (kind === 'chat' || kind === 'listings') wc.insertCSS(TRADE_CSS).catch(() => {});
  return Promise.resolve();
}

/** Scrolls a guide to one of its headings (by its text) – the page may still be building. */
function scrollToHeading(wc, text) {
  if (!wc || wc.isDestroyed() || !text) return;
  const js = '(async (want) => {' +
    'const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim().toLowerCase();' +
    'for (let i = 0; i < 24; i++) {' +
    '  const h = [...document.querySelectorAll("h1,h2,h3,h4")].find((x) => norm(x.textContent) === norm(want))' +
    '    || [...document.querySelectorAll("h1,h2,h3,h4")].find((x) => norm(x.textContent).startsWith(norm(want)));' +
    '  if (h) { h.scrollIntoView({ block: "start" }); window.scrollBy(0, -90); return true; }' +
    '  await new Promise((r) => setTimeout(r, 250));' +
    '} return false; })(' + JSON.stringify(String(text)) + ')';
  wc.executeJavaScript(js).catch(() => {});
}

module.exports = { apply, scrollToHeading, MAP_MAXIMIZE, TRADE_CSS };
