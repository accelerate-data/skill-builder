#!/bin/bash
# on-tool-use.sh — command hook for PostToolUse
# Detects "soft errors" in tool output (commands that exit 0 but contain error patterns)
# Writes a learning file when errors are found; exits silently otherwise

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")

# No-op if CWD is missing
if [ -z "$CWD" ]; then
  exit 0
fi

# Read tool output from stdin JSON, fall back to env var (for unit tests)
OUTPUT=$(echo "$INPUT" | jq -r '.tool_output // empty')
if [ -z "$OUTPUT" ]; then
  OUTPUT="${CLAUDE_TOOL_OUTPUT:-}"
fi
if [ -z "$OUTPUT" ]; then
  exit 0
fi

# Error/warning patterns — general, warnings, Python, dbt, SQL, and infra
ERROR_PATTERNS=(
  # General
  "error:" "Error:" "ERROR:" "FAILED" "fatal:" "Exception" "Traceback"
  # Warnings
  "WARNING" "WARN" "DeprecationWarning" "FutureWarning" "UserWarning"
  # Python errors
  "ValueError" "TypeError" "KeyError" "ImportError" "FileNotFoundError"
  "ConnectionError" "TimeoutError" "PermissionError"
  # dbt-specific
  "Compilation Error" "Database Error" "Runtime Error"
  "dbt test.*FAIL" "Encountered an error" "SKIP"
  # SQL-specific
  "syntax error" "invalid column" "relation.*does not exist"
  "permission denied" "deadlock" "constraint violation"
  # Tool/infra errors
  "No such file" "command not found" "ModuleNotFoundError"
  "panic:" "CRITICAL"
)

# Check if output contains any error pattern
contains_error=false
for pattern in "${ERROR_PATTERNS[@]}"; do
  if echo "$OUTPUT" | grep -qiE "$pattern" 2>/dev/null; then
    contains_error=true
    break
  fi
done

if [ "$contains_error" != true ]; then
  exit 0
fi

# Write learning file
LEARNINGS_DIR="$CWD/vd-memory/learnings"
LEARNING_FILE="$LEARNINGS_DIR/learning-tool-use-$TIMESTAMP.md"

# Auto-initialize vd-memory/ on first invocation
mkdir -p "$LEARNINGS_DIR"
if [ ! -f "$CWD/vd-memory/MEMORY.md" ]; then
  cat > "$CWD/vd-memory/MEMORY.md" <<'HEADER'
# Domain Memory
<!-- Auto-initialized by vd-agent plugin. Confirmed domain facts are added here. -->
<!-- Read hooks inject this file into agent context at the start of each session. -->
HEADER
fi

# Extract last 5 turns from transcript JSONL
RECENT_TURNS=""
if [ -n "$TRANSCRIPT" ] && [ -f "$TRANSCRIPT" ]; then
  RECENT_TURNS=$(tail -5 "$TRANSCRIPT" | jq -r '.message.content // .content // empty' 2>/dev/null | head -c 4000)
fi

# Truncate tool output for the learning file (keep first 4000 chars)
OUTPUT_EXCERPT=$(echo "$OUTPUT" | head -c 4000)

cat > "$LEARNING_FILE" <<LEARNING
# Learning: tool-use (soft error)
**Timestamp**: $TIMESTAMP
**Hook**: PostToolUse
**Tool**: $TOOL_NAME

## Hook Input (raw)
\`\`\`json
$INPUT
\`\`\`

## Tool Output (excerpt)
\`\`\`
$OUTPUT_EXCERPT
\`\`\`

## Recent Transcript (last 5 turns)
\`\`\`
$RECENT_TURNS
\`\`\`
LEARNING

exit 0
