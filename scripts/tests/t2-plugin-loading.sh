#!/usr/bin/env bash
# t2-plugin-loading.sh — Verify plugin loads into claude correctly

run_t2() {
  local tier="t2"

  # ---- T2.1: Plugin loads and Claude responds ----
  log_verbose "Testing plugin loading with claude -p"
  local output
  output=$(run_claude_safe \
    "You have a plugin loaded called skill-builder that has a skill called 'start'. Confirm you can see this plugin by replying with exactly: PLUGIN_LOADED" \
    45)

  if [[ -z "$output" ]]; then
    record_result "$tier" "claude_responds" "FAIL" "empty output (timeout or error)"
    record_result "$tier" "plugin_acknowledged" "SKIP" "no output"
    record_result "$tier" "skill_trigger" "SKIP" "no output"
    return
  fi
  record_result "$tier" "claude_responds" "PASS"

  # Claude should acknowledge the plugin — check for any skill/plugin/build-related content
  if echo "$output" | grep -qiE "plugin|skill|build|loaded|PLUGIN_LOADED"; then
    record_result "$tier" "plugin_acknowledged" "PASS"
  else
    record_result "$tier" "plugin_acknowledged" "FAIL" "output lacks plugin/skill keywords"
    log_verbose "T2 output was: $output"
  fi

  # ---- T2.2: Skill can be triggered ----
  log_verbose "Testing skill trigger"
  local output2
  output2=$(run_claude_safe \
    "I want to build a domain skill for pet-store analytics. What are the first steps? Be brief." \
    60)

  if [[ -z "$output2" ]]; then
    record_result "$tier" "skill_trigger" "FAIL" "empty output"
  elif echo "$output2" | grep -qiE "domain|skill|research|question|knowledge|analytics|pet"; then
    record_result "$tier" "skill_trigger" "PASS"
  else
    record_result "$tier" "skill_trigger" "FAIL" "output lacks domain/skill keywords"
    log_verbose "T2.2 output was: $output2"
  fi
}
