# ADR-0001: Adopt the Agentic Dev Environment platform

- **Status:** Accepted
- **Date:** 2026-05-16
- **Deciders:** Jason Tilley
- **Tags:** platform, governance, AI-workflows

## Context and Problem Statement

`draft` is a single-user fantasy football draft assistant. Subscribing to the [Agentic Dev Environment](https://github.com/jaetill/agentic-dev-environment) platform brings the same engineering standards used on sibling projects (game-night-pwa, meal-planner, ai-teacher, jaetill-portal, splendor).

## Decision Drivers

- Consistency with sibling projects
- Single source of truth for AI workflows via the plugin
- Same standards apply (CI, quality gates, ADRs, finding-lifecycle policy)

## Decision Outcome

Adopt the platform via the `ai-team` plugin subscription. Phases 1-4 applied immediately; Phases 5-7 deferred.

### Phase status

| Phase | Status |
|---|---|
| 1 - Documentation | In this PR |
| 2 - AI configuration | In this PR |
| 3 - Quality gates | Follow-up PR (vanilla JS flavor) |
| 4 - CI workflows | Follow-up PR (no Lambda; security-scan skips lambda-audit) |
| 5 - Observability | Deferred — draft is used once per year at the live draft; minimal error surface |
| 6 - IaC retrofit | Not applicable — AWS infra source-of-truth lives in `.aws/` JSON request bodies, sufficient for re-provisioning |
| 7 - User feedback | Not applicable — single-user tool |

## Deviations from platform defaults

### Frontend language: vanilla JS

Same as game-night-pwa / meal-planner. Use the JS-flavored ESLint config.

### Deploy: S3 + CloudFront

Existing `.github/workflows/deploy.yml`. No Lambda, no API Gateway.

### Backend: none

Draft is purely client-side. Sleeper API is called directly from the browser; no auth, no proxy.

### Tests: none yet

Phase 3 will add vitest scaffolding. The `data/` JSON files and pure-function utilities (`src/js/data/*.js`) are the natural first test targets.

### IaC: docs-only via `.aws/`

The `.aws/` directory holds JSON request bodies used to provision AWS resources. Sufficient for the project's complexity; no OpenTofu retrofit needed.

## Consequences

### Positive

- Plugin subagents available immediately
- Same standards inheritance as sibling projects
- Finding-lifecycle (ADR-0016) applies from day one

### Negative

- Phase 3-4 PRs add ~10 dev dependencies for quality gates
- `--legacy-peer-deps` may be needed for Vite + Tailwind peer issues

### Neutral

- The platform plugin source `jaetill/agentic-dev-environment` is public; no auth needed.

## Implementation notes

- `.claude/settings.json` subscribes to `ai-team@agentic-dev-environment` via GitHub source.
- Canonical `permissions.deny` block included.
- Finding-lifecycle policy (ADR-0016) applies: reviewer agents calibrate severity, low/nit findings get `deferred-until-adjacent`, implementer bundles up to 2 adjacent fixes per feature PR.

## Links

- [Workspace ADR-0015 - platform as plugin](https://github.com/jaetill/agentic-dev-environment/blob/main/docs/adr/0015-platform-as-plugin.md)
- [Workspace ADR-0016 - finding lifecycle](https://github.com/jaetill/agentic-dev-environment/blob/main/docs/adr/0016-finding-lifecycle-calibration-deferral.md)