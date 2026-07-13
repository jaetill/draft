## Dependency Watch (2026-07-13)

---

### `package.json` (root)

#### Security Advisories
_None. `npm audit --omit=dev` returned 0 vulnerabilities (564 total deps, 7 prod)._

#### Outdated Packages

| Package | Installed | Wanted | Latest | Change type |
|---|---|---|---|---|
| `@sentry/browser` | < 10.65.0 | 10.65.0 | 10.65.0 | Minor/patch — batch in monthly sweep |

No major version bumps. No action required before draft day.

---

### `lambda/package.json`

#### Security Advisories

**Moderate — `@opentelemetry/core` unbounded memory allocation (GHSA-8988-4f7v-96qf)**

- CVSS 5.3 (AV:N/AC:L/PR:N/UI:N — network-reachable, no auth required, DoS)
- Affects W3C Baggage propagation; a malicious request can cause unbounded memory growth.
- Root cause: `@opentelemetry/core <2.8.0` pulled in transitively by `@sentry/aws-serverless@9.x`.
- **Fix:** upgrade `@sentry/aws-serverless` to `^10.65.0` (major bump — see Breaking Changes section below).
- 18 affected nodes; all are downstream of the same root cause package.

_No HIGH or CRITICAL advisories._

#### Major Version Bumps

| Package | Installed | Latest | Risk |
|---|---|---|---|
| `@sentry/aws-serverless` | 9.47.1 | **10.65.0** | Major bump required to resolve the moderate OpenTelemetry advisory above. Review Sentry v10 migration guide before upgrading; API surface changes are expected. |
| `@octokit/rest` | 21.1.1 | **22.0.1** | Major bump, no known security issue. Review Octokit v22 changelog for any breaking changes to `issues.create` (the only method used in `lambda/feedback.js`). |

#### Minor / Patch Updates (low priority — batch in monthly sweep)

| Package | Installed | Wanted | Latest |
|---|---|---|---|
| `@aws-sdk/client-secrets-manager` | < 3.1085.0 | 3.1085.0 | 3.1085.0 |

---

### Summary

| Severity | Count | Action |
|---|---|---|
| CRITICAL / HIGH security | 0 | — |
| Moderate security | 1 advisory (18 affected nodes) | Upgrade `@sentry/aws-serverless` 9→10 in `lambda/`; validates fix for GHSA-8988-4f7v-96qf |
| Major version available | 2 | `@sentry/aws-serverless` (fix-linked), `@octokit/rest` (low urgency) |
| Minor / patch available | 2 | Batch in monthly sweep |

The moderate OpenTelemetry advisory is the only security finding. The fix requires a major version upgrade to `@sentry/aws-serverless`. The Lambda is invoked only on `POST /feedback` (not on the hot draft path), but the vulnerability is network-reachable so the upgrade is recommended before draft day.
