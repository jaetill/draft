#!/usr/bin/env bash
# Apply GitHub production environment required reviewer.
# Without this, `environment: production` in deploy.yml is a no-op — any push deploys immediately.
# Requires a repo-admin token: gh auth refresh -s repo,admin:repo_hook
# See docs/runbooks/deploy.md for context.
set -euo pipefail

REPO="jaetill/draft"
ENV="production"
REVIEWER="jaetill"

echo "Fetching GitHub user ID for '${REVIEWER}'..."
USER_ID=$(gh api "users/${REVIEWER}" --jq .id)
echo "  user ID: ${USER_ID}"

echo "Setting required reviewer on '${ENV}' environment..."
gh api --method PUT "repos/${REPO}/environments/${ENV}" \
  --input - <<EOF
{
  "reviewers": [{"type": "User", "id": ${USER_ID}}],
  "prevent_self_review": false
}
EOF

echo "Done. Verify at: https://github.com/${REPO}/settings/environments"
echo "IMPORTANT: also confirm 'Allow administrators to bypass' is unchecked in the UI."
