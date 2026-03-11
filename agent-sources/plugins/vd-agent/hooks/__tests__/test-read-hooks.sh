#!/bin/bash
# test-read-hooks.sh — unit tests for read hook shell scripts

set -e

HOOKS_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# --- Logging ---
if [ -n "${VD_TEST_LOG_DIR:-}" ]; then
  mkdir -p "$VD_TEST_LOG_DIR"
  UNIT_LOG_FILE="$VD_TEST_LOG_DIR/unit-read-hooks-$(date -u +"%Y%m%dT%H%M%SZ").log"
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

assert_file_contains() {
  local file="$1"
  local text="$2"
  local desc="$3"
  if grep -qF "$text" "$file" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc (expected '$text' in $file)"
  fi
}

assert_json_field() {
  local json="$1"
  local field="$2"
  local expected="$3"
  local desc="$4"
  local actual
  actual=$(echo "$json" | jq -r "$field" 2>/dev/null)
  if [ "$actual" = "$expected" ]; then
    pass "$desc"
  else
    fail "$desc (expected '$expected', got '$actual')"
  fi
}

echo "=== Read Hook Tests ==="

# --- on-subagent-start.sh ---

echo ""
echo "Testing on-subagent-start.sh..."

DOMAIN_DIR="$TMPDIR/domain"
mkdir -p "$DOMAIN_DIR/vd-memory"
cat > "$DOMAIN_DIR/vd-memory/MEMORY.md" <<'MEMORY'
# Domain Memory
[DOMAIN_FACT] salesforce: Always filter WHERE NOT IsDeleted
[DOMAIN_FACT] acme-corp: Revenue recognized at invoice_date
MEMORY

MOCK_INPUT=$(jq -n --arg cwd "$DOMAIN_DIR" '{cwd: $cwd, session_id: "test-123"}')

OUTPUT=$(echo "$MOCK_INPUT" | bash "$HOOKS_DIR/on-subagent-start.sh")

# Verify JSON structure
assert_json_field "$OUTPUT" '.hookSpecificOutput.hookEventName' 'SubagentStart' \
  "SubagentStart: hookEventName is SubagentStart"

ADDITIONAL_CTX=$(echo "$OUTPUT" | jq -r '.hookSpecificOutput.additionalContext')
if echo "$ADDITIONAL_CTX" | grep -qF "Domain Memory"; then
  pass "SubagentStart: additionalContext contains MEMORY.md content"
else
  fail "SubagentStart: additionalContext missing MEMORY.md content"
fi

# Verify read log was written
if [ -f "$DOMAIN_DIR/vd-memory/reads/subagent-start.log" ]; then
  pass "SubagentStart: read log created"
else
  fail "SubagentStart: read log not created"
fi

assert_file_contains "$DOMAIN_DIR/vd-memory/reads/subagent-start.log" "cwd: $DOMAIN_DIR" \
  "SubagentStart: read log contains cwd"

assert_file_contains "$DOMAIN_DIR/vd-memory/reads/subagent-start.log" "Domain Memory" \
  "SubagentStart: read log contains memory content"

# Verify log appends (not overwrites) on second invocation
echo "$MOCK_INPUT" | bash "$HOOKS_DIR/on-subagent-start.sh" > /dev/null
ENTRY_COUNT=$(grep -c "^--- " "$DOMAIN_DIR/vd-memory/reads/subagent-start.log")
if [ "$ENTRY_COUNT" -eq 2 ]; then
  pass "SubagentStart: read log appends on subsequent invocations"
else
  fail "SubagentStart: expected 2 log entries, got $ENTRY_COUNT"
fi

# Verify 200-line cap on additionalContext
LONG_DIR="$TMPDIR/long-domain"
mkdir -p "$LONG_DIR/vd-memory"
# Create a MEMORY.md with 300 lines
for i in $(seq 1 300); do echo "line $i"; done > "$LONG_DIR/vd-memory/MEMORY.md"
LONG_INPUT=$(jq -n --arg cwd "$LONG_DIR" '{cwd: $cwd}')
LONG_OUTPUT=$(echo "$LONG_INPUT" | bash "$HOOKS_DIR/on-subagent-start.sh")
LINE_COUNT=$(echo "$LONG_OUTPUT" | jq -r '.hookSpecificOutput.additionalContext' | wc -l | tr -d ' ')
if [ "$LINE_COUNT" -le 200 ]; then
  pass "SubagentStart: additionalContext capped at 200 lines (got $LINE_COUNT)"
else
  fail "SubagentStart: additionalContext exceeds 200 lines (got $LINE_COUNT)"
fi

# Verify graceful no-op when MEMORY.md absent
echo ""
echo "Testing on-subagent-start.sh — no MEMORY.md..."
EMPTY_DIR="$TMPDIR/empty-domain"
mkdir -p "$EMPTY_DIR"
EMPTY_INPUT=$(jq -n --arg cwd "$EMPTY_DIR" '{cwd: $cwd}')
EXIT_CODE=0
echo "$EMPTY_INPUT" | bash "$HOOKS_DIR/on-subagent-start.sh" > /dev/null || EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ]; then
  pass "SubagentStart: exits 0 when MEMORY.md absent"
else
  fail "SubagentStart: non-zero exit when MEMORY.md absent"
fi

# No log file should be created when MEMORY.md absent
if [ ! -f "$EMPTY_DIR/vd-memory/reads/subagent-start.log" ]; then
  pass "SubagentStart: no log created when MEMORY.md absent"
else
  fail "SubagentStart: log created when MEMORY.md absent (should be no-op)"
fi

# --- on-prompt-submit-log.sh ---

echo ""
echo "Testing on-prompt-submit-log.sh..."

PROMPT_DIR="$TMPDIR/prompt-domain"
mkdir -p "$PROMPT_DIR/vd-memory"

PROMPT_INPUT=$(jq -n \
  --arg cwd "$PROMPT_DIR" \
  --arg prompt "show me salesforce opportunities" \
  '{cwd: $cwd, prompt: $prompt}')

echo "$PROMPT_INPUT" | bash "$HOOKS_DIR/on-prompt-submit-log.sh"

if [ -f "$PROMPT_DIR/vd-memory/reads/prompt-submit.log" ]; then
  pass "prompt-submit-log: log file created"
else
  fail "prompt-submit-log: log file not created"
fi

assert_file_contains "$PROMPT_DIR/vd-memory/reads/prompt-submit.log" "cwd: $PROMPT_DIR" \
  "prompt-submit-log: log contains cwd"

assert_file_contains "$PROMPT_DIR/vd-memory/reads/prompt-submit.log" "salesforce" \
  "prompt-submit-log: log contains prompt text"

# Verify appends on second invocation
echo "$PROMPT_INPUT" | bash "$HOOKS_DIR/on-prompt-submit-log.sh"
PROMPT_ENTRY_COUNT=$(grep -c "^--- " "$PROMPT_DIR/vd-memory/reads/prompt-submit.log")
if [ "$PROMPT_ENTRY_COUNT" -eq 2 ]; then
  pass "prompt-submit-log: appends on subsequent invocations"
else
  fail "prompt-submit-log: expected 2 log entries, got $PROMPT_ENTRY_COUNT"
fi

# Verify no-op when vd-memory/ doesn't exist (read hooks don't bootstrap)
echo ""
echo "Testing on-prompt-submit-log.sh — no vd-memory dir..."
NO_MEM_DIR="$TMPDIR/no-mem-domain"
mkdir -p "$NO_MEM_DIR"
NO_MEM_INPUT=$(jq -n --arg cwd "$NO_MEM_DIR" --arg prompt "test" '{cwd: $cwd, prompt: $prompt}')
EXIT_CODE=0
echo "$NO_MEM_INPUT" | bash "$HOOKS_DIR/on-prompt-submit-log.sh" || EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ]; then
  pass "prompt-submit-log: exits 0 when vd-memory/ absent"
else
  fail "prompt-submit-log: non-zero exit when vd-memory/ absent"
fi
if [ ! -d "$NO_MEM_DIR/vd-memory" ]; then
  pass "prompt-submit-log: does not create vd-memory/ when absent"
else
  fail "prompt-submit-log: created vd-memory/ (read hooks should not bootstrap)"
fi

# --- on-prompt-submit.md (optional agent hook — may not exist) ---
echo ""
echo "Testing on-prompt-submit.md..."
if [ -f "$HOOKS_DIR/on-prompt-submit.md" ]; then
  pass "on-prompt-submit.md: file exists"

  if grep -qF '{ "ok": true }' "$HOOKS_DIR/on-prompt-submit.md"; then
    pass "on-prompt-submit.md: contains ok:true response instruction"
  else
    fail "on-prompt-submit.md: missing ok:true response instruction"
  fi

  if grep -qF 'Max 5 tool calls' "$HOOKS_DIR/on-prompt-submit.md"; then
    pass "on-prompt-submit.md: contains tool call constraint"
  else
    fail "on-prompt-submit.md: missing tool call constraint"
  fi
else
  echo "  SKIP: on-prompt-submit.md not present (agent hook removed; command hook on-prompt-submit.sh used instead)"
fi

# =========================================================================
# on-prompt-submit.sh keyword matching (TC-01-1 through TC-01-3)
# =========================================================================
echo ""
echo "=== on-prompt-submit.sh Keyword Matching Tests ==="

# Seed a project dir with MEMORY.md + facts/acme.md
KW_DIR="$TMPDIR/keyword-test"
mkdir -p "$KW_DIR/vd-memory/facts"
cat > "$KW_DIR/vd-memory/MEMORY.md" <<'MEM'
# Domain Memory
[DOMAIN_FACT] The "acme" source is a PostgreSQL database containing customer orders.
MEM
cat > "$KW_DIR/vd-memory/facts/acme.md" <<'FACTS'
# acme Source Facts
1. The orders table has 2.3M rows
2. Primary key is order_id (UUID)
FACTS

# TC-01-1: Prompt with matching keyword "acme"
echo ""
echo "Testing TC-01-1: prompt with keyword 'acme' matches facts/acme.md..."
KW_INPUT_1=$(jq -n --arg cwd "$KW_DIR" --arg prompt "What tables does the acme source have?" \
  '{cwd: $cwd, prompt: $prompt}')
OUTPUT_1=$(echo "$KW_INPUT_1" | bash "$HOOKS_DIR/on-prompt-submit.sh")
CTX_1=$(echo "$OUTPUT_1" | jq -r '.hookSpecificOutput.additionalContext // empty')
if echo "$CTX_1" | grep -qF "2.3M rows"; then
  pass "TC-01-1: additionalContext contains acme.md facts (2.3M rows)"
else
  fail "TC-01-1: additionalContext missing acme.md facts"
fi
if echo "$CTX_1" | grep -qF "Domain Memory"; then
  pass "TC-01-1: additionalContext contains MEMORY.md content"
else
  fail "TC-01-1: additionalContext missing MEMORY.md content"
fi

# TC-01-2: Prompt with no matching keywords ("Hi" is 2 chars, below 3-char minimum)
echo ""
echo "Testing TC-01-2: prompt 'Hi' — no keyword match (below 3-char min)..."
KW_INPUT_2=$(jq -n --arg cwd "$KW_DIR" --arg prompt "Hi" \
  '{cwd: $cwd, prompt: $prompt}')
OUTPUT_2=$(echo "$KW_INPUT_2" | bash "$HOOKS_DIR/on-prompt-submit.sh")
CTX_2=$(echo "$OUTPUT_2" | jq -r '.hookSpecificOutput.additionalContext // empty')
if echo "$CTX_2" | grep -qF "Domain Memory"; then
  pass "TC-01-2: additionalContext contains MEMORY.md"
else
  fail "TC-01-2: additionalContext missing MEMORY.md"
fi
if echo "$CTX_2" | grep -qF "2.3M rows"; then
  fail "TC-01-2: additionalContext contains acme.md facts (should NOT match)"
else
  pass "TC-01-2: additionalContext does NOT contain acme.md facts"
fi

# TC-01-3: Prompt with multiple keywords
echo ""
echo "Testing TC-01-3: prompt with multiple keywords matches acme.md..."
KW_INPUT_3=$(jq -n --arg cwd "$KW_DIR" --arg prompt "Tell me about the acme orders table and the widget_api source" \
  '{cwd: $cwd, prompt: $prompt}')
OUTPUT_3=$(echo "$KW_INPUT_3" | bash "$HOOKS_DIR/on-prompt-submit.sh")
CTX_3=$(echo "$OUTPUT_3" | jq -r '.hookSpecificOutput.additionalContext // empty')
if echo "$CTX_3" | grep -qF "acme Source Facts"; then
  pass "TC-01-3: additionalContext contains acme.md header"
else
  fail "TC-01-3: additionalContext missing acme.md header"
fi
if echo "$CTX_3" | grep -qF "Relevant Facts"; then
  pass "TC-01-3: additionalContext has 'Relevant Facts' section"
else
  fail "TC-01-3: additionalContext missing 'Relevant Facts' section"
fi

# =========================================================================
# TC-10-5: Empty MEMORY.md — on-prompt-submit exits cleanly
# =========================================================================
echo ""
echo "=== Edge Case: Empty MEMORY.md (TC-10-5) ==="

EMPTY_MEM_DIR="$TMPDIR/empty-mem-test"
mkdir -p "$EMPTY_MEM_DIR/vd-memory"
# Create an empty MEMORY.md (0 bytes)
: > "$EMPTY_MEM_DIR/vd-memory/MEMORY.md"

EMPTY_INPUT=$(jq -n --arg cwd "$EMPTY_MEM_DIR" --arg prompt "Hello, what do you know?" \
  '{cwd: $cwd, prompt: $prompt}')
EXIT_CODE=0
EMPTY_OUTPUT=$(echo "$EMPTY_INPUT" | bash "$HOOKS_DIR/on-prompt-submit.sh") || EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ]; then
  pass "TC-10-5: on-prompt-submit exits 0 with empty MEMORY.md"
else
  fail "TC-10-5: on-prompt-submit exited non-zero ($EXIT_CODE)"
fi
# Verify valid JSON output
if echo "$EMPTY_OUTPUT" | jq . > /dev/null 2>&1; then
  pass "TC-10-5: output is valid JSON"
else
  fail "TC-10-5: output is not valid JSON: $EMPTY_OUTPUT"
fi
# Verify hookEventName is present
EMPTY_EVENT=$(echo "$EMPTY_OUTPUT" | jq -r '.hookSpecificOutput.hookEventName // empty')
if [ "$EMPTY_EVENT" = "UserPromptSubmit" ]; then
  pass "TC-10-5: hookEventName is UserPromptSubmit"
else
  fail "TC-10-5: hookEventName is '$EMPTY_EVENT' (expected UserPromptSubmit)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ]
