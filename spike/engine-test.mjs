// Quick functional smoke test — runs through several picks of a mock draft
// and verifies the engine produces sane recommendations at each step.
// Run: node spike/engine-test.mjs

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DraftState } from '../src/state.js';
import { buildRankings } from '../src/rankings.js';
import { recommend } from '../src/engine/recommend.js';
import { simulateUntilMyTurn, seededRng } from '../src/mock/draft-sim.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(await readFile(join(__dirname, '..', 'public', 'data', 'league.json'), 'utf8'));
const players = JSON.parse(await readFile(join(__dirname, '..', 'public', 'data', 'players.json'), 'utf8'));
let ownerProfiles = null;
try {
  ownerProfiles = JSON.parse(
    await readFile(join(__dirname, '..', 'public', 'data', 'owner-profiles.json'), 'utf8')
  );
} catch {}

const rankings = buildRankings(players);
const state = new DraftState(cfg, players, 6);
const rng = seededRng(42);

console.log(`League: ${cfg.teams} teams, ${cfg.scoring.toUpperCase()}, my slot ${state.mySlot}`);
console.log(`Players loaded: ${Object.keys(players).length}\n`);

// Cycle through several rounds; at each "my turn" pick the L2 top recommendation.
for (let round = 1; round <= 6; round++) {
  simulateUntilMyTurn(state, ownerProfiles, rng);
  if (state.isComplete) break;

  const recs = recommend(state, rankings, { level: 'l2', thesis: 'none', n: 3, ownerProfiles });
  console.log(`--- Round ${round}, pick ${state.currentPick} (slot ${state.currentSlot}) ---`);
  recs.forEach((r, i) => {
    const sigs = r.signals?.length ? `  [${r.signals.join(', ')}]` : '';
    console.log(`  ${i + 1}. ${r.player.name.padEnd(22)} ${r.player.position}${String(r.posRank).padEnd(3)} t${r.tier} ${r.rationale}${sigs}`);
  });

  state.addPick(recs[0].player.id);
  console.log(`  → drafted ${recs[0].player.name}\n`);
}

console.log('My roster:');
const r = state.myRoster();
for (const [pos, list] of Object.entries(r)) {
  console.log(`  ${pos}: ${list.map((p) => p.name).join(', ') || '—'}`);
}
const needs = state.myNeeds();
console.log(`\nNeeds: starter shortfall ${JSON.stringify(needs.starterShortfall)}, flex ${needs.flexShortfall}, bench ${needs.benchRoom}`);
