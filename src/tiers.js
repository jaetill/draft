// Positional tiering — the S/A/B/C method, and the counter that makes it useful.
//
// Rankings answer "who is better", which is almost never the question at the
// table. Tiers answer "where is the cliff", which is the only question a snake
// draft actually poses: if six players remain in the RB bucket and one remains
// in the WR bucket, you take the WR even though the RB is ranked higher —
// because the WR bucket will not survive to your next pick and the RB bucket
// will. You are drafting the last seat in a room that is about to empty.
//
// Two pieces here:
//   assignTiers()   — cut a position's players into buckets at natural gaps.
//   tierState()     — how many are LEFT in each bucket, live. This is the half
//                     that turns a static cheat sheet into a decision.
//
// Deliberately NOT a fixed number of buckets. Positions have different shapes:
// TE in a 1-TE league genuinely has ~3 elite players and then a long flat
// stretch; WR in a 2-flex PPR league has meaningful separation 40 deep. Forcing
// both into "4 tiers" would invent a cliff for one and hide one for the other.

/**
 * Separation required, in combined standard deviations, to call a cliff.
 *
 * Tiers are NOT found by hunting for gaps in ADP. That was the first thing I
 * tried and it does not work: ADP is an average over thousands of drafts, so it
 * is smooth by construction and real cliffs get averaged away. Gap-hunting on
 * smoothed data put Ja'Marr Chase and Derrick Henry in the same bucket.
 *
 * The right model — and the one Boris Chen actually uses — is that two players
 * share a tier when the market cannot reliably tell them apart. That is a
 * question about the *spread* of opinion, not the mean. Each player carries an
 * uncertainty (std dev of expert ranks, or cross-source disagreement). A cliff
 * is where consecutive players' plausible-rank ranges stop overlapping.
 *
 * The consequence is exactly what you want: elite players have tight spreads
 * and separate cleanly into small tiers, while mid-round players have huge
 * spreads and merge into big ones. A 14-man tier at WR40 is not a failure of
 * the method — it is the honest answer that nobody knows who WR40 is.
 */
/** Fantasy positions this league drafts. Local so tiers.js stays import-free. */
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

const SEPARATION_SIGMA = 1.0;

/** Floor so a player with no spread data can't split a tier on rounding noise. */
const MIN_UNCERTAINTY = 1.5;

/** Beyond this many buckets a position stops being decision-useful. */
const MAX_TIERS = 8;

/**
 * Cut one position's players into tiers where the market stops being able to
 * distinguish them.
 *
 * Each player is compared against the ANCHOR of the current tier — the player
 * who opened it — not against their immediate predecessor. Chained pairwise
 * comparison lets a tier drift arbitrarily far: A≈B, B≈C, C≈D, and suddenly
 * the tier spans forty picks with no two ends resembling each other.
 *
 * @param {Array<{consensus:number, uncertainty?:number}>} list - one position
 * @returns {Array} same objects with `tier` assigned (1-indexed)
 */
export function assignTiers(list) {
  const sorted = [...list].sort((a, b) => a.consensus - b.consensus);
  if (!sorted.length) return sorted;

  const unc = (p) => Math.max(MIN_UNCERTAINTY, p.uncertainty ?? MIN_UNCERTAINTY);

  let tier = 1;
  let anchor = sorted[0];
  sorted[0].tier = 1;

  for (let i = 1; i < sorted.length; i++) {
    const p = sorted[i];
    const gap = p.consensus - anchor.consensus;
    // Combined uncertainty of the two, added in quadrature — the standard way
    // to ask "is this difference bigger than the noise in both measurements?"
    const combined = Math.sqrt(unc(anchor) ** 2 + unc(p) ** 2);

    if (gap > SEPARATION_SIGMA * combined && tier < MAX_TIERS) {
      tier++;
      anchor = p;
    }
    p.tier = tier;
  }
  return sorted;
}

/**
 * Live tier state for every position: how many players remain in the current
 * (highest undrafted) tier, and what the next tier looks like.
 *
 * `remaining` is the number left in the best available tier at that position.
 * When it hits 1-2, that tier is about to vanish — which is the actual trigger
 * to move a position up your board, regardless of raw ranking.
 *
 * @param {Array} tiered - all tiered players (any position), with `.id`
 * @param {Set<string>} taken - drafted player ids
 * @returns {object} position → {tier, remaining, nextTier, nextTierSize, cliff}
 */
export function tierState(tiered, taken) {
  const byPos = {};
  for (const p of tiered) {
    if (taken.has(p.id)) continue;
    (byPos[p.position] ??= []).push(p);
  }

  const out = {};
  for (const [pos, players] of Object.entries(byPos)) {
    players.sort((a, b) => a.consensus - b.consensus);
    const currentTier = players[0].tier;
    const remaining = players.filter((p) => p.tier === currentTier).length;
    const rest = players.filter((p) => p.tier !== currentTier);
    const nextTier = rest.length ? rest[0].tier : null;
    const nextTierSize = nextTier === null ? 0 : rest.filter((p) => p.tier === nextTier).length;

    out[pos] = {
      tier: currentTier,
      remaining,
      nextTier,
      nextTierSize,
      // "Cliff" = this tier is nearly gone. Two or fewer means it very likely
      // does not survive a full turn of the snake.
      cliff: remaining <= 2,
      best: players[0],
    };
  }
  return out;
}

/**
 * Will this tier survive until my next pick?
 *
 * The question that matters at the turn. If you pick at 12 and 13, then not
 * again until 36, the gap is 22 picks — and roughly `remaining` players at a
 * position go in any stretch that long only if the room is running on it.
 * A blunt but honest model: assume picks are distributed across positions
 * roughly in proportion to what is left on the board near the top.
 *
 * @returns {'safe'|'risky'|'gone'}
 */
export function tierSurvival(remaining, picksUntilNextTurn, positionShare = 0.25) {
  const expectedTaken = picksUntilNextTurn * positionShare;
  if (expectedTaken < remaining * 0.5) return 'safe';
  if (expectedTaken < remaining) return 'risky';
  return 'gone';
}

/**
 * What fraction of picks each position is actually taking, measured from the
 * draft in front of you.
 *
 * The default 0.25 share was a placeholder and it made the survival warning
 * useless: quarterbacks and tight ends do not come off the board at anything
 * like the rate running backs do, so a flat share marked every position as
 * doomed at once. A warning that fires on everything conveys nothing.
 *
 * Measured from a trailing window rather than the whole draft, because
 * positional runs are exactly the thing worth reacting to — if five backs went
 * in the last ten picks, the RB share right now really is 0.5.
 */
export function observedPositionShares(picks, players, window = 24) {
  const recent = picks.slice(-window);
  const shares = {};
  if (!recent.length) return shares;

  // Seed every position at zero. A position nobody has drafted must report a
  // share of 0, not fall through to the caller's default — "no defenses have
  // gone yet" is the strongest possible evidence that defenses are not going,
  // and defaulting it to an average rate marked DEF as about to vanish in
  // round 4.
  const counts = {};
  for (const pos of POSITIONS) counts[pos] = 0;

  let total = 0;
  for (const pick of recent) {
    const p = players[pick.playerId];
    if (!p?.position) continue;
    if (!(p.position in counts)) counts[p.position] = 0;
    counts[p.position]++;
    total++;
  }
  if (!total) return shares;

  for (const [pos, n] of Object.entries(counts)) shares[pos] = n / total;
  return shares;
}

/**
 * Positions whose tier warnings should be suppressed right now.
 *
 * Two reasons a cliff is not information: league rules say you cannot draft
 * the position yet (DEF gated to the last round), or you already hold every
 * starter you can use there (a tier-1 TE run when you rostered Bowers is
 * true, and irrelevant to any decision you face). Shared by the web UI and
 * the terminal watcher so the two never warn differently.
 *
 * @param {import('./state.js').DraftState} state
 * @returns {string[]} positions to pass as ignorePositions
 */
export function suppressedPositions(state) {
  const cfg = state.cfg;
  const round = Math.ceil(state.currentPick / state.teams);
  const gated = new Set();

  const defEarliest = cfg.def_earliest_round ?? state.totalRounds;
  if (round < defEarliest) gated.add('DEF');

  const needs = state.myNeeds();
  const held = state.myRoster();
  for (const pos of ['QB', 'TE', 'DEF']) {
    const starters = cfg.roster[pos] ?? 0;
    if ((held[pos]?.length ?? 0) >= starters && !needs.starterShortfall[pos]) gated.add(pos);
  }
  return [...gated];
}

/**
 * Human-readable signals for the UI, ordered most urgent first. Only positions
 * that are actually at a cliff — a list that flags everything flags nothing.
 */
export function tierSignals(state, picksUntilNextTurn, opts = {}) {
  // Positions you are not allowed to draft yet cannot be urgent. A DEF tier
  // running dry in round 5 is not information when league rules gate DEF to
  // round 15 — it is noise that teaches you to ignore the warnings.
  const skip = new Set(opts.ignorePositions ?? []);
  const shares = opts.positionShares ?? {};

  const signals = [];
  for (const [pos, s] of Object.entries(state)) {
    if (skip.has(pos)) continue;
    const survival = tierSurvival(s.remaining, picksUntilNextTurn, shares[pos]);
    if (!s.cliff && survival === 'safe') continue;
    signals.push({
      position: pos,
      tier: s.tier,
      remaining: s.remaining,
      survival,
      message:
        s.remaining === 1
          ? `last ${pos} in tier ${s.tier}`
          : `${s.remaining} ${pos}s left in tier ${s.tier}` +
            (survival === 'gone' ? ' — gone by your next pick' : ''),
    });
  }
  // Most urgent = fewest left.
  return signals.sort((a, b) => a.remaining - b.remaining);
}
