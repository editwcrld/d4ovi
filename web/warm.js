'use strict';
// Works out every skill's builder page ahead of time – proven builds of every site, each variant
// explained, and the own build – and keeps it in Supabase, so the website opens a skill at once.
// Runs every night on GitHub (.github/workflows/warm.yml); needs SUPABASE_URL and SUPABASE_SECRET.
//
//   node web/warm.js                 every skill with a guide (tier list or a read guide)
//   node web/warm.js --all           every skill
//   node web/warm.js Rogue           one class
const { builderApi, work, refreshFarm, log, store } = require('./core');

(async () => {
  const args = process.argv.slice(2);
  const all = args.includes('--all');
  const only = args.find((a) => !a.startsWith('--'));
  if (!store.canWrite()) log('No SUPABASE_URL / SUPABASE_SECRET – worked out, but not kept.');
  await refreshFarm();
  const cat = await builderApi.catalog();
  if (!Array.isArray(cat)) throw new Error('catalog: ' + (cat && cat.error));
  const todo = [];
  for (const c of cat) {
    if (only && c.cls.toLowerCase() !== only.toLowerCase()) continue;
    for (const s of c.skills) if (all || s.guides > 0 || s.tier) todo.push([c.cls, s.key, s.name]);
  }
  log('Working out', todo.length, 'skills');
  const t0 = Date.now();
  let ok = 0, failed = 0;
  for (const [cls, key, name] of todo) {
    try {
      const out = await work(cls, key);
      if (out.error || (out.plan && out.plan.error)) throw new Error(out.error || out.plan.error);
      ok++;
    } catch (e) { failed++; log('failed:', cls, name, e.message); }
  }
  log('Done:', ok, 'worked out,', failed, 'failed,', Math.round((Date.now() - t0) / 1000), 's');
  process.exit(failed && !ok ? 1 : 0);
})().catch((e) => { log('warm failed:', e.message); process.exit(1); });
