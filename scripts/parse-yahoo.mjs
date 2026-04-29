// Parse Yahoo draft results text files into structured picks, resolve player
// positions via Sleeper's full player DB, write a unified intermediate JSON.
//
// Output: scripts/yahoo-history/parsed.json
//   {
//     years: { '2018': { teamCount, picks: [{round, pickNo, slot, player, position, team}] }, ... },
//     uniqueTeams: { '<team_name>': ['2018', '2019', ...] },
//     unresolvedPlayers: ['Player Name', ...]   // names we couldn't find a position for
//   }
//
// Run: node scripts/parse-yahoo.mjs

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_DIR = join(__dirname, 'yahoo-history');
const OUT = join(HISTORY_DIR, 'parsed.json');

// --- Player → position resolver, sourced from Sleeper's full player DB ---

console.log('Fetching Sleeper full player DB for position resolution...');
const playersRes = await fetch('https://api.sleeper.app/v1/players/nfl');
const playersRaw = await playersRes.json();

// Build name → position map. For DEFs, Sleeper keys by team abbr; we'll match by city/nickname.
const nameToPos = new Map();
const FANTASY = new Set(['QB', 'RB', 'WR', 'TE', 'K']); // K kept just so we don't crash on it
for (const p of Object.values(playersRaw)) {
  if (!FANTASY.has(p.position)) continue;
  const name = (p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).trim();
  if (!name) continue;
  const key = name.toLowerCase().replace(/[^a-z]/g, '');
  // Prefer recently-active records when there are name collisions.
  if (!nameToPos.has(key) || p.active) nameToPos.set(key, p.position);
}

// DEF detection: city names, nicknames, and a hardcoded set of NFL team identifiers.
const DEF_NAMES = new Set([
  '49ers','bears','bengals','bills','broncos','browns','buccaneers','cardinals',
  'chargers','chiefs','colts','cowboys','dolphins','eagles','falcons','giants',
  'jaguars','jets','lions','packers','panthers','patriots','raiders','rams',
  'ravens','saints','seahawks','steelers','texans','titans','vikings','commanders'
]);

function resolvePosition(playerName) {
  const key = playerName.toLowerCase().replace(/[^a-z]/g, '');
  if (DEF_NAMES.has(key)) return 'DEF';
  if (nameToPos.has(key)) return nameToPos.get(key);
  // Try without punctuation/Sr./Jr./III suffixes.
  const stripped = playerName
    .replace(/\b(sr|jr|ii|iii|iv|v)\.?$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  if (nameToPos.has(stripped)) return nameToPos.get(stripped);
  return null;
}

// --- Parser ---

function parseOneYear(text, season) {
  const lines = text.split(/\r?\n/);
  const picks = [];
  let round = 0;
  let pickInRound = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const roundMatch = line.match(/^Round\s+(\d+)/i);
    if (roundMatch) {
      round = parseInt(roundMatch[1], 10);
      pickInRound = 0;
      continue;
    }
    // Pick line: "1.\tPlayer Name\tTeam Name"  (also tolerate multiple tabs / spaces)
    const m = line.match(/^(\d+)[.)]\s*(.+?)\s+([A-Za-z][^\t]*?)\s*$/);
    if (!m) continue;
    pickInRound = parseInt(m[1], 10);
    let player = m[2].trim();
    let team = m[3].trim();
    // The simple regex sometimes splits "Player Name Team Name" wrong if there's
    // no tab. Try splitting by tab when present for higher accuracy.
    const tabSplit = line.split('\t').map((s) => s.trim()).filter(Boolean);
    if (tabSplit.length >= 3) {
      // tabSplit[0] = "1." or "1", tabSplit[1] = player, tabSplit[2] = team
      pickInRound = parseInt(tabSplit[0], 10);
      player = tabSplit[1];
      team = tabSplit[2];
    }
    if (player === '--empty--' || !player) continue;
    picks.push({ round, pickInRound, player, team });
  }

  // Determine team count from round 1 picks.
  const round1 = picks.filter((p) => p.round === 1);
  const teamCount = round1.length;
  if (teamCount === 0) return null;

  // Compute slot (snake) and global pick_no.
  const slotsByTeam = new Map();
  for (const p of round1) slotsByTeam.set(p.team, p.pickInRound);
  for (const p of picks) {
    p.slot = slotsByTeam.get(p.team) || null;
    p.pickNo = (p.round - 1) * teamCount + p.pickInRound;
    if (p.round % 2 === 0) {
      // Snake reversal: pickInRound k in even round picks slot (teamCount - k + 1).
      // Stored slot already reflects the team, so just confirm pickNo math.
      p.pickNo = (p.round - 1) * teamCount + p.pickInRound;
    }
    p.position = resolvePosition(p.player);
  }

  return { season, teamCount, picks };
}

// --- Run ---

const files = (await readdir(HISTORY_DIR)).filter((f) => /^\d{4}\.txt$/.test(f));
files.sort();

const years = {};
const uniqueTeams = new Map(); // team_name → Set(years)
const unresolved = new Set();

for (const f of files) {
  const season = f.replace('.txt', '');
  const text = await readFile(join(HISTORY_DIR, f), 'utf8');
  const parsed = parseOneYear(text, season);
  if (!parsed) {
    console.warn(`  ${season}: no picks parsed`);
    continue;
  }
  years[season] = parsed;
  console.log(`  ${season}: ${parsed.picks.length} picks across ${parsed.teamCount} teams`);
  for (const p of parsed.picks) {
    if (!uniqueTeams.has(p.team)) uniqueTeams.set(p.team, new Set());
    uniqueTeams.get(p.team).add(season);
    if (!p.position) unresolved.add(p.player);
  }
}

const teamsOut = {};
for (const [team, seasonsSet] of uniqueTeams) {
  teamsOut[team] = [...seasonsSet].sort();
}

const out = {
  years,
  uniqueTeams: teamsOut,
  unresolvedPlayers: [...unresolved].sort()
};
await writeFile(OUT, JSON.stringify(out, null, 2));

console.log(`\nWrote ${OUT}`);
console.log(`Unique team names across all years: ${Object.keys(teamsOut).length}`);
console.log(`Unresolved player names (no position): ${unresolved.size}`);
if (unresolved.size > 0 && unresolved.size <= 25) {
  console.log('  Unresolved:', [...unresolved].join(', '));
}
