# Gemgrind v6.0.4 Audit Report

**Scope:** `index.html` (single-file game, ~8.3k lines), `sw.js`, `manifest.webmanifest`, at commit `5dfb879` on `claude/code-efficiency-review-0dlfx3`. That commit includes the efficiency changes in PR #1.

**Method:**
- **Static reading** of the combat, scaling, economy, save and UI code.
- **Live verification** in headless Chromium. Each finding is marked:
  - **✅ Verified:** reproduced in a running game.
  - **📐 Modelled:** computed by running the game's own formulas, with stated assumptions.
  - **🔍 Static:** read from code, not executed.

Line numbers refer to `index.html` at that commit.

---

## Status (2026-11-04)

**Fixed in v6.0.5:** C1, W1, W3, W4. Each was re-tested against the pre-fix build in a running game; the before/after results are listed under each finding. **Still open:** W2 and L1–L8.

## Severity summary

| # | Severity | Finding | Evidence |
|---|---|---|---|
| C1 | **Critical** | Switching class mid-battle gives a free full heal + cleanse | ✅ Verified (real taps) · **Fixed** |
| W1 | **Warning** | Victory modal "Continue" isn't locked while a cascade runs, so the cascade leaks into the next fight | ✅ Verified · **Fixed** |
| W2 | **Warning** | Late-campaign enemy HP grows roughly cubically against a linear player base; boss enrage at turn 16 becomes a wall | 📐 Modelled |
| W3 | **Warning** | Consolation purse can out-earn winning per turn in the late game (fail-farming) | 📐 Modelled + 🔍 · **Fixed** |
| W4 | **Warning** | An enemy Catalyst+Catalyst wipe ignores the enemy's halved combo slope (flat ×5), stacking to ×20 on enraged Grindmaster bosses | 🔍 Static · **Fixed** |
| L1 | Low | Day/night "+25% yield" is a flat +0.25 item per gem, diluted by combo | 🔍 Static |
| L2 | Low | Infinite Vault scales enemy HP *and* attack by 1.15^wave (exponential, no cap) | 🔍 Static |
| L3 | Low | Boss tactic clock: Stun pauses the 3-turn clock, Freeze advances it (inconsistent) | 🔍 Static |
| L4 | Low | The "Barren Emeralds" challenge rule changes the board inside `syncBoard()` (a render function) | 🔍 Static |
| L5 | Low | Save import doesn't clamp level / most numbers (`c.l = 99999` accepted) | ✅ Verified |
| L6 | Low | Debug GitHub token is stored in plain text in `localStorage` | 🔍 Static |
| L7 | Low | Per-cascade allocations: `groups()` / `find()` Sets and Maps, one new `<button>` per refilled gem | 🔍 Static |
| L8 | Low | Reload during a fight discards the fight (fresh enemy, full HP), an escape hatch from a losing fight | 🔍 Static |

**Checked and found sound** (no action needed):
- **Cascade loop is bounded:** it is a `for` loop capped at 80 steps (`guard<80`), not recursion.
- **Shuffling is bounded:** at most 200 shuffles, then the board is regenerated.
- **Cursed Rocks are capped:** at most 12 on the board.
- **No leftover day/night stats:** the bonus is recomputed from `S.trav` on every collect, so nothing persists across zones or reloads.
- **No XSS from imported saves:** a save whose hero, item, pet and rune names contained HTML/JS was imported and every tab rendered; nothing executed (`esc()` covers every path tested).
- **No pouch item loss on reload:** Pouch research applies before the pouch is truncated (25 shards at cap 30 survived two reloads).
- **No UI listener or DOM leaks:** 60 open/close cycles of Console, Menagerie, Lab, Forge, Tree, Pouch, Shop and Settings over a live battle left JS event listeners at 285, DOM nodes at 3,369 and the heap at 4.3 → 4.7 MB.
- **Abandoned combat chains stop cleanly:** `wait()` parks them on a promise that never resolves, which the garbage collector can reclaim.

---

## 1. Difficulty scaling and mathematical balance

### How scaling works (reference)

| Layer | Formula | Location |
|---|---|---|
| Base enemy HP | `ehp(s) = (30 + 1.1·s² + 28·s) × (boss 1.8) × DIFF.eh × (Avarice 1.4) × BAL.eh` | 1320 |
| Base enemy attack | `eat(s) = (5 + 1.5·s) × (boss 1.25) × BAL.ed` | 1320 |
| Stage from level | `s = 1 + 0.21·(L−1)` (+2 for a guardian), with `L = 10·continent + ⌊town/2⌋ + 1`, up to 500 | 4411–4415 |
| Campaign modifier | `m = 1 + 0.12·ci + 0.02·j`, then `× 1.04^(ci−39)` from continent 41 (m ≈ 10.78 at the last guardian) | 3935 |
| Difficulty | `eh` 0.6 / 0.8 / 1 / 1.3 / 1.7, `ed` 1 / 1 / 1 / 1.2 / 1.5, `sk` ×2 on Grindmaster, block `bl` up to 0.40 | 1033 |
| NG+ | `× (1+t)` HP and attack, t ≤ 10 | 5209 |
| Rewards | `× sqrt(m)` | 3966 |

### W2 · Late-campaign wall: enemy HP outgrows the hero's base scaling  [Warning · 📐]

**Model** (the game's own `need()`, `ehp()`, `stat()`, `genItem()` and `newEnemy()` run in the page):
- The hero levels from **only the required fights** at each node (no extra grinding).
- The hero wears **all-Rare gear of their own level**.
- **No passives, research, pets or keystones.**
- About **3 skulls per turn** at combo ×1.3.
- Numbers are for the node's guardian.

| Node (continent) | Hero Lv | Enemy Lv | Normal: turns to kill / turns to die | Grindmaster: turns to kill / turns to die |
|---|---|---|---|---|
| 0 (C1) | 2 | 1 | 4.7 / 7.4 | 6.6 / 2.8 |
| 209 (C10) | 36 | 100 | 14.4 / 6.8 | 19.8 / 2.4 |
| 419 (C20) | 68 | 200 | 30.2 / 5.0 | 35.2 / 1.9 |
| 839 (C40) | 137 | 400 | 66.3 / 2.9 | 148.5 / 1.1 |
| 1049 (C50) | 177 | 500 | 141.5 / 2.1 | 243.5 / 0.7 |

**Root risk:**
- **Enemy HP grows roughly cubically with level.** HP is quadratic in `s`, `s` is linear in level, and the campaign modifier adds about another factor of level, plus 4% compounding from continent 41.
- **The hero's base attack grows linearly:** `b.a + 1.6·L + gear`.
- **Everything else must close the gap multiplicatively:** passives, research, pets, keystones.
- **Boss enrage is a fixed 15 + `pvt` turns.** Once turns-to-kill passes about 16 (between continents 10 and 20 on Normal: 14.4 → 30.2), every guardian becomes "survive doubled skulls". By continent 40, turns-to-die is already ≤ 3.
- **Rewards scale with `sqrt(m)`** (×3.3 at the end) while enemies scale with `m` (×10.8), so grinding catches up more slowly the further you go.

The excluded systems can multiply damage several times over, so this is **not proof the endgame is impossible**. It does mean the endgame relies on them, and that should be a deliberate, tested target.

**Fix: add a balance harness, then choose a curve.** This is a design decision, so here are the options:

```diff
 /* 3966 · rewards keep pace with enemy growth (currently sqrt) */
-rewardMul=m=>Math.sqrt(Math.max(1,m||1))
+rewardMul=m=>Math.pow(Math.max(1,m||1),.75)

 /* 1824 · enrage clock stretches with the campaign so a fixed 16 turns isn't a wall at continent 40+ */
-if(E.boss&&!E.enr&&E.pt>15+LV('pvt')){
+const enrAt=15+LV('pvt')+(E.lvl?Math.floor(E.lvl/50):0);   // +1 turn per 50 enemy levels, +10 at the end
+if(E.boss&&!E.enr&&E.pt>enrAt){
```
The HUD at line 1920 prints `16+LV('pvt')-(E.pt||0)` and must use the same `enrAt`; move it into a shared helper `enrageAt()`.

**Harness built (v6.0.6).** `window.GGBalance` (`<script id="v606-balance-harness">`) runs the game's own `newEnemy()`, `stat()`, `heal()`, `genItem()` and `eBlock()` on a cloned save, and `tools/balance-sim.js` drives it from the command line. It checks results against `tools/balance-baseline.json` (one fight per line, 0.5% tolerance) and, optionally, against design targets. The debug console's **📐 Balance sim** button runs the same model on the phone.

Default run (bare Warrior, required fights only, all-Rare gear, 3 skulls per turn, 750 fights, ~130 ms):

| Difficulty | First guardian the bare hero loses | First guardian that can't be killed before enrage | Peak power needed |
|---|---|---|---|
| Story | C9 | C29 (city guardian) | ×26.8 (C49) |
| Casual | C8 | C21 (city guardian) | ×43.9 (C50 city) |
| Normal | C4 | C14 | ×81.7 (C50) |
| Hard | C1 | C8 | ×97.5 (C50) |
| Grindmaster | C1 (city guardian) | C11 | ×220.8 (C49) |

**Power needed** is how much the excluded systems (passives, skills, research, pets, keystones) must multiply the bare hero's damage to win. It climbs from below ×1 to ×80+ on Normal, so how much those systems actually provide decides whether the endgame is winnable.

**Next steps (design decisions):**
1. **Calibrate the model:** the Bug Monitor's per-fight BALANCE lines (turns, damage dealt and taken) from real playtests show the real skulls per turn and combo; pass them as `--skulls` and `--combo`.
2. **Measure real builds:** run `GGBalance.run({build:'current'})` on well-built playtest saves to see what multiplier those systems really provide.
3. **Write the targets:** copy `tools/balance-targets.example.json` to `balance-targets.json` with real numbers, then tune `campaignStatModifier`, `rewardMul` and the enrage turn until `--targets … --strict` passes. Re-record the baseline in the same commit.

### Boss ticker logic (enrage + tactics)  [🔍 Pass, with L3]

**Enrage:**
- Triggers after the hero's turn `15 + LV('pvt')` (`turnTick`, 1824).
- Doubles enemy skull damage and burns the board every round.
- It's one-way (`!E.enr`), so it can't re-trigger.

**Tactics** (`bossTactic`, 1813):
- Fire on enemy turns where `E.tc % 3 == 0`.
- Rocks are capped at 12. A frozen row lasts 3 turns.
- Tactics can never soft-lock the board: `ensure()` runs after each one, shuffles up to 200 times, then regenerates the board (1701).
- Difficulty doesn't change these timers, so they can't produce broken states by themselves.

**L3 [Low]:** in `foe()` (1884), a **stunned** boss returns *before* `E.tc++`, which pauses the tactic clock. A **frozen** boss returns *after* `E.tc++`, which advances it. Pick one rule (stun and freeze should probably both pause it) and move `E.tc++` below both checks.

### Balance thresholds: player burst vs. high-difficulty HP  [🔍 Pass]

- **Combo multiplier is linear:** `cm = 1 + (combo−1)·(Chain ? 1.5 : 1)`. The cascade loop is capped at 80 steps, and `P.cc` (next-skill multiplier) is capped at 5.
- **Catalyst+Catalyst is a one-step flat ×5 wipe:** `hit(atk·0.25·49·5)`, about 61× Attack plus skulls.
- **It doesn't invalidate high-difficulty HP:** at the model's final guardian, enemy HP is about 430× (Normal) to 730× (Grindmaster) hero Attack, so a wipe (≈ 90× Attack including skulls) deals about 12–21%. In mid-game (continent 10, ≈ 43× Attack) a wipe can still one-shot, which is fine for a rare combo. Player burst is **not** the problem; the shortfall is (W2).

### W3 · Consolation purse loop (fail-farming)  [Warning · 📐 + 🔍] · ✅ FIXED

> **Fixed as proposed below.** Re-test at node 300: the purse is 110 / 330 / 551 XP for 0% / 50% / 100% of enemy HP dealt (before: the same at every share).

`die()` → `defeatPity()` (1344) pays `PITY = 12.5%` of that node's win XP and gold, scaled by the difficulty's reward factor `r` and by `sqrt(cmod)`. **Retry Encounter** re-fights the same foe immediately.

**Root risk:**
- The purse doesn't depend on **how much of the fight you played**, so a loss in one turn pays the same as a loss at 1 HP from victory.
- Winning yields 1.0 per win at a cost of roughly turns-to-kill. Losing yields 0.125 at a cost of roughly turns-to-die.
- Once turns-to-kill exceeds about **8× turns-to-die**, dying is the better income per turn. In the W2 model that happens around **continent 30 on Normal** (51 / 4.1 ≈ 12×) and **continent 10 on Grindmaster** (19.8 / 2.4 ≈ 8×). Per-fight overhead (reward screen, retry tap) narrows the gap slightly but doesn't close it.
- Each difficulty has its own progress (`S.dp`, 6826), so this needs real progress on that difficulty. It's not instantly exploitable, but it rewards the wrong behaviour exactly where the game is hardest.

**Fix:** keep the "always gain something" rule, but scale the purse by the share of the enemy's HP you removed:
```diff
 /* 1344 */
 function defeatPity(){if(GT||!E)return{x:0,g:0};const d=D(),st=stat(),s=E.s||1,boss=E.boss,em=E.elite&&!boss?1.5:1,
   xw=Math.floor(15*s*(1+s*.15)*d.r*em),g=Math.floor((6+4*s)*st.gold*(boss?3:1)*d.r*em);
-return{x:Math.max(1,Math.round(xw*PITY)),g:Math.max(1,Math.round(g*PITY))}}
+/* effort-weighted: 20% of the purse for showing up, the rest for the share of HP you took off the foe */
+const share=E.mx>0?Math.min(1,Math.max(0,(E.mx-Math.max(0,E.hp))/E.mx)):0,k=PITY*(.2+.8*share);
+return{x:Math.max(1,Math.round(xw*k)),g:Math.max(1,Math.round(g*k))}}
```
The campaign wrapper at 3980 multiplies the result and needs no change.

---

## 2. Match-3 cascades and RPG state

### W1 · The victory modal lets the next fight start mid-cascade  [Warning · ✅] · ✅ FIXED

> **Fixed more centrally than the diff below,** because the Vault (`vaultWin`) and Challenge (`chWin`) victory screens have their own Continue buttons. `resolve()` pins `const E0=E` and checks `if(E!==E0)break` at the top of each step and after each of its `await wait()` points; `swap()` only runs `foe()` while `E===E0`. Re-test with a real long cascade and an instant Continue: before, the next enemy was hit (59 → 19 HP) and took the first turn; after, it stays at 59/59 and takes no turn, and the board is intact.

**Sequence:**
1. In `resolve()` (1836), the player's cascade keeps looping after the enemy dies. It only breaks on the *player's* death: `if(who&&dead)break`.
2. A skull hit that kills the enemy calls `win()` (1331). `win()` shows the reward modal at once via `rew(...)` (1343), and its button runs `next` → `newEnemy()` directly.
3. The quick-result path already defers through `pnext` and `settle()`. The modal path doesn't.

**Reproduced** (with `busy=true`, as during a cascade):
- Killing the enemy shows the modal, and Continue is clickable.
- One click replaced `E` while `busy` was still true.
- The old cascade's next `hit()` then damaged the **new** enemy (59 → 39 HP).
- `swap()`'s tail (`else{await foe()…}`) would run the new enemy's turn first, because `foe()` only checks `E.dead`.

**Root risk:** the game state machine has no "between fights" phase. Reward UI, enemy creation and cascade tail all share the mutable `E`/`P`, and only `busy` separates them.

**Fix:** defer the transition exactly like the quick-result path does, and check that the enemy hasn't changed before the enemy turn:
```diff
 /* 1343 · win() */
-rew(boss?'👑 Guardian slain':…,R,story,[['🗺️ Continue journey',next,'on']])}
+rew(boss?'👑 Guardian slain':…,R,story,[['🗺️ Continue journey',()=>{if(busy){pnext=next;return}next()},'on']])}

 /* swap() tail · never let a stale chain act for a different enemy */
-busy=true;const mega=…
+busy=true;const E0=E;const mega=…
 …
-else{await foe();await ensure();save()}}busy=false;settle();draw()}
+else if(E===E0){await foe();await ensure();save()}}busy=false;settle();draw()}
```
`settle()` already runs `pnext` once `busy` clears, so the reward screen closes immediately and the new fight starts as soon as the board is idle.

### Multiplier stacking  [🔍 Pass, with W4]

Every multiplier is applied **once per hit** and none compound across steps:
- `hit()` (1780) multiplies `st.dmg × crit 1.75 × BX × sunder 1.2 × curse 1.15`, then armor penetration.
- The enemy path in `pdmg()` (1786) applies `D().ed × curse 0.75`.
- The combo `cm` is recomputed from the running `combo` count each step; it isn't multiplied into the previous step's value.
- Enrage ×2 and Grindmaster `sk` ×2 are applied exactly once in the skull expression.

### W4 · Enemy Catalyst+Catalyst ignores the enemy combo slope  [Warning · 🔍] · ✅ FIXED

> **Fixed as proposed below.** Re-test of an enemy wipe: the first skull hit went from 3.0× to 1.8× enemy attack per skull.

**How it happens:**
- Enemy cascades use a halved slope, `cm = 1 + (combo−1)·0.5`.
- `if(flat){combo=Math.max(combo,flat);cm=flat}` then overrides it with the player's flat ×5.
- `aiMove()` scores Catalyst pairs at +60, so the AI picks them whenever they're available.

**Damage:** on an enraged Grindmaster guardian, each skull on the wiped board hits for `E.at × 0.6 × 5 (flat) × 2 (enraged) × 2 (sk)`, which is 12× attack per skull. A typical board of about 7 skulls plus the `E.at × 3` wipe totals about 87× enemy attack in one move. In the model, the hero's whole HP + armor pool is about 4–18× enemy attack, so this is a guaranteed one-shot at any stage.

**Fix:** apply the enemy's slope to the flat value too:
```diff
 /* resolve(), 1836 block */
-if(flat){combo=Math.max(combo,flat);cm=flat}
+if(flat){combo=Math.max(combo,flat);cm=pl?flat:1+(flat-1)*.5}   // enemy wipes ×3, matching its halved combo slope
```

### Board clears vs. turn handlers  [🔍 Pass]

- A wipe is one cascade step: it marks all 49 cells, refills, and continues the same bounded loop.
- `cleanse()` runs once per step when Emeralds are matched, and is idempotent.
- Turn-end effects (`roundEnd`, `turnTick`) run outside `resolve()`, once per turn, so a wipe can't fire them twice.
- There's no recursion; nested specials go through the `again[]` queue inside the same loop.

---

## 3. RPG subsystems

### C1 · Class switch is a free mid-battle full heal  [Critical · ✅] · ✅ FIXED

> **Fixed, slightly stricter than the diff below.** HP also carries between fights (`rest()` restores only 30%), so a switch just before a fight was a free heal too. A class switch now **always** keeps the HP fraction (unless the hero is dead, where retry/return heal anyway). During a live fight it also keeps armor, ailments and the Phoenix flag. Re-test through the same taps: HP fraction 0.077 → 0.077 with Burning kept (before: → 1.0, cleared); between fights 0.5 → 0.5 (before: → 1.0).

**Path, reproduced with real taps at 420×860:** pause (Esc) → **☰ Main menu** → **⚙️ Settings** → Console **Hero** tab → **Change class** → pick any class.

**Result:** hero **5 → 62 / 62 HP**, Burning cleared, same enemy object still at **23 / 59 HP**. Esc returns to that same battle. It can be repeated every turn, which removes all danger from every fight, including guardians and Grindmaster.

**Root cause:**
- The class button (1932) runs `if(busy)return; S.cls=k; …; heal()`.
- `heal()` (1770) sets HP to the new maximum, rebuilds armor, and clears mana, ailments, thorns and the phoenix flag.
- The only guard is `busy` (an animation lock), not "a fight is in progress".
- Battle has no tab bar (focus mode), but the Settings route reaches the same Console.

**Fix:** treat a fight in progress as locked state. Keep the HP *fraction* and ailments, and still reset class-specific mana:
```diff
 /* 1932 · renderCls */
-e.onclick=()=>{if(busy)return;S.cls=k;wsel=-1;wcen=0;heal();$('clsm').hidden=true;upd()};
+e.onclick=()=>{if(busy)return;
+ const live=!GT&&E&&!E.dead&&!dead&&(E.pt>0||E.hp<E.mx);           // a fight is in progress
+ const f=live?P.hp/Math.max(1,stat().hp):1,arm=P.arm,st=Object.assign({},P.st);
+ S.cls=k;wsel=-1;wcen=0;heal();
+ if(live){const s=stat();P.hp=Math.max(1,s.hp*f);P.arm=Math.min(arm,s.cap);P.st=st}   // no free heal mid-fight
+ $('clsm').hidden=true;upd()};
```
A stricter option is to refuse the switch during a fight (`if(live){msg('Finish or retreat first.');return}`). Either way, add a regression check: during a battle with `P.hp=5`, switching class must leave `P.hp/max` unchanged.

### Leftover day/night stats  [✅ Pass · L1]

`DN` / `dnPh()` (1379) is derived from `S.trav` every time it's read, and `yb()` (1432) reads it during collection. No stat sheet holds the bonus, so nothing persists across zones or reloads.

**L1 [Low]:** `qq = (q + yb(m))`, where `q = round(combo)` and `yb()` is a flat +1 with 25% chance. That's "+25% yield" only at combo ×1; at ×4 it's about +6%. Either change the tooltip to "+1 item on 25% of gems", or make it proportional: `qq = q + Math.floor(q*b) + (Math.random() < (q*b)%1)`.

### Class switching: skills and passives  [🔍 Pass apart from C1]

- Each class keeps its own level, XP and passives (`S.c[cls]`, read through `C()`).
- `tstat()` is cached by `S.cls + ':' + c.n.join()`, so switching class gets a fresh cache key.
- The skill bar is rebuilt from `bar()` for the new class.
- No gold or XP refund is tied to switching.
- `setTier()` (6826) also calls `heal()`, but it aborts combat and creates a fresh enemy first, so it isn't exploitable.

### Inventory and Shard Pouch operations  [✅ / 🔍 Pass]

- **Equip** removes the item from the bag before placing it, then re-inserts the old item at the same index. That's a single synchronous step, so nothing can interleave or duplicate.
- **Unequip** refuses when the bag or pouch is full.
- **Rewards:** loot goes into the bag, or is auto-sold when the bag is full (`CAP_I = 40`).
- **Save restore** filters invalid shards and truncates to `POUCH_CAP`, but only after the research caps apply; verified with no item loss.

---

## 4. Security, fault tolerance and save integrity

**Context:** a single-player game with no server; the browser owns all state. "Spoofing" resources is equivalent to cheating in an offline game, so the goal is **integrity against bugs and crafted save strings**, not anti-cheat.

### Import validation  [✅ · L5 Low]

Tested by importing a crafted save string:

| Field | Payload | Result |
|---|---|---|
| Gold | `"12abc"` | Reset to 0 |
| Shards | `-500` | Reset to 0 |
| Essence | `1e308` | Clamped to 2⁵³−1 |
| Hero level | `99999` | Accepted as-is |
| Hero, item, pet and rune names | HTML/JS payload | Rendered on every tab; nothing executed |

**Fix (L5):** add one `clampInt(v, lo, hi, def)` pass in `migrate()` for levels, skill levels, research levels and counters.

**L6 [Low]:** the debug GitHub sync stores a personal access token in plain text in `localStorage` (`GHK`, 7886). It's only reachable in debug mode now, but any script on the origin could read it. Prefer a short-lived, fine-grained token scoped to the one repository, and don't save it unless the tester asks.

### Saving mid-cascade  [🔍 Pass · L8]

- `save()` serialises `S`, which holds progress, economy and gear. The board, the live enemy `E` and combat state `P` are **not** saved.
- Gains are added to `S` as they happen (`S.gold += gd` per step, loot in `win()`), and hiding the page flushes a save.
- So a force-close mid-cascade **keeps every gain already counted** and can't leave a corrupt board: the board is regenerated on load.
- The Esc pause (`PAUSED`) holds every `wait()`; nothing advances while paused.
- **L8:** a reload mid-fight restarts that fight with a fresh enemy at full HP. Defeat costs nothing anyway, so this is acceptable; document it as intended.

---

## 5. Performance and memory

**Already merged in PR #1:**
- Debug tools only load with `?debug=1`.
- Idle tutorial loop.
- Throttled `localStorage` save.
- `fit()` batched to once per frame.
- `drawHud()` rewrites markup only when it changed.

Battle `draw()` + layout went from ~3.2 ms to ~0.95 ms.

**L7 [Low] · cascade allocations:**
- Each cascade step allocates several Sets and Maps (`m`, `keep`, `rk`, `groups()`' union-find maps).
- Hint, AI and bot move search runs `find()` on all ~84 candidate swaps of the 7×7 board.
- Every cleared gem is a removed `<button>` and every refill a new one (`mkTile`).

At 49 cells this measured fine: `hintMove` takes about 0.2 ms. If cascade stutter appears on low-end Android:
1. Pool tiles (re-skin instead of remove/create).
2. Add an early-exit `swapMakesMatch(a, b)` that scans only the two rows and two columns through the swapped cells, and keep `groups()` for confirmed swaps.

**UI nesting:** verified no listener or node growth (see "Checked and found sound").

---

## Recommended order

1. ~~C1~~, ~~W1~~, ~~W4~~, ~~W3~~: fixed in v6.0.5.
2. ~~Build the balance harness~~ (done, v6.0.6). Next: calibrate it from playtest logs, set targets, then tune W2.
3. The Lows, opportunistically.
