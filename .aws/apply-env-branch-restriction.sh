#!/usr/bin/env bash
# Apply GitHub production environment branch restriction to master only.
# Requires a repo-admin token: gh auth refresh -s repo,admin:repo_hook
# See docs/runbooks/deploy.md for context.
#
# The PUT endpoint replaces the full environment record — omitting either
# reviewers or deployment_branch_policy resets that field to null, silently
# undoing the other script's control. Both fields are included here so this
# script is safe to re-run in any order relative to apply-env-required-reviewer.sh.
set -euo pipefail

REPO="jaetill/draft"
ENV="production"
BRANCH="master"
REVIEWER="jaetill"

echo "Fetching GitHub user ID for '${REVIEWER}'..."
USER_ID=$(gh api "users/${REVIEWER}" --jq .id)
echo "  user ID: ${USER_ID}"

echo "Enabling custom branch policies and required reviewer on '${ENV}' environment..."
gh api --method PUT "repos/${REPO}/environments/${ENV}" \
  --input - <<EOF
{
  "reviewers": [{"type": "User", "id": ${USER_ID}}],
  "prevent_self_review": false,
  "deployment_branch_policy": {
    "protected_branches": false,
    "custom_branch_policies": true
  }
}
EOF

echo "Adding '${BRANCH}' branch pattern (skipped if already present)..."
gh api --method POST "repos/${REPO}/environments/${ENV}/deployment-branch-policies" \
  -f name="${BRANCH}" 2>/dev/null || echo "  (already exists — verify at the URL below)"

echo "Done. Verify at: https://github.com/${REPO}/settings/environments"
