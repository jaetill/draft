// L1 engine — tier + roster need (simple).
//
// Uses VBD as the underlying value (same as L2) so positional scarcity is
// respected — without scarcity, raw projection makes QB1 look better than
// RB1, which is wrong in any league with multiple skill-position starters.
//
// What makes L1 "simpler" than L2: a flat need multiplier with no flex
// distinction and no position-specific tweaks. L1 treats every starter
// shortfall the same; L2 layers in flex preferences and per-position bias
// (e.g., not over-prioritizing DEF, penalizing TE-as-flex).

import { posLabel } from './labels.js';

function needMultiplier(player, state) {
  const needs = state.myNeeds();
  if (needs.starterShortfall[player.position] > 0) return 1.3;
  if (needs.benchRoom > 0) return 1.0;
  return 0;
}

function rationale(player, state, rankings) {
  const pos = player.position;
  const r = rankings.posRank.get(player.id);
  const t = rankings.tier(player);
  const needs = state.myNeeds();
  const reasons = [];

  if (needs.starterShortfall[pos] > 0) {
    reasons.push(`fills ${pos} starter`);
  } else if (needs.benchRoom > 0) {
    reasons.push(`${posLabel(pos)} depth`);
  }
  reasons.push(`${pos}${r} (tier ${t})`);
  return reasons.join(' · ');
}

export function recommend(state, rankings, n = 5) {
  const replacement = {};
  for (const [pos, cutoff] of Object.entries(state.cfg.replacement_levels || {})) {
    if (pos.startsWith('_')) continue;
    replacement[pos] = rankings.replacementPoints(pos, cutoff);
  }

  const available = state.available();
  const scored = [];
  for (const p of available) {
    const mult = needMultiplier(p, state);
    if (mult === 0) continue;
    const projection = rankings.projection(p);
    const repl = replacement[p.position] ?? 0;
    const vbd = Math.max(0, projection - repl);
    const score = vbd * mult;
    scored.push({
      player: p,
      score,
      vbd,
      mult,
      tier: rankings.tier(p),
      posRank: rankings.posRank.get(p.id) ?? 999
    });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, n).map((s) => ({
    ...s,
    rationale: rationale(s.player, state, rankings)
  }));
}
