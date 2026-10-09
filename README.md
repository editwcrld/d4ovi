# D4 Overlay

A small always-on-top companion for Diablo IV (windowed mode, Windows). It does not read or
change the game's memory or files — it reads public web pages and shows them next to it.

The two optional input helpers (*Click spam* and *Key loop*, below) are the exception: they
send mouse clicks and key presses to the game window. Blizzard's terms do not allow automating
game input, so using them can put your account at risk. Both can be switched off in
*Settings → Hotkeys*.

## The bar

A narrow icon rail (48 px) that can be expanded to show labels, and switched between **vertical**
(default, sits at the edge) and **horizontal** (sits on top). Each icon opens one section:

| Icon | Section | What it does |
|---|---|---|
| 🔍 | **Search** | One box for everything: items, boss loot, crafting recipes, activities |
| 📋 | **Builds** | Your builds: gear with stats, where each piece drops, skill tree, paragon — see below |
| 🗺 | **Map tool** | The maxroll map tool, embedded — see below |
| ⚑ | **Activities** | Six maxroll guides: Secret Cow Level, Dark Citadel, Artificer's Tower, Echoing Hatred, Gathering Legions, World Events |
| 🛍 | **diablo.trade** | Your listings with your own login — the chat is one click away there; unread messages show a red badge |
| ⚙ | **Settings** | Behaviour · Appearance · Hotkeys (incl. click spam and key loop) · diablo.trade · Data |

**Closing and pinning.** A click into the game closes the open panel and the bar goes back to the
small pill — no Esc needed. **Pin** (top right of every panel, next to ✕) keeps it open: pinned,
it fades back while you play and the mouse over it brings it forward. Nothing pins itself; pinned builds do
not fade (*Settings → Behaviour*). The first time it opens, a short hint explains this. The open
panel can be dragged by its header row as well as by the ⠿ handle.

`Ctrl+F` opens the search from inside the game, `Esc` closes everything and clears the field.
Three more hotkeys can be assigned (show/hide, open map tool, open builds — `Ctrl+Shift+B` by default).

Boss loot and crafting have no icon of their own — typing `boss loot` or `crafting` brings up the
same thing, so the bar stays short. `boss loot` (or `boss drops`) shows every boss as a tile —
where it is, torment tier, key — and the loot pools below; pick one to see what it drops
(*← All bosses* goes back). An item a boss drops carries that on its own card (*Drops from*: the
boss, where it is, what you need), so it gets no separate boss card. A new search always starts
on *All*, whatever chip was picked before. A boss card leads with where the boss is (lair name below),
then the torment tier and the key it needs, then the drops in their rarity colour; the lair
screenshot from the guide opens on request (*Show lair & map*).

## When nothing is open

Closed — by a click into the game, ✕ or Esc — the bar shrinks to the pill right away (it fades
out and back in while the window changes size) and fades to the opacity you set:

```
⠿  WORLD BOSS 02h 15min 40sec  🔍  📋  🛍  ⚙  ✕
```

handle · world boss timer · search · builds · diablo.trade · settings · quit. The horizontal bar
uses the same order. The timer keeps its full strength; in the warning time it turns red, grows
the closer the spawn gets and blinks — a click stops the blinking. Otherwise a click on the timer
opens again whatever was open last (builds, diablo.trade, a guide …), the search if nothing was.
Moving the mouse over the pill only takes the fade off — it keeps its shape and its place, so you
can drag it there.

Alerts punch through the fade and blink **on their own element only**: the timer when the world
boss is closer than your warning threshold, the diablo.trade icon when a message arrives.

Each of the two states keeps its own place on the screen: drag the pill where you want it while
it is idle, drag the bar while it is open. Both are saved as `posIdle` and `posOpen`, and
*Settings → Appearance → Places* resets them.

## Click spam

Hold a button down and the overlay keeps clicking — **only while Diablo IV is the window in
front**. Nothing is sent to any other window, and with the game minimised or alt-tabbed it stops
immediately.

| Default | Does |
|---|---|
| Mouse 4 (thumb, back) | repeats **right** clicks |
| Mouse 5 (thumb, forward) | repeats **left** clicks |

Both can be rebound in *Settings → Hotkeys → Click spam*: click the field and press the button
or key you want (the two thumb buttons, the wheel button, or a single key — the plain left and
right mouse buttons stay free so the field remains clickable). *Del* clears a binding, the speed
runs from 1 to 40 clicks per second (default 15), and the whole thing has an off switch.

The button is held down for 20–40 ms per click instead of being tapped instantly — a game reads
the mouse once per frame, and a click that goes down and up inside one frame is dropped.

Windows has no way to read a held mouse button or send clicks from Node, and a native module
would break the portable build, so a small PowerShell helper does it (`lib/clicker.js`), the
same way the game window is detected. It watches the overlay's process id and stops by itself
if the overlay is gone.

## Key loop

Press a toggle key (default **F8**) in the game and the overlay presses your skill keys
**1 2 3 4** one after the other, again and again, until you press the toggle key once more.
Like the click spam it only sends keys while Diablo IV is the window in front — alt-tab and it
pauses, back in the game it carries on.

In *Settings → Hotkeys → Key loop*: an off switch, the toggle key (a single key or a mouse
button), which of the four keys take part, and how many seconds pass between two rounds
(0.2–20 s, default 1). While it runs, a green **Loop** tag sits next to the world boss timer,
in the open bar and in the small pill.

The keys go out as scan codes and each is held for 30 ms, so the game sees them as real key
presses. The same helper as the click spam does it, nothing extra runs.

## Search

Type a name and you get the item with its icon, rarity, type, required level and power, plus
which boss drops it and which recipes use it. Each card can go straight to **diablo.trade**
(the search field is filled in for you) or open the full tooltip page in the **database**.
The results are a list on the left — tile, name in its rarity colour, what it is and where it
comes from (the boss, the loot pool) — and the picked one in full on the right, the first one
until you pick another; ↑ ↓ walk the list. A narrow panel shows the list, then the picked one
with *← Results*. The tabs above (All · Items · Bosses · Crafting · Activities) filter, a new
search always starts on All. A guide or page opened from a result loads behind a spinner, has
*← Back*, and typing in the search field goes back to the results.
Favourites (★) and recent searches are kept — a search counts as recent once you stop typing for a moment, and *Clear* next to the heading empties the list.

Add a keyword to narrow it down — in English:

| Input | Result |
|---|---|
| `ber` | everything matching, with the rune **Ber** first |
| `ber rune` | only the rune and what you can craft with it |
| `insight runeword` | only the runeword and its recipe |
| `annihilus seal` | only the seal |
| `duriel boss` | only the boss loot table |
| `crafting` | every recipe group and all runewords |
| `boss loot` | every boss and loot pool |
| `activities` | all six guides |
| `iconic` | all 13 iconic mythic uniques, with how to get them |

Recognised: rune, runeword, gem, aspect, skill, charm, seal, talisman, key, sigil, material,
set, unique, mythic, iconic, legendary, item, glyph, affix, paragon, boss, recipe, activity.

Mythic uniques carry a **How to get it** line taken from maxroll's equipment page — the iconic
ones say that they drop in the wild or cost 3x Resplendent Sparks at the Blacksmith, the normal
ones list the Horadric Cube recipe and the gambling options.

## Builds / farm list

`Ctrl+Shift+B` (changeable under *Settings → Hotkeys*) opens it. Like every panel it does not pin
itself — **Pin** is always your own click; pinned builds stay fully visible while you play
(*Settings → Behaviour → No fade out on builds*).

On top: the build (a click opens the build menu — switch builds, name, class, *+ New farm list*,
*Copy build code*, *Export all to file …*, duplicate, delete), the link to its source (opens the
original page in your browser), how much of it is farmed, and *Import*. Below: **Gear · Skills ·
Paragon**.

**Gear** has three views; the one you used last stays.

- **Route** (the default) — where to go, in order. On the left the stops: each boss
  ("The Butcher", "Andariel" …), *Runewords*, *Dungeons* for aspects, *Salvage a legendary*,
  then *Seal & charms*, *Runes*, *Gems* and *Soul splinters*, each with how much of it you have;
  a finished stop turns green. On the right what you get at the picked stop: the item in its
  rarity colour, its slot, the rolls of the build (greater affixes ✦, tempered lines ⚒) and its
  sockets, and a tick. Things from the same boss sit together.
- **List** — everything at once, one calm column, grouped the same way: name and slot, where it
  drops above, the rolls right under it. What you have sinks to *Farmed* at the end.
- **Slots** — the build as the game shows it: armour on the left, jewellery and weapons on the
  right, each with its picture and what it is ("Mythic Unique Helm", "Unique Bow"). In the
  middle what is socketed where (the slot under each group of gems and runes) and the skill bar —
  a click on a skill opens the skills, zoomed to it. Beside it the seal and the charms. Hovering an
  item shows a card with this build's rolls, where it drops and its sockets.

Seal, charms, gems, runes and soul splinters count as things to farm like the items: each has a
tick and goes into the progress on top. A gem needed twice shows "×2" and what it is for
("for Bow, Off-Hand"); hovering a charm shows its card with the set bonuses (lit when enough
pieces are worn; the seal can lower that). Where gems, runes and splinters come from is a general
hint, not taken from a data source.

*Only missing* hides what you have. A click on a name opens the search dropdown for that slot —
type to filter, *Unique / Mythic / Aspect* switch what it lists, `Enter` takes the first hit,
`Esc` closes it; a legendary slot takes an aspect (two on the amulet). Ticking, folding and
redrawing keep the place in the list. Weapons are named by their kind: a rogue has a bow and two
blades (*Weapon*, *Off-Hand*, *Weapon 2*), a barbarian up to four (*Weapon 3*). An item that exists
for several weapon kinds — a runeword like Infinity, a unique like Spirit — shows the picture and
tooltip of the kind the build uses (Infinity on a bow, not the scythe).

**Import.** One field: paste a link from maxroll, d4builds or d2core (Chinese, translated) or a
build code — the site is recognised, the variants load by themselves and are ticked, *Import*
adds them. A builds file can be dropped on the dialog or picked with *Import file …*.

**Skills.** The skill bar with ranks and modifiers, and the whole skill tree in d2core's layout
with every node the build took lit — hover a node for its text at that rank. The bar is in the
tree's order, top to bottom. A click on a skill — in the bar, in the tree (a modifier counts for
its skill) or in the slots view — zooms the tree in on it and lights it and its modifiers up
(again: back out). maxroll saves the tree by the game's node ids and d2core by skill ids, so both
land on the same drawing. d4builds.gg serves its skill tree data encrypted; for its builds the bar
is shown and a button opens d4builds' own tree inside the overlay.

**Paragon.** The boards on their grid, turned as in the build, the nodes taken lit up by rarity,
the glyph in its socket — as plain squares (*Minimal*) or with the game's node icons (*Icons*);
switching keeps where you zoomed to. The names sit in the gap above each board, gates that touch
are joined by a line. A click on a board — in the list on the right or in the drawing — lights it
up and moves the view to it, the whole board in view (again: all back). All three sites land on
d2core's board drawings: d2core and maxroll by board key, d4builds by board name. Both views zoom
with the wheel and move by dragging; ⤢ fits everything again.

- The class (build menu) filters what each slot offers; every option already says where it drops.
- Hovering an item or aspect in the dropdown shows its **in-game tooltip** (frame, rolls, flavour
  text), taken from d4guides.gg.
- **From a build site** — *Import* takes a link from one of three sites and lists the build's
  variants (Starter, Midgame, Endgame …) with the one the link points at marked; the ticked ones
  become builds:

  | Site | Link |
  |---|---|
  | maxroll.gg | build guide (`maxroll.gg/d4/build-guides/…`) or planner (`maxroll.gg/d4/planner/…#4`) |
  | d4builds.gg | `d4builds.gg/builds/<id>/?var=1` — `var` picks the variant |
  | d2core.com | `d2core.com/d4/planner?bd=23TM` (Chinese site) |

  Uniques and runewords come in by name (season-tagged game ids like `S05_BSK_Helm_…` included),
  legendaries by their aspects (two on the amulet — the sanctified / transfigured one is the
  second), with their rolls and sockets, the seal and charms, skills and paragon; the class is
  taken over, and an item the overlay does not recognise is reported instead of guessed. Every
  weapon keeps its kind (maxroll and d2core name it exactly, d4builds only "Ranged Weapon" /
  "Dual-Wield Weapon").

  d2core is in Chinese, but its gear uses the game's own ids, so every item and aspect comes in
  with its exact English name. Only what players wrote — build title and variant names — is
  translated: game names (skills, items, aspects, sets, glyphs) from maxroll's game data in both
  languages, build jargon (天塔 = Pit, 速刷 = speed farm …) from a short glossary. Unknown words
  stay as they are; the original title is shown on hover.
- **Compare** — the fourth tab next to Gear · Skills · Paragon puts the open build next to
  another one, by default another variant of the same guide (Starter → Endgame), otherwise one
  of the same class. Slot by slot what stays and what changes (changes first, different rolls and
  sockets of the same item underneath), then the skills, seal & charms, paragon boards and glyphs
  that come and go, and what is left to farm for the other one — everything it holds that is
  ticked in neither build. *Open* switches to it.
- **Several builds** — new, duplicate, rename, delete (build menu). They are saved in
  **`builds.json`** in the data folder, so they travel with it like the map progress. *Copy build
  code* gives one build as a short code (`D4B1:…`) for a chat or the other PC, *Export all to
  file …* writes all of them; *Import* takes both. Imports never overwrite: a name that exists
  gets " (2)".

Where things come from: boss drops, the General Unique Pool, the mythics and the season capstone
items from maxroll's boss loot sheet; everything without a dedicated source is "random drop /
Horadric Cube". Aspects are unlocked by salvaging a legendary that carries them — or, for 84 of
them, by completing a named dungeon. Which slots an aspect fits and which dungeon unlocks it is
only in its tooltip; the overlay reads those once in the background (d4guides allows about 120
requests a minute, so it takes ~5 minutes on the very first start) and keeps them.

## Map tool

The maxroll map tool is **embedded**, not rebuilt — it is a canvas application with no open data
source, so a copy would be worse and would break with every patch. Embedded you get all layers
and filters, without ads.

It tracks what you found by itself (`Altar of Lilith 0/190`, `Side Quest 0/311`, …) and stores
that locally — no account involved. The overlay keeps that storage in its own data folder, so
your marks are there after a restart, and additionally writes them to **`map-progress.json`**.
That file is how progress moves to another PC: copy it (or the whole data folder) and the
overlay plays it back. It never overwrites newer local progress unless you press
*Restore map progress* in the settings.

## Login (once)

⚙ → **diablo.trade** → *Sign in*. The session cookie is made permanent automatically (30 days),
so you stay signed in across restarts. If signing in does not work, paste your cookies instead
(browser → F12 → Application → Cookies → diablo.trade).

## Sizing

Everything scales with the screen: text, icons and spacing grow on a large display and stay at
the base size on 1920×1080. **Text size** can be nudged further in the settings, and the open
panel uses a share of the screen (small / medium / large). Embedded pages — map, chat, database —
get more room than a result list.

The corner at the bottom right of the panel sets your own size (*Settings → Appearance → Your own
size* resets it); the corner stays under the mouse while you drag. Made narrow, everything goes to
one column: the search shows the list, then the picked result with *← Results*; activities, the
route, the slots and the settings rearrange the same way, at the same text size.

| Screen | Search / settings | Map / chat / database |
|---|---|---|
| 1920 × 1080 | 960 × 645 | 1306 × 832 |
| 2560 × 1440 | 1200 × 868 | 1500 × 1120 |
| 3840 × 2160 | 1200 × 1314 | 1500 × 1400 |

## Where the data lives

The portable build keeps **everything next to the .exe**:

```
D4-Overlay-portable.exe
D4-Overlay-Data\            ← created automatically
   settings.json
   items-cache.json  d4guides-cache.json  maxroll-cache.json
   crafting-cache.json  activities-cache.json  mythics-cache.json
   farm-cache.json  farm-tooltips.json  maxroll-names.json  zh-dict.json  d2core-db.json
   map-progress.json  builds.json
   Partitions\trade\        ← your diablo.trade login
   overlay-log.txt          ← restarts past 1 MB, the one before is overlay-log.old.txt
```

Copy that folder to carry everything to another PC. If the .exe sits somewhere without write
access (e.g. `C:\Program Files`), it falls back to `%APPDATA%\D4 Overlay`.

Note: your diablo.trade login is inside that folder. When you pass the app to a friend, give
them **only the .exe**.

## Data sources

| Source | Used for | Refresh |
|---|---|---|
| Maxroll game data (`data.min.json`) | item database (~8400 entries), local | weekly |
| d4guides.gg (`api/v1/db-search.php`) | icons, rarity, category, detail page | per search |
| d4guides.gg list pages | extra columns (charm slots, effect, origin) | every 3 days |
| maxroll.gg *Boss Loot Table Cheat Sheet* | boss loot | daily |
| maxroll.gg *Crafting Cheat Sheet* | runewords & recipes | daily |
| maxroll.gg guides | activities | every 3 days |
| maxroll.gg *Equipment* page | iconic mythics + how to obtain | every 3 days |
| d4guides.gg item + aspect lists | farm list: slot, class, rarity | every 3 days |
| d4guides.gg `api/v1/tooltip.php` | in-game tooltips, aspect slots + dungeons | once, then cached |
| maxroll.gg build guide + `planners.maxroll.gg/profiles/d4/<id>` | build import | when you import |
| maxroll `data.enus.json` | item + aspect names by game id (for the import) | weekly |
| d4builds.gg (public Firestore document `builds/<id>`) | build import | when you import |
| d2core.com (CloudBase function `function-planner-queryplandetail`, anonymous) | build import | when you import |
| d2core.com database (`cloudstorage.d2core.com/data/d4/<build>/…_enUS.json`) | stat texts, skill tree, paragon boards | weekly, on first use |
| maxroll `data.enus.json` + `data.zhcn.json` | Chinese → English dictionary for d2core titles | weekly, on the first d2core import |
| diablo.trade (signed out page) | world boss timer | every 15 s |
| diablo.trade `api/chat/conversations` | unread messages | every 15 s |

Ads and trackers are blocked inside the embedded pages (`lib/adblock.js`), and the leftover
placeholders are collapsed so no gaps remain.

The timer and the unread count come from two different places on purpose: diablo.trade only
shows the event bar to signed out visitors, so the hidden window that reads the countdown uses
its own session without the login, while the unread count is fetched from the site's own API
with the signed in one.

## Running it

```
npm install
npm start          # run from source
npm run dist       # build dist\D4-Overlay-<version>-portable.exe
npm test           # all offline tests
```

## Tests

`npm test` runs fifteen files and prints one summary:

| File | Covers |
|---|---|
| `search-test.js` | boss loot search, keyword narrowing |
| `extract-test.js` | maxroll page extraction |
| `cookie-test.js` | cookie parsing (header, dev tools rows, JSON) |
| `timer-test.js` | world boss countdown: parsing, kept while the page reloads |
| `activities-test.js` | guide parsing and search |
| `mapstore-test.js` | map progress: save, restore, never overwrite newer |
| `d4guides-test.js` | database list parsing (name, icon, link, columns) |
| `mythics-test.js` | iconic mythics: the list, the acquisition text, bad pages |
| `place-test.js` | where the bar lands: the pill never drifts, places stay on screen |
| `clicker-test.js` | click spam and key loop: bindings, speed limits, what the helper is told |
| `maxbuild-test.js` | maxroll import: links, guide page, planner variant → build, dual wield |
| `sitebuilds-test.js` | d4builds + d2core import: links, variants, slots, aspects by game id, Chinese titles |
| `farm-test.js` | farm list: slots, sources, aspect tooltips, merged variants; builds: save, ticks, code, import |
| `compare-test.js` | comparing two builds: partner variant, gear, skills, charms, paragon, what is left to farm |
| `renderer-smoke.js` | the whole UI in jsdom: every section (incl. farm list, builds, compare), settings, hotkeys, Esc, idle fade |

If something misbehaves at runtime, `overlay-log.txt` in the data folder records cookie changes,
view navigation, zoom and data loading.
