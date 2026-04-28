// L4 — roster construction theses.
// A "thesis" is a pre-draft belief about position scarcity that shifts which
// positions the engine emphasizes in which rounds. The user picks one (or "none")
// before the draft; recommendations get re-weighted accordingly.

export const THESES = {
  none: {
    label: 'No thesis (BPA + need)',
    description: 'Best player available, weighted by roster need. The default.',
    adjust: () => 1
  },

  heroRb: {
    label: 'Hero RB',
    description:
      'Lock down one elite RB in round 1, then go heavy WR/TE. Bet: RB is scarce but injury-prone, so anchor with one and hedge with WRs.',
    adjust(player, state, ctx) {
      const round = Math.ceil(state.currentPick / state.teams);
      const myRbs = state.myRoster().RB.length;
      if (player.position === 'RB') {
        if (round === 1 && myRbs === 0) return 1.4; // grab the hero
        if (round <= 6 && myRbs >= 1) return 0.6; // de-prioritize until late
        return 1.0;
      }
      if (round >= 2 && round <= 6 && (player.position === 'WR' || player.position === 'TE')) {
        return 1.15; // load skill while ignoring RB
      }
      return 1.0;
    }
  },

  zeroRb: {
    label: 'Zero RB',
    description:
      'Skip RBs in rounds 1-5; load up on WR/TE. Draft RBs late as high-upside lottery tickets. Bet: RB performance is volatile, you can find league-winners on the waiver wire.',
    adjust(player, state) {
      const round = Math.ceil(state.currentPick / state.teams);
      if (player.position === 'RB') {
        if (round <= 5) return 0.4;
        if (round >= 9) return 1.25; // upside dart throws
      }
      if (round <= 5 && (player.position === 'WR' || player.position === 'TE')) return 1.2;
      return 1.0;
    }
  },

  robustRb: {
    label: 'Robust RB',
    description:
      'Two RBs in your first three picks. Bet: RB scarcity is real and you need a foundation that the rest of the league has to draft around.',
    adjust(player, state) {
      const round = Math.ceil(state.currentPick / state.teams);
      const myRbs = state.myRoster().RB.length;
      if (player.position === 'RB' && round <= 3 && myRbs < 2) return 1.4;
      return 1.0;
    }
  },

  lateRoundQb: {
    label: 'Late-Round QB',
    description:
      "Don't draft a QB before round 8-9. Bet: QB depth means QB10 is nearly as good as QB5 — spend early picks on scarcer positions.",
    adjust(player, state) {
      const round = Math.ceil(state.currentPick / state.teams);
      if (player.position === 'QB' && round < 8) return 0.3;
      if (player.position === 'QB' && round >= 8) return 1.3;
      return 1.0;
    }
  },

  anchorTe: {
    label: 'Anchor TE',
    description:
      'Reach slightly for an elite TE in rounds 2-3. Bet: the gap from TE1 to TE6 is huge in PPR — owning the gap is a structural advantage.',
    adjust(player, state, ctx) {
      const round = Math.ceil(state.currentPick / state.teams);
      const myTes = state.myRoster().TE.length;
      if (player.position === 'TE' && round >= 2 && round <= 4 && myTes === 0) {
        const tier = ctx.rankings.tier(player);
        if (tier === 1) return 1.5;
        if (tier === 2) return 1.2;
      }
      return 1.0;
    }
  }
};

/**
 * Apply a thesis to a recommendations list. Returns the list re-scored & resorted.
 * `key` must be one of THESES; if unknown, returns input unchanged.
 */
export function applyThesis(recommendations, state, rankings, key) {
  const thesis = THESES[key];
  if (!thesis || key === 'none') return recommendations;
  const ctx = { rankings };
  const adjusted = recommendations.map((rec) => {
    const factor = thesis.adjust(rec.player, state, ctx);
    return { ...rec, score: rec.score * factor, thesisFactor: factor };
  });
  adjusted.sort((a, b) => b.score - a.score);
  return adjusted;
}
