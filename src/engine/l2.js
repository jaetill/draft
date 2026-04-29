// L2 engine — VBD (Value Based Drafting).
// Player value = projected points minus replacement-level player at that position.
// Replacement levels come from data/league.json (QB12, RB30, WR36, TE15, DEF12 for
// 12-team PPR with 2 RB / 2 WR / 1 TE / 2 FLEX starters).
//
// The big idea: a 380-point QB1 only beats QB12 by ~50 points, while a 330-point
// RB1 beats RB30 by ~150. So RB1 is more "valuable" than QB1 even with fewer raw
// points — scarcity dominates. VBD makes this explicit.

import { posLabel } from './labels.js';

function needMultiplier(player, state) {
  const needs = state.myNeeds();
  const pos = player.position;
  const flexEligible = state.cfg.flex_eligible.includes(pos);
  const tePenalty = state.cfg.te_flex_penalty ?? 0.5;

  if (needs.starterShortfall[pos] > 0) {
    return pos === 'DEF' ? 1.0 : 1.4;
  }
  if (flexEligible && needs.flexShortfall > 0) {
    if (pos === 'TE') return tePenalty; // TE-as-flex strongly disfavored
    return 1.15;
  }
  if (needs.benchRoom > 0) {
    if (pos === 'DEF') return 0.15;
    if (pos === 'QB') return 0.5;
    return 1.0;
  }
  return 0;
}

function rationale(player, state, rankings, vbd) {
  const pos = player.position;
  const r = rankings.posRank.get(player.id);
  const t = rankings.tier(player);
  const needs = state.myNeeds();
  const reasons = [];

  reasons.push(`+${vbd.toFixed(0)} VBD`);

  if (needs.starterShortfall[pos] > 0 && pos !== 'DEF') {
    reasons.push(`fills ${pos} starter`);
  } else if (state.cfg.flex_eligible.includes(pos) && needs.flexShortfall > 0) {
    reasons.push('flex slot');
  } else if (needs.benchRoom > 0) {
    reasons.push(`${posLabel(pos)} depth`);
  }

  reasons.push(`${pos}${r} (tier ${t})`);
  return reasons.join(' · ');
}

/**
 * Recommend top N picks using VBD.
 *
 * @returns {Array<{player, score, vbd, mult, tier, posRank, rationale}>}
 */
export function recommend(state, rankings, n = 5) {
  const replacement = {};
  for (const [pos, cutoff] of Object.entries(state.cfg.replacement_levels || {})) {
    if (pos.startsWith('_')) continue;
    replacement[pos] = rankings.replacementPoints(pos, cutoff);
  }

  const currentRound = Math.ceil(state.currentPick / state.teams);
  const defEarliestRound = state.cfg.def_earliest_round ?? state.totalRounds;

  const available = state.available();
  const scored = [];
  for (const p of available) {
    if (p.position === 'DEF' && currentRound < defEarliestRound) continue;
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
    rationale: rationale(s.player, state, rankings, s.vbd)
  }));
}
