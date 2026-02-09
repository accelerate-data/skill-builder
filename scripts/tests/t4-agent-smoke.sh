#!/usr/bin/env bash
# t4-agent-smoke.sh — Spawn individual agents and verify output files

run_t4() {
  local tier="t4"
  local skill_name="pet-store-analytics"
  source "$TESTS_DIR/fixtures.sh"

  # ---- T4.1: Merge agent ----
  local merge_dir
  merge_dir=$(make_temp_dir "t4-merge")
  create_fixture_t4_merge "$merge_dir"
  log_verbose "Merge workspace: $merge_dir"

  local merge_prompt="You are the merge agent for the skill-builder plugin. Your job is to \
merge and deduplicate clarification questions from research agents.

Read the shared context file for expected formats: $PLUGIN_DIR/references/shared-context.md

Read these two input files:
- $merge_dir/context/clarifications-patterns.md
- $merge_dir/context/clarifications-data.md

Merge them into a single deduplicated file. Remove duplicate questions (like 'seasonal patterns' \
which appears in both files). Preserve the clarifications-*.md format from the shared context.

Write merged output to: $merge_dir/context/clarifications.md

Return a summary: total input questions, duplicates removed, final question count."

  log_verbose "Running merge agent smoke test..."
  local merge_output
  merge_output=$(run_claude_unsafe "$merge_prompt" "$MAX_BUDGET_T4" 90 "$merge_dir")

  assert_file_exists "$tier" "merge_creates_output" "$merge_dir/context/clarifications.md" || true
  if [[ -s "$merge_dir/context/clarifications.md" ]]; then
    record_result "$tier" "merge_output_not_empty" "PASS"
  else
    record_result "$tier" "merge_output_not_empty" "FAIL" "output file empty or missing"
  fi

  # ---- T4.2: Reasoning agent ----
  local reason_dir
  reason_dir=$(make_temp_dir "t4-reasoning")
  create_fixture_t4_workspace "$reason_dir" "$skill_name"
  log_verbose "Reasoning workspace: $reason_dir"

  local reasoning_prompt="You are the reasoning agent for the skill-builder plugin. Your job is to \
analyze answered clarification questions and produce decisions.

Read the shared context file for expected formats: $PLUGIN_DIR/references/shared-context.md

Read these answered clarification files:
- $reason_dir/context/clarifications-concepts.md
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

Read the shared context file: $PLUGIN_DIR/references/shared-context.md
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
