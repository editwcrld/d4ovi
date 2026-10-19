'use strict';
// Build switches. The macros (lock, click spam) send input to the game, which Blizzard's terms do
// not allow – so they are left out unless asked for:
//   npm run dist        the .exe without them (the one to share)
//   npm run dist:m      the .exe with them (build it for yourself)
//   npm run start:m     run from source with them (electron . --m)
// tools/dist.js bakes the choice into the build (lib/build-flags.json); from source it is the
// --m on Electron's command line. (Not an npm flag: npm 11 keeps unknown flags to itself.)
// Left out means: no Macros tab in the settings, and the helper that sends input is never started.
let baked = null;
try { baked = require('./build-flags.json'); } catch (_) { /* running from source */ }
const asked = baked ? !!baked.macros : process.argv.includes('--m');

module.exports = {
  MACROS: asked ? 1 : 0,   // the whole "Macros" tab – 0 leaves out both below as well
  LOCK: 1,                 // lock: holds keys / mouse buttons down, or presses them on a timer
  CLICK_SPAM: 1,           // click spam: repeats clicks while a button is held
};
