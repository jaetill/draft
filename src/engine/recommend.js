// Composer — picks the engine level, applies thesis, annotates with L3 signals.
// The single entry point the UI calls.

import { recommend as recommendL1 } from './l1.js';
import { recommend as recommendL2 } from './l2.js';
import { annotate } from './l3.js';
import { applyThesis } from './l4.js';

export function recommend(state, rankings, opts = {}) {
  const { level = 'l2', thesis = 'none', n = 5 } = opts;
  const engine = level === 'l1' ? recommendL1 : recommendL2;
  let recs = engine(state, rankings, n * 3); // pull more so thesis has room to reshuffle
  recs = applyThesis(recs, state, rankings, thesis);
  recs = annotate(recs.slice(0, n), state);
  return recs;
}

export { detectRuns, detectFallers } from './l3.js';
export { THESES } from './l4.js';
