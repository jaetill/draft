// Presentation filters shared by the web UI and the terminal watcher.
//
// These used to live inline in scripts/watch-draft.mjs, which meant the web
// app showed a different list than the terminal for the same board. Same rule
// as the engine itself: if the two surfaces ever disagree, that is a bug, not
// a difference of opinion — so the filtering lives here and both import it.

/**
 * At most `maxPerPos` players per position, `limit` total.
 *
 * When one position happens to hold the four highest-scored players left,
 * listing all four is technically correct and practically useless — you will
 * draft at most one of them, and the list has crowded out the best available
 * answer at every other position.
 *
 * @param {Array} raw - recommendations, already sorted best-first
 * @returns {Array}
 */
export function diversify(raw, { maxPerPos = 2, limit = 6 } = {}) {
  const perPos = {};
  const out = [];
  for (const r of raw) {
    const pos = r.player.position;
    perPos[pos] = (perPos[pos] ?? 0) + 1;
    if (perPos[pos] > maxPerPos) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Drop players whose SCORE has bottomed out — but only when enough real
 * options remain to make a list.
 *
 * Score, not VBD. The old vbd > 0 test kept exactly the wrong players: a bench
 * tight end measured against TE15 holds positive VBD deep into the draft while
 * every startable back reads zero, so the "worthwhile" list degenerated into
 * tight ends you could never start. Score is what the list is ordered by, so
 * score is what worthwhile means.
 *
 * @returns {{shown: Array, allZero: boolean}} allZero: nothing has value left —
 *   the caller should say "take upside, not VBD" rather than render silence.
 */
export function filterWorthwhile(recs, minReal = 3) {
  const worthwhile = recs.filter((r) => (r.score ?? 0) > 0);
  if (worthwhile.length >= minReal) return { shown: worthwhile, allZero: false };
  return { shown: recs, allZero: worthwhile.length === 0 };
}
