#!/usr/bin/env bash
# lib.sh — Shared utilities for the skill-builder plugin test harness

# ---------- Results tracking ----------
declare -a TEST_RESULTS=()
TOTAL_PASS=0
TOTAL_FAIL=0
TOTAL_SKIP=0

init_results() {
  TEST_RESULTS=()
  TOTAL_PASS=0
  TOTAL_FAIL=0
  TOTAL_SKIP=0
}

record_result() {
  local tier="$1" name="$2" status="$3" detail="${4:-}"
  TEST_RESULTS+=("$tier|$name|$status|$detail")
  case "$status" in
    PASS) TOTAL_PASS=$((TOTAL_PASS + 1)) ;;
    FAIL) TOTAL_FAIL=$((TOTAL_FAIL + 1)) ;;
    SKIP) TOTAL_SKIP=$((TOTAL_SKIP + 1)) ;;
  esac

  local icon
  case "$status" in
    PASS) icon="  PASS" ;;
    FAIL) icon="  FAIL" ;;
    SKIP) icon="  SKIP" ;;
  esac
  echo "$icon  [$tier] $name${detail:+ — $detail}"
}

# ---------- Assertion helpers ----------

assert_exit_code() {
  local tier="$1" name="$2" expected="$3" actual="$4"
  if [[ "$actual" -eq "$expected" ]]; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "expected exit=$expected, got exit=$actual"
    return 1
  fi
}

assert_output_contains() {
  local tier="$1" name="$2" output="$3" pattern="$4"
  if echo "$output" | grep -qi "$pattern"; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "output missing pattern: $pattern"
    return 1
  fi
}

assert_file_exists() {
  local tier="$1" name="$2" filepath="$3"
  if [[ -f "$filepath" ]]; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "file not found: $filepath"
    return 1
  fi
}

assert_dir_exists() {
  local tier="$1" name="$2" dirpath="$3"
  if [[ -d "$dirpath" ]]; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "dir not found: $dirpath"
    return 1
  fi
}

assert_file_not_empty() {
  local tier="$1" name="$2" filepath="$3"
  if [[ -s "$filepath" ]]; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "file empty or missing: $filepath"
    return 1
  fi
}

assert_count_eq() {
  local tier="$1" name="$2" expected="$3" actual="$4"
  if [[ "$actual" -eq "$expected" ]]; then
    record_result "$tier" "$name" "PASS"
    return 0
  else
    record_result "$tier" "$name" "FAIL" "expected=$expected, actual=$actual"
    return 1
  fi
}

# ---------- Temp directory management ----------
declare -a TEMP_DIRS=()

make_temp_dir() {
  local label="${1:-test}"
  local dir
  dir=$(mktemp -d "${TMPDIR:-/tmp}/skill-builder-test-${label}.XXXXXX")
  TEMP_DIRS+=("$dir")
  echo "$dir"
}

cleanup_temp_dirs() {
  if [[ ${#TEMP_DIRS[@]} -eq 0 ]]; then
    return
  fi
  if [[ "${KEEP_TEMP:-0}" == "1" ]]; then
    echo ""
    echo "KEEP_TEMP=1: Temp directories preserved:"
    for d in "${TEMP_DIRS[@]}"; do
      echo "  $d"
    done
    return
  fi
  for d in "${TEMP_DIRS[@]}"; do
    if [[ -d "$d" ]]; then
      rm -rf "$d"
    fi
  done
}

trap cleanup_temp_dirs EXIT

# ---------- Claude invocation helpers ----------

# Allow tests to spawn claude from within a Claude Code session
unset CLAUDECODE 2>/dev/null || true

# Portable timeout: try timeout (Linux), gtimeout (macOS coreutils), then perl fallback
_timeout_cmd() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$@"
  else
    # macOS fallback: use perl alarm() + exec to enforce timeout.
    # exec replaces the perl process with the command, preserving all
    # file descriptors (stdin pipes, redirections, etc.). When the alarm
    # fires, SIGALRM kills the command.
    local secs="$1"
    shift
    perl -e 'alarm(shift(@ARGV)); exec(@ARGV) or die "exec failed: $!"' -- "$secs" "$@"
  fi
}

run_claude_safe() {
  local prompt="$1"
  local timeout_secs="${2:-60}"
  local cwd="${3:-}"
  local cmd="$CLAUDE_BIN -p --plugin-dir $PLUGIN_DIR"
  # Pipe prompt via stdin because --plugin-dir is variadic and swallows positional args
  if [[ -n "$cwd" ]]; then
    (cd "$cwd" && echo "$prompt" | _timeout_cmd "$timeout_secs" $cmd 2>&1) || true
  else
    echo "$prompt" | _timeout_cmd "$timeout_secs" $cmd 2>&1 || true
  fi
}

run_claude_unsafe() {
  local prompt="$1"
  local budget="$2"
  local timeout_secs="${3:-120}"
  local cwd="${4:-}"
  local cmd="$CLAUDE_BIN -p --plugin-dir $PLUGIN_DIR --dangerously-skip-permissions --max-budget-usd $budget"
  # Pipe prompt via stdin because --plugin-dir is variadic and swallows positional args
  if [[ -n "$cwd" ]]; then
    (cd "$cwd" && echo "$prompt" | _timeout_cmd "$timeout_secs" $cmd 2>&1) || true
  else
    echo "$prompt" | _timeout_cmd "$timeout_secs" $cmd 2>&1 || true
  fi
}

# ---------- Summary printer ----------

print_summary() {
  echo ""
  echo "============================================"
  echo " TEST SUMMARY"
  echo "============================================"
  printf "  %-4s  %-42s  %-6s  %s\n" "Tier" "Test" "Status" "Detail"
  printf "  %-4s  %-42s  %-6s  %s\n" "----" "$(printf -- '-%.0s' {1..42})" "------" "$(printf -- '-%.0s' {1..30})"

  for entry in "${TEST_RESULTS[@]}"; do
    IFS='|' read -r tier name status detail <<< "$entry"
    printf "  %-4s  %-42s  %-6s  %s\n" "$tier" "$name" "$status" "$detail"
  done

  echo ""
  echo "  ------------------------------------------"
  echo "  PASS: $TOTAL_PASS  |  FAIL: $TOTAL_FAIL  |  SKIP: $TOTAL_SKIP  |  TOTAL: ${#TEST_RESULTS[@]}"
  echo "  ------------------------------------------"

  if [[ $TOTAL_FAIL -gt 0 ]]; then
    echo "  RESULT: FAILED"
  else
    echo "  RESULT: ALL PASSED"
  fi
  echo "============================================"
}

get_exit_code() {
  if [[ $TOTAL_FAIL -gt 0 ]]; then
    echo 1
  else
    echo 0
  fi
}

# ---------- Verbose logging ----------
log_verbose() {
  if [[ "${VERBOSE:-0}" == "1" ]]; then
    echo "  [verbose] $*"
  fi
}
