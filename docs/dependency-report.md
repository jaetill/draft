## Dependency Watch (2026-07-06)

---

### `package.json` (root — frontend)

**Audit:** 0 vulnerabilities in production dependencies.

#### Minor/patch updates (low priority — batch in monthly sweep)

| Package | Current | Wanted | Latest | Notes |
|---|---|---|---|---|
| `@sentry/browser` | 10.53.1 | 10.63.0 | 10.63.0 | Same major; minor feature/fix releases. |

---

### `lambda/package.json` (Lambda function)

**Audit:** 18 moderate vulnerabilities (all rooted in `@opentelemetry/core < 2.8.0`, transitive via `@sentry/aws-serverless@9.x`).

#### Moderate security advisory — fix requires major version bump

| Advisory | GHSA-8988-4f7v-96qf |
|---|---|
| Package | `@opentelemetry/core` (transitive, via `@sentry/aws-serverless`) |
| Severity | **Moderate** (CVSS 5.3) |
| CWE | CWE-770 — Unbounded memory allocation in W3C Baggage propagation |
| Affected range | `< 2.8.0` |
| Fix | Upgrade `@sentry/aws-serverless` from `^9.0.0` → `^10.0.0` (major bump; `10.63.0` resolves the advisory) |
| Breaking change risk | Yes — Sentry v9→v10 is a major release; review [Sentry migration guide](https://docs.sentry.io/platforms/javascript/migration/) before upgrading |

> **Recommendation:** The vulnerability is moderate (network-reachable DoS via crafted Baggage headers, no data exposure). Not critical for the Lambda's use case (it only receives `POST /feedback` from the frontend, not arbitrary external traffic), but should be resolved before the next draft season. Pair the upgrade with `@octokit/rest` v22 work below.

#### Major version bumps available (note — review breaking changes)

| Package | Installed (range) | Latest in range | Latest available | Breaking change risk |
|---|---|---|---|---|
| `@sentry/aws-serverless` | `^9.0.0` (9.47.1) | 9.47.1 | 10.63.0 | High — v10 is a major Sentry SDK rewrite; also required to fix the moderate advisory above |
| `@octokit/rest` | `^21.0.0` (21.1.1) | 21.1.1 | 22.0.1 | Medium — review Octokit v22 changelog for API changes to `issues.create` |

#### Minor/patch updates (low priority — batch in monthly sweep)

| Package | Installed (range) | Wanted | Latest | Notes |
|---|---|---|---|---|
| `@aws-sdk/client-secrets-manager` | `^3.750.0` | 3.1079.0 | 3.1079.0 | AWS SDK v3 minor; backward-compatible. Large jump in patch numbers is normal for AWS SDK's weekly releases. |

---

### Summary

| Severity | Count | Action |
|---|---|---|
| Critical/High security | 0 | — |
| Moderate security | 18 (all same root cause) | Fix via `@sentry/aws-serverless` v10 major bump; not urgent for this use case |
| Major version bumps | 2 | Review before next draft season (`@sentry/aws-serverless`, `@octokit/rest`) |
| Minor/patch updates | 3 | Batch in monthly sweep |
