/* v6.1.2 · difficulty-tiers: 15-tier difficulty curve generator.
 *
 * Run:   node tools/difficulty-tiers.ts                 # print JSON to stdout
 *        node tools/difficulty-tiers.ts --out=tools/difficulty-tiers.json
 *        node tools/difficulty-tiers.ts --md            # Markdown table instead
 * Needs Node >= 22.18 (built-in type stripping, no tsc or build step). The file only uses
 * erasable TypeScript syntax (types/interfaces, no enums or namespaces) so that works.
 *
 * Model: every knob is a piecewise compound exponential, one growth rate per band:
 *     V(L) = V(L_b) * (1 + g_b) ^ (L - L_b)
 * where L_b is the last tier of the previous band (tier 1 for band A). Inside a band this is
 * exactly Base * (1 + g)^(L - 1) with the band's own Base, and the anchors keep the curve
 * continuous across bands, so steepening shows up as a kink in slope, never a jump in value.
 * Knobs that fall with difficulty (turn_to_enraged, resource_gain_modifier) use a negative g.
 *
 * The script fails (exit 1) if any invariant below is broken, so a retune can't ship a curve
 * that is non-monotonic, decelerating, below a floor or over a cap.
 */

type Band = 'A' | 'B' | 'C';
type Knob = 'enemy_hp_multiplier' | 'skull_damage_multiplier' | 'turn_to_enraged' | 'status_ailment_chance' | 'resource_gain_modifier';

interface KnobSpec {
  base: number;                 // value at tier 1
  g: Record<Band, number>;      // per-tier growth rate inside each band (negative = decay)
  floor?: number;
  cap?: number;
  round: (v: number) => number; // presentation precision; int knobs round here
  dir: 1 | -1;                  // +1 rises with difficulty, -1 falls
}

interface Row {
  tier: number;
  name: string;
  band: string;
  enemy_hp_multiplier: number;
  skull_damage_multiplier: number;
  turn_to_enraged: number;
  status_ailment_chance: number;
  resource_gain_modifier: number;
  diagnostics: {
    kill_window_index: number;  // HP needed per turn before enrage, vs tier 1
    threat_index: number;       // incoming pressure per turn (skull × ailment), vs tier 1
    reward_per_hp_index: number;// payout per point of enemy HP, vs tier 1
    clamped: Knob[];
  };
  Design_Intent: string;
}

const BANDS: { id: Band; from: number; to: number; label: string }[] = [
  { id: 'A', from: 1, to: 5, label: 'Casual/Story' },
  { id: 'B', from: 6, to: 10, label: 'Optimized' },
  { id: 'C', from: 11, to: 15, label: 'Masochist/Endgame' },
];

const r2 = (v: number) => Math.round(v * 100) / 100;
const r3 = (v: number) => Math.round(v * 1000) / 1000;

/* Tuning surface. Growth must strictly accelerate A -> B -> C (checked below). */
const KNOBS: Record<Knob, KnobSpec> = {
  // 0.6x at tier 1 matches today's Story row; ~0.94x at 5 ≈ Normal; ~2.16x at 10; ~8x at 15.
  enemy_hp_multiplier:     { base: 0.60, g: { A: 0.12, B: 0.18, C: 0.30 }, round: r2, dir: 1 },
  // Skulls stay near 1x while the player learns, then compound to ~4.8x at the top.
  skull_damage_multiplier: { base: 0.90, g: { A: 0.05, B: 0.12, C: 0.20 }, round: r2, dir: 1 },
  // 15 turns at tier 1 (engine default 15 + LV('pvt')); decays to the hard floor of 8.
  turn_to_enraged:         { base: 15, g: { A: -0.01, B: -0.04, C: -0.08 }, floor: 8, round: Math.round, dir: -1 },
  // Capped at 0.75 so at least one Elite/Boss action in four stays clean (counterplay window).
  status_ailment_chance:   { base: 0.05, g: { A: 0.20, B: 0.21, C: 0.24 }, cap: 0.75, round: r3, dir: 1 },
  // Payout squeeze; reaches the 0.4x floor at tier 15.
  resource_gain_modifier:  { base: 1.00, g: { A: -0.02, B: -0.05, C: -0.12 }, floor: 0.40, round: r3, dir: -1 },
};

const NAMES = ['Pilgrim', 'Wanderer', 'Apprentice', 'Journeyman', 'Adept',
  'Tactician', 'Strategist', 'Veteran', 'Warden', 'Champion',
  'Scourge', 'Torment', 'Abyssal', 'Oblivion', 'Endless Grind'];

const INTENT: string[] = [
  /* 1 */ 'Onboarding. Enemies die well inside the 15-turn window to any legal swap; tests only that the player understands swapping, colour→mana and that skulls are the threat. Ailments are rare enough to be read as a tutorial event.',
  /* 2 */ 'Line shape. Rewards making 4-in-a-row for the extra turn over the first match seen; a player who never chains still wins, one who does wins in about half the turns.',
  /* 3 */ 'Skull triage. Skull damage reaches 1x, so the test is denying enemy skull matches (clearing skull lines before they fall to the enemy) rather than pure damage racing.',
  /* 4 */ 'First skill rotation. HP outgrows raw matching; the player must spend mana on a skill every few turns instead of hoarding, and first sees enrage as a real deadline on bosses.',
  /* 5 */ 'Normal baseline (≈ the current Normal row). Boss tactics on every third enemy turn now cost real HP; tests reading the board after a reshape and planning potions for guardians.',
  /* 6 */ 'Cascade awareness. The kill window shrinks while HP compounds at 18%/tier: the player must favour low-board matches that drop new lines (combo multiplier) over top-board safe moves.',
  /* 7 */ 'Ailment management. ~15% of Elite/Boss actions carry Burning/Poison/Freeze; tests cleansing or out-racing damage-over-time and not wasting a frozen turn window.',
  /* 8 */ 'Mana efficiency (past Hard: ~1.5x HP and skulls). Every skill cast must be timed to a full board state; tests banking mana toward one burst into an enemy vulnerability rather than casting on cooldown.',
  /* 9 */ 'Gear & research check. Raw HP at ~1.8x with 12 turns to enrage means un-upgraded gear fails mathematically; tests whether the player has invested in forge and research instead of pushing.',
  /* 10 */ 'Optimized ceiling (above Grindmaster: ~2.2x HP, ~1.9x skulls). Requires a deliberate opener: set up a 4+/Catalyst on turn 1–3, sustain combos ≥3 on average, and finish before enrage at 12.',
  /* 11 */ 'Mega-combo entry. HP growth jumps to 30%/tier; average play no longer clears before enrage. Tests engineering cascades ≥5 and chaining extra turns, not finding them by luck.',
  /* 12 */ 'Enrage is assumed. The window (~10 turns) is shorter than a clean kill for most builds; tests surviving post-enrage skulls ×2 + scorch with shields, cleanses and heal timing.',
  /* 13 */ 'Status saturation. Over half of Elite/Boss actions inflict an ailment; tests build choice (resistances, cleanse skills) as much as board play — the wrong loadout cannot win.',
  /* 14 */ 'Near-perfect execution. 8 turns to enrage, ~6.2x HP, 4x skulls and ~64% ailments; every turn must either set up or cash in a mega-combo. One wasted move is usually the fight.',
  /* 15 */ 'Masochist ceiling. Enrage at the 8-turn floor, ~8x HP, ~4.8x skulls, ailments at the 0.75 cap, rewards at the 0.4x floor: solvable only with a min-maxed build plus Catalyst wipes and long cascades. A prestige tier, not a farming tier.',
];

function bandOf(L: number) { return BANDS.find(b => L >= b.from && L <= b.to)!; }

/* Raw (unrounded, unclamped) compound value at tier L. */
function curve(k: KnobSpec, L: number): number {
  let v = k.base;
  for (let t = 2; t <= L; t++) v *= 1 + k.g[bandOf(t).id];
  return v;
}

function evalKnob(name: Knob, L: number, clamped: Knob[]): number {
  const k = KNOBS[name];
  let v = curve(k, L);
  if (k.floor !== undefined && v < k.floor) { v = k.floor; clamped.push(name); }
  if (k.cap !== undefined && v > k.cap) { v = k.cap; clamped.push(name); }
  v = k.round(v);
  if (k.floor !== undefined && v < k.floor) v = k.floor; // rounding must never undercut a floor
  return v;
}

function build(): Row[] {
  const rows: Row[] = [];
  for (let L = 1; L <= 15; L++) {
    const clamped: Knob[] = [];
    const b = bandOf(L);
    const hp = evalKnob('enemy_hp_multiplier', L, clamped);
    const sk = evalKnob('skull_damage_multiplier', L, clamped);
    const te = evalKnob('turn_to_enraged', L, clamped);
    const ai = evalKnob('status_ailment_chance', L, clamped);
    const rg = evalKnob('resource_gain_modifier', L, clamped);
    rows.push({
      tier: L, name: NAMES[L - 1], band: `${b.id} · ${b.label}`,
      enemy_hp_multiplier: hp, skull_damage_multiplier: sk, turn_to_enraged: te,
      status_ailment_chance: ai, resource_gain_modifier: rg,
      diagnostics: { kill_window_index: 0, threat_index: 0, reward_per_hp_index: 0, clamped },
      Design_Intent: INTENT[L - 1],
    });
  }
  const t1 = rows[0];
  for (const r of rows) {
    r.diagnostics.kill_window_index = r2((r.enemy_hp_multiplier / r.turn_to_enraged) / (t1.enemy_hp_multiplier / t1.turn_to_enraged));
    r.diagnostics.threat_index = r2((r.skull_damage_multiplier * (1 + r.status_ailment_chance)) / (t1.skull_damage_multiplier * (1 + t1.status_ailment_chance)));
    r.diagnostics.reward_per_hp_index = r3((r.resource_gain_modifier / r.enemy_hp_multiplier) / (t1.resource_gain_modifier / t1.enemy_hp_multiplier));
  }
  return rows;
}

function validate(rows: Row[]): string[] {
  const err: string[] = [];
  if (rows.length !== 15) err.push(`expected 15 tiers, got ${rows.length}`);
  for (const [name, k] of Object.entries(KNOBS) as [Knob, KnobSpec][]) {
    // Accelerating curve: |g| strictly grows A -> B -> C for every knob.
    const [a, b, c] = [Math.abs(k.g.A), Math.abs(k.g.B), Math.abs(k.g.C)];
    if (!(a < b && b < c)) err.push(`${name}: growth must accelerate A<B<C (got ${a}, ${b}, ${c})`);
    for (let i = 1; i < rows.length; i++) {
      const p = rows[i - 1][name], q = rows[i][name];
      if (k.dir === 1 ? q < p : q > p) err.push(`${name}: not monotonic at tier ${i + 1} (${p} -> ${q})`);
    }
    if (k.cap !== undefined && rows.some(r => r[name] > k.cap!)) err.push(`${name}: exceeds cap ${k.cap}`);
    if (k.floor !== undefined && rows.some(r => r[name] < k.floor!)) err.push(`${name}: below floor ${k.floor}`);
  }
  if (rows.some(r => !Number.isInteger(r.turn_to_enraged) || r.turn_to_enraged < 8)) err.push('turn_to_enraged must be an integer >= 8');
  if (rows.some(r => r.resource_gain_modifier < 0.4)) err.push('resource_gain_modifier must be >= 0.4');
  if (rows.some(r => r.status_ailment_chance < 0 || r.status_ailment_chance > 1)) err.push('status_ailment_chance must be a probability');
  if (rows.some(r => !r.Design_Intent)) err.push('every tier needs a Design_Intent');
  return err;
}

function markdown(rows: Row[]): string {
  const h = '| Tier | Name | Band | Enemy HP | Skull dmg | Enrage turn | Ailment % | Resources | Kill-window idx | Design_Intent |\n|---|---|---|---|---|---|---|---|---|---|\n';
  return h + rows.map(r => `| ${r.tier} | ${r.name} | ${r.band} | ${r.enemy_hp_multiplier}× | ${r.skull_damage_multiplier}× | ${r.turn_to_enraged}${r.diagnostics.clamped.includes('turn_to_enraged') ? ' (floor)' : ''} | ${(r.status_ailment_chance * 100).toFixed(1)}% | ${r.resource_gain_modifier}×${r.diagnostics.clamped.includes('resource_gain_modifier') ? ' (floor)' : ''} | ${r.diagnostics.kill_window_index}× | ${r.Design_Intent} |`).join('\n') + '\n';
}

function main(argv: string[]) {
  const rows = build();
  const errs = validate(rows);
  if (errs.length) { for (const e of errs) console.error('✗ ' + e); process.exit(1); }
  const outArg = argv.find(a => a.startsWith('--out='));
  const text = argv.includes('--md') ? markdown(rows) : JSON.stringify({
    generator: 'tools/difficulty-tiers.ts',
    formula: 'V(L) = V(L_b) * (1 + g_band)^(L - L_b), continuous at band edges',
    growth: Object.fromEntries(Object.entries(KNOBS).map(([n, k]) => [n, { base: k.base, ...k.g, floor: k.floor ?? null, cap: k.cap ?? null }])),
    tiers: rows,
  }, null, 2) + '\n';
  if (outArg) { (globalThis as any).process.getBuiltinModule('fs').writeFileSync(outArg.slice(6), text); console.error(`✓ ${rows.length} tiers → ${outArg.slice(6)}`); }
  else process.stdout.write(text);
}

declare const process: any;
main(process.argv.slice(2));
