#!/usr/bin/env bash
# Apply GitHub production environment required reviewer.
# Without this, `environment: production` in deploy.yml is a no-op — any push deploys immediately.
# Requires a repo-admin token: gh auth refresh -s repo,admin:repo_hook
# See docs/runbooks/deploy.md for context.
#
# The PUT endpoint replaces the full environment record — omitting either
# reviewers or deployment_branch_policy resets that field to null, silently
# undoing the other script's control. Both fields are included here so this
# script is safe to re-run in any order relative to apply-env-branch-restriction.sh.
set -euo pipefail

REPO="jaetill/draft"
ENV="production"
REVIEWER="jaetill"
BRANCH="master"

echo "Fetching GitHub user ID for '${REVIEWER}'..."
USER_ID=$(gh api "users/${REVIEWER}" --jq .id)
echo "  user ID: ${USER_ID}"

echo "Setting required reviewer and branch restriction on '${ENV}' environment..."
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
POST_OUT=$(gh api --method POST "repos/${REPO}/environments/${ENV}/deployment-branch-policies" \
  -f name="${BRANCH}" 2>&1) \
  && echo "  branch pattern registered" \
  || { echo "$POST_OUT" | grep -qi "already exists\|already_exists" \
       && echo "  (already exists — verify at the URL below)" \
       || { echo "ERROR: branch pattern POST failed: $POST_OUT"; exit 1; }; }

echo "Done. Verify at: https://github.com/${REPO}/settings/environments"
echo "IMPORTANT: also confirm 'Allow administrators to bypass' is unchecked in the UI."
