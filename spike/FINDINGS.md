# Sleeper API spike — findings

Run `node spike/probe.mjs` (no args) for public endpoints, or `node spike/probe.mjs <LEAGUE_ID>` to also dump league/draft samples.

## Verdict
**Architecture is safe to commit.** Sleeper API is browser-friendly, performant, and has the data we need.

## Confirmed
- **CORS: `access-control-allow-origin: *`** on all endpoints. No proxy needed.
- **No auth required** for any read endpoint.
- **Cloudflare-cached.** `cf-cache-status: HIT` on the players DB; second fetch was 13ms wall-clock.
- **Response shapes match expectation.** `state-nfl.json`, `players-nfl.json` saved as references in `spike/samples/`.

## Surprises / design implications
| Finding | Implication |
|---|---|
| Players DB is **13.7 MB** raw, not ~5 MB | Pre-process at build time to active fantasy-relevant players only (~3000 records). Strip irrelevant fields. Ship as `data/players.json` with the deploy, refresh weekly. |
| **11,805 total records, 2,958 active QB/RB/WR/TE/DEF** | Filter aggressively. Don't ship retired players to the iPad over draft-venue wifi. |
| `search_rank` field exists per player | Sleeper's own ranking — useful as a tiebreaker or fallback when FP/Boris Chen don't have a player. |
| `/state/nfl` shows `season_start_date: null` in off-season | Pre-season player news will still flow but no live data. Spike from preseason will be artificially quiet. |

## Endpoints used in production
| Endpoint | Cadence | Purpose |
|---|---|---|
| `GET /v1/players/nfl` | Once at site build (or weekly), not per-load | Master player DB. Pre-process to small JSON. |
| `GET /v1/state/nfl` | Once at app load | Confirm season/week. |
| `GET /v1/league/{id}` | Once at app load | League scoring, settings. |
| `GET /v1/league/{id}/drafts` | Once at app load | Find active draft ID. |
| `GET /v1/draft/{id}` | Once at app load | Slot order, status. |
| `GET /v1/draft/{id}/picks` | **Every 10s during draft** | Live pick stream. |

## Not yet tested
League/draft endpoints — need a real Sleeper league ID. Re-run probe with the ID once Jason creates the league.
