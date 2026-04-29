// Lookahead engine — for each candidate pick, simulate the opponents until my
// next turn, then evaluate what the BEST available player would be at that
// next turn. Re-rank candidates by `now_value + expected_future_value`.
//
// The classic insight: if I take a tier-1 RB now and a tier-1 WR will still be
// available at my next pick, that's better than taking the WR now (and losing
// the RB to a run before I pick again).
//
// Uses deterministic opponent picks (rng → 0) so the lookahead score is
// reproducible across renders. The mock harness's stochastic mode is fine for
// scenario practice; for "what should I do RIGHT NOW" guidance, determinism
// gives a stable answer.

import { recommend as recommendL2 } from './l2.js';
import { recommend as recommendL1 } from './l1.js';
import { pickForOpponent } from '../mock/draft-sim.js';

const DETERMINISTIC = () => 0; // always picks the top-weighted candidate

function picksUntilMyNextTurn(state) {
  const myNextPick = state.picksForSlot(state.mySlot).find((p) => p > state.currentPick);
  if (!myNextPick) return null; // last pick of the draft
  return myNextPick - state.currentPick - 1; // -1 because I'm taking one now
}

/**
 * @param {DraftState} state
 * @param {object} rankings
 * @param {object} opts - { level, thesis, n, ownerProfiles, candidatePoolSize }
 * @returns {Array} — same shape as L1/L2 recs, plus { futureBest, futureVbd, totalScore }
 */
export function lookaheadRecommend(state, rankings, opts = {}) {
  const { level = 'l2', n = 5, ownerProfiles = null, candidatePoolSize = 10 } = opts;
  const baseEngine = level === 'l1' ? recommendL1 : recommendL2;
  const candidates = baseEngine(state, rankings, candidatePoolSize);

  if (candidates.length === 0) return [];
  const gap = picksUntilMyNextTurn(state);
  if (gap === null || gap === 0) {
    // No future pick to optimize for — just return base recs.
    return candidates.slice(0, n).map((c) => ({ ...c, totalScore: c.score }));
  }

  const enhanced = candidates.map((rec) => {
    const cloned = state.clone();
    try {
      cloned.addPick(rec.player.id);
    } catch {
      return { ...rec, totalScore: rec.score };
    }
    // Simulate opponents until my next turn (or draft end / unexpected my-turn).
    let simmed = 0;
    while (simmed < gap && !cloned.isComplete && !cloned.isMyTurn) {
      const opp = pickForOpponent(cloned, ownerProfiles, DETERMINISTIC);
      cloned.addPick(opp.id);
      simmed++;
    }
    // Evaluate best pick at my next turn from the cloned state.
    const nextOpts = baseEngine(cloned, rankings, 1);
    const nextBest = nextOpts[0] || null;
    const futureVbd = nextBest ? nextBest.vbd ?? 0 : 0;
    return {
      ...rec,
      futureBest: nextBest ? { name: nextBest.player.name, position: nextBest.player.position, posRank: nextBest.posRank, tier: nextBest.tier } : null,
      futureVbd,
      futureScore: nextBest ? nextBest.score : 0,
      totalScore: rec.score + (nextBest ? nextBest.score : 0)
    };
  });

  enhanced.sort((a, b) => b.totalScore - a.totalScore);
  return enhanced.slice(0, n);
}
