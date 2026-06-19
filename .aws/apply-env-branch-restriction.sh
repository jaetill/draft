#!/usr/bin/env bash
# Apply GitHub production environment branch restriction to master only.
# Requires a repo-admin token: gh auth refresh -s repo,admin:repo_hook
# See docs/runbooks/deploy.md for context.
set -euo pipefail

REPO="jaetill/draft"
ENV="production"
BRANCH="master"

echo "Enabling custom branch policies on '${ENV}' environment..."
gh api --method PUT "repos/${REPO}/environments/${ENV}" \
  -F "deployment_branch_policy[protected_branches]=false" \
  -F "deployment_branch_policy[custom_branch_policies]=true"

echo "Adding '${BRANCH}' branch pattern..."
gh api --method POST "repos/${REPO}/environments/${ENV}/deployment-branch-policies" \
  -f name="${BRANCH}"

echo "Done. Verify at: https://github.com/${REPO}/settings/environments"
