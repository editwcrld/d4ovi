'use strict';
// Build switches – set before `npm run dist`, they are baked into the .exe.
// 1 = in the build, 0 = left out completely: not in the settings, and never started.
// (disable_macros.txt in the project folder says the same, for finding it quickly.)
module.exports = {
  MACROS: 1,        // the whole "Macros" tab – 0 leaves out all three below as well

  NUMLOCK: 1,       // num-lock mode: holds keys / mouse buttons down
  CLICK_SPAM: 1,    // click spam: repeats clicks while a button is held
  LOOP_SKILLS: 1,   // loop skills: presses keys again and again
};
