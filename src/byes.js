// Bye-week collision analysis.
//
// The naive version of this feature ("warn me if two players share a bye") is
// noise. In a 15-man roster every week collides with something, and most
// collisions don't matter — you have bench players to cover them.
//
// What actually matters is whether you can still field a legal lineup. That is
// a shortfall question, not a collision question: for each week, count who is
// available at each slot and compare against what the league requires you to
// start. Only a genuine shortfall is worth interrupting a draft for.
//
// Deliberately not handled: injuries, suspensions, and in-season pickups. This
// is a draft-day tool; by week 5 the roster has churned anyway.

/** Weeks a bye can fall on. Outside this range a "bye" value is bad data. */
const MIN_BYE_WEEK = 4;
const MAX_BYE_WEEK = 14;

/**
 * Required starters by position, plus flex, from league config.
 * Mirrors the shape in data/league.json.
 */
function starterRequirements(cfg) {
  const roster = cfg.roster || {};
  return {
    fixed: {
      QB: roster.QB ?? 0,
      RB: roster.RB ?? 0,
      WR: roster.WR ?? 0,
      TE: roster.TE ?? 0,
      DEF: roster.DEF ?? 0,
    },
    flex: roster.FLEX ?? 0,
    flexEligible: cfg.flex_eligible || ['RB', 'WR', 'TE'],
  };
}

/** True if the value looks like a real NFL bye week. */
export function isValidByeWeek(w) {
  return Number.isInteger(w) && w >= MIN_BYE_WEEK && w <= MAX_BYE_WEEK;
}

/**
 * Can this set of available players fill the required lineup?
 * Fills fixed slots first, then spends leftovers on flex — greedy is optimal
 * here because every flex-eligible player is interchangeable for the purpose
 * of *filling* a slot.
 *
 * @returns {{slotsUnfilled: number, shortfall: object, flexShort: number}}
 */
function lineupShortfall(availableByPos, req) {
  const shortfall = {};
  let leftovers = 0;
  let slotsUnfilled = 0;

  for (const [pos, need] of Object.entries(req.fixed)) {
    const have = availableByPos[pos] ?? 0;
    if (have < need) {
      shortfall[pos] = need - have;
      slotsUnfilled += need - have;
    } else if (req.flexEligible.includes(pos)) {
      leftovers += have - need;
    }
  }

  const flexShort = Math.max(0, req.flex - leftovers);
  slotsUnfilled += flexShort;
  return { slotsUnfilled, shortfall, flexShort };
}

/**
 * How bad is a given week?
 *
 * One unfilled slot is not a problem — it is Tuesday. Every manager streams a
 * defense or a QB on a bye week, and a roster carrying exactly one DEF is
 * short by definition on that DEF's bye. Flagging that would fire on almost
 * every roster in the league and train you to ignore the warning.
 *
 * Two or more unfilled slots in the same week is the real failure: you are
 * starting replacement-level players at multiple positions and you lose that
 * week on roster construction rather than on football.
 */
const STREAMABLE = 1;

export function severityFor(slotsUnfilled) {
  if (slotsUnfilled >= 3) return 'severe';
  if (slotsUnfilled >= 2) return 'costly';
  if (slotsUnfilled >= 1) return 'stream';
  return 'none';
}

/**
 * Week-by-week lineup health for a roster.
 *
 * @param {Array<{position: string, bye_week: number|null}>} roster
 * @param {object} cfg - league.json
 * @param {{includeStreamable?: boolean}} [opts] - include 1-slot weeks (default false)
 * @returns {Array<{week, slotsUnfilled, severity, shortfall, flexShort, onBye}>}
 */
export function byeReport(roster, cfg, opts = {}) {
  const req = starterRequirements(cfg);

  // Baseline: what this roster cannot fill even with everybody healthy. In
  // round 3 you have four players and cannot fill nine slots — that is roster
  // incompleteness, not a bye problem. Subtracting it isolates the bye cost,
  // so this reports the same thing mid-draft as it does on a full roster.
  const allAvailable = {};
  for (const p of roster) {
    allAvailable[p.position] = (allAvailable[p.position] ?? 0) + 1;
  }
  const base = lineupShortfall(allAvailable, req);
  const baseline = base.slotsUnfilled;

  const problems = [];

  for (let week = MIN_BYE_WEEK; week <= MAX_BYE_WEEK; week++) {
    const availableByPos = {};
    const onBye = [];
    for (const p of roster) {
      if (p.bye_week === week) {
        onBye.push(p);
        continue;
      }
      availableByPos[p.position] = (availableByPos[p.position] ?? 0) + 1;
    }
    if (!onBye.length) continue;

    const { slotsUnfilled, shortfall, flexShort } = lineupShortfall(availableByPos, req);
    const byeCost = slotsUnfilled - baseline;
    if (byeCost <= 0) continue;
    if (!opts.includeStreamable && byeCost <= STREAMABLE) continue;

    // Only the part of the shortfall the BYE caused. Reporting the absolute
    // shortfall is actively misleading mid-draft: with three players rostered
    // you are short at almost every position, and saying so under a bye warning
    // blames the bye for the fact that you have not finished drafting.
    const byeShortfall = {};
    for (const [pos, n] of Object.entries(shortfall)) {
      const caused = n - (base.shortfall[pos] ?? 0);
      if (caused > 0) byeShortfall[pos] = caused;
    }
    const byeFlexShort = Math.max(0, flexShort - base.flexShort);

    problems.push({
      week,
      byeCost,
      slotsUnfilled,
      severity: severityFor(byeCost),
      shortfall,
      flexShort,
      byeShortfall,
      byeFlexShort,
      onBye,
    });
  }

  return problems;
}

/**
 * What drafting this player would do to your bye-week health.
 *
 * Returns null when it changes nothing — the common case, and the caller
 * should render nothing rather than a reassuring green tick for all 250 rows.
 *
 * @returns {null | {week, severity, message}}
 *   severity 'blocks'   — creates a week you cannot field a legal lineup
 *   severity 'tightens' — the week was already short and this doesn't help
 */
export function byeImpact(candidate, roster, cfg) {
  if (!isValidByeWeek(candidate.bye_week)) return null;

  const week = candidate.bye_week;

  // Note there is no before/after delta here, and that is deliberate. Adding a
  // player never *reduces* availability in any week — his bye week is short
  // whether or not you draft him. So a delta comparison can never fire. The
  // real question is simply: with him on the roster, is this week a hole?
  const after = byeReport([...roster, candidate], cfg, { includeStreamable: true }).find(
    (p) => p.week === week,
  );

  // A manager who covers byes from the waiver wire does not forfeit the slot —
  // he drops his worst player and streams a one-week fill-in. The cost is real
  // but it is roster moves, not points, so the threshold to bother him is
  // higher and the wording should say what it actually costs.
  const streams = cfg.roster_strategy?.streams_bye_replacements === true;
  const threshold = streams ? STREAMABLE + 1 : STREAMABLE;
  if (!after || after.byeCost <= threshold) return null;

  // Report what the bye costs, not what the roster is missing overall.
  const parts = Object.entries(after.byeShortfall).map(([pos, n]) => `${n} ${pos}`);
  if (after.byeFlexShort) parts.push(`${after.byeFlexShort} FLEX`);

  const others = after.onBye
    .filter((p) => p !== candidate)
    .map((p) => p.name)
    .filter(Boolean);
  const withWho = others.length ? ` with ${others.join(', ')}` : '';

  const cost = streams
    ? `wk${week} needs ${after.byeCost} waiver moves (${parts.join(' + ')})`
    : `wk${week} bye costs ${parts.join(' + ') || `${after.byeCost} slots`}`;

  return {
    week,
    severity: after.severity,
    byeCost: after.byeCost,
    message: `${cost}${withWho}`,
  };
}

/**
 * Bye-week distribution across a roster — the pre-draft planning view.
 * Bunching your starters onto one or two byes is a slow-motion loss.
 */
export function byeDistribution(roster) {
  const counts = {};
  for (const p of roster) {
    if (!isValidByeWeek(p.bye_week)) continue;
    counts[p.bye_week] = (counts[p.bye_week] ?? 0) + 1;
  }
  return counts;
}
