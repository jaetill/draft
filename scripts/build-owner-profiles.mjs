// Build-time: walk the Sleeper previous_league_id chain through every completed
// season AND ingest Yahoo historical data (scripts/yahoo-history/*.txt + the
// team-mapping that resolves Yahoo team names to current Sleeper handles).
// Detect per-season archetypes for each owner, aggregate with confidence math,
// write public/data/owner-profiles.json.
//
// Run: node scripts/build-owner-profiles.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = join(__dirname, '..', 'public', 'data', 'league.json');
const OUT_PATH = join(__dirname, '..', 'public', 'data', 'owner-profiles.json');
const YAHOO_PARSED = join(__dirname, 'yahoo-history', 'parsed.json');
const YAHOO_MAPPING = join(__dirname, 'yahoo-history', 'team-mapping.json');
const BASE = 'https://api.sleeper.app/v1';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} → HTTP ${res.status}`);
  return res.json();
}

// --- Archetype detection (shared between Sleeper + Yahoo) ---

function detectSeasonArchetypes(picksByRound) {
  const tags = [];
  const r = picksByRound;

  if (r[1] === 'TE' || r[2] === 'TE') tags.push('AnchorTE');

  for (let i = 1; i <= 3; i++) {
    if (r[i] === 'QB') {
      tags.push('EarlyQB');
      break;
    }
  }

  let nextRbRound = null;
  for (let i = 2; i <= 15; i++) if (r[i] === 'RB') { nextRbRound = i; break; }
  if (r[1] === 'RB' && (nextRbRound === null || nextRbRound >= 6)) tags.push('HeroRB');

  let anyEarlyRb = false;
  for (let i = 1; i <= 5; i++) if (r[i] === 'RB') { anyEarlyRb = true; break; }
  if (!anyEarlyRb) tags.push('ZeroRB');

  const earlyRbCount = [r[1], r[2], r[3]].filter((p) => p === 'RB').length;
  if (earlyRbCount >= 2) tags.push('RobustRB');

  return tags;
}

// --- Sleeper chain processor ---

async function processSleeperLeague(leagueId) {
  const [league, users, drafts] = await Promise.all([
    get(`/league/${leagueId}`),
    get(`/league/${leagueId}/users`),
    get(`/league/${leagueId}/drafts`)
  ]);
  if (!drafts.length) return null;
  const draft = drafts[0];
  if (draft.status !== 'complete') return null;

  const [picks, draftMeta] = await Promise.all([
    get(`/draft/${draft.draft_id}/picks`),
    get(`/draft/${draft.draft_id}`)
  ]);

  const userById = Object.fromEntries(users.map((u) => [u.user_id, u.display_name]));
  const slotToUserId = Object.fromEntries(
    Object.entries(draftMeta.draft_order || {}).map(([uid, slot]) => [slot, uid])
  );
  const slotToOwner = {};
  for (const [slot, userId] of Object.entries(slotToUserId)) {
    slotToOwner[slot] = userById[userId] || `slot${slot}`;
  }

  const byOwner = {};
  for (const p of picks) {
    const userId = slotToUserId[p.draft_slot];
    const name = userById[userId] || `slot${p.draft_slot}`;
    if (!byOwner[name]) byOwner[name] = [];
    const pos = p.metadata?.position || 'UNK';
    const playerName = p.metadata
      ? `${p.metadata.first_name ?? ''} ${p.metadata.last_name ?? ''}`.trim()
      : '';
    byOwner[name].push({ round: p.round, pick: p.pick_no, pos, player_name: playerName });
  }

  const seasonProfiles = {};
  for (const [owner, ownerPicks] of Object.entries(byOwner)) {
    const positionsByRound = [];
    for (const p of ownerPicks) positionsByRound[p.round] = p.pos;
    seasonProfiles[owner] = {
      season: league.season,
      archetypes: detectSeasonArchetypes(positionsByRound),
      picks: ownerPicks
    };
  }

  return {
    season: league.season,
    leagueId,
    leagueName: league.name,
    previousLeagueId: league.previous_league_id,
    seasonProfiles,
    slotToOwner,
    source: 'sleeper'
  };
}

// --- Yahoo processor ---

// Resolve player NFL team for affinity detection. Three layers, in order:
//   1. Trimmed players DB (current rosters) — accurate for active players.
//   2. Sleeper full DB — adds players that have a team set even if not in trimmed.
//   3. Manual overrides — retired stars (Brady, Brees, Edelman, etc.) that
//      Sleeper marks team:null. See scripts/yahoo-history/team-overrides.json.
async function buildPlayerTeamMap() {
  const trimmed = JSON.parse(
    await readFile(join(__dirname, '..', 'public', 'data', 'players.json'), 'utf8')
  );
  let overrides = {};
  try {
    overrides = JSON.parse(
      await readFile(join(__dirname, 'yahoo-history', 'team-overrides.json'), 'utf8')
    );
  } catch {}

  const map = new Map();
  for (const p of Object.values(trimmed)) {
    if (p.team) {
      const key = p.name.toLowerCase().replace(/[^a-z]/g, '');
      map.set(key, p.team);
    }
  }
  try {
    const fullRes = await fetch(`${BASE}/players/nfl`);
    const full = await fullRes.json();
    for (const p of Object.values(full)) {
      if (!p.team) continue;
      const name = (p.full_name || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim()).trim();
      if (!name) continue;
      const key = name.toLowerCase().replace(/[^a-z]/g, '');
      if (!map.has(key)) map.set(key, p.team);
    }
  } catch {}
  // Manual overrides win over any Sleeper data — they're the source of truth
  // for retired players whose team isn't preserved in the API.
  for (const [name, team] of Object.entries(overrides)) {
    if (name.startsWith('_') || typeof team !== 'string') continue;
    const key = name.toLowerCase().replace(/[^a-z]/g, '');
    map.set(key, team);
  }
  return map;
}

async function processYahoo() {
  let parsed, mapping;
  try {
    parsed = JSON.parse(await readFile(YAHOO_PARSED, 'utf8'));
    mapping = JSON.parse(await readFile(YAHOO_MAPPING, 'utf8'));
  } catch (err) {
    console.warn(`  Yahoo data unavailable: ${err.message}`);
    return [];
  }

  const seasons = [];
  for (const [season, yearData] of Object.entries(parsed.years)) {
    const byOwner = {};
    for (const p of yearData.picks) {
      const handle = mapping[p.team];
      if (!handle) continue; // null = former owner, skip
      if (handle === 'AUTODRAFT') continue; // yahoo no-show filler, not the owner's strategy
      if (typeof handle !== 'string' || handle.startsWith('_')) continue; // metadata keys
      if (!byOwner[handle]) byOwner[handle] = [];
      byOwner[handle].push({ round: p.round, pick: p.pickNo, pos: p.position, player_name: p.player });
    }
    const seasonProfiles = {};
    for (const [owner, ownerPicks] of Object.entries(byOwner)) {
      const positionsByRound = [];
      for (const p of ownerPicks) positionsByRound[p.round] = p.pos;
      seasonProfiles[owner] = {
        season,
        archetypes: detectSeasonArchetypes(positionsByRound),
        picks: ownerPicks
      };
    }
    seasons.push({
      season,
      leagueName: 'Plowden\'s Peeps (Yahoo)',
      seasonProfiles,
      teamCount: yearData.teamCount,
      source: 'yahoo'
    });
    console.log(`  ${season} (Yahoo) — ${Object.keys(seasonProfiles).length} owners`);
  }
  return seasons;
}

// --- Main ---

console.log('Walking Sleeper league chain...');
const cfg = JSON.parse(await readFile(CFG_PATH, 'utf8'));
let leagueId = cfg.sleeper_league_id;
const completed = [];
const seen = new Set();
while (leagueId && !seen.has(leagueId)) {
  seen.add(leagueId);
  try {
    const result = await processSleeperLeague(leagueId);
    if (result) {
      console.log(`  ${result.season} (Sleeper) — ${Object.keys(result.seasonProfiles).length} owners`);
      completed.push(result);
      leagueId = result.previousLeagueId;
    } else {
      const lg = await get(`/league/${leagueId}`);
      leagueId = lg.previous_league_id;
    }
  } catch (err) {
    console.warn(`  failed for ${leagueId}: ${err.message}`);
    break;
  }
}

console.log('\nProcessing Yahoo history...');
const yahooSeasons = await processYahoo();
const allSeasons = [...completed, ...yahooSeasons];

if (allSeasons.length === 0) {
  console.log('No data — writing empty profile file.');
  await writeFile(OUT_PATH, JSON.stringify({ owners: {}, seasons: [] }, null, 2));
  process.exit(0);
}

// Aggregate per owner across all seasons.
const owners = {};
for (const season of allSeasons) {
  for (const [name, prof] of Object.entries(season.seasonProfiles)) {
    if (!owners[name]) owners[name] = { seasons: [], archetypeHits: {}, lastSeen: null, picks: {}, sources: new Set() };
    owners[name].seasons.push(season.season);
    owners[name].sources.add(season.source);
    for (const arch of prof.archetypes) {
      owners[name].archetypeHits[arch] = (owners[name].archetypeHits[arch] || 0) + 1;
    }
    owners[name].picks[season.season] = prof.picks;
    if (!owners[name].lastSeen || season.season > owners[name].lastSeen) {
      owners[name].lastSeen = season.season;
    }
  }
}

// Compute confidence and pick top archetypes.
for (const owner of Object.values(owners)) {
  const n = owner.seasons.length;
  owner.confidence = {};
  for (const [arch, hits] of Object.entries(owner.archetypeHits)) {
    owner.confidence[arch] = +(hits / n).toFixed(3);
  }
  // Strong archetype: hits in ≥40% of seasons (lower threshold OK with N>3).
  const threshold = n >= 3 ? 0.4 : 1.0;
  owner.archetypes = Object.entries(owner.confidence)
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([arch]) => arch);
  owner.sources = [...owner.sources];
  delete owner.archetypeHits;
}

// --- Team affinity detection ---
// For each owner, identify NFL teams they pick at meaningfully higher rate than
// the league average. Threshold: ≥4 picks AND ≥2x the league rate.
console.log('\nComputing team affinities...');
const playerTeamMap = await buildPlayerTeamMap();

const ownerTeamCounts = {};
const ownerPickTotals = {};
const leagueTeamCounts = {};
let leaguePickTotal = 0;

for (const season of allSeasons) {
  for (const [name, prof] of Object.entries(season.seasonProfiles)) {
    if (!ownerTeamCounts[name]) ownerTeamCounts[name] = {};
    for (const pick of prof.picks) {
      // Find player by name; lookup nfl team. If not found, skip.
      // For Sleeper-source picks, we don't have the player_name in the pick — we have player_id.
      // Skip Sleeper picks for affinity (DNS yet); affinity comes from Yahoo data only for now.
      const playerName = pick.player_name || pick.playerName;
      if (!playerName) continue;
      const key = playerName.toLowerCase().replace(/[^a-z]/g, '');
      const nfl = playerTeamMap.get(key);
      if (!nfl) continue;
      ownerTeamCounts[name][nfl] = (ownerTeamCounts[name][nfl] || 0) + 1;
      ownerPickTotals[name] = (ownerPickTotals[name] || 0) + 1;
      leagueTeamCounts[nfl] = (leagueTeamCounts[nfl] || 0) + 1;
      leaguePickTotal++;
    }
  }
}

for (const [name, owner] of Object.entries(owners)) {
  const counts = ownerTeamCounts[name] || {};
  const total = ownerPickTotals[name] || 0;
  const affinities = [];
  for (const [nfl, count] of Object.entries(counts)) {
    if (count < 4) continue;
    const ownerRate = count / total;
    const leagueRate = (leagueTeamCounts[nfl] || 0) / Math.max(1, leaguePickTotal);
    const ratio = leagueRate > 0 ? ownerRate / leagueRate : 0;
    if (ratio >= 2.0) {
      affinities.push({ team: nfl, count, ratio: +ratio.toFixed(1) });
    }
  }
  affinities.sort((a, b) => b.ratio - a.ratio);
  owner.teamAffinities = affinities.slice(0, 4);
}

// Slot→owner map from the most recent Sleeper season (for mock-harness defaults).
const latestSleeperSeason = completed.sort((a, b) => b.season.localeCompare(a.season))[0];
const slotToOwner = latestSleeperSeason?.slotToOwner || {};

const out = {
  generated_at: new Date().toISOString(),
  seasons: allSeasons.map((s) => s.season).sort(),
  latestSeason: latestSleeperSeason?.season,
  slotToOwner,
  owners
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`\nWrote ${OUT_PATH}`);
console.log(`Owners: ${Object.keys(owners).length} · Seasons: ${out.seasons.length}`);
