#!/usr/bin/env bash
# Scenario-based validation of TEST_MAP.md.
# Verifies the cross-layer test map records Rust → E2E tags, shared infrastructure,
# agent sources, and E2E spec files correctly.
#
# Usage: ./tests/test-map-scenarios.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_MAP="$SCRIPT_DIR/../../TEST_MAP.md"

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

# Check that the test map file exists
if [[ ! -f "$TEST_MAP" ]]; then
  echo -e "${RED}FATAL: Test map not found at $TEST_MAP${RESET}"
  exit 1
fi

# Assert that a source file's test-map row contains an expected value
assert_row_contains() {
  local desc="$1" source_file="$2" expected="$3"
  local row
  row=$(grep -F "$source_file" "$TEST_MAP" || true)
  if [[ -z "$row" ]]; then
    fail "$desc (source '$source_file' not in test map)"
    return
  fi
  if echo "$row" | grep -qF "$expected"; then
    pass "$desc"
  else
    fail "$desc (row for '$source_file' missing '$expected')"
  fi
}

# Assert that a pattern exists anywhere in the test map
assert_in_test_map() {
  local desc="$1" pattern="$2"
  if grep -qF "$pattern" "$TEST_MAP"; then
    pass "$desc"
  else
    fail "$desc (pattern not found: '$pattern')"
  fi
}

echo ""
echo "============================================"
echo " Test Map Scenario Validation"
echo "============================================"
echo ""

# ===== Shared Infrastructure =====

echo -e "${CYAN}${BOLD}━━━ Shared Infrastructure ━━━${RESET}"
assert_in_test_map  "tauri.ts in shared infrastructure"     "app/src/lib/tauri.ts"
assert_in_test_map  "tauri mock in shared infrastructure"   "app/src/test/mocks/tauri.ts"
assert_in_test_map  "e2e mock in shared infrastructure"     "app/src/test/mocks/tauri-e2e.ts"
assert_in_test_map  "e2e event mock in shared infra"        "app/src/test/mocks/tauri-e2e-event.ts"
assert_in_test_map  "full suite command present"            "cd app && bash tests/run.sh"

# ===== Rust → E2E Tags =====

echo ""
echo -e "${CYAN}${BOLD}━━━ Rust → E2E Tags ━━━${RESET}"
assert_row_contains "workflow mod → cargo filter"   "commands/workflow/mod.rs" "commands::workflow"
assert_row_contains "workflow mod → E2E tag"        "commands/workflow/mod.rs" "@workflow"
assert_row_contains "workspace.rs → cargo filter"   "commands/workspace.rs"   "commands::workspace"
assert_row_contains "workspace.rs → E2E tag"        "commands/workspace.rs"   "@dashboard"
assert_row_contains "skill mod → cargo filter"      "commands/skill/mod.rs"   "commands::skill"
assert_row_contains "skill mod → E2E tag"           "commands/skill/mod.rs"   "@dashboard"
assert_row_contains "files.rs → cargo filter"       "commands/files.rs"       "commands::files"
assert_row_contains "files.rs → E2E tag"            "commands/files.rs"       "@workflow"
assert_row_contains "settings.rs → cargo filter"    "commands/settings.rs"    "commands::settings"
assert_row_contains "settings.rs → E2E tag"         "commands/settings.rs"    "@settings"
assert_row_contains "runtime_config.rs → cargo filter" "agents/runtime_config.rs" "agents::runtime_config"
assert_row_contains "runtime_config.rs → E2E tag"      "agents/runtime_config.rs" "@workflow"
assert_row_contains "reconciliation command → E2E tag" "commands/reconciliation.rs" "@dashboard"
assert_row_contains "db mod → cargo filter"            "db/mod.rs"                 "db"

# ===== Agents =====

echo ""
echo -e "${CYAN}${BOLD}━━━ Agents ━━━${RESET}"
assert_row_contains "agent plugin prompts → structural tests"       "agent-sources/plugins/**/agents/*.md" "test:agents:structural"
assert_row_contains "agent plugin prompts → live approval policy"   "agent-sources/plugins/**/agents/*.md" "live smoke requires explicit approval"
assert_row_contains "workspace instructions → structural tests"     "agent-sources/workspace/**"           "test:agents:structural"

# ===== E2E Spec Files =====

echo ""
echo -e "${CYAN}${BOLD}━━━ E2E Spec Files ━━━${RESET}"
assert_in_test_map  "dashboard smoke spec listed"     "dashboard-smoke.spec.ts"
assert_in_test_map  "settings spec listed"            "settings.spec.ts"
assert_in_test_map  "workflow smoke spec listed"      "workflow-smoke.spec.ts"
assert_in_test_map  "workflow gate spec listed"       "workflow-gate.spec.ts"
assert_in_test_map  "refine spec listed"              "refine.spec.ts"
assert_in_test_map  "evals spec listed"               "evals.spec.ts"
assert_in_test_map  "display items spec listed"       "display-items.spec.ts"

# ===== Summary =====

echo ""
echo "--------------------------------------------"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All $TOTAL test map scenarios passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL_COUNT/$TOTAL test map scenarios failed.${RESET}"
  exit 1
fi
