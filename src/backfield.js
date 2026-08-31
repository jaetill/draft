// Backfield structure — is this running back the guy, or one of two guys?
//
// There is no "RBBC" field in any feed, but the shape is inferable from what the
// market believes. If two backs on the same roster are ranked within a few spots
// of each other, the experts are saying they cannot tell you which one gets the
// touches. If one sits 150 spots clear of his backup, they are saying he is the
// bell cow. That gap IS the committee signal.
//
// The thresholds below come from the observed distribution rather than taste.
// Sorting the 2026 backfields by RB1-RB2 gap produces a clean break: six teams
// cluster at a gap of 4-12, and then nothing at all until 41. That empty band is
// the boundary between "genuinely splitting" and "clear starter plus handcuff".
//
// WHAT THIS IS NOT: a snap-count or touch-share measure. It is a measure of
// market *agreement*, and it inherits that limitation. Two backs ranked closely
// on a high-volume offence may both be startable rather than splitting; a rookie
// nobody has evaluated can look artificially close to the starter. Treat it as a
// flag to look closer, not a verdict.

/** Gap in consensus rank between RB1 and RB2 on a roster. */
const COMMITTEE_MAX_GAP = 25; // below this, the market cannot separate them
const TIMESHARE_MAX_GAP = 75; // between: a real backup with a real role

/**
 * Classify every backfield in the league.
 *
 * @param {object} players - players.json, keyed by id
 * @param {object} rankedById - rankings.json `players` map
 * @returns {Map<string, object>} playerId → { role, teammates, gap, depth }
 */
export function analyzeBackfields(players, rankedById) {
  const byTeam = new Map();

  for (const [id, r] of Object.entries(rankedById ?? {})) {
    if (r.position !== 'RB') continue;
    const team = players[id]?.team;
    if (!team) continue;
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push({ id, name: r.name, ecr: r.ecr });
  }

  const out = new Map();

  for (const [team, backs] of byTeam) {
    backs.sort((a, b) => a.ecr - b.ecr);
    const gap = backs.length > 1 ? backs[1].ecr - backs[0].ecr : null;

    backs.forEach((back, i) => {
      let role;
      if (backs.length === 1) {
        // No ranked competition at all. The strongest form of workhorse
        // evidence available from this data.
        role = 'sole';
      } else if (gap < COMMITTEE_MAX_GAP) {
        role = 'committee';
      } else if (gap < TIMESHARE_MAX_GAP) {
        role = i === 0 ? 'lead' : 'timeshare';
      } else {
        role = i === 0 ? 'bellcow' : 'handcuff';
      }

      out.set(back.id, {
        team,
        role,
        depth: i + 1,
        rankedBacks: backs.length,
        gap: gap === null ? null : Math.round(gap * 10) / 10,
        teammates: backs.filter((b) => b.id !== back.id).map((b) => b.name),
      });
    });
  }

  return out;
}

/** Short label for a board column or an inline tag. */
export function backfieldLabel(info) {
  if (!info) return '';
  const { role, rankedBacks, teammates } = info;
  // ' + ' rather than ', ': this lands in a CSV cell, and a comma there
  // forces quoting and trips every naive reader downstream.
  const others = teammates.length ? ` w/ ${teammates.slice(0, 2).join(' + ')}` : '';

  switch (role) {
    case 'sole':
      return 'sole RB';
    case 'bellcow':
      return 'bellcow';
    case 'lead':
      return `lead${others}`;
    case 'committee':
      return `COMMITTEE${others}`;
    case 'timeshare':
      return `timeshare${others}`;
    case 'handcuff':
      return `handcuff${others}`;
    default:
      return rankedBacks > 2 ? 'crowded' : '';
  }
}

/**
 * Committee status is a volatility signal, not a value one.
 *
 * A split backfield compresses both tails: the back is less likely to bust
 * outright because he keeps a role, and much less likely to return a league
 * winner because the ceiling belongs to whoever gets the goal-line work. That is
 * a reason to prefer a bell cow at equal cost, not a reason to avoid the player.
 */
export function isVolatilityFlag(info) {
  return info?.role === 'committee' || info?.role === 'timeshare';
}
