#!/usr/bin/env bash
# Package workspace agent instructions into plugin skill references.
#
# Sources:
#   - agent-sources/workspace/CLAUDE.md (full copy → workspace-context.md)
#   - agent-sources/workspace/skills/skill-builder-practices/ (content guidelines + best practices)
# Target: skills/building-skills/references/
#
# The app auto-loads workspace/CLAUDE.md into every agent's system prompt.
# The plugin packages it as workspace-context.md so the coordinator can inject
# it inline into every agent Task call via <agent-instructions> tags.
#
# Usage:
#   ./scripts/build-plugin-skill.sh           # Generate reference files
#   ./scripts/build-plugin-skill.sh --check   # Verify references match source (CI)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE="$ROOT_DIR/agent-sources/workspace/CLAUDE.md"
REFS_DIR="$ROOT_DIR/skills/building-skills/references"
BUNDLED_PRACTICES="$ROOT_DIR/agent-sources/workspace/skills/skill-builder-practices"

CHECK_MODE=false
if [[ "${1:-}" == "--check" ]]; then
    CHECK_MODE=true
fi

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: Source file not found: $SOURCE"
    exit 1
fi

if [[ ! -d "$BUNDLED_PRACTICES" ]]; then
    echo "ERROR: Bundled practices directory not found: $BUNDLED_PRACTICES"
    exit 1
fi

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

check_directory() {
    local source_dir="$1"
    local target_dir="$2"
    local label="$3"

    if $CHECK_MODE; then
        if [[ -d "$target_dir" ]] && diff -rq "$source_dir" "$target_dir" &>/dev/null; then
            : # Fresh
        else
            echo "STALE: $label"
            return 1
        fi
    else
        rm -rf "$target_dir"
        cp -R "$source_dir" "$target_dir"
        echo "  Copied: $label/"
    fi
}

# --- Write or check ---

if ! $CHECK_MODE; then
    mkdir -p "$REFS_DIR"
    echo "Packaging agent instructions into plugin skill references..."
fi

stale=0
generate_file "$REFS_DIR/workspace-context.md" "$(cat "$SOURCE")" || stale=$((stale + 1))
check_directory "$BUNDLED_PRACTICES" "$REFS_DIR/skill-builder-practices" "skill-builder-practices" || stale=$((stale + 1))

# Copy each skill from agent-sources/workspace/skills/ as a standalone plugin skill in skills/
SKILLS_SOURCE="$ROOT_DIR/agent-sources/workspace/skills"
for skill_src in "$SKILLS_SOURCE"/*/; do
    skill_name=$(basename "$skill_src")
    skill_dest="$ROOT_DIR/skills/$skill_name"
    check_directory "$skill_src" "$skill_dest" "$skill_name" || stale=$((stale + 1))
done

if $CHECK_MODE; then
    if [[ $stale -gt 0 ]]; then
        echo "ERROR: $stale reference(s) are stale. Run: scripts/build-plugin-skill.sh"
        exit 1
    else
        echo "All reference files are fresh."
        exit 0
    fi
else
    echo "Done — workspace-context.md + skill-builder-practices/ in skills/building-skills/references/"
    echo "      + research/, validate-skill/, skill-builder-practices/ in skills/"
fi
