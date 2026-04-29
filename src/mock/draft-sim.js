// Mock draft simulator. Other teams pick by:
//   1. ADP heuristic (top by search_rank, capped per position)
//   2. Owner archetype bias (Anchor TE / Early QB / Hero RB / Zero RB / Robust RB),
//      pulled from owner-profiles.json — NuttySequel reaches for an elite TE in R2
//      because that's what NuttySequel did in 2025.
//
// Without history, every opponent reduces to "Default" which is just step 1.

import {
  opponentBias,
  profileForSlot,
  teamAffinityBias,
  rookieBias,
  loyaltyBias
} from '../owners.js';

const POS_LIMITS = { QB: 2, RB: 8, WR: 8, TE: 2, DEF: 1 };

function rostersBySlot(state) {
  const out = {};
  for (let s = 1; s <= state.teams; s++) {
    out[s] = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  }
  for (const pick of state.picks) {
    const p = state.players[pick.playerId];
    if (out[pick.slot] && out[pick.slot][p.position] !== undefined) {
      out[pick.slot][p.position]++;
    }
  }
  return out;
}

/**
 * Pick a player for the team currently on the clock.
 * @param {DraftState} state
 * @param {object|null} ownerProfiles - from owner-profiles.json
 * @param {() => number} rng
 */
export function pickForOpponent(state, ownerProfiles = null, rng = Math.random) {
  const available = state.available();
  const slot = state.currentSlot;
  const round = Math.ceil(state.currentPick / state.teams);
  const rosters = rostersBySlot(state);
  const myCount = rosters[slot];

  const profile = profileForSlot(ownerProfiles, slot);
  const archetype = profile?.primary;

  // Pull a wider candidate window so archetype bias has room to reshuffle.
  const pool = [];
  for (const p of available) {
    if ((myCount[p.position] ?? 0) >= POS_LIMITS[p.position]) continue;
    pool.push(p);
    if (pool.length >= 25) break;
  }
  if (pool.length === 0) return available[0];

  // Score = inverse search_rank, modulated by archetype + team + rookie + loyalty.
  const scored = pool.map((p) => {
    const base = 1000 - Math.min(p.search_rank, 999);
    const archBias = opponentBias(archetype, p, round);
    const teamBias = teamAffinityBias(profile, p);
    const rookBias = rookieBias(profile, p);
    const loyalBias = loyaltyBias(profile, p);
    return { player: p, score: base * archBias * teamBias * rookBias * loyalBias };
  });
  scored.sort((a, b) => b.score - a.score);

  // Weighted pick from top 3 with mild randomness.
  const top = scored.slice(0, Math.min(3, scored.length));
  const weights = [0.65, 0.25, 0.1].slice(0, top.length);
  const r = rng();
  let acc = 0;
  for (let i = 0; i < top.length; i++) {
    acc += weights[i];
    if (r < acc) return top[i].player;
  }
  return top[top.length - 1].player;
}

export function simulateUntilMyTurn(state, ownerProfiles = null, rng) {
  const made = [];
  while (!state.isComplete && !state.isMyTurn) {
    const player = pickForOpponent(state, ownerProfiles, rng);
    state.addPick(player.id);
    made.push({ pick: state.picks[state.picks.length - 1], player });
  }
  return made;
}

export function seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
