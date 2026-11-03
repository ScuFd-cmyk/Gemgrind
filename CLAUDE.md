# CLAUDE.md

Gemgrind: a single-player fantasy match-3 RPG. It is hard, grindy and progression-focused. The campaign has 5 Acts, 50 continents and 20 cities per continent, with a guardian at the end of each continent and a final boss. It ships as an installable offline PWA, and the target device is Android (edited in the Acode editor).

## Commands

There is no build step, package manager or bundler. The game is static files.

```bash
python3 -m http.server 8765                      # serve the repo root
# play:   http://localhost:8765/index.html
# debug:  http://localhost:8765/index.html?debug=1   (remembered per device; ?debug=0 turns it off)
node -e "new Function(require('fs').readFileSync('sw.js','utf8'))"   # syntax-check the service worker
```

- **Tests:** there is no automated suite yet. Before pushing, smoke-test in a browser (Playwright is the usual tool) with **no flag** and with **`?debug=1`**. Check that:
  - there are no `pageerror`s
  - a new hero can fight, win and lose
  - saving survives a reload
  - the debug cog only appears with `?debug=1`
- **Debug console:** with `?debug=1`, the `` ` `` or F2 key toggles the console, which has Autoplay, Auto-Continue, Auto-Retry, QA Simulation, Bug Monitor and the ⚖️ Balance tab. Use Autoplay + Auto-Continue + Auto-Retry for long regression soaks.
- **Deploy:** upload `index.html`, `sw.js`, `manifest.webmanifest` and the icons together. `sw.js` is network-first, so online players always get the newest `index.html`. If you add a file that must work offline, add it to `FILES` in `sw.js` and bump `CACHE`.

## Files

| File | Purpose |
|---|---|
| `index.html` | The entire game: inline CSS, inline JS and inline base64 images (~2.5 MB). |
| `sw.js` | Offline service worker (network-first, cached fallback). |
| `manifest.webmanifest` | PWA manifest (fullscreen, any orientation). |
| `icon-*.png` | PWA icons. |
| `AUDIT_REPORT.md` | The latest balance, security and performance audit, with fix diffs. |

## Architecture (`index.html`)

- **Base engine:** the first large `<script>` (~lines 1025–2500). It holds board, combat, economy, rendering and save code.
- **Feature/version layers:** later `<script id="vNN-js">` / `<style id="vNN-css">` blocks (v38 → v604). Each one **wraps** earlier globals instead of editing them:
  ```js
  const _draw=draw;draw=function(){const r=_draw.apply(this,arguments);try{mySync()}catch(e){}return r};
  ```
  Later layers run *outside* earlier ones. Before changing a function, grep for every `_name=name` wrapper of it (`draw`, `drawHud`, `stat`, `newEnemy`, `syncBoard`, `win`, `die` and `renderCls` each have several).
- **`debug-tools`:** `<script id="debug-tools" type="text/plain">`. It's inert, and the `debug-loader` after it runs it only in debug mode. With debug off, the loader provides a read-only `window.DBAL` so the baked balance profile still applies. Nothing outside the block may *require* debug globals; always check first (`window.logDebugIssue&&…`).
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
  - `stat()` returns the derived stat sheet (wrapped by 6 layers; ~4 µs, **don't cache it**).
  - `LV(k)` returns a research level.
  - `BX(k)` returns a balance multiplier.
- **Render:** `draw()` → `drawHud()` + `VR[curTab]()` + hooks. `syncBoard()` diffs the tiles. Keep `draw()` free of layout reads; schedule them with `requestAnimationFrame` (see the v60 `fitSoon`).
- **Combat timing:** combat chains are `async` and use `await wait(ms)`, never raw `setTimeout`. `wait()` respects game speed, holds while `PAUSED`, and parks abandoned chains when `abortCombat()` bumps `BEP`.
- **Saving:** `save()` writes `localStorage.gg1` (throttled to 400 ms, flushed on hide or `pagehide`) plus IndexedDB through `GGDB.write()`. The board, `E` and `P` are not saved; a reload starts a fresh fight. Add any new persistent field to `S`, give it a default, and validate it in `migrate()`.
- **Lifecycle:** use `GGLife.onVisibility(f)` and `GGLife.onResize(f)`. Don't add new raw `resize` or `visibilitychange` listeners.

## Code style

- **Match the surrounding code.** It's dense, minified-style ES2020: short names, long single-line functions, semicolons, `const`/`let`, arrow functions, no modules or imports, and no external libraries or fonts (single-file rule).
- **Tag new work with a version comment:** `/* v6.0.5 · what and why */`. Put new features in their own `<script id="vNNN-…">` layer rather than editing the base engine, unless you are fixing a base bug.
- **Wrappers:** call the original with `.apply(this,arguments)`, return its result, and put your own code in `try{}catch(e){}` so one layer can't break the others.
- **Escape everything:** pass any text that came from the save or the player through `esc()` before it goes into `innerHTML`. Use `textContent` for messages (`msg()` already does).
- **Don't create elements and listeners on every draw:** build once, then update properties (see the `drawHud` skill bar and its `hudH()` helper). Remove listeners or observers you attach to persistent elements.
- **No layout reads** (`getBoundingClientRect`, `offsetWidth`, `getComputedStyle`) inside `draw()`, `syncBoard()` or the cascade loop.
- **Guard `localStorage`:** wrap every read and write in `try{}catch(e){}`.
- **Persistent loops:** no `requestAnimationFrame` loop may run forever. Stop it when its view is hidden, and use a timer for low-frequency checks.

## Game rules that must hold

**Design rules:**
- **Defeat never takes anything.** `die()` pays a consolation purse of `PITY = 12.5%` of the node's win XP and gold, and gold, shards, materials and gear are never removed. Don't add penalties.
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
- NG+ tier `t` multiplies enemy HP and attack by `1+t` (`t ≤ 10`). Infinite Vault multiplies both by `1.15^(wave−1)`.
- Each difficulty keeps its own campaign progress (`S.dp`); hero, gold and gear are shared.

**Combat invariants:**
- **Cascade loop:** at most 80 steps (`guard<80`). Never recurse.
- **Combo:** `cm = 1 + (combo−1)·(Chain ? 1.5 : 1)` for the player and `1 + (combo−1)·0.5` for the enemy. Each multiplier is applied once per hit.
- **Caps:** next-skill `P.cc ≤ 5`, enemy block `≤ 0.9`, dodge `≤ 0.35`, cooldown reduction `≤ 0.3`, Cursed Rocks `≤ 12`.
- **Board recovery:** `ensure()` runs after every move and tactic. It tries up to 200 shuffles, then regenerates the board, so there is never a no-move state.
- **Boss enrage:** after player turn `15 + LV('pvt')` (skulls ×2, permanent burn). Tactics fire on enemy turns where `E.tc % 3 == 0`.
- **4+ match:** gives the player an extra turn (unless the Chain keystone is active). The enemy gets at most 3 chained turns.
- **Fight transitions:** the next enemy must never be created while `busy` is true. Defer through `pnext` and `settle()`.
- **No free heals:** a live fight's HP and ailments must not be reset by UI actions (class switch, menus). See audit C1.

**Known open issues:** read `AUDIT_REPORT.md` before working on combat, economy or class code. Currently open: C1, W1–W4 and L1–L8.
