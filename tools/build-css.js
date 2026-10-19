// Builds renderer/style.css from its parts in styles/ – never edit style.css by hand.
//   npm run css            write it
//   npm run css -- --check only compare (exit 1 when style.css is not what the parts make)
// The parts are joined in name order (a-base, b-shell, …). Lengths are written in px and turned
// into rem (base 15 px), so the whole overlay follows the root font size – except 1–2 px hairlines,
// media query conditions, @font-face and the regions marked /*@px … /*@rem*/ (the closed strip,
// which keeps its size whatever the panel's font is).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'styles');
const OUT = path.join(ROOT, 'renderer', 'style.css');

const rem = (v) => { const r = Math.round(v / 15 * 1000) / 1000; return String(r).replace(/^0\./, '.').replace(/^-0\./, '-.') + 'rem'; };

/** The stylesheet the parts make. */
function build() {
  const parts = fs.readdirSync(SRC).filter((f) => f.endsWith('.css')).sort();
  const css = parts.map((p) => fs.readFileSync(path.join(SRC, p), 'utf8').replace(/\r\n/g, '\n')).join('\n');
  let px = false;
  return css.split('\n').map((line) => {
    if (line.includes('/*@px')) px = true;
    if (line.includes('/*@rem*/')) { px = false; return line; }
    if (px || /^\s*@(media|container)/.test(line) || /@font-face/.test(line) || /^html\{font-size/.test(line)) return line;
    return line.replace(/(-?\d*\.?\d+)px/g, (m, v) => (Math.abs(Number(v)) <= 2 ? m : rem(Number(v))));
  }).join('\n')
    .replace(/\/\*@px\s*/g, '/* ').replace(/\/\*@rem\*\/\n?/g, '');
}

if (require.main === module) {
  const css = build();
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') : '';
    if (now !== css) { console.error('renderer/style.css is out of date – run npm run css'); process.exit(1); }
    console.log('renderer/style.css is up to date');
  } else {
    fs.writeFileSync(OUT, css);
    console.log('renderer/style.css', css.split('\n').length, 'lines');
  }
}

module.exports = { build, OUT };
