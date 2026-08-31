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
const META_OUT = join(__dirname, '..', 'public', 'data', 'players-meta.json');
const FANTASY_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'DEF']);

console.log('Fetching Sleeper player DB...');
const t0 = Date.now();
const res = await fetch('https://api.sleeper.app/v1/players/nfl');
if (!res.ok) throw new Error(`Sleeper /players/nfl → HTTP ${res.status}`);
const raw = await res.json();
const ms = Date.now() - t0;
console.log(
  `  ${(JSON.stringify(raw).length / 1024 / 1024).toFixed(1)} MB / ${Object.keys(raw).length} records in ${ms}ms`,
);

const players = {};
let kept = 0;
for (const [id, p] of Object.entries(raw)) {
  if (!p.active) continue;
  if (!FANTASY_POSITIONS.has(p.position)) continue;
  // Sleeper leaves `active: true` on retired players (Brady, Brees, Gurley, etc.)
  // but clears their team. No-team = not on an NFL roster = not draftable.
  // DEFs are fine because their team field is set to their abbreviation.
  if (!p.team) continue;
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
    search_rank: p.search_rank ?? 9999,
    // Depth chart, when Sleeper populates it. Kept because "RB2 on his own
    // roster" is a materially different asset from "RB2 by consensus rank", and
    // the trim was discarding the only direct signal of it. Coverage is patchy
    // and drifts in the preseason, so consumers must treat null as unknown
    // rather than as "not on the depth chart".
    depth_chart_order: p.depth_chart_order ?? null,
    depth_chart_position: p.depth_chart_position ?? null,
    // Availability. `status` is the roster designation (Active / Inactive /
    // PUP / IR / Suspended); `injury_status` is the weekly game-day tag.
    //
    // These are NOT interchangeable and the trim was keeping the weaker one.
    // injury_status is dominated by preseason "Questionable" — Ja'Marr Chase
    // carries it while holding the tightest expert spread in the whole pool —
    // so it cannot distinguish "might tweak an ankle" from "misses six games".
    // `status` can, and it is the field that actually carries suspensions.
    status: p.status ?? null,
    injury_body_part: p.injury_body_part ?? null,
    practice_participation: p.practice_participation ?? null,
  };
  kept++;
}

await writeFile(OUT, JSON.stringify(players));
const outSize = JSON.stringify(players).length;
console.log(`Wrote ${kept} players to ${OUT} (${(outSize / 1024).toFixed(0)} KB)`);

// Depth chart coverage, reported rather than assumed. If Sleeper stops
// populating it, or populates it only for some positions, the number here says
// so instead of the board quietly showing blanks.
const withDepth = Object.values(players).filter((p) => p.depth_chart_order != null).length;
const depthPct = kept ? Math.round((withDepth / kept) * 100) : 0;
console.log(`  depth chart: ${withDepth}/${kept} players (${depthPct}%)`);
if (depthPct < 50) {
  console.warn('  ⚠ sparse depth-chart data — the Depth column will be mostly empty');
}

// Availability breakdown, so a thin or unexpected distribution is visible
// rather than silently producing an empty column.
const statusCounts = {};
for (const p of Object.values(players)) {
  if (p.status) statusCounts[p.status] = (statusCounts[p.status] ?? 0) + 1;
}
const statusLine = Object.entries(statusCounts)
  .sort((a, b) => b[1] - a[1])
  .map(([k, v]) => `${k} ${v}`)
  .join(', ');
console.log(`  status: ${statusLine || '(none populated)'}`);
if (!Object.keys(statusCounts).length) {
  console.warn('  ⚠ no roster status data — Availability will fall back to injury_status');
}

// Provenance, in a sibling file rather than a key inside players.json — that
// file is a flat id→player map and every consumer does Object.values() over it,
// so a "_meta" key would show up as a malformed player.
//
// This matters more than it looks. byes.json joins on `team`, so a player who
// changed teams since the snapshot does not get a *missing* bye — he gets a
// confidently wrong one that passes every validity check. Staleness has to be
// measurable, because it is not otherwise detectable.
await writeFile(
  META_OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      count: kept,
      source: 'api.sleeper.app/v1/players/nfl',
    },
    null,
    2,
  ),
);
console.log(`Wrote ${META_OUT}`);
