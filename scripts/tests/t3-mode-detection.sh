#!/usr/bin/env bash
# t3-mode-detection.sh — Start mode detection with fixture directories

run_t3() {
  local tier="t3"
  source "$TESTS_DIR/fixtures.sh"

  local skill_name="pet-store-analytics"

  # ---- T3.1: Mode C (scratch — empty directory) ----
  local dir_c
  dir_c=$(make_temp_dir "mode-c")
  log_verbose "Mode C workspace: $dir_c"

  local prompt_c="You are testing the skill-builder plugin's mode detection. \
Look at the filesystem in the current working directory. \
The plugin's coordinator (skills/start/SKILL.md) detects start mode based on: \
- Mode A (Resume): workflow-state.md exists \
- Mode B (Modify): <skillname>/SKILL.md exists but no workflow-state.md \
- Mode C (Scratch): neither exists \
\
The skill name would be '$skill_name'. \
Check this directory for workflow-state.md and $skill_name/SKILL.md. \
Which mode applies? Answer ONLY with: Mode A, Mode B, or Mode C"

  local output_c
  output_c=$(run_claude_safe "$prompt_c" 45 "$dir_c")
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

  local prompt_a="You are testing the skill-builder plugin's mode detection. \
Look at the filesystem in the current working directory. \
The plugin's coordinator detects start mode based on: \
- Mode A (Resume): workflow-state.md exists \
- Mode B (Modify): <skillname>/SKILL.md exists but no workflow-state.md \
- Mode C (Scratch): neither exists \
\
The skill name would be '$skill_name'. \
Check this directory for workflow-state.md and $skill_name/SKILL.md. \
Which mode applies? Answer ONLY with: Mode A, Mode B, or Mode C"

  local output_a
  output_a=$(run_claude_safe "$prompt_a" 45 "$dir_a")
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

  local prompt_b="You are testing the skill-builder plugin's mode detection. \
Look at the filesystem in the current working directory. \
The plugin's coordinator detects start mode based on: \
- Mode A (Resume): workflow-state.md exists \
- Mode B (Modify): <skillname>/SKILL.md exists but no workflow-state.md \
- Mode C (Scratch): neither exists \
\
The skill name would be '$skill_name'. \
Check this directory for workflow-state.md and $skill_name/SKILL.md. \
Which mode applies? Answer ONLY with: Mode A, Mode B, or Mode C"

  local output_b
  output_b=$(run_claude_safe "$prompt_b" 45 "$dir_b")
  if [[ -n "$output_b" ]]; then
    assert_output_contains "$tier" "mode_b_modify_detected" "$output_b" "Mode B" || true
  else
    record_result "$tier" "mode_b_modify_detected" "FAIL" "empty output"
  fi
}
