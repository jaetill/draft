import { fetchNflState } from './sleeper.js';

const status = document.getElementById('status');

async function init() {
  try {
    const state = await fetchNflState();
    status.textContent = `Sleeper online — NFL ${state.season} ${state.season_type}`;
  } catch (err) {
    status.textContent = `Sleeper offline: ${err.message}`;
  }
}

init();
