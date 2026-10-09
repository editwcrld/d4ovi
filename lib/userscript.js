'use strict';
// Optionales Userscript (Tampermonkey/Violentmonkey): füllt im NORMALEN Browser das "Quick Search"-Feld von diablo.trade aus,
// wenn die App die Seite mit "#d4q=<Itemname>" öffnet. Ohne Userscript liegt der Name in der Zwischenablage (Strg+V).
module.exports = `// ==UserScript==
// @name         D4 Overlay - diablo.trade Quick Search
// @namespace    d4-overlay
// @version      1.0
// @description  Befuellt das Quick-Search-Feld, wenn die Seite mit #d4q=<Name> geoeffnet wird
// @match        https://diablo.trade/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  var m = location.hash.match(/[#&]d4q=([^&]*)/);
  if (!m) return;
  var q = decodeURIComponent(m[1]);
  var tries = 0, stable = 0;
  // React verwirft einen zu frueh gesetzten Wert beim Hydrieren -> setzen, pruefen, wiederholen
  var timer = setInterval(function () {
    var el = document.querySelector('input[placeholder="Quick Search"]');
    if (el) {
      if (el.value === q) {
        if (++stable >= 2) {
          clearInterval(timer);
          history.replaceState(null, '', location.pathname + location.search);
        }
        return;
      }
      stable = 0;
      el.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, q);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (++tries > 100) clearInterval(timer);
  }, 300);
})();
`;
