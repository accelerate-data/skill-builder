pub mod types;

use crate::agents::promptfoo_sidecar::process::run_eval as run_promptfoo_eval;
use crate::agents::promptfoo_sidecar::protocol::{
    EvalAssertion, EvalAssertionType, EvalCandidate as SidecarEvalCandidate, EvalCase,
    EvalExecution, EvalMode as SidecarEvalMode, RunEvalRequest,
};
use crate::agents::openhands_server::{
    cancel_openhands_one_shots_with_prefix, run_openhands_one_shot, OpenHandsOneShotRunParams,
};
use crate::agents::sidecar::{build_openhands_one_shot_config, OpenHandsOneShotConfigParams};
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::refine::{content::get_skill_content_inner_for_plugin, resolve_skills_path};
use crate::commands::workflow::{ensure_workspace_prompts, read_initialized_runtime_context};
use crate::db::{
    delete_eval_prompt_set as db_delete_eval_prompt_set,
    get_skill_master_in_plugin,
    list_eval_prompt_sets as db_list_eval_prompt_sets,
    list_eval_runs as db_list_eval_runs,
    read_description_candidate, read_eval_prompt_set as db_read_eval_prompt_set,
    read_eval_run as db_read_eval_run, record_eval_run as db_record_eval_run,
    save_eval_prompt_set as db_save_prompt_set, set_skill_behaviour_in_plugin, Db, EvalPromptSet,
    EvalRun, EvalWorkbenchMode, NewDescriptionCandidate, NewEvalRun, NewEvalRunResult,
    SaveEvalPromptSet,
};
pub use types::{
    ApplyDescriptionCandidateResponse, RefineImprovementBrief, RunEvalWorkbenchRequest,
    SuggestDescriptionCandidatesRequest,
};
use serde_json::Value;
use tauri::Emitter;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

const DEFAULT_DESCRIPTION_CANDIDATE_COUNT: u32 = 3;
const CURRENT_SKILL_CANDIDATE_ID: &str = "current-skill";

#[derive(Default)]
pub struct EvalWorkbenchRunManager(Arc<Mutex<HashMap<String, EvalWorkbenchRunState>>>);

#[derive(Default, Clone)]
struct EvalWorkbenchRunState {
    cancelled: bool,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct EvalWorkbenchProgressEvent {
    run_id: String,
    phase: String,
    completed: u32,
    total: u32,
    message: String,
}

fn validate_plugin_slug(plugin_slug: &str) -> Result<(), String> {
    if plugin_slug.trim().is_empty() {
        return Err("Plugin slug cannot be empty".to_string());
    }
    if plugin_slug.starts_with('.') || plugin_slug.contains('/') || plugin_slug.contains('\\') {
        return Err("Plugin slug must not contain path separators or start with '.'".to_string());
    }
    if plugin_slug.contains("..") {
        return Err("Plugin slug must not contain '..'".to_string());
    }
    Ok(())
}

fn parse_optional_mode(mode: Option<String>) -> Result<Option<EvalWorkbenchMode>, String> {
    mode.as_deref().map(EvalWorkbenchMode::parse).transpose()
}

fn validate_prompt_set_input(input: &SaveEvalPromptSet) -> Result<(), String> {
    validate_plugin_slug(&input.plugin_slug)?;
    validate_skill_name(&input.skill_name)?;
    if input.name.trim().is_empty() {
        return Err("Prompt set name cannot be empty".to_string());
    }
    for case in &input.cases {
        if case.prompt.trim().is_empty() {
            return Err("Prompt case prompt cannot be empty".to_string());
        }
        if input.mode == EvalWorkbenchMode::Performance && case.should_trigger.is_some() {
            return Err("shouldTrigger is only valid for trigger prompt sets".to_string());
        }
        if input.mode == EvalWorkbenchMode::Performance
            && case.expected.as_deref().unwrap_or("").trim().is_empty()
            && case.assertions.as_array().is_some_and(|items| items.is_empty())
        {
            return Err(
                "Performance prompt cases need an expected outcome or at least one assertion"
                    .to_string(),
            );
        }
        if input.mode == EvalWorkbenchMode::Trigger && case.should_trigger.is_none() {
            return Err("Trigger prompt cases must include shouldTrigger".to_string());
        }
        if !case.assertions.is_array() {
            return Err("Prompt case assertions must be an array".to_string());
        }
    }
    Ok(())
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!("{label} contains invalid path characters"));
    }
    Ok(())
}

fn register_eval_workbench_run(
    runs: &EvalWorkbenchRunManager,
    run_id: &str,
) -> Result<(), String> {
    let mut guard = runs.0.lock().map_err(|e| e.to_string())?;
    guard.insert(run_id.to_string(), EvalWorkbenchRunState::default());
    Ok(())
}

fn eval_workbench_agent_prefix(run_id: &str) -> String {
    format!("eval-workbench-{run_id}")
}

fn finish_eval_workbench_run(runs: &EvalWorkbenchRunManager, run_id: &str) {
    if let Ok(mut guard) = runs.0.lock() {
        guard.remove(run_id);
    }
}

fn cancel_eval_workbench_run_inner(
    runs: &EvalWorkbenchRunManager,
    run_id: &str,
) -> Result<(), String> {
    let mut guard = runs.0.lock().map_err(|e| e.to_string())?;
    let state = guard
        .get_mut(run_id)
        .ok_or_else(|| "Eval Workbench run not found".to_string())?;
    state.cancelled = true;
    let _ = cancel_openhands_one_shots_with_prefix(&eval_workbench_agent_prefix(run_id));
    Ok(())
}

fn ensure_eval_workbench_not_cancelled(
    runs: &EvalWorkbenchRunManager,
    run_id: &str,
) -> Result<(), String> {
    let guard = runs.0.lock().map_err(|e| e.to_string())?;
    if guard.get(run_id).is_some_and(|state| state.cancelled) {
        return Err("Eval Workbench run cancelled".to_string());
    }
    Ok(())
}

fn emit_eval_workbench_progress(
    app: &tauri::AppHandle,
    run_id: &str,
    phase: &str,
    completed: u32,
    total: u32,
    message: impl Into<String>,
) {
    let payload = EvalWorkbenchProgressEvent {
        run_id: run_id.to_string(),
        phase: phase.to_string(),
        completed,
        total,
        message: message.into(),
    };
    let _ = app.emit("eval-workbench-progress", &payload);
}

fn to_sidecar_mode(mode: EvalWorkbenchMode) -> SidecarEvalMode {
    match mode {
        EvalWorkbenchMode::Performance => SidecarEvalMode::Performance,
        EvalWorkbenchMode::Trigger => SidecarEvalMode::Trigger,
    }
}

fn parse_assertions(value: &Value) -> Result<Vec<EvalAssertion>, String> {
    let array = value
        .as_array()
        .ok_or_else(|| "Prompt case assertions must be an array".to_string())?;

    array
        .iter()
        .map(|item| {
            let object = item
                .as_object()
                .ok_or_else(|| "Each assertion must be an object".to_string())?;
            let assertion_type = match object.get("type").and_then(Value::as_str) {
                Some("equals") => EvalAssertionType::Equals,
                Some("contains") => EvalAssertionType::Contains,
                Some("javascript") => EvalAssertionType::Javascript,
                _ => return Err("Assertion type must be equals, contains, or javascript".to_string()),
            };
            let raw_value = object
                .get("value")
                .cloned()
                .ok_or_else(|| "Assertion value is required".to_string())?;

            Ok(EvalAssertion {
                assertion_type,
                value: raw_value,
            })
        })
        .collect()
}

fn to_sidecar_cases(prompt_set: &EvalPromptSet) -> Result<Vec<EvalCase>, String> {
    prompt_set
        .cases
        .iter()
        .map(|case| {
            Ok(EvalCase {
                id: case.id.clone(),
                prompt: case.prompt.clone(),
                expected: case.expected.clone(),
                should_trigger: case.should_trigger,
                assertions: parse_assertions(&case.assertions)?,
            })
        })
        .collect()
}

fn load_sidecar_candidates(
    conn: &rusqlite::Connection,
    prompt_set: &EvalPromptSet,
    candidate_ids: &[String],
) -> Result<Vec<SidecarEvalCandidate>, String> {
    if prompt_set.mode == EvalWorkbenchMode::Performance {
        let skill = get_skill_master_in_plugin(conn, &prompt_set.skill_name, &prompt_set.plugin_slug)?
            .ok_or_else(|| "Skill not found for performance run".to_string())?;
        return Ok(vec![SidecarEvalCandidate {
            id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
            label: "Current skill".to_string(),
            description: skill.description,
        }]);
    }

    let skill = get_skill_master_in_plugin(conn, &prompt_set.skill_name, &prompt_set.plugin_slug)?
        .ok_or_else(|| "Skill not found for trigger run".to_string())?;
    let mut seen = HashSet::new();
    let mut candidates = vec![SidecarEvalCandidate {
        id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
        label: "Baseline".to_string(),
        description: skill.description,
    }];
    for candidate_id in candidate_ids {
        if !seen.insert(candidate_id.clone()) {
            continue;
        }
        let candidate = read_owned_description_candidate(
            conn,
            candidate_id,
            &prompt_set.plugin_slug,
            &prompt_set.skill_name,
            Some(&prompt_set.id),
        )?;
        candidates.push(SidecarEvalCandidate {
            id: candidate.id,
            label: candidate.label,
            description: Some(candidate.description),
        });
    }
    if candidates.len() == 1 {
        return Err("Trigger comparisons require at least one generated description candidate".to_string());
    }
    Ok(candidates)
}

fn read_owned_description_candidate(
    conn: &rusqlite::Connection,
    candidate_id: &str,
    plugin_slug: &str,
    skill_name: &str,
    prompt_set_id: Option<&str>,
) -> Result<crate::db::DescriptionCandidate, String> {
    let candidate = read_description_candidate(conn, candidate_id)?
        .ok_or_else(|| format!("Description candidate not found: {candidate_id}"))?;
    let run = db_read_eval_run(conn, &candidate.run_id)?
        .ok_or_else(|| format!("Eval run not found for candidate: {candidate_id}"))?;
    let candidate_prompt_set = db_read_eval_prompt_set(conn, &run.prompt_set_id)?
        .ok_or_else(|| format!("Prompt set not found for candidate: {candidate_id}"))?;

    if candidate_prompt_set.plugin_slug != plugin_slug || candidate_prompt_set.skill_name != skill_name {
        return Err(format!(
            "Description candidate does not belong to skill {} in plugin {}",
            skill_name, plugin_slug
        ));
    }
    if let Some(expected_prompt_set_id) = prompt_set_id {
        if candidate_prompt_set.id != expected_prompt_set_id {
            return Err("Description candidate does not belong to the selected prompt set".to_string());
        }
    }

    Ok(candidate)
}

fn extract_completed_openhands_state<'a>(state: &'a serde_json::Value) -> Result<&'a serde_json::Value, String> {
    if state.get("type").and_then(|value| value.as_str()) != Some("conversation_state") {
        return Err("OpenHands eval result was not a conversation_state".to_string());
    }

    match state.get("status").and_then(|value| value.as_str()) {
        Some("completed") => {}
        Some("error") | Some("cancelled") | Some("canceled") => {
            let detail = state
                .get("error_detail")
                .or_else(|| state.get("errorDetail"))
                .and_then(|value| value.as_str())
                .unwrap_or("OpenHands eval run failed");
            return Err(detail.to_string());
        }
        Some(status) => {
            return Err(format!(
                "OpenHands eval run did not reach terminal status: {}",
                status
            ))
        }
        None => return Err("OpenHands eval result missing status".to_string()),
    }

    if let Some(_text) = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(state);
    }

    if let Some(structured) = state
        .get("structured_output")
        .or_else(|| state.get("structuredOutput"))
        .filter(|value| !value.is_null())
    {
        let _ = structured;
        return Ok(state);
    }

    Err("OpenHands eval result did not include result_text".to_string())
}

fn parse_openhands_response_text(state: &serde_json::Value) -> Result<String, String> {
    let state = extract_completed_openhands_state(state)?;

    if let Some(text) = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
    {
        return Ok(text.to_string());
    }

    if let Some(structured) = state
        .get("structured_output")
        .or_else(|| state.get("structuredOutput"))
        .filter(|value| !value.is_null())
    {
        return Ok(structured.to_string());
    }

    Err("OpenHands eval result did not include result_text".to_string())
}

fn parse_openhands_structured_output(state: &serde_json::Value) -> Result<Value, String> {
    let state = extract_completed_openhands_state(state)?;
    if let Some(structured) = state
        .get("structured_output")
        .or_else(|| state.get("structuredOutput"))
        .filter(|value| !value.is_null())
    {
        return Ok(structured.clone());
    }

    let text = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|value| value.as_str())
        .ok_or_else(|| "OpenHands eval result did not include structured output".to_string())?;

    serde_json::from_str(text).map_err(|error| {
        format!("OpenHands eval structured result was not valid JSON: {error}")
    })
}

fn description_candidate_output_format() -> Value {
    serde_json::json!({
        "type": "json_schema",
        "name": "eval_workbench_description_candidate",
        "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "description": { "type": "string" },
                "rationale": { "type": "string" }
            },
            "required": ["description", "rationale"]
        }
    })
}

fn diagnosis_output_format() -> Value {
    serde_json::json!({
        "type": "json_schema",
        "name": "eval_workbench_diagnosis",
        "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "failurePatterns": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "likelyCauses": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "recommendedChanges": {
                    "type": "array",
                    "items": { "type": "string" }
                },
                "expectedImpact": { "type": "string" },
                "regressionRisks": {
                    "type": "array",
                    "items": { "type": "string" }
                }
            },
            "required": [
                "failurePatterns",
                "likelyCauses",
                "recommendedChanges",
                "expectedImpact",
                "regressionRisks"
            ]
        }
    })
}

fn build_description_candidate_prompt(
    prompt_set: &EvalPromptSet,
    baseline_description: &str,
    variant_index: u32,
) -> String {
    let prompt_cases = prompt_set
        .cases
        .iter()
        .enumerate()
        .map(|(index, case)| {
            format!(
                "{}. should_trigger={} prompt={}",
                index + 1,
                case.should_trigger.unwrap_or(false),
                case.prompt
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "You are improving a skill description for trigger routing.\n\
Generate exactly one candidate description variant and one short rationale.\n\
Keep the candidate grounded in the real skill behavior and the trigger boundary implied by the prompt set.\n\
Do not repeat the baseline wording verbatim. Do not mention evaluation, Promptfoo, or internal implementation.\n\
\n\
Skill name: {skill_name}\n\
Baseline description:\n{baseline_description}\n\
\n\
Prompt cases:\n{prompt_cases}\n\
\n\
Variant guidance #{variant_index}:\n\
- Variant 1: tighten scope around true-positive prompts.\n\
- Variant 2: improve exclusions and reduce false triggers.\n\
- Variant 3: emphasize user intent, expected outputs, and trigger boundary clarity.\n\
\n\
Return JSON with:\n\
- description: the candidate description text\n\
- rationale: one short sentence explaining the change.\n",
        skill_name = prompt_set.skill_name,
    )
}

fn build_eval_diagnosis_prompt(
    run: &EvalRun,
    prompt_set: &EvalPromptSet,
    skill_files: &[crate::types::SkillFileContent],
    candidate_context: &[crate::db::DescriptionCandidate],
) -> String {
    let failed_cases = run
        .results
        .iter()
        .filter(|result| !result.passed)
        .map(|result| {
            format!(
                "- case={} candidate={} score={} reason={}",
                result.case_id,
                result.candidate_id,
                result.score,
                result.reason.as_deref().unwrap_or("No reason recorded")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let passing_cases = run
        .results
        .iter()
        .filter(|result| result.passed)
        .take(3)
        .map(|result| {
            format!(
                "- case={} candidate={} score={}",
                result.case_id, result.candidate_id, result.score
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let prompt_cases = prompt_set
        .cases
        .iter()
        .map(|case| {
            format!(
                "- id={} should_trigger={:?} prompt={} expected={:?}",
                case.id, case.should_trigger, case.prompt, case.expected
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    let skill_context = skill_files
        .iter()
        .take(8)
        .map(|file| format!("## {}\n{}", file.path, file.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    let description_context = candidate_context
        .iter()
        .map(|candidate| {
            format!(
                "- {}: {} ({})",
                candidate.label,
                candidate.description,
                candidate.rationale.as_deref().unwrap_or("no rationale")
            )
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        "Diagnose an Eval Workbench run and produce a concise improvement brief for Refine.\n\
Mode: {}\n\
Prompt set: {}\n\
\n\
Prompt cases:\n{}\n\
\n\
Failed cases:\n{}\n\
\n\
Representative passing cases:\n{}\n\
\n\
Trigger description context:\n{}\n\
\n\
Current skill files:\n{}\n\
\n\
Return JSON with failurePatterns, likelyCauses, recommendedChanges, expectedImpact, and regressionRisks.\n",
        run.mode.as_str(),
        prompt_set.name,
        prompt_cases,
        if failed_cases.is_empty() { "- none".to_string() } else { failed_cases },
        if passing_cases.is_empty() { "- none".to_string() } else { passing_cases },
        if description_context.is_empty() {
            "- none".to_string()
        } else {
            description_context
        },
        if skill_context.is_empty() {
            "No skill file context available.".to_string()
        } else {
            skill_context
        }
    )
}

fn format_eval_diagnosis_brief(run: &EvalRun, diagnosis: &Value) -> String {
    let read_lines = |key: &str| {
        diagnosis
            .get(key)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|line| format!("- {}", line.trim()))
            .collect::<Vec<_>>()
    };

    let mut lines = vec![
        format!("Eval Workbench run: {}", run.id),
        format!("Mode: {}", run.mode.as_str()),
        String::new(),
        "Failure patterns:".to_string(),
    ];
    let failure_patterns = read_lines("failurePatterns");
    lines.extend(if failure_patterns.is_empty() {
        vec!["- No failure patterns reported.".to_string()]
    } else {
        failure_patterns
    });
    lines.push(String::new());
    lines.push("Likely causes:".to_string());
    let likely_causes = read_lines("likelyCauses");
    lines.extend(if likely_causes.is_empty() {
        vec!["- No likely causes reported.".to_string()]
    } else {
        likely_causes
    });
    lines.push(String::new());
    lines.push("Recommended changes:".to_string());
    let recommended_changes = read_lines("recommendedChanges");
    lines.extend(if recommended_changes.is_empty() {
        vec!["- No recommended changes reported.".to_string()]
    } else {
        recommended_changes
    });
    lines.push(String::new());
    lines.push(format!(
        "Expected impact: {}",
        diagnosis
            .get("expectedImpact")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("Not provided")
    ));
    lines.push(String::new());
    lines.push("Regression risks:".to_string());
    let regression_risks = read_lines("regressionRisks");
    lines.extend(if regression_risks.is_empty() {
        vec!["- No regression risks reported.".to_string()]
    } else {
        regression_risks
    });
    lines.join("\n")
}

fn parse_description_candidate_response(
    state: &serde_json::Value,
    label: String,
    rank: i64,
) -> Result<NewDescriptionCandidate, String> {
    let parsed = parse_openhands_structured_output(state)?;
    let description = parsed
        .get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Description candidate response missing description".to_string())?;
    let rationale = parsed
        .get("rationale")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Description candidate response missing rationale".to_string())?;

    Ok(NewDescriptionCandidate {
        id: None,
        label,
        description: description.to_string(),
        rationale: Some(rationale.to_string()),
        rank: Some(rank),
    })
}

fn build_performance_sidecar_config(
    prompt_set: &EvalPromptSet,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_root_dir = runtime_ctx.workspace_path.replace('\\', "/");
    let workspace_run_dir =
        crate::skill_paths::workspace_skill_dir(
            Path::new(&runtime_ctx.workspace_path),
            &prompt_set.plugin_slug,
            &prompt_set.skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/");

    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir,
        workspace_run_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval_workbench.performance".to_string()),
        user_message_suffix: None,
        allowed_tools: vec![],
        max_turns: 20,
        output_format: None,
        skill_name: Some(prompt_set.skill_name.clone()),
        step_id: Some(-12),
        run_source: Some("test".to_string()),
        plugin_slug: prompt_set.plugin_slug.clone(),
    })
}

fn write_trigger_stub_skill(
    workspace_skill_dir: &Path,
    skill_name: &str,
    description: &str,
    trigger_marker: &str,
) -> Result<(), String> {
    let skill_dir = workspace_skill_dir.join(".agents").join("skills").join(skill_name);
    std::fs::create_dir_all(&skill_dir).map_err(|e| e.to_string())?;
    let description_block = if description.trim().is_empty() {
        "  ".to_string()
    } else {
        description
            .lines()
            .map(|line| format!("  {line}"))
            .collect::<Vec<_>>()
            .join("\n")
    };
    let stub = format!(
        "---\nname: {skill_name}\ndescription: |\n{description_block}\nversion: candidate\n---\nWhen this skill is invoked, respond with exactly `{trigger_marker}` and nothing else.\n"
    );
    std::fs::write(skill_dir.join("SKILL.md"), stub).map_err(|e| e.to_string())
}

fn build_trigger_sidecar_config(
    prompt_set: &EvalPromptSet,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
    workspace_skill_dir: &Path,
) -> crate::agents::sidecar::SidecarConfig {
    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir: runtime_ctx.workspace_path.replace('\\', "/"),
        workspace_run_dir: workspace_skill_dir.to_string_lossy().replace('\\', "/"),
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval_workbench.trigger".to_string()),
        user_message_suffix: None,
        allowed_tools: vec![],
        max_turns: 12,
        output_format: None,
        skill_name: Some(prompt_set.skill_name.clone()),
        step_id: Some(-12),
        run_source: Some("test".to_string()),
        plugin_slug: prompt_set.plugin_slug.clone(),
    })
}

fn build_eval_diagnosis_sidecar_config(
    prompt_set: &EvalPromptSet,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_root_dir = runtime_ctx.workspace_path.replace('\\', "/");
    let workspace_run_dir =
        crate::skill_paths::workspace_skill_dir(
            Path::new(&runtime_ctx.workspace_path),
            &prompt_set.plugin_slug,
            &prompt_set.skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/");

    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir,
        workspace_run_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval_workbench.diagnosis".to_string()),
        user_message_suffix: None,
        allowed_tools: vec![],
        max_turns: 20,
        output_format: Some(diagnosis_output_format()),
        skill_name: Some(prompt_set.skill_name.clone()),
        step_id: Some(-12),
        run_source: Some("test".to_string()),
        plugin_slug: prompt_set.plugin_slug.clone(),
    })
}

fn build_description_candidate_sidecar_config(
    prompt_set: &EvalPromptSet,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_root_dir = runtime_ctx.workspace_path.replace('\\', "/");
    let workspace_run_dir =
        crate::skill_paths::workspace_skill_dir(
            Path::new(&runtime_ctx.workspace_path),
            &prompt_set.plugin_slug,
            &prompt_set.skill_name,
        )
        .to_string_lossy()
        .replace('\\', "/");

    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir,
        workspace_run_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval_workbench.description_candidate".to_string()),
        user_message_suffix: None,
        allowed_tools: vec![],
        max_turns: 18,
        output_format: Some(description_candidate_output_format()),
        skill_name: Some(prompt_set.skill_name.clone()),
        step_id: Some(-12),
        run_source: Some("test".to_string()),
        plugin_slug: prompt_set.plugin_slug.clone(),
    })
}

fn build_run_summary(result: &crate::agents::promptfoo_sidecar::protocol::EvalRunResult) -> Value {
    serde_json::json!({
        "passed": result.passed,
        "failed": result.failed,
        "total": result.total,
        "passRate": if result.total == 0 {
            0.0
        } else {
            result.passed as f64 / result.total as f64
        }
    })
}

fn clone_persisted_candidates_for_completed_run(
    draft_candidates: &[crate::db::DescriptionCandidate],
) -> (
    Vec<NewDescriptionCandidate>,
    std::collections::HashMap<String, String>,
) {
    let mut id_map = std::collections::HashMap::new();
    let cloned = draft_candidates
        .iter()
        .map(|candidate| {
            let new_id = format!("candidate-{}", uuid::Uuid::new_v4());
            id_map.insert(candidate.id.clone(), new_id.clone());
            NewDescriptionCandidate {
                id: Some(new_id),
                label: candidate.label.clone(),
                description: candidate.description.clone(),
                rationale: candidate.rationale.clone(),
                rank: candidate.rank,
            }
        })
        .collect();

    (cloned, id_map)
}

async fn generate_description_candidates(
    app: &tauri::AppHandle,
    prompt_set: &EvalPromptSet,
    baseline_description: &str,
    candidate_count: u32,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> Result<Vec<NewDescriptionCandidate>, String> {
    let mut candidates = Vec::with_capacity(candidate_count as usize);

    for index in 0..candidate_count.max(1) {
        let prompt =
            build_description_candidate_prompt(prompt_set, baseline_description, index + 1);
        let config = build_description_candidate_sidecar_config(prompt_set, &prompt, runtime_ctx);
        let run = run_openhands_one_shot(
            app,
            OpenHandsOneShotRunParams {
                agent_id_prefix: format!("{}-candidate", prompt_set.skill_name),
                config,
                timeout: std::time::Duration::from_secs(90),
            },
        )
        .await?;
        candidates.push(parse_description_candidate_response(
            &run.conversation_state,
            format!("Candidate {}", index + 1),
            (index + 1) as i64,
        )?);
    }

    Ok(candidates)
}

async fn build_completed_eval_run_with_deps<FExec, FExecFut, FEval, FEvalFut>(
    runs: &EvalWorkbenchRunManager,
    run_id: String,
    prompt_set: EvalPromptSet,
    sidecar_candidates: Vec<SidecarEvalCandidate>,
    sidecar_cases: Vec<EvalCase>,
    persisted_candidates: Vec<crate::db::DescriptionCandidate>,
    execute_cases: FExec,
    evaluate_run: FEval,
 ) -> Result<NewEvalRun, String>
where
    FExec: FnOnce(EvalPromptSet, Vec<EvalCase>, Vec<SidecarEvalCandidate>) -> FExecFut,
    FExecFut: Future<Output = Result<Vec<EvalExecution>, String>>,
    FEval: FnOnce(RunEvalRequest) -> FEvalFut,
    FEvalFut: Future<
        Output = Result<crate::agents::promptfoo_sidecar::protocol::EvalRunResult, String>,
    >,
{
    let executions = execute_cases(
        prompt_set.clone(),
        sidecar_cases.clone(),
        sidecar_candidates.clone(),
    )
    .await?;
    ensure_eval_workbench_not_cancelled(runs, &run_id)?;
    let (persisted_candidates, candidate_id_map) =
        clone_persisted_candidates_for_completed_run(&persisted_candidates);
    let sidecar_request = RunEvalRequest::new(
        run_id.clone(),
        to_sidecar_mode(prompt_set.mode),
        prompt_set.skill_name.clone(),
        prompt_set.plugin_slug.clone(),
        sidecar_candidates,
        sidecar_cases,
        executions,
    );
    let result = evaluate_run(sidecar_request).await?;
    ensure_eval_workbench_not_cancelled(runs, &run_id)?;

    Ok(NewEvalRun {
        id: Some(run_id),
        prompt_set_id: prompt_set.id,
        mode: prompt_set.mode,
        status: "completed".to_string(),
        summary: build_run_summary(&result),
        completed_at: Some(chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)),
        results: result
            .results
            .into_iter()
            .map(|case_result| NewEvalRunResult {
                id: None,
                case_id: case_result.case_id,
                candidate_id: candidate_id_map
                    .get(&case_result.candidate_id)
                    .cloned()
                    .unwrap_or(case_result.candidate_id),
                passed: case_result.passed,
                score: case_result.score,
                output: case_result.output,
                reason: case_result.reason,
            })
            .collect(),
        description_candidates: persisted_candidates,
    })
}

async fn execute_performance_cases(
    app: &tauri::AppHandle,
    run_id: &str,
    runs: &EvalWorkbenchRunManager,
    prompt_set: &EvalPromptSet,
    cases: &[EvalCase],
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> Result<Vec<EvalExecution>, String> {
    let mut executions = Vec::with_capacity(cases.len());
    let total = cases.len() as u32;

    for (index, test_case) in cases.iter().enumerate() {
        ensure_eval_workbench_not_cancelled(runs, run_id)?;
        let config = build_performance_sidecar_config(prompt_set, &test_case.prompt, runtime_ctx);
        let run = run_openhands_one_shot(
            app,
            OpenHandsOneShotRunParams {
                agent_id_prefix: format!(
                    "{}-performance-{}",
                    eval_workbench_agent_prefix(run_id),
                    prompt_set.skill_name
                ),
                config,
                timeout: std::time::Duration::from_secs(90),
            },
        )
        .await?;
        ensure_eval_workbench_not_cancelled(runs, run_id)?;
        let response_text = parse_openhands_response_text(&run.conversation_state)?;
        executions.push(EvalExecution {
            case_id: test_case.id.clone(),
            candidate_id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
            output: serde_json::json!({
                "responseText": response_text,
                "mode": "performance",
            }),
        });
        emit_eval_workbench_progress(
            app,
            run_id,
            "performance",
            (index + 1) as u32,
            total,
            format!("Completed performance case {}", test_case.id),
        );
    }

    Ok(executions)
}

async fn execute_trigger_cases(
    app: &tauri::AppHandle,
    run_id: &str,
    runs: &EvalWorkbenchRunManager,
    prompt_set: &EvalPromptSet,
    cases: &[EvalCase],
    candidates: &[SidecarEvalCandidate],
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> Result<Vec<EvalExecution>, String> {
    let temp_root = PathBuf::from(&runtime_ctx.workspace_path)
        .join(".eval-workbench")
        .join(format!("trigger-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&temp_root).map_err(|e| e.to_string())?;

    let result = async {
        let mut executions = Vec::with_capacity(cases.len() * candidates.len());
        let total = (cases.len() * candidates.len()) as u32;
        let mut completed = 0u32;
        for candidate in candidates {
            let candidate_dir = temp_root.join(&candidate.id);
            for test_case in cases {
                ensure_eval_workbench_not_cancelled(runs, run_id)?;
                let trigger_marker = format!(
                    "__EVAL_WORKBENCH_TRIGGER__{}__{}__",
                    candidate.id, test_case.id
                );
                write_trigger_stub_skill(
                    &candidate_dir,
                    &prompt_set.skill_name,
                    candidate.description.as_deref().unwrap_or(""),
                    &trigger_marker,
                )?;

                let config = build_trigger_sidecar_config(
                    prompt_set,
                    &test_case.prompt,
                    runtime_ctx,
                    &candidate_dir,
                );
                let run = run_openhands_one_shot(
                    app,
                    OpenHandsOneShotRunParams {
                        agent_id_prefix: format!(
                            "{}-trigger-{}",
                            eval_workbench_agent_prefix(run_id),
                            prompt_set.skill_name
                        ),
                        config,
                        timeout: std::time::Duration::from_secs(60),
                    },
                )
                .await?;
                ensure_eval_workbench_not_cancelled(runs, run_id)?;
                let response_text = parse_openhands_response_text(&run.conversation_state)?;
                executions.push(EvalExecution {
                    case_id: test_case.id.clone(),
                    candidate_id: candidate.id.clone(),
                    output: serde_json::json!({
                        "mode": "trigger",
                        "invokedTargetSkill": response_text.contains(&trigger_marker),
                        "responseText": response_text,
                    }),
                });
                completed += 1;
                emit_eval_workbench_progress(
                    app,
                    run_id,
                    "trigger",
                    completed,
                    total,
                    format!(
                        "Completed trigger case {} for {}",
                        test_case.id, candidate.label
                    ),
                );
            }
        }
        Ok(executions)
    }
    .await;

    let _ = std::fs::remove_dir_all(&temp_root);
    result
}

#[tauri::command]
pub fn list_eval_prompt_sets(
    plugin_slug: String,
    skill_name: String,
    mode: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::EvalPromptSet>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let mode = parse_optional_mode(mode)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_list_eval_prompt_sets(&conn, &plugin_slug, &skill_name, mode)
}

#[tauri::command]
pub fn save_eval_prompt_set(
    prompt_set: SaveEvalPromptSet,
    db: tauri::State<'_, Db>,
) -> Result<crate::db::EvalPromptSet, String> {
    validate_prompt_set_input(&prompt_set)?;
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db_save_prompt_set(&mut conn, prompt_set)
}

#[tauri::command]
pub fn delete_eval_prompt_set(
    prompt_set_id: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_id("Prompt set id", &prompt_set_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_delete_eval_prompt_set(&conn, &prompt_set_id)
}

#[tauri::command]
pub async fn run_eval_workbench(
    app: tauri::AppHandle,
    request: RunEvalWorkbenchRequest,
    db: tauri::State<'_, Db>,
    runs: tauri::State<'_, EvalWorkbenchRunManager>,
) -> Result<EvalRun, String> {
    validate_id("Run id", &request.run_id)?;
    validate_id("Prompt set id", &request.prompt_set_id)?;
    {
        if request.candidate_ids.iter().any(|id| id.trim().is_empty()) {
            return Err("Candidate ids cannot be empty".to_string());
        }
    }

    register_eval_workbench_run(&runs, &request.run_id)?;

    let preparation = || -> Result<_, String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let prompt_set = db_read_eval_prompt_set(&conn, &request.prompt_set_id)?
            .ok_or_else(|| "Prompt set not found".to_string())?;
        let sidecar_candidates = load_sidecar_candidates(&conn, &prompt_set, &request.candidate_ids)?;
        let persisted_candidates = if prompt_set.mode == EvalWorkbenchMode::Trigger {
            request
                .candidate_ids
                .iter()
                .cloned()
                .collect::<std::collections::HashSet<_>>()
                .into_iter()
                .map(|candidate_id| {
                    read_owned_description_candidate(
                        &conn,
                        &candidate_id,
                        &prompt_set.plugin_slug,
                        &prompt_set.skill_name,
                        Some(&prompt_set.id),
                    )
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        let sidecar_cases = to_sidecar_cases(&prompt_set)?;

        Ok((prompt_set, sidecar_candidates, sidecar_cases, persisted_candidates))
    };
    let (prompt_set, sidecar_candidates, sidecar_cases, persisted_candidates) =
        match preparation() {
            Ok(values) => values,
            Err(error) => {
                finish_eval_workbench_run(&runs, &request.run_id);
                return Err(error);
            }
        };

    let run_id = request.run_id.clone();
    let runtime_ctx = match read_initialized_runtime_context(&db) {
        Ok(runtime_ctx) => runtime_ctx,
        Err(error) => {
            finish_eval_workbench_run(&runs, &run_id);
            return Err(error);
        }
    };
    if let Err(error) = ensure_eval_workbench_not_cancelled(&runs, &run_id) {
        finish_eval_workbench_run(&runs, &run_id);
        return Err(error);
    }
    if let Err(error) = ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await {
        finish_eval_workbench_run(&runs, &run_id);
        return Err(error);
    }
    if let Err(error) = ensure_eval_workbench_not_cancelled(&runs, &run_id) {
        finish_eval_workbench_run(&runs, &run_id);
        return Err(error);
    }
    let app_for_execute = app.clone();
    let app_for_eval = app.clone();
    let run_id_for_execute = run_id.clone();
    let run_manager_for_execute = EvalWorkbenchRunManager(runs.0.clone());
    let completed_run_result = build_completed_eval_run_with_deps(
        &runs,
        run_id.clone(),
        prompt_set,
        sidecar_candidates,
        sidecar_cases,
        persisted_candidates,
        |prompt_set, sidecar_cases, sidecar_candidates| async move {
            match prompt_set.mode {
                EvalWorkbenchMode::Performance => {
                    execute_performance_cases(
                        &app_for_execute,
                        &run_id_for_execute,
                        &run_manager_for_execute,
                        &prompt_set,
                        &sidecar_cases,
                        &runtime_ctx,
                    )
                    .await
                }
                EvalWorkbenchMode::Trigger => {
                    execute_trigger_cases(
                        &app_for_execute,
                        &run_id_for_execute,
                        &run_manager_for_execute,
                        &prompt_set,
                        &sidecar_cases,
                        &sidecar_candidates,
                        &runtime_ctx,
                    )
                    .await
                }
            }
        },
        |sidecar_request| async move { run_promptfoo_eval(&app_for_eval, &sidecar_request).await },
    )
    .await;
    let completed_run = match completed_run_result {
        Ok(run) => run,
        Err(error) => {
            finish_eval_workbench_run(&runs, &run_id);
            return Err(error);
        }
    };

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let result = db_record_eval_run(&mut conn, completed_run);
    finish_eval_workbench_run(&runs, &run_id);
    result
}

#[tauri::command]
pub fn cancel_eval_workbench_run(
    run_id: String,
    runs: tauri::State<'_, EvalWorkbenchRunManager>,
) -> Result<(), String> {
    validate_id("Run id", &run_id)?;
    cancel_eval_workbench_run_inner(&runs, &run_id)
}

#[tauri::command]
pub fn list_eval_runs(
    plugin_slug: String,
    skill_name: String,
    mode: Option<String>,
    limit: Option<i64>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<EvalRun>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let mode = parse_optional_mode(mode)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_list_eval_runs(&conn, &plugin_slug, &skill_name, mode, limit.unwrap_or(50))
}

#[tauri::command]
pub fn read_eval_run(run_id: String, db: tauri::State<'_, Db>) -> Result<Option<EvalRun>, String> {
    validate_id("Run id", &run_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_read_eval_run(&conn, &run_id)
}

#[tauri::command]
pub async fn suggest_description_candidates(
    app: tauri::AppHandle,
    request: SuggestDescriptionCandidatesRequest,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::DescriptionCandidate>, String> {
    validate_id("Prompt set id", &request.prompt_set_id)?;
    if request.baseline_description.trim().is_empty() {
        return Err("Baseline description cannot be empty".to_string());
    }

    let prompt_set = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        db_read_eval_prompt_set(&conn, &request.prompt_set_id)?
            .ok_or_else(|| "Prompt set not found".to_string())?
    };
    if prompt_set.mode != EvalWorkbenchMode::Trigger {
        return Err("Description candidates require a trigger prompt set".to_string());
    }

    let candidate_count = request
        .candidate_count
        .unwrap_or(DEFAULT_DESCRIPTION_CANDIDATE_COUNT)
        .max(1);

    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let generated_candidates = generate_description_candidates(
        &app,
        &prompt_set,
        &request.baseline_description,
        candidate_count,
        &runtime_ctx,
    )
    .await?;

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let run = db_record_eval_run(
        &mut conn,
        NewEvalRun {
            id: None,
            prompt_set_id: prompt_set.id.clone(),
            mode: EvalWorkbenchMode::Trigger,
            status: "draft".to_string(),
            summary: serde_json::json!({ "candidateCount": candidate_count, "status": "draft" }),
            completed_at: None,
            results: vec![],
            description_candidates: generated_candidates,
        },
    )?;

    Ok(run.description_candidates)
}

#[tauri::command]
pub fn apply_description_candidate(
    plugin_slug: String,
    skill_name: String,
    candidate_id: String,
    db: tauri::State<'_, Db>,
) -> Result<ApplyDescriptionCandidateResponse, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    validate_id("Candidate id", &candidate_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let candidate = read_owned_description_candidate(
        &conn,
        &candidate_id,
        &plugin_slug,
        &skill_name,
        None,
    )?;
    set_skill_behaviour_in_plugin(
        &conn,
        &skill_name,
        &plugin_slug,
        Some(&candidate.description),
        None,
        None,
        None,
        None,
        None,
    )?;
    log::info!(
        "[apply_description_candidate] skill={} plugin={} candidate={}",
        skill_name,
        plugin_slug,
        candidate_id
    );
    Ok(ApplyDescriptionCandidateResponse {
        description: candidate.description,
    })
}

#[tauri::command]
pub async fn build_refine_improvement_brief(
    app: tauri::AppHandle,
    run_id: String,
    db: tauri::State<'_, Db>,
) -> Result<RefineImprovementBrief, String> {
    validate_id("Run id", &run_id)?;
    let (run, prompt_set, skill_files) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let run = db_read_eval_run(&conn, &run_id)?.ok_or_else(|| "Eval run not found".to_string())?;
        let prompt_set = db_read_eval_prompt_set(&conn, &run.prompt_set_id)?
            .ok_or_else(|| "Eval prompt set not found".to_string())?;
        let skill_files = if run.mode == EvalWorkbenchMode::Performance {
            let skills_path = resolve_skills_path(&db)?;
            get_skill_content_inner_for_plugin(
                &prompt_set.skill_name,
                &skills_path,
                &prompt_set.plugin_slug,
            )?
        } else {
            Vec::new()
        };
        (run, prompt_set, skill_files)
    };

    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let prompt = build_eval_diagnosis_prompt(
        &run,
        &prompt_set,
        &skill_files,
        &run.description_candidates,
    );
    let config = build_eval_diagnosis_sidecar_config(&prompt_set, &prompt, &runtime_ctx);
    let diagnosis_run = run_openhands_one_shot(
        &app,
        OpenHandsOneShotRunParams {
            agent_id_prefix: format!("{}-diagnosis", prompt_set.skill_name),
            config,
            timeout: std::time::Duration::from_secs(90),
        },
    )
    .await?;
    let diagnosis = parse_openhands_structured_output(&diagnosis_run.conversation_state)?;

    Ok(RefineImprovementBrief {
        run_id: run.id.clone(),
        brief: format_eval_diagnosis_brief(&run, &diagnosis),
    })
}

#[cfg(test)]
fn build_refine_improvement_brief_inner(run: &EvalRun) -> String {
    let failed = run.results.iter().filter(|result| !result.passed).count();
    let total = run.results.len();
    let mut lines = vec![
        format!("Eval Workbench run: {}", run.id),
        format!("Mode: {}", run.mode.as_str()),
        format!("Status: {}", run.status),
        format!("Results: {}/{} failed", failed, total),
    ];
    for result in run.results.iter().filter(|result| !result.passed).take(10) {
        lines.push(format!(
            "- case={} candidate={} score={} reason={}",
            result.case_id,
            result.candidate_id,
            result.score,
            result.reason.as_deref().unwrap_or("No reason recorded")
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_test_db_for_tests, record_eval_run, save_eval_prompt_set};

    fn valid_prompt_set(mode: EvalWorkbenchMode) -> SaveEvalPromptSet {
        SaveEvalPromptSet {
            id: None,
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            mode,
            name: "Smoke".to_string(),
            cases: vec![crate::db::SaveEvalPromptCase {
                id: None,
                prompt: "Forecast revenue".to_string(),
                expected: if mode == EvalWorkbenchMode::Performance {
                    Some("Include the revenue forecast".to_string())
                } else {
                    None
                },
                should_trigger: if mode == EvalWorkbenchMode::Trigger {
                    Some(true)
                } else {
                    None
                },
                assertions: serde_json::json!([]),
                sort_order: None,
            }],
        }
    }

    #[test]
    fn rejects_should_trigger_on_performance_prompt_sets() {
        let mut input = valid_prompt_set(EvalWorkbenchMode::Performance);
        input.cases[0].should_trigger = Some(true);

        let err = validate_prompt_set_input(&input).unwrap_err();

        assert!(err.contains("shouldTrigger is only valid"));
    }

    #[test]
    fn rejects_trigger_cases_without_should_trigger() {
        let mut input = valid_prompt_set(EvalWorkbenchMode::Trigger);
        input.cases[0].should_trigger = None;

        let err = validate_prompt_set_input(&input).unwrap_err();

        assert!(err.contains("must include shouldTrigger"));
    }

    #[test]
    fn rejects_performance_case_without_expectation_or_assertions() {
        let mut input = valid_prompt_set(EvalWorkbenchMode::Performance);
        input.cases[0].expected = Some(String::new());

        let err = validate_prompt_set_input(&input).unwrap_err();

        assert!(err.contains("expected outcome or at least one assertion"));
    }

    #[test]
    fn rejects_unsafe_plugin_slug() {
        let err = validate_plugin_slug("../skills").unwrap_err();

        assert!(err.contains("must not contain"));
    }

    #[test]
    fn builds_refine_brief_from_failed_results() {
        let run = EvalRun {
            id: "run-1".to_string(),
            prompt_set_id: "prompt-set-1".to_string(),
            mode: EvalWorkbenchMode::Performance,
            status: "completed".to_string(),
            summary: serde_json::json!({}),
            created_at: "2026-05-03T00:00:00Z".to_string(),
            completed_at: None,
            results: vec![crate::db::EvalRunResult {
                id: "result-1".to_string(),
                run_id: "run-1".to_string(),
                case_id: "case-1".to_string(),
                candidate_id: "candidate-a".to_string(),
                passed: false,
                score: 0.25,
                output: serde_json::json!({}),
                reason: Some("Missing required detail".to_string()),
            }],
            description_candidates: vec![],
        };

        let brief = build_refine_improvement_brief_inner(&run);

        assert!(brief.contains("Results: 1/1 failed"));
        assert!(brief.contains("Missing required detail"));
    }

    #[test]
    fn clones_completed_run_candidates_with_fresh_ids() {
        let draft_candidates = vec![crate::db::DescriptionCandidate {
            id: "candidate-a".to_string(),
            run_id: "draft-run".to_string(),
            label: "Candidate A".to_string(),
            description: "Route finance prompts".to_string(),
            rationale: Some("Tighter boundary".to_string()),
            rank: Some(1),
        }];

        let (cloned, id_map) = clone_persisted_candidates_for_completed_run(&draft_candidates);

        assert_eq!(cloned.len(), 1);
        assert_ne!(cloned[0].id.as_deref(), Some("candidate-a"));
        assert_eq!(id_map.get("candidate-a"), cloned[0].id.as_ref());
        assert_eq!(cloned[0].rationale.as_deref(), Some("Tighter boundary"));
    }

    #[test]
    fn parses_description_candidate_from_structured_output() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "description": "Use when the user asks for quarterly revenue forecasting.",
                "rationale": "Narrows the trigger to explicit revenue planning requests."
            }
        });

        let candidate =
            parse_description_candidate_response(&state, "Candidate 1".to_string(), 1).unwrap();

        assert_eq!(candidate.label, "Candidate 1");
        assert!(candidate.description.contains("quarterly revenue forecasting"));
        assert_eq!(
            candidate.rationale.as_deref(),
            Some("Narrows the trigger to explicit revenue planning requests.")
        );
    }

    #[test]
    fn builds_candidate_generation_prompt_from_prompt_set() {
        let prompt_set = EvalPromptSet {
            id: "prompt-set".to_string(),
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            mode: EvalWorkbenchMode::Trigger,
            name: "Trigger".to_string(),
            cases: vec![crate::db::EvalPromptCase {
                id: "case-1".to_string(),
                prompt: "Reconcile customer invoices for finance".to_string(),
                expected: None,
                should_trigger: Some(true),
                assertions: serde_json::json!([]),
                sort_order: 0,
            }],
            created_at: "2026-05-04T00:00:00Z".to_string(),
            updated_at: "2026-05-04T00:00:00Z".to_string(),
        };

        let prompt = build_description_candidate_prompt(
            &prompt_set,
            "Use when the user asks for finance help",
            1,
        );

        assert!(prompt.contains("customer invoices"));
        assert!(prompt.contains("Variant guidance #1"));
    }

    #[test]
    fn rejects_description_candidate_from_other_prompt_set() {
        let mut conn = create_test_db_for_tests();
        let prompt_set_a = save_eval_prompt_set(&mut conn, valid_prompt_set(EvalWorkbenchMode::Trigger)).unwrap();
        let mut prompt_set_b_input = valid_prompt_set(EvalWorkbenchMode::Trigger);
        prompt_set_b_input.name = "Other".to_string();
        let prompt_set_b = save_eval_prompt_set(&mut conn, prompt_set_b_input).unwrap();

        let run = record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run-a".to_string()),
                prompt_set_id: prompt_set_a.id.clone(),
                mode: EvalWorkbenchMode::Trigger,
                status: "draft".to_string(),
                summary: serde_json::json!({}),
                completed_at: None,
                results: vec![],
                description_candidates: vec![NewDescriptionCandidate {
                    id: Some("candidate-a".to_string()),
                    label: "Candidate A".to_string(),
                    description: "Route revenue forecast prompts".to_string(),
                    rationale: None,
                    rank: Some(1),
                }],
            },
        )
        .unwrap();
        assert_eq!(run.description_candidates.len(), 1);

        let error = read_owned_description_candidate(
            &conn,
            "candidate-a",
            &prompt_set_b.plugin_slug,
            &prompt_set_b.skill_name,
            Some(&prompt_set_b.id),
        )
        .unwrap_err();

        assert!(error.contains("selected prompt set"));
    }

    #[test]
    fn allows_description_candidate_for_matching_prompt_set() {
        let mut conn = create_test_db_for_tests();
        let prompt_set = save_eval_prompt_set(&mut conn, valid_prompt_set(EvalWorkbenchMode::Trigger)).unwrap();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run".to_string()),
                prompt_set_id: prompt_set.id.clone(),
                mode: EvalWorkbenchMode::Trigger,
                status: "draft".to_string(),
                summary: serde_json::json!({}),
                completed_at: None,
                results: vec![],
                description_candidates: vec![NewDescriptionCandidate {
                    id: Some("candidate-a".to_string()),
                    label: "Candidate A".to_string(),
                    description: "Route revenue forecast prompts".to_string(),
                    rationale: None,
                    rank: Some(1),
                }],
            },
        )
        .unwrap();

        let candidate = read_owned_description_candidate(
            &conn,
            "candidate-a",
            &prompt_set.plugin_slug,
            &prompt_set.skill_name,
            Some(&prompt_set.id),
        )
        .unwrap();

        assert_eq!(candidate.id, "candidate-a");
    }
}
