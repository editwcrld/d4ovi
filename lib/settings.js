'use strict';
// The overlay's settings: what they start as, and how a settings file from an older version is
// brought up to date. Pure – reading and writing the file stays in main.js.

const DEFAULTS = {
  d4Path: 'C:\\Program Files (x86)\\Diablo IV\\Diablo IV Launcher.exe',
  d4WindowTitle: 'Diablo IV',
  visibility: 'focused',                 // focused | running | always
  orientation: 'vertical',               // vertical | horizontal
  railWide: false,                       // show labels next to the rail icons
  windowSize: 'medium',                  // small | medium | large – share of the screen
  opacity: 1,
  panelSize: null,                       // { w, h } in CSS pixels once the user resized it
  textScale: 1,                          // 0.9 | 1 | 1.15 | 1.3 – on top of the screen based scaling
  tradeUrl: 'https://diablo.trade/listings/items',
  tradeOpenMode: 'internal',             // internal (app window, fills the field) | browser
  maxrollUrl: 'https://maxroll.gg/d4/resources/boss-loot-table-cheat-sheet',
  craftingUrl: 'https://maxroll.gg/d4/resources/crafting-cheat-sheet',
  pressEnter: false,
  fadeOpacity: 0.35,                     // what the bar fades to when nothing is open
  idleShrink: true,                      // idle it also shrinks to timers/search/trade/quit
  pillHide: ['maptool'],                 // what the pill leaves out: search farm maptool listings wb ht ct miss settings quit
  // timers
  wbTimer: true,                         // the world boss timer in the bar
  wbWarnMin: 5,                          // minutes left before the world boss timer warns
  wbBlink: true,                         // … and blinks while it warns
  helltide: true,                        // the Helltide timer next to the world boss
  ctTimer: true,                         // your own timer: a click starts the countdown
  ctSecs: 300,                           // … its time in seconds (up to 99:59:59)
  ctUp: false,                           // … counts up from 0:00 to it instead of down
  ctName: 'Timer',                       // … what it is called in the bar
  wbBright: true,                        // the timers ignore the pill fade
  pillMissing: false,                    // what the active build still needs, in the bar and the pill
  msgBlink: true,                        // a new trade message blinks on its icon
  clickGame: 'close',                    // a click into the game: close | keep (the open panel)
  buildsNoFade: true,                    // … and do not fade while you play
  coachSeen: false,                      // the one-time hint about closing and pinning
  actDone: {},                           // activity guide steps ticked off, by guide
  // macros – each one off until switched on (with a warning); left out of a build by lib/features.js
  clickSpam: false,                      // rapid clicking while a thumb button is held
  clickLeftBind: 'Mouse5',               // left click spam
  clickRightBind: 'Mouse4',              // right click spam
  clickCps: 15,                          // clicks per second
  lockOn: false,                         // lock: a toggle key holds the listed keys down or presses them on a timer
  lockKeys: [],                          // { key, lock, sec } – lock: held down, else pressed every sec; order = priority
  lockBind: 'F9',                        // switches it on and off
  macroChars: [],                        // per character: { name, lockKeys }
  macroChar: 0,                          // the character in use
  hotkeySearch: 'Control+F',
  hotkeyToggle: '',
  hotkeyMap: '',
  hotkeyFarm: 'Control+Shift+B',         // builds / farm list
  hotkeyTimer: '',                       // starts the own timer (over) – the game keeps the focus
  hotkeySkills: '',                      // the active build's skills
  hotkeyParagon: '',                     // the active build's paragon
  // (macroRev, hotkeyRev and updateRev are no defaults: a file without them is one from before that change)
  favorites: [],
  recent: [],
  updateCheck: false,                    // look for a newer release on GitHub (once a day) – off: the repo is private
  updateCheckedAt: 0,
  backupDir: '',                         // where backups go (empty: none made)
  backupAuto: false,                     // one a day, at the start
  chatSeenAt: 0,                         // when the chat was last open (drives the red badge)
  posIdle: null,                         // where the shrunk pill sits
  posOpen: null,                         // where the bar sits once it is awake
};

// Each step takes the settings as they were and returns true when it changed something.
const MIGRATIONS = [
  // rev 2: the builds hotkey got a default – an empty one from before is filled once, a chosen one stays
  (s) => {
    if ((s.hotkeyRev || 1) >= 2) return false;
    if (!s.hotkeyFarm) s.hotkeyFarm = DEFAULTS.hotkeyFarm;
    s.hotkeyRev = 2;
    return true;
  },
  // the bar's single place became two (pill and open bar)
  (s) => {
    if (!('position' in s)) return false;
    if (!s.posOpen && s.position) s.posOpen = s.position;
    delete s.position;
    return true;
  },
  // the two Fields of Hatred zone timers became one timer of your own
  (s) => {
    if (!('fohTimers' in s) && !('fohMin' in s)) return false;
    if (typeof s.fohTimers === 'boolean') s.ctTimer = s.fohTimers;
    if (Number(s.fohMin) > 0) s.ctSecs = Math.round(Number(s.fohMin) * 60);
    delete s.fohTimers; delete s.fohMin;
    return true;
  },
  // the own timer's minutes (a slider) became a time in seconds (hh:mm:ss)
  (s) => {
    if (!('ctMin' in s)) return false;
    if (Number(s.ctMin) > 0) s.ctSecs = Math.round(Number(s.ctMin) * 60);
    delete s.ctMin;
    return true;
  },
  // the update check starts switched off (the repository is private, it cannot find anything)
  (s) => {
    if (s.updateRev >= 1) return false;
    s.updateCheck = false;
    s.updateRev = 1;
    return true;
  },
  // "only timers" in the pill became a choice for each thing in it
  (s) => {
    if (!('pillTimersOnly' in s)) return false;
    if (s.pillTimersOnly === true) s.pillHide = ['search', 'farm', 'maptool', 'listings'];
    delete s.pillTimersOnly;
    return true;
  },
  // the notes page is gone – what was kept for it goes too
  (s) => {
    if (!('notes' in s)) return false;
    delete s.notes;
    return true;
  },
  // nothing reads it any more – the bar shrinks as soon as nothing is open
  (s) => {
    if (!('fadeAfterSec' in s)) return false;
    delete s.fadeAfterSec;
    return true;
  },
  // macro rev 1: the macros moved to their own tab and start switched off – each one is switched
  // on again by hand, past the warning
  (s) => {
    if ((s.macroRev || 0) >= 1) return false;
    s.clickSpam = false;
    s.keyLoop = false;
    s.holdOn = false;
    s.macroRev = 1;
    return true;
  },
  // macro rev 2: the key loop's fixed keys 1–4 became a list with seconds per key – the keys and
  // seconds set before carry over
  (s) => {
    if (s.macroRev >= 2) return false;
    const toList = (o) => {
      const keys = String(o.keyLoopKeys == null ? '' : o.keyLoopKeys).toUpperCase().split('').filter((k) => /^[1-4Q]$/.test(k));
      const secs = o.keyLoopSecs || {};
      const own = (k) => (Number(secs[k]) > 0 ? Number(secs[k]) : Number(s.keyLoopSec) || 1);
      return [...new Set(keys)].map((k) => ({ key: k, sec: own(k) }));
    };
    // only keys someone actually set – the old default (all four, one second) becomes the new one
    if (s.keyLoopKeys != null && Object.keys(s.keyLoopSecs || {}).length && toList(s).length) s.skillLoop = toList(s);
    if (Array.isArray(s.macroChars)) {
      s.macroChars = s.macroChars.filter((c) => c && typeof c === 'object').map((c) => ({
        name: String(c.name || 'Character'), skillLoop: toList(c), holdKeys: Array.isArray(c.holdKeys) ? c.holdKeys : [],
      }));
    }
    delete s.keyLoopKeys; delete s.keyLoopSecs; delete s.keyLoopSec;
    s.macroRev = 2;
    return true;
  },
  // macro rev 3: num-lock mode and loop skills became one, lock – each key is held or timed.
  // The timed keys come first (they always go first anyway), then the held ones.
  (s) => {
    if (s.macroRev >= 3) return false;
    const toLock = (o) => {
      const seen = new Set();
      return [].concat(
        (Array.isArray(o.skillLoop) ? o.skillLoop : []).map((e) => e && { key: e.key, lock: false, sec: Number(e.sec) > 0 ? Number(e.sec) : 1 }),
        (Array.isArray(o.holdKeys) ? o.holdKeys : []).map((k) => ({ key: k, lock: true, sec: 1 })),
      ).filter((e) => e && typeof e.key === 'string' && !seen.has(e.key) && seen.add(e.key));
    };
    s.lockKeys = toLock(s);
    s.lockOn = s.holdOn === true || s.keyLoop === true;
    s.lockBind = s.holdOn !== true && s.keyLoop === true
      ? s.keyLoopBind || DEFAULTS.lockBind : s.holdBind || DEFAULTS.lockBind;
    if (Array.isArray(s.macroChars)) {
      s.macroChars = s.macroChars.filter((c) => c && typeof c === 'object').map((c) => ({ name: String(c.name || 'Character'), lockKeys: toLock(c) }));
    }
    for (const k of ['keyLoop', 'skillLoop', 'keyLoopBind', 'holdOn', 'holdKeys', 'holdBind']) delete s[k];
    s.macroRev = 3;
    return true;
  },
];

/**
 * What was read from the settings file (anything, even nothing) -> the settings to run on.
 * `changed` says whether the file should be written back.
 */
function load(raw) {
  // a deep copy: the defaults' lists and objects must never be shared with the running settings
  const s = Object.assign(JSON.parse(JSON.stringify(DEFAULTS)), raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {});
  let changed = false;
  for (const step of MIGRATIONS) if (step(s)) changed = true;
  return { settings: s, changed };
}

module.exports = { DEFAULTS, load };
