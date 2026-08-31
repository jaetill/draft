// Build-time: fetch Boris Chen's consensus PPR draft tiers, match them against
// public/data/players.json, write public/data/rankings.json.
//
// Why Boris Chen and not FantasyPros:
//   FantasyPros' rankings tables are client-rendered and gated behind a paid
//   plan/API key. That is a bad dependency for something that has to work on
//   draft morning. Boris Chen publishes the same expert-consensus data as a
//   static CSV on S3 — no auth, no JS, no rate limit — and adds tier breaks,
//   which is exactly what the L1 engine wants.
//
// What we get per player: consensus rank (Avg.Rank), a tier, and the expert
// spread (Best/Worst/Std.Dev). The spread is the interesting part — it is a
// direct measure of how much the experts disagree, i.e. risk.
//
// Run: node scripts/build-rankings.mjs
// Hooked into npm prebuild so it runs before every vite build.

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PLAYERS_PATH = join(__dirname, '..', 'public', 'data', 'players.json');
const OUT = join(__dirname, '..', 'public', 'data', 'rankings.json');

// Full-PPR overall draft board. During the preseason Boris Chen publishes draft
// rankings under the "weekly-" prefix; the in-season weekly files are the same
// URL shape, so validateDraftShape() below checks we got the right one.
const SOURCE_URL = 'https://s3-us-west-1.amazonaws.com/fftiers/out/weekly-ALL-PPR.csv';

// This league has no kicker slot. Drop them so they can't occupy a board row.
const DROP_POSITIONS = new Set(['K']);

// Boris Chen labels team defenses "DST"; Sleeper calls the position "DEF".
const POSITION_ALIASES = { DST: 'DEF' };

// --- CSV ---------------------------------------------------------------------

/** Minimal RFC-4180 parser. Handles quoted fields and embedded commas. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      if (row.some((f) => f !== '')) rows.push(row);
      row = [];
      field = '';
    } else if (c !== '\r') {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f !== '')) rows.push(row);

  const header = rows.shift().map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/**
 * Reject the in-season weekly file. It lives at a nearly identical URL, carries
 * a "Matchup" column ("vs. CHI"), covers ~40 players instead of 200, and is
 * ranked for a single week. Silently drafting off it would be a disaster, so
 * fail loudly instead.
 */
function validateDraftShape(rows) {
  if (!rows.length) throw new Error('rankings source returned zero rows');

  const cols = Object.keys(rows[0]);
  if (cols.includes('Matchup')) {
    throw new Error(
      'source looks like an in-season WEEKLY file (has a "Matchup" column), not a draft board. ' +
        'Refusing to build draft rankings from single-week data.',
    );
  }
  for (const required of ['Rank', 'Player.Name', 'Tier', 'Position', 'Avg.Rank']) {
    if (!cols.includes(required)) {
      throw new Error(
        `rankings source is missing the "${required}" column (got: ${cols.join(', ')})`,
      );
    }
  }
  if (rows.length < 150) {
    throw new Error(`rankings source has only ${rows.length} rows; expected a full board (150+)`);
  }
}

// --- Name matching -----------------------------------------------------------

const SUFFIXES = /\b(jr|sr|ii|iii|iv|v)\b/g;

/** "Ja'Marr Chase" / "James Cook III" / "Kyle Pitts Sr." → "jamarrchase" / "jamescook" / "kylepitts" */
function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/\./g, '')
    .replace(SUFFIXES, '')
    .replace(/[^a-z]/g, '');
}

/**
 * Index players by position + normalized name. Keyed by position because a
 * suffix-stripped name can collide across positions, and because matching
 * within position turns a wrong guess into a miss rather than a silent swap.
 */
function indexPlayers(players) {
  const index = new Map();
  const collisions = [];
  for (const p of Object.values(players)) {
    const key = `${p.position}|${normalizeName(p.name)}`;
    if (index.has(key)) {
      collisions.push({ key, kept: index.get(key).name, dropped: p.name });
      // Keep whichever Sleeper considers more prominent.
      if ((p.search_rank ?? 9999) < (index.get(key).search_rank ?? 9999)) index.set(key, p);
      continue;
    }
    index.set(key, p);
  }
  return { index, collisions };
}

// --- Main --------------------------------------------------------------------

// Draft-morning escape hatch: if the S3 endpoint is down or the venue wifi is
// hostile, download the CSV on any device and point the script at the file.
//   node scripts/build-rankings.mjs ~/Downloads/weekly-ALL-PPR.csv
const localCsv = process.argv[2];

let csv;
if (localCsv) {
  console.log(`Reading PPR draft tiers from local file...\n  ${localCsv}`);
  csv = await readFile(localCsv, 'utf8');
  console.log(`  ${(csv.length / 1024).toFixed(0)} KB`);
} else {
  console.log(`Fetching PPR draft tiers...\n  ${SOURCE_URL}`);
  const t0 = Date.now();
  const res = await fetch(SOURCE_URL);
  if (!res.ok) throw new Error(`rankings source → HTTP ${res.status}`);
  csv = await res.text();
  console.log(`  ${(csv.length / 1024).toFixed(0)} KB in ${Date.now() - t0}ms`);
}

const rows = parseCsv(csv);
validateDraftShape(rows);
console.log(`  parsed ${rows.length} ranked players`);

const players = JSON.parse(await readFile(PLAYERS_PATH, 'utf8'));
const { index, collisions } = indexPlayers(players);
if (collisions.length) {
  console.warn(
    `  note: ${collisions.length} duplicate name(s) in players.json, kept the higher-profile one`,
  );
  for (const c of collisions.slice(0, 5)) console.warn(`    ${c.kept} / ${c.dropped}`);
}

const ranked = {};
const unmatched = [];
let dropped = 0;

for (const row of rows) {
  const rawPos = row['Position'].trim();
  if (DROP_POSITIONS.has(rawPos)) {
    dropped++;
    continue;
  }
  const position = POSITION_ALIASES[rawPos] ?? rawPos;
  const name = row['Player.Name'].trim();
  const hit = index.get(`${position}|${normalizeName(name)}`);

  if (!hit) {
    unmatched.push({ name, position, rank: Number(row['Rank']) });
    continue;
  }

  ranked[hit.id] = {
    name: hit.name,
    position,
    ecr: Number(row['Avg.Rank']),
    overall: Number(row['Rank']),
    tier: Number(row['Tier']),
    best: Number(row['Best.Rank']),
    worst: Number(row['Worst.Rank']),
    stdev: Number(row['Std.Dev']),
  };
}

// Within-position rank, derived from the consensus ordering rather than from
// Sleeper's search_rank (which measures search popularity, not projected value).
const byPosition = {};
for (const [id, r] of Object.entries(ranked)) {
  (byPosition[r.position] ??= []).push([id, r]);
}
for (const list of Object.values(byPosition)) {
  list.sort((a, b) => a[1].ecr - b[1].ecr);
  list.forEach(([, r], i) => {
    r.posRank = i + 1;
  });
}

const matched = Object.keys(ranked).length;
const total = rows.length - dropped;

// Deepest real tier. The app parks unranked players just past it rather than
// guessing a tier for someone the experts never ranked.
const maxTier = Object.values(ranked).reduce((m, r) => Math.max(m, r.tier), 0);

const out = {
  source: 'Boris Chen consensus tiers (fftiers)',
  sourceUrl: SOURCE_URL,
  scoring: 'ppr',
  fetchedAt: new Date().toISOString(),
  maxTier,
  counts: {
    ranked: matched,
    unmatched: unmatched.length,
    droppedKickers: dropped,
    byPosition: Object.fromEntries(Object.entries(byPosition).map(([p, l]) => [p, l.length])),
  },
  unmatched,
  players: ranked,
};

await writeFile(OUT, JSON.stringify(out, null, 2));

const pct = ((matched / total) * 100).toFixed(1);
console.log(`\nMatched ${matched}/${total} ranked players (${pct}%) against players.json`);
console.log(
  `  by position: ${Object.entries(out.counts.byPosition)
    .map(([p, n]) => `${p} ${n}`)
    .join(', ')}`,
);
if (dropped) console.log(`  dropped ${dropped} kickers (league has no K slot)`);

if (unmatched.length) {
  console.warn(`\n${unmatched.length} ranked player(s) had no players.json entry:`);
  for (const u of unmatched.slice(0, 15)) console.warn(`  #${u.rank} ${u.name} (${u.position})`);
  if (unmatched.length > 15) console.warn(`  ...and ${unmatched.length - 15} more`);
  console.warn('\nUsually means players.json is stale — re-run: npm run build-players');
}

// A low match rate means the board is full of holes; better to fail the build
// than to hand someone a draft assistant that quietly lost its top rookies.
if (matched / total < 0.85) {
  throw new Error(
    `only ${pct}% of ranked players matched — refusing to ship a board this incomplete`,
  );
}

console.log(`\nWrote ${OUT}`);
