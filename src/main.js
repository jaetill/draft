import './feedback.js';
import { DraftState } from './state.js';
import { buildRankings } from './rankings.js';
import { recommend } from './engine/recommend.js';
import { diversify, filterWorthwhile } from './engine/postfilter.js';
import { projectToMyTurn, seededRng, simulateUntilMyTurn } from './mock/draft-sim.js';
import { anticipateUpcoming, rotatePersonas } from './owners.js';
import { observedPositionShares, suppressedPositions, tierSignals, tierState } from './tiers.js';
import { analyzeBackfields } from './backfield.js';
import { SleeperLive } from './sleeper-live.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

const uiState = {
  thesis: 'none',
  level: 'l2',
  mode: 'mock',
  live: null,
  availablePosFilter: 'ALL',
  // On by default — it is what the terminal watcher runs on your turn, and raw
  // VBD systematically over-rates mid-round QBs without it.
  lookahead: true,
  draftIdInput: '',
};
let state;
let rankings;
let ownerProfiles = null;
let tendencies = null;
let tiered = [];
let backfields = new Map();
let live = null;
let wakeLock = null;

async function loadData() {
  const optional = (path) =>
    fetch(path)
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

  const [cfg, players, profiles, ecr, byes, playersMeta, valueCurve, tiersRaw, tendenciesRaw] =
    await Promise.all([
      fetch('/data/league.json').then((r) => r.json()),
      fetch('/data/players.json').then((r) => r.json()),
      optional('/data/owner-profiles.json'),
      // Optional: the app degrades to synthetic rankings rather than failing to
      // boot, which is the right trade five minutes before a draft.
      optional('/data/rankings.json'),
      optional('/data/byes.json'),
      optional('/data/players-meta.json'),
      optional('/data/value-curve.json'),
      optional('/data/tiers.json'),
      optional('/data/tendencies.json'),
    ]);

  // Join byes on team. Sleeper leaves bye_week null on every player record, and
  // build-players.mjs regenerates players.json wholesale — so byes live in their
  // own file and get stamped on at load rather than baked in.
  if (byes?.byes) {
    for (const p of Object.values(players)) {
      p.bye_week = byes.byes[p.team] ?? null;
    }
  }

  return { cfg, players, profiles, ecr, byes, playersMeta, valueCurve, tiersRaw, tendenciesRaw };
}

/** Days since the player snapshot was built, or null if unknown. */
function snapshotAgeDays(playersMeta) {
  if (!playersMeta?.generatedAt) return null;
  return Math.round((Date.now() - new Date(playersMeta.generatedAt).getTime()) / 86_400_000);
}

/** Opponent picks between now and my next turn (0 when on the clock / done). */
function picksUntilNextTurn() {
  const next = state.picksForSlot(state.mySlot).find((p) => p > state.picks.length);
  return next ? next - state.currentPick : 0;
}

const myRosterPlayers = (st) =>
  st.picks
    .filter((p) => p.slot === st.mySlot)
    .map((p) => st.players[p.playerId])
    .filter(Boolean);

/**
 * Owner personas for the room we are actually in.
 *
 * owner-profiles.json maps REAL league slots to owners. In a mock you sit in an
 * arbitrary chair, so the chart is rotated to put you back in your own seat
 * (see rotatePersonas). A room of a different size than the league chart gets
 * NO personas rather than wrong ones — seating Bruno2328 at random in a
 * 10-team mock would feed the simulator confident nonsense.
 */
function personasFor() {
  if (!ownerProfiles?.slotToOwner) return ownerProfiles;
  const chartSlots = Object.keys(ownerProfiles.slotToOwner).length;
  if (chartSlots !== state.teams) return null;
  const realSlot = state.cfg.my_draft_slot ?? state.mySlot;
  return rotatePersonas(ownerProfiles, state.mySlot, realSlot, state.teams);
}

/**
 * Cached projection to my next turn. Seeded by the pick count so the projected
 * board is stable across re-renders (tab taps, poll ticks with no new picks)
 * and refreshes exactly when the real board changes. Math.random here would
 * reshuffle the projection every render, which reads as flakiness.
 */
const projCache = { key: null, projection: null };

function projectedToMyTurn(profiles) {
  const key = `${state.picks.length}|${state.mySlot}|${state.teams}|${state.totalPicks}`;
  if (projCache.key !== key) {
    projCache.key = key;
    projCache.projection = projectToMyTurn(
      state,
      profiles,
      seededRng(state.picks.length * 7919 + state.mySlot),
      rankings,
      tendencies,
    );
  }
  return projCache.projection;
}

function render() {
  const profiles = personasFor();
  const away = picksUntilNextTurn();

  // Tier cliffs — the thing a ranked list cannot tell you. Positions gated by
  // league rules or already covered on my roster are suppressed (shared logic
  // with the terminal watcher).
  let tierView = null;
  if (tiered.length && !state.isComplete && state.picks.length < state.totalPicks) {
    const st = tierState(tiered, state.taken);
    const shares = observedPositionShares(state.picks, state.players);
    const signals = tierSignals(st, away, {
      ignorePositions: suppressedPositions(state),
      positionShares: shares,
    });
    tierView = { st, shares, away, signals };
  }

  // Recommendations on EVERY update, not only on the clock. Twenty-two picks
  // pass between turns at the wrap; seeing the board evolve the whole time is
  // the difference between deciding in two minutes and deciding over ten. When
  // it is not my turn the CURRENT board is the wrong thing to score, so the
  // opponents are simulated forward to my actual next pick — same reasoning as
  // watch-draft.mjs, rendered instead of printed.
  const recsView = {
    recs: [],
    projected: false,
    evalRoster: myRosterPlayers(state),
    allZero: false,
    beforeYou: '',
    lookahead: uiState.lookahead,
    away,
    cfg: state.cfg,
    backfields,
    mode: uiState.mode,
  };
  if (!state.isComplete) {
    let raw = [];
    if (state.isMyTurn) {
      raw = recommend(state, rankings, {
        level: uiState.level,
        thesis: uiState.thesis,
        n: 20,
        ownerProfiles: profiles,
        tendencies,
        lookahead: uiState.lookahead,
      });
    } else if (away > 0) {
      const projection = projectedToMyTurn(profiles);
      if (projection) {
        recsView.projected = true;
        recsView.evalRoster = myRosterPlayers(projection.state);
        // Two-pick reasoning only means something when the first pick is yours
        // to make; on a projected board it would stack simulation on simulation.
        raw = recommend(projection.state, rankings, {
          level: uiState.level,
          thesis: uiState.thesis,
          n: 20,
          ownerProfiles: profiles,
          tendencies,
          lookahead: false,
        });
      }
    }
    const capped = diversify(raw, { maxPerPos: 2, limit: 6 });
    const { shown, allZero } = filterWorthwhile(capped, 3);
    recsView.recs = shown;
    recsView.allZero = allZero;

    // Who picks in the gap before your next turn, and what they historically
    // want — the half of the draft you cannot control.
    if (profiles && !state.isMyTurn && away > 0) {
      const upcoming = anticipateUpcoming(state, profiles, Math.min(away, 12));
      const seen = new Map();
      for (const u of upcoming) {
        if (u.profile?.name && !seen.has(u.profile.name)) {
          seen.set(u.profile.name, u.profile.primary);
        }
      }
      recsView.beforeYou = [...seen]
        .map(([name, arch]) => (arch ? `${name} (${arch})` : name))
        .join(', ');
    }
  }

  $('mode-badge').textContent = uiState.mode;
  $('clock').innerHTML = ui.renderClock(state);
  $('controls').innerHTML = ui.renderControls(uiState, state, {
    personasOff: profiles === null && ownerProfiles !== null,
  });
  $('tiers').innerHTML = ui.renderTiers(tierView);
  $('recommendations').innerHTML = ui.renderRecommendations(recsView.recs, state, recsView);
  $('signals').innerHTML = ui.renderSignals(state, recsView.recs);
  $('roster').innerHTML = ui.renderRoster(state);
  $('available').innerHTML = ui.renderAvailable(state, rankings, uiState, uiState.mode);
  $('board').innerHTML = ui.renderBoard(state, 12, profiles);

  attachHandlers();
}

/**
 * Keep the screen awake while a live draft is on. iPad Safari supports the
 * Screen Wake Lock API (16.4+); the lock is released by the OS whenever the
 * tab is backgrounded, so it is re-acquired on visibilitychange. Failure is
 * fine — it just means the auto-lock setting applies.
 */
async function acquireWakeLock() {
  try {
    wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
  } catch {
    wakeLock = null;
  }
}

function releaseWakeLock() {
  try {
    wakeLock?.release();
  } catch {
    /* already released */
  }
  wakeLock = null;
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible' || uiState.mode !== 'live') return;
  if (!wakeLock) acquireWakeLock();
  // Draft-day usage is bouncing between the Sleeper app and this page, so the
  // page spends most of its life backgrounded — where Safari freezes timers.
  // Poll NOW rather than waiting out a stale timer, so the board is current
  // the moment he switches back.
  live?.poll();
});

/**
 * A live session survives a page reload. Bouncing to the Sleeper app and back
 * can evict this page from memory, and iPad Safari then reloads it from
 * scratch — without this, an app-switch mid-draft silently dropped the user
 * back into mock mode with an empty board.
 */
const LIVE_SESSION_KEY = 'draft-live-session';

function saveLiveSession() {
  try {
    localStorage.setItem(
      LIVE_SESSION_KEY,
      JSON.stringify({
        draftId: (uiState.draftIdInput || '').trim() || null,
        mySlot: state.mySlot,
      }),
    );
  } catch {
    /* private browsing — reconnect stays manual */
  }
}

function clearLiveSession() {
  try {
    localStorage.removeItem(LIVE_SESSION_KEY);
  } catch {
    /* nothing to clear */
  }
}

function savedLiveSession() {
  try {
    return JSON.parse(localStorage.getItem(LIVE_SESSION_KEY));
  } catch {
    return null;
  }
}

/**
 * Attach (or re-attach) to Sleeper. The explicit entry point — the "go live" /
 * "reconnect" button and the mode select both land here, and it is safe to
 * call while already live: the old poller is stopped and replaced.
 */
async function connectLive() {
  // A pasted draft id (the last path segment of the Sleeper room URL) attaches
  // straight to that draft — the only way to rehearse against a MOCK, which
  // has no league to resolve. Empty falls back to league → current draft.
  const draftId = (uiState.draftIdInput || '').trim() || null;
  if (!draftId && !state.cfg.sleeper_league_id) {
    $('status').textContent = 'no sleeper_league_id in league.json — cannot go live';
    return;
  }
  live?.stop();
  live = null;
  state.picks = [];
  state.taken = new Set();
  uiState.mode = 'live';
  try {
    live = new SleeperLive(
      draftId ? null : state.cfg.sleeper_league_id,
      state,
      () => {
        uiState.live = live.status();
        render();
      },
      { draftId },
    );
    await live.init();
    live.start();
    uiState.live = live.status();
    saveLiveSession();
    acquireWakeLock();
    render();
  } catch (err) {
    $('status').textContent = `live mode failed: ${err.message}`;
    // Don't retry a dead id on every reload — but keep it in the input so a
    // fix-and-reconnect is one tap.
    clearLiveSession();
    uiState.mode = 'mock';
    live?.stop();
    live = null;
    render();
  }
}

async function setMode(newMode) {
  if (newMode === uiState.mode) return;
  if (newMode === 'live') {
    await connectLive();
  } else {
    live?.stop();
    live = null;
    releaseWakeLock();
    clearLiveSession();
    state.picks = [];
    state.taken = new Set();
    uiState.mode = 'mock';
    uiState.live = null;
    render();
  }
}

function attachHandlers() {
  $('mode-select')?.addEventListener('change', (e) => setMode(e.target.value));
  $('connect-btn')?.addEventListener('click', () => connectLive());
  $('draft-id-input')?.addEventListener('input', (e) => {
    uiState.draftIdInput = e.target.value;
  });
  $('slot-select')?.addEventListener('change', (e) => {
    state.mySlot = Number(e.target.value);
    // The slot survives an app-switch reload along with the connection.
    if (uiState.mode === 'live') saveLiveSession();
    render();
  });
  $('level-select')?.addEventListener('change', (e) => {
    uiState.level = e.target.value;
    render();
  });
  $('thesis-select')?.addEventListener('change', (e) => {
    uiState.thesis = e.target.value;
    render();
  });
  $('lookahead-toggle')?.addEventListener('change', (e) => {
    uiState.lookahead = e.target.checked;
    render();
  });
  $('step-btn')?.addEventListener('click', () => {
    if (uiState.mode !== 'mock') return;
    if (!state.isMyTurn && !state.isComplete) {
      // Personas + consensus + tendencies, same as the projection — stepping a
      // mock through opponents drafting by search popularity was the exact bug
      // that put seven QBs in 22 picks of a one-QB league.
      simulateUntilMyTurn(state, personasFor(), Math.random, rankings, tendencies);
      render();
    }
  });
  $('undo-btn')?.addEventListener('click', () => {
    if (uiState.mode !== 'mock') return;
    const last = state.picks.pop();
    if (last) state.taken.delete(last.playerId);
    render();
  });
  $('reset-btn')?.addEventListener('click', () => {
    if (uiState.mode !== 'mock') return;
    state.picks = [];
    state.taken = new Set();
    render();
  });
  document.querySelectorAll('.rec-item.draftable, .avail-item.draftable').forEach((el) => {
    el.addEventListener('click', () => {
      if (uiState.mode !== 'mock') return; // live: picks come from Sleeper
      const id = el.getAttribute('data-player-id');
      if (!id || !state.isMyTurn) return;
      state.addPick(id);
      simulateUntilMyTurn(state, personasFor(), Math.random, rankings, tendencies);
      render();
    });
  });
  document.querySelectorAll('.filter-tab').forEach((el) => {
    el.addEventListener('click', () => {
      uiState.availablePosFilter = el.getAttribute('data-filter');
      render();
    });
  });
}

async function init() {
  try {
    const { cfg, players, profiles, ecr, byes, playersMeta, valueCurve, tiersRaw, tendenciesRaw } =
      await loadData();
    ownerProfiles = profiles;
    tendencies = tendenciesRaw;
    tiered = tiersRaw?.players ?? [];
    rankings = buildRankings(players, ecr, valueCurve, tiersRaw);
    // Committee detection from consensus proximity — see src/backfield.js.
    backfields = analyzeBackfields(players, ecr?.players);
    state = new DraftState(cfg, players, cfg.my_draft_slot ?? 1);
    render();
    const liveHint = cfg.sleeper_league_id
      ? ` · live: ${cfg.sleeper_league_name || cfg.sleeper_league_id}`
      : '';
    const profileHint = ownerProfiles
      ? ` · ${Object.keys(ownerProfiles.owners || {}).length} owner profiles from ${(ownerProfiles.seasons || []).join(',')}`
      : ' · no owner profiles';
    // Say plainly which rankings are in play. Mistaking synthetic for real is
    // the kind of thing you only notice after a bad third round.
    const m = rankings.meta;
    const rankHint = m.usingRealRankings
      ? `${m.rankedCount} ranked (${m.scoring?.toUpperCase() ?? '?'}, ${new Date(m.fetchedAt).toLocaleDateString()})`
      : 'SYNTHETIC rankings — run npm run build-rankings';
    const tiersHint = tiered.length ? '' : ' · no tiers — run npm run build-tiers';
    const byeHint = byes?.byes ? '' : ' · no bye data';
    // A stale snapshot corrupts byes silently — a traded player keeps his old
    // team, so the join returns a wrong week rather than nothing. Say it out loud.
    const age = snapshotAgeDays(playersMeta);
    const staleHint = age === null ? '' : age > 14 ? ` · ⚠ roster data ${age}d old` : '';
    $('status').textContent =
      `${Object.keys(players).length} players · ${rankHint}${tiersHint}${liveHint}${profileHint}${byeHint}${staleHint}`;

    // Re-attach a live session after a reload — see LIVE_SESSION_KEY.
    const saved = savedLiveSession();
    if (saved) {
      uiState.draftIdInput = saved.draftId || '';
      if (saved.mySlot) state.mySlot = saved.mySlot;
      await connectLive();
    }
  } catch (err) {
    $('status').textContent = `error: ${err.message}`;

    // trace is the only diagnostic available at the draft table.
    console.error(err);
  }
}

init();
