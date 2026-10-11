'use strict';
// Is there a newer version? Asks GitHub for the latest release of the repository and compares
// its tag ("v1.2.0") with the running version. Nothing is downloaded or installed – the overlay
// only says so and links to the release page.

const REPO = 'editwcrld/d4ovi';
const API = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const PAGE = 'https://github.com/' + REPO + '/releases/latest';

/** "v1.2.10" -> [1, 2, 10]; anything that is no version -> null. */
function parse(v) {
  const m = String(v || '').trim().match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/i);
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}
/** Is version a newer than version b? */
function newer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * -> { current, latest, newer, url } or { current, error } (offline, no releases, private repo).
 * @param {object} net   Electron's net (anything with fetch)
 */
async function check(net, current) {
  try {
    const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'd4-overlay' } });
    if (res.status === 404) return { current, error: 'no release published yet' };
    if (!res.ok) return { current, error: 'GitHub answered ' + res.status };
    const j = await res.json();
    const latest = String(j.tag_name || j.name || '').replace(/^v/i, '');
    if (!parse(latest)) return { current, error: 'the latest release has no version number' };
    return { current, latest, newer: newer(latest, current), url: j.html_url || PAGE };
  } catch (e) {
    return { current, error: e.message || 'not reachable' };
  }
}

module.exports = { check, newer, parse, PAGE };
