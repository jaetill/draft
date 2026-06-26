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

**Infra source-of-truth:** the JSON request bodies used to provision these resources are checked in under `.aws/` for reference and re-application.

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
    league.json            # League settings (scoring, roster slots) — static config
    rankings_fp.csv        # FantasyPros ECR consensus rankings — manual pre-draft download
    tiers_boris_chen.csv   # Boris Chen tiered rankings — manual pre-draft download
    projections_fp.csv     # FantasyPros season projections (for VBD/L2) — manual pre-draft download
```

Manual CSV refresh on draft morning. No scraping infrastructure. The `data/` files are deployed with the site, served by CloudFront.

## Frontend source map

_TBD when scaffolding starts. Expected shape:_
| File | Purpose |
|---|---|
| `index.html` | Mobile-first single page. |
| `src/main.js` | Entry, init, polling loop. |
| `src/sleeper.js` | All Sleeper API calls + response normalization. |
| `src/rankings.js` | Load + parse FP / Boris Chen / projections CSVs. |
| `src/engine/l1-tier.js` | L1: tier + roster need recommendations. |
| `src/engine/l2-vbd.js` | L2: VBD/VORP (added later). |
| `src/state.js` | Local draft state (my picks, available players, queue). |
| `src/ui/*` | Components — board, recommendations, my roster, on-the-clock view. |

## Deployment

1. Push to `master` triggers GitHub Actions workflow.
2. Workflow assumes `draft-github-deploy` role via OIDC, builds with Vite, syncs `dist/` to S3, invalidates CloudFront.
3. Packages `lambda/feedback.js` and deploys it to `draft-feedback`; publishes a numbered version and updates the `production` alias.

**Gotchas:**

- Pre-draft: manually drop fresh CSVs in `data/` and commit before the deploy. Stale rankings on draft day = bad day.
- CloudFront invalidation must include `/data/*` so updated CSVs aren't served from cache.
- `index.html` should have short cache headers; bundled assets are fingerprinted and can cache aggressively.
- The `production` GitHub environment **must** have a required reviewer set in Settings → Environments → production. Without it, `environment: production` in the workflow is a no-op and every push auto-deploys. Run `.aws/apply-env-required-reviewer.sh` to configure (see `docs/runbooks/deploy.md`).

## Recommendation engine — strategy ladder

| Level      | Logic                                                                                                                                                | When we add it              |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| L1 (start) | Tier-based + roster needs. "Best player in your tier at a position you still need." Simple, robust, defensible.                                      | First.                      |
| L2         | VBD / VORP. Player value = projected points − replacement-level player at that position. Replacement levels for this league: RB30, WR36, TE15, QB12. | Once L1 is stable.          |
| L3         | Positional scarcity dynamics + ADP arbitrage. Detect runs ("5 RBs in last 10 picks → tier cliff coming"); flag fallers below ADP.                    | After L2.                   |
| L4         | Roster construction theories — Hero RB, Zero RB, stacking, bye distribution, late-round upside. Have a thesis pre-draft, not just reactions.         | Last; layered on top of L3. |

**Format-specific tilts already baked into thinking:**

- 2 flex + PPR → WR depth is gold; cliff at WR30-36 is steep in 12-teamers.
- Pass-catching RBs get a tier bump (PPR target premium).
- No kicker → bench is one slot longer; spend it on upside, not insurance.

## Environment variables

| Variable                 | Where it lives                                 | Purpose                                 |
| ------------------------ | ---------------------------------------------- | --------------------------------------- |
| `VITE_SLEEPER_LEAGUE_ID` | `.env.local` (dev), GitHub secret (prod build) | League ID drives all Sleeper API calls. |

## Project-specific guidance for Claude

- **Personal use, runs once a year for ~3 hours.** Don't over-engineer. Cleverness in the engine beats infrastructure in the deploy pipeline.
- **iPad Safari is the floor.** No experimental browser APIs without a fallback.
- **Push Jason up the strategy ladder.** He explicitly asked to be challenged. When L1 is shipping, surface the L2 case and the math behind it.
- **Outside the SSO / Cognito family.** No portal integration, no group authz. If that decision changes, revisit.

## Open items

- **GitHub repo not yet created** — `gh` PAT lacks `repo` scope. Run `gh auth refresh -s repo` then `gh repo create jaetill/draft --private --source . --remote origin --push`.
- **GitHub Actions secret** `AWS_ROLE_ARN` needs to be set to `arn:aws:iam::214599503944:role/draft-github-deploy` once the repo exists. CLI: `gh secret set AWS_ROLE_ARN --body "arn:aws:iam::214599503944:role/draft-github-deploy"`.
- **Sleeper league ID** — provide once league is created; populate `data/league.json` `sleeper_league_id` and re-run `node spike/probe.mjs <LEAGUE_ID>` to capture league-scoped sample shapes.
- **First CSV downloads** (FP rankings, Boris Chen tiers, FP projections) — defer until closer to draft; pre-season data is noisy until ~late August.

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
