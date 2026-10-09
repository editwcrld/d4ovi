// Prüft die Scraper-Heuristik gegen ein nachgebautes Maxroll-Layout (jsdom liegt außerhalb des Projekts)
const { JSDOM } = require(process.env.JSDOM_PATH || 'jsdom');
const { extract } = require('../lib/maxroll');
const html = `<body><nav><ul><li>Nav</li></ul></nav><main>
<h1>Boss Loot Table Cheat Sheet</h1><p>With the introduction of the Bosses, we decided ...</p>
<h2>Grigoire, The Galvanic Saint</h2><h3>Basic Information</h3>
<ul><li>Requires Torment 1 or higher.</li><li>Summoning Material: 12x Living Steel</li></ul>
<figure><img src="/img/hall.jpg" width="900"><figcaption>The Hall of the Penitent is located South of Ked Bardu in the Dry Steppes</figcaption></figure>
<h4>Barbarian:</h4><ul><li><span><img src="icon.png" width="32">Rage of Harrogath</span></li><li>Battle Trance</li></ul>
<p><strong>Multiple Classes:</strong></p><ul><li>Penitent Greaves</li></ul>
<h2>Duriel, King of Maggots</h2><h3>Basic Information</h3><ul><li>Element Type: Poison</li></ul>
<img data-src="https://cdn.example/crevasse.jpg"><p>The Gaping Crevasse to the East of Gea Kul in Kehjistan.</p>
<h4>Barbarian</h4><ul><li>Tuskhelm of Joritz the Mighty</li></ul><h4>Multiple Classes</h4><ul><li>Godslayer Crown</li></ul>
<h2>Mythic Uniques</h2><h3>Basic Information</h3><ul><li>All bosses have a Mythic Unique items.</li></ul><p>Most endgame builds use one ...</p>
<img src="glow.png" width="451"><ul><li>Shattered Vow (All)</li><li>Doombringer (Barb, Druid, Necro)</li></ul>
<h2>Summary</h2><ul><li>Each Boss has a specific loot table</li></ul><h2>Credits</h2><p>Written by x</p>
</main></body>`;
const dom = new JSDOM(html, { url: 'https://maxroll.gg/d4/resources/boss-loot-table-cheat-sheet' });
const r = extract(dom.window.document, dom.window.location);
for (const s of r.sections) {
  console.log('##', s.name, '| loc:', s.location, '| imgs:', s.images.length, '| info:', s.info.length);
  console.log('   ', s.drops.map((d) => `${d.name}${d.note ? ' (' + d.note + ')' : ''} <${d.cls}>`).join('; '));
}
