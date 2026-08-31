// Build public/data/tendencies.json — when each owner actually reaches for the
// slot-limited positions, measured from eight seasons of drafts.
//
// This replaces hand-guessed constants in the opponent simulator. Those were
// flat multipliers (QB2 at 0.12, TE2 at 0.18) with no notion of round, so the
// simulator would happily hand a team its second quarterback in round 8. The
// history says that essentially never happens: across 83 owner-seasons, QB2
// went before round 10 exactly twice.
//
// Only the discrete, timing-sensitive slots are modelled. RB and WR depth is
// continuous — teams add bodies all draft long — and a smooth taper handles it
// fine. QB2, TE2 and DEF1 are the ones with a sharp "not yet, not yet, now"
// shape that a constant cannot express.
//
// The output is a CDF per slot: for each round, the fraction of that owner's
// seasons in which the slot had been filled by then. The simulator reads it as
// "how willing is this owner to take this right now".
//
// Run: node scripts/build-tendencies.mjs

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA = join(__dirname, '..', 'public', 'data');
const OUT = join(DATA, 'tendencies.json');

const MAX_ROUND = 15;

// Slots worth modelling: [position, which one]. QB1/TE1 are included because
// knowing when a team takes its STARTER also tells the sim when to stop.
const SLOTS = [
  ['QB', 1],
  ['QB', 2],
  ['TE', 1],
  ['TE', 2],
  ['DEF', 1],
];
const slotKey = (pos, n) => `${pos}${n}`;

// Owners with few seasons get pulled toward the league curve. Four seasons of
// evidence is worth something but not everything, and an owner seen twice
// should not define a spike.
const PRIOR_WEIGHT = 3;

const profiles = JSON.parse(await readFile(join(DATA, 'owner-profiles.json'), 'utf8'));

/** One roster = one owner-season, picks sorted by round. */
const rosters = [];
for (const [name, owner] of Object.entries(profiles.owners ?? {})) {
  for (const [season, picks] of Object.entries(owner.picks ?? {})) {
    const sorted = [...picks].filter((p) => p.pos && p.round).sort((a, b) => a.round - b.round);
    if (sorted.length) rosters.push({ name, season, picks: sorted });
  }
}

if (rosters.length < 20) {
  console.error(`Only ${rosters.length} owner-seasons found — too thin to model. Nothing written.`);
  process.exit(1);
}

/** Round in which this roster took its nth player at a position, or null. */
function roundOfNth(roster, pos, n) {
  let count = 0;
  for (const p of roster.picks) {
    if (p.pos !== pos) continue;
    count++;
    if (count === n) return p.round;
  }
  return null;
}

/**
 * CDF over rounds: fraction of seasons in which the slot was filled by round R.
 * Seasons where it never happened count as "not filled" at every round, which
 * is the honest treatment — a team that skips a backup QB entirely is evidence
 * against taking one, not missing data.
 */
function buildCdf(rosterSet, pos, n) {
  const cdf = new Array(MAX_ROUND + 1).fill(0);
  if (!rosterSet.length) return cdf;

  const rounds = rosterSet.map((r) => roundOfNth(r, pos, n)).filter((x) => x !== null);
  for (let round = 1; round <= MAX_ROUND; round++) {
    cdf[round] = rounds.filter((r) => r <= round).length / rosterSet.length;
  }
  return cdf;
}

const league = {};
for (const [pos, n] of SLOTS) league[slotKey(pos, n)] = buildCdf(rosters, pos, n);

const byOwner = {};
for (const roster of rosters) (byOwner[roster.name] ??= []).push(roster);

const owners = {};
for (const [name, set] of Object.entries(byOwner)) {
  const seasons = set.length;
  const weight = seasons / (seasons + PRIOR_WEIGHT);
  const entry = { seasons, weight: Math.round(weight * 100) / 100, slots: {} };

  for (const [pos, n] of SLOTS) {
    const key = slotKey(pos, n);
    const own = buildCdf(set, pos, n);
    const lg = league[key];
    // Shrink toward the league curve in proportion to how much we have seen.
    entry.slots[key] = own.map(
      (v, i) => Math.round((weight * v + (1 - weight) * lg[i]) * 1000) / 1000,
    );
  }
  owners[name] = entry;
}

await writeFile(
  OUT,
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      seasons: profiles.seasons ?? [],
      ownerSeasons: rosters.length,
      maxRound: MAX_ROUND,
      note: 'CDF per slot: value[round] = fraction of seasons with that slot filled by then. Owner curves are shrunk toward the league curve by seasons/(seasons+3).',
      league,
      owners,
    },
    null,
    2,
  ),
);

console.log(`Wrote ${OUT}`);
console.log(
  `  ${rosters.length} owner-seasons across ${(profiles.seasons ?? []).length} seasons\n`,
);

const pct = (v) => `${String(Math.round(v * 100)).padStart(3)}%`;
console.log('League-wide: share of teams that have filled the slot by round');
console.log(
  '        ' + [4, 6, 8, 9, 10, 11, 12, 13, 14, 15].map((r) => `R${r}`.padStart(5)).join(''),
);
for (const [pos, n] of SLOTS) {
  const key = slotKey(pos, n);
  const row = [4, 6, 8, 9, 10, 11, 12, 13, 14, 15].map((r) => pct(league[key][r]));
  console.log(`  ${key.padEnd(5)} ${row.join('')}`);
}

console.log('\nEarliest and latest owners by slot (blended curves, round where 50% filled):');
for (const [pos, n] of SLOTS) {
  const key = slotKey(pos, n);
  const halfAt = (curve) => {
    for (let r = 1; r <= MAX_ROUND; r++) if (curve[r] >= 0.5) return r;
    return null;
  };
  const rows = Object.entries(owners)
    .map(([name, o]) => ({ name, r: halfAt(o.slots[key]) }))
    .filter((x) => x.r !== null)
    .sort((a, b) => a.r - b.r);
  if (!rows.length) {
    console.log(`  ${key.padEnd(5)} never reaches 50% for anyone`);
    continue;
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  console.log(
    `  ${key.padEnd(5)} earliest ${first.name} R${first.r}   latest ${last.name} R${last.r}`,
  );
}
