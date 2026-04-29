// Composer — picks the engine level, applies thesis, annotates with L3 signals
// and (when owner profiles are loaded) opponent-anticipation reasoning.

import { recommend as recommendL1 } from './l1.js';
import { recommend as recommendL2 } from './l2.js';
import { annotate } from './l3.js';
import { applyThesis } from './l4.js';
import { anticipateUpcoming, archetypeTargets } from '../owners.js';

/**
 * For each recommendation, attach an "anticipated by" tag if upcoming
 * opponents have archetypes that target this position. e.g. "anticipated by
 * NuttySequel (Anchor TE)".
 */
function annotateAnticipation(recs, state, profiles) {
  if (!profiles) return recs;
  const upcoming = anticipateUpcoming(state, profiles, 12);
  return recs.map((rec) => {
    const matches = upcoming.filter((u) =>
      archetypeTargets(u.profile?.primary, rec.player.position, u.round)
    );
    if (matches.length === 0) return rec;
    const tags = matches
      .slice(0, 2)
      .map((m) => `${m.profile.name} (${m.profile.primary})`)
      .join(', ');
    const signals = [...(rec.signals || []), `anticipated by ${tags}`];
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
