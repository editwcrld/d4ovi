'use strict';
// Every request the app makes goes through here (main.js wraps Electron's net once and hands the
// wrapper to every module): a site that does not answer must not leave a page waiting forever –
// a firewall that drops the packets silently would.
//   – no answer within ANSWER_MS: the request fails ("… did not answer"); once the answer has
//     begun, a big download takes as long as it needs
//   – a site that did not answer is not asked again for QUIET_MS: the next requests to it fail
//     at once, so a page that asks one site many times (the proven builds) is not held up again

const ANSWER_MS = 15000;
const QUIET_MS = 60000;

/**
 * @param net  anything with fetch(url, opts) – Electron's net, or a stand-in in the tests
 * @param o    { answerMs, quietMs, now } – for the tests
 * @returns {{ fetch(url, opts): Promise<Response> }}
 */
function wrap(net, o = {}) {
  const answerMs = o.answerMs || ANSWER_MS, quietMs = o.quietMs || QUIET_MS;
  const now = o.now || Date.now;
  const silent = new Map();            // host -> until when it is not asked
  const hostOf = (url) => { try { return new URL(String(url)).host; } catch (_) { return ''; } };

  async function fetch(url, opts) {
    const host = hostOf(url);
    if (host && silent.get(host) > now()) throw new Error(host + ' did not answer – not asked again for a minute');
    const ctl = new AbortController();
    // the caller's own signal still counts
    if (opts && opts.signal) opts.signal.addEventListener('abort', () => ctl.abort(), { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; ctl.abort(); }, answerMs);
    try {
      const res = await net.fetch(url, Object.assign({}, opts, { signal: ctl.signal }));
      silent.delete(host);
      return res;
    } catch (e) {
      if (timedOut) {
        if (host) silent.set(host, now() + quietMs);
        throw new Error((host || 'the site') + ' did not answer within ' + Math.round(answerMs / 1000) + ' s');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  return { fetch };
}

module.exports = { wrap, ANSWER_MS, QUIET_MS };
