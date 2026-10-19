// The bridge between the page and the main process: every channel preload.js uses is served by
// main.js or one of the lib/*ipc.js modules (and nothing is served that nobody asks for), and the
// modules register what they should.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pre = read('preload.js');
const used = new Set([...pre.matchAll(/ipcRenderer\.(?:invoke|send)\('([^']+)'/g)].map((m) => m[1]));
const sources = ['main.js', ...fs.readdirSync(path.join(ROOT, 'lib')).filter((f) => /ipc\.js$/.test(f)).map((f) => 'lib/' + f)];
const served = new Set(sources.flatMap((f) => [...read(f).matchAll(/\b(?:ipcMain|ipc)\.(?:handle|on)\('([^']+)'/g)].map((m) => m[1])));
assert.ok(used.size > 40, 'the channels are found');
assert.deepStrictEqual([...used].filter((c) => !served.has(c)), [], 'every channel the page uses is served');
assert.deepStrictEqual([...served].filter((c) => !used.has(c)), [], 'nothing served that nobody asks for');
console.log('ok  every channel of preload.js is served (' + used.size + ')');

// the modules, with a stand-in for ipcMain
const fake = () => { const h = {}; return { h, handle: (c, fn) => { h[c] = fn; } }; };
const catalog = () => ({ items: [], aspects: [], slots: [] });
const s = fake();
require('../lib/searchipc').register(s, { net: null, catalog });
assert.deepStrictEqual(Object.keys(s.h).sort(), ['icons:get', 'items:search']);
assert.strictEqual(typeof s.h['icons:get'](), 'object', 'a picture map, also without data');
console.log('ok  lib/searchipc.js: pictures and the item search');

const b = fake();
const opened = [];
require('../lib/buildsipc').register(b, { net: null, log: () => {}, catalog, clipboard: { writeText: () => {} }, shell: { openExternal: (u) => opened.push(u) },
  saveDialog: async () => ({ canceled: true }), openDialog: async () => ({ canceled: true, filePaths: [] }), documents: () => ROOT });
for (const c of ['farm:get', 'farm:tooltip', 'farm:css', 'builds:get', 'builds:save', 'builds:link', 'builds:sheet', 'builds:tree', 'builds:paragon',
  'builds:open-source', 'builds:code', 'builds:import-text', 'builds:export', 'builds:import-file',
  'builder:catalog', 'builder:plan', 'builder:proven', 'builder:save', 'builder:preview']) assert.ok(b.h[c], c);
assert.strictEqual(b.h['builds:open-source'](null, 'https://maxroll.gg/d4/build-guides/x'), true, 'a build site opens');
assert.strictEqual(b.h['builds:open-source'](null, 'https://evil.example/x'), false, 'anything else does not');
assert.deepStrictEqual(opened, ['https://maxroll.gg/d4/build-guides/x']);
(async () => {
  assert.strictEqual(await b.h['builds:export'](), null, 'export cancelled: nothing written');
  assert.strictEqual(await b.h['builds:import-file'](), null, 'import cancelled: nothing added');
  console.log('ok  lib/buildsipc.js: farm list, builds and builder; only build sites open');
})().catch((e) => { console.error(e); process.exit(1); });
