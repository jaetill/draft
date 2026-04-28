// Mock draft simulator. Other teams pick by ADP-ish heuristic (search_rank +
// roster-need filtering). Lets the engine and UI be exercised end-to-end without
// a live Sleeper draft.

const POS_LIMITS = { QB: 2, RB: 8, WR: 8, TE: 2, DEF: 1 };

/**
 * Compute a team's roster (by slot 1..N) from current picks.
 * Returns { 1: {QB:[],RB:[]...}, 2: {...}, ... }
 */
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
 * Pick a player for the team that's currently on the clock. Heuristic:
 *   1. Top 15 available by search_rank.
 *   2. Filter out positions that would exceed POS_LIMITS for this team.
 *   3. Among remaining, weight toward higher search_rank with mild randomness
 *      so two simulations don't produce identical drafts.
 */
export function pickForOpponent(state, rng = Math.random) {
  const available = state.available();
  const slot = state.currentSlot;
  const rosters = rostersBySlot(state);
  const myCount = rosters[slot];

  const candidates = [];
  for (const p of available) {
    if ((myCount[p.position] ?? 0) >= POS_LIMITS[p.position]) continue;
    candidates.push(p);
    if (candidates.length >= 15) break;
  }
  if (candidates.length === 0) return available[0]; // fallback

  // Weighted pick from top 3, biased toward the top.
  const top = candidates.slice(0, Math.min(3, candidates.length));
  const weights = [0.65, 0.25, 0.1].slice(0, top.length);
  const r = rng();
  let acc = 0;
  for (let i = 0; i < top.length; i++) {
    acc += weights[i];
    if (r < acc) return top[i];
  }
  return top[top.length - 1];
}

/**
 * Run picks for opponents until it's my turn or the draft is complete.
 * Returns the array of opponent picks made this call.
 */
export function simulateUntilMyTurn(state, rng) {
  const made = [];
  while (!state.isComplete && !state.isMyTurn) {
    const player = pickForOpponent(state, rng);
    state.addPick(player.id);
    made.push({ pick: state.picks[state.picks.length - 1], player });
  }
  return made;
}

/** Optional: deterministic seed for reproducible sims. */
export function seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
