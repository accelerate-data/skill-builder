#!/usr/bin/env bash
# Package workspace agent instructions into plugin skill references.
#
# Source: agent-sources/workspace/CLAUDE.md
# Target: skills/generate-skill/references/
#
# The app auto-loads workspace/CLAUDE.md into every agent's system prompt.
# The plugin packages the same content as reference files so the coordinator
# can pass them inline to sub-agents, making the skill self-contained.
#
# Usage:
#   ./scripts/build-plugin-skill.sh           # Generate reference files
#   ./scripts/build-plugin-skill.sh --check   # Verify references match source (CI)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$ROOT_DIR/agent-sources/workspace/CLAUDE.md"
REFS_DIR="$ROOT_DIR/skills/generate-skill/references"

CHECK_MODE=false
if [[ "${1:-}" == "--check" ]]; then
    CHECK_MODE=true
fi

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: Source file not found: $SOURCE"
    exit 1
fi

# Extract a range of sections from workspace/CLAUDE.md.
# Uses awk to extract content between start/end section headers.
extract_sections() {
    local start_pattern="$1"
    local end_pattern="$2"
    awk "
        /^${start_pattern}/ { capture=1 }
        capture && /^${end_pattern}/ { exit }
        capture { print }
    " "$SOURCE"
}

generate_file() {
    local target="$1"
    local content="$2"
    local name
    name=$(basename "$target")

    if $CHECK_MODE; then
        if [[ -f "$target" ]] && diff -q <(echo "$content") "$target" &>/dev/null; then
            : # Fresh
        else
            echo "STALE: $name"
            return 1
        fi
    else
        echo "$content" > "$target"
        echo "  Generated: $name"
    fi
}

# Trim trailing blank lines and --- separators (macOS-compatible)
trim_trailing() {
    awk '
        { lines[NR] = $0; last = NR }
        END {
            while (last > 0 && (lines[last] ~ /^[[:space:]]*$/ || lines[last] == "---")) last--
            for (i = 1; i <= last; i++) print lines[i]
        }
    '
}

# --- Extract sections ---

# protocols.md: ## Protocols → ## Skill Users
protocols=$(extract_sections "## Protocols" "## Skill Users" | trim_trailing)

# content-guidelines.md: ## Skill Users through ## Output Paths (before ## File Formats)
content_guidelines=$(extract_sections "## Skill Users" "## File Formats" | trim_trailing)

# file-formats.md: ## File Formats → ## Skill Best Practices
file_formats=$(extract_sections "## File Formats" "## Skill Best Practices" | trim_trailing)

# best-practices.md: ## Skill Best Practices → ## Customization
best_practices=$(extract_sections "## Skill Best Practices" "## Customization" | trim_trailing)

# --- Write or check ---

if ! $CHECK_MODE; then
    mkdir -p "$REFS_DIR"
    echo "Packaging agent instructions into plugin skill references..."
fi

stale=0
generate_file "$REFS_DIR/protocols.md" "$protocols" || stale=$((stale + 1))
generate_file "$REFS_DIR/content-guidelines.md" "$content_guidelines" || stale=$((stale + 1))
generate_file "$REFS_DIR/file-formats.md" "$file_formats" || stale=$((stale + 1))
generate_file "$REFS_DIR/best-practices.md" "$best_practices" || stale=$((stale + 1))

if $CHECK_MODE; then
    if [[ $stale -gt 0 ]]; then
        echo "ERROR: $stale reference file(s) are stale. Run: scripts/build-plugin-skill.sh"
        exit 1
    else
        echo "All reference files are fresh."
        exit 0
    fi
else
    echo "Done — 4 reference files in skills/generate-skill/references/"
fi
