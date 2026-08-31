// Rankings / tiers / projections layer. Two modes:
//   1. Real expert consensus from data/rankings.json (Boris Chen PPR draft
//      tiers, built by scripts/build-rankings.mjs) — preferred.
//   2. Derived from Sleeper's search_rank — fallback so the engine still runs
//      if the rankings file is missing.
//
// The difference matters more than it looks. search_rank is a *search
// popularity* metric — it tracks who people look up, which correlates with
// name recognition and lags reality badly (a retired QB can outrank a starting
// rookie). Expert consensus rank is an actual value estimate. Everything
// downstream — VBD, tiers, scarcity, lookahead — inherits whichever one feeds
// it, so this layer is the single highest-leverage input in the app.
//
// Two tier concepts, deliberately kept distinct:
//   tier(p)     overall draft-board tier — compares across positions. This is
//               the one to show on the board and to reason about value with.
//   posTier(p)  within-position tier — "is this an elite TE?". Used by roster
//               theses that care about positional scarcity specifically.
// Both are defined identically in real and synthetic mode, so nothing changes
// meaning when the rankings file appears or disappears.

const SYNTHETIC_PROJECTION_CURVES = {
  // Approximate top-of-position points-per-season for a 12-team PPR redraft.
  // Decay rate tuned so VBD vs replacement looks roughly right.
  QB: { peak: 380, decay: 0.012 },
  RB: { peak: 330, decay: 0.02 },
  WR: { peak: 320, decay: 0.015 },
  TE: { peak: 260, decay: 0.025 },
  DEF: { peak: 140, decay: 0.03 },
};

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

/** Within-position tier from within-position rank. Tiers widen with depth. */
function posTierFromRank(position, r) {
  if (position === 'QB' || position === 'TE') {
    if (r <= 3) return 1;
    if (r <= 7) return 2;
    if (r <= 12) return 3;
    return 4 + Math.floor((r - 13) / 5);
  }
  if (position === 'DEF') {
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

/** Overall board tier from overall rank. Mirrors how consensus tiers widen. */
function overallTierFromRank(r) {
  if (r <= 6) return 1;
  if (r <= 12) return 2;
  if (r <= 20) return 3;
  if (r <= 30) return 4;
  return 5 + Math.floor((r - 31) / 10);
}

/**
 * Build a Rankings model from the player DB, optionally driven by real expert
 * consensus.
 *
 * @param {object<string,object>} players - keyed by id
 * @param {object|null} ecr - parsed data/rankings.json, or null for synthetic
 * @returns {{posRank, byPos, projection, tier, posTier, replacementPoints, meta}}
 */
export function buildRankings(players, ecr = null, valueCurve = null, tiers = null) {
  const all = Object.values(players);
  const ranked = ecr?.players ?? null;
  const hasEcr = Boolean(ranked && Object.keys(ranked).length);
  const curve = valueCurve?.curve ?? null;
  const hasCurve = Boolean(curve && Object.keys(curve).length);

  // Multi-source positional tiers, when built. Without this there are two
  // competing definitions of "positional tier" — the bucket derived from
  // posRank here, and the uncertainty-based one in tiers.json — and the app
  // will happily print both for the same player on adjacent lines.
  const tierById = new Map();
  for (const t of tiers?.players ?? []) tierById.set(t.id, t.tier);
  const hasTierFile = tierById.size > 0;

  // --- Ordering -------------------------------------------------------------
  // Ranked players sort by consensus rank. Everyone else falls in behind them,
  // ordered by search_rank. That ordering is the whole point: a player the
  // experts didn't rank in the top 200 should never outrank one they did,
  // however often people search for him.

  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = [];
  for (const p of all) {
    if (byPos[p.position]) byPos[p.position].push(p);
  }

  const rankOf = (p) => (hasEcr ? (ranked[p.id]?.ecr ?? Infinity) : Infinity);

  for (const pos of POSITIONS) {
    byPos[pos].sort((a, b) => {
      const ra = rankOf(a);
      const rb = rankOf(b);
      if (ra !== rb) return ra - rb;
      // Unranked (or synthetic mode): fall back to search popularity.
      return (a.search_rank ?? 9999) - (b.search_rank ?? 9999);
    });
  }

  const posRank = new Map(); // playerId → 1-indexed rank within position
  for (const pos of POSITIONS) {
    byPos[pos].forEach((p, i) => posRank.set(p.id, i + 1));
  }

  // Overall board ordering, used for the cross-position tier.
  const overallRank = new Map();
  const overallSorted = [...all].sort((a, b) => {
    const ra = rankOf(a);
    const rb = rankOf(b);
    if (ra !== rb) return ra - rb;
    return (a.search_rank ?? 9999) - (b.search_rank ?? 9999);
  });
  overallSorted.forEach((p, i) => overallRank.set(p.id, i + 1));

  // --- Values ---------------------------------------------------------------

  /**
   * Projected season points. Still a modelled curve rather than real
   * projections — but in ECR mode the curve is evaluated at the player's
   * *consensus* position rank, so the ordering it produces is the experts'
   * ordering rather than Sleeper's search ordering.
   */
  function projection(p) {
    const r = posRank.get(p.id) ?? 200;

    // Measured curve when we have it: what a player finishing at this
    // positional rank actually scored, averaged over recent seasons. This asks
    // what the SLOT is worth, never which player fills it — so rookies and
    // team changes don't degrade it the way a per-player historical model would.
    if (hasCurve) {
      const list = curve[p.position];
      if (list?.length) {
        // Past the measured depth everyone is replacement level; decay gently
        // off the last real value rather than falling off a cliff.
        if (r <= list.length) return list[r - 1];
        const tail = list[list.length - 1];
        return Math.max(0, tail * Math.exp(-0.02 * (r - list.length)));
      }
    }

    const synth = SYNTHETIC_PROJECTION_CURVES[p.position];
    if (!synth) return 0;
    return Math.max(0, synth.peak * Math.exp(-synth.decay * (r - 1)));
  }

  /** Overall draft-board tier. Real consensus tier when we have one. */
  function tier(p) {
    if (hasEcr) {
      const hit = ranked[p.id];
      if (hit) return hit.tier;
      // Unranked: park below the deepest real tier rather than pretending to
      // know where they belong.
      return (ecr.maxTier ?? 25) + 1;
    }
    return overallTierFromRank(overallRank.get(p.id) ?? 999);
  }

  /**
   * Within-position tier — "how elite is he *at his position*".
   * Prefers the multi-source tier file so the whole app agrees on one answer.
   */
  function posTier(p) {
    if (hasTierFile) {
      const t = tierById.get(p.id);
      if (t !== undefined) return t;
    }
    return posTierFromRank(p.position, posRank.get(p.id) ?? 999);
  }

  return {
    posRank,
    byPos,
    projection,
    tier,
    posTier,
    /** Replacement-level points at the league-defined cutoff for this position. */
    replacementPoints(pos, cutoffRank) {
      const list = byPos[pos] || [];
      const target = list[Math.min(cutoffRank - 1, list.length - 1)];
      return target ? projection(target) : 0;
    },
    meta: {
      source: hasEcr ? (ecr.source ?? 'expert consensus') : 'synthetic (search_rank)',
      /** Where projected points come from — measured seasons, or a modelled curve. */
      projectionSource: hasCurve
        ? `measured (${(valueCurve.seasons ?? []).join(', ')})`
        : 'modelled exponential',
      usingRealProjections: hasCurve,
      scoring: ecr?.scoring ?? null,
      fetchedAt: ecr?.fetchedAt ?? null,
      rankedCount: hasEcr ? Object.keys(ranked).length : 0,
      usingRealRankings: hasEcr,
      /** True if the experts actually ranked this player. */
      isRanked: (p) => Boolean(hasEcr && ranked[p.id]),
      /** Consensus overall rank (Avg.Rank across experts), or null. */
      ecr: (p) => (hasEcr ? (ranked[p.id]?.ecr ?? null) : null),
      /**
       * How much better the most optimistic expert has him than consensus.
       *
       * This is the measurable part of "upside" — the gap between where he is
       * being drafted and where the believers rank him. It was sitting unused
       * in rankings.json (Best.Rank) while the board showed only the mean.
       */
      upside: (p) => {
        if (!hasEcr) return null;
        const r = ranked[p.id];
        if (!r || !Number.isFinite(r.best)) return null;
        return Math.round(Math.max(0, r.ecr - r.best) * 10) / 10;
      },
      /** And the other tail: how far the pessimists have him falling. */
      bust: (p) => {
        if (!hasEcr) return null;
        const r = ranked[p.id];
        if (!r || !Number.isFinite(r.worst)) return null;
        return Math.round(Math.max(0, r.worst - r.ecr) * 10) / 10;
      },
      /**
       * Expert disagreement for a player, as the std-dev of their ranks.
       * High spread = boom/bust; low spread = the field agrees. Null when
       * unknown, so callers can tell "consensus is tight" from "no data".
       */
      spread: (p) => (hasEcr ? (ranked[p.id]?.stdev ?? null) : null),
    },
  };
}
