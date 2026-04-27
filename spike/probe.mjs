// Sleeper API probe — verifies endpoint shapes the live draft assistant will consume.
// Run: node spike/probe.mjs [LEAGUE_ID]
// LEAGUE_ID is optional — without it, only public endpoints are probed.

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES = join(__dirname, 'samples');
await mkdir(SAMPLES, { recursive: true });

const BASE = 'https://api.sleeper.app/v1';
const leagueId = process.argv[2];

async function probe(label, url, file) {
  const t0 = Date.now();
  const res = await fetch(url);
  const ms = Date.now() - t0;
  const cors = res.headers.get('access-control-allow-origin');
  const body = await res.json();
  await writeFile(join(SAMPLES, file), JSON.stringify(body, null, 2));
  const size = JSON.stringify(body).length;
  const summary = Array.isArray(body)
    ? `array len=${body.length}`
    : typeof body === 'object' && body !== null
      ? `object keys=${Object.keys(body).slice(0, 6).join(',')}${Object.keys(body).length > 6 ? ',...' : ''}`
      : typeof body;
  console.log(
    `${label.padEnd(28)} ${String(res.status).padEnd(4)} ${String(ms + 'ms').padEnd(8)} ${(size / 1024).toFixed(1).padStart(7)} KB  CORS=${cors}  ${summary}`
  );
}

console.log('Endpoint                     HTTP  ms       size       CORS       shape');
console.log('-'.repeat(110));

await probe('GET /state/nfl', `${BASE}/state/nfl`, 'state-nfl.json');

// Players DB is ~5 MB — saved once, used as the master player list.
await probe('GET /players/nfl', `${BASE}/players/nfl`, 'players-nfl.json');

if (leagueId) {
  await probe(
    `GET /league/${leagueId}`,
    `${BASE}/league/${leagueId}`,
    'league.json'
  );
  await probe(
    `GET /league/${leagueId}/users`,
    `${BASE}/league/${leagueId}/users`,
    'league-users.json'
  );
  await probe(
    `GET /league/${leagueId}/drafts`,
    `${BASE}/league/${leagueId}/drafts`,
    'league-drafts.json'
  );

  const draftsRes = await fetch(`${BASE}/league/${leagueId}/drafts`);
  const drafts = await draftsRes.json();
  const draftId = drafts[0]?.draft_id;
  if (draftId) {
    await probe(`GET /draft/${draftId}`, `${BASE}/draft/${draftId}`, 'draft.json');
    await probe(
      `GET /draft/${draftId}/picks`,
      `${BASE}/draft/${draftId}/picks`,
      'draft-picks.json'
    );
  }
} else {
  console.log('\n(no LEAGUE_ID provided — skipped league-scoped endpoints)');
}

console.log(`\nSamples written to: ${SAMPLES}`);
