#!/usr/bin/env bash
# Agent structural validation — runs automatically via hook after Edit/Write
# Also callable manually: ./scripts/validate.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$REPO_DIR"

ERRORS=0
WARNINGS=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  WARN: $1"; WARNINGS=$((WARNINGS + 1)); }

# ---------- Agent files + frontmatter ----------
echo "=== Agents ==="

# All 7 agents — flat in agents/ (name:expected_model)
ALL_AGENTS="answer-evaluator:haiku confirm-decisions:opus detailed-research:sonnet generate-skill:sonnet refine-skill:sonnet research-orchestrator:sonnet validate-skill:sonnet"

for entry in $ALL_AGENTS; do
  name="${entry%%:*}"
  expected_model="${entry##*:}"
  file="agents/${name}.md"

  if [ ! -f "$file" ]; then
    fail "$file missing"
    continue
  fi

  # Check frontmatter delimiters
  if ! head -1 "$file" | grep -q "^---"; then
    fail "$name — no YAML frontmatter"
    continue
  fi

  # Extract frontmatter (between first and second ---)
  fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$file")

  # Required fields
  for field in name description model; do
    if echo "$fm" | grep -q "^${field}:"; then
      :
    else
      fail "$name — missing '$field' in frontmatter"
    fi
  done

  # Check name matches
  actual_name=$(echo "$fm" | grep "^name:" | sed 's/name: *//')
  if [ "$actual_name" = "$name" ]; then
    pass "$name — name=$actual_name"
  else
    fail "$name — name=$actual_name, expected=$name"
  fi

  # Tools must be comma-separated string, not YAML list
  tools_line=$(echo "$fm" | grep "^tools:" || true)
  if [ -z "$tools_line" ]; then
    fail "$name — missing 'tools' in frontmatter"
  elif echo "$fm" | grep -q "^  - "; then
    fail "$name — tools must be comma-separated string, not YAML list"
  else
    pass "$name — frontmatter valid"
  fi

  # Model check
  actual_model=$(echo "$fm" | grep "^model:" | sed 's/model: *//')
  if [ "$actual_model" = "$expected_model" ]; then
    pass "$name — model=$actual_model"
  else
    fail "$name — model=$actual_model, expected=$expected_model"
  fi
done

# Check for unique names across all agents (frontmatter only)
echo "=== Name Uniqueness ==="
all_names=$(find agents/ -name "*.md" -exec \
  awk 'BEGIN{n=0} /^---$/{n++; next} n==1 && /^name:/{sub(/^name: */, ""); print}' {} \; | sort)
dupes=$(echo "$all_names" | uniq -d)
if [ -z "$dupes" ]; then
  pass "all $(echo "$all_names" | wc -l | tr -d ' ') agent names are unique"
else
  fail "duplicate agent names found: $dupes"
fi

# ---------- Workspace CLAUDE.md ----------
echo "=== Workspace CLAUDE.md ==="
if [ -f "agent-sources/workspace/CLAUDE.md" ]; then
  pass "agent-sources/workspace/CLAUDE.md exists"
else
  fail "agent-sources/workspace/CLAUDE.md not found"
fi

# ---------- Old files removed ----------
echo "=== Cleanup ==="
if [ -d "prompts" ]; then
  fail "prompts/ directory still exists (should be removed)"
else
  pass "prompts/ removed"
fi
if [ -d "cowork" ]; then
  fail "cowork/ directory still exists (should be removed)"
else
  pass "cowork/ removed"
fi

# ---------- .gitignore ----------
echo "=== .gitignore ==="
if [ -f ".gitignore" ]; then
  if grep -q "\*\.skill" .gitignore; then
    pass "*.skill is in .gitignore"
  else
    warn "*.skill not in .gitignore"
  fi
else
  warn ".gitignore not found"
fi

# ---------- Generate-skill agent: best practices in bundled skill ----------
echo "=== Generate-Skill Agent ==="
# SKILL.md structure guidance is in the bundled skill-builder-practices skill (referenced from CLAUDE.md)
if [ -f "agent-sources/workspace/skills/skill-builder-practices/SKILL.md" ]; then
  bp_content=$(cat "agent-sources/workspace/skills/skill-builder-practices/SKILL.md")
  if echo "$bp_content" | grep -q "Skill Structure"; then
    pass "bundled skill-builder-practices contains SKILL.md structure guidance"
  else
    fail "bundled skill-builder-practices missing SKILL.md structure guidance"
  fi
else
  fail "agent-sources/workspace/skills/skill-builder-practices/SKILL.md not found"
fi
if [ -f "agents/generate-skill.md" ]; then
  build_content=$(cat "agents/generate-skill.md")
  if echo "$build_content" | grep -q "references/"; then
    pass "generate-skill agent references references/ subfolder"
  else
    fail "generate-skill agent missing references/ subfolder structure"
  fi
else
  fail "agents/generate-skill.md not found"
fi

# ---------- Bundled Skills source ----------
echo "=== Bundled Skills ==="
BUNDLED_SKILLS_DIR="agent-sources/workspace/skills"
# skill-builder-practices is already checked above — this checks research skill
if [ -f "$BUNDLED_SKILLS_DIR/research/SKILL.md" ]; then
  fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$BUNDLED_SKILLS_DIR/research/SKILL.md")
  skill_name=$(echo "$fm" | grep "^name:" | sed 's/name: *//')
  if [ "$skill_name" = "research" ]; then
    pass "bundled research skill has correct name"
  else
    fail "bundled research skill name='$skill_name', expected 'research'"
  fi
  for ref in references/dimension-sets.md references/scoring-rubric.md references/consolidation-handoff.md; do
    if [ -f "$BUNDLED_SKILLS_DIR/research/$ref" ]; then
      pass "research/$ref exists"
    else
      fail "research/$ref missing"
    fi
  done
  dim_count=$(find "$BUNDLED_SKILLS_DIR/research/references/dimensions" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
  if [ "$dim_count" -eq 18 ]; then
    pass "research/references/dimensions has 18 dimension specs"
  else
    fail "research/references/dimensions has $dim_count dimension specs (expected 18)"
  fi
else
  fail "agent-sources/workspace/skills/research/SKILL.md not found"
fi
# validate-skill bundled skill
if [ -f "$BUNDLED_SKILLS_DIR/validate-skill/SKILL.md" ]; then
  fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$BUNDLED_SKILLS_DIR/validate-skill/SKILL.md")
  skill_name=$(echo "$fm" | grep "^name:" | sed 's/name: *//')
  if [ "$skill_name" = "validate-skill" ]; then
    pass "bundled validate-skill has correct name"
  else
    fail "bundled validate-skill name='$skill_name', expected 'validate-skill'"
  fi
  for ref in references/validate-quality-spec.md references/test-skill-spec.md references/companion-recommender-spec.md; do
    if [ -f "$BUNDLED_SKILLS_DIR/validate-skill/$ref" ]; then
      pass "validate-skill/$ref exists"
    else
      fail "validate-skill/$ref missing"
    fi
  done
else
  fail "agent-sources/workspace/skills/validate-skill/SKILL.md not found"
fi

# ---------- Summary ----------
echo ""
echo "=============================="
if [ $ERRORS -eq 0 ]; then
  echo "ALL CHECKS PASSED ($WARNINGS warnings)"
  exit 0
else
  echo "FAILED: $ERRORS errors, $WARNINGS warnings"
  exit 1
fi
