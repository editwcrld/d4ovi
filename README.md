# D4 Overlay

[![Download here](https://img.shields.io/badge/Download%20here-latest%20release-c8322b?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/editwcrld/d4ovi/releases/latest)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-Ko--fi-ff5e5b?style=for-the-badge&logo=kofi&logoColor=white)](https://ko-fi.com/itsun)

A small always-on-top companion for Diablo IV (windowed mode, Windows): item search, boss loot,
crafting, your builds and what is still to farm, a build finder, the map tool, diablo.trade and
the world boss, Helltide and your own timers. Right next to the game, without alt-tabbing.

It does not read or change the game's memory or files. It reads public web pages and shows them
next to the game. Download the portable `.exe` above and start it, nothing to install.

**A hobby project**, made with [Claude](https://claude.ai). It is free and only meant to help
people play. Everything it shows comes from the sites listed under *Credits* below, and without
them and the work they put in it would not be possible. All credit goes to them.
If it helps you, a [coffee](https://ko-fi.com/itsun) is welcome. It stays free either way.

<p align="center"><img src="docs/screenshots/tour.webp" alt="A tour of the overlay" width="100%"></p>

<table>
<tr>
<td align="center" width="25%"><a href="docs/screenshots/gear-route.jpg"><img src="docs/screenshots/gear-route-thumb.jpg" alt="Your build's route: where to go, what drops there"></a><br><sub>Your build's route: where to go, what drops there</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/paragon.jpg"><img src="docs/screenshots/paragon-thumb.jpg" alt="Paragon boards next to the game's"></a><br><sub>Paragon boards next to the game's</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/boss-loot.jpg"><img src="docs/screenshots/boss-loot-thumb.jpg" alt="Boss loot, by your class"></a><br><sub>Boss loot, by your class</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/find-a-build.jpg"><img src="docs/screenshots/find-a-build-thumb.jpg" alt="Find a build: proven builds explained"></a><br><sub>Find a build: proven builds explained</sub></td>
</tr>
<tr>
<td align="center" width="25%"><a href="docs/screenshots/classes.jpg"><img src="docs/screenshots/classes-thumb.jpg" alt="Pick a class, then a skill"></a><br><sub>Pick a class, then a skill</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/cheat-sheet.jpg"><img src="docs/screenshots/cheat-sheet-thumb.jpg" alt="The cheat sheet of a build"></a><br><sub>The cheat sheet of a build</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/settings.jpg"><img src="docs/screenshots/settings-thumb.jpg" alt="Settings on one page"></a><br><sub>Settings on one page</sub></td>
<td align="center" width="25%"><a href="docs/screenshots/closed-bar.jpg"><img src="docs/screenshots/closed-bar-thumb.jpg" alt="Closed: timers and what is left to farm"></a><br><sub>Closed: timers and what is left to farm</sub></td>
</tr>
</table>

## Credits

Without these cool websites this overlay would not be possible <3:

- [maxroll.gg](https://maxroll.gg): game data, boss loot, crafting, activities, the iconic mythics, the map tool, build guides and the tier list
- [d4guides.gg](https://d4guides.gg): item database, icons, in-game tooltips, the farm list's items and aspects
- [d4builds.gg](https://d4builds.gg): build guides
- [d2core.com](https://www.d2core.com): skill trees, paragon boards, stat texts, build planner and proven builds
- [infinitybuilds.gg](https://infinitybuilds.gg): builds and their guides
- [diablo.trade](https://diablo.trade): trading, chat and the world boss timer
- [sunderarmor.com](https://sunderarmor.com): pictures of the uniques, bosses and classes

## The look

The overlay reads like a page of the game's own journal: ash black, parchment text, blood red for
what you act on, gold for numbers. Every unique, mythic, aspect, charm, seal, set, gem, rune, soul
splinter and runeword has its picture, and one hover card shows the in-game tooltip everywhere.

The open panel is made for the room left of the game's inventory, skill tree and paragon:
**820 × 600** at 1080p, growing with the screen (up to twice on 4K). *Settings → Appearance →
Panel size*: Small, Medium, Large or **Mobile** (393 × 850, tall and narrow like a phone). Drag the
bottom right corner for any size from 360 × 400 up. Every page works down to the phone's width.

## The bar

Closed, the bar is a slim strip with the timers only. The mouse over it slides out the sections,
settings and quit (at the right edge of the screen to the left). Opening a section by a click, a
timer or a hotkey, the panel grows out of it; closing, it folds back in. Open, the bar is the
panel's spine.

| Section | What it does |
|---|---|
| **Search** | One box for everything: items, boss loot, crafting recipes, activities (six maxroll guides) |
| **Builds** | *My builds*: your farm list with cheat sheet, gear, skills, paragon. *Find a build*: pick a class and a skill, every site's guides explained, or build it yourself |
| **Map tool** | The maxroll map tool, embedded (see below) |
| **diablo.trade** | Your listings with your own login, the chat one click away, unread messages as a red badge |
| **Settings** | One page: Behaviour, Appearance, Hotkeys, diablo.trade, Data |

**Closing and pinning.** A click into the game closes the panel, no Esc needed. **Pin** (top right)
keeps it open: pinned, it fades while you play and comes back under the mouse. **The game keeps
the focus:** clicking around in the overlay leaves Diablo IV in front. The overlay only takes the
keyboard while you type and gives it back right after.

**Hotkeys:** `Ctrl+Shift+F` opens the search from inside the game, `Ctrl+Shift+B` your builds,
`Esc` closes everything. More can be set in *Settings → Hotkeys* (show/hide, map tool, the build's
skills or paragon, start the own timer, counter +1).

## The timers

```
⠿ │ WORLD BOSS 2:15:40 │ HELLTIDE 13:47 │ TIMER 05:00 │ RUNS 9      (mouse over: … │ 🔍 📋 🗺 🛍 │ ⚙ ⏻)
```

- **World boss:** turns red, grows and blinks in your warning time (5:00 by default). A click stops
  the blinking, otherwise it opens what was open last.
- **Helltide:** how long it still runs (red for its last 3 minutes), or when the next one starts.
- **Your own timer:** counts down, up, or works as a stopwatch (click: start, stop, back to 0:00).
  Red and blinking for its last 30 seconds. Times are typed as `90`, `5:00`, `15:15`, `30m` or `1h`.
- **Counter** ("Runs"): a click adds one, a right click starts at 0, a hotkey adds one too.
- **To farm** (switched on in the settings): how much of your active build is still missing. A
  click opens its route at the first stop still open.

Each one can be switched off or left out of the closed strip. The strip and the panel each keep
their own place on the screen, wherever you drag them.

## Search

Type a name: the item with its icon, rarity, power and effects as the game's tooltip shows them,
which boss drops it and which recipes use it. Favourite it, copy its name or search it on
diablo.trade. The results sit on top as chips in two rows; what does not fit is counted on a
"+5 more" chip that opens them all. `↑` `↓` walk the results.

A keyword narrows it down:

| Input | Result |
|---|---|
| `ber rune` | only the rune and what you can craft with it |
| `insight runeword` | only the runeword and its recipe |
| `duriel boss` | only the boss loot table |
| `boss loot` | every boss and loot pool, for your build's class |
| `crafting` | every recipe group and all runewords |
| `activities` | all six guides |
| `iconic` | all iconic mythic uniques, with how to get them |

## Builds and the farm list

**My builds** keeps your builds and what you still need for them. Import one by pasting a link
from maxroll, d4builds, infinitybuilds or d2core (Chinese, translated), or a build code. Its
variants (Starter, Endgame …) load by themselves.

- **Cheat sheet:** the build on one page: the breakpoints the guide's author names, what to set up
  once, how to play it and why it works.
- **Gear:** three views. **Route** is where to go, in order, with what drops at each stop. **List**
  is everything at once, **Slots** the build as the game shows it. Tick what you have; aspects go
  into your codex and count in every build.
- **Skills and Paragon:** the skill tree and the boards as on d2core, with what the build takes
  lit up. Zoom with the wheel, drag to move.
- **Compare:** what changes from this build to another one or another variant, and what is left
  to farm for it.

## Find a build

*Builds → Find a build* is for players who follow guides and want to make a build of their own.
Pick a **class**, then the **skill** that should do the damage: the skills with guides come first
(S-Tier, A-Tier … by maxroll's tier list, then the ones with guides only on the other sites, each
with how many guides there are), the rest after them by kind. The build opens on one sheet: skill
bar on top, the gear as the game shows it, what the picked piece does on the right.

**Where the build comes from** (a row of cards above the sheet):

- **Proven builds** first: maxroll's tier list, d2core's most liked builds of the season,
  infinitybuilds' most liked (Mekuna, Rob …) and the d4builds guides d4builder has read, one site
  after the other, each card with the author's breakpoints at a glance. Each opens with **What the
  author says** (breakpoints, set up once, how to play it, why it works, as on the cheat sheet), then
  explained by the damage model (*What the damage model sees*): where the damage comes from, crits (or why a damage-over-time skill
  ignores them), where Vulnerable comes from, what keeps it alive, speed (Enigma's Teleport),
  Leoric's Crown and the soul splinters it boosts, what the build relies on, and what the model
  cannot count. Every piece shows its share (what the build loses without it), its stats and
  sockets in that build, and *6/8*: in how many of the top builds it appears.
- **What the top builds agree on:** the most used piece per slot, the skills, sockets and
  charm sets they share.
- **Build it yourself** starts from what the top builds use per slot; the model fills only the
  slots they leave open (one mythic at most, an aspect once). The model reads item texts and cannot
  see everything a build relies on (procs, set and runeword interplay), so its own pick for every
  slot is there too, marked *experimental*, and is what a skill without proven builds starts
  with. A unique's fixed stats replace the rolls of its slot, they never count on top; and every
  piece is measured at the level the proven builds of the skill reach (crit, attack speed, ranks,
  damage reduction …): 25% attack speed is a lot at none and little near the cap. *Make it my
  own* on a proven build starts from that one. Click a slot (*Change*) or
  search: every option says what it adds on top of everything else you wear (+% damage, toughness,
  speed). *Build for* Pit push / Speed farm / Bosses weighs damage, toughness and speed.
  *Conditional boosts* are bonuses that only work while something is true (Berserking, an Elite,
  "to isolated enemies" …): the ones the build provides are on, each other one says what it would
  add; switch it on and the gear is picked again. Each skill on the bar shows its modifiers; a
  click lists the three variants and both upgrade pairs with what they add.

*Skills* and *Paragon* show the build's skill tree and boards (see **Paragon** below). *Goals* is
about this build, not builds in general: **How this build works**:
the skill's loop piece by piece and its breakpoints, what the build has against what it needs
(see *Mechanics* below); **What this build wants most now**: one more of every stat it can roll,
valued on the build as it stands; then the build next to the top builds, stat by stat (crit
chance, attack speed, cooldown reduction, skill ranks, damage reduction, movement speed, both
from the gear), with the slots a stat that falls short rolls on. **Save as build** puts it
into the farm list: the gear with the rolls to look for (★ masterwork, ⚒ tempers), sockets and
runes, the skill bar and modifiers (lit in the skill tree, the main skill at its last rank, the key
passive), the paragon boards turned and joined at their gates, the talisman, or a proven build
exactly as imported.

**How the numbers are made** (`lib/dmgmodel.js`, `lib/optimizer.js`):

```
damage = weapon × skill % × main stat × (1 + [+] pool) × (1 + damage multipliers) × every [x]
         × crit (on crits) × Vulnerable (on Vulnerable enemies) × damage over time
crit   = (A + crit damage [+]) / A × 1.5 × (1 + crit damage multiplier), A = 1 + [+] pool
lucky hit effect = skill's Lucky Hit Chance × (1 + Lucky Hit Chance from gear) × the effect's chance
speed  = 1 + attack speed (cap 100%) + cast speed (cap 100%)
```

from d4guides' *Damage Calculation* (patch 3.2.2, the model gives its worked example to the
point) and maxroll's *In-Depth Damage Guide*. Toughness as maxroll's defence guide (Season 11+)
works it out: per damage type, life over Armor (against all damage), that type's Resistance and
every other damage reduction, multiplied, averaged over the six types. Armor and Resistance are
ratings, `R / (R × 10/9 + C)` with C = 5678 / 1136 at level 70, no caps any more; Strength adds 2
Armor a point, Intelligence 0.4 Resistance; dodge (`1 − Π(1 − dodge)` + 0.6% per 100 Dexterity)
comes on top. Item, aspect, splinter and gem texts are read into effects:
value, [x] or [+], who the sentence is about (your skill, a group it is in, or a side effect
like Arrow Storms), the condition it needs, drawbacks. Procs ("unleash a Rank 20 Chain
Lightning", Crushing Blow) are shown, not guessed as a number. The souls a Splinter of the Black
Soulstone counts are a slider.

**Mechanics:** what makes a strong build more than its numbers. Top builds hang on a few
patterns (read out of maxroll's guides and the notes of d2core's most liked Season 15 builds),
and the model reads them out of every text, for every class:

| pattern | read from | example |
|---|---|---|
| a cast spends the whole pool for x%[x] per point | "Consumes all of your Energy … per Energy Consumed" | Beastfall Boots |
| spending takes seconds off a cooldown | "Spend 75 Energy to reduce your Ultimate Skill's Cooldown by 5 seconds" | Preparation (Rogue specialization) |
| a cast gives the pool back, per rank | "generates 11 Energy per Skill Rank" | Aspect of Aftermath |
| damage per point of the pool held | "0.50%[x] … per point of Fury you have" | Ramaladni's Magnum Opus, Seed of Horazon |
| a bigger pool | "+20 Maximum Resource", "Primary Resource is increased by 100%" | Melted Heart of Selig |
| a buff after each cast, counted by its uptime | "Casting an Ultimate Skill increases your damage by 55%[x] for 8 seconds" | Vehement Brawler's Aspect |
| a skill that lasts, up while its cooldown is not longer | game data: "follows you for 8 seconds" | Cataclysm |
| the skill becomes one of another group | "Blazing Scream is now an Archfiend Skill" | Elegy, Indira's Memory, The Third Blade |
| no Cooldown Reduction | "This ritual does not benefit from Cooldown Reduction" | Apocalypse |
| casting one skill takes seconds off others | "Casting an Ultimate Skill reduces the Cooldowns of your other Skills by 10 seconds", "… and vice versa", Lucky Hit "Reduce the active Cooldowns of your Trap Skills by 30%" | Aspect of Apogeic Furor, Synergy, the Orange Herald, Misericorde |
| the resource budget | "+4 Fury Regeneration", "15% Resource Generation", "7% Cost Reduction", Lucky Hit restores, "7% Fury Drains per second", "free to cast" | Ramaladni's drain, Rod of Kepeleke |
| more hits a cast | "the Lesser Demon skulls deal the same damage as the main skull", counted as at least one more full hit | Elegy |

`cycle()` plays the main skill through a dozen casts (what each spends, what that takes off the
cooldown, what comes back) and gives the **breakpoints**: Rain of Arrows with those three needs
300 Energy and ~60% Cooldown Reduction to clear its 50 s cooldown and enough ranks for Aftermath to
refill the pool (maxroll's guide: 300 Energy, 61%); below that it is a step, not a slope.

**Cooldown chains** (`chainTimes`): every skill on the bar with a cooldown, cast when it is ready,
with the seconds the other casts take off it: skill *i* comes back every `T_i = base_i / (1 + Σ_j r_ji / T_j)`
(in `T_i` seconds skill *j* is cast `T_i / T_j` times, each taking `r_ji` off), played to a fixed
point; the main skill counts as a source too. The buffs the bar keeps up (Berserking, Unstoppable,
Fortify, Barrier, Vulnerable, crowd control, Frozen, each read with its seconds from the skill text)
count **by their uptime**: a bonus "while Fortified" from an aura up half the time counts half, and
Cooldown Reduction or a chain that keeps it up all the time raises it; the goals show each such
skill's breakpoint ("Cooldown Reduction to keep Sigil of Chaos up").

**Resource budget** (`sustain`): a spender cast non-stop costs `cost × casts a second × (1 − Cost
Reduction)` plus drains; in come regeneration (gear, buffs, and the base value the player reads off
the character sheet: the game data has none, so it is a field in the goals) and Lucky Hit restores,
raised by Resource Generation. Short of it, the generator on the bar fills the gap and the spender
is cast `m = (generator + income) / (spend + generator)` of the time. Its breakpoint: income ≥ spend.

The builder works with all of it: a loop only pays off whole, so its pieces are also tried as a
package, every specialization or key passive a loop hangs on is tried, a piece that gives the
skill a tag has the whole build read again with that tag. The **breakpoint chase** puts the stat
that closes an open breakpoint (Maximum Resource, Cooldown Reduction, ranks, regeneration, Resource
Generation, Cost Reduction, restores) on slot after slot in place of the roll that costs least, and
tries the pieces that move it (a Lucky Hit restore aspect, a cooldown chain); the whole build
decides whether that beats what it had. A cast takes one second at no speed (assumed: the game
data has no animation lengths).

**Stats and tempers** are picked by the model for the build as it stands, not from a list: three
affixes per legendary, one temper (shown with its category: Offensive,
Defensive, Utility, Mobility, Resource or Weapons, and its manual) on any piece, uniques keep their own
stats. With every other piece in place, a slot gets what this build lacks: Maximum Resource where
a loop spends the pool, the skill's own cooldown temper, crit damage where it crits; a temper for
another skill group ("Frost Critical Strike Chance") is nothing to a skill outside it. ★ marks the
affix the masterwork capstone (+50% to one affix) is worth most on; reroll until it lands there;
⚒ marks a temper. "+100 All Stats" in the data is no temper: d2core and maxroll both carry it as
the text of the skill augments ("Flurry hits twice") whose real text neither has, so it is left out.
Swapping a piece picks them again. Every tile shows its card on hover (as in the farm list).

**Sockets:** per slot what adds the most: gems by their weapon, armour or jewellery power, soul
splinters in jewellery only (or a helm that counts as jewellery, Leoric's Crown, at 1.5×), a
runeword's own runes, and **rune pairs** in two-socket armour: a condition rune gains Offering when
the build does its thing (Tam: a non-channeled Core cast, Yul: a skill with a cooldown, Zan: an
Ultimate, Poc: 5% of the pool spent, Cir, Igni, Ort, Tal; how often comes from the model's casts,
chains and budget), an effect rune spends it (Ohm, Vex, Gar, Sol, Qua: effect × how often it can
fire, by its cooldown). Conditions that hang on how you play (Evade, potions, taking no damage) and
effects the model cannot count (procs, Gold Find) are left out.

**Class choices:** the player's own picks besides skills and gear, from the game data, each the
one that adds most on the build: Sorcerer enchantments (two: the slots "Legacy of the Magi" opens;
"Chain Lightning forms automatically after spending 100 Mana" is a free cast per 100 spent),
Druid spirit boons (one per spirit and one more), Paladin oath, Barbarian weapon expertise (the
technique slot, rank 10), Warlock shard, Rogue specialization. They count in every number.

**Paragon:** worked out on the build, board by board: every gate tried as the way in (that is the
board's rotation) and every other as the way out to the next board, which hangs on there (up or to
a side). On each board: the legendary node and the glyph socket first, then the glyph's threshold
("40 Intelligence within range") as one package of the nearest nodes of that attribute inside its
radius (Manhattan distance, as d2core's planner counts it), then whatever adds most per point (a
node's own value plus what its attribute points give the glyph), keeping the way to the gate out
free. A board is taken for its legendary node first; one whose legendary does nothing for the
build only when nothing better is left. 220 points, glyphs at rank 100 (radius 5, legendary bonus).
The Skills and Paragon views are the farm list's own (icons or minimal), drawn on what *Save as
build* would keep, before anything is saved.

**Talisman:** a Mythic seal's 6 charm slots filled by the model: a set by its 2/3/5 bonuses,
Unique Charms (the power of their unique item, 147 in Season 15), a Mythic Charm. Three ways side
by side: a Mythic seal (one Unique Charm, two with the Hellfire Torch), the Seal of the Golden
Epiphany ("Can equip up to 3 Unique Charms"), and the **seal swap**: charms put in under the
Golden Epiphany, then that seal swapped for the Seal of the Diamond Mind ("Reduces the number of
Charms needed for Set bonuses by 1"), the Unique Charms stay. The swap is a Season 15 trick
reported by players and may be fixed any time; the build counts the plain Mythic seal.

Data: maxroll's game data (skills, modifiers, sets, tiers), d2core's item files (uniques with
their fixed stats and runewords, aspects, soul splinters, gems, affixes per slot, tempers,
paragon), maxroll's tier list, d2core's and infinitybuilds' build lists; the proven builds come
in through the overlay's own importers. Kept in `builder-db.json`, fetched weekly (the tier list
daily); proven builds once a day per skill.

## Map tool

The [maxroll.gg map tool](https://maxroll.gg/d4/map-tool) is **embedded** in the overlay, not
rebuilt: you get all its layers and filters, from maxroll, without ads. What you mark is kept in
the overlay's data folder and in `map-progress.json`, so it can move to another PC.

## diablo.trade

⚙ → **diablo.trade** → *Sign in*. The login is kept for 30 days. If signing in does not work, paste
your cookies instead (browser → F12 → Application → Cookies → diablo.trade).

## Backup, tray and updates

- **Backup** (*Settings → Data*): pick a folder (one OneDrive or Dropbox syncs keeps a copy off the
  PC) and back up now or once a day. Your settings, builds and map progress, never the login.
- **Tray:** shows or hides the overlay, starts Diablo IV, opens Search, Builds or Settings, quits.
- **Updates** (*Settings → Data*, off by default): asks GitHub once a day for a newer release and
  puts a green dot on Settings. Nothing is downloaded by itself.

## Where the data lives

Everything sits **next to the .exe** in `D4-Overlay-Data\`: settings, builds, map progress, the
caches and your diablo.trade login. Copy that folder to take everything to another PC. When you
pass the app to a friend, give them **only the .exe** (the folder holds your login).

## Data sources

| Source | Used for | Refresh |
|---|---|---|
| maxroll.gg game data | item database, names, skills, sets | weekly |
| maxroll.gg *Boss Loot Table*, *Crafting* and *Equipment* pages | boss loot, recipes, iconic mythics | daily / every 3 days |
| maxroll.gg guides and *Endgame Tier List* | activities, proven builds, tiers | daily / every 3 days |
| maxroll.gg [map tool](https://maxroll.gg/d4/map-tool) | the map, embedded | live |
| d4guides.gg | icons, rarity, item and aspect lists, in-game tooltips | per search / every 3 days |
| d2core.com | stat texts, skill trees, paragon boards, proven builds | weekly / daily |
| maxroll.gg, d4builds.gg, infinitybuilds.gg, d2core.com | build import | when you import |
| diablo.trade | world boss timer, unread messages | every 15 s |

## Running it

```
npm install
npm start          # run from source
npm run dist       # build dist\D4-Overlay-<version>-portable.exe (without the macros)
npm test           # all offline tests
npm run css        # build renderer/style.css from styles/ (never edit style.css itself)
npm run ui-check   # every page at every size: screenshots and an overlap check
```

### Building

```
npm run dist       # the .exe without the macros: the one to share (also the download above)
npm run dist:m     # the .exe with the macros (lock, click spam): build it for yourself
npm run start:m    # run from source with the macros
```

### How the code is laid out

The page is split by area: `renderer/app.js` (state, opening and closing, start-up), `strip.js`
(the bar's motions), `timers.js`, `searchview.js`, `settingspage.js`. The stylesheet is written in
`styles/` and built into `renderer/style.css`. The main process keeps hotkeys and data loading in
`main.js`; where the window goes is `lib/windowplace.js`; what the pages ask for is served by area
(`lib/searchipc.js`, `lib/buildsipc.js`, `lib/builderipc.js`). Every request goes through
`lib/netfetch.js`: a site that does not answer within 15 s fails instead of hanging.

If something misbehaves, `overlay-log.txt` in the data folder records what happened.

## Macros (not in the download)

**The latest release does not include the macros. If you want them anyway, at your own risk: download
the source code and build it yourself. I do not support automating game input.**

The optional macros (click spam and lock) are the exception to "it only reads web pages": they send
mouse clicks and key presses to the game window. Blizzard's terms do not allow automating game
input, so using them can put your account at risk. Even in a build with them, they are all **off**
until switched on in *Settings → Macros*, each one past a "use at your own risk" warning.

- **Click spam:** hold Mouse 4 / Mouse 5 (or a key of your choice) and it keeps clicking right /
  left, 1 to 40 clicks a second.
- **Lock:** a toggle key (F9) holds the keys you list down, or presses each on its own timer. The
  map, the chat, the town portal and your own left click pause it. Key lists per character.

Both only send input while Diablo IV is the window in front. Build it with `npm run dist:m`.
