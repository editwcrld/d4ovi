// Takes the recipes d4builder read out of the guide authors' notes (../d4builder/data/recipes) into
// lib/data/recipes.json – the breakpoints, the rotation, the must-have pieces and why the build works,
// each with the author's words. Run it after d4builder has new recipes:
//   node tools/sync-recipes.js [path to d4builder]
const fs = require('fs');
const path = require('path');

const root = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', 'd4builder'), 'data');
const from = path.join(root, 'recipes');
const to = path.join(__dirname, '..', 'lib', 'data', 'recipes.json');

const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] != null && o[k] !== '' && !(Array.isArray(o[k]) && !o[k].length)).map((k) => [k, o[k]]));
const out = {};
for (const site of fs.readdirSync(from)) {
  for (const f of fs.readdirSync(path.join(from, site))) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(fs.readFileSync(path.join(from, site, f), 'utf8'));
    // the guide's own record: its link and every variant's – how a build in the farm list finds its recipe
    let rec = null;
    try { rec = JSON.parse(fs.readFileSync(path.join(root, 'corpus', r.build + '.json'), 'utf8')); } catch (_) { /* the recipe alone */ }
    out[r.build] = {
      title: rec ? String(rec.title || '').trim() : '', author: rec ? String(rec.author || '').trim() : '',
      // a link several variants share (d2core has one for all) names none of them
      url: rec ? rec.url : '', urls: rec ? Object.fromEntries((rec.variants || []).filter((v) => v.url && rec.variants.filter((w) => w.url === v.url).length === 1).map((v) => [v.url, v.id])) : {},
      cls: r.class, skill: r.skill, summary: r.summary || '', variants: r.variants || {},
      core: (r.core || []).map((x) => pick(x, ['name', 'kind', 'role', 'quote', 'variants'])),
      thresholds: (r.thresholds || []).map((x) => pick(x, ['stat', 'op', 'value', 'unit', 'why', 'quote', 'variants'])),
      rotation: (r.rotation || []).map((x) => pick(x, ['step', 'variants'])),
      options: (r.options || []).map((x) => pick(x, ['when', 'then', 'variants'])),
      extractedAt: r.extractedAt || '',
    };
  }
}
fs.mkdirSync(path.dirname(to), { recursive: true });
fs.writeFileSync(to, JSON.stringify(out));
console.log(Object.keys(out).length, 'recipes ->', to, Math.round(fs.statSync(to).size / 1024) + ' KB');
