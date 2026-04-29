import { DraftState } from './state.js';
import { buildRankings } from './rankings.js';
import { recommend } from './engine/recommend.js';
import { simulateUntilMyTurn } from './mock/draft-sim.js';
import { SleeperLive } from './sleeper-live.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

const uiState = { thesis: 'none', level: 'l2', mode: 'mock', live: null };
let state;
let rankings;
let ownerProfiles = null;
let live = null;

async function loadData() {
  const [cfg, players, ownerProfiles] = await Promise.all([
    fetch('/data/league.json').then((r) => r.json()),
    fetch('/data/players.json').then((r) => r.json()),
    fetch('/data/owner-profiles.json')
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
  ]);
  return { cfg, players, ownerProfiles };
}

function render() {
  const recs = state.isMyTurn
    ? recommend(state, rankings, {
        level: uiState.level,
        thesis: uiState.thesis,
        n: 5,
        ownerProfiles
      })
    : [];

  $('mode-badge').textContent = uiState.mode;
  $('clock').innerHTML = ui.renderClock(state);
  $('controls').innerHTML = ui.renderControls(uiState, state);
  $('recommendations').innerHTML = ui.renderRecommendations(recs, state, uiState.mode);
  $('signals').innerHTML = ui.renderSignals(state, recs);
  $('roster').innerHTML = ui.renderRoster(state);
  $('board').innerHTML = ui.renderBoard(state, 12, ownerProfiles);

  attachHandlers();
}

async function setMode(newMode) {
  if (newMode === uiState.mode) return;
  if (newMode === 'live') {
    if (!state.cfg.sleeper_league_id) {
      $('status').textContent = 'no sleeper_league_id in league.json — cannot go live';
      return;
    }
    state.picks = [];
    state.taken = new Set();
    uiState.mode = 'live';
    try {
      live = new SleeperLive(state.cfg.sleeper_league_id, state, () => {
        uiState.live = live.status();
        render();
      });
      await live.init();
      live.start();
      uiState.live = live.status();
      render();
    } catch (err) {
      $('status').textContent = `live mode failed: ${err.message}`;
      uiState.mode = 'mock';
      live?.stop();
      live = null;
      render();
    }
  } else {
    live?.stop();
    live = null;
    state.picks = [];
    state.taken = new Set();
    uiState.mode = 'mock';
    uiState.live = null;
    render();
  }
}

function attachHandlers() {
  $('mode-select')?.addEventListener('change', (e) => setMode(e.target.value));
  $('slot-select')?.addEventListener('change', (e) => {
    state.mySlot = Number(e.target.value);
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
  $('step-btn')?.addEventListener('click', () => {
    if (uiState.mode !== 'mock') return;
    if (!state.isMyTurn && !state.isComplete) {
      simulateUntilMyTurn(state, ownerProfiles);
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
  document.querySelectorAll('.rec-item').forEach((el) => {
    el.addEventListener('click', () => {
      if (uiState.mode !== 'mock') return; // live: picks come from Sleeper
      const id = el.getAttribute('data-player-id');
      if (!id || !state.isMyTurn) return;
      state.addPick(id);
      simulateUntilMyTurn(state, ownerProfiles);
      render();
    });
  });
}

async function init() {
  try {
    const { cfg, players, ownerProfiles: profiles } = await loadData();
    ownerProfiles = profiles;
    rankings = buildRankings(players);
    state = new DraftState(cfg, players, 6);
    render();
    const liveHint = cfg.sleeper_league_id ? ` · live: ${cfg.sleeper_league_name || cfg.sleeper_league_id}` : '';
    const profileHint = ownerProfiles
      ? ` · ${Object.keys(ownerProfiles.owners || {}).length} owner profiles from ${(ownerProfiles.seasons || []).join(',')}`
      : ' · no owner profiles';
    $('status').textContent =
      `${Object.keys(players).length} players · synthetic rankings${liveHint}${profileHint}`;
  } catch (err) {
    $('status').textContent = `error: ${err.message}`;
    console.error(err);
  }
}

init();
