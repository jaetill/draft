// Build-time: walk the Sleeper previous_league_id chain back through every
// completed season, then derive owner archetypes from each owner's pick
// pattern (which positions they took in which rounds).
//
// Output: public/data/owner-profiles.json
//   {
//     <display_name>: {
//       seasons: ["2025", ...],
//       archetypes: ["AnchorTE", "EarlyQB"],
//       confidence: { AnchorTE: 1.0, EarlyQB: 0.5 },  // hits / seasons
//       lastSeen: "2025"
//     }
//   }
//
// Run: node scripts/build-owner-profiles.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CFG_PATH = join(__dirname, '..', 'public', 'data', 'league.json');
const OUT_PATH = join(__dirname, '..', 'public', 'data', 'owner-profiles.json');
const BASE = 'https://api.sleeper.app/v1';

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`Sleeper ${path} → HTTP ${res.status}`);
  return res.json();
}

/** Detect archetypes from one owner's picks for a single season.
 *  Thresholds tuned for 12-team PPR — "early" means earlier than the typical
 *  league average, not just "before round 10." */
function detectSeasonArchetypes(picksByRound) {
  const tags = [];
  const r = picksByRound;

  // Anchor TE: top-tier TE pick in R1-R2 (R3 is borderline, R4+ is normal timing).
  if (r[1] === 'TE' || r[2] === 'TE') tags.push('AnchorTE');

  // Early QB: QB drafted in R1-R3. R4-R5 is common in modern 12-team PPR
  // (Allen/Jackson/Mahomes price has crept up); only R1-R3 is a real archetype tell.
  for (let i = 1; i <= 3; i++) {
    if (r[i] === 'QB') {
      tags.push('EarlyQB');
      break;
    }
  }

  // Hero RB: RB in R1, then NO RB until R6+. Broaden the "no RB" window so a
  // mid-round RB from a Hero-RB owner doesn't reclassify them as default.
  let nextRbRound = null;
  for (let i = 2; i <= 15; i++) if (r[i] === 'RB') { nextRbRound = i; break; }
  if (r[1] === 'RB' && (nextRbRound === null || nextRbRound >= 6)) tags.push('HeroRB');

  // Zero RB: NO RB in rounds 1-5.
  let anyEarlyRb = false;
  for (let i = 1; i <= 5; i++) if (r[i] === 'RB') { anyEarlyRb = true; break; }
  if (!anyEarlyRb) tags.push('ZeroRB');

  // Robust RB: RB in 2+ of rounds 1-3.
  const earlyRbCount = [r[1], r[2], r[3]].filter((p) => p === 'RB').length;
  if (earlyRbCount >= 2) tags.push('RobustRB');

  return tags;
}

async function processLeague(leagueId) {
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

  // Group picks by owner, ordered by round.
  const byOwner = {};
  for (const p of picks) {
    const userId = slotToUserId[p.draft_slot];
    const name = userById[userId] || `slot${p.draft_slot}`;
    if (!byOwner[name]) byOwner[name] = [];
    const pos = p.metadata?.position || 'UNK';
    byOwner[name].push({ round: p.round, pick: p.pick_no, pos });
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

  // slot → display_name for the season, useful for mock harness defaults.
  const slotToOwner = {};
  for (const [slot, userId] of Object.entries(slotToUserId)) {
    slotToOwner[slot] = userById[userId] || `slot${slot}`;
  }

  return {
    season: league.season,
    leagueId,
    leagueName: league.name,
    previousLeagueId: league.previous_league_id,
    seasonProfiles,
    slotToOwner
  };
}

console.log('Walking Sleeper league chain...');
const cfg = JSON.parse(await readFile(CFG_PATH, 'utf8'));
let leagueId = cfg.sleeper_league_id;
if (!leagueId) {
  console.error('No sleeper_league_id in league.json — nothing to do.');
  process.exit(0);
}

// Walk backward; we only want completed seasons.
const completed = [];
const seen = new Set();
while (leagueId && !seen.has(leagueId)) {
  seen.add(leagueId);
  try {
    const result = await processLeague(leagueId);
    if (result) {
      console.log(`  ${result.season} (${result.leagueName}) — ${Object.keys(result.seasonProfiles).length} owners`);
      completed.push(result);
      leagueId = result.previousLeagueId;
    } else {
      // current/in-progress league — get its prev to keep walking
      const lg = await get(`/league/${leagueId}`);
      leagueId = lg.previous_league_id;
    }
  } catch (err) {
    console.warn(`  failed for ${leagueId}: ${err.message}`);
    break;
  }
}

if (completed.length === 0) {
  console.log('No completed seasons in chain — writing empty profile file.');
  await writeFile(OUT_PATH, JSON.stringify({ owners: {}, seasons: [] }, null, 2));
  process.exit(0);
}

// Aggregate across seasons by owner display_name.
const owners = {};
for (const season of completed) {
  for (const [name, prof] of Object.entries(season.seasonProfiles)) {
    if (!owners[name]) owners[name] = { seasons: [], archetypeHits: {}, lastSeen: null, picks: {} };
    owners[name].seasons.push(season.season);
    for (const arch of prof.archetypes) {
      owners[name].archetypeHits[arch] = (owners[name].archetypeHits[arch] || 0) + 1;
    }
    owners[name].picks[season.season] = prof.picks;
    if (!owners[name].lastSeen || season.season > owners[name].lastSeen) {
      owners[name].lastSeen = season.season;
    }
  }
}

// Compute confidence (hits / seasons played) and pick top archetypes.
for (const owner of Object.values(owners)) {
  const n = owner.seasons.length;
  owner.confidence = {};
  for (const [arch, hits] of Object.entries(owner.archetypeHits)) {
    owner.confidence[arch] = hits / n;
  }
  // "Strong" archetype: hits in ≥50% of seasons (or ≥1 season if only 1 played).
  const threshold = n === 1 ? 1 : 0.5;
  owner.archetypes = Object.entries(owner.confidence)
    .filter(([, c]) => c >= threshold)
    .sort((a, b) => b[1] - a[1])
    .map(([arch]) => arch);
  delete owner.archetypeHits; // keep file small
}

// Slot → owner from the most recent season (for mock-harness default seating).
const latestSeason = completed.sort((a, b) => b.season.localeCompare(a.season))[0];
const slotToOwner = latestSeason?.slotToOwner || {};

const out = {
  generated_at: new Date().toISOString(),
  seasons: completed.map((s) => s.season).sort(),
  latestSeason: latestSeason?.season,
  slotToOwner,
  owners
};

await writeFile(OUT_PATH, JSON.stringify(out, null, 2));
console.log(`\nWrote ${OUT_PATH} — ${Object.keys(owners).length} owners across ${out.seasons.length} season(s).`);
