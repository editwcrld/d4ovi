'use strict';
// Build switches – set before `npm run dist`, they are baked into the .exe.
// 1 = in the build, 0 = left out completely: not in the settings, and never started.
// (disable_macros.txt in the project folder says the same, for finding it quickly.)
module.exports = {
  MACROS: 1,        // the whole "Macros" tab – 0 leaves out both below as well

  LOCK: 1,          // lock: holds keys / mouse buttons down, or presses them on a timer
  CLICK_SPAM: 1,    // click spam: repeats clicks while a button is held
};
