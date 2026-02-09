#!/usr/bin/env bash
# Plugin structure validation — runs automatically via hook after Edit/Write
# Also callable manually: ./scripts/validate.sh
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

PLUGIN_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PLUGIN_DIR"

ERRORS=0
WARNINGS=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; ERRORS=$((ERRORS + 1)); }
warn() { echo "  WARN: $1"; WARNINGS=$((WARNINGS + 1)); }

# ---------- T1.1: Manifest ----------
echo "=== Manifest ==="
if [ -f ".claude-plugin/plugin.json" ]; then
  if python3 -m json.tool .claude-plugin/plugin.json > /dev/null 2>&1; then
    pass "plugin.json is valid JSON"
  else
    fail "plugin.json is not valid JSON"
  fi

  for field in name version description; do
    if python3 -c "import json; d=json.load(open('.claude-plugin/plugin.json')); assert '$field' in d" 2>/dev/null; then
      pass "plugin.json has '$field'"
    else
      fail "plugin.json missing '$field'"
    fi
  done
else
  fail ".claude-plugin/plugin.json not found"
fi

# ---------- T1.2 + T1.3: Agent files + frontmatter ----------
echo "=== Agents ==="

AGENTS="research-concepts:sonnet research-patterns:sonnet research-data:sonnet merge:haiku reasoning:opus build:sonnet validate:sonnet test:sonnet"

for entry in $AGENTS; do
  agent="${entry%%:*}"
  expected="${entry##*:}"
  file="agents/${agent}.md"

  if [ ! -f "$file" ]; then
    fail "$file missing"
    continue
  fi

  # Check frontmatter delimiters
  if ! head -1 "$file" | grep -q "^---"; then
    fail "$agent — no YAML frontmatter"
    continue
  fi

  # Extract frontmatter (between first and second ---)
  fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$file")

  # Required fields
  for field in name description model; do
    if echo "$fm" | grep -q "^${field}:"; then
      :
    else
      fail "$agent — missing '$field' in frontmatter"
    fi
  done

  # Tools must be comma-separated string, not YAML list
  tools_line=$(echo "$fm" | grep "^tools:" || true)
  if [ -z "$tools_line" ]; then
    fail "$agent — missing 'tools' in frontmatter"
  elif echo "$fm" | grep -q "^  - "; then
    fail "$agent — tools must be comma-separated string, not YAML list"
  else
    pass "$agent — frontmatter valid"
  fi

  # Model check
  actual=$(echo "$fm" | grep "^model:" | sed 's/model: *//')
  if [ "$actual" = "$expected" ]; then
    pass "$agent — model=$actual"
  else
    fail "$agent — model=$actual, expected=$expected"
  fi
done

# ---------- T1.4: Skill file ----------
echo "=== Coordinator Skill ==="
if [ -f "skills/start/SKILL.md" ]; then
  if head -1 "skills/start/SKILL.md" | grep -q "^---"; then
    pass "skills/start/SKILL.md exists with frontmatter"
  else
    fail "skills/start/SKILL.md has no YAML frontmatter"
  fi
else
  fail "skills/start/SKILL.md not found"
fi

# ---------- T1.5: Shared context ----------
echo "=== Shared Context ==="
if [ -f "references/shared-context.md" ]; then
  pass "references/shared-context.md exists"
else
  fail "references/shared-context.md not found"
fi

# ---------- T1.6: Old files removed ----------
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

# ---------- T1.7: .gitignore ----------
echo "=== .gitignore ==="
if [ -f ".gitignore" ]; then
  if grep -q "^skills/" .gitignore; then
    fail "skills/ is in .gitignore (plugin skills/ must be tracked)"
  else
    pass "skills/ is NOT in .gitignore"
  fi
  if grep -q "\.claude/" .gitignore; then
    pass ".claude/ is in .gitignore"
  else
    warn ".claude/ not in .gitignore"
  fi
  if grep -q "\*\.skill" .gitignore; then
    pass "*.skill is in .gitignore"
  else
    warn "*.skill not in .gitignore"
  fi
else
  warn ".gitignore not found"
fi

# ---------- T3.4: Coordinator content checks ----------
echo "=== Coordinator Content ==="
if [ -f "skills/start/SKILL.md" ]; then
  content=$(cat "skills/start/SKILL.md")
  for keyword in "TeamCreate" "TeamDelete" "CLAUDE_PLUGIN_ROOT" "workflow-state.md" "skill-builder:"; do
    if echo "$content" | grep -q "$keyword"; then
      pass "coordinator references $keyword"
    else
      fail "coordinator missing reference to $keyword"
    fi
  done
  # Start modes
  for mode in "Mode A" "Mode B" "Mode C"; do
    if echo "$content" | grep -q "$mode"; then
      pass "coordinator has $mode"
    else
      fail "coordinator missing $mode (start modes)"
    fi
  done
fi

# ---------- Build agent: progressive disclosure ----------
echo "=== Build Agent ==="
if [ -f "agents/build.md" ]; then
  build_content=$(cat "agents/build.md")
  if echo "$build_content" | grep -q "progressive disclosure"; then
    pass "build agent references progressive disclosure"
  else
    fail "build agent missing progressive disclosure guidance"
  fi
  if echo "$build_content" | grep -q "references/"; then
    pass "build agent references references/ subfolder"
  else
    fail "build agent missing references/ subfolder structure"
  fi
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
