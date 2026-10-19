// parseCookies, tested without Electron
const Module = require('module'); const orig = Module._load;
Module._load = function (r, ...a) { if (r === 'electron') return { session: {} }; return orig.call(this, r, ...a); };
const { parseCookies } = require('../lib/auth');
console.log(JSON.stringify(parseCookies('a=1; __Secure-authjs.session-token=abc.def; cf_clearance=xyz')));
console.log(JSON.stringify(parseCookies('__Secure-authjs.session-token\teyJhbGci\tdiablo.trade\t/\t2026-11-01\t312\t✓\t✓\tLax')));
console.log(JSON.stringify(parseCookies('[{"name":"sid","value":"q"}]')));
