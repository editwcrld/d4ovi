// lib/netfetch.js: a site that does not answer fails after a while instead of hanging forever,
// and is not asked again for a minute.
const assert = require('assert');
const { wrap } = require('../lib/netfetch');

// a stand-in for Electron's net: "slow.test" never answers (until aborted), the rest at once
const asked = [];
const net = {
  fetch: (url, opts) => {
    asked.push(url);
    if (url.includes('slow.test')) {
      return new Promise((_, reject) => opts.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    }
    if (url.includes('broken.test')) return Promise.reject(new Error('ERR_CONNECTION_REFUSED'));
    return Promise.resolve({ ok: true, url, opts });
  },
};

(async () => {
  let t = 0;
  const web = wrap(net, { answerMs: 50, quietMs: 1000, now: () => t });
  const ok = await web.fetch('https://fast.test/a', { headers: { A: '1' } });
  assert.ok(ok.ok && ok.opts.headers.A === '1' && ok.opts.signal, 'an answer comes through, with the options and a signal');

  const t0 = Date.now();
  await assert.rejects(web.fetch('https://slow.test/x'), /slow\.test did not answer within/, 'no answer: it fails');
  assert.ok(Date.now() - t0 < 1000, 'after the time, not never');

  const n = asked.length;
  await assert.rejects(web.fetch('https://slow.test/y'), /not asked again/, 'the same site right after: fails at once');
  assert.strictEqual(asked.length, n, '… without asking it');
  assert.ok((await web.fetch('https://fast.test/b')).ok, 'other sites still answer');

  t = 2000;                           // a minute later (here: a second)
  await assert.rejects(web.fetch('https://slow.test/z'), /did not answer within/, 'asked again later');
  assert.strictEqual(asked.length, n + 2);

  await assert.rejects(web.fetch('https://broken.test/'), /ERR_CONNECTION_REFUSED/, 'a refused connection fails as it is');
  await assert.rejects(web.fetch('https://broken.test/'), /ERR_CONNECTION_REFUSED/, '… and is not held back');
  console.log('ok  a site that does not answer fails after a while, and is left alone for a minute');
})().catch((e) => { console.error(e); process.exit(1); });
