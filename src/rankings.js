// Rankings / tiers / projections layer. Two modes:
//   1. Real CSVs in data/ (FantasyPros + Boris Chen + FP projections) — preferred.
//   2. Derived from Sleeper's search_rank — fallback so the engine works pre-CSV.
//
// The CSV loaders aren't wired yet (no real data exists pre-late-August).
// Switching to real data later means: load the CSVs, populate the same maps.

const SYNTHETIC_PROJECTION_CURVES = {
  // Approximate top-of-position points-per-season for a 12-team PPR redraft.
  // Decay rate tuned so VBD vs replacement looks roughly right.
  QB: { peak: 380, decay: 0.012 },
  RB: { peak: 330, decay: 0.020 },
  WR: { peak: 320, decay: 0.015 },
  TE: { peak: 260, decay: 0.025 },
  DEF: { peak: 140, decay: 0.030 }
};

/**
 * Build a Rankings model from the player DB. If/when real CSVs exist, the
 * `loadCsv*` helpers will overwrite the synthetic values.
 *
 * @param {object<string,object>} players - keyed by id
 * @returns {{rankByPos, posRank, projection, tier, byId}}
 */
export function buildRankings(players) {
  const all = Object.values(players);

  // Within-position ordering, lower index = higher rank.
  const byPos = { QB: [], RB: [], WR: [], TE: [], DEF: [] };
  for (const p of all) {
    if (byPos[p.position]) byPos[p.position].push(p);
  }
  for (const pos of Object.keys(byPos)) {
    byPos[pos].sort((a, b) => a.search_rank - b.search_rank);
  }

  const posRank = new Map(); // playerId → 1-indexed rank within position
  for (const pos of Object.keys(byPos)) {
    byPos[pos].forEach((p, i) => posRank.set(p.id, i + 1));
  }

  /** Synthetic projection for a player at within-position rank r. */
  function projection(p) {
    const curve = SYNTHETIC_PROJECTION_CURVES[p.position];
    if (!curve) return 0;
    const r = posRank.get(p.id) ?? 200;
    return Math.max(0, curve.peak * Math.exp(-curve.decay * (r - 1)));
  }

  /** Synthetic tiers — growing tier sizes with depth. */
  function tier(p) {
    const r = posRank.get(p.id) ?? 999;
    // QB/TE: tighter top tiers, then break. RB/WR: broader.
    if (p.position === 'QB' || p.position === 'TE') {
      if (r <= 3) return 1;
      if (r <= 7) return 2;
      if (r <= 12) return 3;
      return 4 + Math.floor((r - 13) / 5);
    }
    if (p.position === 'DEF') {
      if (r <= 5) return 1;
      if (r <= 12) return 2;
      return 3 + Math.floor((r - 13) / 6);
    }
    // RB/WR
    if (r <= 4) return 1;
    if (r <= 10) return 2;
    if (r <= 18) return 3;
    if (r <= 28) return 4;
    return 5 + Math.floor((r - 29) / 8);
  }

  return {
    posRank,
    byPos,
    projection,
    tier,
    /** Replacement-level points at the league-defined cutoff for this position. */
    replacementPoints(pos, cutoffRank) {
      const list = byPos[pos] || [];
      const target = list[Math.min(cutoffRank - 1, list.length - 1)];
      return target ? projection(target) : 0;
    }
  };
}
