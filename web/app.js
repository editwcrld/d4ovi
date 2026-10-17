'use strict';
// The website's frame around the overlay's two build sections – the farm list (renderer/farm.js)
// and the builder (renderer/builder.js) – in place of renderer/app.js, which also runs the
// overlay window, its timers and its other sections.
(function () {
const api = window.d4api;
const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

let section = 'builder';
try { if (localStorage.getItem('d4web.section') === 'farm') section = 'farm'; } catch (_) {}
let note = null, noteTimer = null;

function showNote(text, kind, ms) {
  note = { text, kind: kind || 'info' };
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => { note = null; render(); }, ms || 6000);
  render();
}

// the build views (skill tree, paragon) take the height that is there
function fit() {
  const h = $('main').clientHeight;
  document.documentElement.style.setProperty('--view-h', Math.max(260, h - 96) + 'px');
}

function render() {
  const main = $('main');
  if (window.FarmView) window.FarmView.hideTip();
  if (window.BuildViews) window.BuildViews.hideTip();
  if (window.BuilderView) window.BuilderView.hideTip();
  main.textContent = '';
  main.classList.remove('farm', 'bd');
  document.querySelectorAll('#wtabs button').forEach((b) => b.classList.toggle('on', b.dataset.s === section));
  if (note) main.appendChild(el('div', 'note ' + note.kind, note.text));
  if (section === 'farm') window.FarmView.render(main, farmCtx);
  else window.BuilderView.render(main, builderCtx);
}

function open(s) {
  section = s;
  try { localStorage.setItem('d4web.section', s); } catch (_) {}
  $('main').scrollTop = 0;
  render();
}

// a build site's page: the overlay shows it inside, here it opens in a new tab
const openPage = (url) => { if (/^https:\/\//i.test(String(url || ''))) window.open(url, '_blank', 'noopener'); };

const builderCtx = {
  get api() { return api; },
  rerender: () => {
    if (section !== 'builder') return;
    const y = $('main').scrollTop;
    render();
    $('main').scrollTop = y;
  },
  note: (t, kind) => showNote(t, kind, 3500),
  openFarm: () => open('farm'),
  openPage,
};

const farmCtx = {
  get api() { return api; },
  el,
  rerender: () => { if (section === 'farm') render(); },
  note: (t, kind) => showNote(t, kind, 3500),
  openPage,
  status: (t) => { $('stData').textContent = t; },
};

// ---- device code: no login – the builds belong to a code this browser keeps -----------------
function syncDialog() {
  const shade = el('div', 'wshade');
  const box = el('div', 'wbox');
  box.appendChild(el('h3', null, 'Device code'));
  box.appendChild(el('p', null, 'Your builds are saved under this code. Enter it on another device (or after clearing the browser) to get the same builds there. Anyone with the code can see and change them.'));
  const code = el('input', 'wcode');
  code.value = window.d4web.code();
  code.readOnly = true;
  code.onfocus = () => code.select();
  const row1 = el('div', 'wrow');
  row1.appendChild(code);
  const cp = el('button', 'tbtn', 'Copy');
  cp.onclick = () => { api.copyText(code.value); cp.textContent = 'Copied'; };
  row1.appendChild(cp);
  box.appendChild(row1);
  box.appendChild(el('h4', null, 'Use another device\'s code'));
  const other = el('input', 'wcode');
  other.placeholder = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
  other.spellcheck = false;
  const row2 = el('div', 'wrow');
  row2.appendChild(other);
  const use = el('button', 'tbtn pri', 'Use it');
  const msg = el('p', 'wmsg');
  use.onclick = async () => {
    if (!window.d4web.useCode(other.value)) { msg.textContent = 'That is not a device code.'; return; }
    msg.textContent = 'Loading …';
    const d = await api.getBuilds();
    if (!d || d.error) { msg.textContent = (d && d.error) || 'Could not load the builds.'; return; }
    window.FarmView.adopt(d);
    shade.remove();
    showNote('Device code switched – ' + d.builds.length + ' build' + (d.builds.length === 1 ? '' : 's') + ' loaded.', 'ok', 3500);
  };
  row2.appendChild(use);
  box.appendChild(row2);
  box.appendChild(msg);
  const close = el('button', 'tbtn wclose', 'Close');
  close.onclick = () => shade.remove();
  box.appendChild(close);
  shade.appendChild(box);
  shade.onclick = (e) => { if (e.target === shade) shade.remove(); };
  document.body.appendChild(shade);
}

document.querySelectorAll('#wtabs button').forEach((b) => { b.onclick = () => { if (section !== b.dataset.s) open(b.dataset.s); }; });
$('wsync').onclick = syncDialog;
// the clan name: back to the start – Find a build, the classes
$('wbrand').onclick = (e) => {
  e.preventDefault();
  const st = window.BuilderView._state();
  Object.assign(st, { step: 'class', slot: null, skill: null, q: '' });
  open('builder');
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { const s = document.querySelector('.wshade'); if (s) s.remove(); } });
window.addEventListener('resize', fit);
fit();
render();
})();
