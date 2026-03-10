#!/bin/bash
# on-prompt-submit.sh — command hook for UserPromptSubmit
# Injects domain memory into conversation context via additionalContext.
# Replaces the former agent hook that broke on Claude Code v2.1.69+.

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROMPT=$(echo "$INPUT" | jq -r '.prompt // .user_prompt // empty')
MEMORY_FILE="$CWD/vd-memory/MEMORY.md"
FACTS_DIR="$CWD/vd-memory/facts"

if [ ! -f "$MEMORY_FILE" ]; then
  echo '{}'
  exit 0
fi

# Read first 200 lines of MEMORY.md
MEMORY_CONTENT=$(head -200 "$MEMORY_FILE")

# If prompt mentions a source, grep facts/ for relevant content
FACTS_CONTENT=""
if [ -n "$PROMPT" ] && [ -d "$FACTS_DIR" ]; then
  # Extract potential source keywords (lowercase, alphanumeric tokens 3+ chars)
  KEYWORDS=$(echo "$PROMPT" | tr '[:upper:]' '[:lower:]' | grep -oE '[a-z0-9]{3,}' | sort -u)
  for kw in $KEYWORDS; do
    MATCHES=$(grep -ril "$kw" "$FACTS_DIR" 2>/dev/null | head -3)
    for match in $MATCHES; do
      SNIPPET=$(head -50 "$match")
      FACTS_CONTENT="${FACTS_CONTENT}
--- $(basename "$match") ---
${SNIPPET}
"
    done
  done
fi

# Combine memory + any matched facts
if [ -n "$FACTS_CONTENT" ]; then
  COMBINED="${MEMORY_CONTENT}

## Relevant Facts
${FACTS_CONTENT}"
else
  COMBINED="$MEMORY_CONTENT"
fi

jq -n --arg ctx "$COMBINED" '{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": $ctx
  }
}'
