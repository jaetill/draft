// Export the draft board as a CSV — the paper (or Sheets) backup for draft day.
//
// The web app is the primary tool, but a flat board that opens in Google Sheets
// costs nothing and covers the cases the app can't: venue wifi dies, iPad
// sleeps, or you just want to sort by a column and eyeball the tier breaks.
//
// Everything here is derived from the same data the engine uses, so the CSV and
// the app can't silently disagree.
//
// Run: node scripts/export-board.mjs [outfile]
//   defaults to draft-board.csv in the repo root

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRankings } from '../src/rankings.js';
import { analyzeBackfields, backfieldLabel } from '../src/backfield.js';
import { availabilityOf } from '../src/availability.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const OUT = process.argv[2] || join(__dirname, '..', 'draft-board.csv');

const [players, ecr, cfg, byes, tiers, valueCurve] = await Promise.all([
  readFile(join(DATA, 'players.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'rankings.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null),
  readFile(join(DATA, 'league.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'byes.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null),
  readFile(join(DATA, 'tiers.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null),
  readFile(join(DATA, 'value-curve.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null),
]);

// Same join the app does at load time — byes live on team, not on the player.
if (byes?.byes) {
  for (const p of Object.values(players)) p.bye_week = byes.byes[p.team] ?? null;
} else {
  console.warn('No byes.json — Bye column will be empty. Run: npm run build-byes');
}

// Multi-source positional tiers, keyed by Sleeper id where resolvable and by
// normalized name otherwise (tiers.json carries players our snapshot lacks).
const normName = (s) =>
  s
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');

const tierById = new Map();
const tierByName = new Map();
for (const t of tiers?.players ?? []) {
  tierById.set(t.id, t.tier);
  tierByName.set(`${t.position}|${normName(t.name)}`, t.tier);
}
if (!tiers?.players) {
  console.warn('No tiers.json — PosTier falls back to single-source. Run: npm run build-tiers');
}

const tierOf = (p) =>
  tierById.get(p.id) ?? tierByName.get(`${p.position}|${normName(p.name)}`) ?? null;

// Snapshot age gate. A stale players.json does not fail loudly anywhere else:
// a player who changed teams keeps his old team, so the bye join silently
// produces a wrong week rather than a missing one.
const meta = await readFile(join(DATA, 'players-meta.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null);
const ageDays = meta?.generatedAt
  ? Math.round((Date.now() - new Date(meta.generatedAt).getTime()) / 86_400_000)
  : null;
if (ageDays === null) {
  console.warn('\n⚠ players.json has no provenance — age unknown. Run: npm run build-players');
} else if (ageDays > 14) {
  console.warn(
    `\n⚠ players.json is ${ageDays} days old (${meta.generatedAt.slice(0, 10)}).\n` +
      '  Team changes since then produce WRONG bye weeks, not missing ones —\n' +
      '  the join succeeds against the old team. Run: npm run build-players',
  );
}

if (!ecr) {
  console.warn('No rankings.json — exporting a SYNTHETIC board. Run: npm run build-rankings');
}

const rankings = buildRankings(players, ecr, valueCurve);

// Committee detection, derived from how close a team's backs sit in consensus.
const backfields = analyzeBackfields(players, ecr?.players);

// Replacement level per position, straight from league config. This is what
// turns raw projection into VBD — the number that actually orders the board.
const replacement = {};
for (const [pos, cutoff] of Object.entries(cfg.replacement_levels || {})) {
  if (pos.startsWith('_')) continue;
  replacement[pos] = rankings.replacementPoints(pos, cutoff);
}

/**
 * Expert disagreement, bucketed. Std.Dev of expert ranks is the most useful
 * column on this sheet that nobody thinks to look at: it separates "the field
 * agrees he's the RB14" from "half the experts have him RB6 and half have him
 * RB40", which are completely different picks at the same ADP.
 */
function riskLabel(sd) {
  if (sd === null) return '';
  if (sd >= 25) return 'high';
  if (sd >= 15) return 'wide';
  if (sd >= 8) return 'some';
  return 'tight';
}

const rows = Object.values(players)
  .map((p) => {
    const proj = rankings.projection(p);
    const vbd = Math.max(0, proj - (replacement[p.position] ?? 0));
    const sd = rankings.meta.spread(p);
    const avail = availabilityOf(p);
    return {
      Rank: null, // filled after sort
      Player: p.name,
      Pos: p.position,
      Team: p.team ?? '',
      Bye: p.bye_week ?? '',
      PosRank: `${p.position}${rankings.posRank.get(p.id) ?? ''}`,
      // Multi-source positional tier when we have it — that is the column your
      // brother's method actually runs on. Falls back to the single-source
      // derivation so the sheet still works without tiers.json.
      PosTier: tierOf(p) ?? rankings.posTier(p),
      Tier: rankings.tier(p),
      ECR: rankings.meta.ecr(p) ?? '',
      VBD: Math.round(vbd),
      // Upside and bust are the two tails of the expert spread. Risk collapses
      // them into one word; these keep the asymmetry visible, which matters
      // because for rookies the downside tail is roughly twice the upside one.
      Upside: rankings.meta.upside(p) ?? '',
      Bust: rankings.meta.bust(p) ?? '',
      Risk: riskLabel(sd),
      // Where he sits on his own roster, and whether he is sharing the work.
      Depth: p.depth_chart_order ?? '',
      Backfield: backfieldLabel(backfields.get(p.id)),
      Spread: sd ?? '',
      Ranked: rankings.meta.isRanked(p) ? 'yes' : 'no',
      Rookie: p.exp === 0 ? 'ROOKIE' : '',
      // Availability, not raw injury_status — and ONLY the absences that cost
      // starts. The raw field is dominated by preseason "Questionable" (153
      // players here, Ja'Marr Chase and Puka Nacua among them); echoing it into
      // a column you scan on draft day flags the most certain player on the
      // board and teaches you to ignore the column. Game-day tags stay in
      // Injury, where their low signal value is obvious from the name.
      Availability: avail?.level === 'out' ? avail.label : '',
      Injury: p.injury_status ?? '',
    };
  })
  // Ranked players first (consensus order), then everyone else by VBD.
  .sort((a, b) => {
    if (a.Ranked !== b.Ranked) return a.Ranked === 'yes' ? -1 : 1;
    if (a.Ranked === 'yes') return a.ECR - b.ECR;
    return b.VBD - a.VBD;
  });

// Only the part of the tail worth printing. Past ~pick 250 it is waiver fodder.
const BOARD_DEPTH = 250;
const board = rows.slice(0, BOARD_DEPTH);
board.forEach((r, i) => {
  r.Rank = i + 1;
});

const headers = Object.keys(board[0]);
const escape = (v) => {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = [
  headers.join(','),
  ...board.map((r) => headers.map((h) => escape(r[h])).join(',')),
].join('\n');

await writeFile(OUT, csv + '\n');

const ranked = board.filter((r) => r.Ranked === 'yes').length;
console.log(`Wrote ${board.length} players to ${OUT}`);
console.log(`  ${ranked} expert-ranked, ${board.length - ranked} from the synthetic tail`);
console.log(`  source: ${rankings.meta.source}`);
console.log(`  projections: ${rankings.meta.projectionSource}`);
if (rankings.meta.fetchedAt) {
  console.log(`  rankings fetched: ${new Date(rankings.meta.fetchedAt).toLocaleString()}`);
}
if (byes?.byes) {
  const withBye = board.filter((r) => r.Bye !== '').length;
  console.log(`  byes: ${withBye}/${board.length} players (${byes.source})`);
} else {
  console.log('\nBye column empty — Sleeper leaves bye_week null in the player DB.');
  console.log('Run `npm run build-byes` to populate it.');
}
