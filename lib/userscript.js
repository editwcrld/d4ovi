'use strict';
// An optional userscript (Tampermonkey / Violentmonkey): fills diablo.trade's "Quick Search" field in the NORMAL browser
// when the app opens the page with "#d4q=<item name>". Without it the name is on the clipboard (Ctrl+V).
module.exports = `// ==UserScript==
// @name         D4 Overlay - diablo.trade Quick Search
// @namespace    d4-overlay
// @version      1.0
// @description  Fills the Quick Search field when the page is opened with #d4q=<name>
// @match        https://diablo.trade/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==
(function () {
  var m = location.hash.match(/[#&]d4q=([^&]*)/);
  if (!m) return;
  var q = decodeURIComponent(m[1]);
  var tries = 0, stable = 0;
  // React throws away a value set too early while it hydrates -> set, check, repeat
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
