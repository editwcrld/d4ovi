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
    // a fully staggered boss counts as affected by every crowd control (the game's own tooltip)
    // Frozen is a condition of its own: a bonus "to Frozen enemies" needs a freeze, not any crowd control
    ['frozen', 'Enemy is Frozen', /\bFrozen enem|\bto Frozen\b|against Frozen/i],
    ['cc', 'Enemy is Crowd Controlled – or a staggered boss', /Crowd Controlled|Incapacitated|Stunned|Slowed|Chilled|Knocked Down|Knock ?Downs?|Knock ?Backs?|Immobilized|Dazed|Feared/i],
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
  const VERB = /\b(deals?|dealing|has|have|gains?|is|are|take|takes|leaves?|receives?|explodes?|Critically Strikes?|Critical Strike)\b/;

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

  /** Whether "an Ultimate Skill", "a non-Channeled Ultimate Skill", "Rain of Arrows" … is the main skill. */
  function triggers(what, prof) {
    const t = String(what || '');
    if (prof.noun && new RegExp('\\b' + esc(prof.noun) + '\\b', 'i').test(t)) return true;
    if (/non-Channeled/i.test(t) && prof.channeled) return false;
    const grp = SKILL_GROUPS.filter((g) => new RegExp('\\b' + esc(g) + '\\b').test(t));
    if (grp.length) return grp.some((g) => prof.groups.includes(g));
    return /^(an? )?Skill$/i.test(t.trim());
  }
  const hasCooldown = (prof) => (prof.cooldown != null ? !!prof.cooldown : !!(prof.p && prof.p.cooldown));

  /**
   * The mechanics a sentence sets up around the main skill – what cycle() plays through:
   *   consume     a cast spends the whole pool for v%[x] per point (Beastfall Boots)
   *   refill      a cast gives v back (Beastfall: "Using a Cooldown restores 25 Energy")
   *   refillRank  a cast gives v per rank of the skill back (Aspect of Aftermath)
   *   cdSpend     every `per` spent takes v seconds off the cooldown (Preparation)
   *   cdFlat      the cooldown is v seconds shorter (a modifier)
   *   burst       casting it gives v%[x] for `dur` seconds – counted by how much of the time it is up
   *   maxres      a larger pool
   *   perRes      v%[x] per point of the pool you hold (Ramaladni's Magnum Opus, Aspect of Bursting Bones)
   *   tag         the main skill becomes a skill of another group too (Elegy: "Blazing Scream is now an
   *               Archfiend Skill") – every bonus for that group counts for it then (builder re-reads the texts)
   *   durFlat     the skill lasts v seconds longer
   */
  const RES_WORD = '(Fury|Energy|Essence|Spirit|Mana|Vigor|Faith|Wrath|Resolve|Resource|Primary Resource)';
  // who a chain starts from or reaches: "your other Skills", "your Trap Skills", "Shadow Step", "one of your Skills"
  const chainWho = (t) => {
    const x = String(t || '').trim().replace(/^(?:your |the |an? )/i, '').replace(/'s?$/, '');
    if (/^(other )?Skills?$/i.test(x)) return /other/i.test(x) ? 'other' : 'any';
    // "one of your Skills", "a random Subterfuge Skill": spread over every skill it could be
    if (/^(one of your|one of|random|a random) /i.test(x)) {
      const g = x.replace(/^(one of your|one of|random|a random) /i, '').replace(/ Skills?$/, '');
      return 'one:' + (/^Skills?$/i.test(g) || !g ? 'any' : g);
    }
    return x.replace(/ Skills?$/, '');
  };
  function mechanicOf(s, prof, sc) {
    let m;
    // ---- cooldown chains: casting one skill takes seconds off others (Aspect of Apogeic Furor, the Orange Herald, Synergy)
    if ((m = /(?:Casting|Using) (?:an? |your )?([A-Za-z' -]+?)(?: Skill)?(?: damage)? reduces the (?:active )?Cooldowns? of ([A-Za-z' ,-]+?) by (\d+(?:\.\d+)?)( seconds|%)(, and vice versa)?/i.exec(s))
      || (m = /^(?:Cast )?([A-Za-z' -]+?) Skill damage reduces the Cooldown of ([A-Za-z' ,-]+?) by (\d+(?:\.\d+)?)( seconds|%)()/i.exec(s))) {
      const from = chainWho(m[1]), to = chainWho(m[2]);
      const one = { kind: 'cdChain', from, to, v: m[4].trim() === '%' ? 0 : num(m[3]), pct: m[4].trim() === '%' ? num(m[3]) : 0, keep: true };
      return m[5] ? Object.assign(one, { back: true }) : one;
    }
    // Misericorde: "Lucky Hit: … up to a 40% chance to: Reduce the active Cooldowns of your Trap Skills by 30%" – the main skill's hits
    if ((m = /up to an? (\d+(?:\.\d+)?)% chance to:? Reduce the active Cooldowns? of ([A-Za-z' ]+?) by (\d+(?:\.\d+)?)%/i.exec(s)))
      return { kind: 'cdChain', from: 'main', to: chainWho(m[2]), v: 0, pct: num(m[3]), luckyChain: num(m[1]), keep: true };
    // ---- the resource budget
    if ((m = /(?:gain|grants?) (\d+(?:\.\d+)?) (?:Primary Resource|Fury|Energy|Mana|Spirit|Essence|Vigor|Faith|Wrath) Regeneration/i.exec(s))) return { kind: 'regen', v: num(m[1]), keep: true, useCond: true };
    // "Your Core Skills are now additionally Basic Skills and free to cast" – only when its subject is the main skill
    if ((m = /^(?:Your )?(.+?) (?:are|is) (?:now )?(?:additionally [A-Za-z ]+? and )?free to cast/i.exec(s)) && triggers(m[1].replace(/ Skills?$/, ''), prof)) return { kind: 'freeCast', v: 1, keep: true };
    if ((m = /Lucky Hit:[^.]*?up to (?:an? )?(\d+(?:\.\d+)?)% chance to restore (\d+(?:\.\d+)?) (?:Primary Resource|Fury|Energy|Mana|Spirit|Essence|Vigor|Faith|Wrath)/i.exec(s))) return { kind: 'lhRes', v: num(m[2]), chance: num(m[1]) };
    // ---- the Sorcerer's Chain Lightning enchantment: "Chain Lightning forms automatically after spending 100 Mana" –
    // a free cast for every 100 the build spends (what a cast costs, after Cost Reduction, against that)
    if ((m = /^(.+?) (?:forms|casts?|is cast|triggers?) automatically (?:after|every time you|whenever you) (?:spend(?:ing)?) (\d+(?:\.\d+)?) (?:Mana|Fury|Energy|Spirit|Essence|Vigor|Faith|Wrath|Primary Resource)/i.exec(s)) && triggers(m[1], prof))
      return { kind: 'formsPer', v: num(m[2]), keep: true };
    // ---- more casts for one: Axial Conduit "Casting Chain Lightning has a 50% chance to activate 1 to 5
    // additional times" – chance × the average extra (3) = 150% more; "a 30% chance to cast twice" – 30% more
    if ((m = /^(?:Casting )?(.+?) (?:has|have) an? (\d+(?:\.\d+)?)% chance to (?:activate|cast|trigger|be cast) (?:an? )?(?:(\d+) to )?(\d+)? ?(?:additional|more|extra) times?/i.exec(s)) && triggers(m[1].replace(/ Skills?$/, ''), prof)) {
      const lo = m[3] ? num(m[3]) : num(m[4] || 1), hi = num(m[4] || 1);
      return { kind: 'x', v: num(m[2]) / 100 * ((lo + hi) / 2) * 100, note: 'more casts: ' + m[2] + '% chance × ' + ((lo + hi) / 2) + ' on average', keep: true };
    }
    if ((m = /^(?:Casting )?(.+?) (?:has|have) an? (\d+(?:\.\d+)?)% chance to (?:be )?cast twice/i.exec(s)) && triggers(m[1].replace(/ Skills?$/, ''), prof)) return { kind: 'x', v: num(m[2]), note: 'cast twice ' + m[2] + '% of the time', keep: true };
    // ---- Elegy: "the Lesser Demon skulls deal the same damage as the main skull" – at least one more full hit a cast
    if (/deals? the same damage as the main/i.test(s) && sc !== 'other') return { kind: 'x', v: 100, note: 'at least one more hit at full damage a cast – how many the text does not say', keep: true };
    // ---- Aspect of Fleet Wings: "damage is increased by 35%[x] of your Movement Speed"
    if ((m = /damage is increased by (\d+(?:\.\d+)?)%\[x\] of your Movement Speed/i.exec(s)) && sc !== 'other') return { kind: 'perMove', v: num(m[1]) };
    if ((m = new RegExp('(\\d+(?:\\.\\d+)?)%\\[x\\] increased damage (?:per point of|for every 1|for each point of|per) (?:Maximum )?' + RES_WORD + '(?: you have)?(?:, up to (\\d+))?', 'i').exec(s)) && !/Consumed|spent|Spending/i.test(s)) {
      if (sc === 'other') return null;
      const per = { kind: 'perRes', v: num(m[1]), cap: m[3] ? num(m[3]) : 0, res: m[2] };
      // Ramaladni's: "… per point of Fury you have, but 7% Fury Drains per second" – the drain is part of the deal
      const dr = /(\d+(?:\.\d+)?)% (?:\w+ )?Drains per second/i.exec(s);
      return dr ? [per, { kind: 'drain', v: num(dr[1]) }] : per;
    }
    if ((m = /(\d+(?:\.\d+)?)% (?:\w+ )?Drains per second/i.exec(s))) return { kind: 'drain', v: num(m[1]), keep: true };
    // "Blazing Scream is now an Archfiend Skill", "Blood Wave is additionally a Bone Skill", "Your Core Skills are now additionally Basic Skills"
    if ((m = /^(?:Your )?(.+?) (?:is|are) (?:now )?(?:also |additionally )+(?:an? )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) Skills?\b/.exec(s)) || (m = /^(?:Your )?(.+?) (?:is|are) now (?:an? )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) Skills?\b/.exec(s)))
      return triggers(m[1].replace(/ Skills?$/, ''), prof) && !prof.groups.includes(m[2]) ? { kind: 'tag', tag: m[2], v: 0, keep: true } : null;
    if (prof.noun && (m = new RegExp('^' + esc(prof.noun) + "'?s? [Dd]uration is increased by (\\d+(?:\\.\\d+)?) seconds").exec(s))) return { kind: 'durFlat', v: num(m[1]) };
    if ((m = /When you Cast (?:an? )?([^,]+), it Consumes all (?:of )?your (\w+) and deals (\d+(?:\.\d+)?)%\[x\] increased damage per \w+ Consumed/i.exec(s)))
      return triggers(m[1], prof) ? { kind: 'consume', v: num(m[3]), res: m[2] } : null;
    // the older text: "When you cast an Ultimate Skill, your next Core Skill Consumes all of your Energy …"
    if ((m = /When you cast (?:an? )?[^,]+, your next ([A-Za-z ]+?) Consumes all (?:of )?your (\w+) and deals (\d+(?:\.\d+)?)%\[x\] increased damage per \w+ Consumed/i.exec(s)))
      return triggers(m[1], prof) ? { kind: 'consume', v: num(m[3]), res: m[2] } : null;
    if ((m = /^Using a Cooldown restores (\d+(?:\.\d+)?) (\w+)/i.exec(s))) return hasCooldown(prof) ? { kind: 'refill', v: num(m[1]), res: m[2] } : null;
    if ((m = /Casting (?:an? )?([A-Za-z' -]+?) generates (\d+(?:\.\d+)?) (\w+) per Skill Rank/i.exec(s)))
      return triggers(m[1], prof) ? { kind: 'refillRank', v: num(m[2]), res: m[3] } : null;
    if ((m = /Spend (\d+) (\w+) to reduce your ([A-Za-z' ]+?) Skill's Cooldown by (\d+(?:\.\d+)?) seconds/i.exec(s)))
      return triggers(m[3], prof) ? { kind: 'cdSpend', per: num(m[1]), v: num(m[4]), res: m[2] } : null;
    if (prof.noun && (m = new RegExp('^' + esc(prof.noun) + "'?s? Cooldown is reduced by (\\d+(?:\\.\\d+)?) seconds", 'i').exec(s))) return { kind: 'cdFlat', v: num(m[1]) };
    if ((m = /^Casting (?:an? )?([A-Za-z' -]+?) (?:increases your damage by|grants (?:you )?) ?(\d+(?:\.\d+)?)%\[x\] (?:increased damage )?for (\d+(?:\.\d+)?) seconds/i.exec(s)))
      return hasCooldown(prof) && triggers(m[1], prof) ? { kind: 'burst', v: num(m[2]), dur: num(m[3]) } : null;
    if ((m = /Maximum (Energy|Fury|Mana|Essence|Spirit|Vigor|Faith|Resource) is increased by (\d+)/i.exec(s))) return { kind: 'maxres', v: num(m[2]) };
    // Melted Heart of Selig: "Your Primary Resource is increased by 100% but your Maximum Life is reduced by 75%"
    if ((m = /Primary Resource is increased by (\d+(?:\.\d+)?)%/i.exec(s))) {
      const life = /Maximum Life is reduced by (\d+(?:\.\d+)?)%/i.exec(s);
      return { kind: 'maxresPct', v: num(m[1]), life: life ? -num(life[1]) : 0 };
    }
    return null;
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
      // the build's mechanics – what happens when the main skill is cast (see cycle)
      const mech = mechanicOf(s, prof, sc);
      // its trigger is the main skill (checked there) – no condition left to switch on
      if (mech) {
        const list = [].concat(mech);
        for (const x of list) out.push(Object.assign({ cond: x.useCond ? cond : [], scope: 'skill', text: s }, x));
        if (!list.some((x) => x.keep)) continue;
      }
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
      // Cast Speed has a cap of its own (maxroll: two caps of 100%, "…Attack Speed" and "…Cast Speed")
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?Cast Speed|Cast Speed (is )?(increased )?by (\d+(\.\d+)?)%\[\+\]/i.exec(s))) { add('cs', num(m[1] || m[6])); continue; }
      if ((m = /(\d+(\.\d+)?)%(?:\[\+\])? (increased )?(Damage Reduction|less damage)/i.exec(s)) || (m = /Damage Reduction (by|of) (\d+(\.\d+)?)%/i.exec(s))) {
        const v = m[2] && /\d/.test(m[2]) && !m[1] ? num(m[2]) : num(m[1]);
        const max = /up to (\d+(\.\d+)?)% (maximum|Damage Reduction)/i.exec(s);
        // "Basic Skills grant 35% Damage Reduction": only while a skill of that group is used – the bar decides
        const by = /^(?:Your )?([A-Z][a-z]+(?: [A-Z][a-z]+)?) Skills (?:grant|give)/.exec(s);
        const need = by && SKILL_GROUPS.includes(by[1]) && !prof.groups.includes(by[1]) ? ['uses:' + by[1]] : [];
        out.push({ kind: 'dr', v: max ? num(max[1]) : v, cond: cond.concat(need), scope: 'all', text: s });
        continue;
      }
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?(Total )?Armor/i.exec(s))) { out.push({ kind: 'armor', v: num(m[1]), cond, scope: 'all', text: s }); continue; }
      if ((m = /Maximum Life (is )?increased by (\d+(\.\d+)?)%/i.exec(s))) { out.push({ kind: 'life', v: num(m[2]), cond, scope: 'all', text: s }); continue; }
      // separate multipliers – the core of it
      if ((m = /(\d+(\.\d+)?)%\[x\] (increased |more )?(damage|[A-Za-z ]* damage)/i.exec(s)) || (m = /damage (is )?(increased )?by (\d+(\.\d+)?)%\[x\]/i.exec(s))
        || (m = /take (\d+(\.\d+)?)%\[x\] (increased )?damage/i.exec(s)) || (m = /(\d+(\.\d+)?)%\[x\] more damage/i.exec(s))) {
        const v = stacks ? num(stacks[1]) : num(m[1] && /\d/.test(m[1]) ? m[1] : m[3]);
        if (/Movement Speed|Lucky Hit Chance|Attack Speed/i.test(m[0])) continue;
        // "alternating randomly between 2 sets" of damage types: yours gets it half the time
        const sets = /alternating randomly between (\d+) sets/i.exec(String(text));
        add('x', sets ? v / num(sets[1]) : v, Object.assign(stacks ? { upTo: true } : {}, sets ? { note: 'on average – it alternates between ' + sets[1] + ' sets' } : {}));
        continue;
      }
      if (/Resistance|Movement Speed|Size|Duration|Lucky Hit Chance/i.test(s) && !/damage/i.test(s.replace(/damage type/gi, ''))) continue;
      if ((m = /(\d+(\.\d+)?)%\[\+\] (increased )?((?:[A-Z][a-z]+ ){0,2})damage/.exec(s)) && !/Resistance/.test(m[0])) { add('add', num(m[1])); continue; }
      if ((m = /(\d+(\.\d+)?)% increased ((?:[A-Z][a-z]+ ){0,2})damage/.exec(s)) && !/Damage Reduction/i.test(s)) { add('add', num(m[1]), { unsure: true }); continue; }
      if (/(makes?|are|become) (them |enemies )?Vulnerable|inflicts? Vulnerable|also Vulnerable/i.test(s)) { add('vuln', 1); continue; }
      if ((m = /Cooldowns? (is |are )?reduced by (\d+(\.\d+)?)%|(\d+(\.\d+)?)% Cooldown Reduction/i.exec(s))) { add('cdr', num(m[2] || m[4])); continue; }
      if (/\bdeal(s|ing)? (#|\d[\d,.]*%?) (\w+ )?damage\b|explodes?|Summon an Ancient|launch|unleash(es)? a Rank|Crushing Blow|creates? an? \w+ that deals/i.test(s)) { add('proc', 0); continue; }
    }
    // "Lucky Hit: Up to a 45% chance …" – it happens on a hit with the skill's Lucky Hit Chance × this chance
    for (const e of out) {
      const lm = /^Lucky Hit:[^.]*?up to (?:an? )?(\d+(?:\.\d+)?)% chance/i.exec(e.text || '');
      if (lm) e.lucky = num(lm[1]);
    }
    return out;
  }

  /** How often a Lucky Hit effect happens: skill Lucky Hit Chance × the effect's chance (null: the skill's is unknown). */
  // skill Lucky Hit Chance × (1 + Lucky Hit Chance from gear, summed) × the effect's chance (maxroll "Stats for Beginners")
  const luckyOdds = (st, e) => (e.lucky != null && st.lhc != null ? Math.min(1, (st.lhc / 100) * (1 + (st.lhcBonus || 0) / 100) * (e.lucky / 100)) : 1);

  /** A starting point for the model: the game's own base values; the rest comes from the gear in the plan. */
  function baseState(per10) {
    return { w: 1, skill: 100, rank: 1, stat: 0, per10: per10 || 1.25, add: 0, bucket: 0, sep: [], crit: 5, ccMul: 1, csdp: 0, csdx: 0, cdxSep: 1,
      vulnUp: 0, vulnx: 0, dotx: 0, op: 0, as: 0, cdr: 0, limit: 'none', dot: false, dr: [], life: 0, armorPct: 0,
      // speed: movement speed in %, and whether evade became a teleport (Enigma); more damage taken from drawbacks
      move: 0, teleport: false, taken: 0,
      // souls held (Splinter of the Black Soulstone) – the player sets it; half the cap until then
      souls: 100,
      // the main skill's Lucky Hit Chance in % (d2core's skill text) – null while unknown, then Lucky Hit effects count whole
      lhc: null,
      // defence ratings (see toughness) and the class's main stat, which feeds them
      armor: 0, resAll: 0, res: {}, dodge: [], mainStat: '',
      // the main skill's cooldown and cost in seconds / points (d2core's skill text), the pool it draws
      // from (every class starts at 100) and the mechanics around it (see mechanicOf, cycle)
      cd: 0, cost: 0, maxRes: 100, mech: {},
      // the resource budget (see sustain): cost per second for a channeled skill, the generator on
      // the bar (per cast), regeneration per second from gear and the player's own base value,
      // Resource Generation and Cost Reduction in %, drains (% of the pool a second), Lucky Hit restores
      costPerSec: false, gen: 0, regen: 0, baseRegen: 0, resGen: 0, rcr: 0, drainPct: 0, lhRes: [], freeCast: false,
      // the other skills on the bar and what takes seconds off whose cooldown (see chainTimes)
      bar: [], chains: [] };
  }

  /** How fast the build moves through a map – movement speed, a teleporting evade counts like +30%. */
  function speed(st) {
    return Math.max(0.2, 1 + (st.move + (st.teleport ? 30 : 0)) / 100);
  }

  /** The effects that waited for their uptime (see apply), now counted by it. */
  // damage() and toughness() of the same state resolve it once
  const resolved = new WeakMap();
  function resolve(st) {
    if (!st.pending || !st.pending.length) return st;
    const hit = resolved.get(st);
    if (hit) return hit;
    const up = uptimes(st, null);
    let s = Object.assign(cloneState(st), { pending: [] });
    for (const p of st.pending) {
      const share = p.ups.reduce((a, c) => a * (up[c] == null ? 1 : up[c]), p.share);
      if (share <= 0) continue;
      const e = Object.assign({}, p.e, p.e.v ? { v: p.e.v * share } : {}, p.e.kind === 'vuln' ? { share } : {});
      s = apply(s, e, p.on, true);
    }
    resolved.set(st, s);
    return s;
  }

  /** Average damage per hit (and per second when casts are limited by speed or cooldowns). */
  function damage(st0) {
    const st = resolve(st0);
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
    const cy = cycle(st);
    const mech = cy.consumeX * cy.perResX * cy.bursts.reduce((a, b) => a * (1 + b.v * b.up / 100), 1);
    // a cooldown skill with a known cooldown: casts per base cooldown, as the cycle plays out – one
    // that lasts: the share of the time it is up against that share at the base cooldown
    const rate = st.limit === 'speed' ? (1 + Math.min(100, st.as) / 100 + Math.min(100, st.cs || 0) / 100) * cy.sus.share
      : st.limit === 'cooldown' ? (st.cd > 0 ? (cy.dur > 0 ? cy.up / Math.min(1, cy.dur / st.cd) : st.cd / cy.interval) : 1 / (1 - Math.min(0.95, st.cdr / 100))) : 1;
    return { hit: hit * mech, dps: hit * mech * rate, f: { base, stat, A, bucket, sep, chance, critF, critAvg, vulnF, vulnAvg, dotF, rate, mech }, cycle: cy };
  }

  // one cast at no attack or cast speed, in seconds – assumed: the game data lists no animation lengths
  const CAST_S = 1;

  /**
   * The resource budget of a spender: what casting it non-stop costs a second against what comes
   * in – regeneration (gear, buffs, and the base value the player reads off the character sheet;
   * the game data has none), Lucky Hit restores, all raised by Resource Generation – less Cost
   * Reduction, plus drains (Ramaladni's 7% a second). Short of it, the generator on the bar fills
   * the gap: the spender is cast for the share m of the time where
   *   m × spend = (1 − m) × generator + income   →   m = (generator + income) / (spend + generator)
   * Without a generator it is income / spend.
   * The base regeneration is not in the game data. Until the player enters theirs, it is taken to
   * pay for the skill at its base rate – one cast a second at its full cost (no speed, no Cost
   * Reduction): what the gear adds on top (attack speed, drains) has to be paid by the gear.
   */
  function sustain(st) {
    const maxRes = Math.max(1, (st.maxRes || 100) * (1 + (st.maxResPct || 0) / 100));
    const speedF = 1 + Math.min(100, st.as) / 100 + Math.min(100, st.cs || 0) / 100;
    const casts = speedF / CAST_S;
    const each = st.freeCast ? 0 : (st.cost || 0) * (1 - Math.min(95, st.rcr || 0) / 100);
    const spend = (st.costPerSec ? each : each * casts) + (st.drainPct || 0) / 100 * maxRes;
    const mul = 1 + (st.resGen || 0) / 100;
    const lh = (st.lhRes || []).reduce((a, r) => a + r.v * luckyOdds(st, { lucky: r.chance }), 0) * casts;
    const assumed = !(st.baseRegen > 0);
    const base = assumed ? (st.freeCast ? 0 : (st.cost || 0) / (st.costPerSec ? 1 : CAST_S)) : st.baseRegen;
    const income = ((st.regen || 0) + base) * mul + lh * mul;
    const gen = st.gen > 0 ? st.gen * casts * mul : 0;
    const share = spend <= income + 1e-9 ? 1 : Math.max(0, Math.min(1, (gen + income) / (spend + gen)));
    return { spend, income, gen, share, active: spend > 0, base, assumed };
  }

  /**
   * Cooldown chains: every skill with a cooldown, cast whenever it is ready, with the seconds other
   * casts take off it – Aspect of Apogeic Furor's "Casting an Ultimate Skill reduces the Cooldowns
   * of your other Skills by 10 seconds", Synergy's "and vice versa". Skill i comes back every
   *   T_i = base_i / (1 + Σ_j r_ji / T_j)   (base_i its cooldown after Cooldown Reduction)
   * – in T_i seconds skill j is cast T_i / T_j times, each taking r_ji off. Played to a fixed point.
   * @param main  { name, groups, every } – the main skill and how often it is cast (seconds)
   * @returns name -> seconds between casts
   */
  const whoMatches = (who, sk, self) => {
    if (who === 'any') return true;
    if (who === 'other') return !self;
    if (who === 'main') return !!sk.main;
    const w = who.replace(/^one:/, '');
    if (w === 'any') return true;
    return sk.name.toLowerCase() === w.toLowerCase() || (sk.groups || []).some((g) => g.toLowerCase() === w.toLowerCase());
  };
  function chainTimes(st, main0) {
    const cdr = Math.min(95, st.cdr) / 100;
    const cast = CAST_S / (1 + Math.min(100, st.as) / 100 + Math.min(100, st.cs || 0) / 100);
    // the main skill as a source: a spender is cast as fast as the hands go, a cooldown skill every cooldown
    const main = main0 || (st.mainName ? { name: st.mainName, groups: st.mainGroups || [], every: st.limit === 'speed' ? cast : Math.max(cast, (st.cd || 1e9) * (st.noCdr ? 1 : 1 - cdr)) } : null);
    if (main) main.main = true;
    const skills = (st.bar || []).filter((b) => b.cd > 0);
    const all = skills.concat(main ? [main] : []);
    const T = {};
    for (const b of skills) T[b.name] = Math.max(cast, b.cd * (b.noCdr ? 1 : 1 - cdr));
    // no chains: every skill comes back after its own cooldown – nothing to play through
    if (!(st.chains || []).length) return { T, cast };
    const every = (sk) => (main && sk === main ? main.every : T[sk.name] || Infinity);
    for (let it = 0; it < 40; it++) {
      for (const b of skills) {
        const base = b.cd * (b.noCdr ? 1 : 1 - cdr);
        let pull = 0;
        for (const c of st.chains || []) {
          // "one of your Skills": the seconds spread over every skill it could be
          const pool = c.to.startsWith('one:') || /^one/.test(c.to) ? Math.max(1, skills.filter((x) => whoMatches(c.to, x, false)).length) : 1;
          if (!whoMatches(c.to, b, false)) continue;
          for (const j of all) {
            if (j === b || !whoMatches(c.from, j, j === b)) continue;
            // a percentage takes that share of what is left – on average half the cooldown; a Lucky Hit chain happens that often
            const r = ((c.v || 0) / pool + (c.pct ? c.pct / 100 * T[b.name] / 2 : 0)) * (c.lucky ? luckyOdds(st, { lucky: c.lucky }) : 1);
            pull += r / Math.max(cast, every(j));
          }
        }
        T[b.name] = Math.max(cast, base / (1 + pull));
      }
    }
    return { T, cast };
  }

  /**
   * How much of the time each buff from the bar is up: a skill without a cooldown is there when
   * needed; one with a cooldown is up its buff's seconds out of every T (chainTimes).
   * @returns condition -> share 0–1 (the best skill that gives it)
   */
  function uptimes(st, main) {
    const { T } = chainTimes(st, main);
    const out = {};
    for (const b of st.bar || []) {
      for (const [c, d] of Object.entries(b.gives || {})) {
        const up = !(b.cd > 0) ? 1 : Math.min(1, d / T[b.name]);
        out[c] = Math.max(out[c] || 0, up);
      }
    }
    return out;
  }
  /**
   * The main skill's loop, cast after cast: what a cast spends, what that takes off the cooldown,
   * what comes back, and how long until the next cast. Between two casts that wait on a cooldown
   * the pool counts as full again; when the loop runs without waiting, only what the casts give
   * back refills it. Played through a dozen casts and averaged, so a loop that only holds every
   * other cast shows as that.
   * The breakpoints it needs (Rain of Arrows: Beastfall Boots + Preparation + Aspect of Aftermath):
   *   pool  – enough spent to take the whole cooldown off: per × ⌈cooldown / seconds per spend⌉
   *   cdr   – the cooldown short enough for a full pool to clear it
   *   rank  – the refill per rank fills that pool again
   */
  function cycle(st) {
    const m = st.mech || {};
    const maxRes = Math.max(1, (st.maxRes || 100) * (1 + (st.maxResPct || 0) / 100));
    const cdr = Math.min(95, st.cdr) / 100;
    const cast = CAST_S / (1 + Math.min(100, st.as) / 100 + Math.min(100, st.cs || 0) / 100);
    const raw = st.cd > 0 ? Math.max(0, st.cd - (m.cdFlat || 0)) : 0;
    // "This ritual does not benefit from Cooldown Reduction" (Apocalypse)
    const baseCd = raw * (st.noCdr ? 1 : 1 - cdr);
    const dur = st.dur > 0 ? st.dur + (m.durFlat || 0) : 0;
    const refill = (m.refillRank || 0) * Math.max(1, st.rank) + (m.refill || 0);
    const spendOf = (pool) => (m.consume ? pool : Math.min(pool, st.cost || 0));
    const prepOf = (spent) => (m.cdSpend ? Math.floor(spent / m.cdSpend.per + 1e-9) * m.cdSpend.v : 0);
    // other skills taking seconds off this one's cooldown (chainTimes), as a share of each wait
    const mainSk = { name: st.mainName || '', groups: st.mainGroups || [], every: 1 };
    let pull = 0;
    if (raw > 0 && (st.chains || []).length) {
      const { T } = chainTimes(st, Object.assign({}, mainSk, { every: Math.max(cast, baseCd) }));
      for (const c of st.chains) {
        if (!whoMatches(c.to, mainSk, false) || c.to === 'other') continue;
        for (const j of (st.bar || []).filter((b) => b.cd > 0)) if (whoMatches(c.from, j, false)) pull += (c.v || 0) / T[j.name];
      }
    }
    const N = 12;
    let pool = maxRes, t = 0, x = 0, spentSum = 0, waits = 0;
    for (let i = 0; i < N; i++) {
      const spent = spendOf(pool);
      const wait = Math.max(cast, (baseCd - prepOf(spent)) / (1 + pull));
      x += m.consume ? 1 + m.consume * spent / 100 : 1;
      spentSum += spent; t += wait;
      if (wait > cast + 1e-9) waits++;
      pool = wait > cast + 1e-9 ? maxRes : Math.min(maxRes, pool - spent + refill);
    }
    const interval = st.cd > 0 ? t / N : 0;
    // a skill that lasts (Cataclysm follows you for 8 seconds): it does its damage while it is up –
    // casting it again before it ends adds nothing, so its rate is the share of the time it is up
    const up = dur > 0 && interval > 0 ? Math.min(1, dur / interval) : 0;
    // the pool held – assumed full (Ramaladni's Fury drains, but builds keep it near the top)
    // a free cast for every so much spent (formsPer): the casts it pays for on top
    const each = st.freeCast ? 0 : (st.cost || 0) * (1 - Math.min(95, st.rcr || 0) / 100);
    const formsX = m.formsPer && each > 0 ? 1 + each / m.formsPer : 1;
    const perResX = formsX * (m.perRes || []).reduce((a, p) => a * (1 + p.v * Math.min(p.cap || Infinity, maxRes) / 100), 1);
    const bursts = (m.bursts || []).map((b) => ({ v: b.v, dur: b.dur, up: interval > 0 ? Math.min(1, b.dur / interval) : 1 }));
    // breakpoints – only for a loop that has them
    const checks = [];
    if (dur > 0 && raw > 0 && !st.noCdr && dur < raw) checks.push({ id: 'uptime', have: st.cdr, need: Math.max(0, (1 - dur / raw) * 100), ok: baseCd <= dur + 1e-9 });
    if (m.cdSpend && raw > 0) {
      const sec = m.cdSpend.v, per = m.cdSpend.per;
      const needPool = per * Math.ceil(baseCd / sec - 1e-9);
      const full = prepOf(m.consume ? maxRes : Math.min(maxRes, st.cost || 0));
      checks.push({ id: 'pool', have: maxRes, need: needPool, ok: maxRes >= needPool });
      checks.push({ id: 'cdr', have: st.cdr, need: Math.max(0, (1 - full / raw) * 100), ok: baseCd <= full + 1e-9 });
      if (m.refillRank) {
        const target = Math.min(maxRes, Math.max(needPool, per));
        const needRank = Math.ceil((target - (m.refill || 0)) / m.refillRank - 1e-9);
        checks.push({ id: 'rank', have: st.rank, need: needRank, ok: st.rank >= needRank });
      }
    }
    // the budget of a spender and the breakpoint where it pays for itself
    const sus = st.limit === 'speed' ? sustain(st) : { share: 1, active: false };
    if (sus.active) checks.push({ id: 'sustain', have: sus.income, need: sus.spend, ok: sus.income >= sus.spend - 1e-9 });
    // the skills on the bar that should always be up
    if ((st.bar || []).length) {
      const { T } = chainTimes(st, raw > 0 ? Object.assign({}, mainSk, { every: Math.max(cast, t / N || cast) }) : null);
      for (const b of st.bar) {
        if (!(b.cd > 0) || !(b.dur > 0) || b.noCdr || b.dur >= b.cd) continue;
        const need = Math.max(0, (1 - b.dur / b.cd) * 100);
        if (need > 95) continue;
        checks.push({ id: 'barUp', skill: b.name, have: st.cdr, need, ok: T[b.name] <= b.dur + 1e-9 });
      }
    }
    return { cd: st.cd, raw, baseCd, cast, interval, spent: spentSum / N, maxRes, refill, consumeX: x / N, bursts, spam: st.cd > 0 && waits === 0, checks, dur, up, perResX, sus, pull };
  }

  /**
   * The loop in words, for the player: which piece does what, what it adds up to, and the
   * breakpoints with what the build has against what it needs.
   * @param sources  [{ name, effects }] – the pieces, passives and modifiers in the build
   * @param names    { skill: 'Rain of Arrows', res: 'Energy' }
   * @returns null when the build has no loop to speak of
   */
  function loop(st, sources, names) {
    const KINDS = ['consume', 'refill', 'refillRank', 'cdSpend', 'cdFlat', 'burst', 'maxres', 'maxresPct', 'perRes', 'tag', 'durFlat'];
    const used = (sources || []).map((s) => ({ name: s.name, fx: (s.effects || []).filter((e) => KINDS.includes(e.kind)) })).filter((s) => s.fx.some((e) => e.kind !== 'maxres'));
    const cy = cycle(st);
    if (!used.length && !cy.checks.length && !(cy.dur > 0 && cy.raw > 0) && !cy.sus.active && !(st.bar || []).some((b) => b.cd > 0)) return null;
    const res = (names && names.res) || 'Resource';
    const sk = (names && names.skill) || 'the skill';
    const r1 = (v) => (Math.round(v * 10) / 10).toString();
    const lines = [];
    const by = (kind) => used.filter((s) => s.fx.some((e) => e.kind === kind));
    const fx = (s, kind) => s.fx.find((e) => e.kind === kind);
    for (const s of by('consume')) lines.push(s.name + ': every cast spends the whole pool – ' + Math.round(cy.spent) + ' ' + res + ' on average × ' + fx(s, 'consume').v + '%[x] = ×' + cy.consumeX.toFixed(2) + ' damage.');
    for (const s of by('cdSpend')) { const e = fx(s, 'cdSpend'); const n = Math.floor(cy.maxRes / e.per + 1e-9); lines.push(s.name + ': every ' + e.per + ' ' + res + ' spent takes ' + e.v + ' s off the cooldown – a full pool of ' + Math.round(cy.maxRes) + ' takes ' + (n * e.v) + ' s off.'); }
    const refills = by('refillRank').map((s) => s.name + ' ' + fx(s, 'refillRank').v + ' per rank × ' + st.rank + ' ranks').concat(by('refill').map((s) => s.name + ' ' + fx(s, 'refill').v));
    if (refills.length) lines.push('Back on every cast: ' + Math.round(cy.refill) + ' ' + res + ' (' + refills.join(', ') + ').');
    for (const s of by('cdFlat')) lines.push(s.name + ': ' + fx(s, 'cdFlat').v + ' s shorter cooldown.');
    for (const s of by('tag')) lines.push(s.name + ': ' + sk + ' counts as a ' + fx(s, 'tag').tag + ' Skill too – every ' + fx(s, 'tag').tag + ' bonus works on it.');
    for (const s of by('perRes')) { const e = fx(s, 'perRes'); const n = Math.min(e.cap || Infinity, cy.maxRes); lines.push(s.name + ': ' + e.v + '%[x] per point of ' + res + ' held – at ' + Math.round(n) + ' that is ×' + (1 + e.v * n / 100).toFixed(2) + ' (counted at a full pool).'); }
    for (const s of by('durFlat')) lines.push(s.name + ': ' + sk + ' lasts ' + fx(s, 'durFlat').v + ' s longer.');
    if (cy.dur > 0 && cy.raw > 0) lines.push(sk + ' lasts ' + r1(cy.dur) + ' s – it is up ' + Math.round(cy.up * 100) + '% of the time' + (cy.up >= 1 ? '; more Cooldown Reduction adds nothing to it now.' : '.'));
    if (st.noCdr) lines.push(sk + ' does not benefit from Cooldown Reduction.');
    if (cy.pull > 0) lines.push('Other skills take ' + Math.round(cy.pull / (1 + cy.pull) * 100) + '% off ' + sk + "'s cooldown as they are cast.");
    if (cy.sus.active) {
      const r1s = (v) => (Math.round(v * 10) / 10).toString();
      lines.push('Casting ' + sk + ' non-stop costs ' + r1s(cy.sus.spend) + ' ' + res + ' a second; ' + r1s(cy.sus.income) + ' come in (regeneration, restores' + (cy.sus.assumed ? ', a base that pays for one cast a second – enter yours in the field above' : ', your base ' + st.baseRegen) + ')' +
        (cy.sus.share >= 1 ? ' – it pays for itself.' : cy.sus.gen > 0 ? ' – the generator fills the rest: ' + sk + ' is cast ' + Math.round(cy.sus.share * 100) + '% of the time.' : ' – it runs dry: cast ' + Math.round(cy.sus.share * 100) + '% of the time.'));
    }
    const { T } = chainTimes(st, null);
    for (const b of (st.bar || []).filter((x) => x.cd > 0 && Object.keys(x.gives || {}).length)) {
      const d = Math.max(...Object.values(b.gives));
      lines.push(b.name + ' comes back every ' + r1(T[b.name]) + ' s – ' + Object.keys(b.gives).join(', ') + ' up ' + Math.round(Math.min(1, d / T[b.name]) * 100) + '% of the time.');
    }
    if (cy.raw > 0) {
      lines.push('Cooldown: ' + r1(cy.raw) + ' s × (1 − ' + Math.round(st.cdr) + '% Cooldown Reduction) = ' + r1(cy.baseCd) + ' s' +
        (cy.spam ? ' – the ' + res + ' spent clears it: ' + sk + ' is cast back to back, as fast as you cast.' : ' – ' + sk + ' comes back every ' + r1(cy.interval) + ' s on average.'));
    }
    for (const s of by('burst')) for (const e of s.fx.filter((x) => x.kind === 'burst')) {
      const up = cy.interval > 0 ? Math.min(1, e.dur / cy.interval) : 1;
      lines.push(s.name + ': ' + e.v + '%[x] for ' + e.dur + ' s after each cast – up ' + Math.round(up * 100) + '% of the time.');
    }
    const LABEL = { pool: 'Maximum ' + res, cdr: 'Cooldown Reduction', rank: 'Ranks of ' + sk, uptime: 'Cooldown Reduction to keep ' + sk + ' up', sustain: res + ' a second to cast ' + sk + ' non-stop' };
    const checks = cy.checks.map((c) => ({ id: c.id, label: c.id === 'barUp' ? 'Cooldown Reduction to keep ' + c.skill + ' up' : LABEL[c.id], have: c.have, need: c.need, ok: c.ok, unit: c.id === 'cdr' || c.id === 'uptime' || c.id === 'barUp' ? '%' : '' }));
    return { lines, checks, spam: cy.spam, interval: cy.interval, consumeX: cy.consumeX };
  }

  /** How much less damage you take, as effective life: 1 / Π(1 − DR). */
  /**
   * Toughness as maxroll's defence guide (Season 11+) works it out: per damage type, Life over
   * everything that reduces that damage – Armor (all damage), that type's Resistance, every other
   * damage reduction – then the average over the six types. Armor and Resistance are ratings:
   *   DR = R / (R × 10/9 + C), C = 5678 for Armor and 1136 for Resistance at level 70
   * – no hard cap any more, only the 90% the formula approaches. Strength adds 2 Armor a point,
   * Intelligence 0.4 Resistance to all elements. Dodge avoids a hit altogether: 1 − Π(1 − dodge)
   * plus 0.6% per 100 Dexterity, counted on top (the game's own Toughness leaves it out).
   */
  const TYPES = ['Physical', 'Fire', 'Cold', 'Lightning', 'Poison', 'Shadow'];
  const rating = (r, c) => (r > 0 ? r / (r * 10 / 9 + c) : 0);
  function toughness(st0) {
    const st = resolve(st0);
    const others = st.dr.reduce((a, d) => a * (1 - Math.min(90, d) / 100), 1) * (1 + (st.taken || 0) / 100);
    const main = st.mainStat || '';
    const armor = ((st.armor || 0) + (main === 'Strength' ? 2 * st.stat : 0)) * (1 + (st.armorPct || 0) / 100);
    const resAll = (st.resAll || 0) + (main === 'Intelligence' ? 0.4 * st.stat : 0);
    const armorTaken = 1 - rating(armor, 5678);
    let sum = 0;
    for (const t of TYPES) sum += 1 / (armorTaken * (1 - rating(resAll + ((st.res || {})[t] || 0), 1136)) * others);
    const dodge = 1 - (st.dodge || []).reduce((a, d) => a * (1 - d / 100), 1) + (main === 'Dexterity' ? 0.006 * st.stat / 100 : 0);
    return (1 + st.life / 100) * (sum / TYPES.length) / (1 - Math.min(0.9, dodge));
  }

  /** Puts a parsed effect into a state (when it applies and its conditions are on). */
  // mut: st is a private working copy (cloneState) and is changed in place – stateOf adds a dozen pieces that way
  const cloneState = (st) => Object.assign({}, st, { sep: st.sep.slice(), dr: st.dr.slice() });
  function apply(st, e, on, mut) {
    // Vulnerable helps every hit, whichever skill or side effect applies it
    if (e.scope === 'other' && e.kind !== 'vuln') return st;
    // a condition is on, off – or up for a share of the time (a buff from a skill on a cooldown, see uptimes)
    let share = 1;
    const ups = [];
    for (const c of e.cond) { const v = on[c]; if (!v) return st; if (v === 'up') ups.push(c); else if (typeof v === 'number' && v < 1) share *= v; }
    // up while a skill on the bar keeps it up – how much of the time is known only once the whole
    // state is (Cooldown Reduction, chains): kept aside and counted in damage() and toughness()
    if (ups.length) {
      const pending = (st.pending || []).concat({ e: Object.assign({}, e, { cond: e.cond.filter((c) => !ups.includes(c)) }), ups, share, on });
      if (mut) { st.pending = pending; return st; }
      return Object.assign({}, st, { pending });
    }
    if (share < 1 && e.v) e = Object.assign({}, e, { v: e.v * share });
    if (share < 1 && e.kind === 'vuln') e = Object.assign({}, e, { share });
    // a per-hit Lucky Hit bonus counts as often as it happens; Vulnerable lasts seconds, so it stays whole
    if (e.lucky != null && e.kind !== 'vuln' && e.v) {
      const odds = luckyOdds(st, e);
      if (odds < 1) e = Object.assign({}, e, { v: e.v * odds, lucky: null });
    }
    const s = mut ? st : cloneState(st);
    switch (e.kind) {
      case 'x': s.sep.push(e.v); break;
      case 'add': s.add += e.v; break;
      case 'cc': s.crit += e.v; break;
      case 'ccx': s.ccMul *= 1 + e.v / 100; break;
      case 'cdx': s.cdxSep *= 1 + e.v / 100; break;
      case 'as': s.as += e.v; break;
      case 'cs': s.cs = (s.cs || 0) + e.v; break;
      case 'cdr': s.cdr = 100 - (100 - s.cdr) * (1 - e.v / 100); break;
      case 'rank': s.rank += e.v; break;
      case 'vuln': s.vulnUp = Math.max(s.vulnUp, 100 * (e.share || 1)); break;
      case 'dr': s.dr.push(e.v); break;
      case 'life': s.life += e.v; break;
      case 'armor': s.armorPct += e.v; break;
      case 'move': s.move += e.v; break;
      case 'teleport': s.teleport = true; break;
      case 'taken': s.taken = (s.taken || 0) + e.v; break;
      case 'consume': case 'refill': case 'refillRank': case 'cdFlat': case 'durFlat':
        s.mech = Object.assign({}, st.mech, { [e.kind]: ((st.mech || {})[e.kind] || 0) + e.v }); break;
      case 'cdSpend': s.mech = Object.assign({}, st.mech, { cdSpend: { per: e.per, v: e.v } }); break;
      case 'burst': s.mech = Object.assign({}, st.mech, { bursts: ((st.mech || {}).bursts || []).concat({ v: e.v, dur: e.dur }) }); break;
      case 'maxres': s.maxRes = (s.maxRes || 100) + e.v; break;
      case 'maxresPct': s.maxResPct = (s.maxResPct || 0) + e.v; s.life += e.life || 0; break;
      case 'formsPer': s.mech = Object.assign({}, st.mech, { formsPer: (st.mech || {}).formsPer ? Math.min(st.mech.formsPer, e.v) : e.v }); break;
      case 'perRes': s.mech = Object.assign({}, st.mech, { perRes: ((st.mech || {}).perRes || []).concat({ v: e.v, cap: e.cap }) }); break;
      case 'tag': s.tags = (st.tags || []).concat(e.tag); break;
      case 'cdChain': s.chains = (st.chains || []).concat({ from: e.from, to: e.to, v: e.v, pct: e.pct || 0, lucky: e.luckyChain || 0 }, e.back ? [{ from: e.to, to: e.from, v: e.v, pct: e.pct || 0 }] : []); break;
      case 'drain': s.drainPct = (st.drainPct || 0) + e.v; break;
      case 'regen': s.regen = (st.regen || 0) + e.v; break;
      case 'freeCast': s.freeCast = true; break;
      case 'lhRes': s.lhRes = (st.lhRes || []).concat({ v: e.v, chance: e.chance }); break;
      case 'perMove': s.sep.push(e.v * Math.max(0, s.move) / 100); break;
      case 'xper': s.sep.push(e.v * Math.min(e.max, s.souls == null ? 100 : s.souls)); break;
      case 'takenper': s.taken = (s.taken || 0) + e.v * Math.min(e.max, s.souls == null ? 100 : s.souls); break;
      // a fixed stat line on a unique or a rolled affix ("+[2 - 3] to Whirlwind", "x200% Critical Strike Damage Multiplier")
      case 'roll': return applyRoll(s, e, true);
      default: break;
    }
    return s;
  }

  const LIFE_BASE = 1526;          // base Life at level 70 (maxroll defence guide)
  const top = (d) => { const m = String(d).match(/\[([\d.,]+)\s*-\s*([\d.,]+)\]/); return m ? num(m[2]) : (String(d).match(/[\d.,]+/) ? num(String(d).match(/[\d.,]+/)[0]) : 0); };

  /**
   * Tempering lines and their likes – additive [+] bonuses, some only now and then:
   * "+[30 - 50]% Critical Strike Damage", "+[20 - 40]% Vulnerable Damage", "+[20 - 40]% Marksman
   * Damage", "+[20 - 40]% Damage to Distant Enemies", "[20 - 22.5]% Rain of Arrows Cooldown Reduction",
   * "Casting Ultimate Skills Restores +[10 - 18] Primary Resource".
   * @returns { k, v, cond? } – { } for a line it knows does nothing here – null for a line it leaves to rollOf
   */
  function temperOf(t, v, prof) {
    const NONE = {};
    const ours = (g) => prof.groups.includes(g) || (prof.noun && g.toLowerCase() === prof.noun.toLowerCase()) || g === prof.el;
    const known = (g) => SKILL_GROUPS.includes(g) || ELEMENTS.includes(g) || ['Imbued', 'Shade', 'Agility', 'Grenade', 'Trap'].includes(g) || (prof.otherSkills || []).includes(g) || (prof.noun && g === prof.noun);
    let m;
    if ((m = /^Casting (\w+) Skills Restores \+?\[?[\d.,\s-]+\]? Primary Resource$/.exec(t))) return ours(m[1]) && hasCooldown(prof) ? { k: 'refill', v } : NONE;
    if ((m = /^\[?[\d.\s-]+\]?% (.+) Cooldown Reduction$/.exec(t))) return known(m[1]) ? (ours(m[1]) ? { k: 'cdr', v } : NONE) : null;
    if (/^\+\d+ All Stats$/.test(t)) return { k: 'stat', v };
    if (!(m = /^\+\[?[\d.,\s-]+\]?% (.+)$/.exec(t))) return null;
    const w = m[1];
    if (w === 'Damage') return { k: 'add', v };
    if (w === 'Critical Strike Damage') return { k: 'csdp', v };
    if (w === 'Vulnerable Damage') return { k: 'add', v, cond: ['vulnerable'] };
    if (w === 'Damage Over Time') return prof.dot ? { k: 'add', v } : NONE;
    const to = /^Damage (?:to|while|against) (.+)$/.exec(w);
    if (to) {
      const c = CONDITIONS.filter(([, , re]) => re.test(to[1]) || re.test(to[1].replace(/ Enemies$/, ' enemies'))).map(([id]) => id);
      return { k: 'add', v, cond: c.length ? c : ['?' + w] };
    }
    if ((m = /^(.+) (Damage|Critical Strike Chance|Attack Speed)$/.exec(w)) && known(m[1])) {
      if (!ours(m[1])) return NONE;
      return { k: m[2] === 'Damage' ? 'add' : m[2] === 'Attack Speed' ? 'as' : 'crit', v };
    }
    return null;
  }

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
    const tp = temperOf(t, v, prof);
    if (tp) return tp.k ? tp : null;
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
    // "+[100 - 121] Dexterity" from the data, "151.3 Dexterity" from an imported build
    if (prof.mainStat && new RegExp('^\\+?\\[?[\\d.,\\s-]+\\]? (' + prof.mainStat + '|All Stats)$').test(t)) return { k: 'stat', v };
    if (/Attack Speed$/.test(t) && !/for \d/.test(t)) return { k: 'as', v };
    if (/^\[?[\d.\s-]+\]?% Cooldown Reduction$/.test(t)) return { k: 'cdr', v };
    if (/^\+\[?[\d.,\s-]+\]? Maximum Life$/.test(t)) return { k: 'lifeFlat', v };
    if (/% Maximum Life$/.test(t)) return { k: 'life', v };
    if (/% Damage Reduction$/.test(t)) return { k: 'dr', v };
    // defence ratings – Armor, Resistances – and dodge
    if (/^\+?\[?[\d.,\s-]+\]? Armor$/.test(t)) return { k: 'armorFlat', v };
    if (/^\+?\[?[\d.,\s-]+\]?% Total Armor$/.test(t)) return { k: 'armorPct', v };
    if (/Resistance to All Elements$/.test(t)) return { k: 'resAll', v };
    const rs = t.match(/^\+?\[?[\d.,\s-]+\]? (Physical|Fire|Cold|Lightning|Poison|Shadow) Resistance$/);
    if (rs) return { k: 'res', v, el: rs[1] };
    if (/% Dodge Chance$/.test(t)) return { k: 'dodge', v };
    // speed: Enigma's "+45% Movement Speed", boots
    if (/^\+?\[?[\d.,\s-]+\]?% Movement Speed$/.test(t)) return { k: 'move', v };
    if (/^\+?\[?[\d.,\s-]+\]?% Lucky Hit Chance$/.test(t)) return { k: 'lhcb', v };
    if (/^\+?\[?[\d.,\s-]+\]? Maximum (Resource|Energy|Fury|Mana|Essence|Spirit|Vigor|Faith)$/.test(t)) return { k: 'maxres', v };
    // the resource budget: "+[3 - 4] Fury Regeneration", "[11.0 - 15.0]% Resource Generation", "[6.0 - 7.0]% Resource Cost Reduction"
    if (/^\+?\[?[\d.,\s-]+\]? (Energy|Fury|Mana|Essence|Spirit|Vigor|Faith|Wrath|Primary Resource|Resource) Regeneration(?: per Second)?$/.test(t)) return { k: 'regen', v };
    if (/^\[?[\d.\s-]+\]?% Resource Generation$/.test(t)) return { k: 'resgen', v };
    if (/^\[?[\d.\s-]+\]?% Resource Cost Reduction$/.test(t)) return { k: 'rcr', v };
    const lr = /^Lucky Hit: Up to a (\d+(?:\.\d+)?)% Chance to Restore \+?\[?[\d.,\s-]+\]? Primary Resource$/i.exec(t);
    if (lr) return { k: 'lhres', v, chance: num(lr[1]) };
    // runeword shields: "+100% Main Hand Weapon Damage" – the base every hit scales from
    if (/% Main Hand Weapon Damage$/.test(t)) return { k: 'wpct', v };
    return null;
  }

  function applyRoll(st, r, mut) {
    const s = mut ? st : cloneState(st);
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
      case 'move': s.move += r.v; break;
      case 'lhcb': s.lhcBonus = (s.lhcBonus || 0) + r.v; break;
      case 'maxres': s.maxRes = (s.maxRes || 100) + r.v; break;
      case 'add': s.add += r.v; break;
      case 'csdp': s.csdp += r.v; break;
      case 'regen': s.regen = (st.regen || 0) + r.v; break;
      case 'resgen': s.resGen = (st.resGen || 0) + r.v; break;
      case 'rcr': s.rcr = 100 - (100 - (st.rcr || 0)) * (1 - r.v / 100); break;
      case 'lhres': s.lhRes = (st.lhRes || []).concat({ v: r.v, chance: r.chance }); break;
      case 'refill': s.mech = Object.assign({}, st.mech, { refill: ((st.mech || {}).refill || 0) + r.v }); break;
      case 'armorFlat': s.armor = (s.armor || 0) + r.v; break;
      case 'armorPct': s.armorPct = (s.armorPct || 0) + r.v; break;
      case 'resAll': s.resAll = (s.resAll || 0) + r.v; break;
      case 'res': s.res = Object.assign({}, s.res, { [r.el]: ((s.res || {})[r.el] || 0) + r.v }); break;
      case 'dodge': s.dodge = (s.dodge || []).concat(r.v); break;
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

  const api = { rankValue, parseEffects, baseState, cloneState, damage, cycle, loop, sustain, chainTimes, uptimes, resolve, toughness, speed, apply, applyRoll, rollOf, worth, CONDITIONS, SKILL_GROUPS, LIFE_BASE };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DmgModel = api;
})(typeof window !== 'undefined' ? window : globalThis);
