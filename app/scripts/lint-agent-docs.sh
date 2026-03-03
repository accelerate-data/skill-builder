#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

check_paths=(
  "AGENTS.md"
  "CLAUDE.md"
  ".claude/rules"
  ".claude/skills"
)

legacy_patterns=(
  "linear-server:"
  "feature-dev:"
  "AskUserQuestion"
  "subagent_type:"
)

failed=0

for pattern in "${legacy_patterns[@]}"; do
  if rg -n --glob '*.md' "$pattern" "${check_paths[@]}"; then
    echo ""
    echo "Found forbidden legacy token: $pattern"
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo ""
  echo "Instruction docs lint failed."
  exit 1
fi

echo "Instruction docs lint passed."
