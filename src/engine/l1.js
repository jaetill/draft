// L1 engine — tier + roster need.
// Pick the highest projected-value available player at a position you still need.
// Defers to projection (not raw rank) so DEF/K-style "low ceiling" positions
// don't get over-prioritized just because you have a starter shortfall there.

import { posLabel } from './labels.js';

/**
 * Multiplier applied to a player's projection based on whether their position
 * fills a starter slot, a flex slot, or just adds depth.
 */
function needMultiplier(player, state) {
  const needs = state.myNeeds();
  const pos = player.position;
  const flexEligible = state.cfg.flex_eligible.includes(pos);

  if (needs.starterShortfall[pos] > 0) {
    return pos === 'DEF' ? 1.0 : 1.5; // don't reach for DEF on shortfall alone
  }
  if (flexEligible && needs.flexShortfall > 0) {
    if (pos === 'TE') return 0.9; // TE is technically flex-eligible but humans rarely flex TE
    return 1.2;
  }
  if (needs.benchRoom > 0) {
    if (pos === 'DEF') return 0.2; // never backup DEF early
    if (pos === 'QB') return 0.55; // backup QB matters but rarely first move
    return 1.0; // RB/WR/TE depth is gold in PPR
  }
  return 0;
}

/**
 * Rank reasons we'd recommend a player. Used for the UI rationale string.
 */
function rationale(player, state, rankings) {
  const needs = state.myNeeds();
  const pos = player.position;
  const r = rankings.posRank.get(player.id);
  const t = rankings.tier(player);
  const reasons = [];

  if (needs.starterShortfall[pos] > 0 && pos !== 'DEF') {
    reasons.push(`fills ${pos} starter slot`);
  } else if (state.cfg.flex_eligible.includes(pos) && needs.flexShortfall > 0) {
    reasons.push('flex-eligible, you still need flex');
  } else if (needs.benchRoom > 0) {
    reasons.push(`${posLabel(pos)} depth`);
  }

  reasons.push(`${pos}${r} (tier ${t})`);
  return reasons.join(' · ');
}

/**
 * Recommend top N picks for the team currently on the clock (typically you).
 *
 * @param {DraftState} state
 * @param {object} rankings - from buildRankings()
 * @param {number} n - how many to return
 * @returns {Array<{player, score, rationale, tier, posRank}>}
 */
export function recommend(state, rankings, n = 5) {
  const available = state.available();
  const scored = [];

  for (const p of available) {
    const mult = needMultiplier(p, state);
    if (mult === 0) continue;
    const value = rankings.projection(p);
    const score = value * mult;
    scored.push({
      player: p,
      score,
      value,
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
