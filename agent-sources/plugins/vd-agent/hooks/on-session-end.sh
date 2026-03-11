#!/bin/bash
# on-session-end.sh — command hook for SessionEnd
# Writes a learning file with full hook input + recent transcript context

INPUT=$(cat)
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
TRANSCRIPT=$(echo "$INPUT" | jq -r '.transcript_path // empty')
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")
LEARNINGS_DIR="$CWD/vd-memory/learnings"
LEARNING_FILE="$LEARNINGS_DIR/learning-session-end-$TIMESTAMP.md"

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

cat > "$LEARNING_FILE" <<LEARNING
# Learning: session-end
**Timestamp**: $TIMESTAMP
**Hook**: SessionEnd

## Hook Input (raw)
\`\`\`json
$INPUT
\`\`\`

## Recent Transcript (last 5 turns)
\`\`\`
$RECENT_TURNS
\`\`\`
LEARNING

exit 0
