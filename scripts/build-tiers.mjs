// Build public/data/tiers.json — positional tiers from a blend of three
// independent August-2026 sources.
//
// Tiering is only as good as the ordering underneath it, and any single source
// has a known bias:
//   • Sleeper ADP        — your actual room. Most relevant, smallest sample,
//                          and reflects Sleeper's own board nudging the field.
//   • FFC ADP            — 7,986 real PPR drafts, 20-27 Aug. Big sample, but
//                          it is the generic public, not your league.
//   • Boris Chen ECR     — expert consensus. Says what SHOULD happen rather
//                          than what does; systematically disagrees with ADP
//                          on DEF and TE.
//
// Blending them is not averaging for its own sake. ADP tells you when a player
// leaves the board; ECR tells you what he is worth. A tier cut wants both: a
// gap that shows up in ADP *and* in ECR is a real cliff, not a quirk of one
// dataset. Where they disagree sharply, that disagreement is itself the signal
// — recorded per player as `spread`.
//
// Run: node scripts/build-tiers.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assignTiers } from '../src/tiers.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const OUT = join(DATA, 'tiers.json');

const POSITIONS = new Set(['QB', 'RB', 'WR', 'TE', 'DEF']);

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\bdefense\b/g, '')
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');

function parseCsv(text) {
  const [header, ...lines] = text.trim().split('\n');
  const cols = header.split(',');
  return lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
}

const [playersRaw, rankingsRaw, byesRaw, sleeperRaw, ffcRaw] = await Promise.all([
  readFile(join(DATA, 'players.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'rankings.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'byes.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({ byes: {} })),
  readFile(join(DATA, 'sleeper-adp.csv'), 'utf8').catch(() => null),
  readFile(join(DATA, 'ffc-adp.csv'), 'utf8').catch(() => null),
]);

// Refuse to guess. Tiers built on one source are a ranking with extra steps,
// and a confidently-drawn wrong cliff is worse than no cliff at all.
const available = [sleeperRaw && 'sleeper-adp', ffcRaw && 'ffc-adp'].filter(Boolean);
if (available.length < 2) {
  console.error(
    `Need at least two independent ADP sources; found ${available.length} (${available.join(', ') || 'none'}).\n` +
      "  Tiers built on a single source encode that source's bias as if it were a cliff.\n" +
      '  Refusing to write tiers.json.',
  );
  process.exit(1);
}

// --- Assemble one record per player, keyed by position + normalized name ----

const rec = new Map();
const touch = (name, pos) => {
  const key = `${pos}|${norm(name)}`;
  if (!rec.has(key)) rec.set(key, { name, position: pos, ranks: {} });
  return rec.get(key);
};

for (const row of parseCsv(sleeperRaw)) {
  if (!POSITIONS.has(row.pos)) continue;
  touch(row.name, row.pos).ranks.sleeper = Number(row.adp_ppr);
}
for (const row of parseCsv(ffcRaw)) {
  if (!POSITIONS.has(row.pos)) continue;
  touch(row.name, row.pos).ranks.ffc = Number(row.adp);
}
for (const r of Object.values(rankingsRaw.players)) {
  if (!POSITIONS.has(r.position)) continue;
  const t = touch(r.name, r.position);
  t.ranks.ecr = r.ecr;
  // Expert disagreement. This is what actually defines a tier boundary — see
  // the header of src/tiers.js for why ADP gaps do not.
  t.stdev = r.stdev;
}

// Attach Sleeper player ids + byes where we can resolve them.
const idByKey = new Map();
for (const [id, p] of Object.entries(playersRaw)) {
  idByKey.set(`${p.position}|${norm(p.name)}`, { id, team: p.team });
}

// --- Consensus ---------------------------------------------------------------
//
// Mean of whatever sources have the player. Requiring all three would drop
// real players over a name mismatch; requiring one would let a single outlier
// define a cliff. Two is the honest floor, and `sources` records which.

const rows = [];
for (const [key, r] of rec) {
  const vals = Object.values(r.ranks).filter((v) => Number.isFinite(v));
  if (vals.length < 2) continue;
  const consensus = vals.reduce((a, b) => a + b, 0) / vals.length;
  const spread = Math.max(...vals) - Math.min(...vals);
  const hit = idByKey.get(key);

  // Uncertainty prefers the expert std dev (a real measure of disagreement
  // across ~100 rankers) and falls back to how far apart our own three sources
  // land on him. Both answer the same question: how confidently does the market
  // place this player?
  const uncertainty = Number.isFinite(r.stdev) ? r.stdev : spread;

  rows.push({
    id: hit?.id ?? key,
    name: r.name,
    position: r.position,
    team: hit?.team ?? null,
    bye: hit?.team ? (byesRaw.byes?.[hit.team] ?? null) : null,
    consensus: Math.round(consensus * 10) / 10,
    spread: Math.round(spread * 10) / 10,
    uncertainty: Math.round(uncertainty * 10) / 10,
    ranks: r.ranks,
    sources: Object.keys(r.ranks),
  });
}

// --- Tier ---------------------------------------------------------------------

const byPos = {};
for (const r of rows) (byPos[r.position] ??= []).push(r);

const tiered = [];
for (const list of Object.values(byPos)) {
  tiered.push(...assignTiers(list));
}
tiered.sort((a, b) => a.consensus - b.consensus);

const summary = {};
for (const [pos, list] of Object.entries(byPos)) {
  const counts = {};
  for (const p of list) counts[p.tier] = (counts[p.tier] ?? 0) + 1;
  summary[pos] = counts;
}

await writeFile(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      sources: {
        'sleeper-adp': 'live draft-room adp_ppr, scraped 2026-08-27',
        'ffc-adp': 'fantasyfootballcalculator.com, 7986 PPR drafts, 2026-08-20..27',
        'boris-chen-ecr': rankingsRaw.source,
      },
      tierCounts: summary,
      players: tiered,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${OUT}`);
console.log(`  ${tiered.length} players tiered from ${available.length + 1} sources\n`);
for (const [pos, counts] of Object.entries(summary)) {
  const parts = Object.entries(counts)
    .sort((a, b) => a[0] - b[0])
    .map(([t, n]) => `T${t}:${n}`);
  console.log(`  ${pos.padEnd(4)} ${parts.join('  ')}`);
}
const thin = tiered.filter((p) => p.sources.length < 3).length;
console.log(`\n  ${tiered.length - thin} players confirmed by all three sources, ${thin} by two.`);
