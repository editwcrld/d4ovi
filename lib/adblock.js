'use strict';
// Hides the ads in the embedded pages (diablo.trade, d4guides.gg).
// Two steps: 1. requests to ad / tracking services are never let through,
//            2. the placeholders left empty are collapsed by CSS, so no hole stays.
// Both only touch the views in the overlay – the normal browser is left alone.

const BLOCKED = [
  // Google ads / consent
  'googlesyndication.com', 'googleadservices.com', 'doubleclick.net', 'adservice.google.',
  'fundingchoicesmessages.google.com', 'googletagservices.com',
  // Playwire (diablo.trade)
  'intergient.com', 'playwire.com',
  // weitere Vermarkter / Erkennungsdienste
  'ad-delivery.net', 'amazon-adsystem.com', 'btloader.com', 'confiant-integrations.net',
  'setuptrust.com', 'dns-finder.com', 'taboola.com', 'outbrain.com', 'criteo.',
  // consent dialogs (without tracking there is nothing to consent to)
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

// Only placeholders known to carry ads – content (e.g. ".power-line pw-unique"
// on d4guides) must never be hit.
const CSS = `
/* d4guides.gg */
.ad-reserve, .ad-slot-wrapper, .ad-rail, [data-ad-pristine],
ins.adsbygoogle, #community-banner, #cookie-banner,
/* diablo.trade (Playwire names its slots pw-…; the content itself is #pw-main-content) */
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

/** Collapses the empty ad slots in a loaded page. */
function inject(wc) {
  if (!wc || wc.isDestroyed()) return;
  wc.insertCSS(CSS).catch(() => {});
}

module.exports = { install, inject, isAd, CSS, BLOCKED };
