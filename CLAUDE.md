# draft — CLAUDE.md

## What it does

Live fantasy football draft assistant for Jason's redraft league. Polls the Sleeper API during the draft, tracks roster state, and surfaces pick recommendations in real time. Single-user, personal use, no auth, no sharing. Designed to run on iPad or laptop in a browser at the draft venue.

## League configuration (static — lives in `data/league.json`)

| Setting      | Value                                        |
| ------------ | -------------------------------------------- |
| Format       | Redraft                                      |
| Teams        | 12                                           |
| Scoring      | PPR                                          |
| Roster       | QB, RB×2, WR×2, TE, FLEX×2, DEF — 9 starters |
| Bench        | 6                                            |
| Total roster | 15                                           |
| No kicker    | Yes (one extra bench slot for upside)        |

## Tech stack & hosting

| Layer           | Technology                                                              | Notes                                                                  |
| --------------- | ----------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Frontend        | Vite + vanilla JS (or lightweight framework — TBD when we start coding) | Mobile-first; must work in iPad Safari.                                |
| Backend         | None (for draft data)                                                   | Static site. Browser calls Sleeper API directly.                       |
| Feedback Lambda | AWS Lambda (Node.js 22.x) + API Gateway HTTP                            | `POST /feedback` → files a GitHub Issue. Source: `lambda/feedback.js`. |
| Auth            | None                                                                    | Sleeper read API is public; draft IDs are not sensitive.               |
| Storage         | S3 (static assets only)                                                 | No user data persisted. Draft state is ephemeral, comes from Sleeper.  |
| Hosting         | S3 + CloudFront                                                         | At `draft.jaetill.com`.                                                |
| Deploy          | GitHub Actions (OIDC)                                                   | Same pattern as meal-planner / carto.                                  |

## AWS resources

| Resource                | ID / ARN                                                                              | Region    | Notes                                                                                                             |
| ----------------------- | ------------------------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------- |
| S3 Bucket               | `jaetill-draft`                                                                       | us-east-2 | Public access blocked; CloudFront OAC only.                                                                       |
| CloudFront Distribution | `E29VATR5EV095C` (`d2nlqjswb9m35y.cloudfront.net`)                                    | global    | Origin: S3 via OAC `E3NDD0LFUQNJ8J`. CNAME: draft.jaetill.com. SPA fallback: 403/404 → /index.html.               |
| ACM Certificate         | `arn:aws:acm:us-east-1:214599503944:certificate/ac71c7d9-5a8a-4597-a08c-f1b6bf7d58eb` | us-east-1 | For draft.jaetill.com. DNS-validated.                                                                             |
| OIDC Deploy Role        | `arn:aws:iam::214599503944:role/draft-github-deploy`                                  | global    | Trust scoped to `repo:jaetill/draft:ref:refs/heads/master`.                                                       |
| Route 53 Records        | A + AAAA alias `draft.jaetill.com` → CloudFront                                       | global    | Hosted zone `Z0736006XR97Z1TWPWN7` (jaetill.com). CloudFront alias zone Z2FDTNDATAQYW2.                           |
| Lambda Function         | `arn:aws:lambda:us-east-2:214599503944:function:draft-feedback` (alias: `production`) | us-east-2 | Node.js 22.x. `POST /feedback` — files GitHub Issues via Secrets Manager token. Exec role: `draft-feedback-role`. |
| API Gateway (HTTP)      | `draft-feedback-api` (endpoint: Terraform output `feedback_api_url`)                  | us-east-2 | HTTP API v2. Route: `POST /feedback`. CORS: `draft.jaetill.com` + `localhost:5173`.                               |

No Cognito. Sleeper draft data is read directly from the browser; Lambda handles only the feedback endpoint.

**Infra source-of-truth:**

- S3, CloudFront, ACM, OIDC role, Route 53 — JSON request bodies are checked in under `.aws/` for reference and re-application.
- Lambda and API Gateway — managed by Terraform; source is `terraform/envs/prod/`.

## External APIs

| Endpoint                                                   | Purpose                            | Polling                        |
| ---------------------------------------------------------- | ---------------------------------- | ------------------------------ |
| `GET https://api.sleeper.app/v1/league/{league_id}`        | League metadata, scoring settings  | Once at load                   |
| `GET https://api.sleeper.app/v1/league/{league_id}/drafts` | Find active draft for the league   | Once at load                   |
| `GET https://api.sleeper.app/v1/draft/{draft_id}`          | Draft metadata, slot order, status | Once at load                   |
| `GET https://api.sleeper.app/v1/draft/{draft_id}/picks`    | All picks made so far              | Poll every ~10s during draft   |
| `GET https://api.sleeper.app/v1/players/nfl`               | Full NFL player database (~5 MB)   | Once at load, cache in browser |

**CORS verification needed before draft day.** Sleeper API is designed for community tools and almost certainly returns permissive CORS headers, but confirm with a quick fetch before relying on it.

## S3 data layout

```
jaetill-draft/
  index.html
  assets/                  # Vite-built JS/CSS bundles
  data/
    league.json            # League settings, my draft slot, replacement levels — hand-maintained
    players.json           # Trimmed Sleeper player DB — built by scripts/build-players.mjs
    players-meta.json      # Snapshot provenance (generatedAt, count) — same script
    rankings.json          # Expert consensus ranks + tiers — built by scripts/build-rankings.mjs
    byes.json              # Team → bye week — built by scripts/build-byes.mjs (optional)
    sleeper-adp.csv        # Live draft-room adp_ppr — scraped from the Sleeper room
    ffc-adp.csv            # FantasyFootballCalculator ADP — 7,986 PPR drafts
    tiers.json             # Positional tiers — built by scripts/build-tiers.mjs
    owner-profiles.json    # Per-owner draft archetypes — built by scripts/build-owner-profiles.mjs
```

All four generated files are committed, and all four rebuild on `npm run build`
via `prebuild`. Committing them is deliberate: a network failure on draft morning
then degrades to slightly stale data instead of no data.

`npm run refresh-data` rebuilds players, rankings, and byes, then regenerates
`draft-board.csv` — the one command to run before draft day.

## Rankings data source

**Boris Chen consensus tiers** (`fftiers`), full-PPR overall board, fetched from a
static S3 CSV. No auth, no JS, no rate limit — which is why it beat FantasyPros
here. FantasyPros' rankings tables are client-rendered and gated behind a paid
plan; a draft-morning dependency on a scraper or a paid API key is a dependency
that fails at the worst possible time.

What each row gives us: consensus rank (`Avg.Rank`), a tier break, and the expert
spread (`Best`/`Worst`/`Std.Dev`). The spread is the underrated field — it is a
direct read on how much the experts disagree about a player, i.e. risk.

**The trap:** the in-season weekly file lives at a nearly identical URL, covers
~40 players, and is ranked for a single week. `validateDraftShape()` in
`build-rankings.mjs` hard-fails on it (it carries a `Matchup` column). Do not
relax that check.

**Coverage:** ~200 ranked players against a 180-pick draft. Players outside the
consensus board fall in behind every ranked player, ordered by `search_rank`.

**Two tier concepts, deliberately distinct** — conflating them is a live bug risk:

| Accessor              | Meaning                  | Use for                              |
| --------------------- | ------------------------ | ------------------------------------ |
| `rankings.tier(p)`    | overall draft-board tier | board display, cross-position value  |
| `rankings.posTier(p)` | within-position tier     | "is he an elite TE?" — roster theses |

The Anchor TE thesis checks `posTier`. Under overall tiers even the best TE sits
around tier 3, so an overall-tier check there silently never fires.

## Bye weeks

Sleeper leaves `bye_week` **null on every record** in `/players/nfl`, so byes come
from a separate file and are joined on `team` at load time. That split is
deliberate: `build-players.mjs` regenerates `players.json` wholesale, so anything
stamped onto it would be lost on the next refresh.

`build-byes.mjs` derives byes from `api.sleeper.app/schedule/nfl/regular/{season}`
— a flat array of `{status, date, home, away, week}` — by finding the week in 4-14
where each team has no game. It falls back to a hand-entered
`scripts/byes-manual.json` (32 team → week entries), and takes an optional path
argument to parse a saved schedule offline.

**Canceled fixtures must be filtered.** The 2026 feed ships a `status: "canceled"`
DAL-SEA in week 6 alongside the real one. Counting a canceled game as played would
hide a genuine bye.

Missing bye data is **not** a build failure — it exits 0 and the app says "no bye
data" in its status line. Bad bye data _is_ a failure: the validator rejects
partial maps and out-of-range weeks, because a plausible-but-wrong bye map is
worse than none.

**2026 byes** (verified: 32 teams, exactly one bye each; weeks 4 and 12 have none):

| Week | Teams           | Week | Teams                 |
| ---- | --------------- | ---- | --------------------- |
| 5    | CAR KC          | 10   | CHI DEN PHI TB        |
| 6    | CIN DET MIA MIN | 11   | ATL CLE GB LAR NE SEA |
| 7    | BUF JAX LAC WAS | 13   | BAL IND LV NYJ        |
| 8    | HOU NO NYG SF   | 14   | ARI DAL               |
| 9    | PIT TEN         |      |                       |

**Draft-relevant concentration.** Week 6 holds 6 of the top 24 (Chase, Gibbs,
St. Brown, Jefferson, Chase Brown, Achane) and week 11 holds 4 of the top 11
(Nacua, Bijan, JSN, London). At slot 12 you pick back-to-back at 12/13, 36/37 —
the easiest way to wreck a season from the turn is to take two elite players who
share a bye.

**The analysis model matters more than the data.** Naive collision warnings
("two players share a bye") fire on every roster and train you to ignore them.
`src/byes.js` instead measures **byeCost** — unfilled starting slots in a week,
_minus_ the slots you couldn't fill anyway. Two consequences:

- One unfilled slot is `stream`, not a warning. Everyone streams a DEF or QB on
  a bye; a roster with one DEF is short on that DEF's bye by definition.
- Subtracting the baseline means it reads the same in round 3 as on a full
  roster. Without it, an incomplete roster looks like a bye catastrophe.

`byeImpact()` has no before/after delta, deliberately — adding a player never
reduces availability in any week, so a delta could never fire. It asks the only
coherent question: with him rostered, is this week a hole?

## Roster strategy — how Jason actually manages in-season

`league.json → roster_strategy` encodes management behaviour that changes what a
**drafted** player is worth. Without it the engine assumes textbook roster
construction, which is wrong for this manager in three specific ways:

| Setting                          | Behaviour                                                                                                                                                                                                                                                                                     |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `flex_te_discount: 0.9`          | A mild preference for an RB/WR blend in flex. Not a gate — a TE that clearly out-projects the alternative still wins                                                                                                                                                                          |
| `max_flex_te: 1`                 | At most one TE valued into flex at a time. The per-player merit comparison is right for the FIRST TE past the starter but has no memory — without the cap the engine built a three-TE starting lineup (Bowers + McBride + Loveland). TEs past the cap are valued as bench (`backup_te_value`) |
| `backup_qb_value: 0.05`          | He does not bench a healthy starter — a drafted QB2 sits fourteen weeks to start once                                                                                                                                                                                                         |
| `backup_te_value: 0.05`          | Same reasoning at TE                                                                                                                                                                                                                                                                          |
| `streams_bye_replacements: true` | Byes are covered by dropping the worst player for a one-week fill-in, so a collision costs **waiver moves**, not a forfeited lineup. Warning threshold rises and the wording says "needs N waiver moves"                                                                                      |
| `streams_def: true`              | DEF is replaced weekly against the worst offence; the drafted DEF is a placeholder, so take the last one                                                                                                                                                                                      |

**These are deliberately NOT applied to opponents.** The tendency data is
unambiguous that other owners draft backup quarterbacks — 83% of owner-seasons
take a QB2 — so projecting his preferences onto the simulation would make it
worse, not better. `benchValueFor()` and `flexEligibleFor()` read his config;
`draft-sim.js` reads the league's measured history.

Effect at his pick 85 (roster TE/QB/RB/WR/WR/WR/RB):

| default model                 | his model                           |
| ----------------------------- | ----------------------------------- |
| Sam LaPorta TE **32** (flex)  | Josh Downs WR **20** (flex)         |
| Travis Kelce TE **28** (flex) | Wan'Dale Robinson WR **16** (flex)  |
| Josh Downs WR 20              | Sam LaPorta TE **2** (bench, ×0.05) |

**The zero-VBD tie collapse (fixed, and worth remembering).** `vbd = max(0, …)`
floors at zero by mid-draft, so `score = vbd × mult` was 0 for everyone and the
need multiplier — the term that encodes "you can actually start this player" —
stopped separating candidates. The ECR tiebreak then surfaced whoever experts
rank best in a vacuum: a fifth TE (mult 0.02) beat a startable RB filling an
open starter slot (mult 1.4). This was the root cause of "too many TE/QB
suggestions after my starters are filled." The sort now breaks ties on mult
before ECR, and a sub-1-point noise floor stops 23 VBD × 0.02 = 0.46 from
"beating" a real zero. The `worthwhile` display filter changed with it: it
tests `score > 0`, not `vbd > 0` — bench TEs hold positive positional VBD deep
into the draft, so the old test kept exactly the wrong players.

**The TE flex rule is a comparison, not a gate.** A tight end takes the flex slot
if his projected scoring matches the RB or WR he is competing against for it —
which is exactly what `flexReplacementPoints()` already measures. Two earlier
versions tried a quality gate (first a blanket "never flex a TE", then a tier
cut) and both were wrong the same way: they hard-block a TE who would win the
comparison on points.

`flex_te_discount` only breaks near-ties toward a skill-position blend. At 0.9 a
TE still ranks above a receiver he clearly out-projects; set it to 1.0 for pure
point comparison.

For reference, where each TE rank lands against the receiver worth the same:

|            |            |            |             |
| ---------- | ---------- | ---------- | ----------- |
| TE1 ≈ WR6  | TE2 ≈ WR15 | TE3 ≈ WR19 | TE4 ≈ WR23  |
| TE5 ≈ WR28 | TE6 ≈ WR31 | TE8 ≈ WR35 | TE12 ≈ WR42 |

Bench receivers late run about WR30-45, so the comparison naturally turns over
around TE5-6 without needing a rule to say so.

**Known tension:** under this rule the engine will sometimes surface a mid TE
(LaPorta, Kelce) whose season points beat the available receivers. That is the
rule working as specified. If it proves wrong in practice the cause is weekly TE
variance — real, but invisible to season totals, and it would take game-level
data to model.

## Slot-aware VBD — the flex baseline

**A player's value depends on the slot he'd occupy, so the baseline has to too.**

Positional replacement is the right baseline only when a positional starter slot
is open. Once your TE slot is filled, a second tight end can only reach the
lineup through flex — where he competes against every available RB and WR, not
against TE15. Scoring him against TE15 credits him for positional scarcity he has
no way to cash in.

`flexReplacementPoints()` computes the real baseline: merge every flex-eligible
position into one pool and read off the first player past the last starting slot
in the league — `teams × (RB + WR + TE + FLEX)` = 84 here. That lands on **RB31,
≈153 pts**.

**Why a constant multiplier cannot express this.** The old `te_flex_penalty: 0.5`
(and a later `BENCH_VALUE.TE: 0.35`) were flat ratios. The real effect is a flat
_subtraction_ of ~21 points, because TE15 (132) sits below the flex line (153):

|      | as starter | as flex | implied ratio |
| ---- | ---------- | ------- | ------------- |
| TE2  | +95        | +74     | 0.78          |
| TE5  | +61        | +40     | 0.66          |
| TE12 | +23        | +2      | 0.09          |

A single ratio over-punishes the elite TE and under-punishes the replacement-level
one — exactly backwards. The correction also runs the other way for receivers:
WR36 (173) sits _above_ the flex line, so positional VBD was **understating**
flex-bound WRs by ~20 points.

`rationale()` prints `+28 vs flex` rather than `+28 VBD` when the flex baseline
was used, because the same number means different things against different
baselines.

**On blocking (drafting to deny an opponent):** not worth it as a strategy. The
cost is certain and yours — you took a worse player. The benefit is diffuse: you
rarely know who'd have taken him, a comparable player usually remains, and
weakening one of eleven opponents only helps in the one or two weeks you play
them. It _is_ a legitimate tiebreaker when two players are within noise of each
other, which is where `owners.js` archetype profiles could earn their keep.

## Opponent draft timing (tendencies.json)

`build-tendencies.mjs` measures **when each owner actually reaches for the
slot-limited positions**, from 83 owner-seasons across 2018-2025. It replaces
hand-guessed constants in the simulator with a CDF per slot per owner, shrunk
toward the league curve by `seasons/(seasons+3)`.

**League-wide, share of teams with the slot filled by round:**

| slot | R8  | R9  | R10 | R11 | R12 | R13 | R14 | R15 |
| ---- | --- | --- | --- | --- | --- | --- | --- | --- |
| QB2  | 1%  | 2%  | 16% | 34% | 43% | 59% | 72% | 83% |
| DEF1 | 1%  | 20% | 25% | 34% | 40% | 51% | 72% | 99% |
| TE2  | 2%  | 4%  | 10% | 17% | 35% | 54% | 67% | 72% |

**It is an owner trait, not a league rate**, which is the most predictive thing
in the data. Bruno2328 has taken a defense in round 9 in five of eight seasons;
Tilleydmt has never taken one before round 14. QB2: Bruno2328 in every season by
R11, ForSkins25 in only two of eight.

**Three bugs this exposed, all in the simulator:**

1. **Opponents drafted by `search_rank`** — the same popularity index that made
   the market-gap analysis wrong about QBs. Result: seven quarterbacks in 22
   picks of a one-QB league, while Travis Kelce went undrafted. Now uses ECR.
2. **No deadline pressure.** A CDF describes when something happened; it cannot
   produce a _forced_ pick. Nobody drafts a defense because it is valuable —
   they draft it because the slot is empty and the draft is ending.
   `urgencyFactor()` counts required-but-unfilled slots against picks remaining.
3. **Defenses were unreachable.** `available()` sorts by `search_rank` and every
   DEF carries 9999, so in a 1,000-player pool they sat dead last and never
   entered the 50-candidate window — no matter how urgent the empty slot got.
   The pool is now consensus-ordered, and required-but-unfilled positions are
   guaranteed candidates.

This matters beyond realism: **lookahead runs entirely on this simulation**, so
every "if you wait" and two-pick total was computed against a board where
opponents hoarded quarterbacks and never took a defense.

Simulated vs. actual after the fixes — QB1/QB2/TE2 land close, DEF1 is ~1 round
early and still misses ~1 team in 6:

| slot | simulated                | actual            |
| ---- | ------------------------ | ----------------- |
| QB1  | median R7                | median R6         |
| QB2  | median R13               | median R12        |
| DEF1 | median R12, 60/72 filled | median R13, 82/83 |
| TE2  | median R13               | median R13        |

## Opponent personas in a mock

`watch-draft.mjs` seats your leaguemates around a mock table so the engine runs
the same opponent-modelling path it will run live. `owner-profiles.json` maps
**real 2026 slots** to owners, and a mock puts you in an arbitrary chair — so the
chart is rotated by `(mockSlot − realSlot)`. That keeps ordering intact and puts
you back in your own seat, meaning whoever picks immediately before you in the
mock is whoever picks immediately before you on draft day (CarstonT). Disable
with `--no-personas`.

**What this buys and what it does not.** Mock drafters are strangers and
autopickers; they will not behave like your friends. This exercises the code path
and makes the output look like draft day. It does not make the predictions true.

**Archetype coverage is sparse, and that is a real finding**, not a bug: only 5 of
12 owners earn a primary archetype from eight seasons of history. Most people
simply do not draft consistently enough to be labelled. Team affinity carries more
of the signal — `RockNRollDr (LAR 2.3x)` means he has taken Rams at 2.3× the base
rate. For the record, your own profile reads **RobustRB**.

## Positional tiers (the S/A/B/C method)

Rankings answer "who is better," which is almost never the question at the table.
Tiers answer "where is the cliff." If six players remain in the RB bucket and one
remains in the WR bucket, you take the WR even though the RB is ranked higher —
the WR bucket won't survive to your next pick and the RB bucket will.

**Tiers are NOT found by hunting gaps in ADP.** That was the first implementation
and it was wrong. ADP is an average over thousands of drafts, so it is smooth by
construction and real cliffs get averaged away — gap-hunting put Ja'Marr Chase and
Derrick Henry in the same bucket.

The correct model, and the one Boris Chen uses: **two players share a tier when
the market cannot reliably tell them apart.** That is a question about the
_spread_ of opinion, not the mean. Each player carries an uncertainty (expert std
dev, falling back to cross-source disagreement); a cliff is where consecutive
players' plausible-rank ranges stop overlapping, tested in quadrature at 1σ.

Two consequences worth understanding before "fixing" a tier that looks odd:

- Elite players have tight spreads and separate into **small** tiers. Mid-round
  players have huge spreads and merge into **big** ones. A 27-man RB tier 8 is not
  a bug — it is the honest answer that nobody knows who RB50 is.
- Comparison is against the tier's **anchor**, not the previous player. Chained
  pairwise comparison (A≈B, B≈C, C≈D) lets a tier drift forty picks wide with no
  two ends resembling each other.

**Sources — three, and the build refuses to run on fewer than two ADP feeds:**

| Source            | What it is                                            | Known bias                                                    |
| ----------------- | ----------------------------------------------------- | ------------------------------------------------------------- |
| `sleeper-adp.csv` | live draft-room `adp_ppr`, scraped 27 Aug             | your actual room; small sample; Sleeper's own board nudges it |
| `ffc-adp.csv`     | fantasyfootballcalculator, 7,986 PPR drafts 20–27 Aug | big sample, but the generic public, not your league           |
| `rankings.json`   | Boris Chen expert consensus + std dev                 | what _should_ happen, not what does; disagrees hard on DEF/TE |

`build-tiers.mjs` exits non-zero rather than tier from one source — a confidently
drawn wrong cliff is worse than no cliff.

**The live half** is `tierState()` / `tierSignals()` in `src/tiers.js`: how many
players remain in the best available tier per position, and whether that tier
survives until your next pick. At slot 12 you wait 22 picks between turns, so
"will this tier survive 22 picks" is the only question you ever ask — and a ranked
list cannot answer it. Signals fire only at a genuine cliff; flagging everything
flags nothing.

## Historical stats — what they are and aren't good for

**Do not build tiers or rankings from past fantasy points.** It's the obvious
idea and it fails three ways at once:

- **Rookies have no history**, and the draftable pool is full of them. Imputing
  their value requires consensus rankings, which makes the model circular.
- **Year-over-year production correlates weakly**, worst at RB — injury,
  workload change and touchdown regression dominate.
- **Situation changes break it.** Production doesn't transfer to a new offence
  at the same rate.

Underneath all three: ECR and ADP are _made by people who read those stats_.
History isn't new signal, it's a lagging noisier subset of what's already priced.
Ranking on it re-derives a worse ADP.

**What history is uniquely good for is the shape of a position, not the identity
of the players in it.** `build-value-curve.mjs` answers "what does the RB12 score
in a season?" — which never asks _which_ player will be RB12. Rookies don't break
it. Trades don't break it. That feeds `projection()` and, through it, VBD and
replacement levels — replacing the modelled exponential that was the weakest
input in the engine.

The script refuses to write from a single season (one season's injuries and
scoring environment are not structural) and weights recent years 3/2/1.
`rankings.meta.projectionSource` reports `measured (2025, 2024, 2023)` or
`modelled exponential` so you always know which is live.

**Coverage is measured against players that should have counted**, not against
everyone in the stats feed. Sleeper returns every player who recorded anything —
LB, DB, DE, K, DT, CB — and excluding those is correct, not data loss. An earlier
version put them in the denominator, reported 29–59% "coverage" on a healthy run,
and triggered a bias investigation into a problem that did not exist. The real
figure is 95% per season.

**Still open, both minor:**

- **32 unknown player ids per season, the same count every year.** 5% of eligible,
  and suspiciously equal to the number of NFL teams. DEF resolves fine and the DEF
  curve is populated, so it isn't team defenses going missing — but the constancy
  is unexplained and worth a look if DEF values ever seem off.
- **Per-player volatility.** A player's own year-to-year variance is a genuinely
  different signal from expert std dev — outcome noise vs. analyst disagreement —
  and blending both would sharpen tier boundaries. Rookies lack it, so it can only
  ever be a partial input.

## Frontend source map

| File                                     | Purpose                                                  |
| ---------------------------------------- | -------------------------------------------------------- |
| `index.html`                             | Mobile-first single page.                                |
| `src/main.js`                            | Entry, data load, event wiring, render loop.             |
| `src/sleeper.js` / `src/sleeper-live.js` | Sleeper API calls + live draft polling.                  |
| `src/engine/postfilter.js`               | Diversity cap + worthwhile filter, shared web/CLI.       |
| `src/rankings.js`                        | Rankings model — consensus mode + synthetic fallback.    |
| `src/rankings.test.js`                   | Covers the consensus/synthetic split and tier semantics. |
| `src/state.js`                           | Draft state (picks, availability, roster needs).         |
| `src/engine/l1.js`                       | L1: tier + roster need.                                  |
| `src/engine/l2.js`                       | L2: VBD with flex/position bias.                         |
| `src/engine/l3.js`                       | L3: position runs + ADP fallers (always-on signals).     |
| `src/engine/l4.js`                       | L4: roster-construction theses.                          |
| `src/engine/lookahead.js`                | What's likely still there at my next pick.               |
| `src/engine/recommend.js`                | Composes L1–L4 into the final list.                      |
| `src/owners.js`                          | Opponent archetype bias from owner-profiles.json.        |
| `src/mock/draft-sim.js`                  | Simulates opponents for practice mode.                   |
| `src/ui.js`                              | All render functions (pure; main.js wires events).       |
| `src/feedback.js` / `src/sentry.js`      | Feedback form + error reporting.                         |

## Web ↔ CLI parity

The web app and `watch-draft.mjs` render the same engine through the same
presentation logic — `recommend()`, `postfilter.js` (max 2 per position, 6
total, score-based worthwhile filter), `projectToMyTurn()`, `rotatePersonas()`,
and `suppressedPositions()` are all shared imports. If the two surfaces ever
disagree on the same board, that is a bug, not a difference of opinion.

What the web app does between your turns (same as the CLI): simulates the
opponents forward to your next pick and shows a **projected board** — labeled
as such — plus the tier-depth table, gated cliff signals, and "picking before
you" owner anticipation. The projection is seeded by pick count so it is stable
across re-renders and refreshes exactly when the real board changes.

Live-mode specifics, all in service of draft day on an iPad:

- **Draft id input** (controls card): paste the last path segment of any
  Sleeper room URL to attach directly — the only way to rehearse against a
  MOCK, which has no league to resolve. Empty falls back to league → draft.
- **The draft is the authority on shape.** `SleeperLive.init()` overrides
  teams/rounds/totalPicks from the draft object (a 10-team mock would otherwise
  break `isMyTurn` math) and takes your seat from `draft_order` when it knows
  your user id. Mismatch warnings still render, because VBD replacement levels
  stay league-tuned. A room whose size differs from the 12-slot owner chart
  gets NO personas rather than wrong ones.
- **Poll cadence:** picks every 4s while drafting; draft metadata only on a
  pick change or every 4th poll (the CLI's meta-throttling pattern).
- **Screen wake lock** is acquired in live mode and re-acquired on
  visibilitychange (iPad Safari 16.4+). Still true that iPad Safari suspends
  background tabs — at the draft, run Split View, not tab-switching.

## Deployment

1. Push to `master` triggers GitHub Actions workflow.
2. Workflow assumes `draft-github-deploy` role via OIDC, builds with Vite, syncs `dist/` to S3, invalidates CloudFront.
3. Packages `lambda/feedback.js` and deploys it to `draft-feedback`; publishes a numbered version and updates the `production` alias.

**Gotchas:**

- Pre-draft: run `npm run refresh-data` and commit the regenerated `data/` files before the deploy. Stale rankings on draft day = bad day.
- CloudFront invalidation must include `/data/*` so updated data isn't served from cache.
- `index.html` should have short cache headers; bundled assets are fingerprinted and can cache aggressively.
- The `production` GitHub environment **must** have a required reviewer set in Settings → Environments → production. Without it, `environment: production` in the workflow is a no-op and every push auto-deploys. Run `.aws/apply-env-required-reviewer.sh` to configure (see `docs/runbooks/deploy.md`).

## Recommendation engine — strategy ladder

| Level | Logic                                                                                                                                                | When we add it                 |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| L1    | Tier-based + roster needs. "Best player in your tier at a position you still need." Simple, robust, defensible.                                      | ✅ shipped                     |
| L2    | VBD / VORP. Player value = projected points − replacement-level player at that position. Replacement levels for this league: RB30, WR36, TE15, QB12. | ✅ shipped — the default       |
| L3    | Positional scarcity dynamics + ADP arbitrage. Detect runs ("5 RBs in last 10 picks → tier cliff coming"); flag fallers below ADP.                    | ✅ shipped — always-on signals |
| L4    | Roster construction theories — Hero RB, Zero RB, Robust RB, Late-Round QB, Anchor TE. Have a thesis pre-draft, not just reactions.                   | ✅ shipped — selectable        |

**Format-specific tilts — now measured rather than assumed.**

The 2026 value curve (3 seasons, 95% coverage) revises the old "WR depth is gold,
cliff at WR30-36 is steep" note. It was half right, and the wrong half mattered:

| Position | #12 | #24 | #36 | drop 12→36 |
| -------- | --- | --- | --- | ---------- |
| RB       | 242 | 186 | 130 | **−112**   |
| WR       | 234 | 204 | 173 | −61        |

**RB falls almost twice as fast as WR.** The WR cliff isn't steep — WR is the
flattest position on the board. So:

- **WR depth is gold in the sense that it stays _usable_ late** — WR36 still
  scores 173. It is NOT true that elite WRs hold a big edge over late ones.
- **RB is where the scarcity actually lives.** RB1 is worth 240 over replacement;
  the drop from RB12 to RB30 is 87 points. Taking RBs early and filling WR from
  the flat middle is what the curve supports. This argues _against_ Zero RB in
  this specific format.
- Pass-catching RBs still get a tier bump (PPR target premium).
- No kicker → bench is one slot longer; spend it on upside, not insurance.

**VBD over replacement, top of each position:**

|     | RB1 | WR1 | TE1 | QB1 | DEF1 |
| --- | --- | --- | --- | --- | ---- |
| VBD | 240 | 216 | 153 | 117 | 55   |

Two things fall out. **Elite TE is real** — Bowers/McBride carry 153 over
replacement, which is why they land top-10 overall on VBD. And **the entire QB
position is worth 117**, less than one elite RB, which is the late-round-QB case
in a single number. Spending a round-2 pick on Allen to bank 117 costs you an RB
worth 240.

Note the measured replacement cutoffs in `league.json` (RB30/WR36/TE15/QB12) land
sensibly against real league-wide starter demand — roughly 34 RB and 37 WR once
flex is allocated. They don't need changing.

## Environment variables

| Variable                 | Where it lives                                 | Purpose                                 |
| ------------------------ | ---------------------------------------------- | --------------------------------------- |
| `VITE_SLEEPER_LEAGUE_ID` | `.env.local` (dev), GitHub secret (prod build) | League ID drives all Sleeper API calls. |

## Project-specific guidance for Claude

- **Personal use, runs once a year for ~3 hours.** Don't over-engineer. Cleverness in the engine beats infrastructure in the deploy pipeline.
- **iPad Safari is the floor.** No experimental browser APIs without a fallback.
- **Push Jason up the strategy ladder.** He explicitly asked to be challenged. When L1 is shipping, surface the L2 case and the math behind it.
- **Outside the SSO / Cognito family.** No portal integration, no group authz. If that decision changes, revisit.

## Draft day

**2026 draft: Sunday 6 Sep, 15:00 ET.** Snake, 15 rounds, 120s pick timer.
`jaetill` drew **slot 12** — the turn. Verified against the Sleeper API 27 Aug.

| Slot | Owner               | Slot | Owner       |
| ---- | ------------------- | ---- | ----------- |
| 1    | till1025            | 7    | RockNRollDr |
| 2    | Bruno2328           | 8    | cfadden     |
| 3    | NuttySequel         | 9    | SethYo      |
| 4    | ForSkins25          | 10   | wfadden     |
| 5    | Tilleydmt (commish) | 11   | CarstonT    |
| 6    | PaTilley            | 12   | **jaetill** |

**Seating charts do not carry over between seasons.** Sleeper reshuffles
`draft_order`, and 8 of these 12 seats differ from 2025. `build-owner-profiles.mjs`
now reads the _current_ draft's order rather than inheriting the last completed
season's — it previously did the latter, which pointed every opponent model at
the wrong person. The output records `slotSource` so a stale chart is visible.

Slot 12 changes how to read the board: back-to-back picks at 12/13, 36/37, 60/61
mean you can let a tier ride knowing you get two bites — but you eat the full gap
between turns, so tier cliffs matter more than ADP value. Re-verify the slot
before draft day; commissioners can reshuffle `draft_order` until the draft starts.

## Open items

- **Refresh data close to the draft.** `npm run refresh-data`, then commit and deploy. Rankings move a lot through the final preseason week.
- **`players.json` regenerated 29 Aug** (1,014 players) — refresh once more with `refresh-data` on draft morning. The stale-snapshot failure modes, for the record:
  - _Missing players._ Veterans who were free agents at snapshot time aren't in the file at all (Sleeper drops players with no team). `build-rankings.mjs` reports these as unmatched, so they're visible.
  - _Wrong byes._ `byes.json` joins on `team`. A player who changed teams since the snapshot keeps his old team, so the join **succeeds against the wrong team** and yields a plausible, valid-looking, incorrect bye week. Nothing catches this — which is why `players-meta.json` exists and why `export-board` and the app both warn past 14 days.
- **Sleeper league settings worth a commissioner sanity-check.** The league object still carries `draft_rounds: 3` and `max_keepers: 1`. Both look vestigial — the _draft_ object correctly says 15 rounds, and `keeper_deadline` is 0 with no keepers designated — so this is a confirm, not a blocker.
- **Projections are still modelled, not real.** VBD uses an exponential points curve evaluated at the consensus position rank. The _ordering_ is now real; the point totals are not. Real projections would need a paid FantasyPros plan or an equivalent free source.
- **Engine test coverage is thin.** `rankings.js` is covered; L1–L4, lookahead, and state are not.

## Workspace impact

- Workspace `CLAUDE.md` "Adding a New App" checklist is missing the bootstrap-perms step. The `jaetill-dev` user needed `s3:CreateBucket`, ACM, and CloudFront-Create perms to provision a new app from CLI. Added managed policy `jaetill-dev-app-bootstrap` to fix; the next app will have it automatically. Worth folding back into the workspace checklist.
- `jaetill-dev-s3` managed policy updated to v3 to include `jaetill-draft` bucket (per checklist item 7).

---

## Platform inheritance

This project adopts the [Agentic Dev Environment](https://github.com/jaetill/agentic-dev-environment) platform per [ADR-0001](docs/adr/0001-platform-adoption.md). Project-specific deviations are documented in ADR-0001.

### AI configuration

The platform's subagents, slash commands, and hooks are delivered via the `ai-team` plugin subscription (per workspace ADR-0015). `.claude/settings.json` retains only the plugin subscription, the permissions block, and the marketplace pointer.

### Finding lifecycle (per workspace ADR-0016)

Reviewer agents calibrate severity, low/nit findings get `deferred-until-adjacent`, Sentry/critical issues auto-trigger the implementer.
