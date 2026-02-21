#!/usr/bin/env bash
# setup-branch-protection-skills.sh
#
# Applies branch protection rules to the hbanerjee74/skills GitHub repository
# (the Skill Builder marketplace repo) on the master branch.
#
# Rules applied:
#   - Require 1 PR approval before merging
#   - Enforce rules for admins (no bypass)
#   - Block direct pushes to master
#   - Block force pushes
#   - Block branch deletion
#   - No required status checks (repo has no CI)
#
# Prerequisites:
#   - GitHub CLI (gh) installed and authenticated
#   - Caller must have admin access to hbanerjee74/skills
#
# Usage:
#   ./scripts/setup-branch-protection-skills.sh

set -euo pipefail

REPO="hbanerjee74/skills"
BRANCH="master"

echo "Applying branch protection rules to ${REPO}/${BRANCH}..."

echo '{
  "required_status_checks": null,
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false
}' | gh api "repos/${REPO}/branches/${BRANCH}/protection" --method PUT --input -

echo "Branch protection rules applied successfully to ${REPO}/${BRANCH}."
echo ""
echo "Active rules:"
gh api "repos/${REPO}/branches/${BRANCH}/protection" \
  --jq '{
    enforce_admins: .enforce_admins.enabled,
    force_pushes_blocked: (.allow_force_pushes.enabled | not),
    deletions_blocked: (.allow_deletions.enabled | not),
    required_reviews: .required_pull_request_reviews.required_approving_review_count
  }'
