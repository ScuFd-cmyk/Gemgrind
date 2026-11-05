# CLAUDE.md

Gemgrind: a single-player fantasy match-3 RPG. It is hard, grindy and progression-focused. The campaign has 5 Acts, 50 continents and 20 cities per continent, with a guardian at the end of each continent and a final boss. It ships as an installable offline PWA, and the target device is Android (edited in the Acode editor).

## Commands

There is no build step, package manager or bundler. The game is static files.

```bash
python3 -m http.server 8765                      # serve the repo root
# play:   http://localhost:8765/index.html
# debug menu is ON by default until release (DEBUG_DEFAULT in <script id="debug-loader">); ?debug=0 / ?debug=1 override per device
node tools/balance-sim.js                     # balance harness: model every difficulty × continent, fail on drift vs the baseline
node tools/balance-sim.js --update-baseline   # accept intended balance changes (commit tools/balance-baseline.json)
node tools/balance-sim.js --targets=tools/balance-targets.json --strict   # check design targets
# model defaults are calibrated from real QA exports (skulls 0.94 / enemySkulls 1.16 / sustain 1.16, see AUDIT_REPORT W2); override with --skulls --enemySkulls --sustain
node tools/skill-probe.js                     # cast every skill × skill level × campaign stage through the real cast(); report power vs skulls, the harness and guardian HP (--json=out.json, --diff=0..4)
node -e "new Function(require('fs').readFileSync('sw.js','utf8'))"   # syntax-check the service worker
python3 tools/extract-assets.py            # move any inline base64 image in index.html into assets/ (run after pasting one in)
python3 tools/extract-assets.py --check    # exit 1 if index.html still contains an inline base64 image
```

- **Tests:** there is no gameplay test suite yet. Before pushing:
  - run `node tools/balance-sim.js` (needs Playwright + Chromium). If a change moves balance on purpose, re-run with `--update-baseline` and commit the new baseline in the same commit.
  - smoke-test in a browser with **no flag** and with **`?debug=0`**: no `pageerror`s, a new hero can fight, win and lose, saving survives a reload, and the debug cog is shown by default and hidden with `?debug=0`.
- **Debug console:** on by default during playtesting. The cog (bottom-left), `` ` `` or F2 toggles the console, which has Autoplay, Auto-Continue, Auto-Retry, QA Simulation, Bug Monitor, 📐 Balance sim and the ⚖️ Balance tab. It stays until final release; for release set `DEBUG_DEFAULT=false`. Use Autoplay + Auto-Continue + Auto-Retry for long regression soaks.
- **Run journal (`QARun`, v6.1.8):** one continuous log per hero, from character creation to the campaign victory, across reloads and launches. It records every console line and breadcrumb; its play clock pauses while the game is hidden or closed and resumes when it is back. Stored in IndexedDB `GemgrindQA` (`run`, `run:<id>:<chunk>`, `runPrev`) plus a `gg_runmirror` localStorage mirror; the console's 📜 Run button exports it, and 💾 Export carries its summary and last 300 lines. Debug-only, like the rest of `debug-tools`.
- **Version:** bump `GG_VERSION` (top of the base script) for every upload; it appears in the boot log and in every QA export, so bug reports name their build.
- **Deploy:** upload `index.html`, the `assets/` folder, `sw.js`, `manifest.webmanifest` and the icons together. `sw.js` is stale-while-revalidate: the game opens from the cache instantly (also offline), re-checks `index.html` in the background, and when a newer upload is found the page shows "✨ New version ready · tap to reload". It precaches every `assets/…` file that `index.html` references (no list to maintain) and prunes unused ones. Any other new file that must work offline goes in `CORE` in `sw.js`, with `CACHE` bumped.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire game: inline CSS and JS (~1.2 MB). Images are files in `assets/`. |
| `assets/` | Game images (gems, skulls, gathering sprites, backgrounds, touch icon). Content-hash names: a changed image gets a new name, so the service worker can cache them forever. |
| `tools/extract-assets.py` | Moves inline base64 images out of `index.html` into `assets/` and rewrites the references. |
| `sw.js` | Service worker: cache-first launch, background update check, update banner, offline play. |
| `manifest.webmanifest` | PWA manifest (fullscreen, any orientation). |
| `icon-*.png` | PWA icons. |
| `AUDIT_REPORT.md` | The latest balance, security and performance audit, with fix diffs. |
| `tools/balance-sim.js` | Balance harness CLI (Node + Playwright). Drives `window.GGBalance` in the real page. |
| `tools/balance-baseline.json` | Recorded harness output, one fight per line; the drift check compares against it. |
| `tools/skill-probe.js` | Skill power probe (Node + Playwright): every class's skills through the real `cast()` chain, plus cascade frequency for the next-skill multiplier. |
| `tools/balance-targets.example.json` | Template for design targets (placeholder numbers). |

## Architecture (`index.html`)

- **Base engine:** the first large `<script>` (~lines 1025–2500). It holds board, combat, economy, rendering and save code.
- **Feature/version layers:** later `<script id="vNN-js">` / `<style id="vNN-css">` blocks (v38 → v604). Each adds a feature on top of the base engine. Since the v6.1 layer merge they never re-assign a base function; they attach to it in one of two ways:
  - a **hook list**, for functions whose extras only run *after* the base, or
  - a **named layer chain**, for functions whose extras can replace, bracket or re-argue the base.

  Never write `const _x=fn; fn=function(){…}` again (only `debug-tools` still wraps from outside, with its own `wrap()`). A layer's code stays in its own feature block, because it uses that block's private state.
- **Hook lists:** each function runs its base body, then every registered hook in registration (document) order. Hooks run even when the base body returns early (e.g. `draw()` with no enemy). The runner has no try/catch: wrap your hook body in `try{}catch(e){}` unless an error should stop the hooks after it.

  | Function | Base body | Register with | Hook receives |
  |---|---|---|---|
  | `draw()` | `drawBase()` | `onDraw(f)` | nothing |
  | `drawHud()` | `hudBase()` | `onHud(f)` | nothing |
  | `stat()` | `statBase()` | `onStat(f)` | the stat sheet `s`; modify it in place (don't return a new object) |
  | `newEnemy()` | `enemyBase()` | `onEnemy(f)` | nothing (read/modify `E`) |
  | `syncBoard()` | `syncBase()` | `onSync(f)` | nothing |
  | `renderCls()` | `clsBase()` | `onCls(f)` | nothing |

- **Named layer chains (67 functions):** the combat core (`win`, `die`, `hit`, `pdmg`, `foe`, `turnTick`, `roundEnd`, `resolve`, `castP`, `cast`, `restartBattle`, `retreat`, `drop`, `usePot`, `bossTactic`) and the UI/menu/save/helper functions (`newGame`, `migrate`, `pvDraw`, `renderSet`, `act`, `showMenu`, `renderMap`, `fl`, `gear`, `genItem`, `addXp`, `refillGem`, …).
  - **Why chains:** their layers can replace the original (Vault/Challenge victory and defeat; the v3.5 quest map over the `renderMap`/`walkTo`/`mapPts` placeholders; v60's `syncDiff`), bracket it (`try/finally` flags) or rewrite its arguments.
  - **How it works:** the global is a dispatcher, and the original body is `<name>Base`. For the `let`/`var` placeholders (`renderMap`, `walkTo`, `mapPts`, `refillGem`), the chain is registered right after their declaration.
  - **Adding behaviour:**
    ```js
    layer('win','vNNN-js', inner => function(){ const r=inner.apply(this,arguments); try{ /* … */ }catch(e){} return r });
    ```
    Call `inner` exactly once (or deliberately not at all, for a mode override), keep `this`/`arguments`, and return its result. Layers compose in document order, innermost first.
  - **Never re-assign these globals,** and don't store one as a value at startup (e.g. `btn.onclick=showMenu`). Use `()=>showMenu()` so later layers are included.
  - **Inspecting:** `GGLayers()` or the debug console's 🧬 Layer map shows every chain.
- **`debug-tools`:** `<script id="debug-tools" type="text/plain">`. It's inert, and the `debug-loader` after it runs it when debug is on (default during playtesting, `DEBUG_DEFAULT`). With debug off, the loader provides a read-only `window.DBAL` so the baked balance profile still applies. Nothing outside the block may *require* debug globals; always check first (`window.logDebugIssue&&…`). While `window.GG_SIM` is set, its hooks pass straight through.
- **`v606-balance-harness`:** `window.GGBalance.run(opts)` swaps `S`/`E`/`P` and the combat flags for clones, seeds `Math.random`, runs the real `newEnemy()`/`stat()`/`heal()`/`genItem()` synchronously, and restores everything. It must stay read-only: never call `save()`, `draw()` or `win()`/`die()` from it. It lives outside `debug-tools` so the CLI keeps working after release.
- **Core globals:**

  | Global | Holds |
  |---|---|
  | `S` | The save; the only thing persisted. |
  | `E` | Current enemy. |
  | `P` | Player combat state (hp, arm, mana `m[6]`, statuses `st`). |
  | `B` | Board, a flat 7×7 array (`N=7`); `-1` = empty, `0–5` colours, `6` skull, `7` Cursed Rock, `8` Catalyst. |
  | `FZ`, `SP`, `TR` | Parallel per-cell arrays: freeze turns, special type, trap. |
  | `tiles` | Tile DOM elements, parallel to `B`. |
  | `GT` | The current gathering trip, or `null`. |
  | `busy`, `sty`, `dead`, `PAUSED` | Input and turn locks. |
  | `curTab` / `conOpen` | UI location. |

- **Helpers:**
  - `$=id=>document.getElementById(id)`
  - `C()` returns the current class record `S.c[S.cls]`.
  - `D()` returns the difficulty row `DIFF[S.diff]`.
  - `stat()` returns the derived stat sheet (`statBase()` plus 5 `onStat` hooks; ~4 µs, **don't cache it**).
  - `LV(k)` returns a research level.
  - `BX(k)` returns a balance multiplier.
- **Render:** `draw()` → `drawHud()` + `VR[curTab]()` + hooks. `syncBoard()` diffs the tiles. Keep `draw()` free of layout reads; schedule them with `requestAnimationFrame` (see the v60 `fitSoon`).
- **Combat timing:** combat chains are `async` and use `await wait(ms)`, never raw `setTimeout`. `wait()` respects game speed, holds while `PAUSED`, and parks abandoned chains when `abortCombat()` bumps `BEP`.
- **Saving:** `save()` writes `localStorage.gg1` (throttled to 400 ms, flushed on hide or `pagehide`) plus IndexedDB through `GGDB.write()`. The board and `E` are not saved; a reload starts a fresh fight, but `S.fhp` (the hero's HP fraction, 1 after a defeat) is re-applied at boot, so a reload is never a free heal. Add any new persistent field to `S`, give it a default, and validate it in `migrate()`.
- **Lifecycle:** use `GGLife.onVisibility(f)` and `GGLife.onResize(f)`. Don't add new raw `resize` or `visibilitychange` listeners.

## Code style

- **Match the surrounding code.** It's dense, minified-style ES2020: short names, long single-line functions, semicolons, `const`/`let`, arrow functions, no modules or imports, and no external libraries or fonts. Code and CSS stay in `index.html`; images live in `assets/` (never paste base64 images back in: run `tools/extract-assets.py` if you do).
- **Tag new work with a version comment:** `/* v6.1.1 · what and why */`. Put new features in their own `<script id="vNNN-…">` layer rather than editing the base engine, unless you are fixing a base bug.
- **Extending a function:** register an `onDraw`/`onHud`/`onStat`/`onEnemy`/`onSync`/`onCls` hook or a `layer(...)` (see Architecture). Put your code in `try{}catch(e){}` so one feature can't break the others.
- **Escape everything:** pass any text that came from the save or the player through `esc()` before it goes into `innerHTML`. Use `textContent` for messages (`msg()` already does).
- **Don't create elements and listeners on every draw:** build once, then update properties (see the `drawHud` skill bar and its `hudH()` helper). Remove listeners or observers you attach to persistent elements.
- **No layout reads** (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`) inside `draw()`, `syncBoard()` or the cascade loop.
- **Guard `localStorage`:** wrap every read and write in `try{}catch(e){}`.
- **Save import:** `migrate()` is the single place that validates loaded or imported values (levels ≤ 9999, forge 0–`FMAX`, potions 0–9999, counts ≥ 0). New persistent numeric fields must be clamped there.
- **Secrets:** never store tokens in the save or in the settings object. The debug GitHub token is session-only unless the tester ticks "Remember token on this device".
- **Persistent loops:** no `requestAnimationFrame` loop may run forever. Stop it when its view is hidden, and use a timer for low-frequency checks. Infinite CSS animations on the board must pause while it's covered (`body.home`, `body.v601cov`; see `v606-idle-anim`).
- **No duplicate `@keyframes` names:** the last definition silently wins. Grep before adding one.

## Game rules that must hold

**Design rules:**
- **Defeat never takes anything.** `die()` pays a consolation purse of `PITY = 12.5%` of the node's win XP and gold, weighted by effort: 20% of it for showing up, plus 80% × the share of enemy HP removed (`defeatPity`, audit W3). It is never zero. Gold, shards, materials and gear are never removed. Don't add penalties.
- **Narration** comes only from the campaign narrator (Deckard-Cain-style voice) in the Story Theater.
- **One screen, no scrolling.** Every menu and loop fits one screen; only the skill tree and the continent map may scroll. The board is the focal point, the enemy goes in the top banner and the player in the bottom bar.
- **Look:** dark oak with weathered gold hinges and ornaments; transitions must be snappy.

**Scaling** (change only on purpose, re-run the balance sim, and update `AUDIT_REPORT.md`):
- `ehp(s) = (30 + 1.1s² + 28s)·(boss 1.8)·DIFF.eh·BAL.eh`, and `eat(s) = (5 + 1.5s)·(boss 1.25)·BAL.ed`.
- Stage from level: `s = 1 + 0.21(L−1)`, with enemy level `L = 10·continent + ⌊town/2⌋ + 1` (1–500).
- Campaign modifier: `m = 1 + 0.12ci + 0.02j`, times `1.04^(ci−39)` from continent 41. Rewards scale with `sqrt(m)`.
- Difficulty rows (`DIFF`, Story → Grindmaster):

  | Field | Story | Casual | Normal | Hard | Grindmaster |
  |---|---|---|---|---|---|
  | `eh` (enemy HP) | 0.6 | 0.8 | 1 | 1.3 | 1.7 |
  | `ed` (enemy damage) | 1 | 1 | 1 | 1.2 | 1.5 |
  | `r` (rewards) | 0.75 | 0.9 | 1 | 1.25 | 1.6 |

  Grindmaster's `sk:2` doubles skulls **both ways**.
- NG+ tier `t` multiplies enemy HP and attack by `1+t` (`t ≤ 10`). Infinite Vault multiplies both, and its rewards, by `VMUL(wave) = 1.15^(wave−1)` (capped at 1e12 only to stay finite).
- Each difficulty keeps its own campaign progress (`S.dp`); hero, gold and gear are shared.

**Combat invariants:**
- **Cascade loop:** at most 80 steps (`guard<80`). Never recurse.
- **Combo:** `cm = 1 + (combo−1)·(Chain ? 1.5 : 1)` for the player and `1 + (combo−1)·0.5` for the enemy. A Catalyst+Catalyst wipe is a flat ×5 for the player and ×3 for the enemy (same halved slope, audit W4). Each multiplier is applied once per hit.
- **Caps:** next-skill `P.cc = 1 + (peak cm − 1)·0.5`, `≤ 3` (armed by any cascade of 2+ steps), enemy block `≤ 0.9`, dodge `≤ 0.35`, cooldown reduction `≤ 0.3`, Cursed Rocks `≤ 12`.
- **Random gems:** every random gem that appears mid-fight (cascade refill, Thawing Rune) must come from `refillGem()`; rules shape it there (Barren Emeralds overrides it). Never rewrite `B` inside `syncBoard()` or any other render function.
- **Move search:** `tryMoves()` only offers swaps that form a line through one of the two swapped cells, unless the board already has a match. Callbacks must not depend on seeing non-matching swaps.
- **Board recovery:** `ensure()` runs after every move and tactic. It tries up to 200 shuffles, then regenerates the board, so there is never a no-move state.
- **Boss enrage:** after player turn `15 + LV('pvt')` (skulls ×2, permanent burn). Tactics fire on enemy turns where `E.tc % 3 == 0`; Stun and Freeze both skip the `E.tc++`, so they pause that clock.
- **4+ match:** gives the player an extra turn (unless the Chain keystone is active). The enemy gets at most 3 chained turns.
- **Fight transitions:** a combat chain belongs to one enemy. `resolve()` and `swap()` pin it as `E0` and stop as soon as `E !== E0` (a victory screen's Continue can replace `E` mid-cascade; `settle()` then deals the new board). Keep those checks after every `await` in the cascade loop (audit W1).
- **No free heals:** UI actions (class switch, menus) must never raise the hero's HP fraction. A class switch keeps the HP fraction, and during a live fight also armor, ailments and the Phoenix flag (audit C1).

**Known open issues:** read `AUDIT_REPORT.md` before working on combat, economy or class code. Fixed: C1, W1, W3, W4, W5 and L1–L8. Still open: W2 (the harness exists; the curve and targets are a design decision).
