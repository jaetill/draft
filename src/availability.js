// Will this player be on the field in September?
//
// The naive version reads `injury_status` and believes it. That does not work:
// the field is dominated by preseason "Questionable", which sits on 105 players
// including Ja'Marr Chase — the consensus WR2 carrying the tightest expert
// spread in the entire pool (0.92). Treating that as a risk signal would flag
// the single most certain player on the board.
//
// So the two fields are ranked, not merged:
//   status         roster designation — PUP, IR, Suspended, Inactive. Real.
//   injury_status  weekly game-day tag — Questionable, Doubtful, Out. Mostly
//                  noise in August, meaningful in-season.
//
// A "late arrival" is someone the market has already discounted for games he
// will miss. That discount is visible in his consensus rank, so the useful
// output is not "is he hurt" but "is his rank depressed for a reason that
// expires" — a player you buy at a discount and own at full value from week 5.

/** Roster designations that mean real missed time, not a game-day question. */
const HARD_STATUS = new Set(['PUP', 'IR', 'Injured Reserve', 'Sus', 'Suspended', 'NFI', 'DNR']);

/** Game-day tags that still mean something even in the preseason. */
const HARD_INJURY = new Set(['IR', 'PUP', 'Sus', 'DNR', 'Out', 'Doubtful']);

/**
 * Classify a player's availability for the start of the season.
 *
 * @returns {{level, label, reason, weeksLikelyMissed}|null} null when nothing is known
 */
export function availabilityOf(player) {
  if (!player) return null;
  const part = player.injury_body_part ?? null;
  // Roster designation first — it is the stronger and more reliable field.
  return fromRosterStatus(player.status, part) ?? fromInjuryTag(player.injury_status, part) ?? null;
}

/** PUP / IR / Suspended — a designation that costs real games. */
function fromRosterStatus(status, bodyPart) {
  if (!status || !HARD_STATUS.has(status)) return null;
  const suspended = status === 'Sus' || status === 'Suspended';
  return {
    level: 'out',
    label: suspended ? 'SUSPENDED' : `OUT (${status})`,
    reason: suspended ? 'suspension' : 'roster designation',
    // PUP and IR both carry a minimum absence in the NFL; the exact length is
    // not in this data, so this is a floor rather than an estimate.
    weeksLikelyMissed: status === 'PUP' || status.startsWith('I') ? 4 : null,
    bodyPart,
  };
}

/** The weekly game-day tag. Hard values still count; the rest is preseason noise. */
function fromInjuryTag(injury, bodyPart) {
  if (!injury) return null;
  if (HARD_INJURY.has(injury)) {
    return {
      level: 'out',
      label: `OUT (${injury})`,
      reason: 'injury designation',
      weeksLikelyMissed: null,
      bodyPart,
    };
  }
  // Reported, but never as a risk signal — see the note at the top of this file.
  return {
    level: 'watch',
    label: injury,
    reason: 'game-day tag (low signal in preseason)',
    weeksLikelyMissed: 0,
    bodyPart,
  };
}

/** True only for absences that actually cost you starts. */
export function isHardOut(player) {
  return availabilityOf(player)?.level === 'out';
}

/**
 * Players whose consensus rank is depressed by an absence that expires.
 *
 * This is the "late arrival" bet: you pay a discounted price for a player who
 * is fully available from the point he returns. Whether that is a bargain
 * depends entirely on how many weeks you eat, which is why the count matters
 * more than the flag.
 *
 * @param {object} players - players.json
 * @param {object} rankedById - rankings.json `players`
 * @param {number} [maxEcr] - only consider the draftable range
 */
export function lateArrivals(players, rankedById, maxEcr = 250) {
  const out = [];
  for (const [id, r] of Object.entries(rankedById ?? {})) {
    if (r.ecr > maxEcr) continue;
    const info = availabilityOf(players[id]);
    if (info?.level !== 'out') continue;
    out.push({
      id,
      name: r.name,
      position: r.position,
      ecr: r.ecr,
      stdev: r.stdev,
      best: r.best,
      ...info,
    });
  }
  return out.sort((a, b) => a.ecr - b.ecr);
}
