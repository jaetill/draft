// Watch a live Sleeper draft from the terminal and print recommendations.
//
// Same engine the app uses — this is not a second implementation, it imports
// recommend() and buildRankings() directly. If the two ever disagree, that is a
// bug, not a difference of opinion.
//
// Built for rehearsing against a MOCK draft, which the app's live mode cannot
// reach: mocks have no league, and SleeperLive resolved league → drafts[0] to
// find the draft id. That is now fixed in the app too, but a terminal watcher
// is still the better rehearsal tool — it survives a browser reload, prints a
// scrollback you can read after the fact, and cannot accidentally draft anyone.
//
// Run:
//   node scripts/watch-draft.mjs <draftId> [--slot N] [--interval 5]
//
// The draft id is the last path segment of the room URL:
//   https://sleeper.com/draft/nfl/1347230924139417600
//                                 ^^^^^^^^^^^^^^^^^^^

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRankings } from '../src/rankings.js';
import { DraftState } from '../src/state.js';
import { recommend } from '../src/engine/recommend.js';
import { diversify, filterWorthwhile } from '../src/engine/postfilter.js';
import { projectToMyTurn } from '../src/mock/draft-sim.js';
import { anticipateUpcoming, rotatePersonas } from '../src/owners.js';
import {
  observedPositionShares,
  suppressedPositions,
  tierSignals,
  tierState,
  tierSurvival,
} from '../src/tiers.js';
import { byeImpact } from '../src/byes.js';
import { analyzeBackfields, backfieldLabel } from '../src/backfield.js';
import { availabilityOf } from '../src/availability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const BASE = 'https://api.sleeper.app/v1';

const args = process.argv.slice(2);
const draftId = args.find((a) => !a.startsWith('--'));
const flag = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};

if (!draftId) {
  console.error('Usage: node scripts/watch-draft.mjs <draftId> [--slot N] [--interval 5]');
  console.error('  draftId is the last path segment of the Sleeper draft room URL.');
  process.exit(1);
}

const intervalSec = Number(flag('interval', 2.5));

// Draft metadata (status, settings, order) changes a handful of times in a
// three-hour draft; picks change constantly. Fetching both every tick doubled
// the request rate for nothing. Meta is refreshed on a change, on a slow timer,
// and never in between — which is what buys the faster pick polling.
const META_EVERY_TICKS = Math.max(4, Math.round(15 / intervalSec));

const get = async (path) => {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.json();
};

const rd = async (f, fallback = null) =>
  readFile(join(DATA, f), 'utf8')
    .then(JSON.parse)
    .catch(() => fallback);

const [cfg, players, ecr, byes, valueCurve, tiersRaw, ownerProfiles, tendencies] =
  await Promise.all([
    rd('league.json'),
    rd('players.json'),
    rd('rankings.json'),
    rd('byes.json', { byes: {} }),
    rd('value-curve.json'),
    rd('tiers.json'),
    rd('owner-profiles.json'),
    rd('tendencies.json'),
  ]);

if (byes?.byes) {
  for (const p of Object.values(players)) p.bye_week = byes.byes[p.team] ?? null;
}

const rankings = buildRankings(players, ecr, valueCurve, tiersRaw);
// Committee detection from consensus proximity — see src/backfield.js.
const backfields = analyzeBackfields(players, ecr?.players);
const tiered = tiersRaw?.players ?? [];

console.log(`Watching draft ${draftId}`);
console.log(`  rankings:    ${rankings.meta.source}`);
console.log(`  projections: ${rankings.meta.projectionSource}`);
console.log(
  `  tiers:       ${tiered.length ? `${tiered.length} players` : 'none — run build-tiers'}`,
);

let draft;
try {
  draft = await get(`/draft/${draftId}`);
} catch (err) {
  console.error(`\nCould not read draft ${draftId}: ${err.message}`);
  console.error('  Check the id is the last path segment of the draft room URL,');
  console.error('  e.g. sleeper.com/draft/nfl/1347230924139417600');
  process.exit(1);
}
if (!draft) {
  console.error(`\nDraft ${draftId} returned nothing — is the id right?`);
  process.exit(1);
}

const teams = draft.settings?.teams ?? cfg.teams;
const rounds = draft.settings?.rounds ?? 15;

// A mock is often a different shape than the real league. Scoring a 10-team
// mock against 12-team replacement levels produces confident nonsense, so say
// it rather than let it slide.
if (teams !== cfg.teams) {
  console.warn(`\n⚠ draft has ${teams} teams, league.json says ${cfg.teams} —`);
  console.warn('  replacement levels are tuned for the league size, so VBD will be off.');
}
const leagueRounds =
  cfg.roster.QB +
  cfg.roster.RB +
  cfg.roster.WR +
  cfg.roster.TE +
  cfg.roster.FLEX +
  cfg.roster.DEF +
  cfg.roster.BENCH;
if (rounds !== leagueRounds) {
  console.warn(`\n⚠ draft is ${rounds} rounds, your league is ${leagueRounds} —`);
  console.warn('  roster needs and bye math assume the league shape, so late rounds will differ.');
}

// Which seat are we? Prefer an explicit flag, then the configured user id, then
// the configured slot.
let mySlot = Number(flag('slot', 0)) || null;
if (!mySlot && cfg.my_sleeper_user_id && draft.draft_order) {
  mySlot = draft.draft_order[cfg.my_sleeper_user_id] ?? null;
}
if (!mySlot) mySlot = cfg.my_draft_slot ?? 1;

console.log(`  draft:       ${teams} teams · ${rounds} rounds · status ${draft.status}`);
console.log(`  your slot:   ${mySlot}\n`);

// Persona seat rotation lives in src/owners.js now, shared with the web app.
const usePersonas = !args.includes('--no-personas');
const realSlot = cfg.my_draft_slot ?? mySlot;
const profiles = usePersonas ? rotatePersonas(ownerProfiles, mySlot, realSlot, teams) : null;

// Seat mismatch is the easiest rehearsal mistake to make and the hardest to
// notice: everything still works, you just spend an hour practising a draft
// position you will not have. Slot 12 is the wrap — back-to-back picks and a
// 22-pick wait — and nothing about slot 5 prepares you for it.
if (mySlot !== realSlot) {
  console.warn(`\n⚠ you are in seat ${mySlot}, but your league seat is ${realSlot}.`);
  console.warn(
    `  Turn dynamics differ: seat ${realSlot} picks back-to-back at the wrap, seat ${mySlot} does not.`,
  );
  console.warn('  Personas have been rotated to compensate, but the pick cadence cannot be.\n');
}

if (profiles?.slotToOwner) {
  const chart = profiles.slotToOwner;
  const order = [];
  for (let s = 1; s <= teams; s++) order.push(`${s}:${chart[String(s)] ?? '?'}`);
  console.log(`  personas:    ${order.join('  ')}`);
  if (profiles.rotatedFrom) {
    console.log(
      `               (rotated so your mock seat ${mySlot} = your real seat ${realSlot})`,
    );
  }
  console.log('               mock drafters will NOT behave like these owners — shape only\n');
}

const state = new DraftState({ ...cfg, teams }, players, mySlot);
// DraftState derives totalRounds from the roster config and totalPicks from
// teams × totalRounds, all in the constructor. The live draft is the authority
// on shape, so override all three together — setting teams/rounds and leaving
// totalPicks stale silently breaks isMyTurn and isComplete near the end.
state.teams = teams;
state.totalRounds = rounds;
state.totalPicks = teams * rounds;

let lastPickCount = -1;
let lastStatus = null;

function myRosterPlayers() {
  return state.picks
    .filter((p) => p.slot === mySlot)
    .map((p) => players[p.playerId])
    .filter(Boolean);
}

function picksUntilNextTurn() {
  const next = state.picksForSlot(mySlot).find((p) => p > state.picks.length);
  return next ? next - state.currentPick : 0;
}

const POS_ORDER = ['RB', 'WR', 'TE', 'QB', 'DEF'];

/**
 * How deep the best remaining tier is at every position, on one line.
 *
 * This is the number that actually drives a snake-draft decision: not "who is
 * best" but "how many of these are left before the drop". A position showing
 * (1) is about to fall off a cliff whether or not it holds the highest-ranked
 * player on the board.
 */
function renderTierTable(st, picksAway, shares) {
  if (!Object.keys(st).length) return;
  const cells = [];
  for (const pos of POS_ORDER) {
    const s = st[pos];
    if (!s) continue;
    const survival = tierSurvival(s.remaining, picksAway, shares[pos]);
    // ! = will not last until your next pick. * = down to one or two.
    const mark = survival === 'gone' ? '!' : s.remaining <= 2 ? '*' : ' ';
    cells.push(
      `${pos.padEnd(3)} T${String(s.tier).padEnd(2)} ${String(s.remaining).padStart(2)}${mark}`,
    );
  }
  console.log(`  best tier left:  ${cells.join('   ')}`);
}

function render() {
  // currentPick is picks.length + 1, so once the board is full it points one
  // past the end — which rendered "pick 181 · round 16" in a 180-pick draft.
  // The completion summary in tick() is the right thing to print there.
  if (state.picks.length >= state.totalPicks) return;

  const round = Math.ceil(state.currentPick / state.teams);
  console.log('─'.repeat(72));
  console.log(`pick ${state.currentPick} · round ${round} · ${state.picks.length} made`);

  const roster = myRosterPlayers();
  if (roster.length) {
    const counts = {};
    for (const p of roster) counts[p.position] = (counts[p.position] ?? 0) + 1;
    const shape = POS_ORDER.filter((p) => counts[p])
      .map((p) => `${counts[p]}${p}`)
      .join(' ');
    console.log(`  roster (${roster.length}): ${shape} — ${roster.map((p) => p.name).join(', ')}`);
  }

  // Tier cliffs — the thing a ranked list cannot tell you. Positions gated by
  // league rules are suppressed: a DEF tier emptying in round 5 is not
  // actionable when DEF is locked until round 15.
  const away = picksUntilNextTurn();

  if (tiered.length) {
    const st = tierState(tiered, state.taken);
    // Rate each position is actually leaving the board in THIS draft, so the
    // survival marks reflect the room in front of you rather than a constant.
    const shares = observedPositionShares(state.picks, players);
    // Full picture, every position, every update — this is the "how many are
    // left in the top tier" view.
    renderTierTable(st, away, shares);

    // Rule-gated and already-covered positions cannot be urgent — shared logic
    // in src/tiers.js so the web app warns identically.
    const gated = suppressedPositions(state);

    const signals = tierSignals(st, away, { ignorePositions: gated, positionShares: shares });
    for (const s of signals.slice(0, 3)) console.log(`    ⚠ ${s.message}`);
  }

  // Who picks in the gap before your next turn, and what they historically want.
  // This is the half of the draft you cannot control and the reason a tier that
  // "should" survive sometimes doesn't.
  if (profiles) {
    const upcoming = anticipateUpcoming(state, profiles, Math.min(away, 12));
    const seen = new Map();
    for (const u of upcoming) {
      if (!u.profile?.name) continue;
      if (!seen.has(u.profile.name)) seen.set(u.profile.name, u.profile.primary);
    }
    if (seen.size) {
      const who = [...seen].map(([name, arch]) => `${name}${arch ? ` (${arch})` : ''}`).join(', ');
      console.log(`  picking before you: ${who}`);
    }
  }

  // Recommendations on EVERY update, not only on the clock. Twenty-two picks
  // pass between turns at the wrap; seeing the board evolve the whole time is
  // the difference between deciding in two minutes and deciding over ten.
  //
  // But when it is not your turn, the CURRENT board is the wrong thing to show.
  // At pick 1 from seat 12 it listed Jahmyr Gibbs — who will be gone eleven
  // picks before you choose — and attached a two-pick total for a pick you do
  // not have. Simulating forward to your actual next turn answers the question
  // you are really asking while you wait: what is likely to still be there?
  let evalState = state;
  let projected = false;

  if (!state.isMyTurn) {
    if (away <= 0) {
      console.log('\n  no picks remaining\n');
      return;
    }
    const projection = projectToMyTurn(state, profiles, Math.random, rankings, tendencies);
    evalState = projection.state;
    projected = true;
    console.log(`\n  PROJECTED board at your pick (${away} picks away, simulated)\n`);
  } else {
    console.log('\n  ★ YOU ARE ON THE CLOCK');
    console.log('    ranked by two-pick total: this pick + your best option next turn\n');
  }
  // Lookahead on, deliberately. Raw VBD systematically over-rates QBs in the
  // middle rounds: you start exactly one, so the second-best QB on your roster
  // is worth nothing, but VBD prices every QB against QB12 as if you could use
  // them all. Lookahead asks the question that actually decides it — will a
  // comparable player at this position still be here at my next pick? For a
  // position the room lets slide (QB, per market-gap) the answer is usually yes.
  // Ask for a deeper list than we show, so the diversity filter below has
  // something to work with.
  const raw = recommend(evalState, rankings, {
    level: 'l2',
    thesis: 'none',
    n: 20,
    ownerProfiles: profiles,
    tendencies,
    // Two-pick reasoning only means something when the first pick is yours to
    // make. On a projected board it would stack one simulation on another.
    lookahead: !projected,
  });

  // Diversity + worthwhile filtering shared with the web app — see
  // src/engine/postfilter.js for the reasoning (and for why "worthwhile" is a
  // score test, not a VBD test).
  const recs = diversify(raw, { maxPerPos: 2, limit: 6 });
  const { shown, allZero } = filterWorthwhile(recs, 3);
  if (allZero) {
    console.log('  (no positive-value players left — take upside, not VBD)\n');
  }

  const evalRoster = projected
    ? evalState.picks
        .filter((x) => x.slot === mySlot)
        .map((x) => players[x.playerId])
        .filter(Boolean)
    : roster;

  shown.forEach((r, i) => {
    const p = r.player;
    const bye = p.bye_week ? `bye ${p.bye_week}` : '';
    const impact = byeImpact(p, evalRoster, cfg);
    const byeWarn = impact ? `  ⚠ ${impact.message}` : '';
    // SCORE is what the list is ordered by (VBD × roster need). Printing VBD
    // alone made the ranking look scrambled — a 61-VBD fifth tight end sitting
    // below a 55-VBD starting QB is correct, but only if you can see why.
    console.log(
      `  ${i + 1}. ${p.name.padEnd(22)} ${p.position.padEnd(4)}${String(p.team ?? '').padEnd(4)} ` +
        `${String(Math.round(r.score)).padStart(3)}  (VBD ${String(Math.round(r.vbd)).padStart(3)}` +
        `${r.mult !== 1 ? ` ×${r.mult.toFixed(2)}` : ''})  ${bye}`,
    );
    // Depth-chart position and committee status, when we know them. A back
    // splitting carries a compressed ceiling, which VBD cannot see.
    const bfLabel = backfieldLabel(backfields.get(p.id));
    const depth = p.depth_chart_order ? `${p.position}${p.depth_chart_order} on depth chart` : '';
    // Availability, but only when it means missed games. The raw injury tag is
    // dominated by preseason "Questionable" — printing that next to a top-5
    // pick would train you to ignore the whole line.
    const avail = availabilityOf(p);
    const availLabel =
      avail?.level === 'out'
        ? `⛔ ${avail.label}${avail.weeksLikelyMissed ? ` — ~${avail.weeksLikelyMissed}+ wks` : ''}`
        : '';
    const context = [depth, bfLabel, availLabel].filter(Boolean).join(' · ');
    console.log(`     ${r.rationale}${byeWarn}`);
    if (context) console.log(`     ${context}`);
    // "If I skip him, here is the best I can expect at my next turn." The gap
    // between the two is the real cost of waiting.
    if (r.futureBest) {
      // Direction matters and the old wording had it backwards. This is not
      // "what you get if you pass on him" — it is "take him NOW, and this is
      // the best player still on the board at your next turn". The engine
      // drafts the candidate, simulates the opponents in between, then
      // evaluates your next pick from that state.
      //
      // The combined figure is the one the list is actually ordered by, so it
      // has to be visible: a lower-scoring player now can win on the pair.
      //
      // futureScore, not futureVbd — the main list is ordered by score, and raw
      // VBD made a heavily-penalised player (a second DEF at ×0.02) look like a
      // strong consolation prize.
      const then = Math.round(r.futureScore ?? 0);
      const total = Math.round(r.totalScore ?? r.score);
      console.log(
        `     → take him, then likely ${r.futureBest.name} ` +
          `(${r.futureBest.position}${r.futureBest.posRank}, ${then})  = ${total} over both picks`,
      );
    }
    // recommend() already computes these from owner history; they were being
    // thrown away before the list was printed.
    for (const sig of r.signals ?? []) console.log(`     ⚡ ${sig}`);
  });
  console.log('');
}

let tickCount = 0;
let meta = draft;

async function tick() {
  tickCount++;
  try {
    const picks = await get(`/draft/${draftId}/picks`);
    const pickCount = picks.filter((p) => p.player_id).length;

    // Nothing happened. Don't rebuild state, don't re-render, don't spend a
    // second request on metadata that cannot have changed meaningfully.
    const changed = pickCount !== lastPickCount;
    const dueForMeta = tickCount % META_EVERY_TICKS === 1;
    if (!changed && !dueForMeta) return;

    if (changed || dueForMeta) {
      meta = await get(`/draft/${draftId}`);
    }

    if (meta.status !== lastStatus) {
      console.log(`\n[status] ${lastStatus ?? '—'} → ${meta.status}`);
      lastStatus = meta.status;
    }

    if (changed) {
      const sorted = [...picks].sort((a, b) => a.pick_no - b.pick_no);
      const next = [];
      const taken = new Set();
      let unknown = 0;
      for (const sp of sorted) {
        if (!sp.player_id) continue;
        if (!players[sp.player_id]) {
          unknown++;
          continue;
        }
        next.push({ pick: sp.pick_no, slot: sp.draft_slot, playerId: sp.player_id });
        taken.add(sp.player_id);
      }
      state.picks = next;
      state.taken = taken;

      if (unknown) {
        console.warn(`  (${unknown} picks referenced players missing from players.json)`);
      }
      render();
      lastPickCount = pickCount;
    }

    if (meta.status === 'complete') {
      console.log('\nDraft complete. Final roster:');
      for (const p of myRosterPlayers()) console.log(`  ${p.position.padEnd(4)} ${p.name}`);
      process.exit(0);
    }
  } catch (err) {
    console.error(`  poll failed: ${err.message}`);
  }
}

await tick();
setInterval(tick, intervalSec * 1000);
