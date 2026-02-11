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

  # ---- T1.3: Agent file count (27 = 6 per type × 4 types + 3 shared) ----
  local agent_count
  agent_count=$(find "$PLUGIN_DIR/agents" -name "*.md" -type f 2>/dev/null | wc -l | tr -d ' ')
  assert_count_eq "$tier" "agent_file_count_is_27" "27" "$agent_count"

  # ---- T1.4: Each expected agent exists in correct subdirectory ----
  local type_dirs="domain platform source data-engineering"
  local type_agents="research-concepts research-patterns-and-merge reasoning build validate test"
  local shared_agents="merge research-patterns research-data"

  for dir in $type_dirs; do
    for agent in $type_agents; do
      assert_file_exists "$tier" "agent_${dir}_${agent}" "$PLUGIN_DIR/agents/${dir}/${agent}.md"
    done
  done
  for agent in $shared_agents; do
    assert_file_exists "$tier" "agent_shared_${agent}" "$PLUGIN_DIR/agents/shared/${agent}.md"
  done

  # ---- T1.5: Agent frontmatter present ----
  local agents_without_fm=0
  for dir in $type_dirs; do
    for agent in $type_agents; do
      local file="$PLUGIN_DIR/agents/${dir}/${agent}.md"
      if [[ -f "$file" ]]; then
        local first_line
        first_line=$(head -1 "$file")
        if [[ "$first_line" != "---" ]]; then
          agents_without_fm=$((agents_without_fm + 1))
        fi
      fi
    done
  done
  for agent in $shared_agents; do
    local file="$PLUGIN_DIR/agents/shared/${agent}.md"
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
      research-concepts|research-patterns|research-data|research-patterns-and-merge) echo "sonnet" ;;
      build|validate|test) echo "sonnet" ;;
      merge) echo "haiku" ;;
      reasoning) echo "opus" ;;
      *) echo "unknown" ;;
    esac
  }
  for dir in $type_dirs; do
    for agent in $type_agents; do
      local file="$PLUGIN_DIR/agents/${dir}/${agent}.md"
      if [ -f "$file" ]; then
        local fm
        fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$file")
        local actual_model
        actual_model=$(echo "$fm" | grep "^model:" | sed 's/model: *//')
        local expected_model
        expected_model=$(expected_model_for "$agent")
        if [ "$actual_model" != "$expected_model" ]; then
          record_result "$tier" "model_${dir}_${agent}" "FAIL" "expected=$expected_model, got=$actual_model"
          model_errors=$((model_errors + 1))
        fi
      fi
    done
  done
  for agent in $shared_agents; do
    local file="$PLUGIN_DIR/agents/shared/${agent}.md"
    if [ -f "$file" ]; then
      local fm
      fm=$(awk 'BEGIN{n=0} /^---$/{n++; next} n==1{print}' "$file")
      local actual_model
      actual_model=$(echo "$fm" | grep "^model:" | sed 's/model: *//')
      local expected_model
      expected_model=$(expected_model_for "$agent")
      if [ "$actual_model" != "$expected_model" ]; then
        record_result "$tier" "model_shared_${agent}" "FAIL" "expected=$expected_model, got=$actual_model"
        model_errors=$((model_errors + 1))
      fi
    fi
  done
  if [ $model_errors -eq 0 ]; then
    record_result "$tier" "all_model_tiers_correct" "PASS"
  fi

  # ---- T1.7: Coordinator frontmatter ----
  local coord_first
  coord_first=$(head -1 "$PLUGIN_DIR/skills/start/SKILL.md")
  if [[ "$coord_first" == "---" ]]; then
    record_result "$tier" "coordinator_has_frontmatter" "PASS"
  else
    record_result "$tier" "coordinator_has_frontmatter" "FAIL" "first line: $coord_first"
  fi

  # ---- T1.8: Shared context exists ----
  assert_file_exists "$tier" "shared_context_exists" "$PLUGIN_DIR/references/shared-context.md"

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

  # ---- T1.10: Coordinator references key concepts ----
  local coord_content
  coord_content=$(cat "$PLUGIN_DIR/skills/start/SKILL.md")
  for keyword in "TeamCreate" "TeamDelete" "CLAUDE_PLUGIN_ROOT" "clarifications-concepts.md" "skill-builder:" "Mode A" "Mode B" "Mode C"; do
    local safe_name
    safe_name=$(echo "$keyword" | tr ' :' '__' | tr -cd '[:alnum:]_')
    if echo "$coord_content" | grep -q "$keyword"; then
      record_result "$tier" "coordinator_refs_${safe_name}" "PASS"
    else
      record_result "$tier" "coordinator_refs_${safe_name}" "FAIL" "missing: $keyword"
    fi
  done
}
