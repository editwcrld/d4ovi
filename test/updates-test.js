// Update check: version numbers and what GitHub's answers turn into.
//   node test/updates-test.js
const assert = require('assert');
const { newer, parse, check } = require('../lib/updates');

assert.deepStrictEqual(parse('v1.2.10'), [1, 2, 10]);
assert.deepStrictEqual(parse('2'), [2, 0, 0]);
assert.strictEqual(parse('beta'), null);
assert.ok(newer('1.0.1', '1.0.0') && newer('v1.10.0', '1.9.9') && newer('2', '1.99.99'));
assert.ok(!newer('1.0.0', '1.0.0') && !newer('1.0.0', '1.0.1') && !newer('x', '1.0.0'));
console.log('ok  version numbers');

const fake = (status, body) => ({ fetch: async () => ({ status, ok: status < 300, json: async () => body }) });
(async () => {
  let r = await check(fake(200, { tag_name: 'v1.1.0', html_url: 'https://github.com/editwcrld/d4ovi/releases/tag/v1.1.0' }), '1.0.0');
  assert.ok(r.newer && r.latest === '1.1.0' && /v1\.1\.0$/.test(r.url));
  r = await check(fake(200, { tag_name: 'v1.0.0' }), '1.0.0');
  assert.ok(!r.newer && !r.error);
  r = await check(fake(404, {}), '1.0.0');
  assert.strictEqual(r.error, 'no release published yet');
  r = await check({ fetch: async () => { throw new Error('offline'); } }, '1.0.0');
  assert.strictEqual(r.error, 'offline');
  console.log('ok  GitHub answers: newer, current, none, offline');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
