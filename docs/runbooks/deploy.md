# Deploy

Draft is a static SPA hosted at `draft.jaetill.com` on S3 + CloudFront. Auto-deploys via `.github/workflows/deploy.yml` on push to `master`.

## Two-stage deploy (ADR-0043 phase 2)

Every push to `master` runs two jobs:

1. **test** (ungated) — builds Vite, uploads source maps to Sentry, syncs `dist/` to `s3://jaetill-draft/preview/`, and deploys Lambda code to `$LATEST`.
2. **promote** (gated — requires `jaetill` approval in the `production` environment) — syncs `dist/` to `s3://jaetill-draft/` (root), invalidates CloudFront, and publishes a numbered Lambda version pointed to by the `production` alias.

### Production environment branch restriction (security requirement)

The `production` GitHub environment **must** have its Deployment branches setting restricted to `master` only. Without this, a contributor with write access could open a workflow on any branch that declares `environment: production` and — if a reviewer approves — assume the `draft-github-deploy` IAM role from a non-`master` branch.

**Required configuration:**

```
Settings → Environments → production → Deployment branches → Selected branches → master
```

To apply via CLI (requires repo admin token):

```sh
# 1. Enable custom branch policies
gh api --method PUT repos/jaetill/draft/environments/production \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"

# 2. Add master branch pattern
gh api --method POST repos/jaetill/draft/environments/production/deployment-branch-policies \
  -f name=master
```

See `.aws/apply-env-branch-restriction.sh` for the ready-to-run script.

Approving the latest queued run supersedes any earlier waiting runs (GitHub environment behaviour). Reject stale runs in bulk when approving a newer deploy.

## Manual deploy

```sh
npm install
npm run build

aws s3 sync dist/ s3://jaetill-draft/ --delete
aws cloudfront create-invalidation --distribution-id E29VATR5EV095C --paths "/index.html"
```

## Rollback

```sh
git revert <bad-sha>
git push origin master
```

CloudFront caches invalidate within ~30 seconds. SPA fallback (403/404 → /index.html) handles route changes.
