#!/usr/bin/env bash
# test-plugin.sh — Reusable test harness for the skill-builder plugin
#
# Usage:
#   ./scripts/test-plugin.sh           # Run all tiers
#   ./scripts/test-plugin.sh t1        # Run only T1 (structural, free)
#   ./scripts/test-plugin.sh t1 t2     # Run T1 and T2
#   ./scripts/test-plugin.sh --list    # List available tiers
#
# Environment variables:
#   PLUGIN_DIR          Override plugin directory (default: script's parent)
#   MAX_BUDGET_T4       Max USD for T4 smoke tests (default: 0.50)
#   MAX_BUDGET_T5       Max USD for T5 E2E test (default: 5.00)
#   CLAUDE_BIN          Path to claude binary (default: claude)
#   KEEP_TEMP           Set to 1 to keep temp directories after run
#   VERBOSE             Set to 1 for verbose output

set -o pipefail

# ---------- Resolve paths ----------
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLUGIN_DIR="${PLUGIN_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
TESTS_DIR="$SCRIPT_DIR/tests"

# ---------- Source shared library ----------
source "$TESTS_DIR/lib.sh"

# ---------- Configuration ----------
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MAX_BUDGET_T4="${MAX_BUDGET_T4:-0.50}"
MAX_BUDGET_T5="${MAX_BUDGET_T5:-5.00}"
KEEP_TEMP="${KEEP_TEMP:-0}"
VERBOSE="${VERBOSE:-0}"

export PLUGIN_DIR CLAUDE_BIN TESTS_DIR
export MAX_BUDGET_T4 MAX_BUDGET_T5 KEEP_TEMP VERBOSE

# ---------- Tier helpers (bash 3.2 compatible — no associative arrays) ----------

tier_label() {
  case "$1" in
    t1) echo "Structural Validation (no LLM)" ;;
    t2) echo "Plugin Loading" ;;
    t3) echo "Start Mode Detection" ;;
    t4) echo "Agent Smoke Tests" ;;
    t5) echo "Full E2E Workflow" ;;
    *)  echo "Unknown" ;;
  esac
}

tier_file() {
  echo "$TESTS_DIR/$1-*.sh"
}

ALL_TIERS="t1 t2 t3 t4 t5"

is_valid_tier() {
  case "$1" in
    t1|t2|t3|t4|t5) return 0 ;;
    *) return 1 ;;
  esac
}

# ---------- Tag-to-tier mapping ----------
# Tags let you run tests by what changed, not by tier number.
#   @structure  → t1 (plugin.json, agent file count, frontmatter)
#   @agents     → t1 t4 (agent prompts, model tiers, smoke tests)
#   @coordinator → t1 t2 t3 (SKILL.md, plugin loading, mode detection)
#   @workflow   → t3 t5 (mode detection, full E2E)
#   @all        → t1 t2 t3 t4 t5

tiers_for_tag() {
  case "$1" in
    @structure)   echo "t1" ;;
    @agents)      echo "t1 t4" ;;
    @coordinator) echo "t1 t2 t3" ;;
    @workflow)    echo "t3 t5" ;;
    @all)         echo "$ALL_TIERS" ;;
    *)            echo "" ;;
  esac
}

# ---------- Parse arguments ----------
if [ "${1:-}" = "--list" ]; then
  echo "Available tiers:"
  for tier in $ALL_TIERS; do
    printf "  %-4s  %s\n" "$tier" "$(tier_label $tier)"
  done
  echo ""
  echo "Available tags:"
  echo "  @structure    t1 — plugin manifest, agent files, frontmatter"
  echo "  @agents       t1 t4 — agent prompts, model tiers, smoke tests"
  echo "  @coordinator  t1 t2 t3 — coordinator skill, plugin loading, modes"
  echo "  @workflow     t3 t5 — mode detection, full E2E workflow"
  echo "  @all          t1-t5 — everything"
  echo ""
  echo "Usage: $0 [t1|t2|t3|t4|t5|--tag TAG|...]"
  echo "  No args = run all tiers"
  exit 0
fi

REQUESTED_TIERS=""
if [ $# -eq 0 ]; then
  REQUESTED_TIERS="$ALL_TIERS"
else
  while [ $# -gt 0 ]; do
    arg="$1"
    if [ "$arg" = "--tag" ]; then
      tag="${2:-}"
      if [ -z "$tag" ]; then
        echo "ERROR: --tag requires a value. Use --list to see options."
        exit 1
      fi
      tag_tiers=$(tiers_for_tag "$tag")
      if [ -z "$tag_tiers" ]; then
        echo "ERROR: Unknown tag '$tag'. Use --list to see options."
        exit 1
      fi
      REQUESTED_TIERS="$REQUESTED_TIERS $tag_tiers"
      shift 2
    else
      tier=$(echo "$arg" | tr '[:upper:]' '[:lower:]')
      if ! is_valid_tier "$tier"; then
        echo "ERROR: Unknown tier '$arg'. Use --list to see options."
        exit 1
      fi
      REQUESTED_TIERS="$REQUESTED_TIERS $tier"
      shift
    fi
  done
fi

# Deduplicate tiers while preserving order
REQUESTED_TIERS=$(echo "$REQUESTED_TIERS" | tr ' ' '\n' | awk '!seen[$0]++' | tr '\n' ' ')

# ---------- Preflight checks ----------
echo "============================================"
echo " Skill Builder Plugin Test Harness"
echo "============================================"
echo "  Plugin dir:  $PLUGIN_DIR"
echo "  Claude bin:  $CLAUDE_BIN"
echo "  Tiers:       $REQUESTED_TIERS"
echo "  Timestamp:   $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
echo "============================================"
echo ""

# Verify claude is available (needed for T2+)
if ! command -v "$CLAUDE_BIN" >/dev/null 2>&1; then
  echo "WARNING: '$CLAUDE_BIN' not found in PATH (T2-T5 will fail)"
fi

# Verify plugin directory
if [ ! -f "$PLUGIN_DIR/.claude-plugin/plugin.json" ]; then
  echo "FATAL: No plugin.json at $PLUGIN_DIR/.claude-plugin/plugin.json"
  exit 1
fi

# Initialize results
init_results

# ---------- Run tiers ----------
for tier in $REQUESTED_TIERS; do
  echo ""
  echo "--------------------------------------------"
  echo " $tier: $(tier_label $tier)"
  echo "--------------------------------------------"

  # Find tier file
  tier_script="$TESTS_DIR/${tier}-"*.sh
  # Use glob to find the file
  tier_script_path=""
  for f in $tier_script; do
    if [ -f "$f" ]; then
      tier_script_path="$f"
      break
    fi
  done

  if [ -z "$tier_script_path" ]; then
    record_result "$tier" "TIER_LOAD" "SKIP" "Tier file not found"
    continue
  fi

  source "$tier_script_path"
  "run_${tier}"
done

# ---------- Summary ----------
print_summary
exit "$(get_exit_code)"
