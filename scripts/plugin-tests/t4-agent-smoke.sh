#!/usr/bin/env bash
# t4-agent-smoke.sh — Spawn individual agents and verify output files

run_t4() {
  local tier="t4"
  local skill_name="pet-store-analytics"
  source "$TESTS_DIR/fixtures.sh"

  # ---- T4.1: Consolidate-research agent ----
  local consolidate_dir
  consolidate_dir=$(make_temp_dir "t4-consolidate")
  create_fixture_t4_consolidate "$consolidate_dir"
  log_verbose "Consolidate workspace: $consolidate_dir"

  local consolidate_prompt="You are the consolidate-research agent for the skill-builder plugin. Your job is to \
consolidate clarification questions from multiple research agents into a cohesive questionnaire.

Read these agent instructions for expected file formats and content principles: $PLUGIN_DIR/agent-sources/workspace/CLAUDE.md

Read these input files:
- $consolidate_dir/context/research-entities.md
- $consolidate_dir/context/research-metrics.md
- $consolidate_dir/context/clarifications-practices.md
- $consolidate_dir/context/clarifications-implementation.md

Consolidate them into a single cohesive file. Eliminate duplicates (like 'seasonal patterns' \
which appears in multiple files), rephrase for clarity, and organize into logical sections.

IMPORTANT: You MUST use the Write tool to create the file at: $consolidate_dir/context/clarifications.md

Return a summary: total input questions, duplicates removed, final question count."

  log_verbose "Running consolidate-research agent smoke test..."
  local consolidate_output
  consolidate_output=$(run_claude_unsafe "$consolidate_prompt" "$MAX_BUDGET_T4" 90 "$consolidate_dir")

  assert_file_exists "$tier" "consolidate_creates_output" "$consolidate_dir/context/clarifications.md" || true
  if [[ -s "$consolidate_dir/context/clarifications.md" ]]; then
    record_result "$tier" "consolidate_output_not_empty" "PASS"
  else
    record_result "$tier" "consolidate_output_not_empty" "FAIL" "output file empty or missing"
  fi

  # ---- T4.2: Reasoning agent ----
  local reason_dir
  reason_dir=$(make_temp_dir "t4-reasoning")
  create_fixture_t4_workspace "$reason_dir" "$skill_name"
  log_verbose "Reasoning workspace: $reason_dir"

  local reasoning_prompt="You are the reasoning agent for the skill-builder plugin. Your job is to \
analyze answered clarification questions and produce decisions.

Read these agent instructions for expected file formats and content principles: $PLUGIN_DIR/agent-sources/workspace/CLAUDE.md

Read these answered clarification files:
- $reason_dir/context/research-entities.md
- $reason_dir/context/clarifications.md

Analyze the answers. Look for:
- Gaps (unanswered or vague questions)
- Contradictions between answers
- Implications for data modeling decisions

Write your decisions to: $reason_dir/context/decisions.md

Use this format for each decision:
### D1: [Decision title]
- **Question**: [The original question]
- **Decision**: [The chosen answer]
- **Implication**: [What this means for skill design]

Return a summary of key conclusions, assumptions, and any conflicts found."

  log_verbose "Running reasoning agent smoke test..."
  local reasoning_output
  reasoning_output=$(run_claude_unsafe "$reasoning_prompt" "$MAX_BUDGET_T4" 120 "$reason_dir")

  assert_file_exists "$tier" "reasoning_creates_decisions" "$reason_dir/context/decisions.md" || true
  if [[ -f "$reason_dir/context/decisions.md" ]]; then
    if grep -q "^### D[0-9]" "$reason_dir/context/decisions.md"; then
      record_result "$tier" "decisions_format_valid" "PASS"
    else
      record_result "$tier" "decisions_format_valid" "FAIL" "no D-numbered decisions found"
    fi
  fi

  # ---- T4.3: Build agent (only if reasoning produced decisions) ----
  if [[ -s "$reason_dir/context/decisions.md" ]]; then
    local build_dir
    build_dir=$(make_temp_dir "t4-build")
    mkdir -p "$build_dir/$skill_name/references"
    mkdir -p "$build_dir/context"
    cp "$reason_dir/context/decisions.md" "$build_dir/context/"
    cp "$reason_dir/context/clarifications.md" "$build_dir/context/"
    log_verbose "Build workspace: $build_dir"

    local build_prompt="You are the build agent for the skill-builder plugin. Your job is to \
create the skill files based on decisions.

Read these agent instructions for expected file formats: $PLUGIN_DIR/agent-sources/workspace/CLAUDE.md
Read the decisions file: $build_dir/context/decisions.md

Domain: pet store analytics

Create the skill files:
1. Write SKILL.md to: $build_dir/$skill_name/SKILL.md
   - Keep it under 500 lines
   - Include: metadata, overview, when to use, quick reference, pointers to references
2. Write at least 2 reference files to: $build_dir/$skill_name/references/
   - Each should cover a distinct topic from the decisions

Return the folder structure and a summary of what was created."

    log_verbose "Running build agent smoke test..."
    local build_output
    build_output=$(run_claude_unsafe "$build_prompt" "$MAX_BUDGET_T4" 120 "$build_dir")

    assert_file_exists "$tier" "build_creates_skill_md" "$build_dir/$skill_name/SKILL.md" || true

    local ref_count
    ref_count=$(ls "$build_dir/$skill_name/references/"*.md 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$ref_count" -gt 0 ]]; then
      record_result "$tier" "build_creates_references" "PASS" "$ref_count reference files"
    else
      record_result "$tier" "build_creates_references" "FAIL" "no reference files created"
    fi
  else
    record_result "$tier" "build_creates_skill_md" "SKIP" "depends on reasoning output"
    record_result "$tier" "build_creates_references" "SKIP" "depends on reasoning output"
  fi
}
