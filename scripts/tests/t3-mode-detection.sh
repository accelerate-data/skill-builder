#!/usr/bin/env bash
# t3-mode-detection.sh — Start mode detection with fixture directories

run_t3() {
  local tier="t3"
  source "$TESTS_DIR/fixtures.sh"

  local skill_name="pet-store-analytics"
  local budget="${MAX_BUDGET_T3:-0.25}"

  # ---- T3.1: Mode C (scratch — empty directory) ----
  local dir_c
  dir_c=$(make_temp_dir "mode-c")
  log_verbose "Mode C workspace: $dir_c"

  local prompt_c="Check the current working directory for these two files:
1. workflow-state.md
2. $skill_name/SKILL.md

Then apply these rules:
- If workflow-state.md exists → this is 'Mode A'
- If $skill_name/SKILL.md exists but workflow-state.md does NOT → this is 'Mode B'
- If NEITHER file exists → this is 'Mode C'

Reply with ONLY the mode label, e.g. 'Mode C'. Nothing else."

  local output_c
  output_c=$(run_claude_unsafe "$prompt_c" "$budget" 60 "$dir_c")
  if [[ -n "$output_c" ]]; then
    assert_output_contains "$tier" "mode_c_scratch_detected" "$output_c" "Mode C" || true
  else
    record_result "$tier" "mode_c_scratch_detected" "FAIL" "empty output"
  fi

  # ---- T3.2: Mode A (resume — workflow-state.md exists) ----
  local dir_a
  dir_a=$(make_temp_dir "mode-a")
  create_fixture_mode_a "$dir_a" "$skill_name"
  log_verbose "Mode A workspace: $dir_a"

  local prompt_a="Check the current working directory for these two files:
1. workflow-state.md
2. $skill_name/SKILL.md

Then apply these rules:
- If workflow-state.md exists → this is 'Mode A'
- If $skill_name/SKILL.md exists but workflow-state.md does NOT → this is 'Mode B'
- If NEITHER file exists → this is 'Mode C'

Reply with ONLY the mode label, e.g. 'Mode A'. Nothing else."

  local output_a
  output_a=$(run_claude_unsafe "$prompt_a" "$budget" 60 "$dir_a")
  if [[ -n "$output_a" ]]; then
    assert_output_contains "$tier" "mode_a_resume_detected" "$output_a" "Mode A" || true
  else
    record_result "$tier" "mode_a_resume_detected" "FAIL" "empty output"
  fi

  # ---- T3.3: Mode B (modify — skill exists, no workflow-state) ----
  local dir_b
  dir_b=$(make_temp_dir "mode-b")
  create_fixture_mode_b "$dir_b" "$skill_name"
  log_verbose "Mode B workspace: $dir_b"

  local prompt_b="Check the current working directory for these two files:
1. workflow-state.md
2. $skill_name/SKILL.md

Then apply these rules:
- If workflow-state.md exists → this is 'Mode A'
- If $skill_name/SKILL.md exists but workflow-state.md does NOT → this is 'Mode B'
- If NEITHER file exists → this is 'Mode C'

Reply with ONLY the mode label, e.g. 'Mode B'. Nothing else."

  local output_b
  output_b=$(run_claude_unsafe "$prompt_b" "$budget" 60 "$dir_b")
  if [[ -n "$output_b" ]]; then
    assert_output_contains "$tier" "mode_b_modify_detected" "$output_b" "Mode B" || true
  else
    record_result "$tier" "mode_b_modify_detected" "FAIL" "empty output"
  fi
}
