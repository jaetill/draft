// Composer — picks the engine level, applies thesis, annotates with L3 signals
// and (when owner profiles are loaded) opponent-anticipation reasoning.

import { recommend as recommendL1 } from './l1.js';
import { recommend as recommendL2 } from './l2.js';
import { annotate } from './l3.js';
import { applyThesis } from './l4.js';
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
    for (const u of upcoming) {
      const profile = u.profile;
      if (!profile) continue;
      if (archetypeTargets(profile.primary, rec.player.position, u.round)) {
        tags.add(`${profile.name} (${profile.primary})`);
      }
      const teamMatch = (profile.teamAffinities || []).find((a) => a.team === rec.player.team);
      if (teamMatch) {
        tags.add(`${profile.name} (${rec.player.team} ${teamMatch.ratio}x bias)`);
      }
    }
    if (tags.size === 0) return rec;
    const signals = [...(rec.signals || []), `anticipated by ${[...tags].slice(0, 3).join(', ')}`];
    return { ...rec, signals };
  });
}

export function recommend(state, rankings, opts = {}) {
  const { level = 'l2', thesis = 'none', n = 5, ownerProfiles = null } = opts;
  const engine = level === 'l1' ? recommendL1 : recommendL2;
  let recs = engine(state, rankings, n * 3);
  recs = applyThesis(recs, state, rankings, thesis);
  recs = annotate(recs.slice(0, n), state);
  recs = annotateAnticipation(recs, state, ownerProfiles);
  return recs;
}

export { detectRuns, detectFallers } from './l3.js';
export { THESES } from './l4.js';
