'use strict';
// Builder: pick a class, then the skill to play – see the proven builds for it explained, what
// they agree on, or build it yourself with every piece weighed by the damage model.
//
// The model and the optimizer (lib/dmgmodel.js, lib/optimizer.js) run here as well, so switching
// a conditional boost, swapping a piece or changing the goal is worked out on the spot; the main
// process does the heavy reading once (game data, imports of the proven builds).
// Every class name carries "bd-" – the builder has its own look and must not take the overlay's.
(function () {
const M = window.DmgModel, O = window.Optimizer;
const SKILL_ICON = (id) => (id ? 'https://cloudstorage.d2core.com/data_img/d4/skill/' + id + '.png' : '');
const KEEP = new Set(['btn', 'pri', 'sm']);
const E = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = String(cls).split(/\s+/).filter(Boolean).map((c) => (KEEP.has(c) ? c : 'bd-' + c)).join(' ');
  if (txt != null) e.textContent = txt;
  return e;
};
// a piece without a picture (or one that does not load) gets a generic one: an aspect's sigil, a unique's gem
const GENERIC = '<svg viewBox="0 0 24 24" class="bd-gen"><path d="M12 2.5l2.6 6.2 6.7.6-5.1 4.4 1.6 6.6L12 16.8l-5.8 3.5 1.6-6.6-5.1-4.4 6.7-.6z"/></svg>';
const pic = (src, cls) => {
  const w = E('span', cls);
  const generic = () => { w.insertAdjacentHTML('beforeend', GENERIC); };
  if (src) { const i = document.createElement('img'); i.className = 'bd-ico'; i.src = src; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.onerror = () => { i.remove(); generic(); }; w.appendChild(i); }
  else if (/(aspect|unique|mythic)/.test(String(cls))) generic();
  return w;
};
const pct = (v) => (!isFinite(v) ? 'essential' : (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '%');
const SLOT_NAME = { 'Chest Armor': 'Chest', Ring1: 'Ring', Ring2: 'Ring' };
/** A slot as the player knows it – a weapon by its kind ("Two-Handed Slashing"). */
const slotName = (p, s) => (p && p.engine && p.engine.labels && p.engine.labels[s] && p.engine.labels[s] !== s ? p.engine.labels[s] : SLOT_NAME[s] || s);
const LEFT = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots'], RIGHT = ['Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand'];
const GOAL_LABEL = { push: 'Pit push', speed: 'Speed farm', boss: 'Bosses' };
const SITE = { 'maxroll.gg': 'maxroll', 'd2core.com': 'd2core', 'infinitybuilds.gg': 'infinitybuilds' };

let ctx = null, api = null;
let catalog = null, catalogErr = '';
const S = { step: 'class', cls: null, key: null, view: 'build', src: null, slot: null, skill: null, q: '' };
const PLANS = {};       // key -> plan (+ proven when loaded)
const STATE = {};       // key -> { on, forced, goal, mods, result, souls, par }


const rerender = () => { if (ctx) ctx.rerender(); };
const go = (patch) => { Object.assign(S, patch); rerender(); };

// the overlay's one hover card (renderer/ui.js)
const untip = () => UI.tip.hide();
const hover = (node, title, text) => UI.tip.bind(node, () => ({ title, lines: [text || ''] }), '', 60);
/** A card on hover – built when the mouse comes, in the farm list's card style (.ctt). */
const hoverCard = (node, build) => UI.tip.bind(node, build, 'card', 60);
const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
/**
 * A piece's card: name, kind and slot, its power, the stats to look for – ✦ on the one a Greater
 * Affix is worth most on, ⚒ the tempers – and what goes into its sockets.
 */
function pieceCard(o) {
  const d = mk('div', 'ctt');
  d.appendChild(mk('div', 'nm ' + (o.mythic ? 'r-mythic' : o.kind === 'unique' ? 'r-unique' : 'r-legendary'), o.name));
  d.appendChild(mk('div', 'ty', (o.kind === 'aspect' ? 'Legendary aspect' : o.mythic ? 'Mythic unique' : o.runeword ? 'Runeword' : 'Unique') + ' · ' + o.slot));
  if (o.desc) d.appendChild(mk('div', 'sec ds', o.desc));
  // one temper per item – the Blacksmith takes one
  const lines = (o.stats || []).map((x) => Object.assign({}, x, x.best ? { mw: 1 } : {}))
    .concat((o.tempers || []).slice(0, 1).map((x) => ({ t: x.t, tmp: 1, how: [x.cat, x.g].filter(Boolean).join(' · ') })));
  if (lines.length) {
    const st = mk('div', 'sec');
    lines.forEach((x) => st.appendChild(SCard.statLine(x)));
    d.appendChild(st);
  }
  if ((o.sockets || []).length) d.appendChild(mk('div', 'sec sock', '◆ ' + o.sockets.join(' · ')));
  if (o.share) d.appendChild(mk('div', 'sec hint', o.share));
  const lg = SCard.craftLegend(lines); if (lg) d.appendChild(lg);
  return d;
}

// ---------------- data ----------------
async function loadCatalog() {
  if (catalog || catalogErr) return;
  const r = await api.builderCatalog();
  if (!r || r.error) catalogErr = (r && r.error) || 'The game data could not be loaded.'; else catalog = r;
  rerender();
}
async function loadPlan(key) {
  const st = STATE[key] || (STATE[key] = { on: null, forced: {}, goal: 'push', mods: {}, souls: 100 });
  // the website asks for both at once and shows the page when the proven builds and the own one are there
  if (api.builderFull) {
    const r = await api.builderFull(S.cls, key);
    const p = r && r.plan;
    if (!p || p.error) { PLANS[key] = { error: (p && p.error) || (r && r.error) || 'No plan for this skill.' }; rerender(); return; }
    PLANS[key] = Object.assign(PLANS[key] || {}, p, { provenLoaded: true });
    if (!st.on) st.on = Object.assign({}, p.on);
    adoptProven(key, r.proven);
    rerender();
    return;
  }
  const p = await api.builderPlan(S.cls, key, {});
  if (!p || p.error) { PLANS[key] = { error: (p && p.error) || 'No plan for this skill.' }; rerender(); return; }
  PLANS[key] = Object.assign(PLANS[key] || {}, p);
  if (!st.on) st.on = Object.assign({}, p.on);
  rerender();
  // the proven builds take a few seconds – imported and explained in the main process
  const pr = await api.builderProven(S.cls, key);
  const plan = PLANS[key];
  plan.provenLoaded = true;
  if (pr && !pr.error && pr.reference) {
    // measured again at the level the proven builds reach (lib/builder.js, reference)
    const again = await api.builderPlan(S.cls, key, {});
    if (again && !again.error) Object.assign(plan, { engine: again.engine, reference: again.reference, talisman: again.talisman, gear: again.gear, bar: again.bar, paragon: again.paragon, loop: again.loop, loopPassive: again.loopPassive, facts: again.facts, tag: again.tag, charms: again.charms });
  }
  adoptProven(key, pr);
  rerender();
}
/** The proven builds into the plan: the pieces' use counts, the own build seeded from what they agree on. */
function adoptProven(key, pr) {
  const plan = PLANS[key], st = STATE[key];
  if (pr && !pr.error) {
    plan.proven = pr.proven; plan.consensus = pr.consensus;
    for (const c of plan.engine.cands) c.used = pr.usage[c.name] || 0;
    seedFromConsensus(plan, st);
    if (S.key === key && S.src === 'own' && !S.touched && pr.proven.length) S.src = 0;
  } else plan.provenError = (pr && pr.error) || '';
}
/** A proven build in the variant picked (starter, endgame, pit push …) – the one its site opens on at first. */
function variantOf(b) {
  const st = STATE[S.key] || {};
  const i = st.vpick && st.vpick[b.url] != null ? st.vpick[b.url] : b.pick || 0;
  const v = (b.variants || []).find((x) => x.i === i);
  return v ? { i, name: v.name, explain: v.explain, sheet: v.sheet, setup: v.setup } : { i: b.pick || 0, name: '', explain: b.explain, sheet: b.sheet, setup: b.setup };
}

/**
 * "Build it yourself" starts where the top builds agree – their most used piece per slot (two
 * rings, one mythic) – and the model fills only what they leave open. Text-read numbers cannot
 * see everything that makes a build (procs, set and runeword interplay), the players' choice can.
 */
function seedFromConsensus(p, st) {
  if (st.seeded || Object.keys(st.forced).length || !p.consensus || !p.consensus.n) return;
  const byName = new Map(p.engine.cands.map((c) => [c.name, c]));
  const taken = new Set();
  let mythic = false;
  const put = (slot, list) => {
    for (const e of list || []) {
      const c = byName.get(e.name);
      if (!c || taken.has(c.name) || !O.fits(c, slot) || (c.mythic && mythic) || e.n < 2) continue;
      if (slot === 'Off-Hand' && st.forced.Weapon && (byName.get(st.forced.Weapon) || {}).blocks) return;
      st.forced[slot] = c.name; taken.add(c.name); if (c.mythic) mythic = true;
      return;
    }
  };
  for (const slot of p.engine.slots) put(slot, p.consensus.slots[slot.replace(/\d$/, '')]);
  st.seeded = 'consensus';
}

// ---------------- engine in the page ----------------
function compute(key) {
  const p = PLANS[key];
  const st = STATE[key];
  const eng = p.engine;
  const w = O.GOALS[st.goal || 'push'];
  const cands = eng.cands;
  const base = baseOf(p, st);
  // pieces the player put in themselves stay; the optimizer fills the rest around them
  const forced = {};
  for (const [slot, name] of Object.entries(st.forced)) {
    const c = cands.find((x) => x.name === name);
    if (c) forced[slot] = c;
  }
  const r = O.fillGear(cands, base, st.on, w, eng.slots, eng.rolls, forced);
  // the stats and tempers for the pieces as they now stand – and the breakpoints their loop needs
  let rolls = eng.rolls;
  if (eng.statOpts) {
    rolls = O.pickRolls(eng.statOpts, base, st.on, w, eng.slots, r.placed, eng.rolls);
    rolls = O.chase(eng.statOpts, base, st.on, w, eng.slots, r.placed, rolls);
  }
  const sh = O.shares(cands, r.placed, base, st.on, w, rolls, eng.slots);
  st.result = { placed: r.placed, shares: sh.out, full: sh.full, rolls };
  return st;
}
// the souls the player holds and the regeneration they read off the character sheet go into every state
const baseOf = (p, st) => Object.assign({}, p.engine.state, { souls: st.souls }, st.baseRegen != null ? { baseRegen: st.baseRegen } : {});
/** The model state with these pieces on their slots – a legendary with its rolls, a unique with its own stats. */
const rollsOf = (p, st) => (st.result && st.result.rolls) || p.engine.rolls;
const stateWith = (p, st, placed, on) => O.stateOf(baseOf(p, st), placed, on, rollsOf(p, st), p.engine.slots);
function swapGainAt(p, st, c, slot) {
  const placed = st.result.placed;
  if (c.mythic && Object.entries(placed).some(([s, x]) => x.mythic && s !== slot)) return null;
  if (Object.entries(placed).some(([s, x]) => s !== slot && x.name === c.name)) return null;
  if (placed[slot] && placed[slot].kind === 'blocked') return null;
  const next = Object.assign({}, placed, { [slot]: c });
  if (slot === 'Weapon') {
    for (const b of (placed.Weapon && placed.Weapon.blocks) || []) next[b] = null;
    for (const b of c.blocks || []) if (p.engine.slots.includes(b)) next[b] = O.BLOCKED;
  }
  const d = O.delta(st.result.full, stateWith(p, st, next, st.on));
  return { slot, dmg: d.dmg, tough: d.tough, speed: d.speed, v: O.value(d, O.GOALS[st.goal || 'push']) };
}
function swapGain(p, st, c) {
  let best = null;
  for (const slot of p.engine.slots) {
    if (!O.fits(c, slot)) continue;
    if (st.result.placed[slot] && st.result.placed[slot].name === c.name) return { slot, dmg: 0, tough: 0, here: true };
    const g = swapGainAt(p, st, c, slot);
    if (g && (!best || g.v > best.v)) best = g;
  }
  return best;
}

// ---------------- frame ----------------
let shownAt = '';
function render(main, c) {
  // a card left open from the page before goes with it – a redraw of the same page keeps it
  const at = [S.step, S.key, S.view, S.src, S.slot, S.skill].join('|');
  if (at !== shownAt) untip();
  shownAt = at;
  ctx = c; api = c.api;
  main.classList.add('bd');
  const head = E('div', 'head');
  const cr = E('nav', 'crumbs');
  const crumb = (txt, fn) => { const b = E(fn ? 'button' : 'span', fn ? null : 'cur', txt); if (fn) b.onclick = fn; cr.appendChild(b); };
  if (S.step === 'class') crumb('Pick a class');
  else {
    crumb('Class', () => go({ step: 'class' }));
    cr.appendChild(E('span', null, '›'));
    if (S.step === 'skill') crumb(S.cls);
    else { crumb(S.cls, () => go({ step: 'skill' })); cr.appendChild(E('span', null, '›')); crumb((PLANS[S.key] && PLANS[S.key].skill && PLANS[S.key].skill.name) || '…'); }
  }
  head.appendChild(cr);
  head.appendChild(E('span', 'sp'));
  const p = S.step === 'plan' && PLANS[S.key];
  if (p && p.engine) {
    const v = E('div', 'views');
    [['build', 'Build'], ['skills', 'Skills'], ['paragon', 'Paragon'], ['goals', 'Goals']].forEach(([k, l]) => { const b = E('button', S.view === k ? 'on' : '', l); b.onclick = () => go({ view: k }); v.appendChild(b); });
    head.appendChild(v);
    const save = E('button', 'btn pri', S.saving ? 'Saving …' : 'Save as build');
    save.title = 'Into the farm list – every piece with where it drops, the skills and the paragon';
    // one save at a time: greyed out with a spinner until the answer is back
    if (S.saving) { save.disabled = true; save.prepend(E('i', 'spin')); }
    save.onclick = () => saveBuild(p);
    head.appendChild(save);
  }
  main.appendChild(head);
  const body = E('div', 'body');
  main.appendChild(body);
  if (S.step === 'class') stepClass(body);
  else if (S.step === 'skill') stepSkill(body);
  else stepPlan(body);
}

async function saveBuild(p) {
  if (S.saving) return;
  S.saving = true;
  rerender();
  try { await saveNow(p); } finally { S.saving = false; rerender(); }
}
async function saveNow(p) {
  const st = STATE[S.key];
  // the same picks the Skills / Paragon / Talisman preview was made from – and the rolls the sheet
  // shows per slot, so the farm list gets exactly what was on screen
  const picks = picksOf(p, st);
  if (!picks.url) {
    picks.name = p.skill.name + ' ' + p.cls;
    picks.rolls = Object.fromEntries(Object.entries(st.result.placed).filter(([, c]) => c && c.name && c.kind !== 'blocked').map(([s, c]) => [s, rollLines(p, st, s, c)]));
  }
  const r = await api.builderSave(S.cls, S.key, picks);
  if (!r || r.error || !r.added) { ctx.note((r && r.error) || 'Could not save the build.', 'error'); return; }
  if (window.FarmView && window.FarmView.adopt) window.FarmView.adopt(r.data);
  ctx.note('Saved – it is the active build in the farm list now.', 'ok');
  if (ctx.openFarm) ctx.openFarm();
}

// ---------------- step 1 + 2 ----------------
function stepClass(body) {
  loadCatalog();
  const l = E('p', 'lead'); l.innerHTML = 'Pick a class, then the skill that should do your damage. You get the <b>proven builds</b> for it explained – or build it yourself, with every piece weighed by what it adds.';
  body.appendChild(l);
  if (catalogErr) { body.appendChild(E('p', 'err', catalogErr)); return; }
  if (!catalog) { body.appendChild(E('p', 'wait', 'Loading the game data …')); return; }
  const g = E('div', 'classes');
  for (const c of catalog) {
    const b = E('button', 'cls');
    b.appendChild(E('b', null, c.cls));
    b.appendChild(E('span', null, c.main + ' · ' + c.resource));
    const n = c.skills.filter((s) => s.tier === 'S' || s.tier === 'A').length;
    if (n) b.appendChild(E('span', 'tierline', n + ' skills with S / A guides'));
    b.onclick = () => go({ step: 'skill', cls: c.cls });
    g.appendChild(b);
  }
  body.appendChild(g);
}

function stepSkill(body) {
  const c = catalog && catalog.find((x) => x.cls === S.cls);
  if (!c) { go({ step: 'class' }); return; }
  const l = E('p', 'lead'); l.innerHTML = 'Which skill should do the damage? The ones with guides come first – by maxroll tier, then the guides on d4builds, infinitybuilds and d2core.';
  body.appendChild(l);
  const button = (s) => {
    const b = E('button', 'sk');
    b.appendChild(pic(SKILL_ICON(s.icon), 'si'));
    b.appendChild(E('span', 'nm', s.name));
    if (s.guides) b.appendChild(E('span', 'gcount', s.guides + (s.guides === 1 ? ' guide' : ' guides')));
    if (s.tier) b.appendChild(E('span', 'tier ' + s.tier, s.tier));
    hover(b, s.name, (s.el ? s.el + ' · ' : '') + s.desc);
    b.onclick = () => { untip(); S.touched = false; go({ step: 'plan', key: s.key, view: 'build', src: 'own', slot: null, skill: null, q: '' }); if (!PLANS[s.key] || PLANS[s.key].error) loadPlan(s.key); };
    return b;
  };
  const section = (title, list) => {
    if (!list.length) return;
    const sec = E('section', 'cat');
    sec.appendChild(E('h4', null, title));
    const g = E('div', 'sgrid');
    list.forEach((s) => g.appendChild(button(s)));
    sec.appendChild(g);
    body.appendChild(sec);
  };
  // S, A, B … each tier a row of its own; the skills without a guide after them, by kind
  const TIERS = 'SABCD';
  for (const t of TIERS) section(t + '-Tier guide', c.skills.filter((s) => s.tier === t).sort((a, b) => a.name.localeCompare(b.name)));
  const byGuides = (a, b) => (b.guides || 0) - (a.guides || 0) || a.name.localeCompare(b.name);
  section('Guides on other sites', c.skills.filter((s) => !TIERS.includes(s.tier || '-') && s.guides).sort(byGuides));
  const rest = c.skills.filter((s) => !TIERS.includes(s.tier || '-') && !s.guides);
  const order = ['Basic', 'Core'];
  const cats = [...new Set(rest.map((s) => s.cat))].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  for (const cat of cats) section(cat + ' · no guide yet', rest.filter((x) => x.cat === cat));
}

// ---------------- step 3 ----------------
function stepPlan(body) {
  const p = PLANS[S.key];
  if (!p || (!p.engine && !p.error)) { body.appendChild(E('p', 'wait', 'Working out the build …')); return; }
  if (p.error) { body.appendChild(E('p', 'err', p.error)); return; }
  const st = STATE[S.key];
  const hero = E('div', 'hero');
  hero.appendChild(pic(SKILL_ICON(p.skill.icon), 'hi'));
  const t = E('div');
  t.appendChild(E('h3', null, p.skill.name));
  const ch = E('div', 'chips');
  [p.cls, p.skill.el, p.skill.dot ? 'Damage over time · cannot crit' : 'Direct hits · can crit', p.skill.cd ? 'Cooldown' : null, p.skill.spender ? 'Costs ' + p.resource : null, p.skill.channeled ? 'Channeled' : null]
    .filter(Boolean).forEach((x, i) => ch.appendChild(E('span', 'chip' + (i === 0 ? ' acc' : ''), x)));
  t.appendChild(ch);
  hero.appendChild(t);
  body.appendChild(hero);
  if (S.view === 'skills' || S.view === 'paragon') return farmView(body, p, S.view);
  if (S.view === 'goals') return goalsView(body, p);

  // where the build comes from
  const strip = E('div', 'srcs');
  (p.proven || []).forEach((b, i) => {
    const c = E('button', 'src' + (S.src === i ? ' on' : ''));
    const top = E('span', 'st');
    top.appendChild(E('span', 'site ' + (SITE[b.site] || ''), SITE[b.site] || b.site));
    top.appendChild(E('span', b.tier ? 'tier ' + b.tier : 'likes', b.tier ? b.tier + '-Tier' : b.likes ? '♥ ' + b.likes : 'guide'));
    c.appendChild(top);
    c.appendChild(E('b', null, b.title.replace(/\s+/g, ' ').slice(0, 70)));
    const nv = (b.variants || []).length;
    c.appendChild(E('span', 'au', (b.author ? b.author + ' · ' : '') + (nv > 1 ? nv + ' variants' : String(b.variant || '').split('–').pop().trim().slice(0, 30))));
    // the author's breakpoints at a glance (lib/guideinfo.js)
    // the lines for every variant; a guide that only has some per variant (d2core: early / late) – its last one's
    const all = (b.sheet && b.sheet.thresholds) || [];
    const lastFor = all.filter((t) => t.for).map((t) => t.for[t.for.length - 1]).pop();
    const bps = (all.some((t) => !t.for) ? all.filter((t) => !t.for) : all.filter((t) => t.for.includes(lastFor))).slice(0, 3);
    if (bps.length) { const r = E('span', 'bps'); bps.forEach((t) => { const x = E('span'); x.appendChild(E('b', null, window.BuildGuide.figure(t))); x.appendChild(document.createTextNode(' ' + t.stat)); r.appendChild(x); }); c.appendChild(r); }
    c.onclick = () => { S.touched = true; go({ src: i, slot: null, skill: null, q: '' }); };
    strip.appendChild(c);
  });
  if (!p.provenLoaded) { const w = E('div', 'src wait'); w.appendChild(E('b', null, 'Looking for proven builds …')); w.appendChild(E('span', 'au', 'maxroll · d2core · infinitybuilds')); strip.appendChild(w); }
  if (p.consensus && p.consensus.n) {
    const c = E('button', 'src cons' + (S.src === 'cons' ? ' on' : ''));
    const top = E('span', 'st'); top.appendChild(E('span', 'site', 'all sites')); c.appendChild(top);
    c.appendChild(E('b', null, 'What the top ' + p.consensus.n + ' builds agree on'));
    c.appendChild(E('span', 'au', 'most used piece per slot'));
    c.onclick = () => { S.touched = true; go({ src: 'cons', slot: null, skill: null, q: '' }); };
    strip.appendChild(c);
  }
  const own = E('button', 'src own' + (S.src === 'own' ? ' on' : ''));
  const top2 = E('span', 'st'); top2.appendChild(E('span', 'site', 'builder')); own.appendChild(top2);
  own.appendChild(E('b', null, 'Build it yourself'));
  own.appendChild(E('span', 'au', 'picked by the model – change anything'));
  own.onclick = () => { S.touched = true; go({ src: 'own', slot: null, skill: null, q: '' }); };
  strip.appendChild(own);
  body.appendChild(strip);

  if (S.src === 'cons' && p.consensus) return consensusView(body, p);
  if (typeof S.src === 'number' && p.proven && p.proven[S.src]) return provenView(body, p, p.proven[S.src]);
  return ownView(body, p, st);
}

const usedTag = (n, of) => (n && of ? E('span', 'used' + (n / of >= 0.5 ? ' hi' : ''), n + '/' + of) : null);
const sub = (parent, title) => { const h = E('h4', 'sub'); h.appendChild(E('span', null, title)); h.appendChild(E('i')); parent.appendChild(h); return h; };
const rarCls = (c) => (c.mythic ? 'rar-mythic' : 'rar-' + (c.kind === 'unique' ? 'unique' : 'aspect'));
const giCls = (c) => 'gi ' + (c.mythic ? 'mythic' : c.kind === 'unique' ? 'unique' : 'aspect');
const condLabel = (p, id) => (id[0] === '?' ? '“' + id.slice(1) + '”' : /^uses:/.test(id) ? 'A ' + id.slice(5) + ' skill is on your bar' : ((p.conditionList.find((c) => c.id === id) || {}).label || id));
const KIND = {
  x: (e) => '×' + e.v + '% own multiplier', xper: (e) => '×' + e.v + '% per soul', add: (e) => '+' + e.v + '% to the [+] pool', cdx: (e) => 'crit damage ×' + e.v + '%', ccx: (e) => 'crit chance ×' + e.v + '%',
  cc: (e) => (e.v > 0 ? '+' : '') + e.v + '% crit chance', as: (e) => '+' + e.v + '% attack speed', cdr: (e) => e.v + '% cooldown reduction', rank: (e) => '+' + e.v + ' skill ranks',
  vuln: () => 'makes enemies Vulnerable', dr: (e) => e.v + '% damage reduction', life: (e) => '+' + e.v + '% max life', move: (e) => (e.v > 0 ? '+' : '') + e.v + '% movement speed',
  teleport: () => 'Evade becomes Teleport', taken: (e) => '+' + e.v + '% damage taken', takenper: (e) => '+' + e.v + '% damage taken per soul',
  roll: (e) => e.text,
};

// ---------------- a proven build, explained ----------------
function provenView(body, p, b) {
  const cur = variantOf(b);
  const x = cur.explain;
  b = Object.assign({}, b, { sheet: cur.sheet, setup: cur.setup });
  if ((b.variants || []).length > 1) {
    const vs = E('div', 'views vpick');
    b.variants.forEach((v) => {
      const k = E('button', v.i === cur.i ? 'on' : '', v.name.slice(0, 40));
      k.title = 'Variant of this guide';
      k.onclick = () => { const st = STATE[S.key]; st.vpick = Object.assign({}, st.vpick, { [b.url]: v.i }); go({ slot: null }); };
      vs.appendChild(k);
    });
    body.appendChild(vs);
  }
  const bar = E('div', 'bar');
  x.bar.forEach((s) => {
    const k = E('div', 'bs' + (s.key === p.skill.key ? ' main' : ''));
    k.appendChild(pic(SKILL_ICON(s.icon), 'si')); k.appendChild(E('span', 'n', s.name));
    const ms = E('span', 'mods'); s.mods.forEach((m, j) => ms.appendChild(E('span', j === 0 ? 'v' : '', m.name))); k.appendChild(ms);
    hover(k, s.name, s.mods.map((m) => m.name + (m.desc ? ': ' + m.desc : '')).join('  ·  '));
    bar.appendChild(k);
  });
  body.appendChild(bar);
  const n = p.consensus ? p.consensus.n : 0;
  const sheet = E('div', 'sheet');
  const doll = E('div', 'doll');
  const order = (list) => list.map((s) => x.gear.filter((g) => g.slot === s)).flat();
  for (const colGear of [order(LEFT), order(['Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand', 'Weapon 2', 'Weapon 3'])]) {
    const col = E('div', 'col');
    colGear.forEach((g) => {
      const idx = x.gear.indexOf(g);
      const btn = E('button', 'gs' + (S.slot === idx ? ' on' : ''));
      btn.appendChild(pic(g.icon, giCls(g)));
      const tt = E('span', 't');
      const sl = E('span', 's', slotName(p, g.slot)); const u = usedTag(g.used, n); if (u) sl.appendChild(u); tt.appendChild(sl);
      tt.appendChild(E('span', 'n ' + rarCls(g), g.name));
      const gl = E('span', 'g');
      if (g.dmg > 0.5) gl.appendChild(E('span', 'up', pct(g.dmg) + ' dmg '));
      if (g.tough > 0.5) gl.appendChild(E('span', 'upd', pct(g.tough) + ' tough '));
      if (g.speed > 0.5) gl.appendChild(E('span', 'spd', pct(g.speed) + ' speed'));
      if (!gl.childNodes.length) gl.appendChild(E('span', 'muted', 'utility'));
      tt.appendChild(gl);
      btn.appendChild(tt);
      btn.onclick = () => go({ slot: S.slot === idx ? null : idx });
      const cand = p.engine.cands.find((c) => c.name === g.name);
      hoverCard(btn, () => pieceCard({ name: g.name, kind: g.kind, mythic: g.mythic, runeword: cand && cand.runeword, slot: slotName(p, g.slot), desc: g.desc,
        stats: g.stats || [], sockets: (g.sockets || []).map((so) => so.name), share: 'The build loses ' + pct(-(g.dmg || 0)).replace(/^\+/, '') + ' damage without it.' }));
      col.appendChild(btn);
    });
    doll.appendChild(col);
  }
  sheet.appendChild(doll);
  const side = E('div', 'side');
  if (S.slot != null && x.gear[S.slot]) provenPiece(side, p, x.gear[S.slot]);
  else {
    if (b.sheet || b.setup) {
      const as = E('section');
      sub(as, 'What the author says');
      as.appendChild(window.BuildGuide.sheetPage(b.sheet || null, b.setup || null, null, { api, one: true, noFoot: true }));
      side.appendChild(as);
    }
    const sec = E('section');
    sub(sec, b.sheet ? 'What the damage model sees' : 'Why this build works');
    const tot = E('div', 'tots');
    const T = x.totals;
    // 0% crit is a choice when the Splinter of Hellfire is worn (50%[x] for "lose 100% Critical Strike Chance")
    const hellfire = x.gear.some((g) => g.sockets.some((so) => /Hellfire/.test(so.name)));
    const noCrit = hellfire && T.crit === 0;
    // only what the build has – a 0% (no crits with Hellfire, no Cooldown Reduction on a spender) is
    // said in the lines below where it matters, not as a tile of its own
    [[p.skill.dot || noCrit || !T.crit ? null : 'Crit chance', T.crit + '%'], [p.skill.dot || noCrit || !T.crit ? null : 'A crit hits', '×' + T.critX], [T.vulnX > 1 ? 'Vulnerable' : null, '×' + T.vulnX],
      [T.ranks > 0 ? 'Skill ranks' : null, '+' + T.ranks], [T.dr > 0 ? 'Damage reduction' : null, T.dr + '%'], [T.cdr > 0 ? 'Cooldown red.' : null, T.cdr + '%'], [T.teleport ? 'Evade' : null, 'Teleport']]
      .filter(([a]) => a).forEach(([a, v]) => { const d = E('div'); d.appendChild(E('b', null, v)); d.appendChild(E('span', null, a)); tot.appendChild(d); });
    sec.appendChild(tot);
    const ul = E('ul', 'adv');
    const LABEL = { damage: 'Damage', crit: 'Crits', vuln: 'Vulnerable', loop: 'How it runs', tough: 'Survival', speed: 'Speed', leoric: 'Helm', splinter: 'Splinters', cond: 'Relies on', other: 'Not counted' };
    x.lines.forEach((l) => { const li = E('li'); const s = E('span'); s.appendChild(E('b', null, LABEL[l.k] || '')); s.appendChild(document.createTextNode(' — ' + l.t)); li.appendChild(s); ul.appendChild(li); });
    sec.appendChild(ul);
    side.appendChild(sec);
    talismanAndSockets(side, p, STATE[S.key]);
    const act = E('div', 'acts');
    const custom = E('button', 'btn', 'Make it my own');
    custom.title = 'Takes these pieces into "Build it yourself" – swap anything and see what it does';
    custom.onclick = () => {
      const st = STATE[S.key];
      st.forced = {};
      x.gear.forEach((g) => { if (/^Weapon [23]$/.test(g.slot)) return; if (p.engine.cands.find((c) => c.name === g.name) && !st.forced[g.slot]) st.forced[g.slot] = g.name; });
      S.touched = true;
      go({ src: 'own', slot: null });
    };
    act.appendChild(custom);
    const open = E('button', 'btn', 'Open on ' + (SITE[b.site] || b.site));
    open.onclick = () => api.openBuildSource(b.url);
    act.appendChild(open);
    side.appendChild(act);
    side.appendChild(E('p', 'src-note', 'The damage model on this build as imported – each piece\'s share is what the build loses without it. "6/8" = in how many of the top builds for ' + p.skill.name + ' the piece appears.'));
  }
  sheet.appendChild(side);
  body.appendChild(sheet);
}

function provenPiece(side, p, g) {
  const back = E('button', 'back', '← Why this build works'); back.onclick = () => go({ slot: null }); side.appendChild(back);
  const n = p.consensus ? p.consensus.n : 0;
  const det = E('div', 'det');
  det.appendChild(pic(g.icon, giCls(g)));
  const t = E('div');
  t.appendChild(E('h3', rarCls(g), g.name));
  t.appendChild(E('div', 'k', (g.kind === 'aspect' ? 'Legendary aspect' : g.mythic ? 'Mythic unique' : 'Unique') + ' · ' + (slotName(p, g.slot)) + (g.used ? ' · in ' + g.used + ' of ' + n + ' top builds' : '')));
  if (g.desc) t.appendChild(E('p', 'txt', g.desc));
  const gr = E('div', 'gainrow');
  [[g.dmg, 'damage', 'up'], [g.tough, 'toughness', 'upd'], [g.speed, 'speed', 'spd']].forEach(([v, l, c]) => { if (Math.abs(v) < 0.5 && l !== 'damage') return; const d = E('div'); d.appendChild(E('b', c, pct(v))); d.appendChild(E('span', null, l + ' – lost without it')); gr.appendChild(d); });
  t.appendChild(gr);
  det.appendChild(t);
  side.appendChild(det);
  if (g.stats.length) {
    const sec = E('section'); sub(sec, 'Its stats in this build');
    const ul = E('div', 'stats'); g.stats.forEach((s) => ul.appendChild(SCard.statLine(s)));
    sec.appendChild(ul);
    const lg = SCard.craftLegend(g.stats); if (lg) sec.appendChild(lg);
    side.appendChild(sec);
  }
  if (g.sockets.length) {
    const sec = E('section'); sub(sec, 'Sockets');
    const ul = E('ul', 'stats');
    g.sockets.forEach((s) => { const li = E('li'); li.appendChild(E('span', null, s.kind === 'splinter' ? '◆' : '•')); li.appendChild(E('span', null, s.name + (s.text ? ' — ' + s.text : '') + (s.boosted ? '  (+50% from Leoric\'s Crown)' : ''))); ul.appendChild(li); });
    sec.appendChild(ul); side.appendChild(sec);
  }
  const kind = /^Ring/.test(g.slot) ? 'Ring' : /^Weapon/.test(g.slot) ? 'Weapon' : g.slot;
  const others = ((p.consensus && p.consensus.slots[kind]) || []).filter((e) => e.name !== g.name).slice(0, 4);
  if (others.length) {
    const sec = E('section'); sub(sec, 'What other top builds use here');
    const al = E('div', 'alts');
    others.forEach((e) => {
      const c = p.engine.cands.find((x) => x.name === e.name);
      const r = E('div', 'alt');
      r.appendChild(pic(c && c.icon, c ? giCls(c) : 'gi aspect'));
      const tx = E('div', 'grow'); tx.appendChild(E('div', 'nm', e.name)); tx.appendChild(E('div', 'muted', 'in ' + e.n + ' of ' + e.of + (e.by.length ? ' · ' + e.by.slice(0, 3).join(', ') : ''))); r.appendChild(tx);
      r.appendChild(E('span')); r.appendChild(E('span'));
      if (c) hover(r, c.name, c.desc);
      al.appendChild(r);
    });
    sec.appendChild(al); side.appendChild(sec);
  }
}

// ---------------- what the top builds agree on ----------------
function consensusView(body, p) {
  const c = p.consensus;
  const sheet = E('div', 'sheet');
  const doll = E('div', 'doll');
  for (const list of [['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots'], ['Amulet', 'Ring', 'Weapon', 'Off-Hand']]) {
    const col = E('div', 'col');
    list.forEach((k) => {
      const top = (c.slots[k] || [])[0];
      if (!top) return;
      const cand = p.engine.cands.find((x) => x.name === top.name);
      const btn = E('button', 'gs' + (S.slot === k ? ' on' : ''));
      btn.appendChild(pic(cand && cand.icon, cand ? giCls(cand) : 'gi aspect'));
      const tt = E('span', 't');
      const sl = E('span', 's', SLOT_NAME[k] || k); const u = usedTag(top.n, top.of); if (u) sl.appendChild(u); tt.appendChild(sl);
      tt.appendChild(E('span', 'n ' + (cand ? rarCls(cand) : 'rar-aspect'), top.name));
      const alt = (c.slots[k] || [])[1];
      tt.appendChild(E('span', 'g muted', alt ? 'or ' + alt.name + ' (' + alt.n + ')' : 'everyone'));
      btn.appendChild(tt);
      btn.onclick = () => go({ slot: S.slot === k ? null : k });
      col.appendChild(btn);
    });
    doll.appendChild(col);
  }
  sheet.appendChild(doll);
  const side = E('div', 'side');
  const k = S.slot;
  if (k && c.slots[k]) {
    const back = E('button', 'back', '← Overview'); back.onclick = () => go({ slot: null }); side.appendChild(back);
    sub(side, (SLOT_NAME[k] || k) + ' in the top ' + c.n + ' builds');
    const al = E('div', 'alts');
    c.slots[k].slice(0, 8).forEach((e) => {
      const cand = p.engine.cands.find((x) => x.name === e.name);
      const r = E('div', 'alt');
      r.appendChild(pic(cand && cand.icon, cand ? giCls(cand) : 'gi aspect'));
      const tx = E('div', 'grow'); tx.appendChild(E('div', 'nm', e.name)); tx.appendChild(E('div', 'muted', (e.by || []).slice(0, 4).join(', '))); r.appendChild(tx);
      const v = E('span', 'v'); v.appendChild(E('span', 'up', e.n + ' / ' + e.of)); r.appendChild(v); r.appendChild(E('span'));
      if (cand) hover(r, cand.name, cand.desc);
      al.appendChild(r);
    });
    side.appendChild(al);
  } else {
    [['Skills on the bar', c.skills], ['Sockets – splinters, gems, runes', c.sockets], ['Charm sets', c.sets]].forEach(([title, list]) => {
      const sec = E('section'); sub(sec, title);
      const w = E('div', 'conds');
      list.forEach((e) => { const s = E('span', 'cond on'); s.appendChild(document.createTextNode(e.name)); s.appendChild(E('small', null, e.n + '×')); w.appendChild(s); });
      sec.appendChild(w); side.appendChild(sec);
    });
    side.appendChild(E('p', 'src-note', 'Counted from the top builds for ' + p.skill.name + ' on maxroll (tier list), d2core and infinitybuilds (most liked) – each imported with the overlay\'s own importer.'));
  }
  sheet.appendChild(side);
  body.appendChild(sheet);
}

// ---------------- build it yourself ----------------
function ownView(body, p, st) {
  compute(S.key);
  const goals = E('div', 'goalrow');
  goals.appendChild(E('span', 'muted', 'Build for'));
  const seg = E('div', 'views');
  Object.entries(GOAL_LABEL).forEach(([k, l]) => { const b = E('button', (st.goal || 'push') === k ? 'on' : '', l); b.onclick = () => { st.goal = k; rerender(); }; seg.appendChild(b); });
  goals.appendChild(seg);
  goals.appendChild(E('span', 'hint', st.goal === 'speed' ? 'Speed counts: movement, Teleport.' : st.goal === 'boss' ? 'One big target: damage first.' : 'Damage and toughness for high Pit tiers.'));
  body.appendChild(goals);
  // where the pieces come from – said plainly
  const start = E('div', 'startnote');
  const n = p.consensus ? p.consensus.n : 0;
  if (st.seeded === 'consensus') {
    start.appendChild(E('span', null, 'Starts from what the top ' + n + ' builds use per slot – the model fills the slots they leave open and shows what each swap would do.'));
    const b = E('button', 'btn sm', 'Let the model pick everything (experimental)');
    b.onclick = () => { st.forced = {}; st.seeded = 'model'; rerender(); };
    start.appendChild(b);
  } else if (n) {
    start.appendChild(E('span', null, st.seeded === 'model' ? 'The model\'s own pick (experimental) – it reads item texts and cannot see everything top builds rely on.' : 'Your picks – the model fills the rest.'));
    const b = E('button', 'btn sm', 'Back to what the top builds use');
    b.onclick = () => { st.forced = {}; st.seeded = false; seedFromConsensus(p, st); rerender(); };
    start.appendChild(b);
  } else {
    start.appendChild(E('span', null, p.provenLoaded ? 'No proven builds for this skill – the model\'s pick (experimental). Change anything; every option says what it adds.' : 'Looking for proven builds … until then the model\'s pick.'));
  }
  body.appendChild(start);

  const bar = E('div', 'bar');
  p.bar.forEach((b, i) => {
    const x = E('button', 'bs' + (i === 0 ? ' main' : '') + (S.skill === i ? ' sel' : ''));
    x.appendChild(pic(SKILL_ICON(b.icon), 'si')); x.appendChild(E('span', 'r', b.role)); x.appendChild(E('span', 'n', b.name));
    const ms = E('span', 'mods');
    b.mods.forEach((g) => ms.appendChild(E('span', g.group === 'variant' ? 'v' : '', st.mods[i + g.group] || g.chosen)));
    x.appendChild(ms);
    x.onclick = () => go({ skill: S.skill === i ? null : i, slot: null, q: '' });
    bar.appendChild(x);
  });
  body.appendChild(bar);

  const sheet = E('div', 'sheet');
  const left = E('div');
  const find = E('label', 'find');
  find.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/></svg>';
  const q = E('input'); q.id = 'bdq'; q.placeholder = 'Search uniques and aspects …'; q.value = S.q || ''; q.spellcheck = false;
  q.oninput = () => { S.q = q.value; S.slot = null; S.skill = null; renderSide(); };
  find.appendChild(q);
  left.appendChild(find);
  const doll = E('div', 'doll');
  for (const colSlots of [LEFT, p.engine.slots.filter((s) => !LEFT.includes(s))]) {
    const col = E('div', 'col');
    for (const s of colSlots) {
      if (!p.engine.slots.includes(s)) continue;
      const c = st.result.placed[s], sh = st.result.shares[s] || {};
      if (c && c.kind === 'blocked') {
        // the off-hand a two-handed weapon takes
        const bl = E('div', 'gs blocked');
        bl.appendChild(E('span', 'gi', '—'));
        const tb = E('span', 't'); tb.appendChild(E('span', 's', slotName(p, s))); tb.appendChild(E('span', 'n muted', 'taken by the two-handed weapon')); bl.appendChild(tb);
        col.appendChild(bl);
        continue;
      }
      const b = E('button', 'gs' + (S.slot === s ? ' on' : ''));
      b.appendChild(c ? pic(c.icon, giCls(c)) : E('span', 'gi', '—'));
      const tt = E('span', 't');
      const sl = E('span', 's', slotName(p, s)); const u = c && usedTag(c.used, p.consensus && p.consensus.n); if (u) sl.appendChild(u); tt.appendChild(sl);
      tt.appendChild(E('span', 'n ' + (c ? rarCls(c) : ''), c ? c.name : 'empty'));
      // what this piece brings to the build now – not what a swap would
      const g = E('span', 'g');
      if (sh.dmg > 0.05 || sh.tough > 0.05 || sh.speed > 0.5) g.appendChild(E('span', 'muted', 'adds '));
      if (sh.dmg > 0.05) g.appendChild(E('span', 'up', pct(sh.dmg) + ' dmg '));
      if (sh.tough > 0.05) g.appendChild(E('span', 'upd', pct(sh.tough) + ' tough '));
      if (sh.speed > 0.5) g.appendChild(E('span', 'spd', pct(sh.speed) + ' speed'));
      if (!g.childNodes.length) g.appendChild(E('span', 'muted', 'utility'));
      tt.appendChild(g);
      b.appendChild(tt);
      const sw = E('span', 'chg');
      sw.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>';
      sw.title = 'Swap this piece';
      b.appendChild(sw);
      if (c) hoverCard(b, () => slotCard(p, st, s, c, sh));
      b.onclick = () => go({ slot: S.slot === s ? null : s, skill: null, q: '' });
      col.appendChild(b);
    }
    doll.appendChild(col);
  }
  left.appendChild(doll);
  sheet.appendChild(left);
  const side = E('div', 'side'); side.id = 'bdside';
  sheet.appendChild(side);
  body.appendChild(sheet);
  renderSide();
}

/** Which of a slot's affixes is worth most to the build – where the masterwork capstone should land (-1: none). */
function bestRoll(p, st, slot, c) {
  if (!c || c.kind === 'unique') return -1;
  const rolls = rollsOf(p, st)[slot] || [];
  const aff = rolls.filter((x) => !x.temper);
  const full = stateWith(p, st, st.result.placed, st.on);
  const vals = aff.map((e) => O.value(O.delta(O.stateOf(baseOf(p, st), st.result.placed, st.on, Object.assign({}, rollsOf(p, st), { [slot]: rolls.filter((x) => x !== e) }), p.engine.slots), full), O.GOALS[st.goal || 'push']));
  if (!vals.length) return -1;
  const i = vals.indexOf(Math.max(...vals));
  return vals[i] > 0 ? i : -1;
}
/**
 * The rolls of a slot as the farm list keeps them – what the page shows is what gets saved: three
 * affixes (★ where the masterwork capstone is worth most; a unique has its own), one temper with its manual.
 */
function rollLines(p, st, slot, c) {
  if (!c || c.kind === 'blocked') return [];
  const rolls = rollsOf(p, st)[slot] || [];
  const top = bestRoll(p, st, slot, c);
  const aff = c.kind === 'unique' ? [] : rolls.filter((x) => !x.temper).slice(0, 3);
  return aff.map((x, i) => Object.assign({ t: x.text }, i === top ? { mw: 1 } : {}))
    .concat(rolls.filter((x) => x.temper).slice(0, 1).map((x) => ({ t: x.text, tmp: 1, how: [x.cat, x.g].filter(Boolean).join(' · ') })));
}
/** The card of a slot in your build: its piece, the rolls the model picked (★ where the masterwork goes), the temper, sockets. */
function slotCard(p, st, slot, c, sh) {
  const sockets = c.runeword && (c.runes || []).length ? c.runes : (p.sockets && p.sockets[slot]) || [];
  return pieceCard({ name: c.name, kind: c.kind, mythic: c.mythic, runeword: c.runeword, slot: slotName(p, slot), desc: c.desc,
    stats: rollLines(p, st, slot, c), sockets,
    share: 'This piece adds ' + pct(sh.dmg || 0) + ' damage' + (Math.abs(sh.tough || 0) > 0.05 ? ' and ' + pct(sh.tough) + ' toughness' : '') + ' to the build as it stands.' });
}

function renderSide() {
  const side = document.getElementById('bdside'); if (!side) return;
  side.replaceChildren();
  const p = PLANS[S.key], st = STATE[S.key];
  if (S.q && S.q.trim().length >= 2) return searchView(side, p, st, S.q.trim());
  if (S.skill != null) return skillView(side, p, st, S.skill);
  if (S.slot) return slotView(side, p, st, S.slot);
  overview(side, p, st);
}

function overview(side, p, st) {
  const sec = E('section');
  sub(sec, 'Your gear – what each piece adds');
  const list = E('div', 'contrib');
  const rows = Object.entries(st.result.placed).filter(([, c]) => c.kind !== 'blocked').map(([s, c]) => ({ s, c, sh: st.result.shares[s] || { dmg: 0, tough: 0 } }));
  const maxD = Math.max(1, ...rows.map((r) => r.sh.dmg)), maxT = Math.max(1, ...rows.map((r) => r.sh.tough));
  rows.sort((a, b) => b.sh.dmg - a.sh.dmg || b.sh.tough - a.sh.tough).forEach((r) => {
    const tough = r.sh.dmg < 0.05 && r.sh.tough > 0.05;
    const row = E('div', 'cb');
    row.appendChild(pic(r.c.icon, 'mi'));
    row.appendChild(E('span', 'nm ' + rarCls(r.c), r.c.name));
    const tr = E('div', 'tr'); const i = E('i', tough ? 'd' : ''); i.style.width = Math.max(2, (tough ? r.sh.tough / maxT : r.sh.dmg / maxD) * 100) + '%'; tr.appendChild(i); row.appendChild(tr);
    row.appendChild(E('span', 'v ' + (tough ? 'upd' : 'up'), tough ? pct(r.sh.tough) : r.sh.dmg > 0.05 ? pct(r.sh.dmg) : '—'));
    const b = E('button', 'chgb'); b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M7 7h11l-3-3M17 17H6l3 3"/></svg>'; b.title = 'Swap this piece'; b.onclick = () => go({ slot: r.s }); row.appendChild(b);
    list.appendChild(row);
  });
  sec.appendChild(list);
  side.appendChild(sec);

  // souls held, when a piece counts them (Splinter of the Black Soulstone)
  const placed = Object.values(st.result.placed);
  if (p.engine.cands.some((c) => c.effects.some((e) => e.kind === 'xper'))) {
    const sl = E('label', 'souls');
    sl.appendChild(E('span', null, 'Souls you usually hold'));
    const inp = E('input'); inp.type = 'range'; inp.min = 0; inp.max = 200; inp.step = 10; inp.value = st.souls; inp.id = 'bdsouls';
    inp.onchange = () => { st.souls = Number(inp.value); rerender(); };
    inp.oninput = () => { val.textContent = inp.value; };
    sl.appendChild(inp);
    const val = E('b', null, String(st.souls)); sl.appendChild(val);
    sec.appendChild(sl);
  }

  // conditional boosts
  const used = new Map();
  for (const c of p.engine.cands) for (const e of c.effects) if (e.scope !== 'other') for (const k of e.cond) used.set(k, (used.get(k) || 0) + 1);
  const base = M.damage(st.result.full).dps;
  const sec2 = E('section');
  sub(sec2, 'Conditional boosts');
  sec2.appendChild(E('p', 'hint', 'Some bonuses only work while something is true – Berserking, an Elite in front of you … Switch on what happens in your fights; the builder counts those and picks the gear again.'));
  const conds = E('div', 'conds');
  const ids = [...used.keys()].map((id) => {
    const on2 = Object.assign({}, st.on, { [id]: !st.on[id] });
    let d = (M.damage(stateWith(p, st, st.result.placed, on2)).dps / base - 1) * 100;
    let via = '';
    if (!st.on[id]) {
      const st2 = Object.assign({}, st, { on: on2 });
      for (const c of p.engine.cands) {
        if (!c.effects.some((e) => e.cond.includes(id))) continue;
        for (const slot of p.engine.slots) {
          if (!O.fits(c, slot)) continue;
          const g = swapGainAt(p, st2, c, slot);
          if (g && g.dmg > d) { d = g.dmg; via = c.name; }
        }
      }
    }
    return { id, d, via };
  }).sort((a, b) => (!!st.on[b.id]) - (!!st.on[a.id]) || Math.abs(b.d) - Math.abs(a.d) || (a.id[0] === '?') - (b.id[0] === '?')).slice(0, 18);
  // a buff a skill with a cooldown keeps up: on for its share of the time (dmgmodel uptimes)
  const ups = M.uptimes(M.resolve(stateWith(p, st, st.result.placed, st.on)), null);
  const keeper = (id) => ((stateWith(p, st, st.result.placed, st.on).bar || []).find((b) => b.gives && b.gives[id]) || {}).name;
  ids.forEach(({ id, d, via }) => {
    const on = !!st.on[id];
    const partly = st.on[id] === 'up';
    const b = E('button', 'cond' + (on ? ' on' : '') + (id[0] === '?' ? ' q' : ''));
    b.appendChild(document.createTextNode(condLabel(p, id)));
    if (partly && ups[id] != null) b.appendChild(E('span', 'gn', Math.round(ups[id] * 100) + '% of the time'));
    if (!on && d > 0.5) b.appendChild(E('span', 'gn', pct(d)));
    b.title = partly ? 'Kept up by ' + (keeper(id) || 'a skill on the bar') + ' – counted for the share of the time it is up (its cooldown against how long it lasts). Click if it never happens in your fights.'
      : on ? 'Counted. Click if it is not true in your fights.' : (d > 0.5 ? 'When this is true: up to ' + pct(d) + ' damage' + (via ? ' (e.g. with ' + via + ')' : '') + '. Click and the builder picks the gear for it.' : 'Click if this is true in your fights.');
    b.onclick = () => { st.on[id] = on ? false : p.on && p.on[id] === 'up' ? 'up' : true; rerender(); };
    conds.appendChild(b);
  });
  sec2.appendChild(conds);
  side.appendChild(sec2);

  if (p.charms && p.charms.length) {
    // the talisman as the model fills it – a Mythic seal, the Golden Epiphany, the seal swap
    const sec4 = E('section');
    sub(sec4, 'Talisman – charms');
    p.charms.forEach((t, i) => {
      const tl = E('div', 'tal');
      tl.appendChild(E('b', null, t.name + (i === 0 ? ' – counted in this build' : '')));
      const v = E('span'); if (t.dmg > 0.05) v.appendChild(E('span', 'up', pct(t.dmg) + ' dmg ')); if (t.tough > 0.05) v.appendChild(E('span', 'upd', pct(t.tough) + ' tough')); tl.appendChild(v);
      if (t.mythic) tl.appendChild(E('p', null, 'Mythic charm: ' + t.mythic.name + ' – ' + t.mythic.text));
      t.uniques.forEach((u) => tl.appendChild(E('p', null, 'Unique charm: ' + u.name + ' – ' + u.text)));
      if (t.set) tl.appendChild(E('p', null, t.set.charms + '× ' + t.set.name + ': ' + t.set.bonuses.map((b) => b.n + ' – ' + b.desc).join(' · ')));
      if (t.note) tl.appendChild(E('p', 'hint', t.note));
      sec4.appendChild(tl);
    });
    side.appendChild(sec4);
  } else if (p.talisman && p.talisman.length) {
    const sec4 = E('section');
    sub(sec4, 'Talisman – charm set');
    const best = p.talisman[0];
    const tl = E('div', 'tal');
    tl.appendChild(E('b', null, best.name));
    const v = E('span'); if (best.dmg > 0.05) v.appendChild(E('span', 'up', pct(best.dmg) + ' dmg ')); if (best.tough > 0.05) v.appendChild(E('span', 'upd', pct(best.tough) + ' tough')); tl.appendChild(v);
    best.bonuses.forEach((x) => tl.appendChild(E('p', null, x.n + ' pieces: ' + x.desc)));
    sec4.appendChild(tl);
    const others = p.talisman.slice(1, 3).map((x) => x.name + (x.dmg > 0.05 ? ' ' + pct(x.dmg) : '')).join(' · ');
    if (others) sec4.appendChild(E('p', 'hint', 'Next best: ' + others));
    side.appendChild(sec4);
  }

  // the class's own choices – enchantments, spirit boons, oath, weapon expertise, shard, specialization
  if ((p.choices || []).length) {
    const sec6 = E('section');
    sub(sec6, p.cls + ' – class choices');
    const al = E('div', 'alts');
    p.choices.forEach((c) => {
      const r = E('div', 'alt');
      const tx = E('div', 'grow'); tx.appendChild(E('div', 'nm', c.name)); tx.appendChild(E('div', 'muted', c.group)); r.appendChild(tx);
      const v = E('span', 'v');
      if (c.dmg > 0.05) v.appendChild(E('span', 'up', pct(c.dmg) + ' dmg'));
      else if (c.tough > 0.05) v.appendChild(E('span', 'upd', pct(c.tough) + ' tough'));
      else v.appendChild(E('span', 'muted', c.counted ? '±0' : 'utility'));
      r.appendChild(v); r.appendChild(E('span'));
      hover(r, c.name, c.desc);
      al.appendChild(r);
    });
    sec6.appendChild(al);
    sec6.appendChild(E('p', 'src-note', 'Picked by what they add to this build, one after the other – counted in every number above.'));
    side.appendChild(sec6);
  }
  talismanAndSockets(side, p, st);

  const sec3 = E('section');
  sub(sec3, 'Good to know');
  const ul = E('ul', 'adv');
  const add = (bold, rest) => { const li = E('li'); const s = E('span'); s.appendChild(E('b', null, bold)); s.appendChild(document.createTextNode(' ' + rest)); li.appendChild(s); ul.appendChild(li); };
  if (p.skill.dot) add(p.skill.name + ' deals damage over time', '– it cannot crit, so Crit Chance and Crit Damage do nothing. Damage Over Time multipliers do.');
  else add(p.skill.name + ' can crit', '– Crit Damage multipliers are their own [x] bucket and grow with your crit chance.');
  const vsrc = placed.find((c) => c.effects.some((e) => e.kind === 'vuln'));
  const vbar = p.bar.find((b) => b.role === 'Vulnerable');
  if (vsrc || vbar) add('Vulnerable', '(×1.2 and every Vulnerable bonus) comes from ' + (vsrc ? vsrc.name : vbar.name + ' on your bar') + '.');
  add('[+] and [x]', '– every [+] bonus goes into one pool, the fuller it is the less the next one adds; [x] bonuses multiply. That is why the numbers change as you swap pieces.');
  const unsure = placed.find((c) => c.effects.some((e) => e.unsure));
  if (unsure) add(unsure.name, 'says "% increased damage" without [x] or [+] – counted as [+], the smaller of the two.');
  sec3.appendChild(ul);
  side.appendChild(sec3);
  side.appendChild(E('p', 'src-note', 'Damage: d4guides "Damage Calculation" (patch 3.2.2), maxroll In-Depth Damage Guide · toughness: maxroll defence guide · texts and numbers: maxroll game data, d2core.'));
}

function pieceRow(p, st, c, g, onUse) {
  const r = E('div', 'alt');
  r.appendChild(pic(c.icon, giCls(c)));
  const t = E('div', 'grow');
  t.appendChild(E('div', 'nm ' + rarCls(c), c.name));
  const n = p.consensus ? p.consensus.n : 0;
  t.appendChild(E('div', 'muted', (c.kind === 'aspect' ? 'Aspect' : c.mythic ? 'Mythic' : 'Unique') + (g && g.slot ? ' · ' + (slotName(p, g.slot)) : '') + (c.used && n ? ' · in ' + c.used + ' of ' + n + ' top builds' : '')));
  const needs = [...new Set(c.effects.filter((e) => e.scope !== 'other').flatMap((e) => e.cond).filter((x) => !st.on[x]))];
  if (needs.length) t.appendChild(E('div', 'nd', 'only while ' + needs.map((x) => condLabel(p, x)).join(', ')));
  else if (!c.counted) t.appendChild(E('div', 'muted', 'utility or its own damage – not counted'));
  r.appendChild(t);
  const v = E('span', 'v');
  if (g && g.here) v.appendChild(E('span', 'muted', 'equipped'));
  else if (g) {
    v.appendChild(E('span', g.dmg > 0.05 ? 'up' : g.dmg < -0.05 ? 'nd' : 'muted', Math.abs(g.dmg) > 0.05 ? pct(g.dmg) + ' dmg' : '±0 dmg'));
    v.title = 'Compared with what sits on the slot now';
    if (Math.abs(g.tough) > 0.05) { v.appendChild(E('br')); v.appendChild(E('span', g.tough > 0 ? 'upd' : 'nd', pct(g.tough) + ' tough')); }
    if (Math.abs(g.speed || 0) > 0.5) { v.appendChild(E('br')); v.appendChild(E('span', g.speed > 0 ? 'spd' : 'nd', pct(g.speed) + ' speed')); }
  }
  r.appendChild(v);
  if (g && !g.here) { const use = E('button', 'btn sm', 'Use'); use.onclick = onUse; r.appendChild(use); } else r.appendChild(E('span'));
  hover(r, c.name, c.desc);
  return r;
}

function searchView(side, p, st, q) {
  const words = q.toLowerCase().split(/\s+/);
  const hits = p.engine.cands.filter((c) => words.every((w) => (c.name + ' ' + c.desc).toLowerCase().includes(w)));
  sub(side, hits.length + ' found – what each adds on its best slot');
  const rows = hits.map((c) => ({ c, g: swapGain(p, st, c) })).filter((x) => x.g)
    .sort((a, b) => (b.g.here ? 1e9 : b.g.v || 0) - (a.g.here ? 1e9 : a.g.v || 0) || a.c.name.localeCompare(b.c.name)).slice(0, 30);
  const box = E('div', 'alts');
  rows.forEach(({ c, g }) => box.appendChild(pieceRow(p, st, c, g, () => { st.forced[g.slot] = c.name; S.q = ''; go({ slot: g.slot }); })));
  if (!rows.length) box.appendChild(E('p', 'hint', 'Nothing for this class matches.'));
  side.appendChild(box);
  side.appendChild(E('p', 'src-note', 'The gain replaces what sits on that slot now and is worked out with everything else you wear – a second [+] bonus adds less than the first, a new [x] multiplies.'));
}

function skillView(side, p, st, i) {
  const back = E('button', 'back', '← Build overview'); back.onclick = () => go({ skill: null }); side.appendChild(back);
  const b = p.bar[i];
  const det = E('div', 'det');
  det.appendChild(pic(SKILL_ICON(b.icon), 'gi'));
  const t = E('div');
  t.appendChild(E('h3', null, b.name));
  t.appendChild(E('div', 'k', b.role + ' · ' + b.why));
  det.appendChild(t);
  side.appendChild(det);
  const GT = { variant: 'Variant – pick one', a: 'Upgrade – pick one', b: 'Upgrade – pick one' };
  b.mods.forEach((g) => {
    const box = E('div', 'mg');
    box.appendChild(E('div', 'gt', GT[g.group]));
    const cur = st.mods[i + g.group] || g.chosen;
    g.options.forEach((o) => {
      const r = E('button', 'mo' + (o.name === cur ? ' on' : ''));
      const tx = E('span'); tx.appendChild(E('b', null, o.name)); tx.appendChild(E('small', null, o.desc)); r.appendChild(tx);
      const v = E('span', 'v');
      if (o.dmg > 0.05) v.appendChild(E('span', 'up', pct(o.dmg) + ' dmg'));
      else if (o.tough > 0.05) v.appendChild(E('span', 'upd', pct(o.tough) + ' tough'));
      else if (o.vuln) v.appendChild(E('span', 'up', 'Vulnerable'));
      else if (o.util.length) v.appendChild(E('span', 'muted', o.util.join(', ')));
      r.appendChild(v);
      r.onclick = () => { st.mods[i + g.group] = o.name; rerender(); };
      box.appendChild(r);
    });
    side.appendChild(box);
  });
  side.appendChild(E('p', 'src-note', 'Each skill has three variants (take one) and two pairs of upgrades (one of each) in the tree. Picked by what they add to this build; utility (Unstoppable, cooldown, resource) breaks ties.'));
}

function slotView(side, p, st, slot) {
  const back = E('button', 'back', '← Build overview'); back.onclick = () => go({ slot: null }); side.appendChild(back);
  const c = st.result.placed[slot], sh = st.result.shares[slot] || {};
  if (c) {
    const det = E('div', 'det');
    det.appendChild(pic(c.icon, giCls(c)));
    const t = E('div');
    t.appendChild(E('h3', rarCls(c), c.name));
    t.appendChild(E('div', 'k', (c.kind === 'aspect' ? 'Legendary aspect' + (c.cat ? ' · ' + c.cat : '') : c.mythic ? 'Mythic unique' : 'Unique') + ' · ' + (SLOT_NAME[slot] || slot)));
    t.appendChild(E('p', 'txt', c.desc));
    const fx = E('div', 'fx');
    c.effects.filter((e) => (e.scope !== 'other' || e.kind === 'vuln') && KIND[e.kind]).forEach((e) => {
      const off = e.cond.some((x) => !st.on[x]);
      const b = E('span', 'fxc' + (off ? ' off' : ''), KIND[e.kind](e));
      if (e.cond.length) b.appendChild(E('em', null, ' · ' + e.cond.map((x) => condLabel(p, x)).join(', ')));
      fx.appendChild(b);
    });
    t.appendChild(fx);
    const gr = E('div', 'gainrow');
    const g1 = E('div'); g1.appendChild(E('b', 'up', pct(sh.dmg || 0))); g1.appendChild(E('span', null, 'damage this piece adds now')); gr.appendChild(g1);
    const g2 = E('div'); g2.appendChild(E('b', 'upd', pct(sh.tough || 0))); g2.appendChild(E('span', null, 'toughness it adds')); gr.appendChild(g2);
    t.appendChild(gr);
    det.appendChild(t);
    side.appendChild(det);
  }
  // what this slot should roll for the build as it stands (picked by the model, see lib/optimizer.js pickRolls)
  const sec = E('section');
  sub(sec, 'Stats to look for');
  const ul = E('div', 'stats');
  // ★ the affix the masterwork capstone is worth most on
  const lines = rollLines(p, st, slot, c);
  lines.forEach((x) => ul.appendChild(SCard.statLine(x)));
  sec.appendChild(ul);
  const lg = SCard.craftLegend(lines); if (lg) sec.appendChild(lg);
  side.appendChild(sec);
  const sec2 = E('section');
  sub(sec2, 'Swap it – compared with what sits there now');
  const alts = E('div', 'alts');
  const options = p.engine.cands.filter((x) => O.fits(x, slot) && (!c || x.name !== c.name)).map((x) => ({ x, g: swapGainAt(p, st, x, slot) })).filter((o) => o.g);
  options.slice().sort((a, b) => b.g.v - a.g.v || (b.x.used || 0) - (a.x.used || 0)).slice(0, 8)
    .forEach(({ x, g: gg }) => alts.appendChild(pieceRow(p, st, x, gg, () => { st.forced[slot] = x.name; rerender(); })));
  sec2.appendChild(alts);
  // uniques and mythics made for the skills on your bar – worth a look even when the numbers say less
  // (their power can be a proc, a tag, a mechanic the model cannot put a number on)
  const barNames = p.bar.map((b) => b.name);
  const madeFor = (x) => {
    const own = (x.why || []).find((w) => /^Made for|^Works on/.test(w));
    if (own) return own;
    const sk = barNames.find((n) => new RegExp('\\b' + n.replace(/[.*+?^(){}$|[\]\\]/g, '\\$&') + '\\b').test(x.desc || ''));
    return sk ? 'Works with ' + sk + ' on your bar' : '';
  };
  const syn = options.filter((o) => o.x.kind === 'unique' && madeFor(o.x)).sort((a, b) => (b.x.mythic - a.x.mythic) || b.g.v - a.g.v).slice(0, 6);
  if (syn.length) {
    const sec5 = E('section');
    sub(sec5, 'Uniques made for your skills');
    const al = E('div', 'alts');
    syn.forEach(({ x, g: gg }) => { const r = pieceRow(p, st, x, gg, () => { st.forced[slot] = x.name; rerender(); }); r.querySelector('.bd-grow').appendChild(E('div', 'why', madeFor(x))); al.appendChild(r); });
    sec5.appendChild(al);
    sec5.appendChild(E('p', 'src-note', 'Picked by what they are made for, not by the number: a proc, a new tag or a mechanic can carry a build the model only partly counts. The number is what it does in this build compared with what sits there now.'));
    side.appendChild(sec2);
    side.appendChild(sec5);
    if (st.forced[slot]) { const reset = E('button', 'btn sm', 'Let the builder pick again'); reset.onclick = () => { delete st.forced[slot]; rerender(); }; sec2.appendChild(reset); }
    return;
  }
  if (st.forced[slot]) { const reset = E('button', 'btn sm', 'Let the builder pick again'); reset.onclick = () => { delete st.forced[slot]; rerender(); }; sec2.appendChild(reset); }
  side.appendChild(sec2);
}

// ---------------- the build as the farm list would keep it ----------------
// what "Save as build" would put into the farm list – fetched for the picks as they stand, so the
// skill tree, the paragon boards, the talisman and the sockets show before anything is saved
const PREV = {};
function picksOf(p, st) {
  if (typeof S.src === 'number' && p.proven && p.proven[S.src]) return { url: p.proven[S.src].url, variant: variantOf(p.proven[S.src]).i };
  if (!st.result) compute(S.key);
  const on = Object.keys(st.on || {}).some((k) => (p.on || {})[k] !== st.on[k]) ? st.on : undefined;
  return { pieces: Object.fromEntries(Object.entries(st.result.placed).filter(([, c]) => c && c.name).map(([sl, c]) => [sl, c.name])), mods: st.mods, on };
}
function preview(p, st) {
  const picks = picksOf(p, st);
  const sig = S.key + '|' + JSON.stringify(picks);
  const have = PREV[S.key];
  if (have && have.sig === sig) return have.b;
  PREV[S.key] = { sig, b: null };
  api.builderPreview(S.cls, S.key, picks).then((b) => {
    if (!PREV[S.key] || PREV[S.key].sig !== sig) return;
    PREV[S.key].b = b && !b.error ? b : { error: (b && b.error) || 'Could not put the build together.' };
    rerender();
  });
  return null;
}
/** Skills or Paragon – the farm list's own views (lib/buildviews.js), icons or minimal and all. */
function farmView(body, p, view) {
  const st = STATE[S.key];
  const b = preview(p, st);
  body.appendChild(E('p', 'hint', (typeof S.src === 'number' ? 'This proven build' : S.src === 'cons' ? 'Your build (the consensus is a list of pieces, not one build)' : 'Your build') +
    ' as it would land in the farm list.'));
  if (!b) { body.appendChild(E('p', 'wait', 'Putting the build together …')); return; }
  if (b.error) { body.appendChild(E('p', 'err', b.error)); return; }
  const box = mk('div', 'fview bd-fview');
  body.appendChild(box);
  if (window.BuildViews && window.BuildViews[view]) window.BuildViews[view](box, b, { api, el: mk, openPage: ctx.openPage });
}
/** The talisman and the sockets of that build – before it is saved. */
function talismanAndSockets(side, p, st) {
  const b = preview(p, st);
  const sec = E('section');
  sub(sec, 'Talisman & sockets');
  if (!b || b.error) { sec.appendChild(E('p', 'hint', b ? b.error : 'Putting them together …')); side.appendChild(sec); return; }
  const ch = b.charms;
  if (ch) {
    const list = E('div', 'chs');
    const line = (c, seal) => {
      const r = E('div', 'ch');
      r.appendChild(E('span', 'dot ' + (c.q || '').toLowerCase()));
      r.appendChild(E('span', 'nm', c.name));
      r.appendChild(E('span', 'muted', seal ? 'Seal' : c.set || c.q || 'Charm'));
      const set = c.set && (ch.sets || []).find((x) => x.name === c.set);
      hoverCard(r, () => {
        const d = mk('div', 'ctt');
        d.appendChild(mk('div', 'nm ' + (c.q === 'Mythic' ? 'r-mythic' : c.q === 'Unique' ? 'r-unique' : c.q === 'Set' ? 'r-set' : 'r-legendary'), c.name));
        d.appendChild(mk('div', 'ty', [c.q, seal ? 'Seal' : 'Charm'].filter(Boolean).join(' ') + (c.set ? ' · ' + c.set : '')));
        if (c.d && c.d.length) { const ds = mk('div', 'sec ds'); c.d.forEach((x) => ds.appendChild(mk('div', null, x))); d.appendChild(ds); }
        if (set) {
          const sb = mk('div', 'sec set');
          sb.appendChild(mk('b', 'r-set', set.name + ' (' + set.have + ' worn)'));
          set.bonuses.forEach((x) => { const rr = mk('div', 'bon' + (x.on ? ' on' : '')); rr.appendChild(mk('span', 'n', '(' + x.n + ')')); rr.appendChild(mk('span', null, x.d.join(' '))); sb.appendChild(rr); });
          d.appendChild(sb);
        }
        return d;
      });
      list.appendChild(r);
    };
    if (ch.seal) line(ch.seal, true);
    (ch.list || []).forEach((c) => line(c, false));
    sec.appendChild(list);
  }
  const sock = Object.entries(b.slots || {}).filter(([, x]) => x && (x.sockets || []).length);
  if (sock.length) {
    const g = E('div', 'socks');
    sock.forEach(([sl, x]) => {
      const r = E('div', 'sock');
      r.appendChild(E('span', 'sl', slotName(p, sl)));
      const chips = E('span', 'gems');
      x.sockets.forEach((n) => chips.appendChild(E('span', 'gem ' + (/splinter/i.test(n) ? 'splinter' : /amethyst|emerald|ruby|topaz|sapphire|diamond|skull/i.test(n) ? 'gem' : 'rune'), n.replace(/^Abyssal Splinter of (the )?/, ''))));
      r.appendChild(chips);
      r.title = slotName(p, sl) + ': ' + x.sockets.join(', ');
      g.appendChild(r);
      // a rune pair: why these two
      if (typeof S.src !== 'number' && p.runeWhy && p.runeWhy[sl]) g.appendChild(E('div', 'rwhy', p.runeWhy[sl]));
    });
    sec.appendChild(g);
  }
  sec.appendChild(E('p', 'src-note', 'Sockets: per slot the gem, soul splinter (jewellery only) or rune pair – a condition rune that gains Offering, an effect rune that spends it – that adds the most to this build; a runeword: its runes. Charms: the talisman the build counts – Mythic seal; Goals and Build show the Golden Epiphany and the seal swap.'));
  side.appendChild(sec);
}

/**
 * Goals: where your build stands against the top builds of this skill – stat by stat, from the gear
 * alone on both sides (paragon and the rest come on top in the game), with where to find more.
 */
// the defence ratings as the model counts them (lib/dmgmodel.js, toughness) – shown as % less damage
const RES_TYPES = ['Physical', 'Fire', 'Cold', 'Lightning', 'Poison', 'Shadow'];
const rating = (r, c) => (r > 0 ? r / (r * 10 / 9 + c) * 100 : 0);
const armorDR = (s) => rating(((s.armor || 0) + (s.mainStat === 'Strength' ? 2 * (s.stat || 0) : 0)) * (1 + (s.armorPct || 0) / 100), 5678);
const weakestRes = (s) => Math.min(...RES_TYPES.map((t) => rating((s.resAll || 0) + (s.mainStat === 'Intelligence' ? 0.4 * (s.stat || 0) : 0) + ((s.res || {})[t] || 0), 1136)));

function goalsView(body, p) {
  const st = STATE[S.key];
  if (!st.result) compute(S.key);
  const mine = O.stateOf(Object.assign({}, p.engine.plain || p.engine.base, { souls: st.souls }), st.result.placed, st.on, rollsOf(p, st), p.engine.slots);
  const f = M.damage(mine).f;
  const dr = (1 - mine.dr.reduce((a, d) => a * (1 - d / 100), 1)) * 100;
  const ref = p.reference;
  // the slots whose stat priorities hold a stat – where to look for more of it
  const where = (k) => Object.entries(rollsOf(p, st)).filter(([, l]) => (l || []).some((x) => x.k === k)).map(([s]) => SLOT_NAME[s] || s);
  loopBox(body, p, st);
  wantsBox(body, p, st);
  const rows = [
    !p.skill.dot && ['Crit chance', Math.min(100, f.chance * 100), ref && ref.crit, '%', 'crit', 'Crits hit ×1.5 and more with crit damage multipliers – 100% is the cap.'],
    ['Attack speed', Math.min(100, mine.as), ref && ref.as, '%', 'as', 'More casts per second, capped at 100%.'],
    ['Cooldown reduction', mine.cdr, ref && ref.cdr, '%', 'cdr', 'Shorter cooldowns – each source adds a little less than the one before.'],
    ['Skill ranks', mine.rank - 1, ref && ref.rank - 1, '', 'rank', 'Each rank raises the skill % itself.'],
    ['Damage reduction', dr, ref && ref.dr, '%', 'dr', 'Sources multiply: 1 − (1−a)(1−b)…'],
    ['Movement speed', mine.move, ref && ref.move, '%', 'move', 'Clears faster; a Teleport evade (Enigma) on top.'],
    ['Armor', armorDR(mine), ref && armorDR({ armor: ref.armor, stat: ref.stat, mainStat: mine.mainStat }), '% less damage', 'armorFlat', 'Armor / (Armor × 10/9 + 5678) – against all damage, it nears 90% and never passes it.'],
    ['Weakest resistance', weakestRes(mine), ref && weakestRes({ resAll: ref.resAll, stat: ref.stat, mainStat: mine.mainStat, res: Object.fromEntries(RES_TYPES.map((t) => [t, ref['res' + t] || 0])) }), '% less', 'resAll',
      'Resistance / (Resistance × 10/9 + 1136) per type – no single one should fall far behind.'],
  ].filter(Boolean);
  const box = E('div', 'goals');
  const head = E('div', 'grow-row');
  head.appendChild(E('span', 'gh', 'Stat'));
  head.appendChild(E('span', 'gh', 'Your build'));
  head.appendChild(E('span', 'gh', ref ? 'Top builds' : ''));
  head.appendChild(E('span', 'gh', ''));
  box.appendChild(head);
  rows.forEach(([label, v, r, unit, k, why]) => {
    const row = E('div', 'grow-row');
    const l = E('div'); l.appendChild(E('b', null, label)); l.appendChild(E('small', null, why)); row.appendChild(l);
    row.appendChild(E('span', 'num', Math.round(v) + unit));
    row.appendChild(E('span', 'num muted', r == null ? '–' : Math.round(r) + unit));
    const short = r != null && v < r * 0.85 - 1;
    const w = where(k);
    row.appendChild(E('span', short ? 'nd' : 'muted', short ? 'below the top builds' + (w.length ? ' – rolls on ' + [...new Set(w)].join(', ') : '') : r == null ? '' : 'on par'));
    box.appendChild(row);
  });
  body.appendChild(box);
  body.appendChild(E('p', 'src-note', ref ? 'Both sides from the gear (stats, uniques, aspects, sockets) as the model reads it – the top builds are the ' + Math.round(ref.n) + ' proven ones shown in Build. Paragon and the rest come on top in the game.' : 'Top builds for comparison appear once proven builds for this skill are found.'));
}

/**
 * The skill's loop – which piece does what, and the breakpoints it needs with where the build
 * stands. Built from the pieces on the slots right now (lib/dmgmodel.js loop).
 */
function loopBox(body, p, st) {
  const full = stateWith(p, st, st.result.placed, st.on);
  const sources = Object.values(st.result.placed).filter((c) => c && c.name).map((c) => ({ name: c.name, effects: c.effects }))
    .concat(p.loopPassive ? [p.loopPassive] : []);
  const lp = M.loop(full, sources, { skill: p.skill.name, res: p.resource || (p.facts || {}).resource });
  if (!lp) return;
  const box = E('div', 'loop');
  box.appendChild(E('h3', null, 'How this build works'));
  // the resource budget needs the base regeneration – the game data has none, the character sheet does
  if (M.cycle(M.resolve(full)).sus.active) {
    const row = E('label', 'regen');
    row.appendChild(document.createTextNode('Your ' + (p.resource || 'resource') + ' regeneration per second (character sheet → Utility): '));
    const inp = E('input', 'num-in');
    inp.type = 'number'; inp.min = '0'; inp.step = '0.5'; inp.id = 'bdregen'; inp.value = String(st.baseRegen || 0);
    inp.onchange = () => { st.baseRegen = Math.max(0, Number(inp.value) || 0); compute(S.key); rerender(); };
    row.appendChild(inp);
    box.appendChild(row);
  }
  if (p.loopPassive) box.appendChild(E('p', 'muted', 'Specialization / key passive: ' + p.loopPassive.name));
  const ul = E('ul');
  lp.lines.forEach((l) => ul.appendChild(E('li', null, l)));
  box.appendChild(ul);
  if (lp.checks.length) {
    const t = E('div', 'checks');
    lp.checks.forEach((c) => {
      const row = E('div', c.ok ? 'ok' : 'nd');
      row.appendChild(E('b', null, c.label));
      row.appendChild(E('span', 'num', Math.round(c.have) + c.unit + ' / ' + Math.round(c.need) + c.unit));
      row.appendChild(E('span', null, c.ok ? 'reached' : 'short by ' + Math.round(c.need - c.have) + c.unit));
      t.appendChild(row);
    });
    box.appendChild(t);
    box.appendChild(E('p', 'src-note', "Breakpoints from the build's own numbers – game data for cooldowns and costs, the texts of its pieces. Gear only: charms and paragon add Maximum Resource, ranks and Cooldown Reduction on top."));
  }
  body.appendChild(box);
}

/**
 * What this build wants most now: one more of each stat it can roll, valued on the build as it
 * stands – crit damage where it crits, Maximum Resource where its loop spends the pool …
 */
function wantsBox(body, p, st) {
  const eng = p.engine;
  if (!eng.statOpts) return;
  const w = O.GOALS[st.goal || 'push'];
  const full = stateWith(p, st, st.result.placed, st.on);
  const best = new Map();
  for (const [slot, list] of Object.entries(eng.statOpts)) {
    for (const o of list) {
      const key = o.d;
      let b = best.get(key);
      if (!b) {
        const d = O.delta(full, M.apply(full, o.e, st.on));
        b = { d: o.d, temper: o.e.temper, g: o.g, dmg: d.dmg, tough: d.tough, v: O.value(d, w), slots: [] };
        best.set(key, b);
      }
      const n = SLOT_NAME[slot] || slot;
      if (!b.slots.includes(n)) b.slots.push(n);
    }
  }
  const top = [...best.values()].filter((b) => b.v > 0.001).sort((a, b) => b.v - a.v).slice(0, 8);
  if (!top.length) return;
  const box = E('div', 'wants');
  box.appendChild(E('h3', null, 'What this build wants most now'));
  top.forEach((b) => {
    const row = E('div', 'grow-row');
    const l = E('div'); l.appendChild(E('b', null, b.d)); l.appendChild(E('small', null, (b.temper ? 'temper' + (b.g ? ' – ' + b.g : '') + ' · ' : '') + b.slots.join(', '))); row.appendChild(l);
    row.appendChild(E('span', 'num up', pct(b.dmg)));
    row.appendChild(E('span', 'num upd', pct(b.tough)));
    box.appendChild(row);
  });
  box.appendChild(E('p', 'src-note', 'One more of each, on the build as it is now – damage, then toughness. It changes with every piece you swap.'));
  body.appendChild(box);
}

window.BuilderView = { render, hideTip: untip, _state: () => S, _plans: () => PLANS };
})();
