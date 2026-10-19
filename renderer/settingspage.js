'use strict';
// The settings page: one long page of groups (behaviour, look, hotkeys, macros, trade, data) with
// their controls, lock's key rows and the macro characters.
// One of the overlay's page scripts: they share one scope with app.js (the state, $, el, api, save,
// render …) and are loaded before it (renderer/index.html) – app.js starts the page.

// ---------------------------------------------------------------- settings
// The areas as the page's tabs; in each, plates with rows of the same shape – name and a line of
// help on the left, one control on the right. Four kinds of control: switch, segments, slider, key field.
const SET_TABS = [
  ['behaviour', 'Behaviour'],
  ['appearance', 'Appearance'],
  ['hotkeys', 'Hotkeys'],
  // only when the build has them (lib/features.js)
  ['macros', 'Macros', () => features.macros],
  ['trade', 'diablo.trade'],
  ['data', 'Data'],
];
let setScroll = { tab: null, top: 0 };          // filled by render() before the page is cleared
const setTabs = () => SET_TABS.filter((t) => !t[2] || t[2]());
function renderSettings(main) {
  if (!setTabs().some((t) => t[0] === setTab)) setTab = 'behaviour';
  // switching an option redraws the page – it stays where it was scrolled to
  const top = setScroll.tab ? setScroll.top : 0;
  setScroll.tab = 'all';
  pageHead('Overlay · changes apply right away', 'Settings');
  main.classList.add('settings');
  const inner = el('div', 'setbody');
  const FN = { behaviour: setBehaviour, appearance: setAppearance, hotkeys: setHotkeys, macros: setMacros, trade: setTrade, data: setData };
  const groups = setTabs().map(([id, label]) => {
    const g = el('section', 'setgroup');
    g.dataset.group = id;
    g.appendChild(el('h2', 'sgh', label));
    FN[id](g);
    inner.appendChild(g);
    return [id, label, g];
  });
  inner.appendChild(el('div', 'msg', setMsgText));
  main.appendChild(inner);
  // the chips jump to a group; scrolling lights the one you are in
  const chips = el('nav', 'anchors');
  const mark = (id) => chips.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', c.dataset.group === id));
  groups.forEach(([id, label, g]) => {
    const c = el('button', 'chip', label);
    c.dataset.group = id;
    c.onclick = () => {
      setTab = id; mark(id);
      main.style.scrollBehavior = 'smooth';                 // a jump glides; a redraw keeps its place at once
      main.scrollTop = g.offsetTop - 8;
      setTimeout(() => { main.style.scrollBehavior = ''; }, 700);
    };
    chips.appendChild(c);
  });
  $('chips').appendChild(chips);
  main.onscroll = () => {
    const y = main.scrollTop + 24;
    const cur = groups.filter(([, , g]) => g.offsetTop <= y).pop() || groups[0];
    if (cur) { setTab = cur[0]; mark(cur[0]); }
  };
  mark(setTab);
  // the warning sits over the visible part of the page, wherever it is scrolled to
  document.querySelectorAll('#cols > .ishade').forEach((x) => x.remove());
  if (riskAsk) $('cols').appendChild(riskDialog());
  main.scrollTop = top;
}
function opt(parent, title, hint, ctl) {
  const o = el('div', 'opt');
  const t = el('div', 'txt');
  t.appendChild(el('b', null, title));
  if (hint) t.appendChild(el('span', null, hint));
  o.appendChild(t);
  const c = el('div', 'ctl');
  (Array.isArray(ctl) ? ctl : [ctl]).forEach((x) => c.appendChild(x));
  o.appendChild(c);
  parent.appendChild(o);
  return o;
}
function sw(on, onChange) {
  const s = el('button', 'sw' + (on ? ' on' : ''));
  s.setAttribute('role', 'switch');
  s.setAttribute('aria-checked', on ? 'true' : 'false');
  s.appendChild(el('i'));
  s.onclick = () => onChange(!on);
  return s;
}
function sel(options, value, onChange) {
  const s = el('select');
  options.forEach(([v, label]) => { const o = el('option', null, label); o.value = v; if (v === value) o.selected = true; s.appendChild(o); });
  s.onchange = () => onChange(s.value);
  return s;
}
function seg(options, value, onChange) {
  const g = el('div', 'seg');
  options.forEach(([v, label]) => {
    const b = el('button', v === value ? 'on' : null, label);
    b.onclick = () => onChange(v);
    g.appendChild(b);
  });
  return g;
}
/** A slider with its value next to it; onLive runs while dragging, onSet once let go. */
function slider(min, max, value, unit, onSet, onLive) {
  const r = el('input'); r.type = 'range'; r.className = 'range'; r.min = min; r.max = max; r.value = value;
  const v = el('span', 'val', value + unit);
  r.oninput = () => { v.textContent = r.value + unit; if (onLive) onLive(Number(r.value)); };
  r.onchange = () => onSet(Number(r.value));
  return [r, v];
}
const btn = (label, fn, cls) => UI.btn(label, fn, cls);

function setBehaviour(root) {
  let b;
  b = sect(root, 'Panel').body;
  opt(b, 'A click into the game', 'What happens to the open panel — Pin keeps it open either way',
    seg([['close', 'Closes it'], ['keep', 'Keeps it open']], settings.clickGame || 'close', (v) => save({ clickGame: v })));
  opt(b, 'No fade out on builds', 'Pinned builds stay fully visible while you play',
    sw(settings.buildsNoFade !== false, (v) => save({ buildsNoFade: v })));
  b = sect(root, 'Bar').body;
  opt(b, 'Show the overlay when', 'Otherwise it stays hidden',
    seg([['focused', 'D4 in front'], ['running', 'D4 running'], ['always', 'Always']], settings.visibility || 'focused', (v) => save({ visibility: v })));
  opt(b, 'What your build still needs', 'A small "to farm" count next to the timers — a click opens the build',
    sw(settings.pillMissing === true, (v) => save({ pillMissing: v }).then(() => { applyLayout(); updateMissing(); })));
  opt(b, 'Bar opacity', 'How far the closed bar fades — the mouse over it brings it back',
    slider(10, 100, Math.round((settings.fadeOpacity == null ? 0.35 : settings.fadeOpacity) * 100), ' %',
      (v) => save({ fadeOpacity: v / 100 }), (v) => document.documentElement.style.setProperty('--fade', v / 100)));
  b = sect(root, 'Timers').body;
  opt(b, 'World boss timer', 'In the bar, closed and open',
    sw(settings.wbTimer !== false, (v) => save({ wbTimer: v }).then(applyLayout)));
  const warn = timeField('wbWarnIn', Number(settings.wbWarnSec) > 0 ? Number(settings.wbWarnSec) : 300, fmtClock, parseClock, (v) => save({ wbWarnSec: v }).then(renderTimers));
  warn.title = 'e.g. 90 (seconds), 5:00, 15:15, 30m or 1h';
  opt(b, 'Warn before the spawn', 'The world boss timer turns red and grows from here on — 90, 5:00 (m:ss), 15m10s or 1h', warn);
  opt(b, 'Blink while it warns', 'A click on the timer stops it',
    sw(settings.wbBlink !== false, (v) => save({ wbBlink: v })));
  opt(b, 'Helltide timer', 'How long the Helltide still runs (red for its last 3 minutes), or when the next one starts',
    sw(settings.helltide !== false, (v) => save({ helltide: v }).then(applyLayout)));
  opt(b, 'Own timer', 'A timer or a stopwatch of your own in the bar — a right click clears it',
    sw(settings.ctTimer !== false, (v) => save({ ctTimer: v }).then(applyLayout)));
  const name = el('input');
  name.type = 'text'; name.id = 'ctName'; name.value = ctName(); name.maxLength = 16; name.spellcheck = false;
  name.onchange = () => save({ ctName: name.value.trim() }).then(renderTimers);
  const cn = opt(b, 'Its name', 'Shown above the time', name);
  const time = timeField('ctTimeIn', ctSecs(), fmtClock, parseClock, (v) => save({ ctSecs: v }).then(renderTimers));
  time.title = 'e.g. 90 (seconds), 5:00, 1:30:00, 15m, 15m10s or 1h';
  const cm = opt(b, 'Its time', 'Up to 99:59:59 — 90, 1:12 (m:ss), 1:30:00, 15m10s or 1h — what a click on it starts', time);
  const cu = opt(b, 'Counting', 'Down from its time or up to it (a click starts it over, red for the last 30 seconds) — or a stopwatch: click starts, click stops, click back to 0:00',
    seg([['down', 'Down'], ['up', 'Up'], ['watch', 'Stopwatch']], ctMode(), (v) => {
      watchFrom = 0; watchAcc = 0; ctEnd = 0;
      save({ ctMode: v }).then(() => { cm.classList.toggle('off', settings.ctTimer === false || v === 'watch'); renderTimers(); });
    }));
  [cn, cm, cu].forEach((o) => o.classList.toggle('off', settings.ctTimer === false));
  if (ctMode() === 'watch') cm.classList.add('off');
  opt(b, 'Counter', 'Counts your runs (or anything) in the bar — a click adds one, a right click starts it at 0',
    sw(settings.rcCounter !== false, (v) => save({ rcCounter: v }).then(() => { rn.classList.toggle('off', !v); applyLayout(); })));
  const rname = el('input');
  rname.type = 'text'; rname.id = 'rcName'; rname.value = rcName(); rname.maxLength = 16; rname.spellcheck = false;
  rname.onchange = () => save({ rcName: rname.value.trim() }).then(renderTimers);
  const rn = opt(b, 'Its name', 'Shown above the count', rname);
  rn.classList.toggle('off', settings.rcCounter === false);
  opt(b, 'Timers always bright', 'They ignore the closed bar\'s fade',
    sw(settings.wbBright !== false, (v) => save({ wbBright: v }).then(applyLayout)));
  b = sect(root, 'Messages').body;
  opt(b, 'Blink on a new message', 'Only the diablo.trade icon blinks, nothing else',
    sw(settings.msgBlink !== false, (v) => save({ msgBlink: v })));
}

function setAppearance(root) {
  let b;
  b = sect(root, 'Closed bar').body;
  const pick = el('div', 'seg multi chips');
  pick.id = 'pillPick';
  PILL_ITEMS.forEach(([k, label]) => {
    const t = el('button', pillHide().includes(k) ? null : 'on', label);
    t.dataset.pill = k;
    t.onclick = () => save({ pillHide: pillHide().includes(k) ? pillHide().filter((x) => x !== k) : pillHide().concat([k]) }).then(applyLayout);
    pick.appendChild(t);
  });
  opt(b, 'What it shows while closed', 'A click switches each one on or off — the drag handle always stays, a timer switched off in Behaviour stays off here too', pick);
  b = sect(root, 'Size').body;
  opt(b, 'Text size', 'On top of the automatic scaling by screen size',
    seg([[0.9, 'S'], [1, 'M'], [1.15, 'L'], [1.3, 'XL']], Number(settings.textScale) || 1, (v) => save({ textScale: Number(v) })));
  opt(b, 'Panel size', 'Medium fits the room left of the game\'s inventory (820 × 600 at 1080p) · Mobile is tall and narrow like a phone (393 × 850)',
    seg([['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['mobile', 'Mobile']], settings.windowSize || 'medium',
      (v) => { api.setPanelSize(null); return save({ windowSize: v, panelSize: null }).then(reportSize); }));
  const reset = btn('Reset', () => { api.setPanelSize(null); save({ panelSize: null }); setMsg('Panel size back to the one picked above.'); });
  reset.id = 'btnResetSize';
  reset.disabled = !settings.panelSize;
  opt(b, 'Your own size', settings.panelSize
    ? settings.panelSize.w + ' × ' + settings.panelSize.h + ' px — drag the bottom right corner to change it'
    : 'Drag the bottom right corner of the panel – every page fits down to a phone\'s width', reset);
  b = sect(root, 'Look').body;
  opt(b, 'Opacity', 'How much of the game shows through',
    slider(60, 100, Math.round((settings.opacity || 1) * 100), ' %', (v) => save({ opacity: v / 100 }), (v) => api.setOpacity(v / 100)));
  opt(b, 'Places', 'The closed bar and the open panel each remember where you dragged them',
    btn('Reset', () => save({ posIdle: null, posOpen: null }).then(() => setMsg('Places reset — drag the bar where you want it.'))));
}

function setHotkeys(root) {
  let b;
  b = sect(root, 'Hotkeys').body;
  b.appendChild(el('div', 'ghint', 'Click a field and press the combination. Esc cancels, Del clears.'));
  opt(b, 'Open / close search', 'The cursor lands in the search field', hkField('hotkeySearch'));
  opt(b, 'Open builds', 'Gear, skills and paragon', hkField('hotkeyFarm'));
  opt(b, 'Open the map', 'Map tool', hkField('hotkeyMap'));
  opt(b, 'Show / hide the overlay', 'Without quitting', hkField('hotkeyToggle'));
  opt(b, 'Build: skills', 'Opens the active build on its skills — again closes it', hkField('hotkeySkills'));
  opt(b, 'Build: paragon', 'Opens the active build on its paragon boards', hkField('hotkeyParagon'));
  opt(b, 'Counter: +1', 'Adds one to the counter — the game keeps the focus. A single F-key works here too', hkField('hotkeyCounter'));
  opt(b, 'Start the own timer', 'Like a click on it (the stopwatch: start, stop, 0:00) — the game keeps the focus. A single F-key works here too', hkField('hotkeyTimer'));
}

// ---- Macros: click spam and lock – both off until switched on past a warning.
// Lock's keys are kept per character, to switch quickly.
// What can be pressed or held – the same list as lib/clicker.js (KEY_CHOICES).
const KEY_CHOICES = [...'1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split(''), 'Space', 'Shift',
  'Mouse1', 'Mouse2', 'Mouse3', 'Mouse4', 'Mouse5'];
/** A key's short name on a tile ("M4"), and its long one in a tooltip. */
const keyName = (k) => (/^Mouse\d$/.test(k) ? 'M' + k.slice(5) : k);
const keyLabel = (k) => (/^Mouse\d$/.test(k) ? 'Mouse ' + k.slice(5) + ({ 1: ' (left)', 2: ' (right)', 3: ' (wheel)', 4: ' (thumb)', 5: ' (thumb)' }[k.slice(5)]) : k);
let riskAsk = null;                // the switch waiting for "use at your own risk": { key, label }

function setMacros(b) {
  const warn = el('div', 'mwarn');
  warn.appendChild(el('b', null, 'Use at your own risk'));
  warn.appendChild(el('span', null, 'These send mouse clicks and key presses to the game for you. Automated input can break the game\'s terms of use — your account is your responsibility.'));
  b.appendChild(warn);
  b.appendChild(el('div', 'ghint', 'All of them work only while Diablo IV is in front, and let go of everything when you leave it.'));

  const ch = sect(b, 'Character', 'Lock is kept per character — pick one and its keys load right away.', 'character');
  ch.card.hidden = !features.lock;          // nothing kept per character
  const chars = charList();
  const cur = charAt();
  const pick = sel(chars.map((c, i) => [String(i), c.name]), String(cur), (v) => switchChar(Number(v)));
  pick.id = 'macroChar';
  const name = el('input');
  name.type = 'text'; name.id = 'macroCharName'; name.value = chars[cur].name; name.maxLength = 30; name.spellcheck = false;
  name.title = 'Rename this character';
  name.onchange = () => { const n = name.value.trim(); if (n) saveChar({}, n); else name.value = chars[cur].name; };
  ch.tag.textContent = chars[cur].name;
  opt(ch.body, 'Character', 'The one in use', pick);
  opt(ch.body, 'Name', 'Rename the one picked', name);
  const del = btn('Delete', () => deleteChar());
  del.disabled = chars.length < 2;
  opt(ch.body, 'Characters', chars.length + ' saved', [btn('+ New', () => newChar()), del]);

  if (features.lock) {
    const lk = macroCard(b, 'lockOn', 'Lock', 'Press the toggle key in the game: every key is held down (lock) or pressed again after its time — until you press it again. A left click by hand or left click spam pauses it until you let go. The map (Tab) or the chat (Enter) pauses it until the same key or Esc closes it. The town portal (T) pauses it for 5 seconds, a left click goes on at once.', 'lockBind');
    riskSwitch(lk.body, 'lockOn', 'Lock', 'Off means the toggle key does nothing');
    opt(lk.body, 'Toggle key', 'Switches it on and off', bindField('lockBind'));
    const keys = lockList();
    opt(lk.body, 'Keys', 'Click + and press a key or mouse button — × takes one out',
      keyChips('lock', keys.map((e) => e.key),
        (k) => saveChar({ lockKeys: keys.concat([{ key: k, lock: true, sec: 1 }]) }),
        (k) => saveChar({ lockKeys: keys.filter((e) => e.key !== k) })));
    if (keys.length) lk.body.appendChild(lockRows(keys));
  }

  if (features.clickSpam) {
    const cs = macroCard(b, 'clickSpam', 'Click spam', 'Hold the button and the overlay keeps clicking.');
    riskSwitch(cs.body, 'clickSpam', 'Click spam', 'Off means nothing is watched at all');
    opt(cs.body, 'Right click spam', 'Hold this button to repeat right clicks', bindField('clickRightBind'));
    opt(cs.body, 'Left click spam', 'Hold this button to repeat left clicks', bindField('clickLeftBind'));
    opt(cs.body, 'Speed', 'Clicks per second',
      slider(1, 40, settings.clickCps == null ? 15 : settings.clickCps, ' /s', (v) => save({ clickCps: v })));
  }

  const st = el('div', 'msg');
  st.id = 'clickState';
  st.textContent = clickState;
  b.appendChild(st);
}

// Every settings section is a plate: icon, title, a line on what it is about – the macros add
// whether they are on and their toggle key.
const SECTIONS = {
  Panel: ['What the open panel does while you play', 'build'],
  Bar: ['The bar – closed a strip, open the panel\'s spine', 'list'],
  'Closed bar': ['Timers and lock – the mouse over it slides out the rest', 'list'],
  Timers: ['World boss, Helltide, your own timer and the counter', 'timer'],
  Messages: ['diablo.trade chat', 'trade'],
  Size: ['How big the text and the panel are', 'fit'],
  Look: ['How much of the game shows through, and where things sit', 'eye'],
  Hotkeys: ['Shortcuts that work while the game is in front', 'key'],
  Account: ['Your diablo.trade login', 'person'],
  'Item search': ['How a search opens on diablo.trade', 'search'],
  'If signing in does not work': ['Other ways to get your login in', 'warn'],
  'Game data': ['Loot, crafting, items — and your own saved data', 'folder'],
  Backup: ['A copy of what you made, in a folder of your choice', 'folder'],
  Updates: ['Whether a newer version is out', 'refresh'],
  Advanced: ['Where the game is and how it is found', 'gear'],
  Character: [null, 'person'],
  'Click spam': [null, 'target'],
  Lock: [null, 'lock'],
};
function sect(parent, title, hint, id) {
  const [line, icon] = SECTIONS[title] || [null, 'info'];
  const p = UI.plate({ title, sub: hint || line, icon, id: id || title });
  parent.appendChild(p.card);
  return { card: p.card, body: p.body, tag: p.badge, side: p.side };
}
/** A macro's plate: its state (ON / OFF) and its toggle key in the head. */
function macroCard(parent, key, title, hint, bindKey) {
  const c = sect(parent, title, hint, key);
  const on = settings[key] === true;
  c.card.classList.add('macro');
  c.card.classList.toggle('on', on);
  c.tag.textContent = on ? 'ON' : 'OFF';
  if (bindKey && settings[bindKey]) c.side.insertBefore(el('kbd', null, prettyBind(settings[bindKey])), c.tag);
  return c;
}

/**
 * The keys of a list as tiles – [1][Q][+]. A click on + waits for a key or a mouse button (any of
 * the five, the left one included), × on a tile takes it out again. A key is in a list only once.
 */
function keyChips(kind, keys, onAdd, onRemove) {
  const g = el('div', 'seg multi chips');
  g.dataset.picks = kind;
  keys.forEach((k) => {
    const t = el('button', 'on', keyName(k));
    t.dataset.key = k;
    t.title = keyLabel(k);
    const x = el('span', 'x', '×');
    x.title = 'Take ' + keyName(k) + ' out';
    x.onclick = (e) => { e.stopPropagation(); onRemove(k); };
    t.appendChild(x);
    g.appendChild(t);
  });
  const add = el('button', 'add', '+');
  add.dataset.keys = '';                             // records a key: it needs the keyboard
  add.title = 'Add a key';
  let rec = false, took = false;
  const stopRec = () => { rec = false; add.classList.remove('rec'); add.textContent = '+'; };
  const take = (k) => {
    if (!k) return;
    stopRec();
    if (keys.includes(k)) { add.textContent = keyName(k) + ' is in'; setTimeout(() => { if (!rec) add.textContent = '+'; }, 1200); return; }
    onAdd(k);
  };
  add.onclick = (e) => {
    e.preventDefault();
    if (took) { took = false; return; }              // the click that follows a mouse button taken
    if (rec) return;                                 // the click that starts listening is no key
    rec = true; add.classList.add('rec'); add.textContent = 'press a key …';
    typeIn(add);
  };
  // while listening, a mouse button on the tile is taken as that button
  add.onmousedown = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    took = e.button === 0;                           // only the left button clicks afterwards
    take({ 0: 'Mouse1', 2: 'Mouse2', 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button]);
  };
  // the click of a left button taken comes right after its mouseup – only that one is swallowed
  add.onmouseup = () => { if (took) setTimeout(() => { took = false; }, 0); };
  add.oncontextmenu = (e) => { if (rec) e.preventDefault(); };
  add.onkeydown = (e) => {
    if (!rec) return;
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopRec(); return; }
    const c = e.code;
    const k = /^Digit\d$/.test(c) ? c.slice(5) : /^Key[A-Z]$/.test(c) ? c.slice(3)
      : c === 'Space' ? 'Space' : /^Shift/.test(c) ? 'Shift' : null;
    if (k && KEY_CHOICES.includes(k)) take(k);
    else add.textContent = 'not that one …';
  };
  add.onblur = stopRec;
  g.appendChild(add);
  return g;
}

/**
 * Lock's keys, one row each: grip · on/off · key · lock switch · seconds. Lock on (the default)
 * holds the key down and greys the seconds; lock off presses it again after them. A key switched
 * off stays in the list with its settings but is left out until switched on again. The order is
 * the priority of the timed keys – they always go before the held ones; drag a row by its grip.
 */
function lockRows(keys) {
  const box = el('div', 'lockrows');
  const set = (i, patch) => saveChar({ lockKeys: keys.map((x, j) => {
    if (j !== i) return x;
    const y = Object.assign({}, x, patch);
    if (!y.off) delete y.off;                     // only a switched off key carries it
    return y;
  }) });
  let from = -1;
  let prio = 0;
  keys.forEach((e, i) => {
    const row = el('div', 'lockrow' + (e.lock ? ' held' : '') + (e.off ? ' off' : ''));
    row.dataset.key = e.key;
    const grip = el('span', 'grip');
    grip.title = 'Drag to change the order — timed keys go first, top to bottom';
    grip.innerHTML = '<svg viewBox="0 0 24 24"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01"/></svg>';
    // only the grip drags – the slider in the row has to stay draggable on its own
    grip.onmousedown = () => { row.draggable = true; };
    grip.onmouseup = () => { row.draggable = false; };
    row.ondragstart = (ev) => { from = i; row.classList.add('drag'); try { ev.dataTransfer.effectAllowed = 'move'; ev.dataTransfer.setData('text/plain', e.key); } catch (_) {} };
    row.ondragend = () => { row.draggable = false; row.classList.remove('drag'); box.querySelectorAll('.over').forEach((x) => x.classList.remove('over')); };
    row.ondragover = (ev) => { if (from < 0) return; ev.preventDefault(); row.classList.add('over'); };
    row.ondragleave = () => row.classList.remove('over');
    row.ondrop = (ev) => {
      ev.preventDefault();
      const a = from; from = -1;
      if (a < 0 || a === i) return;
      const list = keys.slice();
      list.splice(i, 0, list.splice(a, 1)[0]);
      saveChar({ lockKeys: list });
    };
    row.appendChild(grip);
    const pw = el('button', 'kon' + (e.off ? '' : ' on'));
    pw.title = e.off ? 'Switched off — click to use it again' : 'Switch off for now — it stays in the list';
    pw.setAttribute('aria-pressed', e.off ? 'false' : 'true');
    pw.innerHTML = '<svg viewBox="0 0 24 24"><path d="M12 3v8M6.3 7.2a7 7 0 1 0 11.4 0"/></svg>';
    pw.appendChild(el('span', null, e.off ? 'OFF' : 'ON'));
    pw.onclick = () => set(i, { off: !e.off });
    row.appendChild(pw);
    const name = el('b', 'kname', keyName(e.key));
    name.title = keyLabel(e.key);
    row.appendChild(name);
    const what = el('span', 'kwhat', e.off ? 'off' : e.lock ? 'held' : 'timed · ' + (++prio) + '.');
    row.appendChild(what);
    const lab = el('label', 'klock');
    lab.appendChild(el('span', null, 'Lock'));
    const s = sw(e.lock, (v) => set(i, { lock: v }));
    s.title = e.lock ? 'Held down — off to press it on a timer' : 'On a timer — on to hold it down';
    lab.appendChild(s);
    row.appendChild(lab);
    // pressed again every … – 5.2, 5,2, 10, 1:12 (m:ss), 15m10s; a tenth of a second up to an hour
    const r = timeField(null, Number(e.sec) || 1, fmtSec, (t) => { const v = parseDuration(t); return v != null && v >= 0.1 && v <= 3600 ? Math.round(v * 10) / 10 : null; },
      (v) => set(i, { sec: v }));
    r.classList.add('ksec');
    r.disabled = e.lock;
    r.title = e.lock ? 'Switch lock off to press it on a timer' : 'Pressed again every … — 5.2, 10, 1:12 (m:ss) or 15m10s';
    row.appendChild(r);
    box.appendChild(row);
  });
  if (keys.some((e) => !e.off && !e.lock) && keys.some((e) => !e.off && e.lock)) {
    box.appendChild(el('div', 'ghint', 'Timed keys always go out on time, top to bottom — the held ones stay down meanwhile.'));
  }
  return box;
}

/** A macro's on switch – switching it on first asks "use at your own risk". */
function riskSwitch(b, key, label, hint) {
  const on = settings[key] === true;
  const row = opt(b, 'On', hint, sw(on, (v) => {
    if (!v) { save({ [key]: false }); return; }
    riskAsk = { key, label };
    render();
  }));
  row.dataset.macro = key;
  return row;
}
function riskDialog() {
  const shade = el('div', 'ishade risk');
  const cancel = () => { riskAsk = null; render(); };
  shade.onclick = (e) => { if (e.target === shade) cancel(); };
  const m = el('div', 'imodal');
  const head = el('div', 'ihead');
  head.appendChild(el('h3', null, 'Use at your own risk'));
  m.appendChild(head);
  const body = el('div', 'ibody');
  body.appendChild(el('p', null, riskAsk.label + ' sends input to Diablo IV for you. Blizzard does not allow automated input — using it can get your account flagged or banned.'));
  body.appendChild(el('p', null, 'Only switch it on if you accept that risk.'));
  m.appendChild(body);
  const foot = el('div', 'ifoot');
  foot.appendChild(el('span', 'sp'));
  const no = btn('Cancel', cancel);
  const yes = btn('I understand, switch on', () => { const k = riskAsk.key; riskAsk = null; save({ [k]: true }); }, 'pri');
  yes.id = 'riskYes';
  foot.appendChild(no); foot.appendChild(yes);
  m.appendChild(foot);
  shade.appendChild(m);
  shade.tabIndex = -1;
  shade.onkeydown = (e) => { if (e.key === 'Escape') cancel(); };
  setTimeout(() => no.focus(), 0);
  return shade;
}

// The list in use – only known keys, each key once, lock on unless switched off; empty until keys are added.
function lockList() {
  const seen = new Set();
  return (Array.isArray(settings.lockKeys) ? settings.lockKeys : []).filter((e) => {
    if (!e || !KEY_CHOICES.includes(e.key) || seen.has(e.key)) return false;
    seen.add(e.key);
    return true;
  }).map((e) => Object.assign({ key: e.key, lock: e.lock !== false, sec: Number(e.sec) > 0 ? Number(e.sec) : 1 }, e.off === true ? { off: true } : {}));
}
/** Lock's keys switched on, as they are pressed ("1234") – red while it runs, gold while it waits; nothing moves. */
function lockKeys(paused) {
  const keys = lockList().filter((e) => !e.off);
  const box = el('span', 'lkeys', keys.map((e) => keyName(e.key)).join('') || '–');
  box.title = keys.map((e) => keyLabel(e.key) + (e.lock ? ' — held' : ' — every ' + fmtSec(e.sec))).join('\n') + (paused ? '\n(waiting)' : '');
  return box;
}

// Characters: [{ name, lockKeys }]; the one in use is also what the settings hold, so
// the helper needs to know nothing about characters.
const curKeys = () => ({ lockKeys: lockList() });
function charList() {
  const list = Array.isArray(settings.macroChars) ? settings.macroChars.filter((c) => c && typeof c === 'object') : [];
  return list.length ? list.map((c) => Object.assign({}, c)) : [Object.assign({ name: 'Character 1' }, curKeys())];
}
const charAt = () => Math.max(0, Math.min(charList().length - 1, Number(settings.macroChar) || 0));
/** A change to the lists (or the name) – into the settings and into the character in use. */
function saveChar(patch, rename) {
  const chars = charList();
  const i = charAt();
  chars[i] = Object.assign({}, chars[i], curKeys(), patch, rename ? { name: rename } : {});
  return save(Object.assign({}, patch, { macroChars: chars, macroChar: i }));
}
/** The character's lists into the settings – what the helper runs on. */
const loadChar = (c) => ({
  lockKeys: Array.isArray(c.lockKeys) ? c.lockKeys.map((e) => Object.assign({}, e)) : [],
});
function switchChar(i) {
  const chars = charList();
  const at = charAt();
  chars[at] = Object.assign({}, chars[at], curKeys());          // what was set stays with the old one
  const c = chars[i] || chars[0];
  return save(Object.assign({ macroChars: chars, macroChar: chars.indexOf(c) }, loadChar(c)));
}
function newChar() {
  const chars = charList();
  chars[charAt()] = Object.assign({}, chars[charAt()], curKeys());
  let n = chars.length + 1;
  while (chars.some((c) => c.name === 'Character ' + n)) n++;
  chars.push(Object.assign({ name: 'Character ' + n }, curKeys()));          // starts as a copy
  return save({ macroChars: chars, macroChar: chars.length - 1 });
}
function deleteChar() {
  const chars = charList();
  if (chars.length < 2) return null;
  chars.splice(charAt(), 1);
  return save(Object.assign({ macroChars: chars, macroChar: 0 }, loadChar(chars[0])));
}

// Takes a mouse button (the two thumb buttons, the wheel button) or a single key.
let clickState = '';
const prettyBind = (b) => (/^Mouse[0-9]$/.test(String(b || '')) ? 'Mouse ' + String(b).slice(5) : (b || 'not set'));
function bindField(key) {
  const f = el('div', 'hk', prettyBind(settings[key]));
  f.tabIndex = 0;
  f.title = 'Click here, then press the button or key you want';
  f.onfocus = () => { f.dataset.val = f.textContent; f.textContent = 'press a button …'; f.classList.add('rec'); };
  f.onblur = () => { f.classList.remove('rec'); if (f.textContent === 'press a button …') f.textContent = f.dataset.val || 'not set'; };
  // mouse buttons: 1 = wheel, 3 = thumb back (Mouse4), 4 = thumb forward (Mouse5).
  // Left and right stay free, otherwise the field could not be clicked at all.
  f.onmousedown = (e) => {
    const name = { 1: 'Mouse3', 3: 'Mouse4', 4: 'Mouse5' }[e.button];
    if (!name) return;
    e.preventDefault(); e.stopPropagation();
    f.textContent = 'Mouse ' + name.slice(5);
    save({ [key]: name });
    f.blur();
  };
  f.onkeydown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { f.textContent = f.dataset.val || 'not set'; f.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { f.textContent = 'not set'; save({ [key]: '' }); f.blur(); return; }
    const k = bindName(e);
    if (k) { f.textContent = k; save({ [key]: k }); f.blur(); }
  };
  return f;
}
// One key, without modifiers – the helper polls a single key, not a combination.
function bindName(e) {
  return codeKey(e.code, { Tab: 'Tab', CapsLock: 'CapsLock', Delete: 'Delete' });
}
/** A key code -> the name the helper and Electron use (letters, digits, F-keys, the common rest). */
function codeKey(c, more) {
  if (/^Key[A-Z]$/.test(c)) return c.slice(3);
  if (/^Digit\d$/.test(c)) return c.slice(5);
  if (/^F\d{1,2}$/.test(c)) return c;
  return Object.assign({ Space: 'Space', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' }, more)[c] || null;
}
function hkField(key) {
  const f = el('div', 'hk', settings[key] || 'not set');
  f.tabIndex = 0;
  f.dataset.key = key;
  f.onfocus = () => { f.dataset.val = f.textContent; f.textContent = 'press keys …'; f.classList.add('rec'); api.hotkeyCapture(true); };
  f.onblur = () => { f.classList.remove('rec'); if (f.textContent === 'press keys …') f.textContent = f.dataset.val || 'not set'; api.hotkeyCapture(false); };
  f.onkeydown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { f.textContent = f.dataset.val || 'not set'; f.blur(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { f.textContent = 'not set'; save({ [key]: '' }); f.blur(); return; }
    const a = accel(e);
    // a combination – or an F-key alone, which games leave free
    if (a && (a.indexOf('+') > 0 || /^F\d{1,2}$/.test(a))) { f.textContent = a; save({ [key]: a }); f.blur(); }
  };
  return f;
}
const accel = (e) => {
  const key = codeKey(e.code, { Enter: 'Return', Backquote: '`', Minus: '-', Equal: '=', Comma: ',', Period: '.', Slash: '/' });
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
};

function setTrade(root) {
  let b;
  b = sect(root, 'Account').body;
  const line = opt(b, 'diablo.trade', 'Checking …', [
    btn('Sign in', () => openSection('page', 'https://diablo.trade/signin')),
    btn('Sign out', async () => { await api.authLogout(); setMsg('Signed out.'); }),
  ]);
  const st = line.querySelector('.txt span');
  st.id = 'authLine';
  api.authStatus().then((s) => {
    st.textContent = s.loggedIn ? 'Signed in — the session is kept' : s.cookies ? 'Cookies found, but no session' : 'Not signed in — chat and listings need it';
    st.classList.toggle('good', !!s.loggedIn);
  });
  b = sect(root, 'Item search').body;
  opt(b, 'Open the search in', 'In the overlay it fills the field; in the browser the name is on the clipboard',
    seg([['internal', 'Overlay'], ['browser', 'Browser']], settings.tradeOpenMode || 'internal', (v) => save({ tradeOpenMode: v })));
  opt(b, 'Press Enter after filling in', 'Overlay only — searches right away',
    sw(!!settings.pressEnter, (v) => save({ pressEnter: v })));
  b = sect(root, 'If signing in does not work').body;
  const ta = el('textarea'); ta.rows = 3; ta.placeholder = 'name=value; name2=value2  (or rows from the browser dev tools)';
  ta.hidden = !cookieBox;
  const apply = btn('Apply', async () => { const r = await api.authImport(ta.value); ta.value = ''; cookieBox = false; setMsg(r.imported ? r.imported + ' cookie(s) applied.' : 'No valid cookies found.'); }, 'pri');
  apply.hidden = !cookieBox;
  const paste = btn(cookieBox ? 'Cancel' : 'Paste …', () => { cookieBox = !cookieBox; render(); });
  opt(b, 'Paste cookies', 'From your browser, if the sign-in window does not work', [paste]);
  if (cookieBox) { const box = el('div', 'cookiebox'); box.appendChild(ta); box.appendChild(apply); b.appendChild(box); }
  opt(b, 'Browser userscript', 'Fills the search field in your own browser too (Tampermonkey)',
    btn('Copy', async () => { await api.copyUserscript(); setMsg('Userscript copied — paste it into Tampermonkey.'); }));
}

function setData(root) {
  let b;
  b = sect(root, 'Game data').body;
  opt(b, 'Boss loot, crafting, item database, activities',
    dataInfo || ((loot.sections || []).length + ' loot sections · ' + (craft.tables || []).length + ' crafting tables · ' + activities.length + ' activities'),
    btn('Reload now', () => { api.refreshData(); setMsg('Reloading …'); }, 'pri'));
  opt(b, 'Data folder', 'Settings, caches, login, builds and map progress — copy it to take everything along',
    btn('Open', () => api.openDataDir()));
  opt(b, 'Map progress', 'Your marks in the map tool, saved to map-progress.json',
    btn('Restore', async () => { const n = await api.mapRestore(); setMsg(n ? n + ' entries restored into the map.' : 'Nothing to restore.'); }));
  b = sect(root, 'Backup').body;
  const dir = settings.backupDir || '';
  opt(b, 'Folder', dir || 'None chosen — a OneDrive or Dropbox folder keeps a copy off this PC',
    [btn(dir ? 'Change …' : 'Choose …', async () => { const d = await api.pickBackupDir(); if (d) { await save({ backupDir: d }); refreshBackupAt(); } })]
      .concat(dir ? [btn('Open', () => api.openBackupDir())] : []));
  const now = btn('Back up now', () => api.runBackup(), 'pri');                     // backup-done redraws it
  now.disabled = !dir;
  opt(b, 'Settings, builds and map progress',
    !dir ? 'Choose a folder first' : backupAt ? 'Last backup ' + new Date(backupAt).toLocaleString() + ' · the newest 10 are kept' : 'No backup yet · the newest 10 are kept', now);
  const auto = opt(b, 'Every day', 'One backup a day, when the overlay starts',
    sw(settings.backupAuto === true, (v) => save({ backupAuto: v })));
  auto.classList.toggle('off', !dir);
  b = sect(root, 'Updates').body;
  const u = updateInfo;
  const state = !u ? 'Not checked yet' : u.error ? 'Check failed — ' + u.error : u.newer ? 'Version ' + u.latest + ' is out' : 'Up to date';
  const ub = [btn('Check now', async () => { setMsg('Checking …'); onUpdate(await api.checkUpdates()); setMsg(''); })];
  if (u && u.newer) ub.push(btn('Download ' + u.latest, () => api.openUpdate(), 'pri'));
  opt(b, 'D4 Overlay ' + (appVersion || ''), state, ub);
  opt(b, 'Look for updates', 'Once a day on GitHub — nothing is downloaded or installed by itself',
    sw(settings.updateCheck !== false, (v) => save({ updateCheck: v })));
  b = sect(root, 'Advanced').body;
  const path = el('input'); path.type = 'text'; path.value = settings.d4Path || ''; path.className = 'wide';
  path.onchange = () => save({ d4Path: path.value });
  opt(b, 'Diablo IV path', 'For the launch button and to find the game', [path,
    btn('Browse …', async () => { const p = await api.pickExe(); if (p) { path.value = p; save({ d4Path: p }); } })]);
  const title = el('input'); title.type = 'text'; title.value = settings.d4WindowTitle || '';
  title.onchange = () => save({ d4WindowTitle: title.value });
  opt(b, 'Window title', 'How the game window is recognised', title);
}
/** A line on what just happened – under the settings, and in the line at the foot (the page is long). */
function setMsg(t) { setMsgText = t; if (t) footNote(t, 'ok'); render(); }
function refreshBackupAt() {
  api.lastBackup().then((t) => { backupAt = Number(t) || 0; if (section === 'settings') render(); });
}
/** A newer version: a dot on the settings icon until it is installed. */
function onUpdate(r) {
  updateInfo = r || null;
  $('updDot').hidden = !(updateInfo && updateInfo.newer);
  if (section === 'settings') render();
}
