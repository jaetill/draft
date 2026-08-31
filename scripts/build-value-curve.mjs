// Build public/data/value-curve.json — empirical points-by-positional-finish,
// averaged over recent seasons.
//
// WHY THIS EXISTS, and why it is not "tiers from historical stats":
//
// The tempting version of this idea is to rank players by their past fantasy
// points. That does not work, for three reasons that compound:
//
//   1. Rookies have no history, and the 2026 draftable pool is full of them.
//      Any model has to impute their value, and the only sane source for that
//      imputation is consensus ranking — which makes the whole thing circular.
//   2. Year-over-year fantasy production correlates weakly, worst at RB.
//      Injury, workload change and touchdown regression dominate.
//   3. Situation changes break it outright. A player's production on his old
//      team does not transfer at the same rate to a new offence.
//
// And underneath all three: ECR and ADP were *made by people who read those
// stats*. Historical points are not new information, they are a lagging and
// noisier subset of what the market has already priced. Ranking on them
// re-derives a worse ADP.
//
// What history IS uniquely good for is the question this script answers:
// what is a given positional FINISH worth? "What does the RB12 score in a
// season" never asks which player will be RB12. Rookies do not break it,
// trades do not break it. It is a question about the shape of a position, and
// the shape is stable in a way that individual players are not.
//
// That matters because VBD — the number the whole engine sorts on — is
// projection minus replacement level, and both halves currently come from a
// modelled exponential curve. This replaces the curve with measured reality.
//
// Run: node scripts/build-value-curve.mjs [season...]
//   defaults to the three most recent completed seasons

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const OUT = join(DATA, 'value-curve.json');

const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'DEF'];

// How deep the curve needs to go. Past this, everyone is replacement level and
// the exact number stops mattering.
const CURVE_DEPTH = 60;

// More recent seasons weigh more — the league changes. Index 0 = most recent.
const RECENCY_WEIGHTS = [3, 2, 1];

const seasons = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (() => {
      // Default: the three most recent COMPLETED seasons. During the 2026
      // preseason that means 2025, 2024, 2023 — 2026 has no games yet, and
      // including a zero-point season would flatten every curve.
      const cfgYear = new Date().getFullYear();
      return [cfgYear - 1, cfgYear - 2, cfgYear - 3].map(String);
    })();

async function fetchSeason(season) {
  const url = `https://api.sleeper.app/v1/stats/nfl/regular/${season}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`stats ${season} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Points for one player-season. Sleeper ships several scoring variants; this
 * league is full PPR, so pts_ppr is the right one and the others would quietly
 * understate receiving backs and slot receivers.
 */
function pprPoints(stat) {
  return Number.isFinite(stat?.pts_ppr) ? stat.pts_ppr : null;
}

/**
 * Position lookup across EVERY player Sleeper knows about, not just the ~1,000
 * currently rostered ones in players.json.
 *
 * This distinction is the difference between a usable curve and a badly biased
 * one. Resolving positions from players.json means a 2023 player-season only
 * counts if that player is still employed in 2026 — which silently drops the
 * guys who washed out, and those are overwhelmingly the low scorers. Coverage
 * ran 59% / 34% / 29% across the three seasons, and the survivors are better
 * than the population, so every curve's tail sat too high and every replacement
 * level came out inflated. Inflated replacement compresses VBD, and it does it
 * unevenly by position — which quietly reorders the board.
 *
 * The full DB is ~14 MB and only needed at build time, so it is fetched here
 * rather than shipped to the browser in public/data.
 */
async function fetchPositionMap() {
  const res = await fetch('https://api.sleeper.app/v1/players/nfl');
  if (!res.ok) throw new Error(`players/nfl → HTTP ${res.status}`);
  const raw = await res.json();
  const map = new Map();
  for (const [id, p] of Object.entries(raw)) {
    if (p?.position) map.set(id, p.position);
  }
  return map;
}

console.log('Fetching full player DB for position resolution...');
const positionMap = await fetchPositionMap();
console.log(`  ${positionMap.size} players indexed`);

const posOf = (id) => positionMap.get(id) ?? null;

const perSeason = [];
for (const season of seasons) {
  let raw;
  try {
    raw = await fetchSeason(season);
  } catch (err) {
    console.warn(`  ${season}: ${err.message} — skipping`);
    continue;
  }

  const byPos = {};
  for (const pos of POSITIONS) byPos[pos] = [];

  // Three distinct outcomes, and conflating them produces a meaningless
  // coverage number. Only the first is a data problem:
  //   unknownId    — the stats feed references a player the DB has never heard
  //                  of. Real loss, and it lands disproportionately on players
  //                  who left the league, biasing the tail high.
  //   nonFantasy   — kickers, linebackers, corners, linemen. Sleeper's stats
  //                  endpoint returns every player who recorded anything. These
  //                  are correctly excluded and are not missing data.
  //   resolved     — counted into the curve.
  let resolved = 0;
  let unknownId = 0;
  let nonFantasy = 0;
  const droppedPositions = {};

  for (const [id, stat] of Object.entries(raw)) {
    const pts = pprPoints(stat);
    if (pts === null) continue;
    const pos = posOf(id);
    if (!pos) {
      unknownId++;
      continue;
    }
    if (!byPos[pos]) {
      nonFantasy++;
      droppedPositions[pos] = (droppedPositions[pos] ?? 0) + 1;
      continue;
    }
    byPos[pos].push(pts);
    resolved++;
  }

  for (const pos of POSITIONS) byPos[pos].sort((a, b) => b - a);
  perSeason.push({ season, byPos, resolved, unknownId, nonFantasy });

  // Coverage measured only against players we SHOULD have counted. Including
  // correctly-excluded kickers and defenders in the denominator makes a healthy
  // run look broken.
  const eligible = resolved + unknownId;
  const coverage = eligible ? ((resolved / eligible) * 100).toFixed(0) : '0';
  const dropped = Object.entries(droppedPositions)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([p, n]) => `${p} ${n}`)
    .join(', ');

  console.log(`  ${season}: ${resolved} resolved (${coverage}% of eligible)`);
  console.log(`    excluded by position: ${nonFantasy}${dropped ? ` — ${dropped}` : ''}`);
  if (unknownId) console.log(`    unknown player ids: ${unknownId}`);

  // Only a genuine id miss biases the curve. Those skew toward players who left
  // the league — i.e. the low scorers — so losing them lifts the tail.
  if (eligible && resolved / eligible < 0.9) {
    console.warn(
      `    ⚠ ${100 - Number(coverage)}% of eligible ${season} player-seasons are unresolved — tail biased high`,
    );
  }
}

if (!perSeason.length) {
  console.error('\nNo seasons fetched. Nothing written.');
  process.exit(1);
}
if (perSeason.length < 2) {
  console.error(
    `\nOnly ${perSeason.length} season fetched. A curve from a single season encodes that\n` +
      "  season's injuries and scoring environment as if they were structural.\n" +
      '  Refusing to write value-curve.json.',
  );
  process.exit(1);
}

// --- Weighted average across seasons at each positional finish ---------------

const curve = {};
for (const pos of POSITIONS) {
  const points = [];
  for (let rank = 0; rank < CURVE_DEPTH; rank++) {
    let num = 0;
    let den = 0;
    perSeason.forEach((s, i) => {
      const v = s.byPos[pos][rank];
      if (!Number.isFinite(v)) return;
      const w = RECENCY_WEIGHTS[i] ?? 1;
      num += v * w;
      den += w;
    });
    if (den === 0) break;
    points.push(Math.round((num / den) * 10) / 10);
  }
  curve[pos] = points;
}

// --- Replacement levels, measured rather than assumed -------------------------
//
// league.json hard-codes RB30 / WR36 / TE15 / QB12. Those are reasonable rules
// of thumb; now they can be checked against what the curve actually says.

const cfg = JSON.parse(await readFile(join(DATA, 'league.json'), 'utf8'));
const replacement = {};
for (const [pos, cutoff] of Object.entries(cfg.replacement_levels ?? {})) {
  if (pos.startsWith('_')) continue;
  const list = curve[pos];
  if (!list?.length) continue;
  replacement[pos] = list[Math.min(cutoff - 1, list.length - 1)];
}

await writeFile(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      scoring: 'ppr',
      seasons: perSeason.map((s) => s.season),
      recencyWeights: RECENCY_WEIGHTS.slice(0, perSeason.length),
      note: "Points by positional FINISH, not by player. Index 0 = the season's PosRank 1.",
      replacementPoints: replacement,
      curve,
    },
    null,
    2,
  ),
);

console.log(`\nWrote ${OUT}`);
console.log(`  seasons: ${perSeason.map((s) => s.season).join(', ')}\n`);
for (const pos of POSITIONS) {
  const c = curve[pos];
  if (!c?.length) continue;
  const at = (n) => (c[n - 1] !== undefined ? c[n - 1].toFixed(0).padStart(4) : '   -');
  console.log(
    `  ${pos.padEnd(4)} #1${at(1)}   #6${at(6)}   #12${at(12)}   #24${at(24)}   #36${at(36)}`,
  );
}
console.log('\nMeasured replacement level vs. the cutoffs in league.json:');
for (const [pos, pts] of Object.entries(replacement)) {
  console.log(`  ${pos.padEnd(4)} ${String(cfg.replacement_levels[pos]).padStart(3)} → ${pts} pts`);
}
