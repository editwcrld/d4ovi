'use strict';
// How a name is compared everywhere: lower case, no accents or apostrophes, anything else between
// words one space ("Ahavarion, Spear of Lycander" -> "ahavarion spear of lycander"). Every cache,
// the icon map and the search key their names so. renderer/ui.js has the same function for the
// page (it cannot require this) – test/icons-test.js keeps the two alike.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[’']/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

module.exports = { norm };
