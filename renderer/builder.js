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
const KEEP = new Set(['tbtn', 'pri', 'sm']);
const E = (tag, cls, txt) => {
  const e = document.createElement(tag);
  if (cls) e.className = String(cls).split(/\s+/).filter(Boolean).map((c) => (KEEP.has(c) ? c : 'bd-' + c)).join(' ');
  if (txt != null) e.textContent = txt;
  return e;
};
const pic = (src, cls) => {
  const w = E('span', cls);
  if (src) { const i = document.createElement('img'); i.className = 'bd-ico'; i.src = src; i.alt = ''; i.referrerPolicy = 'no-referrer'; i.onerror = () => i.remove(); w.appendChild(i); }
  return w;
};
const pct = (v) => (v >= 0 ? '+' : '') + (Math.abs(v) >= 100 ? Math.round(v) : v.toFixed(1)) + '%';
const SLOT_NAME = { 'Chest Armor': 'Chest', Ring1: 'Ring', Ring2: 'Ring' };
const LEFT = ['Helm', 'Chest Armor', 'Gloves', 'Pants', 'Boots'], RIGHT = ['Amulet', 'Ring1', 'Ring2', 'Weapon', 'Off-Hand'];
const GOAL_LABEL = { push: 'Pit push', speed: 'Speed farm', boss: 'Bosses' };
const SITE = { 'maxroll.gg': 'maxroll', 'd2core.com': 'd2core', 'infinitybuilds.gg': 'infinitybuilds' };

let ctx = null, api = null;
let catalog = null, catalogErr = '';
const S = { step: 'class', cls: null, key: null, view: 'build', src: null, slot: null, skill: null, q: '' };
const PLANS = {};       // key -> plan (+ proven when loaded)
const STATE = {};       // key -> { on, forced, goal, mods, result, souls, par }
let tipEl = null;

const rerender = () => { if (ctx) ctx.rerender(); };
const go = (patch) => { Object.assign(S, patch); rerender(); };

function tip(e, title, text) {
  if (!tipEl) { tipEl = E('div', 'tip'); tipEl.hidden = true; document.body.appendChild(tipEl); }
  tipEl.replaceChildren(E('b', null, title), document.createTextNode(text || ''));
  tipEl.hidden = false; moveTip(e);
}
function moveTip(e) { if (!tipEl || tipEl.hidden) return; const r = tipEl.getBoundingClientRect(); tipEl.style.left = Math.min(innerWidth - r.width - 10, e.clientX + 14) + 'px'; tipEl.style.top = Math.min(innerHeight - r.height - 10, e.clientY + 14) + 'px'; }
function untip() { if (tipEl) tipEl.hidden = true; }
document.addEventListener('mousemove', moveTip);
const hover = (node, title, text) => { node.onmouseenter = (e) => tip(e, title, text); node.onmouseleave = untip; };

// ---------------- data ----------------
async function loadCatalog() {
  if (catalog || catalogErr) return;
  const r = await api.builderCatalog();
  if (!r || r.error) catalogErr = (r && r.error) || 'The game data could not be loaded.'; else catalog = r;
  rerender();
}
async function loadPlan(key) {
  const st = STATE[key] || (STATE[key] = { on: null, forced: {}, goal: 'push', mods: {}, souls: 100 });
  const p = await api.builderPlan(S.cls, key, {});
  if (!p || p.error) { PLANS[key] = { error: (p && p.error) || 'No plan for this skill.' }; rerender(); return; }
  PLANS[key] = Object.assign(PLANS[key] || {}, p);
  if (!st.on) st.on = Object.assign({}, p.on);
  rerender();
  // the proven builds take a few seconds – imported and explained in the main process
  const pr = await api.builderProven(S.cls, key);
  const plan = PLANS[key];
  plan.provenLoaded = true;
  if (pr && !pr.error) {
    plan.proven = pr.proven; plan.consensus = pr.consensus;
    for (const c of plan.engine.cands) c.used = pr.usage[c.name] || 0;
    if (S.key === key && S.src === 'own' && !S.touched && pr.proven.length) S.src = 0;
  } else plan.provenError = (pr && pr.error) || '';
  rerender();
}

// ---------------- engine in the page ----------------
function compute(key) {
  const p = PLANS[key];
  const st = STATE[key];
  const eng = p.engine;
  const w = O.GOALS[st.goal || 'push'];
  const cands = eng.cands;
  const withSouls = (s) => Object.assign({}, s, { souls: st.souls });
  let base = withSouls(eng.state);
  const forced = {};
  for (const [slot, name] of Object.entries(st.forced)) {
    const c = cands.find((x) => x.name === name);
    if (c) { forced[slot] = c; base = c.effects.reduce((s, e) => M.apply(s, e, st.on), base); }
  }
  const free = eng.slots.filter((s) => !forced[s]);
  const taken = new Set(Object.values(forced).map((c) => c.name));
  const hasMythic = Object.values(forced).some((c) => c.mythic);
  const r = O.fillGear(cands.filter((c) => !taken.has(c.name) && !(hasMythic && c.mythic)), base, st.on, w, free);
  const placed = Object.assign({}, forced, r.placed);
  const sh = O.shares(cands, placed, withSouls(eng.state), st.on, w);
  st.result = { placed, shares: sh.out, full: sh.full };
  return st;
}
const stateOf = (p, st, pieces, on) => pieces.reduce((s, c) => c.effects.reduce((x, e) => M.apply(x, e, on), s), Object.assign({}, p.engine.state, { souls: st.souls }));
function swapGainAt(p, st, c, slot) {
  const placed = st.result.placed;
  if (c.mythic && Object.entries(placed).some(([s, x]) => x.mythic && s !== slot)) return null;
  const others = Object.entries(placed).filter(([s]) => s !== slot).map(([, x]) => x);
  if (others.some((x) => x.name === c.name)) return null;
  const d = O.delta(st.result.full, stateOf(p, st, others.concat(c), st.on));
  return { slot, dmg: d.dmg, tough: d.tough, speed: d.speed, v: O.value(d, O.GOALS[st.goal || 'push']) };
}
function swapGain(p, st, c) {
  let best = null;
  for (const slot of p.engine.slots) {
    if (!c.slots.includes(slot.replace(/\d$/, ''))) continue;
    if (st.result.placed[slot] && st.result.placed[slot].name === c.name) return { slot, dmg: 0, tough: 0, here: true };
    const g = swapGainAt(p, st, c, slot);
    if (g && (!best || g.v > best.v)) best = g;
  }
  return best;
}

// ---------------- frame ----------------
function render(main, c) {
  ctx = c; api = c.api;
  main.classList.add('bd');
  const head = E('div', 'head');
  head.appendChild(E('h2', null, 'Builder'));
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
    [['build', 'Build'], ['paragon', 'Paragon'], ['goals', 'Goals']].forEach(([k, l]) => { const b = E('button', S.view === k ? 'on' : '', l); b.onclick = () => go({ view: k }); v.appendChild(b); });
    head.appendChild(v);
    const save = E('button', 'tbtn pri', 'Save as build');
    save.title = 'Into the farm list – every piece with where it drops, the skills and the paragon';
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
  const st = STATE[S.key];
  let picks;
  if (typeof S.src === 'number' && p.proven && p.proven[S.src]) picks = { url: p.proven[S.src].url };
  else picks = { pieces: Object.fromEntries(Object.entries(st.result ? st.result.placed : {}).map(([s, c]) => [s, c.name])), mods: st.mods, on: st.on, name: p.skill.name + ' ' + p.cls };
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
  const l = E('p', 'lead'); l.innerHTML = 'Which skill should do the damage? <b>S / A</b> – a current endgame guide is built around it.';
  body.appendChild(l);
  const order = ['Basic', 'Core'];
  const cats = [...new Set(c.skills.map((s) => s.cat))].sort((a, b) => (order.indexOf(a) + 1 || 9) - (order.indexOf(b) + 1 || 9));
  for (const cat of cats) {
    const sec = E('section', 'cat');
    sec.appendChild(E('h4', null, cat));
    const g = E('div', 'sgrid');
    for (const s of c.skills.filter((x) => x.cat === cat)) {
      const b = E('button', 'sk');
      b.appendChild(pic(SKILL_ICON(s.icon), 'si'));
      b.appendChild(E('span', 'nm', s.name));
      if (s.tier === 'S' || s.tier === 'A') b.appendChild(E('span', 'tier ' + s.tier, s.tier));
      hover(b, s.name, (s.el ? s.el + ' · ' : '') + s.desc);
      b.onclick = () => { untip(); S.touched = false; go({ step: 'plan', key: s.key, view: 'build', src: 'own', slot: null, skill: null, q: '' }); if (!PLANS[s.key] || PLANS[s.key].error) loadPlan(s.key); };
      g.appendChild(b);
    }
    sec.appendChild(g);
    body.appendChild(sec);
  }
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
  if (S.view === 'paragon') return paragonView(body, p);
  if (S.view === 'goals') return goalsView(body, p);

  // where the build comes from
  const strip = E('div', 'srcs');
  (p.proven || []).forEach((b, i) => {
    const c = E('button', 'src' + (S.src === i ? ' on' : ''));
    const top = E('span', 'st');
    top.appendChild(E('span', 'site ' + (SITE[b.site] || ''), SITE[b.site] || b.site));
    top.appendChild(E('span', b.tier ? 'tier ' + b.tier : 'likes', b.tier ? b.tier + '-Tier' : '♥ ' + b.likes));
    c.appendChild(top);
    c.appendChild(E('b', null, b.title.replace(/\s+/g, ' ').slice(0, 70)));
    c.appendChild(E('span', 'au', (b.author ? b.author + ' · ' : '') + String(b.variant || '').split('–').pop().trim().slice(0, 30)));
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
const condLabel = (p, id) => (id[0] === '?' ? '“' + id.slice(1) + '”' : ((p.conditionList.find((c) => c.id === id) || {}).label || id));
const KIND = {
  x: (e) => '×' + e.v + '% own multiplier', xper: (e) => '×' + e.v + '% per soul', add: (e) => '+' + e.v + '% to the [+] pool', cdx: (e) => 'crit damage ×' + e.v + '%', ccx: (e) => 'crit chance ×' + e.v + '%',
  cc: (e) => (e.v > 0 ? '+' : '') + e.v + '% crit chance', as: (e) => '+' + e.v + '% attack speed', cdr: (e) => e.v + '% cooldown reduction', rank: (e) => '+' + e.v + ' skill ranks',
  vuln: () => 'makes enemies Vulnerable', dr: (e) => e.v + '% damage reduction', life: (e) => '+' + e.v + '% max life', move: (e) => (e.v > 0 ? '+' : '') + e.v + '% movement speed',
  teleport: () => 'Evade becomes Teleport', taken: (e) => '+' + e.v + '% damage taken', takenper: (e) => '+' + e.v + '% damage taken per soul',
  roll: (e) => e.text,
};

// ---------------- a proven build, explained ----------------
function provenView(body, p, b) {
  const x = b.explain;
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
      const sl = E('span', 's', SLOT_NAME[g.slot] || g.slot); const u = usedTag(g.used, n); if (u) sl.appendChild(u); tt.appendChild(sl);
      tt.appendChild(E('span', 'n ' + rarCls(g), g.name));
      const gl = E('span', 'g');
      if (g.dmg > 0.5) gl.appendChild(E('span', 'up', pct(g.dmg) + ' dmg '));
      if (g.tough > 0.5) gl.appendChild(E('span', 'upd', pct(g.tough) + ' tough '));
      if (g.speed > 0.5) gl.appendChild(E('span', 'spd', pct(g.speed) + ' speed'));
      if (!gl.childNodes.length) gl.appendChild(E('span', 'muted', 'utility'));
      tt.appendChild(gl);
      btn.appendChild(tt);
      btn.onclick = () => go({ slot: S.slot === idx ? null : idx });
      col.appendChild(btn);
    });
    doll.appendChild(col);
  }
  sheet.appendChild(doll);
  const side = E('div', 'side');
  if (S.slot != null && x.gear[S.slot]) provenPiece(side, p, x.gear[S.slot]);
  else {
    const sec = E('section');
    sub(sec, 'Why this build works');
    const tot = E('div', 'tots');
    const T = x.totals;
    [[p.skill.dot ? null : 'Crit chance', T.crit + '%'], [p.skill.dot ? null : 'A crit hits', '×' + T.critX], ['Vulnerable', '×' + T.vulnX],
      ['Skill ranks', '+' + T.ranks], ['Damage reduction', T.dr + '%'], ['Cooldown red.', T.cdr + '%'], ['Evade', T.teleport ? 'Teleport' : 'normal']]
      .filter(([a]) => a).forEach(([a, v]) => { const d = E('div'); d.appendChild(E('b', null, v)); d.appendChild(E('span', null, a)); tot.appendChild(d); });
    sec.appendChild(tot);
    const ul = E('ul', 'adv');
    const LABEL = { damage: 'Damage', crit: 'Crits', vuln: 'Vulnerable', tough: 'Survival', speed: 'Speed', leoric: 'Helm', splinter: 'Splinters', cond: 'Relies on', other: 'Not counted' };
    x.lines.forEach((l) => { const li = E('li'); const s = E('span'); s.appendChild(E('b', null, LABEL[l.k] || '')); s.appendChild(document.createTextNode(' — ' + l.t)); li.appendChild(s); ul.appendChild(li); });
    sec.appendChild(ul);
    side.appendChild(sec);
    const act = E('div', 'acts');
    const custom = E('button', 'tbtn', 'Make it my own');
    custom.title = 'Takes these pieces into "Build it yourself" – swap anything and see what it does';
    custom.onclick = () => {
      const st = STATE[S.key];
      st.forced = {};
      x.gear.forEach((g) => { if (/^Weapon [23]$/.test(g.slot)) return; if (p.engine.cands.find((c) => c.name === g.name) && !st.forced[g.slot]) st.forced[g.slot] = g.name; });
      S.touched = true;
      go({ src: 'own', slot: null });
    };
    act.appendChild(custom);
    const open = E('button', 'tbtn', 'Open on ' + (SITE[b.site] || b.site));
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
  t.appendChild(E('div', 'k', (g.kind === 'aspect' ? 'Legendary aspect' : g.mythic ? 'Mythic unique' : 'Unique') + ' · ' + (SLOT_NAME[g.slot] || g.slot) + (g.used ? ' · in ' + g.used + ' of ' + n + ' top builds' : '')));
  if (g.desc) t.appendChild(E('p', 'txt', g.desc));
  const gr = E('div', 'gainrow');
  [[g.dmg, 'damage', 'up'], [g.tough, 'toughness', 'upd'], [g.speed, 'speed', 'spd']].forEach(([v, l, c]) => { if (Math.abs(v) < 0.5 && l !== 'damage') return; const d = E('div'); d.appendChild(E('b', c, pct(v))); d.appendChild(E('span', null, l + ' – lost without it')); gr.appendChild(d); });
  t.appendChild(gr);
  det.appendChild(t);
  side.appendChild(det);
  if (g.stats.length) {
    const sec = E('section'); sub(sec, 'Its stats in this build');
    const ul = E('ul', 'stats'); g.stats.forEach((s, i) => { const li = E('li'); li.appendChild(E('span', null, String(i + 1))); li.appendChild(E('span', null, s)); ul.appendChild(li); });
    sec.appendChild(ul); side.appendChild(sec);
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
  if (Object.keys(st.forced).length) { const r = E('button', 'tbtn sm', 'Let the builder pick everything'); r.onclick = () => { st.forced = {}; rerender(); }; goals.appendChild(r); }
  body.appendChild(goals);

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
  for (const colSlots of [LEFT, RIGHT]) {
    const col = E('div', 'col');
    for (const s of colSlots) {
      if (!p.engine.slots.includes(s)) continue;
      const c = st.result.placed[s], sh = st.result.shares[s] || {};
      const b = E('button', 'gs' + (S.slot === s ? ' on' : ''));
      b.appendChild(c ? pic(c.icon, giCls(c)) : E('span', 'gi', '—'));
      const tt = E('span', 't');
      const sl = E('span', 's', SLOT_NAME[s] || s); const u = c && usedTag(c.used, p.consensus && p.consensus.n); if (u) sl.appendChild(u); tt.appendChild(sl);
      tt.appendChild(E('span', 'n ' + (c ? rarCls(c) : ''), c ? c.name : 'empty'));
      const g = E('span', 'g');
      if (sh.dmg > 0.05) g.appendChild(E('span', 'up', pct(sh.dmg) + ' dmg '));
      if (sh.tough > 0.05) g.appendChild(E('span', 'upd', pct(sh.tough) + ' tough '));
      if (sh.speed > 0.5) g.appendChild(E('span', 'spd', pct(sh.speed) + ' speed'));
      if (!g.childNodes.length) g.appendChild(E('span', 'muted', 'utility'));
      tt.appendChild(g);
      b.appendChild(tt);
      b.appendChild(E('span', 'chg', 'Change'));
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
  const rows = Object.entries(st.result.placed).map(([s, c]) => ({ s, c, sh: st.result.shares[s] || { dmg: 0, tough: 0 } }));
  const maxD = Math.max(1, ...rows.map((r) => r.sh.dmg)), maxT = Math.max(1, ...rows.map((r) => r.sh.tough));
  rows.sort((a, b) => b.sh.dmg - a.sh.dmg || b.sh.tough - a.sh.tough).forEach((r) => {
    const tough = r.sh.dmg < 0.05 && r.sh.tough > 0.05;
    const row = E('div', 'cb');
    row.appendChild(pic(r.c.icon, 'mi'));
    row.appendChild(E('span', 'nm ' + rarCls(r.c), r.c.name));
    const tr = E('div', 'tr'); const i = E('i', tough ? 'd' : ''); i.style.width = Math.max(2, (tough ? r.sh.tough / maxT : r.sh.dmg / maxD) * 100) + '%'; tr.appendChild(i); row.appendChild(tr);
    row.appendChild(E('span', 'v ' + (tough ? 'upd' : 'up'), tough ? pct(r.sh.tough) : r.sh.dmg > 0.05 ? pct(r.sh.dmg) : '—'));
    const b = E('button', 'chgb', 'Change'); b.onclick = () => go({ slot: r.s }); row.appendChild(b);
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
    let d = (M.damage(stateOf(p, st, placed, on2)).dps / base - 1) * 100;
    let via = '';
    if (!st.on[id]) {
      const st2 = Object.assign({}, st, { on: on2 });
      for (const c of p.engine.cands) {
        if (!c.effects.some((e) => e.cond.includes(id))) continue;
        for (const slot of p.engine.slots) {
          if (!c.slots.includes(slot.replace(/\d$/, ''))) continue;
          const g = swapGainAt(p, st2, c, slot);
          if (g && g.dmg > d) { d = g.dmg; via = c.name; }
        }
      }
    }
    return { id, d, via };
  }).sort((a, b) => (!!st.on[b.id]) - (!!st.on[a.id]) || Math.abs(b.d) - Math.abs(a.d) || (a.id[0] === '?') - (b.id[0] === '?')).slice(0, 18);
  ids.forEach(({ id, d, via }) => {
    const on = !!st.on[id];
    const b = E('button', 'cond' + (on ? ' on' : '') + (id[0] === '?' ? ' q' : ''));
    b.appendChild(document.createTextNode(condLabel(p, id)));
    if (!on && d > 0.5) b.appendChild(E('span', 'gn', pct(d)));
    b.title = on ? 'Counted. Click if it is not true in your fights.' : (d > 0.5 ? 'When this is true: up to ' + pct(d) + ' damage' + (via ? ' (e.g. with ' + via + ')' : '') + '. Click and the builder picks the gear for it.' : 'Click if this is true in your fights.');
    b.onclick = () => { st.on[id] = !on; rerender(); };
    conds.appendChild(b);
  });
  sec2.appendChild(conds);
  side.appendChild(sec2);

  if (p.talisman && p.talisman.length) {
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
  t.appendChild(E('div', 'muted', (c.kind === 'aspect' ? 'Aspect' : c.mythic ? 'Mythic' : 'Unique') + (g && g.slot ? ' · ' + (SLOT_NAME[g.slot] || g.slot) : '') + (c.used && n ? ' · in ' + c.used + ' of ' + n + ' top builds' : '')));
  const needs = [...new Set(c.effects.filter((e) => e.scope !== 'other').flatMap((e) => e.cond).filter((x) => !st.on[x]))];
  if (needs.length) t.appendChild(E('div', 'nd', 'only while ' + needs.map((x) => condLabel(p, x)).join(', ')));
  else if (!c.counted) t.appendChild(E('div', 'muted', 'utility or its own damage – not counted'));
  r.appendChild(t);
  const v = E('span', 'v');
  if (g && g.here) v.appendChild(E('span', 'muted', 'equipped'));
  else if (g) {
    v.appendChild(E('span', g.dmg > 0.05 ? 'up' : g.dmg < -0.05 ? 'nd' : 'muted', Math.abs(g.dmg) > 0.05 ? pct(g.dmg) + ' dmg' : '±0 dmg'));
    if (Math.abs(g.tough) > 0.05) { v.appendChild(E('br')); v.appendChild(E('span', g.tough > 0 ? 'upd' : 'nd', pct(g.tough) + ' tough')); }
    if (Math.abs(g.speed || 0) > 0.5) { v.appendChild(E('br')); v.appendChild(E('span', g.speed > 0 ? 'spd' : 'nd', pct(g.speed) + ' speed')); }
  }
  r.appendChild(v);
  if (g && !g.here) { const use = E('button', 'tbtn sm', 'Use'); use.onclick = onUse; r.appendChild(use); } else r.appendChild(E('span'));
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
    const g1 = E('div'); g1.appendChild(E('b', 'up', pct(sh.dmg || 0))); g1.appendChild(E('span', null, 'damage, on top of the rest')); gr.appendChild(g1);
    const g2 = E('div'); g2.appendChild(E('b', 'upd', pct(sh.tough || 0))); g2.appendChild(E('span', null, 'toughness')); gr.appendChild(g2);
    t.appendChild(gr);
    det.appendChild(t);
    side.appendChild(det);
  }
  const g = p.gear[slot] || { stats: [], tempers: [] };
  const sec = E('section');
  sub(sec, 'Stats to look for');
  const ul = E('ul', 'stats');
  g.stats.forEach((x, i) => { const li = E('li'); li.appendChild(E('span', null, String(i + 1))); li.appendChild(E('span', null, x.d)); ul.appendChild(li); });
  g.tempers.slice(0, 1).forEach((x) => { const li = E('li', 'tmp'); li.appendChild(E('span', null, '⚒')); li.appendChild(E('span', null, x.d + ' · temper')); ul.appendChild(li); });
  sec.appendChild(ul);
  side.appendChild(sec);
  const sec2 = E('section');
  sub(sec2, 'Change it – best options for this slot');
  const alts = E('div', 'alts');
  p.engine.cands.filter((x) => x.slots.includes(slot.replace(/\d$/, '')) && (!c || x.name !== c.name))
    .map((x) => ({ x, g: swapGainAt(p, st, x, slot) })).filter((o) => o.g).sort((a, b) => b.g.v - a.g.v || (b.x.used || 0) - (a.x.used || 0)).slice(0, 8)
    .forEach(({ x, g: gg }) => alts.appendChild(pieceRow(p, st, x, gg, () => { st.forced[slot] = x.name; rerender(); })));
  sec2.appendChild(alts);
  if (st.forced[slot]) { const reset = E('button', 'tbtn sm', 'Let the builder pick again'); reset.onclick = () => { delete st.forced[slot]; rerender(); }; sec2.appendChild(reset); }
  side.appendChild(sec2);
}

// ---------------- paragon: the suggested way through each board ----------------
const PKIND = ['normal', 'normal', 'magic', 'rare', 'legendary'];
function paragonView(body, p) {
  if (!p.paragon) { body.appendChild(E('p', 'wait', 'The paragon boards are not loaded.')); return; }
  const st = STATE[S.key];
  const pst = st.par || (st.par = { b: 0, n: 0 });
  const wrap = E('div', 'para');
  const list = E('div', 'blist');
  p.paragon.boards.forEach((b, i) => {
    const x = E('button', 'bl' + (pst.b === i ? ' on' : ''));
    x.appendChild(E('b', null, (i + 1) + '. ' + b.name));
    if (b.node && b.node !== b.name) x.appendChild(E('span', null, b.node));
    x.appendChild(E('span', 'gl', '◈ ' + (b.glyph ? b.glyph.name : 'no glyph')));
    x.onclick = () => { pst.b = i; pst.n = 0; rerender(); };
    list.appendChild(x);
  });
  wrap.appendChild(list);
  const b = p.paragon.boards[pst.b];
  const box = E('div', 'pwrap');
  const head = E('div', 'det');
  const tt = E('div');
  tt.appendChild(E('h3', null, b.name));
  tt.appendChild(E('p', 'txt', b.desc || 'Start board'));
  if (b.glyph) { const gl = E('p', 'txt'); gl.appendChild(E('span', 'glyph', '◈ ' + b.glyph.name)); gl.appendChild(document.createTextNode(' — ' + b.glyph.bonus)); tt.appendChild(gl); }
  head.appendChild(tt);
  box.appendChild(head);
  const total = b.order.length;
  const shown = pst.n || total;
  const step = new Map(b.order.slice(0, shown).map((o, i) => [o.r + '_' + o.c, i]));
  const next = b.order[shown] ? b.order[shown].r + '_' + b.order[shown].c : '';
  const NS = 'http://www.w3.org/2000/svg';
  const svgEl = document.createElementNS(NS, 'svg');
  svgEl.setAttribute('viewBox', '-1 -1 23 23');
  svgEl.setAttribute('class', 'bd-board');
  const mk = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svgEl.appendChild(e); return e; };
  mk('rect', { x: -0.5, y: -0.5, width: 22, height: 22, rx: 0.8, class: 'bd-pbg' });
  b.rows.forEach((row, r) => String(row).split(',').forEach((key, c) => {
    if (!key) return;
    const node = b.nodes[key] || { r: 0, t: '', name: key, d: '' };
    const kind = node.t || PKIND[node.r] || 'normal';
    const on = step.has(r + '_' + c);
    const cls = 'bd-pn bd-' + kind + (on ? ' bd-on' : '') + (next === r + '_' + c ? ' bd-next' : '');
    const x = c + 0.5, y = r + 0.5;
    let shp;
    if (kind === 'gate') shp = mk('rect', { x: x - 0.36, y: y - 0.36, width: 0.72, height: 0.72, transform: 'rotate(45 ' + x + ' ' + y + ')', class: cls });
    else if (kind === 'socket' || kind === 'start') shp = mk('circle', { cx: x, cy: y, r: 0.44, class: cls });
    else { const s = kind === 'legendary' ? 0.9 : kind === 'rare' ? 0.76 : kind === 'magic' ? 0.66 : 0.54; shp = mk('rect', { x: x - s / 2, y: y - s / 2, width: s, height: s, rx: 0.12, class: cls }); }
    shp.addEventListener('mouseenter', (e) => tip(e, kind === 'socket' && b.glyph ? '◈ ' + b.glyph.name : node.name.replace(/^Generic_/, '').replace(/_/g, ' '),
      (on ? 'Point ' + (step.get(r + '_' + c) + 1) + ' · ' : 'not taken · ') + (kind === 'socket' && b.glyph ? b.glyph.desc : String(node.d || kind).replace(/\n/g, ' · '))));
    shp.addEventListener('mouseleave', untip);
  }));
  box.appendChild(svgEl);
  const rg = E('label', 'prange');
  rg.appendChild(E('span', null, 'Points on this board'));
  const inp = E('input'); inp.type = 'range'; inp.id = 'bdpts'; inp.min = 1; inp.max = total; inp.value = shown;
  inp.oninput = () => { pst.n = Number(inp.value); rerender(); };
  rg.appendChild(inp);
  rg.appendChild(E('b', null, String(shown)));
  box.appendChild(rg);
  box.appendChild(E('p', 'src-note', 'From the entry gate, always the next node that adds most per point – rare nodes near the glyph and the legendary node come early; the way to the next board\'s gate comes last. Saved as a build, the boards land in the paragon view joined at their gates.'));
  wrap.appendChild(box);
  body.appendChild(wrap);
}

function goalsView(body, p) {
  const g = E('div', 'cards');
  p.targets.forEach((t) => { const c = E('div', 'card'); c.appendChild(E('span', 's', t.stat)); c.appendChild(E('b', null, t.goal)); c.appendChild(E('p', null, t.why)); g.appendChild(c); });
  body.appendChild(g);
}

window.BuilderView = { render, hideTip: untip, _state: () => S, _plans: () => PLANS };
})();
