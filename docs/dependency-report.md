## Dependency Watch (2026-06-29)

---

### `package.json` (root — frontend)

#### Security Advisories
None. `npm audit --omit=dev` returned 0 vulnerabilities across 7 production dependencies.

#### Major Version Bumps
None.

#### Minor / Patch Updates (low priority — batch in monthly sweep)

| Package | Current | Latest | Notes |
|---|---|---|---|
| `@sentry/browser` | 10.53.1 | 10.62.0 | Patch release series; no breaking changes expected. |

---

### `lambda/package.json` (Lambda — feedback endpoint)

#### Security Advisories

**MODERATE — action required before next Lambda deploy**

| Advisory | Package | CVSS | Installed | Fix |
|---|---|---|---|---|
| [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) | `@opentelemetry/core` (transitive via `@sentry/aws-serverless`) | 5.3 | < 2.8.0 | Upgrade `@sentry/aws-serverless` → 10.62.0 |

**Details:** Unbounded memory allocation when parsing crafted W3C Baggage headers (`baggage` propagation). An attacker sending a POST to `/feedback` with a specially crafted `baggage` header could cause memory exhaustion in the Lambda container. Risk is real but bounded by Lambda's 128 MB default memory limit and short execution window.

**Fix path:** The only available fix is a **major-version upgrade** of the direct dependency:

```
cd lambda && npm install @sentry/aws-serverless@^10.62.0
```

This resolves all 18 flagged vulnerabilities in the audit report (they are all downstream of the same `@opentelemetry/core` root cause).

> ⚠️ `isSemVerMajor: true` — review Sentry v10 migration guide before upgrading. Sentry 8→9 changed serverless init patterns; 9→10 may require similar attention in `lambda/feedback.js`.

#### Major Version Bumps

| Package | Installed (range) | Latest | Risk |
|---|---|---|---|
| `@sentry/aws-serverless` | `^9.0.0` (9.47.1 installed) | 10.62.0 | **Also the security fix above.** Review breaking changes. |
| `@octokit/rest` | `^21.0.0` (21.1.1 installed) | 22.0.1 | `@octokit/rest` v22 may drop CommonJS support or change auth / endpoint interfaces. Audit `lambda/feedback.js` usage before upgrading. |

#### Minor / Patch Updates (low priority — batch in monthly sweep)

| Package | Installed (range) | Latest | Notes |
|---|---|---|---|
| `@aws-sdk/client-secrets-manager` | `^3.750.0` | 3.1075.0 | Large patch-series jump within `^3.x`; AWS SDK v3 is additive-only within major. Safe to `npm update`. |

---

### Summary

| Severity | Count | Location |
|---|---|---|
| CRITICAL / HIGH | 0 | — |
| MODERATE (security) | 1 root cause → 18 transitive | `lambda/` |
| Major version bump | 2 | `lambda/` |
| Minor / patch | 2 | root + `lambda/` |

**Recommended action:** Upgrade `@sentry/aws-serverless` to `^10.62.0` in `lambda/` — this resolves the moderate advisory and pulls in the latest SDK. Treat the `@octokit/rest` 21→22 major bump as a separate PR after reviewing breaking changes. Remaining items can wait for the next monthly sweep.
