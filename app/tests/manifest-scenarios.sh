#!/usr/bin/env bash
# Scenario-based validation of TEST_MANIFEST.md.
# Verifies the cross-layer manifest maps Rust → E2E tags, shared infrastructure,
# agent sources, and E2E spec files correctly.
#
# Usage: ./tests/manifest-scenarios.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="$SCRIPT_DIR/TEST_MANIFEST.md"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

PASS_COUNT=0
FAIL_COUNT=0

pass() {
  echo -e "  ${GREEN}PASS${RESET} $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo -e "  ${RED}FAIL${RESET} $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

# Check that the manifest file exists
if [[ ! -f "$MANIFEST" ]]; then
  echo -e "${RED}FATAL: Manifest not found at $MANIFEST${RESET}"
  exit 1
fi

# Assert that a source file's manifest row contains an expected value
assert_row_contains() {
  local desc="$1" source_file="$2" expected="$3"
  local row
  row=$(grep -F "$source_file" "$MANIFEST" || true)
  if [[ -z "$row" ]]; then
    fail "$desc (source '$source_file' not in manifest)"
    return
  fi
  if echo "$row" | grep -qF "$expected"; then
    pass "$desc"
  else
    fail "$desc (row for '$source_file' missing '$expected')"
  fi
}

# Assert that a pattern exists anywhere in the manifest
assert_in_manifest() {
  local desc="$1" pattern="$2"
  if grep -qF "$pattern" "$MANIFEST"; then
    pass "$desc"
  else
    fail "$desc (pattern not found: '$pattern')"
  fi
}

echo ""
echo "============================================"
echo " Manifest Scenario Validation"
echo "============================================"
echo ""

# ===== Shared Infrastructure =====

echo -e "${CYAN}${BOLD}━━━ Shared Infrastructure ━━━${RESET}"
assert_in_manifest  "tauri.ts in shared infrastructure"     "src/lib/tauri.ts"
assert_in_manifest  "tauri mock in shared infrastructure"   "src/test/mocks/tauri.ts"
assert_in_manifest  "e2e mock in shared infrastructure"     "src/test/mocks/tauri-e2e.ts"
assert_in_manifest  "e2e event mock in shared infra"        "src/test/mocks/tauri-e2e-event.ts"
assert_in_manifest  "full suite instruction present"        "run the full test suite"

# ===== Rust → E2E Tags =====

echo ""
echo -e "${CYAN}${BOLD}━━━ Rust → E2E Tags ━━━${RESET}"
assert_row_contains "workflow.rs → cargo filter"    "commands/workflow.rs"    "commands::workflow"
assert_row_contains "workflow.rs → E2E tag"         "commands/workflow.rs"    "@workflow"
assert_row_contains "workspace.rs → cargo filter"   "commands/workspace.rs"   "commands::workspace"
assert_row_contains "workspace.rs → E2E tag"        "commands/workspace.rs"   "@dashboard"
assert_row_contains "skill.rs → cargo filter"       "commands/skill.rs"       "commands::skill"
assert_row_contains "skill.rs → E2E tag"            "commands/skill.rs"       "@dashboard"
assert_row_contains "files.rs → cargo filter"       "commands/files.rs"       "commands::files"
assert_row_contains "files.rs → E2E tag"            "commands/files.rs"       "@workflow"
assert_row_contains "settings.rs → cargo filter"    "commands/settings.rs"    "commands::settings"
assert_row_contains "settings.rs → E2E tag"         "commands/settings.rs"    "@settings"
assert_row_contains "sidecar.rs → cargo filter"     "agents/sidecar.rs"       "agents::sidecar"
assert_row_contains "sidecar.rs → E2E tag"          "agents/sidecar.rs"       "@workflow-agent"
assert_row_contains "sidecar_pool.rs → cargo filter" "agents/sidecar_pool.rs" "agents::sidecar_pool"
assert_row_contains "sidecar_pool.rs → E2E tag"     "agents/sidecar_pool.rs"  "@workflow-agent"
assert_row_contains "github_push.rs → cargo filter" "commands/github_push.rs" "commands::github_push"
assert_row_contains "github_push.rs → E2E tag"      "commands/github_push.rs" "@dashboard"
assert_row_contains "reconciliation.rs → E2E tag"   "reconciliation.rs"       "@dashboard"
assert_row_contains "db.rs → cargo filter"          "db.rs"                   "db"

# ===== Agents =====

echo ""
echo -e "${CYAN}${BOLD}━━━ Agents ━━━${RESET}"
assert_row_contains "agents/*.md → structural tests"               "agents/*.md"                      "test:agents:structural"
assert_row_contains "agents/*.md → Promptfoo smoke evals"          "agents/*.md"                      "test:agents:smoke"
assert_row_contains "agent-sources CLAUDE.md → structural tests"   "agent-sources/workspace/CLAUDE.md" "test:agents:structural"

# ===== E2E Spec Files =====

echo ""
echo -e "${CYAN}${BOLD}━━━ E2E Spec Files ━━━${RESET}"
assert_in_manifest  "dashboard spec listed"           "dashboard.spec.ts"
assert_in_manifest  "dashboard-states spec listed"    "dashboard-states.spec.ts"
assert_in_manifest  "skill-crud spec listed"          "skill-crud.spec.ts"
assert_in_manifest  "settings spec listed"            "settings.spec.ts"
assert_in_manifest  "workflow-agent spec listed"      "workflow-agent.spec.ts"
assert_in_manifest  "navigation spec listed"          "navigation.spec.ts"

# ===== Summary =====

echo ""
echo "--------------------------------------------"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All $TOTAL manifest scenarios passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL_COUNT/$TOTAL manifest scenarios failed.${RESET}"
  exit 1
fi
