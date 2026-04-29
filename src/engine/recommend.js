// Composer — picks the engine level, applies thesis, annotates with L3 signals
// and (when owner profiles are loaded) opponent-anticipation reasoning.

import { recommend as recommendL1 } from './l1.js';
import { recommend as recommendL2 } from './l2.js';
import { annotate } from './l3.js';
import { applyThesis } from './l4.js';
import { lookaheadRecommend } from './lookahead.js';
import { anticipateUpcoming, archetypeTargets } from '../owners.js';

/**
 * For each recommendation, attach "anticipated by" tags when upcoming opponents
 * have archetypes or team affinities that match the recommended player. Two
 * sources of anticipation:
 *   - Archetype: NuttySequel always grabs an early TE → flag if I'm considering one.
 *   - Team affinity: PaTilley reaches for Patriots → flag if I'm considering one.
 */
function annotateAnticipation(recs, state, profiles) {
  if (!profiles) return recs;
  const upcoming = anticipateUpcoming(state, profiles, 12);
  return recs.map((rec) => {
    const tags = new Set();
    const isRookie = rec.player.exp === 0;
    const playerNameLower = (rec.player.name || '').toLowerCase();

    for (const u of upcoming) {
      const profile = u.profile;
      if (!profile) continue;
      if (archetypeTargets(profile.primary, rec.player.position, u.round)) {
        tags.add(`${profile.name} (${profile.primary})`);
      }
      const teamMatch = (profile.teamAffinities || []).find((a) => a.team === rec.player.team);
      if (teamMatch) {
        tags.add(`${profile.name} (${rec.player.team} ${teamMatch.ratio}x)`);
      }
      // Rookie pickers
      if (isRookie && (profile.rookieAffinity?.ratio || 0) >= 1.5) {
        tags.add(`${profile.name} (rookie bias ${profile.rookieAffinity.ratio.toFixed(1)}x)`);
      }
      // Loyalty match
      const loyaltyMatch = (profile.loyaltyPicks || []).find(
        (l) => l.player.toLowerCase() === playerNameLower
      );
      if (loyaltyMatch && loyaltyMatch.seasons.length >= 3) {
        tags.add(`${profile.name} (drafted ${loyaltyMatch.seasons.length}x)`);
      }
    }
    if (tags.size === 0) return rec;
    const signals = [...(rec.signals || []), `anticipated by ${[...tags].slice(0, 3).join(', ')}`];
    return { ...rec, signals };
  });
}

export function recommend(state, rankings, opts = {}) {
  const { level = 'l2', thesis = 'none', n = 5, ownerProfiles = null, lookahead = false } = opts;

  let recs;
  if (lookahead) {
    // Lookahead picks its own candidate pool and re-ranks by current+future value.
    // Thesis/L4 still applied as a re-weight on the resulting set.
    recs = lookaheadRecommend(state, rankings, { level, n: n * 2, ownerProfiles });
    recs = applyThesis(recs, state, rankings, thesis);
    recs = recs.slice(0, n);
  } else {
    const engine = level === 'l1' ? recommendL1 : recommendL2;
    recs = engine(state, rankings, n * 3);
    recs = applyThesis(recs, state, rankings, thesis);
    recs = recs.slice(0, n);
  }
  recs = annotate(recs, state);
  recs = annotateAnticipation(recs, state, ownerProfiles);
  return recs;
}

export { detectRuns, detectFallers } from './l3.js';
export { THESES } from './l4.js';
