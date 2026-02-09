#!/usr/bin/env bash
# t2-plugin-loading.sh — Verify plugin loads into claude correctly

run_t2() {
  local tier="t2"

  # ---- T2.1: Plugin loads ----
  log_verbose "Testing plugin loading with claude -p"
  local output
  output=$(run_claude_safe \
    "List all plugins you have loaded. Include plugin names and versions. Be concise." \
    45)
  local exit_code=$?

  if [[ -z "$output" ]]; then
    record_result "$tier" "claude_responds" "FAIL" "empty output (timeout or error)"
    record_result "$tier" "output_mentions_skill_builder" "SKIP" "no output"
    record_result "$tier" "skill_discoverable" "SKIP" "no output"
    return
  fi
  record_result "$tier" "claude_responds" "PASS"

  # Check that output mentions the plugin name
  assert_output_contains "$tier" "output_mentions_skill_builder" "$output" "skill-builder" || true

  # ---- T2.2: Skill discoverable ----
  log_verbose "Testing skill discovery"
  local output2
  output2=$(run_claude_safe \
    "What skills do you have access to from plugins? List their names. Be concise." \
    45)

  if [[ -n "$output2" ]]; then
    assert_output_contains "$tier" "skill_discoverable" "$output2" "start" || true
  else
    record_result "$tier" "skill_discoverable" "FAIL" "empty output"
  fi
}
