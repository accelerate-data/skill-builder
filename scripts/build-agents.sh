#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATES_DIR="$ROOT_DIR/agents/templates"
TYPES_DIR="$ROOT_DIR/agents/types"

# --check mode: verify generated files are fresh (exit 1 if stale)
CHECK_MODE=false
if [[ "${1:-}" == "--check" ]]; then
    CHECK_MODE=true
fi

generated=0
stale=0

for type_dir in "$TYPES_DIR"/*/; do
    [[ -d "$type_dir" ]] || continue
    type_name=$(basename "$type_dir")

    # Skip types without config
    [[ -f "$type_dir/config.conf" ]] || continue

    # Parse config file safely (handles unquoted values with spaces)
    # Reset variables from previous iteration
    NAME_PREFIX=""
    ENTITY_EXAMPLES=""
    unset "${!FOCUS_LINE__@}" 2>/dev/null || true

    while IFS= read -r line; do
        # Skip comments and blank lines
        [[ "$line" =~ ^[[:space:]]*# ]] && continue
        [[ -z "${line// /}" ]] && continue
        # Split on first = sign
        key="${line%%=*}"
        value="${line#*=}"
        # Declare variable dynamically
        declare "$key=$value"
    done < "$type_dir/config.conf"

    for template in "$TEMPLATES_DIR"/*.md; do
        [[ -f "$template" ]] || continue
        phase=$(basename "$template" .md)
        phase_key="${phase//-/_}"  # research-concepts → research_concepts

        # Resolve variables
        focus_var="FOCUS_LINE__${phase_key}"
        focus_line="${!focus_var:-}"
        entity_examples="${ENTITY_EXAMPLES:-}"

        # Read template
        content=$(<"$template")

        # Replace simple placeholders
        content="${content//\{\{NAME_PREFIX\}\}/$NAME_PREFIX}"
        content="${content//\{\{FOCUS_LINE\}\}/$focus_line}"
        content="${content//\{\{ENTITY_EXAMPLES\}\}/$entity_examples}"

        # Replace multi-line OUTPUT_EXAMPLE
        example_file="$type_dir/output-examples/${phase}.md"
        if [[ -f "$example_file" ]]; then
            example_content=$(<"$example_file")
            # Use a temp file approach for multi-line replacement
            tmp=$(mktemp)
            while IFS= read -r line; do
                if [[ "$line" == *'{{OUTPUT_EXAMPLE}}'* ]]; then
                    echo "$example_content"
                else
                    echo "$line"
                fi
            done <<< "$content" > "$tmp"
            content=$(<"$tmp")
            rm -f "$tmp"
        else
            # Remove placeholder line if no example file
            content=$(echo "$content" | grep -v '{{OUTPUT_EXAMPLE}}')
        fi

        # Add auto-generated comment in frontmatter
        # Insert after opening --- line
        final_content=$(echo "$content" | sed '1 a\
# AUTO-GENERATED — do not edit. Source: agents/templates/'"$phase"'.md + agents/types/'"$type_name"'/config.conf\
# Regenerate with: scripts/build-agents.sh')

        # Target path
        target_dir="$ROOT_DIR/agents/$type_name"
        mkdir -p "$target_dir"
        target="$target_dir/$phase.md"

        if $CHECK_MODE; then
            if [[ -f "$target" ]] && diff -q <(echo "$final_content") "$target" &>/dev/null; then
                : # Fresh
            else
                echo "STALE: $target"
                stale=$((stale + 1))
            fi
        else
            echo "$final_content" > "$target"
            generated=$((generated + 1))
        fi
    done
done

if $CHECK_MODE; then
    if [[ $stale -gt 0 ]]; then
        echo "ERROR: $stale generated agent file(s) are stale. Run: scripts/build-agents.sh"
        exit 1
    else
        echo "All generated agent files are fresh."
        exit 0
    fi
else
    echo "Generated $generated agent files."
fi
