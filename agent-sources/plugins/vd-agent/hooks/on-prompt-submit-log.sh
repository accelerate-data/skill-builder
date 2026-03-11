#!/bin/bash
# on-prompt-submit-log.sh — companion command hook for UserPromptSubmit
# Logs each prompt read event to vd-memory/reads/prompt-submit.log.
# on-prompt-submit.sh handles memory retrieval via additionalContext;
# this hook handles the write side effect (read event logging).

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // .user_prompt // empty' | head -c 500)
READS_DIR="$CWD/vd-memory/reads"
READ_LOG="$READS_DIR/prompt-submit.log"

# Debug: dump raw input for integration test diagnosis
if [ -n "${VD_HOOK_DEBUG:-}" ]; then
  echo "$INPUT" > "${VD_HOOK_DEBUG}/prompt-submit-debug.json"
fi

# Only log if vd-memory exists (don't create it from read hooks)
if [ ! -d "$CWD/vd-memory" ]; then
  exit 0
fi

mkdir -p "$READS_DIR"
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
cat >> "$READ_LOG" <<LOG

--- $TIMESTAMP ---
cwd: $CWD
prompt: $PROMPT
LOG

exit 0
