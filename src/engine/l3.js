// L3 — situational signals. Augments L1/L2 with:
//   • Position run detection: are RBs flying off the board?
//   • ADP arbitrage: is this player falling past their ADP?
//
// These produce flags the UI surfaces alongside recommendations. They don't
// override the ranking, but they tell you *why* a pick is suddenly urgent.

const RUN_WINDOW = 10;  // picks to look back
const RUN_THRESHOLD = 5; // ≥5 of N at one position triggers a "run"
const FALLER_THRESHOLD = 10; // picks below ADP to flag as value

/**
 * Returns positions currently undergoing a run, with intensity.
 * @returns {Array<{position:string, count:number, window:number}>}
 */
export function detectRuns(state) {
  const recent = state.picks.slice(-RUN_WINDOW);
  if (recent.length < RUN_THRESHOLD) return [];

  const counts = {};
  for (const pick of recent) {
    const p = state.players[pick.playerId];
    if (!p) continue;
    counts[p.position] = (counts[p.position] || 0) + 1;
  }

  return Object.entries(counts)
    .filter(([, c]) => c >= RUN_THRESHOLD)
    .map(([position, count]) => ({ position, count, window: recent.length }));
}

/**
 * Players available at meaningful discount vs. ADP (search_rank as proxy).
 * Sorted by largest fall first.
 */
export function detectFallers(state, n = 5) {
  const currentPick = state.currentPick;
  const fallers = [];
  for (const p of state.available()) {
    const fall = currentPick - p.search_rank;
    if (fall >= FALLER_THRESHOLD) {
      fallers.push({ player: p, fall, adp: p.search_rank });
    }
  }
  fallers.sort((a, b) => b.fall - a.fall);
  return fallers.slice(0, n);
}

/**
 * Annotate L1/L2 recommendations with run + faller signals.
 * Returns the same array, with each rec gaining `signals: string[]`.
 */
export function annotate(recommendations, state) {
  const runs = detectRuns(state);
  const fallers = detectFallers(state, 20);
  const fallerById = new Map(fallers.map((f) => [f.player.id, f]));
  const runPositions = new Set(runs.map((r) => r.position));

  return recommendations.map((rec) => {
    const signals = [];
    const f = fallerById.get(rec.player.id);
    if (f) signals.push(`fell ${f.fall} below ADP`);
    if (runPositions.has(rec.player.position)) {
      const run = runs.find((r) => r.position === rec.player.position);
      signals.push(`${rec.player.position} run (${run.count}/${run.window})`);
    }
    return { ...rec, signals };
  });
}
