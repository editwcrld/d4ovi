'use strict';
// The bar's timers and counter: world boss, Helltide, your own timer (or stopwatch), the counter and
// "to farm" – and the time fields (hh:mm:ss) the settings use for them and for lock.
// One of the overlay's page scripts: they share one scope with app.js (the state, $, el, api, save,
// render …) and are loaded before it (renderer/index.html) – app.js starts the page.

// ---------------------------------------------------------------- timers
// Three timers sit in the bar and the pill: the world boss (read from diablo.trade), the
// Helltide (from the clock) and one of your own (started by a click).
const pad2 = (v) => String(Math.floor(v)).padStart(2, '0');
const fmtMin = (s) => pad2(s / 60) + 'min ' + pad2(s % 60) + 'sec';
const fmtMs = (s) => pad2(s / 60) + ':' + pad2(s % 60);
/** Room for the long labels: the strip has it, the spine only for short ones. */
const timersWide = () => !$('app').classList.contains('open');

function renderTimers() {
  const wide = timersWide();
  renderWb(wide);
  renderHt(wide);
  renderCt(wide);
  renderRc(wide);
  renderMissing(wide);
}

// ---- world boss: turns red and grows in the warning time, blinks until clicked
/** The spawn the timer counts down to (identifies it for the click that stops the blinking). */
const spawnOf = () => (wb.secs == null ? 0 : Math.round((wb.at + wb.secs * 1000) / 60000));
function renderWb(wide) {
  const box = $('wb'), e = $('wbTime');
  box.hidden = settings && settings.wbTimer === false;
  box.querySelector('b').textContent = wide ? 'World boss' : 'Boss';
  if (wb.secs == null) { e.textContent = '--:--'; box.classList.remove('soon', 'blink'); return; }
  const left = Math.max(0, wb.secs - (Date.now() - wb.at) / 1000);
  e.textContent = fmtClock(Math.round(left));
  box.title = 'World boss' + (wb.text ? ' — ' + wb.text : '') + ' — in ' + fmtClock(Math.round(left));
  const warn = Number(settings && settings.wbWarnSec);
  const window_ = warn > 0 ? warn : 300;
  const soon = left < window_;
  box.classList.toggle('soon', soon);
  box.classList.toggle('blink', soon && !(settings && settings.wbBlink === false) && wbAck !== spawnOf());
  // the closer it gets, the bigger – less in the narrow spine
  const most = wide ? 0.4 : 0.15;
  const k = soon && window_ > 0 ? 1 + (1 - left / window_) * most : 1;
  box.style.setProperty('--wbk', k.toFixed(2));
}

// ---- Helltide: no data source needed – it starts on the full hour, runs 55 minutes, then
// 5 minutes pass until the next one. Taken in UTC, so a time zone with half hours is no problem.
// Orange while it runs, red for its last minutes.
const HT_ON = 55 * 60, HT_ENDING = 3 * 60;
function helltide(now = Date.now()) {
  const s = Math.floor(now / 1000) % 3600;           // seconds into the hour
  return s < HT_ON ? { on: true, left: HT_ON - s } : { on: false, left: 3600 - s };
}
function renderHt(wide) {
  const box = $('ht');
  box.hidden = settings && settings.helltide === false;
  if (box.hidden) return;
  const h = helltide();
  box.classList.toggle('on', h.on);
  box.classList.toggle('ending', h.on && h.left <= HT_ENDING);
  box.querySelector('b').textContent = wide ? (h.on ? 'Helltide' : 'Helltide in') : (h.on ? 'Helltide' : 'Next HT');
  $('htTime').textContent = fmtMs(h.left);
  box.title = h.on ? 'Helltide is on — ends in ' + fmtMin(h.left) : 'No Helltide — the next one starts in ' + fmtMin(h.left);
}

// ---- your own timer, three ways (settings.ctMode):
//   down / up – a click starts it (again), a right click clears it; red and blinking for the last
//               30 seconds, "ready" at the end. Down from its time, or up from 0:00 to it.
//   watch     – a stopwatch: a click starts it, the next stops it, the next puts it back to 0:00.
const CT_WARN = 30, CT_MAX = 99 * 3600 + 59 * 60 + 59;
let ctEnd = 0;                                       // when it runs out (0 = not counting)
let watchFrom = 0, watchAcc = 0;                     // stopwatch: running since (0 = stopped), ms counted before
const ctSecs = () => Math.max(1, Math.min(CT_MAX, Math.round(Number(settings && settings.ctSecs) || 300)));
const ctMode = () => (['up', 'watch'].includes(settings && settings.ctMode) ? settings.ctMode : 'down');
const ctUp = () => ctMode() === 'up';
const watchSecs = () => Math.min(CT_MAX, Math.floor((watchAcc + (watchFrom ? Date.now() - watchFrom : 0)) / 1000));
const ctName = () => String((settings && settings.ctName) || '').trim() || 'Timer';
/** 5:00, 45:10, 1:30:00 – hours only when there are any. */
const fmtClock = (s) => (s >= 3600 ? Math.floor(s / 3600) + ':' + pad2((s % 3600) / 60) : pad2(s / 60)) + ':' + pad2(s % 60);
/**
 * A time as typed -> seconds (with tenths); null when it is no time. Everywhere a time is typed in:
 *   10 · 5.2 · 5,2 · 5.2 sec   seconds
 *   1:12 · 1:30:00             m:ss · h:mm:ss (the seconds may have tenths)
 *   1h · 15m · 15m10s · 1h30m  hours, minutes, seconds
 */
function parseDuration(text) {
  const t = String(text || '').trim().toLowerCase().replace(/,/g, '.').replace(/\s+/g, '');
  if (/^\d+(:\d+)?:\d+(\.\d+)?$/.test(t)) {
    const parts = t.split(':').map(Number);
    if (parts.slice(1).some((v) => v >= 60)) return null;            // 1:75 is no time
    return parts.reduce((acc, v) => acc * 60 + v, 0);
  }
  const m = t.match(/^(?:(\d+(?:\.\d+)?)h(?:ours?|rs?)?)?(?:(\d+(?:\.\d+)?)m(?:in(?:utes?|s)?)?)?(?:(\d+(?:\.\d+)?)(?:s(?:ec(?:onds?|s)?)?)?)?$/);
  if (m && (m[1] || m[2] || m[3])) return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  return null;
}
/** The own timer's time: whole seconds, 1 s – 99:59:59. */
function parseClock(text) {
  const v = parseDuration(text);
  if (v == null) return null;
  const secs = Math.round(v);
  return secs >= 1 && secs <= CT_MAX ? secs : null;
}
/** Lock: tenths of a second up to a minute ("5.2s"), past it the clock ("1:12"). */
const fmtSec = (s) => (s < 60 ? String(Math.round(s * 10) / 10) + 's' : fmtClock(Math.round(s)));
/** A field that takes a time (parseDuration): put back, red for a moment, when it is none. */
function timeField(id, value, fmt, parse, onSet) {
  const f = el('input');
  f.type = 'text'; f.className = 'clock'; f.value = fmt(value); f.maxLength = 12; f.spellcheck = false;
  if (id) f.id = id;
  f.placeholder = '5.2 · 1:12 · 15m10s';
  f.onchange = () => {
    const v = parse(f.value);
    if (v == null) { f.value = fmt(value); f.classList.add('bad'); setTimeout(() => f.classList.remove('bad'), 900); return; }
    f.value = fmt(v);
    onSet(v);
  };
  f.onkeydown = (e) => { if (e.key === 'Enter') f.blur(); };
  return f;
}
function renderCt(wide) {
  const box = $('ct');
  box.hidden = settings && settings.ctTimer === false;
  if (box.hidden) return;
  box.querySelector('b').textContent = wide ? ctName() : ctName().slice(0, 8);
  if (ctMode() === 'watch') {
    const secs = watchSecs(), state = watchFrom ? 'run' : secs || watchAcc ? 'stopped' : 'idle';
    box.classList.remove('ready', 'soon', 'blink');
    box.classList.toggle('idle', state === 'idle');
    box.classList.toggle('run', state === 'run');
    $('ctTime').textContent = fmtClock(secs);
    box.title = ctName() + ' — ' + (state === 'run' ? 'running, ' + fmtClock(secs) : state === 'stopped' ? 'stopped at ' + fmtClock(secs) : 'stopwatch')
      + '\nClick: ' + (state === 'run' ? 'stop' : state === 'stopped' ? 'back to 0:00' : 'start') + ' · right click: back to 0:00';
    return;
  }
  const total = ctSecs(), up = ctUp();
  const left = ctEnd ? Math.ceil((ctEnd - Date.now()) / 1000) : null;
  const state = left == null ? 'idle' : left > 0 ? 'run' : 'ready';
  box.classList.toggle('idle', state === 'idle');
  box.classList.toggle('run', state === 'run');
  box.classList.toggle('ready', state === 'ready');
  box.classList.toggle('soon', state === 'run' && left <= CT_WARN);
  box.classList.toggle('blink', state === 'run' && left <= CT_WARN);
  const shown = state === 'run' ? (up ? total - left : left) : up ? 0 : total;
  $('ctTime').textContent = state === 'ready' ? 'ready' : fmtClock(shown);
  box.title = ctName() + ' — ' + (state === 'run' ? (up ? fmtClock(total - left) + ' of ' + fmtClock(total) + ', ' : '') + 'done in ' + fmtClock(left)
    : state === 'ready' ? 'done' : 'not running')
    + '\nClick: start ' + (up ? 'counting up to ' : '') + fmtClock(total) + ' (again) · right click: clear';
}
// ---- a counter (runs, kills, whatever you count): a click adds one, a right click starts it at 0
// again – kept in the settings, so a restart does not lose it
const rcName = () => String((settings && settings.rcName) || '').trim() || 'Runs';
const rcCount = () => Math.max(0, Math.floor(Number(settings && settings.rcCount) || 0));
function renderRc(wide) {
  const box = $('rc');
  box.hidden = settings && settings.rcCounter === false;
  if (box.hidden) return;
  const n = rcCount();
  box.classList.toggle('idle', n === 0);
  box.querySelector('b').textContent = wide ? rcName() : rcName().slice(0, 8);
  $('rcN').textContent = String(n);
  box.title = rcName() + ': ' + n + '\nClick: +1 · right click: back to 0';
}
function countRc(add) { save({ rcCount: add ? Math.min(99999, rcCount() + 1) : 0 }).then(() => renderRc(timersWide())); }
// ---- what the active build still needs: switched on in the settings; a click opens the build
async function updateMissing() {
  if (!settings || settings.pillMissing !== true || !window.FarmView) missing = null;
  else { try { missing = await window.FarmView.summary(api); } catch (_) { missing = null; } }
  renderMissing(timersWide());
}
function renderMissing(wide) {
  const box = $('miss');
  box.hidden = !(settings && settings.pillMissing === true) || !missing || !missing.total;
  if (box.hidden) return;
  const done = missing.missing === 0;
  box.classList.toggle('done', done);
  box.querySelector('b').textContent = wide ? 'To farm' : 'Farm';
  $('missN').textContent = done ? 'done' : wide ? missing.missing + ' of ' + missing.total : String(missing.missing);
  box.title = missing.name + ' — ' + (done ? 'everything farmed' : missing.missing + ' of ' + missing.total + ' still to farm')
    + '\nClick: open the build';
}

function startCt(on) { ctEnd = on ? Date.now() + ctSecs() * 1000 : 0; renderCt(timersWide()); }
/** A click on the own timer (or its hotkey): starts it over – the stopwatch goes start, stop, 0:00. */
function clickCt() {
  if (ctMode() !== 'watch') return startCt(true);
  if (watchFrom) { watchAcc += Date.now() - watchFrom; watchFrom = 0; }
  else if (watchAcc) watchAcc = 0;
  else watchFrom = Date.now();
  renderCt(timersWide());
}
/** A right click: cleared, the stopwatch back to 0:00. */
function clearCt() { watchFrom = 0; watchAcc = 0; startCt(false); }
