'use strict';
// window.d4api for the website: the calls the overlay's preload sends to the main process go to
// web/server.js instead; the ones that open dialogs or the clipboard happen here in the page.
(function () {
const KEY = 'd4web.owner';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const newCode = () => (crypto.randomUUID ? crypto.randomUUID()
  : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));
let owner = '';
try { owner = localStorage.getItem(KEY) || ''; } catch (_) { /* storage blocked: a code for this visit only */ }
if (!UUID_RE.test(owner)) { owner = newCode(); try { localStorage.setItem(KEY, owner); } catch (_) {} }

function call(name, ...args) {
  return fetch('/api/' + name, { method: 'POST', headers: { 'content-type': 'application/json', 'x-owner': owner }, body: JSON.stringify(args) })
    .then((r) => r.json())
    .catch((e) => ({ error: 'Server not reachable (' + e.message + ')' }));
}
const copy = (t) => { try { navigator.clipboard.writeText(String(t || '')); } catch (_) {} };

/** A file the user picks – its text, or null when the dialog was closed. */
function pickFile(accept) {
  return new Promise((resolve) => {
    const i = document.createElement('input');
    i.type = 'file'; i.accept = accept;
    i.onchange = () => { const f = i.files && i.files[0]; if (!f) return resolve(null); f.text().then(resolve, () => resolve(null)); };
    i.oncancel = () => resolve(null);
    i.click();
  });
}

window.d4api = {
  getFarm: () => call('getFarm'),
  farmTooltip: (type, id) => call('farmTooltip', type, id),
  farmCss: () => call('farmCss'),
  getBuilds: () => call('getBuilds'),
  saveBuilds: (d) => call('saveBuilds', d),
  buildCode: async (b) => { const c = await call('buildCode', b); if (typeof c === 'string') copy(c); return c; },
  importBuildText: (t) => call('importBuildText', t),
  exportBuilds: async () => {
    const d = await call('getBuilds');
    if (!d || d.error) return null;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: 'application/json' }));
    a.download = 'd4-builds.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    return a.download;
  },
  importBuildFile: async () => { const t = await pickFile('.json,.txt'); return t == null ? null : call('importBuildText', t); },
  loadBuildLink: (url) => call('loadBuildLink', url),
  buildTree: (cls) => call('buildTree', cls),
  buildParagon: (keys) => call('buildParagon', keys),
  openBuildSource: (url) => {
    const u = String(url || '');
    if (!/^https:\/\/(www\.)?(maxroll\.gg|d4builds\.gg|infinitybuilds\.gg|d2core\.com)\//i.test(u)) return false;
    window.open(u, '_blank', 'noopener');
    return true;
  },
  guideSheet: (q) => call('guideSheet', q),
  builderCatalog: () => call('builderCatalog'),
  builderFull: (cls, key) => call('builderFull', cls, key),
  builderPlan: (cls, key, opts) => call('builderPlan', cls, key, opts),
  builderProven: (cls, key) => call('builderProven', cls, key),
  builderSave: (cls, key, picks) => call('builderSave', cls, key, picks),
  builderPreview: (cls, key, picks) => call('builderPreview', cls, key, picks),
  copyText: copy,
};

/** The device code: shown to take the builds elsewhere, or another device's code taken over. */
window.d4web = {
  code: () => owner,
  useCode: (c) => {
    const v = String(c || '').trim().toLowerCase();
    if (!UUID_RE.test(v)) return false;
    owner = v;
    try { localStorage.setItem(KEY, owner); } catch (_) {}
    return true;
  },
};
})();
