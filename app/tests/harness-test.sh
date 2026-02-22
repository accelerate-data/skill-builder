#!/usr/bin/env bash
# Self-tests for the unified test harness (run.sh).
# Validates argument parsing, help output, and error handling.
# Does NOT execute actual test suites — only tests early-exit paths.
#
# Usage: ./tests/harness-test.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_SH="$SCRIPT_DIR/run.sh"

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

# Assert a command exits with expected code
assert_exit() {
  local desc="$1" expected="$2"
  shift 2
  local actual=0
  "$@" >/dev/null 2>&1 || actual=$?
  if [[ "$actual" -eq "$expected" ]]; then
    pass "$desc"
  else
    fail "$desc (expected exit $expected, got $actual)"
  fi
}

# Assert command output contains a pattern
assert_contains() {
  local desc="$1" pattern="$2"
  shift 2
  local output
  output=$("$@" 2>&1) || true
  if echo "$output" | grep -q "$pattern"; then
    pass "$desc"
  else
    fail "$desc (output missing: '$pattern')"
  fi
}

echo ""
echo "============================================"
echo " Harness Self-Tests"
echo "============================================"
echo ""

# ===== run.sh tests =====

echo -e "${CYAN}${BOLD}━━━ run.sh: Help Output ━━━${RESET}"
assert_exit   "--help exits 0"              0 "$RUN_SH" --help
assert_contains "--help lists unit level"     "unit"        "$RUN_SH" --help
assert_contains "--help lists integration"    "integration" "$RUN_SH" --help
assert_contains "--help lists e2e level"      "e2e"         "$RUN_SH" --help
assert_contains "--help lists plugin level"   "plugin"      "$RUN_SH" --help
assert_contains "--help lists all level"      "all"         "$RUN_SH" --help
assert_contains "--help shows E2E tags"       "@dashboard"  "$RUN_SH" --help

echo ""
echo -e "${CYAN}${BOLD}━━━ run.sh: Error Handling ━━━${RESET}"
assert_exit "invalid level exits non-zero"    1 "$RUN_SH" bogus
assert_exit "unknown flag exits non-zero"     1 "$RUN_SH" --foo
assert_exit "--tag without value exits 1"     1 "$RUN_SH" --tag

# ===== Summary =====

echo ""
echo "--------------------------------------------"
TOTAL=$((PASS_COUNT + FAIL_COUNT))
if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All $TOTAL harness tests passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}$FAIL_COUNT/$TOTAL harness tests failed.${RESET}"
  exit 1
fi
