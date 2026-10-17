// The cheat sheet of a build: what to reach, what to set up once, how to play it and why it works –
// on one page, before the gear. Breakpoints, rotation and the must-have pieces come from the guide
// authors' notes (lib/guideinfo.js, read out by d4builder); the class mechanic and the mercenaries
// from the build's own data (b.setup). Hover a line for the author's own words.
(function () {
'use strict';
const mk = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };
const SITE = { maxroll: 'maxroll', d4builds: 'd4builds', infinitybuilds: 'infinitybuilds', d2core: 'd2core' };
const sheets = new Map();          // key -> sheet | null (none) | 'wait'

// ---- the author's words on hover ----
let tip = null;
function place(e) {
  if (!tip || tip.hidden) return;
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(6, Math.min(innerWidth - r.width - 10, e.clientX + 14)) + 'px';
  tip.style.top = Math.max(6, Math.min(innerHeight - r.height - 10, e.clientY + 14)) + 'px';
}
function said(node, title, quote, why) {
  if (!quote && !why) return;
  node.classList.add('gd-has');
  node.onmouseenter = (e) => {
    if (!tip) { tip = mk('div', 'gd-tip'); document.body.appendChild(tip); }
    const c = mk('div', 'ctt');
    c.appendChild(mk('div', 'ty', title));
    if (why) c.appendChild(mk('div', 'sec ds', why));
    if (quote) c.appendChild(mk('div', 'sec ds gd-q', '“' + quote + '”'));
    tip.replaceChildren(c);
    tip.hidden = false; place(e);
  };
  node.onmousemove = place;
  node.onmouseleave = () => { if (tip) tip.hidden = true; };
}
const hideTip = () => { if (tip) tip.hidden = true; };

/** "≥ 225" / "≤ 15 s" / "60%" – a breakpoint's number the way it reads in the game. */
function figure(t) {
  const unit = t.unit === '%' ? '%' : t.unit ? ' ' + t.unit : '';
  const op = t.op === '<=' || t.op === '<' ? '≤ ' : '';
  const v = typeof t.value === 'number' ? t.value.toLocaleString('en-US') : String(t.value);
  return op + v + unit;
}
const forChips = (x, parent) => { (x.for || []).forEach((f) => parent.appendChild(mk('span', 'gd-for', f))); };

function card(title, cls) {
  const c = mk('section', 'gd-card' + (cls ? ' ' + cls : ''));
  c.appendChild(mk('h4', null, title));
  return c;
}

/** The build's main skill: the first on its bar. */
const mainSkill = (b) => (b.skills && b.skills.bar && b.skills.bar[0] && b.skills.bar[0].name) || '';

function render(box, b, o) {
  hideTip();
  const key = (b.source && b.source.url) || b.cls + '|' + mainSkill(b);
  if (!sheets.has(key)) {
    sheets.set(key, 'wait');
    o.api.guideSheet({ url: b.source && b.source.url, cls: b.cls, skill: mainSkill(b) })
      .then((s) => { sheets.set(key, s || null); o.rerender(); }, () => { sheets.set(key, null); o.rerender(); });
  }
  const s = sheets.get(key);
  if (s === 'wait') { box.appendChild(mk('div', 'empty', 'Reading the guide …')); return; }
  box.appendChild(sheetPage(s, b.setup || null, b.charms, o));
}

/**
 * The page itself, from what is known: s the recipe (or null), setup the build's mechanic and
 * mercenaries, charms its talisman. o.one: one column (a side panel).
 */
function sheetPage(s, setup, charms, o) {
  const page = mk('div', 'gd' + (o.one ? ' gd-one' : ''));
  if (s && s.own === false) page.appendChild(mk('p', 'gd-lead', 'This build has no guide of its own – what the ' + (SITE[s.site] || s.site) + ' guide for ' + s.skill + ' says.'));

  // what to reach – big numbers first
  if (s && s.thresholds.length) {
    const c = card('Breakpoints – what the guide says you need', 'gd-wide');
    const g = mk('div', 'gd-bps');
    s.thresholds.forEach((t) => {
      const d = mk('div', 'gd-bp');
      d.appendChild(mk('b', null, figure(t)));
      d.appendChild(mk('span', 'gd-st', t.stat));
      if (t.why) d.appendChild(mk('span', 'gd-why', t.why));
      forChips(t, d);
      said(d, t.stat + ' ' + figure(t), t.quote, t.why);
      g.appendChild(d);
    });
    c.appendChild(g);
    page.appendChild(c);
  }

  // what you set up once: the class mechanic, the mercenaries
  const rows = [];
  ((setup && setup.mech) || []).forEach((m) => rows.push([m.group, m.name]));
  if (!rows.length && s) s.core.filter((x) => x.kind === 'mechanic').forEach((x) => rows.push(['Class mechanic', x.name, x.role]));
  const merc = (setup && setup.merc) || {};
  if (merc.hired) rows.push(['Mercenary', merc.hired]);
  if (merc.support) rows.push(['Reinforcement', merc.support + (merc.skill ? ' · ' + merc.skill : ''), merc.trigger ? 'on ' + merc.trigger : '']);
  else if (merc.skill) rows.push(['Reinforcement', merc.skill, merc.trigger ? 'on ' + merc.trigger : '']);
  if (charms && charms.seal) rows.push(['Talisman', charms.seal.name, (charms.list || []).length ? '+ ' + charms.list.length + ' charms' : '']);
  if (rows.length) {
    const c = card('Set up once');
    const g = mk('div', 'gd-kv');
    rows.forEach(([k, v, note]) => {
      g.appendChild(mk('span', 'gd-k', k));
      const val = mk('span', 'gd-v');
      val.appendChild(mk('b', null, v));
      if (note) val.appendChild(mk('span', 'gd-note', ' – ' + note));
      g.appendChild(val);
    });
    c.appendChild(g);
    page.appendChild(c);
  }

  if (s && s.rotation.length) {
    const c = card('How to play it');
    const ol = mk('ol', 'gd-rot');
    s.rotation.forEach((r) => { const li = mk('li', null, r.step); forChips(r, li); ol.appendChild(li); });
    c.appendChild(ol);
    page.appendChild(c);
  }

  if (s && (s.summary || s.core.length)) {
    const c = card('Why it works');
    if (s.summary) c.appendChild(mk('p', 'gd-sum', s.summary));
    if (s.core.length) {
      const ul = mk('ul', 'gd-core');
      s.core.forEach((x) => {
        const li = mk('li');
        li.appendChild(mk('b', 'gd-' + (x.kind || 'piece'), x.name));
        if (x.role) li.appendChild(document.createTextNode(' – ' + x.role));
        forChips(x, li);
        said(li, x.name, x.quote);
        ul.appendChild(li);
      });
      c.appendChild(ul);
    }
    page.appendChild(c);
  }

  if (s && s.options.length) {
    const c = card('Swaps the guide names');
    const ul = mk('ul', 'gd-opts');
    s.options.forEach((x) => {
      const li = mk('li');
      li.appendChild(mk('span', 'gd-when', x.when));
      li.appendChild(mk('span', 'gd-arrow', '→'));
      li.appendChild(mk('span', null, x.then));
      forChips(x, li);
      said(li, x.when, x.quote);
      ul.appendChild(li);
    });
    c.appendChild(ul);
    page.appendChild(c);
  }

  if (!s && !rows.length) {
    page.appendChild(mk('div', 'empty', 'No notes for this build: its guide has not been read yet. Gear, skills and paragon are in the other tabs.'));
  }
  if (s && !o.noFoot) {
    const foot = mk('div', 'gd-foot');
    foot.appendChild(mk('span', null, 'From the author\'s notes' + (s.variant ? ' · ' + s.variant : '') + ' · hover a line for their own words'));
    if (s.url) {
      const a = mk('button', 'ab', 'Open the guide on ' + (SITE[s.site] || s.site));
      a.onclick = () => o.api.openBuildSource(s.url);
      foot.appendChild(a);
    }
    page.appendChild(foot);
  }
  return page;
}

/** Is there anything to show – the build's own setup, or a guide it may have (asked when the tab opens). */
const has = (b) => !!(b && (b.setup || (b.source && b.source.url) || mainSkill(b)));

window.BuildGuide = { render, sheetPage, has, hideTip, figure };
})();
