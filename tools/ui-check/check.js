// The layout check, run in the page: the things that show text or are clicked ("atoms") must not
// spill out of their own box, leave the window or lie on top of each other. Returns the findings.
//   scope: the root's selector ('#app' for the overlay, '#app.web' for the website)
module.exports = (scope) => String.raw`(() => {
  const bad = [];
  const W = innerWidth, H = innerHeight;
  // floating on purpose: tooltips, menus, pickers, the corner grip, badges, dialogs
  const IGNORE = '#tip, .tool, .fpick, .bmenu, .ishade, #grip-resize, #chatBadge, #updDot, .dia, .vload, #coach';
  // what of an element is visible: its box cut by every scrolling or clipping parent
  const clipOf = (e) => {
    const r = e.getBoundingClientRect();
    let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const q = p.getBoundingClientRect();
        x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom);
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };
  const shown = (e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === 'hidden' || cs.display === 'none') return false;
    for (let p = e; p; p = p.parentElement) if (getComputedStyle(p).opacity === '0') return false;
    return true;
  };
  const name = (e) => {
    const host = e.closest('[class]');
    return (host && typeof host.className === 'string' ? host.className.split(' ')[0] + '>' : '') + e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')
      + (typeof e.className === 'string' && e.className ? '.' + e.className.trim().split(/\s+/).join('.') : '')
      + ' "' + (e.textContent || e.value || e.placeholder || '').trim().slice(0, 30) + '"';
  };
  const S = '${scope}';
  const atoms = [...document.querySelectorAll(['button', 'input', 'select', 'textarea', 'h1', 'h2', 'h3', '.ln', '.lm', '.tag', '.kbd', '.badge', 'b', 'small', 'span', 'p', 'li', 'label', 'a', '.cell', '.tmr'].map((t) => S + ' ' + t).join(','))]
    .filter((e) => !e.closest(IGNORE))
    .filter((e) => (shown(e) && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) || /^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(e.tagName))
    .filter(shown);
  // 1. text that spills out of its own box (no ellipsis, no wrapping)
  for (const e of atoms) {
    const cs = getComputedStyle(e);
    if (cs.overflowX === 'visible' && e.scrollWidth > e.clientWidth + 2 && e.clientWidth > 0 && cs.display !== 'inline') bad.push('spills: ' + name(e) + ' ' + e.scrollWidth + '>' + e.clientWidth);
  }
  // 2. out of the window (not just scrolled away inside a scroll box)
  for (const e of atoms) {
    const c = clipOf(e);
    if (c.w <= 0 || c.h <= 0) continue;
    if (c.x1 > W + 1 || c.y1 > H + 1 || c.x0 < -1) bad.push('outside: ' + name(e));
  }
  // 3. two atoms on top of each other
  const rects = atoms.map((e) => [e, clipOf(e)]).filter(([, c]) => c.w > 1 && c.h > 1);
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) {
    const [a, ra] = rects[i], [b, rb] = rects[j];
    if (a.contains(b) || b.contains(a)) continue;
    const ox = Math.min(ra.x1, rb.x1) - Math.max(ra.x0, rb.x0), oy = Math.min(ra.y1, rb.y1) - Math.max(ra.y0, rb.y0);
    if (ox > 3 && oy > 3) bad.push('overlap: ' + name(a) + '  ×  ' + name(b) + ' (' + Math.round(ox) + '×' + Math.round(oy) + ')');
  }
  return [...new Set(bad)].slice(0, 40);
})()`;
