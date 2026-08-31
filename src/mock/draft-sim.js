// Mock draft simulator. Other teams pick by:
//   1. ADP heuristic (top by search_rank, capped per position)
//   2. Owner archetype bias (Anchor TE / Early QB / Hero RB / Zero RB / Robust RB),
//      pulled from owner-profiles.json — NuttySequel reaches for an elite TE in R2
//      because that's what NuttySequel did in 2025.
//
// Without history, every opponent reduces to "Default" which is just step 1.

import {
  opponentBias,
  profileForSlot,
  teamAffinityBias,
  rookieBias,
  loyaltyBias,
} from '../owners.js';

const POS_LIMITS = { QB: 2, RB: 8, WR: 8, TE: 2, DEF: 1 };

/**
 * How much an opponent still wants a position, given how many he already has.
 *
 * A hard cap alone is not enough. Under a pure popularity ordering the
 * simulator drafted SEVEN quarterbacks in 22 picks of a one-QB league while
 * leaving Travis Kelce on the board — every team that already had a starter was
 * still valuing QB2 as though it were a starter. Once the slot is filled the
 * marginal body is worth a fraction of that, and the drop is steepest at the
 * positions you can only start one of.
 */
const OPP_NEED = {
  QB: [1, 0.12],
  TE: [1, 0.18],
  DEF: [1],
  RB: [1, 1, 0.85, 0.6, 0.4, 0.25, 0.15, 0.1],
  WR: [1, 1, 0.85, 0.6, 0.4, 0.25, 0.15, 0.1],
};

/**
 * Willingness to take the next player at a slot-limited position, measured from
 * eight seasons of this league's drafts (public/data/tendencies.json).
 *
 * The constants above were a guess and they had no notion of round, so the
 * simulator would hand a team its second quarterback in round 8. The history is
 * emphatic that this does not happen: across 83 owner-seasons, QB2 went before
 * round 10 exactly twice, and no defense went before round 8 at all.
 *
 * It is also strongly owner-specific rather than a league constant. Bruno2328
 * has taken a defense in round 9 in five of eight seasons; Tilleydmt has never
 * taken one before round 14. Modelling that as one number throws away the most
 * predictive thing in the data.
 */
function tendencyFactor(tendencies, ownerName, position, have, round) {
  if (!tendencies) return null;
  const key = `${position}${have + 1}`;
  const curve = tendencies.owners?.[ownerName]?.slots?.[key] ?? tendencies.league?.[key];
  if (!Array.isArray(curve)) return null;

  const r = Math.max(1, Math.min(round, curve.length - 1));
  // Floor keeps a surprise pick possible — these are people, not a spreadsheet.
  return Math.max(0.02, curve[r]);
}

/**
 * Deadline pressure on unfilled starting slots.
 *
 * Tendency curves describe when something happened; they cannot produce a
 * FORCED pick, and that gap showed immediately — with curves alone the
 * simulator never drafted a defense at all, across six full drafts. Nobody
 * takes a DEF because it is valuable. They take it because the season is about
 * to start and the slot is empty, and a defense will beat any skill player on
 * a roster that legally cannot start without one.
 *
 * So: count the required starting slots a team still has to fill against the
 * picks it has left. Once those numbers converge, the requirement dominates
 * value entirely. That is what produces the round 14-15 flood in the real data.
 */
function urgencyFactor(state, position, myCount, round) {
  const roster = state.cfg.roster ?? {};
  const required = roster[position] ?? 0;
  const have = myCount[position] ?? 0;
  if (have >= required) return null; // slot already covered — no pressure

  let mustStillFill = 0;
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'DEF']) {
    mustStillFill += Math.max(0, (roster[pos] ?? 0) - (myCount[pos] ?? 0));
  }
  const picksLeft = (state.totalRounds ?? 15) - round + 1;
  const slack = picksLeft - mustStillFill;

  if (slack <= 0) return 1; // out of room: fill it now
  if (slack === 1) return 0.9; // one spare pick
  if (slack === 2) return 0.55;
  return null; // plenty of time — defer to the measured tendency
}

function needFactor(position, have, round, tendencies, ownerName, state, myCount) {
  const urgent = state ? urgencyFactor(state, position, myCount, round) : null;
  const measured = tendencyFactor(tendencies, ownerName, position, have, round);

  // Whichever is stronger. A team that still wants the slot AND is running out
  // of picks should act on the more pressing of the two, not the average.
  if (urgent !== null && measured !== null) return Math.max(urgent, measured);
  if (urgent !== null) return urgent;
  if (measured !== null) return measured;

  const curve = OPP_NEED[position];
  if (!curve) return 1;
  return curve[Math.min(have, curve.length - 1)] ?? 0.05;
}

function rostersBySlot(state) {
  const out = {};
  for (let s = 1; s <= state.teams; s++) {
    out[s] = { QB: 0, RB: 0, WR: 0, TE: 0, DEF: 0 };
  }
  for (const pick of state.picks) {
    const p = state.players[pick.playerId];
    if (out[pick.slot] && out[pick.slot][p.position] !== undefined) {
      out[pick.slot][p.position]++;
    }
  }
  return out;
}

/**
 * Pick a player for the team currently on the clock.
 * @param {DraftState} state
 * @param {object|null} ownerProfiles - from owner-profiles.json
 * @param {() => number} rng
 */
export function pickForOpponent(
  state,
  ownerProfiles = null,
  rng = Math.random,
  rankings = null,
  tendencies = null,
) {
  const available = state.available();
  const slot = state.currentSlot;
  const round = Math.ceil(state.currentPick / state.teams);
  const rosters = rostersBySlot(state);
  const myCount = rosters[slot];

  const profile = profileForSlot(ownerProfiles, slot);
  const archetype = profile?.primary;

  // Candidate window.
  //
  // Ordered by consensus when we have it. state.available() sorts by
  // search_rank, and EVERY team defense carries search_rank 9999 — so in a
  // thousand-player pool the defenses sit dead last and a top-50 window never
  // contained one. The simulator could not draft a defense at all, in any
  // round, no matter how urgent the empty slot became.
  const eligible = [];
  for (const p of available) {
    if ((myCount[p.position] ?? 0) >= POS_LIMITS[p.position]) continue;
    eligible.push(p);
  }
  if (eligible.length === 0) return available[0];

  const rank = (p) => rankings?.meta?.ecr?.(p) ?? p.search_rank ?? 9999;
  eligible.sort((a, b) => rank(a) - rank(b));
  const pool = eligible.slice(0, 50);

  // Guarantee the best few at any REQUIRED position still unfilled. Defenses
  // rank poorly on every value metric by construction — they are worth little
  // right up until the moment you cannot field a legal lineup without one — so
  // a pure value window would keep excluding them even at the deadline.
  const roster = state.cfg.roster ?? {};
  for (const pos of ['QB', 'RB', 'WR', 'TE', 'DEF']) {
    if ((myCount[pos] ?? 0) >= (roster[pos] ?? 0)) continue;
    const best = eligible.filter((p) => p.position === pos).slice(0, 3);
    for (const p of best) if (!pool.includes(p)) pool.push(p);
  }

  // Base value: expert consensus when we have it, popularity only as a fallback.
  //
  // search_rank is Sleeper's SEARCH POPULARITY index, and quarterbacks are the
  // most-searched players in fantasy football regardless of where they go. Using
  // it as the opponents' board made them draft like the position mattered far
  // more than it does, which quietly corrupted everything downstream: lookahead
  // runs on this simulation, so a board full of misdrafted QBs left genuinely
  // valuable players "surviving" 22 picks and inflated every two-pick total.
  const ecrOf = (p) => rankings?.meta?.ecr?.(p) ?? null;
  const scored = pool.map((p) => {
    const consensus = ecrOf(p);
    const base =
      consensus !== null ? 1000 - Math.min(consensus, 999) : 1000 - Math.min(p.search_rank, 999);
    const need = needFactor(
      p.position,
      myCount[p.position] ?? 0,
      round,
      tendencies,
      profile?.name,
      state,
      myCount,
    );
    const archBias = opponentBias(archetype, p, round);
    const teamBias = teamAffinityBias(profile, p);
    const rookBias = rookieBias(profile, p);
    const loyalBias = loyaltyBias(profile, p);
    return { player: p, score: base * need * archBias * teamBias * rookBias * loyalBias };
  });
  scored.sort((a, b) => b.score - a.score);

  // Weighted pick from top 3 with mild randomness.
  const top = scored.slice(0, Math.min(3, scored.length));
  const weights = [0.65, 0.25, 0.1].slice(0, top.length);
  const r = rng();
  let acc = 0;
  for (let i = 0; i < top.length; i++) {
    acc += weights[i];
    if (r < acc) return top[i].player;
  }
  return top[top.length - 1].player;
}

export function simulateUntilMyTurn(
  state,
  ownerProfiles = null,
  rng,
  rankings = null,
  tendencies = null,
) {
  const made = [];
  while (!state.isComplete && !state.isMyTurn) {
    const player = pickForOpponent(state, ownerProfiles, rng, rankings, tendencies);
    state.addPick(player.id);
    made.push({ pick: state.picks[state.picks.length - 1], player });
  }
  return made;
}

/**
 * What the board probably looks like when it is my turn — without touching the
 * real state.
 *
 * When it is not your turn, the CURRENT board is the wrong thing to evaluate.
 * At pick 1 from seat 12, recommending Jahmyr Gibbs — who will be gone eleven
 * picks before you choose — answers a question you were never going to be
 * asked. Simulating the opponents forward to your actual next pick answers the
 * one you are asking while you wait: what is likely to still be there?
 *
 * Returns null when there is no waiting to do (your turn, or draft over).
 *
 * @returns {null | {state: DraftState, simmed: number}}
 */
export function projectToMyTurn(
  state,
  ownerProfiles = null,
  rng = Math.random,
  rankings = null,
  tendencies = null,
) {
  if (state.isMyTurn || state.isComplete) return null;
  const cloned = state.clone();
  let simmed = 0;
  while (!cloned.isComplete && !cloned.isMyTurn) {
    const player = pickForOpponent(cloned, ownerProfiles, rng, rankings, tendencies);
    cloned.addPick(player.id);
    simmed++;
  }
  return { state: cloned, simmed };
}

export function seededRng(seed) {
  let s = seed | 0;
  return () => {
    s = (s * 1664525 + 1013904223) | 0;
    return ((s >>> 0) % 1_000_000) / 1_000_000;
  };
}
