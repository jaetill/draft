// L2 engine — VBD (Value Based Drafting).
// Player value = projected points minus replacement-level player at that position.
// Replacement levels come from data/league.json (QB12, RB30, WR36, TE15, DEF12 for
// 12-team PPR with 2 RB / 2 WR / 1 TE / 2 FLEX starters).
//
// The big idea: a 380-point QB1 only beats QB12 by ~50 points, while a 330-point
// RB1 beats RB30 by ~150. So RB1 is more "valuable" than QB1 even with fewer raw
// points — scarcity dominates. VBD makes this explicit.

import { posLabel } from './labels.js';

/**
 * How many players at a position are actually worth owning.
 *
 * Beyond starters (plus flex for eligible positions), this is the bench depth
 * that can ever get into a lineup. You start one QB, so a second is bye/injury
 * cover and a third can never play. RB and WR churn constantly, so depth there
 * is real. DEF is streamed off waivers — one is plenty.
 *
 * Without this, `benchRoom > 0` handed every position a flat 1.0 and the engine
 * cheerfully recommended a fifth tight end over a startable receiver, because
 * TE9's raw VBD beat WR33's. VBD measures value against replacement at the
 * position; it has no idea you cannot start five of them.
 */
const USEFUL_BENCH = { QB: 1, RB: 4, WR: 4, TE: 1, DEF: 0 };

/**
 * What a bench player at this position is worth relative to a bench RB/WR.
 *
 * The asymmetry is about paths into the lineup. A backup RB or WR plays on any
 * injury, any bye, any breakout, and can slot into flex. A second tight end
 * behind an elite starter has almost none of that, and a second quarterback has
 * exactly one (the starter's bye).
 */
const BENCH_VALUE = { RB: 1.0, WR: 1.0, TE: 0.35, QB: 0.5, DEF: 0.15 };

/**
 * Bench values adjusted for how this manager actually plays the roster.
 *
 * The defaults above assume a backup QB or TE has real bye/injury value. That is
 * true for most managers and false for this one: he does not bench a healthy
 * starter, and he covers byes by dropping his worst player for a one-week
 * fill-in rather than by rostering a backup all season. A drafted QB2 spends
 * fourteen weeks occupying a slot to start once.
 *
 * Deliberately NOT applied to opponents. The tendency data is unambiguous that
 * other owners draft backup quarterbacks — 83% of owner-seasons take a QB2 — so
 * projecting his preferences onto them would make the simulation worse, not
 * better.
 */
function benchValueFor(pos, cfg) {
  const s = cfg.roster_strategy;
  if (!s) return BENCH_VALUE[pos] ?? 1;
  if (pos === 'QB' && s.backup_qb_value !== undefined) return s.backup_qb_value;
  if (pos === 'TE' && s.backup_te_value !== undefined) return s.backup_te_value;
  return BENCH_VALUE[pos] ?? 1;
}

/**
 * Can this position take a flex slot at all?
 *
 * Deliberately NOT a quality gate any more. Two earlier versions tried one — a
 * blanket "never flex a TE", then a tier cut — and both were wrong for the same
 * reason: they hard-block a tight end who would win the comparison on points.
 *
 * The actual rule is a direct comparison. A TE goes in the flex if his
 * projected scoring matches the RB or WR he is competing against for that slot,
 * which is precisely what the flex baseline in flexReplacementPoints() already
 * measures. Nothing extra is needed to express it.
 */
function flexEligibleFor(pos, cfg) {
  if (!(cfg.flex_eligible ?? []).includes(pos)) return false;
  if (pos === 'TE' && cfg.roster_strategy?.flexes_te === false) return false;
  return true;
}

/**
 * Mild preference for filling flex with a running back or receiver.
 *
 * Not a value judgement about the player — the points comparison has already
 * happened by this point. This only encodes a stated preference for an RB/WR
 * blend, so a tight end needs to be clearly comparable rather than a coin flip
 * to displace one. At 0.9 a TE still wins whenever he is meaningfully better,
 * and loses the near-ties.
 */
function flexPreference(pos, cfg) {
  if (pos !== 'TE') return 1;
  return cfg.roster_strategy?.flex_te_discount ?? 1;
}

/**
 * Replacement level for a FLEX slot: the best flex-eligible player who does not
 * start anywhere in the league.
 *
 * This exists because positional replacement is the wrong baseline for a player
 * who can only reach the lineup through flex. A second tight end is not
 * competing against TE15 — the TE1 slot is already yours — he is competing
 * against every running back and receiver who could take that same flex spot.
 * Measuring him against TE15 credits him for scarcity he cannot cash in.
 *
 * The size of the error is not small, and a constant multiplier cannot express
 * it. With this league's curve the flex line sits at RB31 (≈153) while TE15 is
 * 132, so a flex-bound TE loses a flat ~21 points. That is a mild haircut for an
 * elite TE and near-total for a mediocre one:
 *
 *     TE2   starter +95  →  flex +74   (×0.78)
 *     TE12  starter +23  →  flex  +2   (×0.09)
 *
 * The old `te_flex_penalty: 0.5` and `BENCH_VALUE.TE: 0.35` were flat ratios,
 * which is exactly the wrong shape — they over-punished the elite TE and
 * under-punished the replacement-level one.
 *
 * The same correction runs the other way for receivers: WR36 (173) sits ABOVE
 * the flex line, so positional VBD was *understating* a flex-bound WR by ~20.
 */
function flexReplacementPoints(state, rankings) {
  const r = state.cfg.roster;
  const eligible = (state.cfg.flex_eligible ?? ['RB', 'WR', 'TE']).filter((pos) =>
    flexEligibleFor(pos, state.cfg),
  );

  // Every flex-eligible starting slot in the league: positional plus flex.
  const positional = eligible.reduce((sum, pos) => sum + (r[pos] ?? 0), 0);
  const slots = state.teams * (positional + (r.FLEX ?? 0));

  // Merge the eligible positions into one pool ordered by projected points, and
  // read off the first player past the last starting slot.
  const pool = [];
  for (const pos of eligible) {
    for (const p of rankings.byPos[pos] ?? []) pool.push(rankings.projection(p));
  }
  if (!pool.length) return 0;
  pool.sort((a, b) => b - a);
  return pool[Math.min(slots, pool.length - 1)];
}

/**
 * Decay for piling up a position you have already covered.
 *
 * Note this is only reached from the benchRoom branch, which by construction
 * means starters AND flex are already satisfied — so every additional body here
 * is bench, and `surplus` is measured against starters alone. An earlier version
 * credited flex-eligible positions with the full flex allotment, which made the
 * surplus negative for a rostered tight end and silently disabled the penalty
 * entirely. The symptom was a recommendation list of four tight ends.
 */
function saturationFactor(pos, have, state) {
  const starters = state.cfg.roster[pos] ?? 0;
  const bench = USEFUL_BENCH[pos] ?? 2;
  const surplus = Math.max(0, have - starters);

  if (surplus >= bench) return 0.02; // effectively unrecommendable
  return benchValueFor(pos, state.cfg) * Math.pow(0.45, surplus);
}

/**
 * Which lineup slot would this player actually occupy, and what is he measured
 * against there?
 *
 * Value is slot-dependent, so the baseline has to be too. Ordered best slot
 * first: a positional starter spot if one is open, otherwise flex, otherwise
 * bench.
 */
/**
 * How many flex slots may tight ends occupy at once?
 *
 * The per-player flex comparison is right for the FIRST tight end past the
 * starter: he wins the slot on points or he doesn't. But it has no memory —
 * once one TE holds a flex slot, a second elite TE gets the identical
 * comparison and the identical mild discount, and the engine happily built a
 * three-TE starting lineup (Bowers, then McBride and Loveland in both flex
 * slots). flex_te_discount cannot fix this: it is a flat per-player nudge, and
 * the problem is a count. `max_flex_te` caps the count; TEs past the cap are
 * valued as bench (backup_te_value), which for this manager is ~nothing.
 */
function teFlexSlotsUsed(state) {
  const have = state.myRoster().TE?.length ?? 0;
  const starters = state.cfg.roster.TE ?? 0;
  return Math.max(0, have - starters);
}

function slotFor(player, state) {
  const needs = state.myNeeds();
  const pos = player.position;

  if (needs.starterShortfall[pos] > 0) return 'starter';
  if (flexEligibleFor(pos, state.cfg) && needs.flexShortfall > 0) {
    const teCap = state.cfg.roster_strategy?.max_flex_te;
    const capped = pos === 'TE' && teCap !== undefined && teFlexSlotsUsed(state) >= teCap;
    if (!capped) return 'flex';
  }
  if (needs.benchRoom > 0) return 'bench';
  return 'none';
}

function needMultiplier(player, state, slot) {
  const pos = player.position;
  const have = state.myRoster()[pos]?.length ?? 0;

  if (slot === 'starter') return pos === 'DEF' ? 1.0 : 1.4;
  // The flex baseline has already done the point comparison; the preference
  // term only breaks near-ties toward an RB/WR blend.
  if (slot === 'flex') return 1.15 * flexPreference(pos, state.cfg);
  if (slot === 'bench') return saturationFactor(pos, have, state);
  return 0;
}

function rationale(player, state, rankings, vbd, slot) {
  const pos = player.position;
  const r = rankings.posRank.get(player.id);
  const t = rankings.posTier(player);
  const reasons = [];

  // Name the baseline, because "+40 VBD" means something different depending on
  // what it was measured against.
  if (slot === 'flex') {
    reasons.push(`+${vbd.toFixed(0)} vs flex`);
    reasons.push('flex slot');
  } else {
    reasons.push(`+${vbd.toFixed(0)} VBD`);
    if (slot === 'starter' && pos !== 'DEF') reasons.push(`fills ${pos} starter`);
    else if (slot === 'bench') reasons.push(`${posLabel(pos)} depth`);
  }

  reasons.push(`${pos}${r} (tier ${t})`);
  return reasons.join(' · ');
}

/**
 * Recommend top N picks using VBD.
 *
 * @returns {Array<{player, score, vbd, mult, tier, posRank, rationale}>}
 */
export function recommend(state, rankings, n = 5) {
  const replacement = {};
  for (const [pos, cutoff] of Object.entries(state.cfg.replacement_levels || {})) {
    if (pos.startsWith('_')) continue;
    replacement[pos] = rankings.replacementPoints(pos, cutoff);
  }

  const currentRound = Math.ceil(state.currentPick / state.teams);
  const defEarliestRound = state.cfg.def_earliest_round ?? state.totalRounds;

  const flexRepl = flexReplacementPoints(state, rankings);

  const available = state.available();
  const scored = [];
  for (const p of available) {
    if (p.position === 'DEF' && currentRound < defEarliestRound) continue;
    const slot = slotFor(p, state);
    const mult = needMultiplier(p, state, slot);
    if (mult === 0) continue;

    const projection = rankings.projection(p);
    // The baseline depends on where he'd actually play. A flex-bound player
    // competes with everyone else eligible for that slot, not with the tail of
    // his own position.
    const repl = slot === 'flex' ? flexRepl : (replacement[p.position] ?? 0);
    const vbd = Math.max(0, projection - repl);
    const score = vbd * mult;
    scored.push({
      player: p,
      score,
      vbd,
      mult,
      slot,
      tier: rankings.posTier(p),
      posRank: rankings.posRank.get(p.id) ?? 999,
    });
  }

  // Tie-break on roster need FIRST, then expert consensus. In the late rounds
  // VBD bottoms out at zero for everyone, so score = vbd × mult collapses to
  // 0 × anything = 0 — and the need multiplier, the term that encodes "you can
  // actually start this player", stops separating candidates entirely. With
  // ECR as the only tiebreak, the list surfaced whoever the experts rank best
  // in a vacuum: a fifth tight end (mult 0.02) beat a startable RB filling an
  // open RB2 slot (mult 1.4), because both scored 0 and Jake Ferguson out-ranks
  // waiver-wire backs. Breaking ties on mult restores the slot hierarchy —
  // starter > flex > bench, and within bench, positions this manager can
  // actually use — before falling back to best-available.
  const ecrOf = (p) => rankings.meta?.ecr?.(p) ?? Number.POSITIVE_INFINITY;
  // Noise floor: a fraction of a season point is not a real edge. Without it, a
  // buried fifth TE at 23 VBD × 0.02 = 0.46 "beat" every zero-scored startable
  // back — sub-point residue winning on arithmetic, not on football. Scores
  // under one point collapse to zero so the mult tiebreak can do its job.
  const sig = (s) => (s.score < 1 ? 0 : s.score);
  scored.sort((a, b) => sig(b) - sig(a) || b.mult - a.mult || ecrOf(a.player) - ecrOf(b.player));
  return scored.slice(0, n).map((s) => ({
    ...s,
    rationale: rationale(s.player, state, rankings, s.vbd, s.slot),
  }));
}
