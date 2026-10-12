'use strict';
// The damage and toughness model behind the builder – Path of Building in small.
//
// Damage per hit (d4guides "Damage Calculation", patch 3.2.2; maxroll "In-Depth Damage Guide"):
//
//   weapon damage × skill % × main stat factor × (1 + additive [+]) × (1 + damage multipliers)
//     × every separate [x] × crit factor × vulnerable factor × DoT factor
//
//   main stat factor  1 + stat / 10 × per10            (per10 by class, patch 3.2.1)
//   crit factor       (A + CSD[+]) / A × 1.5 × (1 + CSD multiplier)   on a crit, A = 1 + additive
//   average crit      1 + chance × (crit factor − 1)     damage over time cannot crit (game text)
//   vulnerable        1.2 × (1 + Vulnerable multiplier) while the enemy is Vulnerable
//   skill rank        +10% of the rank-1 value per rank, +15% at ranks 5, 10, 15, 20
//   overpower         +15% [+] per stack, 4 stacks base
//
// Toughness: damage reduction sources multiply – taken = Π (1 − DR) (maxroll defence guide).
//
// Aspect and unique texts are read into effects ("30%[x] increased damage while Berserking" ->
// {kind:'x', v:30, cond:['berserk']}), each with the conditions it needs. Like PoB's
// configuration tab, a condition only counts when it is switched on – the builder switches on
// what the build itself provides and leaves the rest to the player.
(function (root) {
  const RANK_STEPS = [5, 10, 15, 20];
  const rankValue = (r) => 1 + 0.1 * (Math.max(1, r) - 1) + 0.05 * RANK_STEPS.filter((x) => r >= x).length;

  // conditions an effect can need – id, what the player sees, and the words that name it
  const CONDITIONS = [
    ['berserk', 'You are Berserking', /\bBerserking\b/i],
    ['healthy', 'You are Healthy (above 80% Life)', /\bHealthy\b/i],
    ['injured', 'Enemy or you are Injured (below 35% Life)', /\bInjured\b|below 35% Life|how Injured/i],
    ['close', 'Enemies are Close', /\bClose enem|Nearby enem/i],
    ['distant', 'Enemies are Distant', /\bDistant\b/i],
    ['elite', 'Fighting Elites / Bosses', /\bElites?\b|\bBoss(es)?\b/i],
    ['vulnerable', 'Enemy is Vulnerable', /\bVulnerable\b/i],
    ['cc', 'Enemy is Crowd Controlled', /Crowd Controlled|Incapacitated|Stunned|Slowed|Chilled|Frozen|Knocked Down|Knock ?Downs?|Knock ?Backs?|Immobilized|Dazed|Feared/i],
    ['crit', 'Your hits Critically Strike', /^Critical Strikes|\bCritical Strikes (with|from|deal|grant|have|that)|Critically Strik/i],
    ['barrier', 'You have a Barrier', /\bBarrier active|while you have a Barrier/i],
    ['fortified', 'You are Fortified', /\bFortified\b/i],
    ['overpower', 'You have Overpower', /while you have Overpower|Overpower stack|or more Overpower/i],
    ['unstoppable', 'You are Unstoppable', /while you are Unstoppable|While Unstoppable/i],
    ['still', 'You stand still', /standing still/i],
    ['moving', 'You are moving', /while moving/i],
    ['bleeding', 'Enemy is Bleeding', /\bBleeding enem/i],
    ['burning', 'Enemy is Burning', /\bBurning enem/i],
    ['poisoned', 'Enemy is Poisoned', /\bPoisoned enem/i],
    ['resource', 'Resource is high', /above \d+ Primary Resource|available Primary Resource|full Primary Resource/i],
    ['ultimate', 'You just cast your Ultimate', /Casting an Ultimate/i],
    ['twohand', 'You wield a two-handed weapon', /Two-Handed Weapon/i],
    ['channel', 'You are channeling', /while channeling|is channeled|Channeling a Skill/i],
    ['stacks', 'Stacking bonus at its maximum', /maximum stacks|stacking up to|up to \d+ times/i],
    ['buff', 'Short buffs after a trigger are up', /\bfor \d+(\.\d+)? seconds\b|\bAfter (you |spending|casting|generating)/i],
    ['luckyhit', 'Lucky Hit procs (chance based)', /^Lucky Hit:/i],
  ];

  const SKILL_GROUPS = ['Basic', 'Core', 'Ultimate', 'Defensive', 'Mastery', 'Conjuration', 'Brawling', 'Weapon Mastery', 'Macabre', 'Corruption', 'Curse',
    'Agility', 'Subterfuge', 'Imbued', 'Imbuement', 'Companion', 'Wrath', 'Potency', 'Focus', 'Justice', 'Valor', 'Aura', 'Archfiend', 'Sigil', 'Shout',
    'Shock', 'Frost', 'Pyromancy', 'Marksman', 'Cutthroat', 'Trap', 'Grenade', 'Bone', 'Blood', 'Darkness', 'Earth', 'Storm', 'Werewolf', 'Werebear',
    'Shapeshifting', 'Nature Magic', 'Jaguar', 'Gorilla', 'Centipede', 'Eagle', 'Zealot', 'Juggernaut', 'Disciple', 'Judicator', 'Hellfire', 'Abyss',
    'Occult', 'Demon', 'Channeled', 'Summon', 'Minion', 'Cast', 'Attack'];
  const ELEMENTS = ['Physical', 'Fire', 'Lightning', 'Cold', 'Poison', 'Shadow', 'Holy'];

  const num = (s) => Number(String(s).replace(/,/g, ''));
  const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // things that deal their own damage – an effect on them is not an effect on the main skill
  const SIDE = /\b(Arrow Storms?|Stun Grenades?|Grenades?|Ice Spikes?|Meteorites?|Dust Devils?|Earthquakes?|Vampiric Curse|souls|Thorns|Summons?|Minions?|Ancients?|Companions?|Golems?|Skeletons?|Hydras?|Familiars?|Shadow Clones?|Crackling Energy|Blood Orbs?|Corpses?|Fallen|Demons?|bolts|shards|Spirit Hawk|Feathers?|Seekers?|Firebirds?|Echoes|echo(ed)?|Iron Shrapnel|Tornado(es)? it|Brimstone|Volatility)\b/;
  const VERB = /\b(deals?|dealing|has|have|gains?|is|are|take|takes|explodes?|Critically Strikes?|Critical Strike)\b/;

  /**
   * Who a sentence is about, against the main skill:
   *   'all' – your damage in general, 'skill' – the main skill or a group it is in,
   *   'other' – another skill, a summon or a side effect (Dust Devils, Earthquakes, Arrow Storms …)
   * The subject – the words before the first verb – decides first.
   */
  function scope(sentence, prof) {
    const s = sentence;
    const v = VERB.exec(s);
    const subj = v ? s.slice(0, v.index) : s;
    const noun = prof.noun ? new RegExp('\\b' + esc(prof.noun) + "('s)?\\b", 'i') : null;
    const others = prof.otherSkills.filter((n) => new RegExp('\\b' + esc(n) + '\\b').test(s));
    if (noun && noun.test(subj) && !SIDE.test(subj)) return 'skill';
    if (SIDE.test(subj) && !(prof.minion && /Summon|Minion/.test(subj))) return 'other';
    if (others.some((n) => new RegExp('\\b' + esc(n) + '\\b').test(subj))) return noun && noun.test(s) ? 'other' : 'other';
    // "your Marksman, Cutthroat, Mobility, or Trap Skills" – a list counts when any of it is ours
    const list = /((?:[A-Z][a-z]+(?: [A-Z][a-z]+)?(?:, | or |, or ))+[A-Z][a-z]+(?: [A-Z][a-z]+)?) Skills/.exec(s);
    if (list) {
      const names = list[1].split(/, or |, | or /).map((x) => x.trim());
      if (names.every((n) => SKILL_GROUPS.includes(n) || n === 'Mobility')) return names.some((n) => prof.groups.includes(n)) ? 'skill' : 'other';
    }
    const grp = SKILL_GROUPS.find((g) => new RegExp('\\b' + esc(g) + ' (Skills?|Skill Casts?)\\b').test(s) && !new RegExp('Non-' + esc(g)).test(s));
    if (grp) return prof.groups.includes(grp) ? 'skill' : 'other';
    if (/Non-Basic/.test(s)) return prof.groups.includes('Basic') ? 'other' : 'skill';
    if (/\bBurning damage\b/.test(s)) return prof.el === 'Fire' && prof.dot ? 'skill' : 'other';
    if (/\bBleeding damage\b/.test(s)) return prof.el === 'Physical' && prof.dot ? 'skill' : 'other';
    if (/\bPoisoning damage\b/.test(s)) return prof.el === 'Poison' && prof.dot ? 'skill' : 'other';
    if (/\bDamage over Time\b/i.test(s) && /increase|deal/i.test(s)) return prof.dot ? 'skill' : 'other';
    const el = ELEMENTS.find((e) => new RegExp('\\b' + e + ' (damage|Skills?)\\b').test(s));
    if (el && !/all damage types|set of damage types|Resistance/i.test(s)) return el === prof.el ? 'skill' : 'other';
    if (others.length) return 'other';
    if (noun && noun.test(s)) return 'skill';
    if (SIDE.test(s) && !/\byou deal\b/i.test(s)) return 'other';
    // "increased Summon damage", "your Conjuration damage": a qualified damage belongs to that group
    const q = /(?:increased|your|deal(?:s)?(?: \d+(?:\.\d+)?%\[[x+]\])?(?: increased)?) ((?:[A-Z][a-z]+ ){1,2})(?:Skill )?damage/.exec(s);
    if (q) {
      const w = q[1].trim();
      if (ELEMENTS.includes(w)) return w === prof.el ? 'skill' : 'other';
      if (prof.groups.includes(w) || (prof.noun && w === prof.noun)) return 'skill';
      if (!/^(All|Direct|Critical Strike|Total)$/.test(w)) return 'other';
    }
    return 'all';
  }

  /**
   * The conditions a sentence names: the known ones by id, and anything else that limits it
   * ("to isolated enemies", "While Inner Sight is full") as a condition of its own, named by its
   * own words – the player switches it on, the model never guesses it.
   */
  function conditionsOf(sentence, prof) {
    // "…, doubled against Crowd Controlled enemies" raises the bonus there – the base needs no condition
    const s = sentence.replace(/,? ?(this bonus is )?(doubled|tripled|increased to [^,.]+|further increased [^,.]+) (against|while|when|for|to|if) [^.]*/i, '');
    const out = CONDITIONS.filter(([, , re]) => re.test(s)).map(([id]) => id);
    const clauses = [];
    let m;
    const re = /\b(While [^,.]+|when [^,.]+|to (?:[a-z]+ )*enemies (?:marked|affected|afflicted|hit) by [^,.]+|to (?:isolated|marked|cursed|Frozen|Chilled|Stunned|Slowed|Poisoned|Burning|Bleeding) enemies|against (?:[a-z]+ )*enemies [^,.]*|based on [^,.]+|for each [^,.]+|if [^,.]+)/gi;
    while ((m = re.exec(s))) clauses.push(m[1].trim());
    for (const c of clauses) {
      if (CONDITIONS.some(([, , r]) => r.test(c)) || /Two-Handed/.test(c) || /^for each (second|point)/i.test(c)) continue;
      if (/channel/i.test(c) && prof.channeled) continue;
      if (/^while in combat$/i.test(c)) continue;      // always true while you fight
      out.push('?' + c.replace(/\s+/g, ' ').slice(0, 70));
    }
    return [...new Set(out)];
  }

  /**
   * Effects in one aspect / unique / passive text that the model can count.
   * Each: { kind, v, cond[], scope, text } – kinds:
   *   x        separate damage multiplier (its own bucket)
   *   add      additive [+] damage
   *   cc / cdx crit chance [+] / crit damage multiplier
   *   ccx      crit chance multiplied ("Critical Strike Chance … increased by 13%[x]")
   *   as       attack speed [+]       cdr  cooldown reduction
   *   rank     + ranks                vuln makes enemies Vulnerable
   *   dr       damage reduction (toughness)    life  % maximum life    armor  % armor
   *   proc     deals its own damage (counted as a source, not as a %)
   */
  function parseEffects(text, prof) {
    const out = [];
    const sentences = String(text || '').split(/(?<=[.!])\s+(?=[A-Z])/);
    let lucky = false;
    let lastScope = '';
    for (const s of sentences) {
      if (/^Lucky Hit:/i.test(s)) lucky = true;
      // a sentence without a subject of its own ("Subsequent swings …", "It …") is about the same thing as the one before
      const sc = lastScope && /^(Subsequent|It|Its|They|Their|This|These|Each|Additionally|Also)\b/.test(s) ? lastScope : scope(s, prof);
      lastScope = sc;
      const cond = conditionsOf(s, prof).filter((c) => c !== 'luckyhit');
      if (lucky && /^Lucky Hit:/i.test(s)) cond.push('luckyhit');
      const stacks = /up to (\d+(\.\d+)?)%\[x\]/i.exec(s);
      const add = (kind, v, extra) => out.push(Object.assign({ kind, v, cond, scope: sc, text: s }, extra || {}));
      let m;
      // crit chance and crit damage raised together, as a multiplier (Dire Whirlwind)
      if ((m = /Critical Strike Chance and Critical Strike Damage are increased by (\d+(\.\d+)?)%\[x\]/i.exec(s))) {
        const v = stacks ? num(stacks[1]) : num(m[1]);
        add('ccx', v); add('cdx', v); continue;
      }
      if ((m = /(\d+(\.\d+)?)%\[x\] (increased )?Critical Strike Damage|Critical Strike Damage (is )?increased by (\d+(\.\d+)?)%\[x\]/i.exec(s))) { add('cdx', num(m[1] || m[5])); continue; }
      // "Critical Strikes deal 100%[x] increased damage" – only crits get it: a crit damage multiplier
      if ((m = /^(Your )?Critical Strikes deal (\d+(\.\d+)?)%\[x\] (increased )?damage/i.exec(s))) { out.push({ kind: 'cdx', v: num(m[2]), cond: cond.filter((c) => c !== 'crit'), scope: sc, text: s }); if (/reduced by/.test(s)) { const r = /Critical Strike Chance is reduced by (\d+(\.\d+)?)%/i.exec(s); if (r) out.push({ kind: 'cc', v: -num(r[1]), cond: [], scope: 'all', text: s }); } continue; }
      if ((m = /Critical Strike Chance is reduced by (\d+(\.\d+)?)%/i.exec(s))) out.push({ kind: 'cc', v: -num(m[1]), cond: [], scope: 'all', text: s });
      // drawbacks and speed – what soul splinters and runewords trade
      if ((m = /\blose (\d+(\.\d+)?)% Critical Strike Chance/i.exec(s))) out.push({ kind: 'cc', v: -num(m[1]), cond: [], scope: 'all', text: s });
      if ((m = /\blose (\d+(\.\d+)?)% Movement Speed/i.exec(s))) out.push({ kind: 'move', v: -num(m[1]), cond: [], scope: 'all', text: s });
      // "Each soul … increases your damage taken by 1% … stacks up to 200 times": counted per soul you hold (st.souls)
      // the cap often sits in the next sentence ("This effect stacks up to 200 times")
      const perSoul = /Each \w+ increases/i.test(s) && /stacks up to (\d+) times/i.exec(String(text));
      if ((m = /increases your damage taken by (\d+(\.\d+)?)%/i.exec(s))) {
        if (perSoul) out.push({ kind: 'takenper', v: num(m[1]), max: num(perSoul[1]), cond, scope: 'all', text: s });
        else out.push({ kind: 'taken', v: num(m[1]), cond, scope: 'all', text: s });
      }
      if ((m = /(\d+(\.\d+)?)%\[\+\] Attack Speed and Critical Strike Chance/i.exec(s))) { out.push({ kind: 'as', v: num(m[1]), cond, scope: 'all', text: s }, { kind: 'cc', v: num(m[1]), cond, scope: 'all', text: s }); continue; }
      if (/Evade is now [^.]*Teleport/i.test(s)) out.push({ kind: 'teleport', v: 1, cond: [], scope: 'all', text: s });
      if ((m = /\+?(\d+(\.\d+)?)%(?:\[[x+]\])? (increased )?Movement Speed/i.exec(s)) && !/lose|Slow/i.test(s)) out.push({ kind: 'move', v: num(m[1]), cond, scope: 'all', text: s });
      // "Each soul increases your damage by 2.5%[x] … stacks up to 200 times" – as many souls as you hold (st.souls)
      if ((m = /Each \w+ increases your damage by (\d+(\.\d+)?)%\[x\]/i.exec(s)) && perSoul) {
        out.push({ kind: 'xper', v: num(m[1]), max: num(perSoul[1]), cond, scope: 'all', text: s });
        continue;
      }
      if ((m = /(\d+(\.\d+)?)%\[x\] increased damage per stack of Overpower/i.exec(s))) { out.push({ kind: 'x', v: num(m[1]) * 4, cond: cond.concat('overpower'), scope: sc, text: s, note: 'at 4 Overpower stacks' }); continue; }
      if (/#%\[[x+]\]/.test(s)) { add('scaled', 0); continue; }
      if ((m = /Critical Strike Chance (is )?(increased )?by (\d+(\.\d+)?)%\[\+\]|(\d+(\.\d+)?)%\[\+\] (increased )?Critical Strike Chance/i.exec(s))) { add('cc', num(m[3] || m[5])); continue; }
      if ((m = /(Gain|gain) \+?(\d+) (additional )?(Rank|Ranks) to (all Skills|[A-Z][A-Za-z ]+)/.exec(s)) || (m = /Gain (\d+) additional ([A-Za-z ]+) Skill Ranks/.exec(s))) {
        const n = m[2] && /^\d+$/.test(m[2]) ? num(m[2]) : num(m[1]);
        const what = m[5] || m[2] || '';
        const hit = /all Skills/i.test(what) || new RegExp(esc(prof.noun), 'i').test(what) || prof.groups.some((g) => new RegExp('\\b' + esc(g) + '\\b').test(what));
        out.push({ kind: 'rank', v: n, cond, scope: hit ? 'skill' : 'other', text: s });
        continue;
      }
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?Attack Speed|Attack Speed by (\d+(\.\d+)?)%\[\+\]/i.exec(s))) { add('as', num(m[1] || m[4])); continue; }
      if ((m = /(\d+(\.\d+)?)%(?:\[\+\])? (increased )?(Damage Reduction|less damage)/i.exec(s)) || (m = /Damage Reduction (by|of) (\d+(\.\d+)?)%/i.exec(s))) {
        const v = m[2] && /\d/.test(m[2]) && !m[1] ? num(m[2]) : num(m[1]);
        const max = /up to (\d+(\.\d+)?)% (maximum|Damage Reduction)/i.exec(s);
        out.push({ kind: 'dr', v: max ? num(max[1]) : v, cond, scope: 'all', text: s });
        continue;
      }
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?(Total )?Armor/i.exec(s))) { out.push({ kind: 'armor', v: num(m[1]), cond, scope: 'all', text: s }); continue; }
      if ((m = /Maximum Life (is )?increased by (\d+(\.\d+)?)%/i.exec(s))) { out.push({ kind: 'life', v: num(m[2]), cond, scope: 'all', text: s }); continue; }
      // separate multipliers – the core of it
      if ((m = /(\d+(\.\d+)?)%\[x\] (increased |more )?(damage|[A-Za-z ]* damage)/i.exec(s)) || (m = /damage (is )?(increased )?by (\d+(\.\d+)?)%\[x\]/i.exec(s))
        || (m = /take (\d+(\.\d+)?)%\[x\] (increased )?damage/i.exec(s)) || (m = /(\d+(\.\d+)?)%\[x\] more damage/i.exec(s))) {
        const v = stacks ? num(stacks[1]) : num(m[1] && /\d/.test(m[1]) ? m[1] : m[3]);
        if (/Movement Speed|Lucky Hit Chance|Attack Speed/i.test(m[0])) continue;
        add('x', v, stacks ? { upTo: true } : null);
        continue;
      }
      if (/Resistance|Movement Speed|Size|Duration|Lucky Hit Chance/i.test(s) && !/damage/i.test(s.replace(/damage type/gi, ''))) continue;
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?((?:[A-Z][a-z]+ ){0,2})damage/.exec(s)) && !/Resistance/.test(m[0])) { add('add', num(m[1])); continue; }
      if ((m = /(\d+(\.\d+)?)% increased ((?:[A-Z][a-z]+ ){0,2})damage/.exec(s)) && !/Damage Reduction/i.test(s)) { add('add', num(m[1]), { unsure: true }); continue; }
      if (/(makes?|are|become) (them |enemies )?Vulnerable|inflicts? Vulnerable|also Vulnerable/i.test(s)) { add('vuln', 1); continue; }
      if ((m = /Cooldowns? (is |are )?reduced by (\d+(\.\d+)?)%|(\d+(\.\d+)?)% Cooldown Reduction/i.exec(s))) { add('cdr', num(m[2] || m[4])); continue; }
      if (/\bdeal(s|ing)? (#|\d[\d,.]*%?) (\w+ )?damage\b|explodes?|Summon an Ancient|launch|unleash(es)? a Rank|Crushing Blow|creates? an? \w+ that deals/i.test(s)) { add('proc', 0); continue; }
    }
    return out;
  }

  /** A starting point for the model: the game's own base values; the rest comes from the gear in the plan. */
  function baseState(per10) {
    return { w: 1, skill: 100, rank: 1, stat: 0, per10: per10 || 1.25, add: 0, bucket: 0, sep: [], crit: 5, ccMul: 1, csdp: 0, csdx: 0, cdxSep: 1,
      vulnUp: 0, vulnx: 0, dotx: 0, op: 0, as: 0, cdr: 0, limit: 'none', dot: false, dr: [], life: 0, armorPct: 0,
      // speed: movement speed in %, and whether evade became a teleport (Enigma); more damage taken from drawbacks
      move: 0, teleport: false, taken: 0,
      // souls held (Splinter of the Black Soulstone) – the player sets it; half the cap until then
      souls: 100 };
  }

  /** How fast the build moves through a map – movement speed, a teleporting evade counts like +30%. */
  function speed(st) {
    return Math.max(0.2, 1 + (st.move + (st.teleport ? 30 : 0)) / 100);
  }

  /** Average damage per hit (and per second when casts are limited by speed or cooldowns). */
  function damage(st) {
    const A = 1 + (st.add + 15 * Math.min(st.op, 4)) / 100;
    const stat = 1 + st.stat / 10 * st.per10 / 100;
    const base = st.w * st.skill / 100 * rankValue(st.rank) / rankValue(1);
    const bucket = 1 + st.bucket / 100;
    const sep = st.sep.reduce((a, x) => a * (1 + x / 100), 1);
    const chance = Math.min(1, st.crit * st.ccMul / 100);
    const critF = (A + st.csdp / 100) / A * 1.5 * (1 + st.csdx / 100) * st.cdxSep;
    const critAvg = st.dot ? 1 : 1 + chance * (critF - 1);
    const vulnF = 1.2 * (1 + st.vulnx / 100);
    const vulnAvg = 1 + Math.min(100, st.vulnUp) / 100 * (vulnF - 1);
    const dotF = st.dot ? 1 + st.dotx / 100 : 1;
    const hit = base * stat * A * bucket * sep * critAvg * vulnAvg * dotF;
    const rate = st.limit === 'speed' ? 1 + Math.min(100, st.as) / 100 : st.limit === 'cooldown' ? 1 / (1 - Math.min(0.95, st.cdr / 100)) : 1;
    return { hit, dps: hit * rate, f: { base, stat, A, bucket, sep, chance, critF, critAvg, vulnF, vulnAvg, dotF, rate } };
  }

  /** How much less damage you take, as effective life: 1 / Π(1 − DR). */
  function toughness(st) {
    const taken = st.dr.reduce((a, d) => a * (1 - Math.min(90, d) / 100), 1) * (1 + (st.taken || 0) / 100);
    return (1 + st.life / 100) / taken;
  }

  /** Puts a parsed effect into a state (when it applies and its conditions are on). */
  function apply(st, e, on) {
    // Vulnerable helps every hit, whichever skill or side effect applies it
    if (e.scope === 'other' && e.kind !== 'vuln') return st;
    if (e.cond.some((c) => !on[c])) return st;
    const s = Object.assign({}, st, { sep: st.sep.slice(), dr: st.dr.slice() });
    switch (e.kind) {
      case 'x': s.sep.push(e.v); break;
      case 'add': s.add += e.v; break;
      case 'cc': s.crit += e.v; break;
      case 'ccx': s.ccMul *= 1 + e.v / 100; break;
      case 'cdx': s.cdxSep *= 1 + e.v / 100; break;
      case 'as': s.as += e.v; break;
      case 'cdr': s.cdr = 100 - (100 - s.cdr) * (1 - e.v / 100); break;
      case 'rank': s.rank += e.v; break;
      case 'vuln': s.vulnUp = 100; break;
      case 'dr': s.dr.push(e.v); break;
      case 'life': s.life += e.v; break;
      case 'armor': s.armorPct += e.v; break;
      case 'move': s.move += e.v; break;
      case 'teleport': s.teleport = true; break;
      case 'taken': s.taken = (s.taken || 0) + e.v; break;
      case 'xper': s.sep.push(e.v * Math.min(e.max, s.souls == null ? 100 : s.souls)); break;
      case 'takenper': s.taken = (s.taken || 0) + e.v * Math.min(e.max, s.souls == null ? 100 : s.souls); break;
      // a fixed stat line on a unique or a rolled affix ("+[2 - 3] to Whirlwind", "x200% Critical Strike Damage Multiplier")
      case 'roll': return applyRoll(s, e);
      default: break;
    }
    return s;
  }

  const LIFE_BASE = 1526;          // base Life at level 70 (maxroll defence guide)
  const top = (d) => { const m = String(d).match(/\[([\d.,]+)\s*-\s*([\d.,]+)\]/); return m ? num(m[2]) : (String(d).match(/[\d.,]+/) ? num(String(d).match(/[\d.,]+/)[0]) : 0); };

  /**
   * A stat line ("x[26 - 50]% Critical Strike Damage Multiplier", "+[2 - 3] to Whirlwind") as a
   * change of the state at its best roll: { k, v } – or null when the model has nothing to say about it.
   */
  function rollOf(d, prof) {
    const v = top(d);
    const t = String(d).trim();
    if (/to All Skills$/i.test(t)) return { k: 'rank', v };
    const grp = t.match(/to (.+) Skills$/);
    if (grp) return prof.groups.includes(grp[1]) ? { k: 'rank', v } : null;
    if (prof.noun && new RegExp('to ' + esc(prof.noun) + '$', 'i').test(t)) return { k: 'rank', v };
    if (/^\+\[?[\d.,\s-]+\]? to /.test(t)) return null;
    if (/Critical Strike Damage Multiplier/.test(t)) return { k: 'csdx', v };
    if (/Critical Strike Chance$/.test(t)) return { k: 'crit', v };
    if (/Vulnerable Damage Multiplier/.test(t)) return { k: 'vulnx', v };
    if (/Damage Over Time Multiplier/.test(t)) return { k: 'dotx', v };
    if (/All Damage Multiplier/.test(t)) return { k: 'bucket', v };
    // a gem in the weapon: "x22% Fire and Holy Damage Multiplier" counts when either is yours
    const two = t.match(/(Physical|Fire|Cold|Lightning|Poison|Shadow|Holy) and (Physical|Fire|Cold|Lightning|Poison|Shadow|Holy) Damage Multiplier/);
    if (two) return two[1] === prof.el || two[2] === prof.el ? { k: 'bucket', v } : null;
    const el = t.match(/(Physical|Fire|Cold|Lightning|Poison|Shadow|Holy) Damage Multiplier/);
    if (el) return el[1] === prof.el ? { k: 'bucket', v } : null;
    if (prof.mainStat && new RegExp('^\\+\\[?[\\d.,\\s-]+\\]? (' + prof.mainStat + '|All Stats)$').test(t)) return { k: 'stat', v };
    if (/Attack Speed$/.test(t) && !/for \d/.test(t)) return { k: 'as', v };
    if (/^\[?[\d.\s-]+\]?% Cooldown Reduction$/.test(t)) return { k: 'cdr', v };
    if (/^\+\[?[\d.,\s-]+\]? Maximum Life$/.test(t)) return { k: 'lifeFlat', v };
    if (/% Maximum Life$/.test(t)) return { k: 'life', v };
    if (/% Damage Reduction$/.test(t)) return { k: 'dr', v };
    // runeword shields: "+100% Main Hand Weapon Damage" – the base every hit scales from
    if (/% Main Hand Weapon Damage$/.test(t)) return { k: 'wpct', v };
    return null;
  }

  function applyRoll(st, r) {
    const s = Object.assign({}, st, { sep: st.sep.slice(), dr: st.dr.slice() });
    switch (r.k) {
      case 'rank': s.rank += r.v; break;
      case 'csdx': s.csdx += r.v; break;
      case 'crit': s.crit += r.v; break;
      case 'vulnx': s.vulnx += r.v; break;
      case 'dotx': s.dotx += r.v; break;
      case 'bucket': s.bucket += r.v; break;
      case 'stat': s.stat += r.v; break;
      case 'as': s.as += r.v; break;
      case 'cdr': s.cdr = 100 - (100 - s.cdr) * (1 - r.v / 100); break;
      case 'lifeFlat': s.life += r.v / LIFE_BASE * 100; break;
      case 'life': s.life += r.v; break;
      case 'dr': s.dr.push(r.v); break;
      case 'wpct': s.w *= 1 + r.v / 100; break;
      default: break;
    }
    return s;
  }

  /** What one piece is worth on top of a state: damage and toughness gain in %, and what it needs. */
  function worth(st, effects, on) {
    let s = st;
    for (const e of effects) s = apply(s, e, on);
    const d0 = damage(st).dps, d1 = damage(s).dps;
    const t0 = toughness(st), t1 = toughness(s);
    // what it would bring with every condition met – shown as "+x% if …"
    const all = {};
    effects.forEach((e) => e.cond.forEach((c) => { all[c] = true; }));
    let sMax = st;
    for (const e of effects) sMax = apply(sMax, e, all);
    const needs = [...new Set(effects.filter((e) => e.scope !== 'other').flatMap((e) => e.cond).filter((c) => !on[c]))];
    return {
      dmg: (d1 / d0 - 1) * 100, tough: (t1 / t0 - 1) * 100,
      dmgIf: (damage(sMax).dps / d0 - 1) * 100, toughIf: (toughness(sMax) / t0 - 1) * 100,
      needs, proc: effects.some((e) => e.kind === 'proc' && e.scope !== 'other'), unsure: effects.some((e) => e.unsure), state: s,
    };
  }

  const api = { rankValue, parseEffects, baseState, damage, toughness, speed, apply, applyRoll, rollOf, worth, CONDITIONS, SKILL_GROUPS, LIFE_BASE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DmgModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
