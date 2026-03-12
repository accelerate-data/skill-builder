#!/bin/bash
# test-write-hooks.sh — unit tests for write hook shell scripts
# Simulates hook invocations with mock JSON input and verifies output

set -e

HOOKS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Logging ---
if [ -n "${VD_TEST_LOG_DIR:-}" ]; then
  mkdir -p "$VD_TEST_LOG_DIR"
  UNIT_LOG_FILE="$VD_TEST_LOG_DIR/unit-write-hooks-$(date -u +"%Y%m%dT%H%M%SZ").log"
  exec > >(tee -a "$UNIT_LOG_FILE") 2>&1
  echo "Log file: $UNIT_LOG_FILE"
fi
TMPDIR=$(mktemp -d)
PASS=0
FAIL=0

cleanup() { rm -rf "$TMPDIR"; }
trap cleanup EXIT

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

assert_file_exists() {
  local pattern="$1"
  local desc="$2"
  # shellcheck disable=SC2086
  if ls $pattern 2>/dev/null | grep -q .; then
    pass "$desc"
  else
    fail "$desc (no file matching $pattern)"
  fi
}

assert_file_contains() {
  local file="$1"
  local text="$2"
  local desc="$3"
  # Use -F (fixed string) to avoid regex interpretation of special chars like **
  if grep -qF "$text" "$file" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc (expected '$text' in $file)"
  fi
}

MOCK_TRANSCRIPT="$TMPDIR/transcript.jsonl"
echo '{"message":{"content":"user said hello"}}' >> "$MOCK_TRANSCRIPT"
echo '{"message":{"content":"agent replied"}}' >> "$MOCK_TRANSCRIPT"
echo '{"message":{"content":"user asked question"}}' >> "$MOCK_TRANSCRIPT"
echo '{"message":{"content":"agent answered"}}' >> "$MOCK_TRANSCRIPT"
echo '{"message":{"content":"user confirmed"}}' >> "$MOCK_TRANSCRIPT"

MOCK_INPUT=$(jq -n \
  --arg cwd "$TMPDIR" \
  --arg transcript "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $transcript, session_id: "test-session-123", tool_name: "Bash"}')

run_hook() {
  local script="$1"
  local label="$2"
  local prefix="$3"

  echo ""
  echo "Testing $label..."

  echo "$MOCK_INPUT" | bash "$HOOKS_DIR/$script"

  assert_file_exists "$TMPDIR/vd-memory/learnings/$prefix-*.md" \
    "$label: learning file created"

  local learning_file
  learning_file=$(ls "$TMPDIR/vd-memory/learnings/$prefix-"*.md | head -1)

  assert_file_contains "$learning_file" '"cwd"' \
    "$label: learning file contains hook JSON input"
  assert_file_contains "$learning_file" 'user confirmed' \
    "$label: learning file contains transcript turns"
  assert_file_contains "$learning_file" "**Timestamp**" \
    "$label: learning file has timestamp header"
}

echo "=== Write Hook Tests ==="

# Test auto-init (first hook creates MEMORY.md)
echo ""
echo "Testing auto-init..."
INIT_DIR="$TMPDIR/init-test"
INIT_INPUT=$(jq -n --arg cwd "$INIT_DIR" --arg t "$MOCK_TRANSCRIPT" '{cwd: $cwd, transcript_path: $t}')
mkdir -p "$INIT_DIR"
echo "$INIT_INPUT" | bash "$HOOKS_DIR/on-stop.sh"

if [ -f "$INIT_DIR/vd-memory/MEMORY.md" ]; then
  pass "auto-init: MEMORY.md created on first invocation"
else
  fail "auto-init: MEMORY.md not created"
fi

if [ -d "$INIT_DIR/vd-memory/learnings" ]; then
  pass "auto-init: learnings/ directory created"
else
  fail "auto-init: learnings/ directory not created"
fi

assert_file_contains "$INIT_DIR/vd-memory/MEMORY.md" "Domain Memory" \
  "auto-init: MEMORY.md has descriptive header"

# Test that MEMORY.md is NOT overwritten on second invocation
echo "existing content" >> "$INIT_DIR/vd-memory/MEMORY.md"
echo "$INIT_INPUT" | bash "$HOOKS_DIR/on-stop.sh"
if grep -q "existing content" "$INIT_DIR/vd-memory/MEMORY.md"; then
  pass "auto-init: MEMORY.md not overwritten on subsequent runs"
else
  fail "auto-init: MEMORY.md was overwritten"
fi

# Test timestamp format (YYYYMMDDTHHMMSSZ with optional -PID suffix)
TIMESTAMP_FILE=$(ls "$INIT_DIR/vd-memory/learnings/learning-stop-"*.md | head -1)
BASENAME=$(basename "$TIMESTAMP_FILE" .md)
TIMESTAMP="${BASENAME#learning-stop-}"
if echo "$TIMESTAMP" | grep -qE '^[0-9]{8}T[0-9]{6}Z(-[0-9]+)?$'; then
  pass "timestamp format matches YYYYMMDDTHHMMSSZ(-PID)?"
else
  fail "timestamp format wrong: got $TIMESTAMP"
fi

# Run all 6 hooks
run_hook "on-tool-failure.sh"   "on-tool-failure"   "learning-tool-failure"
run_hook "on-subagent-stop.sh"  "on-subagent-stop"  "learning-subagent-stop"
run_hook "on-stop.sh"           "on-stop"            "learning-stop"
run_hook "on-task-completed.sh" "on-task-completed"  "learning-task-completed"
run_hook "on-config-change.sh"  "on-config-change"   "learning-config-change"
run_hook "on-session-end.sh"    "on-session-end"     "learning-session-end"

# Test missing transcript (should not error)
echo ""
echo "Testing missing transcript (graceful no-op)..."
NO_TRANSCRIPT_INPUT=$(jq -n --arg cwd "$TMPDIR" '{cwd: $cwd}')
echo "$NO_TRANSCRIPT_INPUT" | bash "$HOOKS_DIR/on-stop.sh" && pass "missing transcript: exits 0" || fail "missing transcript: non-zero exit"

# =========================================================================
# on-tool-use.sh error pattern detection (TC-03-1 through TC-03-7)
# =========================================================================
echo ""
echo "=== on-tool-use.sh Error Pattern Tests ==="

# Setup: create a project dir with vd-memory
TOOL_USE_DIR="$TMPDIR/tool-use-test"
mkdir -p "$TOOL_USE_DIR/vd-memory/learnings"

TOOL_USE_INPUT=$(jq -n \
  --arg cwd "$TOOL_USE_DIR" \
  --arg transcript "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $transcript, tool_name: "Bash"}')

# Helper: clear learnings between sub-tests
clear_tool_use_learnings() {
  rm -f "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-"*.md
}

# TC-03-1: dbt compilation error
echo ""
echo "Testing TC-03-1: dbt compilation error pattern..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="Compilation Error in model stg_orders - missing ref to source"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
assert_file_exists "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-03-1: learning file created for 'Compilation Error'"

# TC-03-2: Deprecation warning
echo ""
echo "Testing TC-03-2: deprecation warning pattern..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="WARNING: deprecated function used in transform.py"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
assert_file_exists "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-03-2: learning file created for 'WARNING:.*deprecat'"

# TC-03-3: SQL syntax error
echo ""
echo "Testing TC-03-3: SQL syntax error pattern..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="syntax error at or near SELECT FROM orders WHERE"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
assert_file_exists "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-03-3: learning file created for 'syntax error'"

# TC-03-4: Missing relation
echo ""
echo "Testing TC-03-4: missing relation pattern..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT='ERROR:  relation "public.missing_table" does not exist'
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
assert_file_exists "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-03-4: learning file created for 'relation.*does not exist'"

# TC-03-5: Python module error
echo ""
echo "Testing TC-03-5: Python module error pattern..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="ModuleNotFoundError: No module named 'pandas'"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
assert_file_exists "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-03-5: learning file created for 'ModuleNotFoundError'"

# TC-03-6: Clean output (negative test)
echo ""
echo "Testing TC-03-6: clean output — no error (negative test)..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="Everything is fine, pipeline completed successfully"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
# shellcheck disable=SC2086
if ls $TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md 2>/dev/null | grep -q .; then
  fail "TC-03-6: learning file created for clean output (should NOT exist)"
else
  pass "TC-03-6: no learning file for clean output"
fi

# TC-03-7: Minimal ls output (negative test)
echo ""
echo "Testing TC-03-7: minimal ls output — no error (negative test)..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="MEMORY.md  facts  learnings  reads"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
# shellcheck disable=SC2086
if ls $TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md 2>/dev/null | grep -q .; then
  fail "TC-03-7: learning file created for ls output (should NOT exist)"
else
  pass "TC-03-7: no learning file for ls output"
fi

# Verify content of a positive-case learning file
echo ""
echo "Testing TC-03 content: learning file structure..."
clear_tool_use_learnings
(export CLAUDE_TOOL_OUTPUT="fatal: not a git repository"
  echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
TOOL_USE_FILE=$(ls "$TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-"*.md 2>/dev/null | head -1)
if [ -n "$TOOL_USE_FILE" ]; then
  assert_file_contains "$TOOL_USE_FILE" "**Hook**: PostToolUse" \
    "TC-03 content: learning file has PostToolUse header"
  assert_file_contains "$TOOL_USE_FILE" "**Tool**: Bash" \
    "TC-03 content: learning file has tool name Bash"
  assert_file_contains "$TOOL_USE_FILE" "fatal: not a git repository" \
    "TC-03 content: learning file contains tool output excerpt"
else
  fail "TC-03 content: no learning file to check"
fi

# =========================================================================
# on-tool-failure.sh edge cases (TC-10-1, TC-04-5 / TC-10-4)
# =========================================================================
echo ""
echo "=== on-tool-failure.sh Edge Case Tests ==="

# TC-10-1: No vd-memory/ — on-tool-failure auto-creates
echo ""
echo "Testing TC-10-1: no vd-memory dir, on-tool-failure auto-creates..."
NOINIT_DIR="$TMPDIR/no-vd-memory-test"
mkdir -p "$NOINIT_DIR"
NOINIT_INPUT=$(jq -n --arg cwd "$NOINIT_DIR" --arg t "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $t, tool_name: "Bash"}')
echo "$NOINIT_INPUT" | bash "$HOOKS_DIR/on-tool-failure.sh"

if [ -d "$NOINIT_DIR/vd-memory" ]; then
  pass "TC-10-1: vd-memory/ dir created by on-tool-failure"
else
  fail "TC-10-1: vd-memory/ dir NOT created"
fi
if [ -f "$NOINIT_DIR/vd-memory/MEMORY.md" ]; then
  pass "TC-10-1: MEMORY.md auto-initialized"
  assert_file_contains "$NOINIT_DIR/vd-memory/MEMORY.md" "Domain Memory" \
    "TC-10-1: MEMORY.md has correct header"
else
  fail "TC-10-1: MEMORY.md NOT auto-initialized"
fi
assert_file_exists "$NOINIT_DIR/vd-memory/learnings/learning-tool-failure-*.md" \
  "TC-10-1: learning file created"

# TC-04-5 / TC-10-4: Non-Bash tool name in hook input
echo ""
echo "Testing TC-04-5: non-Bash tool name (Read) in on-tool-failure..."
READ_TOOL_DIR="$TMPDIR/read-tool-test"
mkdir -p "$READ_TOOL_DIR/vd-memory/learnings"
cat > "$READ_TOOL_DIR/vd-memory/MEMORY.md" <<'HDR'
# Domain Memory
HDR
READ_TOOL_INPUT=$(jq -n --arg cwd "$READ_TOOL_DIR" --arg t "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $t, tool_name: "Read"}')
echo "$READ_TOOL_INPUT" | bash "$HOOKS_DIR/on-tool-failure.sh"
FAILURE_FILE=$(ls "$READ_TOOL_DIR/vd-memory/learnings/learning-tool-failure-"*.md 2>/dev/null | head -1)
if [ -n "$FAILURE_FILE" ]; then
  pass "TC-04-5: learning file created for Read tool failure"
  assert_file_contains "$FAILURE_FILE" '"tool_name": "Read"' \
    "TC-04-5: learning file references tool_name Read"
else
  fail "TC-04-5: no learning file for Read tool failure"
fi

# =========================================================================
# on-tool-use.sh edge cases (TC-10-2, TC-10-4)
# =========================================================================
echo ""
echo "=== on-tool-use.sh Edge Case Tests ==="

# TC-10-2: No vd-memory/ — on-tool-use auto-creates when error pattern matches
echo ""
echo "Testing TC-10-2a: no vd-memory dir + error output, on-tool-use auto-creates..."
NO_MEM_DIR="$TMPDIR/tool-use-no-mem"
mkdir -p "$NO_MEM_DIR"
NO_MEM_INPUT=$(jq -n --arg cwd "$NO_MEM_DIR" --arg t "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $t, tool_name: "Bash"}')
EXIT_CODE=0
(export CLAUDE_TOOL_OUTPUT="error: something went wrong"
  echo "$NO_MEM_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh") || EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ]; then
  pass "TC-10-2a: on-tool-use exits 0"
else
  fail "TC-10-2a: on-tool-use exited non-zero ($EXIT_CODE)"
fi
if [ -d "$NO_MEM_DIR/vd-memory" ]; then
  pass "TC-10-2a: vd-memory/ auto-created by on-tool-use"
else
  fail "TC-10-2a: vd-memory/ NOT auto-created (should be)"
fi
if [ -f "$NO_MEM_DIR/vd-memory/MEMORY.md" ]; then
  pass "TC-10-2a: MEMORY.md auto-initialized"
  assert_file_contains "$NO_MEM_DIR/vd-memory/MEMORY.md" "Domain Memory" \
    "TC-10-2a: MEMORY.md has correct header"
else
  fail "TC-10-2a: MEMORY.md NOT auto-initialized"
fi
assert_file_exists "$NO_MEM_DIR/vd-memory/learnings/learning-tool-use-*.md" \
  "TC-10-2a: learning file created after auto-init"

# TC-10-2b: No vd-memory/ + clean output — no auto-create (R2)
echo ""
echo "Testing TC-10-2b: no vd-memory dir + clean output, no auto-create..."
NO_MEM_CLEAN_DIR="$TMPDIR/tool-use-no-mem-clean"
mkdir -p "$NO_MEM_CLEAN_DIR"
NO_MEM_CLEAN_INPUT=$(jq -n --arg cwd "$NO_MEM_CLEAN_DIR" '{cwd: $cwd, tool_name: "Bash"}')
(export CLAUDE_TOOL_OUTPUT="Everything is fine, pipeline completed successfully"
  echo "$NO_MEM_CLEAN_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
if [ ! -d "$NO_MEM_CLEAN_DIR/vd-memory" ]; then
  pass "TC-10-2b: vd-memory/ NOT auto-created for clean output"
else
  fail "TC-10-2b: vd-memory/ was auto-created (should not be for clean output)"
fi

# TC-10-4: Non-Bash tool (Read) triggers on-tool-use with error content
echo ""
echo "Testing TC-10-4: Read tool triggers on-tool-use with error content..."
READ_USE_DIR="$TMPDIR/read-tool-use-test"
mkdir -p "$READ_USE_DIR/vd-memory/learnings"
cat > "$READ_USE_DIR/vd-memory/MEMORY.md" <<'HDR'
# Domain Memory
HDR
READ_USE_INPUT=$(jq -n --arg cwd "$READ_USE_DIR" --arg t "$MOCK_TRANSCRIPT" \
  '{cwd: $cwd, transcript_path: $t, tool_name: "Read"}')
(export CLAUDE_TOOL_OUTPUT="Error: this file contains error patterns for testing"
  echo "$READ_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
READ_USE_FILE=$(ls "$READ_USE_DIR/vd-memory/learnings/learning-tool-use-"*.md 2>/dev/null | head -1)
if [ -n "$READ_USE_FILE" ]; then
  pass "TC-10-4: learning file created for Read tool with error output"
  assert_file_contains "$READ_USE_FILE" "**Tool**: Read" \
    "TC-10-4: learning file shows Tool: Read (not Bash)"
else
  fail "TC-10-4: no learning file for Read tool error"
fi

# =========================================================================
# on-tool-use.sh broadened pattern tests (warnings, Python, infra)
# =========================================================================
echo ""
echo "=== on-tool-use.sh Broadened Pattern Tests ==="

# Helper: test a single pattern match
test_pattern() {
  local label="$1"
  local output="$2"
  local expect_match="$3"  # "yes" or "no"

  clear_tool_use_learnings
  (export CLAUDE_TOOL_OUTPUT="$output"
    echo "$TOOL_USE_INPUT" | bash "$HOOKS_DIR/on-tool-use.sh")
  # shellcheck disable=SC2086
  if ls $TOOL_USE_DIR/vd-memory/learnings/learning-tool-use-*.md 2>/dev/null | grep -q .; then
    if [ "$expect_match" = "yes" ]; then
      pass "$label: learning file created (expected)"
    else
      fail "$label: learning file created (should NOT exist)"
    fi
  else
    if [ "$expect_match" = "no" ]; then
      pass "$label: no learning file (expected)"
    else
      fail "$label: no learning file (should exist)"
    fi
  fi
}

test_pattern "WARNING pattern" "WARNING: something happened" "yes"
test_pattern "DeprecationWarning pattern" "DeprecationWarning: old API" "yes"
test_pattern "FutureWarning pattern" "FutureWarning: this will change in v2" "yes"
test_pattern "UserWarning pattern" "UserWarning: check your config" "yes"
test_pattern "ValueError pattern" "ValueError: invalid literal for int()" "yes"
test_pattern "TypeError pattern" "TypeError: expected str, got int" "yes"
test_pattern "KeyError pattern" "KeyError: 'missing_key'" "yes"
test_pattern "ImportError pattern" "ImportError: cannot import name 'foo'" "yes"
test_pattern "FileNotFoundError pattern" "FileNotFoundError: [Errno 2] No such file" "yes"
test_pattern "ConnectionError pattern" "ConnectionError: failed to connect to host" "yes"
test_pattern "TimeoutError pattern" "TimeoutError: operation timed out after 30s" "yes"
test_pattern "PermissionError pattern" "PermissionError: [Errno 13] Permission denied" "yes"
test_pattern "CRITICAL pattern" "CRITICAL: service down" "yes"
test_pattern "panic: pattern" "panic: runtime error: index out of range" "yes"
test_pattern "deadlock pattern" "deadlock detected while waiting for lock" "yes"
test_pattern "constraint violation pattern" "constraint violation on insert into orders" "yes"
test_pattern "Encountered an error pattern" "Encountered an error during run" "yes"
test_pattern "SKIP pattern" "SKIP relation does not exist" "yes"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
