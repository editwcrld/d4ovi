// renderer/style.css is built from styles/ (tools/build-css.js) – it must be what the parts make,
// so a change made in style.css by hand (lost with the next build) shows up here.
const assert = require('assert');
const fs = require('fs');
const { build, OUT } = require('../tools/build-css');

assert.strictEqual(fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n'), build(), 'renderer/style.css is out of date – run npm run css');
console.log('ok  style.css is built from styles/');
