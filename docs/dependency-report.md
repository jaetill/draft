## Dependency Watch (2026-06-22)

### `package.json` (root — `draft` frontend)

#### Security advisories
None. `npm audit --omit=dev` reports 0 vulnerabilities across 7 production dependencies.

#### Major version bumps available
None.

#### Minor / patch bumps available (low priority — batch in monthly sweep)
| Package | Installed | Latest | Notes |
|---|---|---|---|
| `@sentry/browser` | ~10.53.1 | 10.59.0 | Same major; within `^10.53.1` range. Update is safe. |

---

### `lambda/package.json` (`draft-lambdas` Lambda function)

#### Security advisories
**Moderate — 18 vulnerabilities, all rooted in `@opentelemetry/core < 2.8.0`**

Advisory: [GHSA-8988-4f7v-96qf](https://github.com/advisories/GHSA-8988-4f7v-96qf) — *Unbounded memory allocation in W3C Baggage propagation*
- CVSS 5.3 (AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:L) — network-reachable DoS vector
- `@opentelemetry/core` is a transitive dependency pulled in by `@sentry/aws-serverless@9.x`
- Fix: upgrade `@sentry/aws-serverless` to `10.59.0` (semver **major** bump — see notes below)

Affected transitive packages (all resolved by the same fix):
`@opentelemetry/core`, `@opentelemetry/instrumentation-aws-sdk`, `@opentelemetry/instrumentation-amqplib`, `@opentelemetry/instrumentation-connect`, `@opentelemetry/instrumentation-express`, `@opentelemetry/instrumentation-fs`, `@opentelemetry/instrumentation-hapi`, `@opentelemetry/instrumentation-http`, `@opentelemetry/instrumentation-koa`, `@opentelemetry/instrumentation-mongoose`, `@opentelemetry/instrumentation-mysql2`, `@opentelemetry/instrumentation-pg`, `@opentelemetry/instrumentation-undici`, `@opentelemetry/resources`, `@opentelemetry/sdk-trace-base`, `@opentelemetry/sql-common`, `@sentry/node`, `@sentry/aws-serverless`

**Recommended action:** Pin `@sentry/aws-serverless` to `^10.59.0` in `lambda/package.json` and run `npm install --prefix lambda`. Review [Sentry v9 → v10 migration guide](https://docs.sentry.io/platforms/javascript/migration/v9-to-v10/) for breaking changes before deploying. Since the Lambda is simple (single feedback endpoint), the migration risk is low but should be confirmed.

> Note: severity is **moderate**, not critical/high. The DoS vector requires crafted W3C Baggage headers reaching the Lambda — low-probability for this use case (feedback endpoint, not a high-traffic path). Still advisable to resolve before the draft-day window.

#### Major version bumps available
| Package | Pinned range | Currently resolves to | Latest | Risk |
|---|---|---|---|---|
| `@sentry/aws-serverless` | `^9.0.0` | 9.47.1 | **10.59.0** | Major — also the security fix. See above. |
| `@octokit/rest` | `^21.0.0` | 21.1.1 | **22.0.1** | Major — review [v22 changelog](https://github.com/octokit/rest.js/releases) for breaking API changes before upgrading. |

#### Minor / patch bumps available (low priority — batch in monthly sweep)
| Package | Installed | Latest | Notes |
|---|---|---|---|
| `@aws-sdk/client-secrets-manager` | ~3.750.0 | 3.1073.0 | Within same AWS SDK v3 major; safe to bump. |

---

### Summary

| Manifest | Critical | High | Moderate | Major bumps | Minor/patch |
|---|---|---|---|---|---|
| `package.json` (root) | 0 | 0 | 0 | 0 | 1 |
| `lambda/package.json` | 0 | 0 | 18 | 2 | 1 |

**Priority action:** Upgrade `@sentry/aws-serverless` from `^9.0.0` → `^10.59.0` in `lambda/package.json` to resolve all 18 moderate advisories. Review breaking changes, then deploy. `@octokit/rest` v22 upgrade can follow independently.
