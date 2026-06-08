## Dependency Watch (2026-06-08)

### Security Audit Summary

No production security vulnerabilities detected in any manifest.

---

### `package.json` (root)

#### No Security Advisories

#### Minor / Patch Updates (low priority — batch in monthly sweep)

| Package | Installed (range) | Wanted | Latest |
|---|---|---|---|
| `@sentry/browser` | `^10.53.1` | `10.56.0` | `10.56.0` |

Bump is within the current `^10` major — no breaking changes expected.

---

### `lambda/package.json`

#### No Security Advisories

#### Major Version Bumps Available (note: breaking-change risk)

| Package | Range in manifest | Latest in range | Latest overall | Notes |
|---|---|---|---|---|
| `@octokit/rest` | `^21.0.0` | `21.1.1` | `22.0.1` | v22 drops Node 18 support and renames several endpoint methods — review changelog before upgrading. |
| `@sentry/aws-serverless` | `^9.0.0` | `9.47.1` | `10.56.0` | Sentry SDK v10 overhauls transport layer and drops some v9 config keys — coordinate with root `@sentry/browser` upgrade (also v10 already). |

#### Minor / Patch Updates (low priority — batch in monthly sweep)

| Package | Installed (range) | Wanted | Latest |
|---|---|---|---|
| `@aws-sdk/client-secrets-manager` | `^3.750.0` | `3.1063.0` | `3.1063.0` |

AWS SDK v3 minor bumps are typically additive — no breaking changes expected.

---

### Action Items

| Priority | Item |
|---|---|
| Monthly sweep | Root: bump `@sentry/browser` to `^10.56.0` |
| Monthly sweep | Lambda: bump `@aws-sdk/client-secrets-manager` to `^3.1063.0` |
| Before next lambda deploy | Lambda: evaluate `@octokit/rest` v22 — check for renamed methods used in handler code |
| Before next lambda deploy | Lambda: upgrade `@sentry/aws-serverless` to `^10` — align with root Sentry major; review transport config changes |
