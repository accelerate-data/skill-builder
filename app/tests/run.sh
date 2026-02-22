#!/usr/bin/env bash
set -euo pipefail

# Unified test runner for the Skill Builder desktop app.
#
# Usage: ./tests/run.sh [level] [--tag TAG]
# Levels: unit, integration, e2e, plugin, eval, all (default: all)
# Tags (E2E): @dashboard, @settings, @workflow, @workflow-agent, @navigation

# ---------------------------------------------------------------------------
# Resolve paths
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

# ---------------------------------------------------------------------------
# Parse arguments
# ---------------------------------------------------------------------------
LEVEL="all"
TAG=""
RUN_WORKFLOW=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    unit|integration|e2e|eval|all)
      LEVEL="$1"
      shift
      ;;
    plugin)
      LEVEL="plugin"
      shift
      # Allow explicit workflow opt-in: ./tests/run.sh plugin workflow
      if [[ "${1:-}" == "workflow" ]]; then
        RUN_WORKFLOW=true
        shift
      fi
      ;;
    --tag)
      TAG="${2:-}"
      if [[ -z "$TAG" ]]; then
        echo -e "${RED}Error: --tag requires a value${RESET}" >&2
        exit 1
      fi
      shift 2
      ;;
    -h|--help)
      echo "Usage: ./tests/run.sh [level] [--tag TAG]"
      echo ""
      echo "Levels:"
      echo "  unit          Pure logic: stores, utils, hooks, Rust, sidecar"
      echo "  integration   Component rendering with mocked APIs"
      echo "  e2e           Full browser tests (Playwright)"
      echo "  plugin        Plugin tests (Vitest); add 'workflow' for full E2E (~\$5)"
      echo "  eval          Eval harness tests"
      echo "  all           Run all levels (default)"
      echo ""
      echo "Options:"
      echo "  --tag TAG     Filter E2E tests by tag"
      echo "    @dashboard, @settings, @workflow, @workflow-agent, @navigation, @skills, @usage"
      echo ""
      echo "Examples:"
      echo "  ./tests/run.sh                           # Run everything"
      echo "  ./tests/run.sh unit                      # Unit tests only"
      echo "  ./tests/run.sh plugin                    # Plugin tests (Vitest)"
      echo "  ./tests/run.sh plugin workflow                 # Full E2E workflow (opt-in, ~\$5)"
      echo "  FOREGROUND=1 ./tests/run.sh plugin workflow    # Workflow test with live Claude output"
      echo "  ./tests/run.sh e2e --tag @dashboard      # Dashboard E2E tests"
      exit 0
      ;;
    *)
      echo -e "${RED}Error: unknown argument '$1'${RESET}" >&2
      echo "Run './tests/run.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

# ---------------------------------------------------------------------------
# Track failures
# ---------------------------------------------------------------------------
FAILURES=()

header() {
  echo ""
  echo -e "${CYAN}${BOLD}━━━ $1 ━━━${RESET}"
  echo ""
}

pass() {
  echo -e "${GREEN}PASS${RESET} $1"
}

fail() {
  echo -e "${RED}FAIL${RESET} $1"
  FAILURES+=("$1")
}

# ---------------------------------------------------------------------------
# Level: unit
# ---------------------------------------------------------------------------
run_unit() {
  header "Unit Tests: Frontend (Vitest)"
  if (cd "$APP_DIR" && npx vitest run src/__tests__/stores/ src/__tests__/lib/ src/__tests__/hooks/); then
    pass "Frontend unit tests"
  else
    fail "Frontend unit tests"
  fi

  header "Unit Tests: Rust (cargo test)"
  if (cd "$APP_DIR" && cargo test --manifest-path src-tauri/Cargo.toml); then
    pass "Rust unit tests"
  else
    fail "Rust unit tests"
  fi

  header "Unit Tests: Sidecar (Vitest)"
  if (cd "$APP_DIR/sidecar" && npx vitest run); then
    pass "Sidecar unit tests"
  else
    fail "Sidecar unit tests"
  fi

  # Canonical format compliance is now covered by:
  # - Agent prompts: npm run test:plugin:structural (plugin-tests/structural.test.ts)
  # - Mock templates / fixtures: vitest canonical-format.test.ts (included in unit tests above)
}

# ---------------------------------------------------------------------------
# Level: integration
# ---------------------------------------------------------------------------
run_integration() {
  header "Integration Tests: Components + Pages (Vitest)"
  if (cd "$APP_DIR" && npx vitest run src/__tests__/components/ src/__tests__/pages/); then
    pass "Integration tests"
  else
    fail "Integration tests"
  fi
}

# ---------------------------------------------------------------------------
# Level: e2e
# ---------------------------------------------------------------------------
run_e2e() {
  local tag_args=()
  if [[ -n "$TAG" ]]; then
    tag_args=(--grep "$TAG")
  fi

  header "E2E Tests: Playwright${TAG:+ (tag: $TAG)}"
  if (cd "$APP_DIR" && npx playwright test "${tag_args[@]+"${tag_args[@]}"}"); then
    pass "E2E tests${TAG:+ ($TAG)}"
  else
    fail "E2E tests${TAG:+ ($TAG)}"
  fi
}

# ---------------------------------------------------------------------------
# Level: plugin
# ---------------------------------------------------------------------------
run_plugin() {
  header "Plugin Tests (Vitest)"
  if (cd "$APP_DIR" && npm run test:plugin --silent); then
    pass "Plugin tests"
  else
    fail "Plugin tests"
  fi

  if [[ "$RUN_WORKFLOW" == "true" ]]; then
    header "Plugin Tests: Full E2E Workflow (Vitest)"
    if (cd "$APP_DIR" && npm run test:plugin:workflow --silent); then
      pass "Plugin workflow (full E2E)"
    else
      fail "Plugin workflow (full E2E)"
    fi
  fi
}

# ---------------------------------------------------------------------------
# Level: eval
# ---------------------------------------------------------------------------
run_eval() {
  header "Eval Harness Tests"
  EVAL_SCRIPT="$APP_DIR/../scripts/eval/test-eval-harness.sh"
  if [[ ! -x "$EVAL_SCRIPT" ]]; then
    fail "Eval harness tests (scripts/eval/test-eval-harness.sh not found)"
    return
  fi
  if ("$EVAL_SCRIPT"); then
    pass "Eval harness tests"
  else
    fail "Eval harness tests"
  fi
}

# ---------------------------------------------------------------------------
# Run the requested level(s)
# ---------------------------------------------------------------------------
case "$LEVEL" in
  unit)
    run_unit
    ;;
  integration)
    run_integration
    ;;
  e2e)
    run_e2e
    ;;
  plugin)
    run_plugin
    ;;
  eval)
    run_eval
    ;;
  all)
    run_unit
    run_integration
    run_e2e
    run_plugin
    run_eval
    ;;
esac

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo ""
if [[ ${#FAILURES[@]} -eq 0 ]]; then
  echo -e "${GREEN}${BOLD}All tests passed.${RESET}"
  exit 0
else
  echo -e "${RED}${BOLD}${#FAILURES[@]} test suite(s) failed:${RESET}"
  for f in "${FAILURES[@]}"; do
    echo -e "  ${RED}- $f${RESET}"
  done
  exit 1
fi
