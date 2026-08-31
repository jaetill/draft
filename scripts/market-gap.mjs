// Where the room disagrees with the experts.
//
// Two orderings over the same players:
//   Sleeper's board  — what the room drafts off and autopick follows.
//   Boris Chen ECR   — what the expert field actually thinks.
//
// The gap between them is the only tradeable edge in a draft. You do not beat
// the room by liking the same players it likes; you beat it by taking the
// players it systematically drafts late and skipping the ones it reaches for.
//
// TWO POSSIBLE SOURCES for the room's ordering, and they do NOT agree:
//
//   1. data/sleeper-adp.csv — real `adp_ppr` scraped from the live draft room.
//      Authoritative. Use this.
//   2. search_rank in players.json — fallback proxy.
//
// The fallback is genuinely misleading and it is worth knowing why. search_rank
// is Sleeper's *search popularity* index. Quarterbacks are the most-searched
// players in fantasy football regardless of where they are drafted, so the
// proxy reports QBs as massively over-drafted (mean gap -30). Real ADP says the
// opposite: this room lets QBs *slide* (+11.6). Same league, same day, opposite
// conclusion. Treat the proxy as a smoke alarm, never as evidence.
//
// Run: node scripts/market-gap.mjs [topN]

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const TOP_N = Number(process.argv[2]) || 12;

const [players, rankings, byes, adpCsv] = await Promise.all([
  readFile(join(DATA, 'players.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'rankings.json'), 'utf8').then(JSON.parse),
  readFile(join(DATA, 'byes.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => ({ byes: {} })),
  readFile(join(DATA, 'sleeper-adp.csv'), 'utf8').catch(() => null),
]);

const norm = (s) =>
  s
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z]/g, '');

const ecrByKey = new Map();
for (const r of Object.values(rankings.players)) ecrByKey.set(`${r.position}|${norm(r.name)}`, r);

let rows;
let source;

if (adpCsv) {
  source = 'real Sleeper ADP (data/sleeper-adp.csv)';
  // Real ADP carries current teams too, so byes here are not hostage to a
  // stale players.json.
  rows = adpCsv
    .trim()
    .split('\n')
    .slice(1)
    .map((line) => {
      const [rank, name, pos, team, adp] = line.split(',');
      return { rank: Number(rank), name, pos, team, adp: Number(adp) };
    })
    .map((a) => {
      const e = ecrByKey.get(`${a.pos}|${norm(a.name)}`);
      return e ? { ...a, bye: byes.byes?.[a.team] ?? null, ecr: e.ecr, tier: e.tier } : null;
    })
    .filter(Boolean);
  [...rows].sort((a, b) => a.rank - b.rank).forEach((r, i) => (r.roomRank = i + 1));
} else {
  source = '⚠ search_rank PROXY — see the header comment, this misreads QBs badly';
  rows = Object.entries(rankings.players).map(([id, r]) => ({
    name: r.name,
    pos: r.position,
    team: players[id]?.team ?? '?',
    bye: byes.byes?.[players[id]?.team] ?? null,
    ecr: r.ecr,
    tier: r.tier,
    searchRank: players[id]?.search_rank ?? 9999,
  }));
  [...rows].sort((a, b) => a.searchRank - b.searchRank).forEach((r, i) => (r.roomRank = i + 1));
}

[...rows].sort((a, b) => a.ecr - b.ecr).forEach((r, i) => (r.expertRank = i + 1));
for (const r of rows) r.gap = r.roomRank - r.expertRank;

console.log(`room ordering: ${source}`);
console.log(`matched ${rows.length} players present in both orderings`);

const pad = (s, n) => String(s ?? '-').padEnd(n);
function table(title, list) {
  console.log(`\n=== ${title} ===`);
  console.log(
    '  ' +
      pad('player', 24) +
      pad('pos', 5) +
      pad('bye', 5) +
      pad('expert', 8) +
      pad('room', 7) +
      'gap',
  );
  for (const r of list) {
    console.log(
      '  ' +
        pad(r.name, 24) +
        pad(r.pos, 5) +
        pad(r.bye, 5) +
        pad('#' + r.expertRank, 8) +
        pad('#' + r.roomRank, 7) +
        (r.gap > 0 ? '+' : '') +
        r.gap,
    );
  }
}

table(
  `ROOM UNDERRATES — experts high, room low (targets)`,
  [...rows].sort((a, b) => b.gap - a.gap).slice(0, TOP_N),
);
table(
  `ROOM OVERRATES — room high, experts low (let someone else reach)`,
  [...rows].sort((a, b) => a.gap - b.gap).slice(0, TOP_N),
);

// Positional bias is the durable signal. Individual players move week to week;
// "this format's room drafts QBs three rounds early" holds all draft long.
const byPos = {};
for (const r of rows) (byPos[r.pos] ??= []).push(r.gap);

console.log('\n=== POSITIONAL BIAS (mean rank gap) ===');
console.log('  negative = room drafts them EARLIER than the experts rate them\n');
const means = Object.entries(byPos)
  .map(([pos, gaps]) => [pos, gaps.reduce((a, b) => a + b, 0) / gaps.length, gaps.length])
  .sort((a, b) => a[1] - b[1]);
for (const [pos, mean, n] of means) {
  const bar =
    mean < 0
      ? '<'.repeat(Math.min(30, Math.round(-mean)))
      : '>'.repeat(Math.min(30, Math.round(mean)));
  console.log(
    `  ${pad(pos, 5)}${String(mean.toFixed(1)).padStart(7)}  (n=${String(n).padStart(3)})  ${bar}`,
  );
}

const agree = rows.filter((r) => Math.abs(r.gap) <= 5).length;
console.log(`\n${agree} of ${rows.length} ranked players sit within 5 spots on both lists.`);

// Only relevant on the proxy path — real ADP is scraped fresh from the room and
// carries its own current teams, so the snapshot's age does not affect it.
if (!adpCsv) {
  const meta = await readFile(join(DATA, 'players-meta.json'), 'utf8')
    .then(JSON.parse)
    .catch(() => null);
  if (meta?.generatedAt) {
    const age = Math.round((Date.now() - new Date(meta.generatedAt).getTime()) / 86_400_000);
    if (age > 14) {
      console.log(
        `\n⚠ search_rank comes from a ${age}-day-old snapshot — the room's ordering has moved since.`,
      );
    }
  }
}
