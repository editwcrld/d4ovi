// Parsing of a maxroll guide page – no network, fixed input.
const assert = require('assert');
const acts = require('../lib/activities');

const HTML = `<html><head>
<title>Secret Cow Level Guide - D4 Maxroll.gg</title>
<meta name="description" content="Diablo 4 Secret Cow Level guide with details on how to unlock the secret cow level and defeat the Cow King!">
</head><body>
<h1>Secret Cow Level</h1>
<h2>TLDR; Unlocking The Secret Cow Level</h2>
<h2>Part 1 - Stamina Potion</h2>
<h2>Part 2 - Rusted Bardiche</h2>
<h2>Neyrelle&#x27;s Hand</h2>
<h2>Summary</h2><h2>Changelog</h2><h2>Video Guide</h2>
</body></html>`;

const a = acts.parse(HTML, 'resources/secret-cow-level', 'Secret Cow Level', '🐄');

assert.strictEqual(a.name, 'Secret Cow Level');
assert.ok(a.desc.includes('Cow King'), 'description taken from the meta tag');
assert.ok(a.url.endsWith('/d4/resources/secret-cow-level'), 'url built from the slug');
assert.deepStrictEqual(a.sections.slice(0, 4), [
  'TLDR; Unlocking The Secret Cow Level', 'Part 1 - Stamina Potion', 'Part 2 - Rusted Bardiche', "Neyrelle's Hand",
], 'chapters kept, html entity decoded');
assert.ok(!a.sections.some((s) => /summary|changelog|video guide/i.test(s)), 'boilerplate chapters dropped');

// search works over name, description and chapters
acts.setList([a]);
assert.strictEqual(acts.search('cow').length, 1, 'found by name');
assert.strictEqual(acts.search('bardiche').length, 1, 'found by a chapter name');
assert.strictEqual(acts.search('zagraal').length, 0, 'no false positive');

console.log('ok  activity parsed:', a.name, '·', a.sections.length, 'chapters ·', a.desc.length, 'chars of description');
console.log('ok  search by name / chapter / miss');
