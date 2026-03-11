#!/bin/bash
# on-subagent-start.sh — command hook for SubagentStart
# Injects domain memory into subagent context via additionalContext.
# Also appends a read event to vd-memory/reads/subagent-start.log.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
MEMORY_FILE="$CWD/vd-memory/MEMORY.md"
READS_DIR="$CWD/vd-memory/reads"
READ_LOG="$READS_DIR/subagent-start.log"

if [ ! -f "$MEMORY_FILE" ]; then
  exit 0
fi

MEMORY_CONTENT=$(head -200 "$MEMORY_FILE")

# Log this read event (append-only)
mkdir -p "$READS_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
cat >> "$READ_LOG" <<LOG

--- $TIMESTAMP ---
cwd: $CWD
$MEMORY_CONTENT
LOG

jq -n --arg ctx "$MEMORY_CONTENT" '{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": $ctx
  }
}'
