// Build-time: produce public/data/byes.json — a team → bye-week map.
//
// Why this is a separate file rather than a field on players.json: Sleeper
// leaves `bye_week` null on every record in /players/nfl, and players.json is
// regenerated wholesale by build-players.mjs. Keeping byes in their own file
// means the app can join them on `team` at load time and neither build step
// clobbers the other.
//
// Two sources, in order:
//   1. Sleeper's season schedule — derive byes as "weeks 4-14 where a team has
//      no game". Preferred: no manual work, refreshes with the schedule.
//   2. scripts/byes-manual.json — a hand-entered { "ATL": 5, ... } map.
//      32 numbers, five minutes, and it always works.
//
// HONEST CAVEAT: the schedule endpoint's response shape was not verifiable
// when this was written (the sandbox could not reach it). Rather than parse
// optimistically and emit a plausible-but-wrong bye map — which would be worse
// than having none, because you would trust it — parseSchedule() validates the
// structure it gets and refuses anything it does not recognise, printing what
// it actually saw. If it trips, fall back to the manual file and send me the
// output.
//
// Run: node scripts/build-byes.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = join(__dirname, '..', 'public', 'data', 'league.json');
const MANUAL_PATH = join(__dirname, 'byes-manual.json');
const OUT = join(__dirname, '..', 'public', 'data', 'byes.json');

const MIN_BYE_WEEK = 4;
const MAX_BYE_WEEK = 14;
const NFL_TEAMS = 32;

/**
 * Pull every (week, team) pair out of a schedule payload.
 *
 * Accepts the two shapes Sleeper is known to use across its schedule
 * endpoints — a flat array of games, or an object keyed by week — and rejects
 * anything else loudly. Each game must name two teams; a shape that parses to
 * zero teams is treated as a failure, not as "every team is on bye".
 */
function parseSchedule(payload) {
  const seen = new Map(); // team → Set(weeks played)
  const note = (team, week) => {
    if (typeof team !== 'string' || !team) return;
    if (!Number.isInteger(week)) return;
    if (!seen.has(team)) seen.set(team, new Set());
    seen.get(team).add(week);
  };

  const readGame = (g, fallbackWeek) => {
    if (!g || typeof g !== 'object') return;
    // Sleeper leaves canceled fixtures in the feed (the 2026 schedule ships a
    // canceled DAL-SEA in week 6 alongside the real one). Counting a canceled
    // game as "played" would hide a genuine bye.
    if (g.status === 'canceled' || g.status === 'cancelled') return;
    const week = Number.isInteger(g.week) ? g.week : fallbackWeek;
    // Sleeper uses home/away; some payloads use team_a/team_b.
    note(g.home ?? g.team_a ?? g.home_team, week);
    note(g.away ?? g.team_b ?? g.away_team, week);
  };

  if (Array.isArray(payload)) {
    for (const g of payload) readGame(g, null);
  } else if (payload && typeof payload === 'object') {
    for (const [key, games] of Object.entries(payload)) {
      const week = Number.parseInt(key, 10);
      if (!Array.isArray(games)) continue;
      for (const g of games) readGame(g, Number.isNaN(week) ? null : week);
    }
  }

  if (seen.size === 0) {
    const shape = Array.isArray(payload)
      ? `array of ${payload.length}, first item keys: ${Object.keys(payload[0] ?? {}).join(', ') || '(none)'}`
      : `object with keys: ${Object.keys(payload ?? {})
          .slice(0, 12)
          .join(', ')}`;
    throw new Error(
      `could not recognise the schedule format — parsed 0 teams.\n` +
        `  Observed: ${shape}\n` +
        `  Refusing to guess. Use scripts/byes-manual.json instead.`,
    );
  }

  if (seen.size < NFL_TEAMS) {
    throw new Error(
      `schedule only produced ${seen.size} teams, expected ${NFL_TEAMS}. Refusing a partial bye map.`,
    );
  }

  const byes = {};
  for (const [team, weeks] of seen) {
    for (let w = MIN_BYE_WEEK; w <= MAX_BYE_WEEK; w++) {
      if (!weeks.has(w)) {
        byes[team] = w;
        break;
      }
    }
  }
  return byes;
}

/** Every team should have exactly one bye in the legal range. */
function validateByes(byes) {
  const teams = Object.keys(byes);
  const problems = [];
  if (teams.length !== NFL_TEAMS) {
    problems.push(`${teams.length} teams mapped, expected ${NFL_TEAMS}`);
  }
  for (const [team, week] of Object.entries(byes)) {
    if (!Number.isInteger(week) || week < MIN_BYE_WEEK || week > MAX_BYE_WEEK) {
      problems.push(`${team}: bye week ${week} outside weeks ${MIN_BYE_WEEK}-${MAX_BYE_WEEK}`);
    }
  }
  return problems;
}

// --- Main --------------------------------------------------------------------

const cfg = JSON.parse(await readFile(CFG_PATH, 'utf8'));
const season = cfg.season ?? new Date().getFullYear().toString();

let byes = null;
let source = null;

// Offline path, same idea as build-rankings.mjs: point it at a saved copy of
// the schedule JSON. Useful for verifying the parse without hitting the API.
//   node scripts/build-byes.mjs schedule.json
const localSchedule = process.argv[2];

try {
  if (localSchedule) {
    console.log(`Deriving byes from a local schedule file...\n  ${localSchedule}`);
    byes = parseSchedule(JSON.parse(await readFile(localSchedule, 'utf8')));
    source = `derived from local schedule file (${season})`;
  } else {
    const url = `https://api.sleeper.app/schedule/nfl/regular/${season}`;
    console.log(`Deriving byes from the ${season} schedule...\n  ${url}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    byes = parseSchedule(await res.json());
    source = `derived from Sleeper ${season} schedule`;
  }
  console.log(`  parsed ${Object.keys(byes).length} teams`);
} catch (err) {
  console.warn(`  schedule unavailable: ${err.message}`);
  try {
    byes = JSON.parse(await readFile(MANUAL_PATH, 'utf8'));
    // Allow a "_comment" key in the hand-maintained file.
    byes = Object.fromEntries(Object.entries(byes).filter(([k]) => !k.startsWith('_')));
    source = 'scripts/byes-manual.json (hand-entered)';
    console.log(`\nFell back to ${MANUAL_PATH}`);
  } catch {
    // Absent bye data is not a build failure. This runs in `prebuild`, and
    // taking the whole deploy down over an optional feature — on the week of
    // the draft — would be a genuinely bad trade. The app renders fine without
    // byes and says so in its status line.
    console.warn(
      '\nNo bye data available — skipping byes.json.\n' +
        '  To enable bye analysis, create scripts/byes-manual.json with a\n' +
        '  { "ATL": 5, "BUF": 7, ... } map (32 entries, Sleeper team abbreviations).\n' +
        '  The app runs fine without it; bye analysis simply stays off.',
    );
    process.exit(0);
  }
}

const problems = validateByes(byes);
if (problems.length) {
  console.error('\nBye map failed validation:');
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const byWeek = {};
for (const [team, week] of Object.entries(byes)) {
  (byWeek[week] ??= []).push(team);
}

await writeFile(
  OUT,
  JSON.stringify({ season, source, generatedAt: new Date().toISOString(), byes }, null, 2),
);

console.log(`\nWrote ${OUT}`);
console.log(`  source: ${source}`);
for (const week of Object.keys(byWeek).sort((a, b) => a - b)) {
  console.log(`  week ${String(week).padStart(2)}: ${byWeek[week].sort().join(' ')}`);
}
