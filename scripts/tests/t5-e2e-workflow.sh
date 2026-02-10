#!/usr/bin/env bash
# t5-e2e-workflow.sh — Full E2E workflow (expensive, uses --max-budget-usd)

run_t5() {
  local tier="t5"
  local skill_name="pet-store-analytics"

  local workspace
  workspace=$(make_temp_dir "t5-e2e")
  log_verbose "T5 workspace: $workspace"

  local e2e_prompt="Run the /skill-builder:start workflow.

Domain: pet store analytics
Skill name: pet-store-analytics

IMPORTANT — AUTOMATED TEST RUN:
This is an automated test. For ALL human review gates (Steps 2, 5, 6, 7, 8, 9):
- Do NOT wait for human input.
- Accept the agent's recommendations as-is and proceed to the next step immediately.
- When a step says 'wait for the user to confirm', treat it as 'the user confirmed, proceed.'
- For questions in clarification files, if Answer is empty, use the Recommendation as the answer.

Work in this directory: $workspace
The plugin root is: $PLUGIN_DIR

Complete all 10 steps. If you hit a budget limit, that's OK — go as far as you can.

When you finish (or are forced to stop), write the number of the last completed step to: \
$workspace/test-status.txt (just the number, e.g., '7')"

  log_verbose "Running full E2E workflow (budget: \$$MAX_BUDGET_T5)..."
  echo "  (this may take several minutes)"

  local e2e_output
  e2e_output=$(run_claude_unsafe "$e2e_prompt" "$MAX_BUDGET_T5" 600 "$workspace")

  # ---- Check workflow artifacts at each step ----

  # Step 0: Init — workflow-state.md created
  if [[ -f "$workspace/workflow-state.md" ]]; then
    record_result "$tier" "init_workflow_state" "PASS"
  else
    record_result "$tier" "init_workflow_state" "FAIL" "workflow-state.md not created"
  fi

  # Step 0: Init — context dir created
  if [[ -d "$workspace/context" ]]; then
    record_result "$tier" "init_context_dir" "PASS"
  else
    record_result "$tier" "init_context_dir" "FAIL"
  fi

  # Step 1: Research concepts output
  if [[ -f "$workspace/context/clarifications-concepts.md" ]]; then
    record_result "$tier" "step1_concepts_research" "PASS"
  else
    record_result "$tier" "step1_concepts_research" "SKIP" "may not have reached step 1"
  fi

  # Steps 3-4: Pattern/data research + merge
  if [[ -f "$workspace/context/clarifications-patterns.md" ]]; then
    record_result "$tier" "step3_patterns_research" "PASS"
  else
    record_result "$tier" "step3_patterns_research" "SKIP" "may not have reached step 3"
  fi

  if [[ -f "$workspace/context/clarifications-data.md" ]]; then
    record_result "$tier" "step3_data_research" "PASS"
  else
    record_result "$tier" "step3_data_research" "SKIP" "may not have reached step 3"
  fi

  if [[ -f "$workspace/context/clarifications.md" ]]; then
    record_result "$tier" "step4_merged_clarifications" "PASS"
  else
    record_result "$tier" "step4_merged_clarifications" "SKIP" "may not have reached step 4"
  fi

  # Step 6: Reasoning decisions
  if [[ -f "$workspace/context/decisions.md" ]]; then
    record_result "$tier" "step6_decisions" "PASS"
  else
    record_result "$tier" "step6_decisions" "SKIP" "may not have reached step 6"
  fi

  # Step 7: Build skill
  if [[ -f "$workspace/$skill_name/SKILL.md" ]]; then
    record_result "$tier" "step7_skill_built" "PASS"
  else
    record_result "$tier" "step7_skill_built" "SKIP" "may not have reached step 7"
  fi

  local ref_count=0
  if [[ -d "$workspace/$skill_name/references" ]]; then
    ref_count=$(ls "$workspace/$skill_name/references/"*.md 2>/dev/null | wc -l | tr -d ' ')
  fi
  if [[ "$ref_count" -gt 0 ]]; then
    record_result "$tier" "step7_references_created" "PASS" "$ref_count files"
  else
    record_result "$tier" "step7_references_created" "SKIP" "may not have reached step 7"
  fi

  # Step 8: Validation
  if [[ -f "$workspace/context/agent-validation-log.md" ]]; then
    record_result "$tier" "step8_validation_log" "PASS"
  else
    record_result "$tier" "step8_validation_log" "SKIP" "may not have reached step 8"
  fi

  # Step 9: Testing
  if [[ -f "$workspace/context/test-skill.md" ]]; then
    record_result "$tier" "step9_test_report" "PASS"
  else
    record_result "$tier" "step9_test_report" "SKIP" "may not have reached step 9"
  fi

  # Step 10: Package
  if [[ -f "$workspace/${skill_name}.skill" ]]; then
    record_result "$tier" "step10_skill_packaged" "PASS"
  else
    record_result "$tier" "step10_skill_packaged" "SKIP" "may not have reached step 10"
  fi

  # Report how far we got
  if [[ -f "$workspace/test-status.txt" ]]; then
    local last_step
    last_step=$(cat "$workspace/test-status.txt" | tr -d '[:space:]')
    record_result "$tier" "last_completed_step" "PASS" "reached step $last_step"
  else
    record_result "$tier" "last_completed_step" "SKIP" "no status file written"
  fi

  # Log workspace for debugging
  log_verbose "E2E workspace contents:"
  if [[ "$VERBOSE" == "1" ]]; then
    find "$workspace" -type f 2>/dev/null | sort | while read -r f; do
      echo "    $f"
    done
  fi
}
