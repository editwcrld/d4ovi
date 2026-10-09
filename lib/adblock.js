'use strict';
// Werbung in den eingebetteten Seiten (diablo.trade, d4guides.gg) ausblenden.
// Zwei Stufen: 1. Anfragen an Werbe-/Trackingdienste gar nicht erst zulassen,
//              2. die leer gebliebenen Platzhalter per CSS zusammenklappen, damit kein Loch bleibt.
// Beides betrifft nur die Ansicht im Overlay – im normalen Browser ändert sich nichts.

const BLOCKED = [
  // Google-Werbung / Consent
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'adservice.google.',
  'fundingchoicesmessages.google.com', 'googletagservices.com',
  // Playwire (diablo.trade)
  'intergient.com', 'playwire.com',
  // weitere Vermarkter / Erkennungsdienste
  'ad-delivery.net', 'amazon-adsystem.com', 'btloader.com', 'confiant-integrations.net',
  'setuptrust.com', 'dns-finder.com', 'taboola.com', 'outbrain.com', 'criteo.',
  // Zustimmungs-Dialoge (ohne Tracking braucht es keine Einwilligung)
  'cookielaw.org', 'onetrust.com', 'sourcepoint.mgr.consensu.org', 'quantcast.mgr.consensu.org',
  // Statistik
  'google-analytics.com', 'googletagmanager.com', 'cloudflareinsights.com', 'analytics.',
];

const HOST_RE = new RegExp('(^|\\.)(' + BLOCKED.map((h) => h.replace(/[.]/g, '\\.').replace(/\\\.$/, '')).join('|') + ')', 'i');

function isAd(url) {
  try {
    const h = new URL(url).hostname;
    return HOST_RE.test(h);
  } catch (_) { return false; }
}

// Nur Platzhalter, die nachweislich Werbung tragen – Inhalte (z. B. ".power-line pw-unique"
// auf d4guides) dürfen davon nicht getroffen werden.
const CSS = `
/* d4guides.gg */
.ad-reserve, .ad-slot-wrapper, .ad-rail, [data-ad-pristine],
ins.adsbygoogle, #community-banner, #cookie-banner,
/* diablo.trade (Playwire legt seine Flächen als pw-… an; der Inhalt selbst ist #pw-main-content) */
div[id^="pw-"]:not(#pw-main-content):not([id*="content"]),
/* allgemein */
iframe[src*="doubleclick"], iframe[src*="googlesyndication"], iframe[src*="amazon-adsystem"],
iframe[id^="google_ads"], div[id^="google_ads"], .adsbygoogle {
  display: none !important;
  height: 0 !important;
  min-height: 0 !important;
  margin: 0 !important;
  padding: 0 !important;
}
`;

/** Werbeanfragen in einer Session blockieren. */
function install(session, log) {
  let blocked = 0;
  session.webRequest.onBeforeRequest((details, cb) => {
    if (isAd(details.url)) {
      blocked++;
      if (log && blocked % 50 === 1) log('Werbung blockiert:', blocked, 'Anfragen');
      return cb({ cancel: true });
    }
    cb({});
  });
}

/** Leere Werbeflächen in einer geladenen Seite zusammenklappen. */
function inject(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.insertCSS(CSS).catch(() => {});
}

module.exports = { install, inject, isAd, CSS, BLOCKED };
