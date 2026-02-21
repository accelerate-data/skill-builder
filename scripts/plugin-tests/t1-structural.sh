#!/usr/bin/env bash
# t1-structural.sh — Structural validation (no LLM calls)

run_t1() {
  local tier="t1"

  # ---- T1.1: claude plugin validate ----
  log_verbose "Running: $CLAUDE_BIN plugin validate $PLUGIN_DIR"
  local output
  output=$("$CLAUDE_BIN" plugin validate "$PLUGIN_DIR" 2>&1) || true
  local exit_code=$?
  if [[ $exit_code -eq 0 ]]; then
    record_result "$tier" "claude_plugin_validate" "PASS"
  else
    record_result "$tier" "claude_plugin_validate" "FAIL" "exit=$exit_code; ${output:0:200}"
  fi

  # ---- T1.2: scripts/validate.sh ----
  log_verbose "Running: $PLUGIN_DIR/scripts/validate.sh"
  local val_output val_exit
  val_output=$("$PLUGIN_DIR/scripts/validate.sh" 2>&1) || true
  val_exit=$?

  if [[ $val_exit -eq 0 ]]; then
    record_result "$tier" "validate_sh_overall" "PASS"
  else
    local fail_count
    fail_count=$(echo "$val_output" | grep -c "^  FAIL:" || true)
    record_result "$tier" "validate_sh_overall" "FAIL" "$fail_count individual failures"
  fi

  # ---- T1.3: Agent file count (7 flat agents) ----
  local agent_count
  agent_count=$(find "$PLUGIN_DIR/agents" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
  assert_count_eq "$tier" "agent_file_count_is_7" "7" "$agent_count"

  # ---- T1.4: Each expected agent exists in agents/ ----
  local all_agents="answer-evaluator confirm-decisions detailed-research generate-skill refine-skill research-orchestrator validate-skill"

  for agent in $all_agents; do
    assert_file_exists "$tier" "agent_${agent}" "$PLUGIN_DIR/agents/${agent}.md"
  done

  # ---- T1.5: Agent frontmatter present ----
  local agents_without_fm=0
  for agent in $all_agents; do
    local file="$PLUGIN_DIR/agents/${agent}.md"
    if [[ -f "$file" ]]; then
      local first_line
      first_line=$(head -1 "$file")
      if [[ "$first_line" != "---" ]]; then
        agents_without_fm=$((agents_without_fm + 1))
      fi
    fi
  done
  if [[ $agents_without_fm -eq 0 ]]; then
    record_result "$tier" "all_agents_have_frontmatter" "PASS"
  else
    record_result "$tier" "all_agents_have_frontmatter" "FAIL" "$agents_without_fm agents missing frontmatter"
  fi

  # ---- T1.6: Agent model tiers correct (bash 3.2 compatible) ----
  local model_errors=0
  expected_model_for() {
    case "$1" in
      confirm-decisions) echo "opus" ;;
      answer-evaluator) echo "haiku" ;;
      *) echo "sonnet" ;;
    esac
  }
  for agent in $all_agents; do
    local file="$PLUGIN_DIR/agents/${agent}.md"
    if [ -f "$file" ]; then
      local fm
      fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$file")
      local actual_model
      actual_model=$(echo "$fm" | grep "^model:" | sed 's/model: *//')
      local expected_model
      expected_model=$(expected_model_for "$agent")
      if [ "$actual_model" != "$expected_model" ]; then
        record_result "$tier" "model_${agent}" "FAIL" "expected=$expected_model, got=$actual_model"
        model_errors=$((model_errors + 1))
      fi
    fi
  done
  if [ $model_errors -eq 0 ]; then
    record_result "$tier" "all_model_tiers_correct" "PASS"
  fi

  # ---- T1.7: Coordinator frontmatter ----
  local coord_first
  coord_first=$(head -1 "$PLUGIN_DIR/skills/generate-skill/SKILL.md")
  if [[ "$coord_first" == "---" ]]; then
    record_result "$tier" "coordinator_has_frontmatter" "PASS"
  else
    record_result "$tier" "coordinator_has_frontmatter" "FAIL" "first line: $coord_first"
  fi

  # ---- T1.8: Workspace CLAUDE.md exists (auto-loaded agent instructions + protocols) ----
  assert_file_exists "$tier" "workspace_claude_md_exists" "$PLUGIN_DIR/agent-sources/workspace/CLAUDE.md"

  # ---- T1.9: plugin.json required fields ----
  local pj="$PLUGIN_DIR/.claude-plugin/plugin.json"
  if [[ -f "$pj" ]]; then
    for field in name version description skills; do
      if python3 -c "import json,sys; d=json.load(open('$pj')); sys.exit(0 if '$field' in d else 1)" 2>/dev/null; then
        record_result "$tier" "plugin_json_has_${field}" "PASS"
      else
        record_result "$tier" "plugin_json_has_${field}" "FAIL" "missing field"
      fi
    done
  else
    record_result "$tier" "plugin_json_exists" "FAIL" "file not found"
  fi

  # ---- T1.11: Agent prompt canonical format compliance ----
  # Scan all agent .md files for anti-patterns that violate the canonical format spec.
  local format_errors=0
  for agent_file in "$PLUGIN_DIR"/agents/*.md; do
    [ -f "$agent_file" ] || continue
    local agent_basename
    agent_basename=$(basename "$agent_file")

    # **Answer**: (colon outside bold) — canonical is **Answer:**
    if grep -qE '\*\*Answer\*\*:' "$agent_file" 2>/dev/null; then
      record_result "$tier" "format_no_answer_colon_outside_bold_${agent_basename}" "FAIL" "Found **Answer**: in $agent_basename"
      format_errors=$((format_errors + 1))
    fi

    # **Recommendation**: (colon outside bold) — canonical is **Recommendation:**
    if grep -qE '\*\*Recommendation\*\*:' "$agent_file" 2>/dev/null; then
      record_result "$tier" "format_no_recommendation_colon_outside_bold_${agent_basename}" "FAIL" "Found **Recommendation**: in $agent_basename"
      format_errors=$((format_errors + 1))
    fi

    # - [ ] checkbox choice format — canonical is A. text
    if grep -qE '^[[:space:]]*- \[([ x])\]' "$agent_file" 2>/dev/null; then
      record_result "$tier" "format_no_checkbox_choices_${agent_basename}" "FAIL" "Found checkbox choices in $agent_basename"
      format_errors=$((format_errors + 1))
    fi

    # **Choices**: label (not needed)
    if grep -qE '\*\*Choices\*\*[:\*]' "$agent_file" 2>/dev/null; then
      record_result "$tier" "format_no_choices_label_${agent_basename}" "FAIL" "Found **Choices**: label in $agent_basename"
      format_errors=$((format_errors + 1))
    fi

    # **Question**: label (not needed)
    if grep -qE '\*\*Question\*\*[:\*]' "$agent_file" 2>/dev/null; then
      record_result "$tier" "format_no_question_label_${agent_basename}" "FAIL" "Found **Question**: label in $agent_basename"
      format_errors=$((format_errors + 1))
    fi
  done
  if [ $format_errors -eq 0 ]; then
    record_result "$tier" "agent_canonical_format_compliance" "PASS"
  fi

  # ---- T1.10: Coordinator references key concepts ----
  local coord_content
  coord_content=$(cat "$PLUGIN_DIR/skills/generate-skill/SKILL.md")
  for keyword in "CLAUDE_PLUGIN_ROOT" "references/workspace-context.md" "skill-builder:" "session.json" "guided" "express" "iterative"; do
    local safe_name
    safe_name=$(echo "$keyword" | tr ' :/' '___' | tr -cd '[:alnum:]_')
    if echo "$coord_content" | grep -q "$keyword"; then
      record_result "$tier" "coordinator_refs_${safe_name}" "PASS"
    else
      record_result "$tier" "coordinator_refs_${safe_name}" "FAIL" "missing: $keyword"
    fi
  done

  # ---- T1.12: Bundled skills source files present ----
  assert_file_exists "$tier" "bundled_research_skill_source" "$PLUGIN_DIR/agent-sources/workspace/skills/research/SKILL.md"
  assert_file_exists "$tier" "bundled_research_dimension_sets" "$PLUGIN_DIR/agent-sources/workspace/skills/research/references/dimension-sets.md"
  assert_file_exists "$tier" "bundled_research_consolidation_handoff" "$PLUGIN_DIR/agent-sources/workspace/skills/research/references/consolidation-handoff.md"
  local dim_count
  dim_count=$(find "$PLUGIN_DIR/agent-sources/workspace/skills/research/references/dimensions" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
  assert_count_eq "$tier" "bundled_research_dimension_count_is_18" "18" "$dim_count"

  # ---- T1.13: Bundled validate-skill source files present ----
  assert_file_exists "$tier" "bundled_validate_skill_source" "$PLUGIN_DIR/agent-sources/workspace/skills/validate-skill/SKILL.md"
  assert_file_exists "$tier" "bundled_validate_quality_spec" "$PLUGIN_DIR/agent-sources/workspace/skills/validate-skill/references/validate-quality-spec.md"
  assert_file_exists "$tier" "bundled_test_skill_spec" "$PLUGIN_DIR/agent-sources/workspace/skills/validate-skill/references/test-skill-spec.md"
  assert_file_exists "$tier" "bundled_companion_recommender_spec" "$PLUGIN_DIR/agent-sources/workspace/skills/validate-skill/references/companion-recommender-spec.md"
}
