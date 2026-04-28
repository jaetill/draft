import { DraftState } from './state.js';
import { buildRankings } from './rankings.js';
import { recommend } from './engine/recommend.js';
import { simulateUntilMyTurn, pickForOpponent } from './mock/draft-sim.js';
import * as ui from './ui.js';

const $ = (id) => document.getElementById(id);

const uiState = { thesis: 'none', level: 'l2' };
let state;
let rankings;

async function loadData() {
  const [cfg, players] = await Promise.all([
    fetch('/data/league.json').then((r) => r.json()),
    fetch('/data/players.json').then((r) => r.json())
  ]);
  return { cfg, players };
}

function render() {
  const recs = state.isMyTurn
    ? recommend(state, rankings, { level: uiState.level, thesis: uiState.thesis, n: 5 })
    : [];

  $('clock').innerHTML = ui.renderClock(state);
  $('controls').innerHTML = ui.renderControls(uiState, state);
  $('recommendations').innerHTML = ui.renderRecommendations(recs, state);
  $('signals').innerHTML = ui.renderSignals(state, recs);
  $('roster').innerHTML = ui.renderRoster(state);
  $('board').innerHTML = ui.renderBoard(state);

  attachHandlers();
}

function attachHandlers() {
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
    if (!state.isMyTurn && !state.isComplete) {
      simulateUntilMyTurn(state);
      render();
    }
  });
  $('undo-btn')?.addEventListener('click', () => {
    const last = state.picks.pop();
    if (last) state.taken.delete(last.playerId);
    render();
  });
  $('reset-btn')?.addEventListener('click', () => {
    state.picks = [];
    state.taken = new Set();
    render();
  });
  document.querySelectorAll('.rec-item').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.getAttribute('data-player-id');
      if (!id || !state.isMyTurn) return;
      state.addPick(id);
      // After my pick, auto-advance until my next turn or end of draft.
      simulateUntilMyTurn(state);
      render();
    });
  });
}

async function init() {
  try {
    const { cfg, players } = await loadData();
    rankings = buildRankings(players);
    state = new DraftState(cfg, players, 6); // default slot 6 (middle of snake)
    render();
    $('status').textContent =
      `${Object.keys(players).length} players loaded · synthetic rankings (no CSV yet)`;
  } catch (err) {
    $('status').textContent = `error: ${err.message}`;
    console.error(err);
  }
}

init();
