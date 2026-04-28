// Build-time: fetch Sleeper's full player DB, trim to fantasy-relevant active players,
// strip ~40 fields per record we don't need, write to data/players.json.
// Result is ~10x smaller than raw and safe to ship to mobile clients.
//
// Run: node scripts/build-players.mjs
// Hooked into npm prebuild so it runs automatically before vite build.

import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'data', 'players.json');
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'DEF']);

console.log('Fetching Sleeper player DB...');
const t0 = Date.now();
const res = await fetch('https://api.sleeper.app/v1/players/nfl');
if (!res.ok) throw new Error(`Sleeper /players/nfl → HTTP ${res.status}`);
const raw = await res.json();
const ms = Date.now() - t0;
console.log(`  ${(JSON.stringify(raw).length / 1024 / 1024).toFixed(1)} MB / ${Object.keys(raw).length} records in ${ms}ms`);

const players = {};
let kept = 0;
for (const [id, p] of Object.entries(raw)) {
  if (!p.active) continue;
  if (!FANTASY_POSITIONS.has(p.position)) continue;
  players[id] = {
    id,
    name: p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim(),
    position: p.position,
    team: p.team || null,
    age: p.age ?? null,
    exp: p.years_exp ?? null,
    fantasy_positions: p.fantasy_positions || [p.position],
    bye_week: p.bye_week ?? null,
    injury_status: p.injury_status || null,
    search_rank: p.search_rank ?? 9999
  };
  kept++;
}

await writeFile(OUT, JSON.stringify(players));
const outSize = JSON.stringify(players).length;
console.log(`Wrote ${kept} players to ${OUT} (${(outSize / 1024).toFixed(0)} KB)`);
