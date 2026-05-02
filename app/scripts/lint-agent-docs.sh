#!/usr/bin/env bash

set -euo pipefail

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

check_paths=(
  "AGENTS.md"
  "CLAUDE.md"
  ".claude/rules"
)

if [[ -d ".claude/skills" ]]; then
  check_paths+=(".claude/skills")
fi

legacy_patterns=(
  "linear-server:"
  "feature-dev:"
  "AskUserQuestion"
  "subagent_type:"
)

failed=0

search_legacy_pattern() {
  local pattern="$1"

  if command -v rg >/dev/null 2>&1; then
    rg -n --glob '*.md' "$pattern" "${check_paths[@]}"
    return $?
  fi

  grep -RIn --include='*.md' -e "$pattern" "${check_paths[@]}"
}

for pattern in "${legacy_patterns[@]}"; do
  if search_legacy_pattern "$pattern"; then
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
