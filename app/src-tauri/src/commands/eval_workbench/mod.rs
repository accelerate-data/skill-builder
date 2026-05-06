pub mod scenarios;
pub mod types;

use crate::agents::openhands_server::{
    cancel_openhands_one_shots_with_prefix, run_openhands_one_shot, OpenHandsOneShotRunParams,
};
use crate::agents::promptfoo_sidecar::process::{
    list_history as list_promptfoo_history, read_history as read_promptfoo_history,
    run_eval as run_promptfoo_eval,
};
use crate::agents::promptfoo_sidecar::protocol::{
    EvalAssertion, EvalAssertionType, EvalCandidate as SidecarEvalCandidate, EvalCase,
    EvalExecution, EvalMode as SidecarEvalMode, ListHistoryRequest, PersistedEvalRun,
    ReadHistoryRequest, RunEvalRequest,
};
use crate::agents::sidecar::{build_openhands_one_shot_config, OpenHandsOneShotConfigParams};
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::refine::{content::get_skill_content_inner_for_plugin, resolve_skills_path};
use crate::commands::workflow::{ensure_workspace_prompts, read_initialized_runtime_context};
use crate::db::{
    get_skill_master_in_plugin, read_description_candidate, read_eval_run as db_read_eval_run,
    record_eval_run as db_record_eval_run, set_skill_behaviour_in_plugin, Db,
    DescriptionCandidate, EvalPromptSet, EvalRun, EvalWorkbenchMode, NewDescriptionCandidate,
    NewEvalRun, NewEvalRunResult,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::Emitter;
pub use types::{
    ApplyDescriptionCandidateResponse, RefineImprovementBrief, RunEvalWorkbenchRequest,
    ScenarioAssertionDto, ScenarioCaseDto, ScenarioDto, ScenarioSummaryDto,
    SuggestAssertionsRequest, SuggestDescriptionCandidatesRequest,
};

const DEFAULT_DESCRIPTION_CANDIDATE_COUNT: u32 = 3;
const CURRENT_SKILL_CANDIDATE_ID: &str = "current-skill";

#[cfg(test)]
use crate::db::{
    list_eval_prompt_sets as db_list_eval_prompt_sets,
    read_eval_prompt_set as db_read_eval_prompt_set, save_eval_prompt_set as db_save_prompt_set,
    SaveEvalPromptSet,
};

fn scenario_runtime_id(
    plugin_slug: &str,
    skill_name: &str,
    scenario_name: &str,
    mode: EvalWorkbenchMode,
) -> String {
    format!(
        "scenario:{}:{}:{}:{}",
        plugin_slug,
        skill_name,
        scenarios::slugify_scenario_name(scenario_name),
        mode.as_str()
    )
}

#[derive(Clone, Default)]
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

#[cfg(test)]
fn validate_prompt_set_input(input: &SaveEvalPromptSet) -> Result<(), String> {
    validate_plugin_slug(&input.plugin_slug)?;
    validate_skill_name(&input.skill_name)?;
    if input.name.trim().is_empty() {
        return Err("Scenario name cannot be empty".to_string());
    }
    for case in &input.cases {
        if case.prompt.trim().is_empty() {
            return Err("Scenario case prompt cannot be empty".to_string());
        }
        if input.mode == EvalWorkbenchMode::Performance && case.should_trigger.is_some() {
            return Err("shouldTrigger is only valid for trigger scenarios".to_string());
        }
        if input.mode == EvalWorkbenchMode::Performance
            && case.expected.as_deref().unwrap_or("").trim().is_empty()
            && case
                .assertions
                .as_array()
                .is_some_and(|items| items.is_empty())
        {
            return Err(
                "Performance scenario cases need an expected outcome or at least one assertion"
                    .to_string(),
            );
        }
        if input.mode == EvalWorkbenchMode::Trigger && case.should_trigger.is_none() {
            return Err("Trigger scenario cases must include shouldTrigger".to_string());
        }
        if !case.assertions.is_array() {
            return Err("Scenario case assertions must be an array".to_string());
        }
    }
    Ok(())
}

fn parse_scenario_tags(tags: &[String]) -> Result<Vec<scenarios::ScenarioTag>, String> {
    if tags.is_empty() {
        return Err("Scenario tags must include at least one mode".to_string());
    }

    let mut parsed = Vec::new();
    for tag in tags {
        let next = match tag.trim() {
            "performance" => scenarios::ScenarioTag::Performance,
            "trigger" => scenarios::ScenarioTag::Trigger,
            "both" => scenarios::ScenarioTag::Both,
            other => return Err(format!("Unsupported scenario tag: {other}")),
        };
        if !parsed.contains(&next) {
            parsed.push(next);
        }
    }
    Ok(parsed)
}

fn scenario_tag_strings(tags: &[scenarios::ScenarioTag]) -> Vec<String> {
    tags.iter()
        .map(|tag| match tag {
            scenarios::ScenarioTag::Performance => "performance",
            scenarios::ScenarioTag::Trigger => "trigger",
            scenarios::ScenarioTag::Both => "both",
        })
        .map(str::to_string)
        .collect()
}

fn scenario_from_dto(dto: ScenarioDto) -> Result<scenarios::Scenario, String> {
    let tags = parse_scenario_tags(&dto.tags)?;
    let cases = dto
        .cases
        .into_iter()
        .map(|case| {
            Ok(scenarios::ScenarioCase {
                id: case.id,
                prompt: case.prompt,
                expected_outcome: case.expected_outcome,
                should_trigger: case.should_trigger,
                assertions: case
                    .assertions
                    .into_iter()
                    .map(|assertion| scenarios::ScenarioAssertion {
                        assertion_type: assertion.assertion_type,
                        value: assertion.value,
                    })
                    .collect(),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let scenario = scenarios::Scenario {
        name: dto.name,
        tags,
        cases,
    };
    scenarios::validate_scenario(&scenario)?;
    Ok(scenario)
}

fn scenario_to_dto(scenario: scenarios::Scenario) -> ScenarioDto {
    ScenarioDto {
        name: scenario.name,
        tags: scenario_tag_strings(&scenario.tags),
        cases: scenario
            .cases
            .into_iter()
            .map(|case| ScenarioCaseDto {
                id: case.id,
                prompt: case.prompt,
                expected_outcome: case.expected_outcome,
                should_trigger: case.should_trigger,
                assertions: case
                    .assertions
                    .into_iter()
                    .map(|assertion| ScenarioAssertionDto {
                        assertion_type: assertion.assertion_type,
                        value: assertion.value,
                    })
                    .collect(),
            })
            .collect(),
    }
}

fn scenario_summary_to_dto(summary: scenarios::ScenarioSummary) -> ScenarioSummaryDto {
    ScenarioSummaryDto {
        name: summary.name,
        tags: scenario_tag_strings(&summary.tags),
    }
}

fn scenario_case_assertions_json(case: &scenarios::ScenarioCase) -> Value {
    Value::Array(
        case.assertions
            .iter()
            .map(|assertion| {
                serde_json::json!({
                    "type": assertion.assertion_type,
                    "value": assertion.value,
                })
            })
            .collect(),
    )
}

fn scenario_run_snapshot(prompt_set: &EvalPromptSet) -> Value {
    serde_json::json!({
        "pluginSlug": prompt_set.plugin_slug,
        "skillName": prompt_set.skill_name,
        "scenarioName": prompt_set.name,
        "mode": prompt_set.mode.as_str(),
        "cases": prompt_set.cases.iter().map(|case| serde_json::json!({
            "id": case.id,
            "prompt": case.prompt,
            "expected": case.expected,
            "shouldTrigger": case.should_trigger,
            "assertions": case.assertions,
            "sortOrder": case.sort_order,
        })).collect::<Vec<_>>()
    })
}

fn summary_with_scenario_snapshot(summary: Value, prompt_set: &EvalPromptSet) -> Value {
    let mut summary_object = match summary {
        Value::Object(object) => object,
        _ => serde_json::Map::new(),
    };
    summary_object.insert("scenarioSnapshot".to_string(), scenario_run_snapshot(prompt_set));
    Value::Object(summary_object)
}

fn scenario_runtime_from_summary_snapshot(snapshot: &Value) -> Result<EvalPromptSet, String> {
    let plugin_slug = snapshot
        .get("pluginSlug")
        .and_then(Value::as_str)
        .ok_or_else(|| "Scenario snapshot missing pluginSlug".to_string())?;
    let skill_name = snapshot
        .get("skillName")
        .and_then(Value::as_str)
        .ok_or_else(|| "Scenario snapshot missing skillName".to_string())?;
    let scenario_name = snapshot
        .get("scenarioName")
        .and_then(Value::as_str)
        .ok_or_else(|| "Scenario snapshot missing scenarioName".to_string())?;
    let mode = snapshot
        .get("mode")
        .and_then(Value::as_str)
        .ok_or_else(|| "Scenario snapshot missing mode".to_string())
        .and_then(EvalWorkbenchMode::parse)?;
    let cases = snapshot
        .get("cases")
        .and_then(Value::as_array)
        .ok_or_else(|| "Scenario snapshot missing cases".to_string())?
        .iter()
        .map(|case| {
            Ok(crate::db::EvalPromptCase {
                id: case
                    .get("id")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Scenario snapshot case missing id".to_string())?
                    .to_string(),
                prompt: case
                    .get("prompt")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "Scenario snapshot case missing prompt".to_string())?
                    .to_string(),
                expected: case
                    .get("expected")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                should_trigger: case.get("shouldTrigger").and_then(Value::as_bool),
                assertions: case
                    .get("assertions")
                    .cloned()
                    .unwrap_or_else(|| Value::Array(vec![])),
                sort_order: case.get("sortOrder").and_then(Value::as_i64).unwrap_or(0),
            })
        })
        .collect::<Result<Vec<_>, String>>()?;

    Ok(EvalPromptSet {
        id: scenario_runtime_id(plugin_slug, skill_name, scenario_name, mode),
        plugin_slug: plugin_slug.to_string(),
        skill_name: skill_name.to_string(),
        mode,
        name: scenario_name.to_string(),
        cases,
        created_at: String::new(),
        updated_at: String::new(),
    })
}

fn resolve_run_scenario(
    conn: &mut rusqlite::Connection,
    skills_path: &Path,
    run: &EvalRun,
) -> Result<EvalPromptSet, String> {
    if let Some(snapshot) = run.summary.get("scenarioSnapshot") {
        return scenario_runtime_from_summary_snapshot(snapshot);
    }

    load_scenario_runtime(
        conn,
        skills_path,
        &run.plugin_slug,
        &run.skill_name,
        &run.scenario_name,
        run.mode,
    )
}

fn read_scenario(
    skills_path: &Path,
    plugin_slug: &str,
    skill_name: &str,
    scenario_name: &str,
) -> Result<scenarios::Scenario, String> {
    let eval_dir = crate::skill_paths::resolve_eval_dir(skills_path, plugin_slug, skill_name);
    scenarios::load_scenario(&eval_dir, scenario_name)?
        .ok_or_else(|| format!("Scenario '{}' not found", scenario_name))
}

fn load_scenario_runtime(
    _conn: &mut rusqlite::Connection,
    skills_path: &Path,
    plugin_slug: &str,
    skill_name: &str,
    scenario_name: &str,
    mode: EvalWorkbenchMode,
) -> Result<EvalPromptSet, String> {
    let scenario = read_scenario(skills_path, plugin_slug, skill_name, scenario_name)?;
    if !scenario.tags.iter().any(|tag| tag.matches_mode(mode)) {
        return Err("Scenario is not available for the selected mode".to_string());
    }

    Ok(EvalPromptSet {
        id: scenario_runtime_id(plugin_slug, skill_name, scenario_name, mode),
        plugin_slug: plugin_slug.to_string(),
        skill_name: skill_name.to_string(),
        mode,
        name: scenario.name,
        cases: scenario
            .cases
            .into_iter()
            .enumerate()
            .map(|(index, case)| {
                let assertions = scenario_case_assertions_json(&case);
                crate::db::EvalPromptCase {
                    id: case.id,
                    prompt: case.prompt,
                    expected: if mode == EvalWorkbenchMode::Performance {
                        case.expected_outcome
                    } else {
                        None
                    },
                    should_trigger: if mode == EvalWorkbenchMode::Trigger {
                        case.should_trigger
                    } else {
                        None
                    },
                    assertions,
                    sort_order: index as i64,
                }
            })
            .collect(),
        created_at: String::new(),
        updated_at: String::new(),
    })
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

fn register_eval_workbench_run(runs: &EvalWorkbenchRunManager, run_id: &str) -> Result<(), String> {
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

fn from_sidecar_mode(mode: SidecarEvalMode) -> EvalWorkbenchMode {
    match mode {
        SidecarEvalMode::Performance => EvalWorkbenchMode::Performance,
        SidecarEvalMode::Trigger => EvalWorkbenchMode::Trigger,
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
                _ => {
                    return Err("Assertion type must be equals, contains, or javascript".to_string())
                }
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
        let skill =
            get_skill_master_in_plugin(conn, &prompt_set.skill_name, &prompt_set.plugin_slug)?
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
            Some(&prompt_set.name),
            Some(prompt_set.mode),
        )?;
        candidates.push(SidecarEvalCandidate {
            id: candidate.id,
            label: candidate.label,
            description: Some(candidate.description),
        });
    }
    if candidates.len() == 1 {
        return Err(
            "Trigger comparisons require at least one generated description candidate".to_string(),
        );
    }
    Ok(candidates)
}

fn read_owned_description_candidate(
    conn: &rusqlite::Connection,
    candidate_id: &str,
    plugin_slug: &str,
    skill_name: &str,
    scenario_name: Option<&str>,
    mode: Option<EvalWorkbenchMode>,
) -> Result<crate::db::DescriptionCandidate, String> {
    let candidate = read_description_candidate(conn, candidate_id)?
        .ok_or_else(|| format!("Description candidate not found: {candidate_id}"))?;
    let run = db_read_eval_run(conn, &candidate.run_id)?
        .ok_or_else(|| format!("Eval run not found for candidate: {candidate_id}"))?;

    if run.plugin_slug != plugin_slug || run.skill_name != skill_name {
        return Err(format!(
            "Description candidate does not belong to skill {} in plugin {}",
            skill_name, plugin_slug
        ));
    }
    if let Some(expected_scenario_name) = scenario_name {
        if run.scenario_name != expected_scenario_name {
            return Err(
                "Description candidate does not belong to the selected scenario".to_string(),
            );
        }
    }
    if let Some(expected_mode) = mode {
        if run.mode != expected_mode {
            return Err(
                "Description candidate does not belong to the selected mode".to_string(),
            );
        }
    }

    Ok(candidate)
}

fn write_skill_description_to_disk(
    db: &Db,
    plugin_slug: &str,
    skill_name: &str,
    description: &str,
) -> Result<(PathBuf, String), String> {
    let skills_path = resolve_skills_path(db)?;
    let skill_md_path =
        crate::skill_paths::resolve_skill_dir(Path::new(&skills_path), plugin_slug, skill_name)
            .join("SKILL.md");
    let current_content = std::fs::read_to_string(&skill_md_path)
        .map_err(|error| format!("Failed to read SKILL.md: {error}"))?;
    let updated_content =
        crate::commands::refine::output::update_skill_description(&current_content, description)?;
    std::fs::write(&skill_md_path, updated_content)
        .map_err(|error| format!("Failed to write SKILL.md: {error}"))?;
    Ok((skill_md_path, current_content))
}

fn extract_completed_openhands_state(
    state: &serde_json::Value,
) -> Result<&serde_json::Value, String> {
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

    serde_json::from_str(text)
        .map_err(|error| format!("OpenHands eval structured result was not valid JSON: {error}"))
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

fn generated_scenarios_output_format() -> Value {
    serde_json::json!({
        "type": "json_schema",
        "name": "eval_workbench_generated_scenarios",
        "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "scenarios": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "name": { "type": "string" },
                            "tags": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": ["performance", "trigger", "both"]
                                }
                            },
                            "cases": {
                                "type": "array",
                                "items": {
                                    "type": "object",
                                    "additionalProperties": false,
                                    "properties": {
                                        "id": { "type": "string" },
                                        "prompt": { "type": "string" },
                                        "expectedOutcome": { "type": ["string", "null"] },
                                        "shouldTrigger": { "type": ["boolean", "null"] },
                                        "assertions": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "additionalProperties": false,
                                                "properties": {
                                                    "type": { "type": "string" },
                                                    "value": { "type": "string" }
                                                },
                                                "required": ["type", "value"]
                                            }
                                        }
                                    },
                                    "required": ["id", "prompt", "assertions"]
                                }
                            }
                        },
                        "required": ["name", "tags", "cases"]
                    }
                }
            },
            "required": ["scenarios"]
        }
    })
}

fn suggested_assertions_output_format() -> Value {
    serde_json::json!({
        "type": "json_schema",
        "name": "eval_workbench_suggested_assertions",
        "schema": {
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "assertions": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "additionalProperties": false,
                        "properties": {
                            "type": {
                                "type": "string",
                                "enum": ["equals", "contains", "javascript"]
                            },
                            "value": { "type": "string" }
                        },
                        "required": ["type", "value"]
                    }
                }
            },
            "required": ["assertions"]
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
Keep the candidate grounded in the real skill behavior and the trigger boundary implied by the scenario.\n\
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

fn build_generated_scenarios_prompt(
    skill_name: &str,
    skill_files: &[crate::types::SkillFileContent],
) -> String {
    let skill_context = skill_files
        .iter()
        .take(8)
        .map(|file| format!("## {}\n{}", file.path, file.content))
        .collect::<Vec<_>>()
        .join("\n\n");

    format!(
        "Generate 3 to 5 eval scenarios for the skill `{skill_name}`.\n\
Return JSON with a top-level `scenarios` array.\n\
Each scenario must have:\n\
- `name`\n\
- `tags`: one or more of `performance`, `trigger`, `both`\n\
- `cases`: 2 to 4 realistic user prompts\n\
Each case must have:\n\
- `id` in kebab-case\n\
- `prompt`\n\
- `expectedOutcome` for performance or both scenarios\n\
- `shouldTrigger` for trigger or both scenarios\n\
- `assertions`: 0 to 3 assertions using only equals, contains, or javascript\n\
Include at least one negative trigger case with shouldTrigger=false.\n\
Use the skill context below and do not mention eval internals.\n\n\
{skill_context}",
    )
}

fn build_suggested_assertions_prompt(prompt: &str, expected_outcome: &str) -> String {
    format!(
        "Suggest 1 to 3 automated assertions for this eval case.\n\
Return JSON with a top-level `assertions` array.\n\
Each assertion must use one of: equals, contains, javascript.\n\
Prefer contains for key phrases and javascript for simple structural checks.\n\
Do not include prose outside the JSON.\n\n\
User prompt:\n{prompt}\n\n\
Expected outcome:\n{expected_outcome}\n",
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
Scenario: {}\n\
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

fn build_generation_sidecar_config(
    plugin_slug: &str,
    skill_name: &str,
    prompt: &str,
    output_format: Value,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_root_dir = runtime_ctx.workspace_path.replace('\\', "/");
    let workspace_run_dir = crate::skill_paths::workspace_skill_dir(
        Path::new(&runtime_ctx.workspace_path),
        plugin_slug,
        skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");

    build_openhands_one_shot_config(OpenHandsOneShotConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        workspace_root_dir,
        workspace_run_dir,
        agent_name: "skill-creator".to_string(),
        task_kind: Some("eval_workbench.generation".to_string()),
        user_message_suffix: None,
        allowed_tools: vec![],
        max_turns: 20,
        output_format: Some(output_format),
        skill_name: Some(skill_name.to_string()),
        step_id: Some(-13),
        run_source: Some("eval-workbench".to_string()),
        plugin_slug: plugin_slug.to_string(),
    })
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

fn parse_generated_scenarios_response(
    state: &serde_json::Value,
) -> Result<Vec<ScenarioDto>, String> {
    let parsed = parse_openhands_structured_output(state)?;
    let scenarios = parsed
        .get("scenarios")
        .and_then(Value::as_array)
        .ok_or_else(|| "Scenario generation response missing scenarios array".to_string())?;
    if !(3..=5).contains(&scenarios.len()) {
        return Err("Scenario generation must return between 3 and 5 scenarios".to_string());
    }

    scenarios
        .iter()
        .cloned()
        .map(|item| serde_json::from_value::<ScenarioDto>(item).map_err(|e| e.to_string()))
        .collect()
}

fn parse_suggested_assertions_response(
    state: &serde_json::Value,
) -> Result<Vec<ScenarioAssertionDto>, String> {
    let parsed = parse_openhands_structured_output(state)?;
    let assertions = parsed
        .get("assertions")
        .and_then(Value::as_array)
        .ok_or_else(|| "Assertion suggestion response missing assertions array".to_string())?;
    if !(1..=3).contains(&assertions.len()) {
        return Err("Assertion suggestion must return between 1 and 3 assertions".to_string());
    }

    assertions
        .iter()
        .cloned()
        .map(|item| serde_json::from_value::<ScenarioAssertionDto>(item).map_err(|e| e.to_string()))
        .collect()
}

fn build_performance_sidecar_config(
    prompt_set: &EvalPromptSet,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_root_dir = runtime_ctx.workspace_path.replace('\\', "/");
    let workspace_run_dir = crate::skill_paths::workspace_skill_dir(
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
    let skill_dir = workspace_skill_dir
        .join(".agents")
        .join("skills")
        .join(skill_name);
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
    let workspace_run_dir = crate::skill_paths::workspace_skill_dir(
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
    let workspace_run_dir = crate::skill_paths::workspace_skill_dir(
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

fn promptfoo_config_dir(data_dir: &crate::DataDir) -> PathBuf {
    data_dir.0.join("promptfoo")
}

fn persisted_run_to_eval_run(
    run: PersistedEvalRun,
    description_candidates: Vec<DescriptionCandidate>,
) -> EvalRun {
    let PersistedEvalRun {
        id,
        promptfoo_eval_id,
        plugin_slug,
        skill_name,
        scenario_name,
        mode,
        status,
        summary,
        scenario_snapshot,
        created_at,
        completed_at,
        results,
    } = run;

    let mut summary_value = serde_json::json!({
        "total": summary.total,
        "passed": summary.passed,
        "failed": summary.failed,
        "passRate": summary.pass_rate,
    });
    if let Some(snapshot) = scenario_snapshot {
        if let Some(summary_object) = summary_value.as_object_mut() {
            summary_object.insert("scenarioSnapshot".to_string(), snapshot);
        }
    }

    EvalRun {
        id: id.clone(),
        prompt_set_id: None,
        plugin_slug,
        skill_name,
        scenario_name,
        mode: from_sidecar_mode(mode),
        status,
        summary: summary_value,
        created_at,
        completed_at,
        results: results
            .into_iter()
            .map(|result| crate::db::EvalRunResult {
                id: format!("{}:{}:{}", promptfoo_eval_id, result.case_id, result.candidate_id),
                run_id: id.clone(),
                case_id: result.case_id,
                candidate_id: result.candidate_id,
                passed: result.passed,
                score: result.score,
                output: result.output,
                reason: result.reason,
            })
            .collect(),
        description_candidates,
    }
}

fn load_description_candidates_for_run(
    conn: &rusqlite::Connection,
    run_id: &str,
) -> Result<Vec<DescriptionCandidate>, String> {
    Ok(db_read_eval_run(conn, run_id)?
        .map(|run| run.description_candidates)
        .unwrap_or_default())
}

fn materialize_eval_run_for_read(
    conn: &rusqlite::Connection,
    run_id: &str,
    persisted_run: Option<PersistedEvalRun>,
) -> Result<Option<EvalRun>, String> {
    match persisted_run {
        Some(run) => Ok(Some(persisted_run_to_eval_run(
            run,
            load_description_candidates_for_run(conn, run_id)?,
        ))),
        None => Ok(db_read_eval_run(conn, run_id)?.filter(|run| run.status == "draft")),
    }
}

fn load_refine_context(
    conn: &mut rusqlite::Connection,
    skills_path: &Path,
    run_id: &str,
    persisted_run: Option<PersistedEvalRun>,
) -> Result<(EvalRun, EvalPromptSet, Vec<crate::types::SkillFileContent>), String> {
    let run = materialize_eval_run_for_read(conn, run_id, persisted_run)?
        .ok_or_else(|| "Eval run not found".to_string())?;
    let prompt_set = resolve_run_scenario(conn, skills_path, &run)?;
    let skill_files = if run.mode == EvalWorkbenchMode::Performance {
        get_skill_content_inner_for_plugin(
            &prompt_set.skill_name,
            &skills_path.to_string_lossy(),
            &prompt_set.plugin_slug,
        )?
    } else {
        Vec::new()
    };

    Ok((run, prompt_set, skill_files))
}

#[cfg(test)]
async fn list_eval_runs_with_deps<FList, FListFut>(
    conn: &rusqlite::Connection,
    promptfoo_config_dir: &str,
    plugin_slug: &str,
    skill_name: &str,
    mode: EvalWorkbenchMode,
    limit: i64,
    list_history: FList,
) -> Result<Vec<EvalRun>, String>
where
    FList: FnOnce(ListHistoryRequest) -> FListFut,
    FListFut: Future<Output = Result<Vec<PersistedEvalRun>, String>>,
{
    let request = ListHistoryRequest::new(
        format!("list-history-{plugin_slug}-{skill_name}-{}", mode.as_str()),
        promptfoo_config_dir.to_string(),
        plugin_slug.to_string(),
        skill_name.to_string(),
        None,
        to_sidecar_mode(mode),
        limit,
    );
    let runs = list_history(request).await?;

    runs.into_iter()
        .map(|run| {
            let description_candidates = load_description_candidates_for_run(conn, &run.id)?;
            Ok(persisted_run_to_eval_run(run, description_candidates))
        })
        .collect()
}

#[cfg(test)]
async fn read_eval_run_with_deps<FRead, FReadFut>(
    conn: &rusqlite::Connection,
    promptfoo_config_dir: &str,
    run_id: &str,
    read_history: FRead,
) -> Result<Option<EvalRun>, String>
where
    FRead: FnOnce(ReadHistoryRequest) -> FReadFut,
    FReadFut: Future<Output = Result<Option<PersistedEvalRun>, String>>,
{
    let request = ReadHistoryRequest::new(
        format!("read-history-{run_id}"),
        promptfoo_config_dir.to_string(),
        run_id.to_string(),
    );
    let persisted_run = read_history(request).await?;
    materialize_eval_run_for_read(conn, run_id, persisted_run)
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
    context: EvalRunBuildContext,
    execute_cases: FExec,
    evaluate_run: FEval,
) -> Result<NewEvalRun, String>
where
    FExec: FnOnce(EvalPromptSet, Vec<EvalCase>, Vec<SidecarEvalCandidate>) -> FExecFut,
    FExecFut: Future<Output = Result<Vec<EvalExecution>, String>>,
    FEval: FnOnce(RunEvalRequest) -> FEvalFut,
    FEvalFut:
        Future<Output = Result<crate::agents::promptfoo_sidecar::protocol::EvalRunResult, String>>,
{
    let EvalRunBuildContext {
        runs,
        run_id,
        promptfoo_config_dir,
        prompt_set,
        mut sidecar_candidates,
        sidecar_cases,
        persisted_candidates,
    } = context;
    let executions = execute_cases(
        prompt_set.clone(),
        sidecar_cases.clone(),
        sidecar_candidates.clone(),
    )
    .await?;
    ensure_eval_workbench_not_cancelled(&runs, &run_id)?;
    let (persisted_candidates, candidate_id_map) =
        clone_persisted_candidates_for_completed_run(&persisted_candidates);
    for candidate in &mut sidecar_candidates {
        if let Some(remapped_id) = candidate_id_map.get(&candidate.id) {
            candidate.id = remapped_id.clone();
        }
    }
    let executions = executions
        .into_iter()
        .map(|mut execution| {
            if let Some(remapped_id) = candidate_id_map.get(&execution.candidate_id) {
                execution.candidate_id = remapped_id.clone();
            }
            execution
        })
        .collect();
    let sidecar_request = RunEvalRequest::new(
        run_id.clone(),
        to_sidecar_mode(prompt_set.mode),
        prompt_set.skill_name.clone(),
        prompt_set.plugin_slug.clone(),
        prompt_set.name.clone(),
        promptfoo_config_dir,
        sidecar_candidates,
        sidecar_cases,
        executions,
    );
    let result = evaluate_run(sidecar_request).await?;
    ensure_eval_workbench_not_cancelled(&runs, &run_id)?;

    Ok(NewEvalRun {
        id: Some(run_id),
        prompt_set_id: None,
        plugin_slug: prompt_set.plugin_slug.clone(),
        skill_name: prompt_set.skill_name.clone(),
        scenario_name: prompt_set.name.clone(),
        mode: prompt_set.mode,
        status: "completed".to_string(),
        summary: summary_with_scenario_snapshot(build_run_summary(&result), &prompt_set),
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

struct EvalRunBuildContext {
    runs: EvalWorkbenchRunManager,
    run_id: String,
    promptfoo_config_dir: String,
    prompt_set: EvalPromptSet,
    sidecar_candidates: Vec<SidecarEvalCandidate>,
    sidecar_cases: Vec<EvalCase>,
    persisted_candidates: Vec<crate::db::DescriptionCandidate>,
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
pub fn list_scenarios(
    plugin_slug: String,
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ScenarioSummaryDto>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    scenarios::list_scenarios(&eval_dir)
        .map(|items| items.into_iter().map(scenario_summary_to_dto).collect())
}

#[tauri::command]
pub fn load_scenario(
    plugin_slug: String,
    skill_name: String,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<ScenarioDto>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    scenarios::validate_scenario_name(&scenario_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    scenarios::load_scenario(&eval_dir, &scenario_name)
        .map(|scenario| scenario.map(scenario_to_dto))
}

#[tauri::command]
pub fn save_scenario(
    plugin_slug: String,
    skill_name: String,
    scenario: ScenarioDto,
    previous_scenario_name: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let scenario = scenario_from_dto(scenario)?;
    if let Some(previous_scenario_name) = previous_scenario_name.as_deref() {
        scenarios::validate_scenario_name(previous_scenario_name)?;
    }
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    let path = scenarios::scenario_file_path(&eval_dir, &scenario.name);
    let existing_scenario = scenarios::load_scenario(&eval_dir, &scenario.name)?;
    let existing_target_scenario = if path.exists() {
        scenarios::read_scenario_file(&path).ok()
    } else {
        None
    };
    let is_rename =
        previous_scenario_name.as_deref().is_some_and(|previous| previous != scenario.name);
    let is_create = previous_scenario_name.is_none();
    if existing_scenario.is_some() && (is_create || is_rename) {
        return Err(format!("Scenario '{}' already exists", scenario.name));
    }
    let target_path_matches_existing = existing_target_scenario.as_ref().is_some_and(|existing| {
        existing.name == scenario.name
            || previous_scenario_name.as_deref() == Some(existing.name.as_str())
    });
    if existing_target_scenario.is_some() && !target_path_matches_existing {
        return Err(format!(
            "Scenario '{}' conflicts with existing slug '{}'",
            scenario.name,
            scenarios::slugify_scenario_name(&scenario.name)
        ));
    }
    scenarios::write_scenario_file(&path, &scenario)?;
    scenarios::delete_other_scenario_files(&eval_dir, &scenario.name, &path)?;
    if let Some(previous_scenario_name) = previous_scenario_name.as_deref() {
        if previous_scenario_name != scenario.name {
            scenarios::delete_scenario_file(&eval_dir, previous_scenario_name)?;
        }
    }

    Ok(scenario_to_dto(scenario))
}

#[tauri::command]
pub fn delete_scenario(
    plugin_slug: String,
    skill_name: String,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    scenarios::validate_scenario_name(&scenario_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    scenarios::delete_scenario_file(&eval_dir, &scenario_name)?;
    Ok(())
}

#[tauri::command]
pub async fn generate_scenarios(
    app: tauri::AppHandle,
    plugin_slug: String,
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ScenarioDto>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;

    let skills_path = resolve_skills_path(&db)?;
    let skill_files = get_skill_content_inner_for_plugin(&skill_name, &skills_path, &plugin_slug)?;
    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let prompt = build_generated_scenarios_prompt(&skill_name, &skill_files);
    let config = build_generation_sidecar_config(
        &plugin_slug,
        &skill_name,
        &prompt,
        generated_scenarios_output_format(),
        &runtime_ctx,
    );
    let run = run_openhands_one_shot(
        &app,
        OpenHandsOneShotRunParams {
            agent_id_prefix: format!("{}-scenario-gen", skill_name),
            config,
            timeout: std::time::Duration::from_secs(90),
        },
    )
    .await?;

    parse_generated_scenarios_response(&run.conversation_state)
}

#[tauri::command]
pub async fn suggest_assertions(
    app: tauri::AppHandle,
    request: SuggestAssertionsRequest,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ScenarioAssertionDto>, String> {
    validate_plugin_slug(&request.plugin_slug)?;
    validate_skill_name(&request.skill_name)?;
    if request.prompt.trim().is_empty() {
        return Err("Prompt cannot be empty".to_string());
    }
    if request.expected_outcome.trim().is_empty() {
        return Err("Expected outcome cannot be empty".to_string());
    }

    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let prompt = build_suggested_assertions_prompt(&request.prompt, &request.expected_outcome);
    let config = build_generation_sidecar_config(
        &request.plugin_slug,
        &request.skill_name,
        &prompt,
        suggested_assertions_output_format(),
        &runtime_ctx,
    );
    let run = run_openhands_one_shot(
        &app,
        OpenHandsOneShotRunParams {
            agent_id_prefix: format!("{}-assertion-gen", request.skill_name),
            config,
            timeout: std::time::Duration::from_secs(60),
        },
    )
    .await?;

    parse_suggested_assertions_response(&run.conversation_state)
}

#[tauri::command]
pub async fn run_eval_workbench(
    app: tauri::AppHandle,
    request: RunEvalWorkbenchRequest,
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, crate::DataDir>,
    runs: tauri::State<'_, EvalWorkbenchRunManager>,
) -> Result<EvalRun, String> {
    validate_id("Run id", &request.run_id)?;
    validate_plugin_slug(&request.plugin_slug)?;
    validate_skill_name(&request.skill_name)?;
    if request.scenario_name.trim().is_empty() {
        return Err("Scenario name cannot be empty".to_string());
    }
    {
        if request.candidate_ids.iter().any(|id| id.trim().is_empty()) {
            return Err("Candidate ids cannot be empty".to_string());
        }
    }

    register_eval_workbench_run(&runs, &request.run_id)?;

    let preparation = || -> Result<_, String> {
        let skills_path = resolve_skills_path(&db)?;
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        let prompt_set = load_scenario_runtime(
            &mut conn,
            Path::new(&skills_path),
            &request.plugin_slug,
            &request.skill_name,
            &request.scenario_name,
            request.mode,
        )?;
        let sidecar_candidates =
            load_sidecar_candidates(&conn, &prompt_set, &request.candidate_ids)?;
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
                        Some(&prompt_set.name),
                        Some(prompt_set.mode),
                    )
                })
                .collect::<Result<Vec<_>, _>>()?
        } else {
            Vec::new()
        };
        let sidecar_cases = to_sidecar_cases(&prompt_set)?;

        Ok((
            prompt_set,
            sidecar_candidates,
            sidecar_cases,
            persisted_candidates,
        ))
    };
    let (prompt_set, sidecar_candidates, sidecar_cases, persisted_candidates) = match preparation()
    {
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
        EvalRunBuildContext {
            runs: run_manager_for_execute.clone(),
            run_id: run_id.clone(),
            promptfoo_config_dir: promptfoo_config_dir(&data_dir)
                .to_string_lossy()
                .to_string(),
            prompt_set,
            sidecar_candidates,
            sidecar_cases,
            persisted_candidates,
        },
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
#[allow(clippy::too_many_arguments)]
pub async fn list_eval_runs(
    app: tauri::AppHandle,
    plugin_slug: String,
    skill_name: String,
    mode: Option<String>,
    limit: Option<i64>,
    scenario_name: Option<String>,
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, crate::DataDir>,
) -> Result<Vec<EvalRun>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    if let Some(scenario_name) = scenario_name.as_deref() {
        scenarios::validate_scenario_name(scenario_name)?;
    }
    let Some(mode) = parse_optional_mode(mode)? else {
        return Err("Eval Workbench run history requires a mode".to_string());
    };
    let request = ListHistoryRequest::new(
        format!("list-history-{plugin_slug}-{skill_name}-{}", mode.as_str()),
        promptfoo_config_dir(&data_dir).to_string_lossy().to_string(),
        plugin_slug.clone(),
        skill_name.clone(),
        scenario_name,
        to_sidecar_mode(mode),
        limit.unwrap_or(50),
    );
    let runs = list_promptfoo_history(&app, &request).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    runs.into_iter()
        .map(|run| {
            let description_candidates = load_description_candidates_for_run(&conn, &run.id)?;
            Ok(persisted_run_to_eval_run(run, description_candidates))
        })
        .collect()
}

#[tauri::command]
pub async fn read_eval_run(
    app: tauri::AppHandle,
    run_id: String,
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, crate::DataDir>,
) -> Result<Option<EvalRun>, String> {
    validate_id("Run id", &run_id)?;
    let request = ReadHistoryRequest::new(
        format!("read-history-{run_id}"),
        promptfoo_config_dir(&data_dir).to_string_lossy().to_string(),
        run_id.clone(),
    );
    let persisted_run = read_promptfoo_history(&app, &request).await?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    materialize_eval_run_for_read(&conn, &run_id, persisted_run)
}

#[tauri::command]
pub async fn suggest_description_candidates(
    app: tauri::AppHandle,
    request: SuggestDescriptionCandidatesRequest,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::DescriptionCandidate>, String> {
    validate_plugin_slug(&request.plugin_slug)?;
    validate_skill_name(&request.skill_name)?;
    if request.scenario_name.trim().is_empty() {
        return Err("Scenario name cannot be empty".to_string());
    }
    if request.baseline_description.trim().is_empty() {
        return Err("Baseline description cannot be empty".to_string());
    }

    let prompt_set = {
        let skills_path = resolve_skills_path(&db)?;
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        load_scenario_runtime(
            &mut conn,
            Path::new(&skills_path),
            &request.plugin_slug,
            &request.skill_name,
            &request.scenario_name,
            EvalWorkbenchMode::Trigger,
        )?
    };
    if prompt_set.mode != EvalWorkbenchMode::Trigger {
        return Err("Description candidates require a trigger scenario".to_string());
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
            prompt_set_id: None,
            plugin_slug: prompt_set.plugin_slug.clone(),
            skill_name: prompt_set.skill_name.clone(),
            scenario_name: prompt_set.name.clone(),
            mode: EvalWorkbenchMode::Trigger,
            status: "draft".to_string(),
            summary: summary_with_scenario_snapshot(
                serde_json::json!({ "candidateCount": candidate_count, "status": "draft" }),
                &prompt_set,
            ),
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
    let candidate = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        read_owned_description_candidate(&conn, &candidate_id, &plugin_slug, &skill_name, None, None)?
    };
    let (skill_md_path, previous_content) =
        write_skill_description_to_disk(&db, &plugin_slug, &skill_name, &candidate.description)?;
    if let Err(error) = (|| -> Result<(), String> {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
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
        )
    })() {
        let _ = std::fs::write(&skill_md_path, previous_content);
        return Err(error);
    }
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
    data_dir: tauri::State<'_, crate::DataDir>,
) -> Result<RefineImprovementBrief, String> {
    validate_id("Run id", &run_id)?;
    let skills_path = resolve_skills_path(&db)?;
    let request = ReadHistoryRequest::new(
        format!("read-history-{run_id}"),
        promptfoo_config_dir(&data_dir).to_string_lossy().to_string(),
        run_id.clone(),
    );
    let persisted_run = read_promptfoo_history(&app, &request).await?;
    let (run, prompt_set, skill_files) = {
        let mut conn = db.0.lock().map_err(|e| e.to_string())?;
        load_refine_context(&mut conn, Path::new(&skills_path), &run_id, persisted_run)?
    };

    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let prompt =
        build_eval_diagnosis_prompt(&run, &prompt_set, &skill_files, &run.description_candidates);
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
    use crate::db::{
        create_test_db_for_tests, record_eval_run, save_eval_prompt_set, write_settings,
    };
    use crate::commands::eval_workbench::scenarios::write_scenario_file;
    use crate::skill_paths::resolve_eval_dir;
    use crate::types::AppSettings;
    use std::path::Path;

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

    fn sample_persisted_run(id: &str) -> PersistedEvalRun {
        PersistedEvalRun {
            id: id.to_string(),
            promptfoo_eval_id: format!("promptfoo-{id}"),
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            scenario_name: "Promptfoo scenario".to_string(),
            mode: SidecarEvalMode::Trigger,
            status: "completed".to_string(),
            summary: crate::agents::promptfoo_sidecar::protocol::PersistedEvalRunSummary {
                total: 1,
                passed: 1,
                failed: 0,
                pass_rate: 1.0,
            },
            scenario_snapshot: Some(serde_json::json!({
                "pluginSlug": "skills",
                "skillName": "forecast",
                "scenarioName": "Promptfoo scenario",
                "mode": "trigger",
                "cases": [{
                    "id": "case-1",
                    "prompt": "Forecast next quarter revenue",
                    "shouldTrigger": true,
                    "assertions": [],
                    "sortOrder": 0
                }]
            })),
            created_at: "2026-05-05T00:00:00Z".to_string(),
            completed_at: Some("2026-05-05T00:00:01Z".to_string()),
            results: vec![crate::agents::promptfoo_sidecar::protocol::EvalCaseResult {
                case_id: "case-1".to_string(),
                candidate_id: "candidate-a".to_string(),
                passed: true,
                score: 1.0,
                output: serde_json::json!({ "invokedTargetSkill": true }),
                reason: None,
            }],
        }
    }

    fn sample_scenario_dto(name: &str) -> ScenarioDto {
        ScenarioDto {
            name: name.to_string(),
            tags: vec!["performance".to_string()],
            cases: vec![ScenarioCaseDto {
                id: "case-1".to_string(),
                prompt: "Forecast next quarter revenue".to_string(),
                expected_outcome: Some("Includes assumptions".to_string()),
                should_trigger: None,
                assertions: vec![ScenarioAssertionDto {
                    assertion_type: "contains".to_string(),
                    value: "assumptions".to_string(),
                }],
            }],
        }
    }

    fn sample_trigger_scenario_dto(name: &str) -> ScenarioDto {
        ScenarioDto {
            name: name.to_string(),
            tags: vec!["trigger".to_string()],
            cases: vec![ScenarioCaseDto {
                id: "case-1".to_string(),
                prompt: "Route invoice reconciliation".to_string(),
                expected_outcome: None,
                should_trigger: Some(true),
                assertions: vec![],
            }],
        }
    }

    fn create_scenario_db(skills_path: &Path) -> Db {
        let conn = create_test_db_for_tests();
        write_settings(
            &conn,
            &AppSettings {
                skills_path: Some(skills_path.display().to_string()),
                ..AppSettings::default()
            },
        )
        .unwrap();

        Db(std::sync::Mutex::new(conn))
    }

    fn mirrored_scenario_prompt_set_count(
        conn: &rusqlite::Connection,
        plugin_slug: &str,
        skill_name: &str,
        mode: EvalWorkbenchMode,
    ) -> usize {
        db_list_eval_prompt_sets(conn, plugin_slug, skill_name, Some(mode))
            .unwrap()
            .into_iter()
            .filter(|set| set.id.starts_with("scenario:"))
            .count()
    }

    fn db_state(db: &Db) -> tauri::State<'_, Db> {
        // SAFETY: `tauri::State<'_, T>` is a transparent wrapper over `&T`.
        // This keeps the tests on the command layer without needing the Tauri test runtime.
        unsafe { std::mem::transmute(db) }
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
            prompt_set_id: Some("prompt-set-1".to_string()),
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            scenario_name: "Regression".to_string(),
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

    #[tokio::test]
    async fn build_completed_eval_run_persists_scenario_snapshot_for_file_backed_runs() {
        let prompt_set = EvalPromptSet {
            id: scenario_runtime_id(
                "skills",
                "forecast",
                "Regression",
                EvalWorkbenchMode::Performance,
            ),
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            mode: EvalWorkbenchMode::Performance,
            name: "Regression".to_string(),
            cases: vec![crate::db::EvalPromptCase {
                id: "case-1".to_string(),
                prompt: "Forecast next quarter revenue".to_string(),
                expected: Some("Includes assumptions".to_string()),
                should_trigger: None,
                assertions: serde_json::json!([{ "type": "contains", "value": "assumptions" }]),
                sort_order: 0,
            }],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let result = build_completed_eval_run_with_deps(
            EvalRunBuildContext {
                runs: EvalWorkbenchRunManager::default(),
                run_id: "run-1".to_string(),
                promptfoo_config_dir: "/tmp/promptfoo".to_string(),
                prompt_set,
                sidecar_candidates: vec![SidecarEvalCandidate {
                    id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
                    label: "Current skill".to_string(),
                    description: Some("Current description".to_string()),
                }],
                sidecar_cases: vec![EvalCase {
                    id: "case-1".to_string(),
                    prompt: "Forecast next quarter revenue".to_string(),
                    expected: Some("Includes assumptions".to_string()),
                    should_trigger: None,
                    assertions: vec![EvalAssertion {
                        assertion_type: EvalAssertionType::Contains,
                        value: serde_json::json!("assumptions"),
                    }],
                }],
                persisted_candidates: vec![],
            },
            |_prompt_set, _cases, _candidates| async {
                Ok(vec![EvalExecution {
                    case_id: "case-1".to_string(),
                    candidate_id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
                    output: serde_json::json!({ "responseText": "Includes assumptions" }),
                }])
            },
            |_request| async {
                Ok(crate::agents::promptfoo_sidecar::protocol::EvalRunResult {
                    mode: crate::agents::promptfoo_sidecar::protocol::EvalMode::Performance,
                    passed: 1,
                    failed: 0,
                    total: 1,
                    results: vec![crate::agents::promptfoo_sidecar::protocol::EvalCaseResult {
                        case_id: "case-1".to_string(),
                        candidate_id: CURRENT_SKILL_CANDIDATE_ID.to_string(),
                        passed: true,
                        score: 1.0,
                        output: serde_json::json!({ "responseText": "Includes assumptions" }),
                        reason: None,
                    }],
                })
            },
        )
        .await
        .unwrap();

        assert_eq!(result.prompt_set_id, None);
        assert_eq!(
            result.summary.get("scenarioSnapshot"),
            Some(&serde_json::json!({
                "pluginSlug": "skills",
                "skillName": "forecast",
                "scenarioName": "Regression",
                "mode": "performance",
                "cases": [{
                    "id": "case-1",
                    "prompt": "Forecast next quarter revenue",
                    "expected": "Includes assumptions",
                    "shouldTrigger": null,
                    "assertions": [{ "type": "contains", "value": "assumptions" }],
                    "sortOrder": 0
                }]
            }))
        );
    }

    #[test]
    fn resolve_run_scenario_uses_summary_snapshot_after_scenario_file_is_deleted() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let prompt_set = EvalPromptSet {
            id: scenario_runtime_id(
                "skills",
                "forecast",
                "Regression",
                EvalWorkbenchMode::Performance,
            ),
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            mode: EvalWorkbenchMode::Performance,
            name: "Regression".to_string(),
            cases: vec![crate::db::EvalPromptCase {
                id: "case-1".to_string(),
                prompt: "Forecast next quarter revenue".to_string(),
                expected: Some("Includes assumptions".to_string()),
                should_trigger: None,
                assertions: serde_json::json!([{ "type": "contains", "value": "assumptions" }]),
                sort_order: 0,
            }],
            created_at: String::new(),
            updated_at: String::new(),
        };
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let scenario_path = scenarios::scenario_file_path(&eval_dir, "Regression");
        scenarios::write_scenario_file(
            &scenario_path,
            &scenario_from_dto(sample_scenario_dto("Regression")).unwrap(),
        )
        .unwrap();

        {
            let mut conn = db.0.lock().unwrap();
            record_eval_run(
                &mut conn,
                NewEvalRun {
                    id: Some("run-1".to_string()),
                    prompt_set_id: None,
                    plugin_slug: "skills".to_string(),
                    skill_name: "forecast".to_string(),
                    scenario_name: "Regression".to_string(),
                    mode: EvalWorkbenchMode::Performance,
                    status: "completed".to_string(),
                    summary: summary_with_scenario_snapshot(
                        serde_json::json!({ "passRate": 1.0 }),
                        &prompt_set,
                    ),
                    completed_at: None,
                    results: vec![],
                    description_candidates: vec![],
                },
            )
            .unwrap();
        }
        std::fs::remove_file(&scenario_path).unwrap();

        let mut conn = db.0.lock().unwrap();
        let run = db_read_eval_run(&conn, "run-1").unwrap().unwrap();
        let resolved = resolve_run_scenario(&mut conn, tmp.path(), &run).unwrap();

        assert_eq!(resolved.name, "Regression");
        assert_eq!(resolved.mode, EvalWorkbenchMode::Performance);
        assert_eq!(resolved.cases.len(), 1);
        assert_eq!(resolved.cases[0].prompt, "Forecast next quarter revenue");
        assert_eq!(
            resolved.cases[0].expected.as_deref(),
            Some("Includes assumptions")
        );
    }

    #[test]
    fn resolve_run_scenario_does_not_fall_back_to_legacy_prompt_set_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());

        let legacy_prompt_set = {
            let mut conn = db.0.lock().unwrap();
            let mut input = valid_prompt_set(EvalWorkbenchMode::Performance);
            input.name = "Legacy scenario".to_string();
            save_eval_prompt_set(&mut conn, input).unwrap()
        };

        {
            let mut conn = db.0.lock().unwrap();
            record_eval_run(
                &mut conn,
                NewEvalRun {
                    id: Some("legacy-run".to_string()),
                    prompt_set_id: Some(legacy_prompt_set.id.clone()),
                    plugin_slug: legacy_prompt_set.plugin_slug.clone(),
                    skill_name: legacy_prompt_set.skill_name.clone(),
                    scenario_name: legacy_prompt_set.name.clone(),
                    mode: legacy_prompt_set.mode,
                    status: "completed".to_string(),
                    summary: serde_json::json!({ "passRate": 1.0 }),
                    completed_at: None,
                    results: vec![],
                    description_candidates: vec![],
                },
            )
            .unwrap();
        }

        let mut conn = db.0.lock().unwrap();
        let run = db_read_eval_run(&conn, "legacy-run").unwrap().unwrap();
        let error = resolve_run_scenario(&mut conn, tmp.path(), &run).unwrap_err();

        assert_eq!(error, "Scenario 'Legacy scenario' not found");
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
        assert!(candidate
            .description
            .contains("quarterly revenue forecasting"));
        assert_eq!(
            candidate.rationale.as_deref(),
            Some("Narrows the trigger to explicit revenue planning requests.")
        );
    }

    #[test]
    fn rejects_generated_scenarios_outside_expected_bounds() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "scenarios": [
                    sample_scenario_dto("Only one")
                ]
            }
        });

        let error = parse_generated_scenarios_response(&state).unwrap_err();

        assert_eq!(
            error,
            "Scenario generation must return between 3 and 5 scenarios"
        );
    }

    #[test]
    fn rejects_suggested_assertions_outside_expected_bounds() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "structured_output": {
                "assertions": []
            }
        });

        let error = parse_suggested_assertions_response(&state).unwrap_err();

        assert_eq!(
            error,
            "Assertion suggestion must return between 1 and 3 assertions"
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
        let prompt_set_a =
            save_eval_prompt_set(&mut conn, valid_prompt_set(EvalWorkbenchMode::Trigger)).unwrap();
        let mut prompt_set_b_input = valid_prompt_set(EvalWorkbenchMode::Trigger);
        prompt_set_b_input.name = "Other".to_string();
        let prompt_set_b = save_eval_prompt_set(&mut conn, prompt_set_b_input).unwrap();

        let run = record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run-a".to_string()),
                prompt_set_id: Some(prompt_set_a.id.clone()),
                plugin_slug: prompt_set_a.plugin_slug.clone(),
                skill_name: prompt_set_a.skill_name.clone(),
                scenario_name: prompt_set_a.name.clone(),
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
            Some(&prompt_set_b.name),
            Some(prompt_set_b.mode),
        )
        .unwrap_err();

        assert!(error.contains("selected scenario"));
    }

    #[test]
    fn allows_description_candidate_for_matching_prompt_set() {
        let mut conn = create_test_db_for_tests();
        let prompt_set =
            save_eval_prompt_set(&mut conn, valid_prompt_set(EvalWorkbenchMode::Trigger)).unwrap();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run".to_string()),
                prompt_set_id: Some(prompt_set.id.clone()),
                plugin_slug: prompt_set.plugin_slug.clone(),
                skill_name: prompt_set.skill_name.clone(),
                scenario_name: prompt_set.name.clone(),
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
            Some(&prompt_set.name),
            Some(prompt_set.mode),
        )
        .unwrap();

        assert_eq!(candidate.id, "candidate-a");
    }

    #[test]
    fn allows_description_candidate_for_matching_scenario_identity_without_prompt_set_id() {
        let mut conn = create_test_db_for_tests();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run".to_string()),
                prompt_set_id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Routing checks".to_string(),
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
            "skills",
            "forecast",
            Some("Routing checks"),
            Some(EvalWorkbenchMode::Trigger),
        )
        .unwrap();

        assert_eq!(candidate.id, "candidate-a");
        assert_eq!(candidate.run_id, "draft-run");
    }

    #[tokio::test]
    async fn completed_run_read_prefers_promptfoo_history_and_keeps_db_candidates() {
        let mut conn = create_test_db_for_tests();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("run-1".to_string()),
                prompt_set_id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "DB scenario".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "completed".to_string(),
                summary: serde_json::json!({ "passed": 0, "failed": 1, "total": 1 }),
                completed_at: Some("2026-05-04T00:00:00Z".to_string()),
                results: vec![NewEvalRunResult {
                    id: Some("db-result".to_string()),
                    case_id: "case-1".to_string(),
                    candidate_id: "candidate-a".to_string(),
                    passed: false,
                    score: 0.0,
                    output: serde_json::json!({ "invokedTargetSkill": false }),
                    reason: Some("stale db result".to_string()),
                }],
                description_candidates: vec![NewDescriptionCandidate {
                    id: Some("candidate-a".to_string()),
                    label: "Candidate A".to_string(),
                    description: "Route revenue forecasting prompts".to_string(),
                    rationale: Some("Used for refine".to_string()),
                    rank: Some(1),
                }],
            },
        )
        .unwrap();

        let run = read_eval_run_with_deps(&conn, "/tmp/promptfoo", "run-1", |_request| async {
            Ok(Some(sample_persisted_run("run-1")))
        })
        .await
        .unwrap()
        .unwrap();

        assert_eq!(run.scenario_name, "Promptfoo scenario");
        assert_eq!(run.summary["passed"], 1);
        assert_eq!(
            run.summary["scenarioSnapshot"]["scenarioName"],
            serde_json::json!("Promptfoo scenario")
        );
        assert_eq!(run.results.len(), 1);
        assert_eq!(run.results[0].passed, true);
        assert_eq!(run.description_candidates.len(), 1);
        assert_eq!(run.description_candidates[0].id, "candidate-a");
    }

    #[tokio::test]
    async fn completed_run_list_uses_promptfoo_history_instead_of_db_rows() {
        let mut conn = create_test_db_for_tests();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("db-only".to_string()),
                prompt_set_id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "DB only".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "completed".to_string(),
                summary: serde_json::json!({ "passed": 0, "failed": 1, "total": 1 }),
                completed_at: Some("2026-05-04T00:00:00Z".to_string()),
                results: vec![],
                description_candidates: vec![],
            },
        )
        .unwrap();

        let runs = list_eval_runs_with_deps(
            &conn,
            "/tmp/promptfoo",
            "skills",
            "forecast",
            EvalWorkbenchMode::Trigger,
            20,
            |_request| async { Ok(vec![sample_persisted_run("run-1")]) },
        )
        .await
        .unwrap();

        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].id, "run-1");
        assert_eq!(runs[0].scenario_name, "Promptfoo scenario");
    }

    #[tokio::test]
    async fn completed_run_read_does_not_fall_back_to_db_when_promptfoo_history_is_missing() {
        let mut conn = create_test_db_for_tests();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("completed-run".to_string()),
                prompt_set_id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Completed scenario".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "completed".to_string(),
                summary: serde_json::json!({ "passed": 0, "failed": 1, "total": 1 }),
                completed_at: Some("2026-05-04T00:00:00Z".to_string()),
                results: vec![NewEvalRunResult {
                    id: Some("db-result".to_string()),
                    case_id: "case-1".to_string(),
                    candidate_id: "candidate-a".to_string(),
                    passed: false,
                    score: 0.0,
                    output: serde_json::json!({ "invokedTargetSkill": false }),
                    reason: Some("stale db result".to_string()),
                }],
                description_candidates: vec![],
            },
        )
        .unwrap();

        let run = read_eval_run_with_deps(&conn, "/tmp/promptfoo", "completed-run", |_request| async {
            Ok(None)
        })
        .await
        .unwrap();

        assert!(run.is_none());
    }

    #[tokio::test]
    async fn draft_run_read_falls_back_to_db_when_promptfoo_history_is_missing() {
        let mut conn = create_test_db_for_tests();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("draft-run".to_string()),
                prompt_set_id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Draft scenario".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "draft".to_string(),
                summary: serde_json::json!({}),
                completed_at: None,
                results: vec![],
                description_candidates: vec![NewDescriptionCandidate {
                    id: Some("candidate-a".to_string()),
                    label: "Candidate A".to_string(),
                    description: "Route revenue forecasting prompts".to_string(),
                    rationale: Some("Used for refine".to_string()),
                    rank: Some(1),
                }],
            },
        )
        .unwrap();

        let run =
            read_eval_run_with_deps(&conn, "/tmp/promptfoo", "draft-run", |_request| async {
                Ok(None)
            })
            .await
            .unwrap()
            .unwrap();

        assert_eq!(run.id, "draft-run");
        assert_eq!(run.status, "draft");
        assert_eq!(run.scenario_name, "Draft scenario");
        assert_eq!(run.description_candidates.len(), 1);
    }

    #[test]
    fn load_refine_context_accepts_promptfoo_backed_run_without_db_run_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let scenario_path = eval_dir.join("promptfoo-scenario.yaml");
        write_scenario_file(
            &scenario_path,
            &scenario_from_dto(sample_trigger_scenario_dto("Promptfoo scenario")).unwrap(),
        )
        .unwrap();
        std::fs::remove_file(&scenario_path).unwrap();

        let mut conn = create_test_db_for_tests();
        let (run, prompt_set, skill_files) = load_refine_context(
            &mut conn,
            tmp.path(),
            "run-1",
            Some(sample_persisted_run("run-1")),
        )
        .unwrap();

        assert_eq!(run.id, "run-1");
        assert_eq!(run.scenario_name, "Promptfoo scenario");
        assert_eq!(prompt_set.name, "Promptfoo scenario");
        assert!(skill_files.is_empty());
    }

    #[test]
    fn list_scenarios_command_returns_summaries_only() {
        let tmp = tempfile::tempdir().unwrap();
        let dto = sample_scenario_dto("Regression");
        let scenario = scenario_from_dto(dto.clone()).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        scenarios::write_scenario_file(&path, &scenario).unwrap();

        let db = create_scenario_db(tmp.path());
        let response = list_scenarios("skills".into(), "forecast".into(), db_state(&db)).unwrap();

        assert_eq!(response.len(), 1);
        assert_eq!(response[0].name, "Regression");
        assert_eq!(response[0].tags, vec!["performance".to_string()]);
    }

    #[test]
    fn load_scenario_command_returns_full_scenario_detail() {
        let tmp = tempfile::tempdir().unwrap();
        let dto = sample_scenario_dto("Regression");
        let scenario = scenario_from_dto(dto.clone()).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        scenarios::write_scenario_file(&path, &scenario).unwrap();

        let db = create_scenario_db(tmp.path());
        let response = load_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap()
        .unwrap();

        assert_eq!(response.name, dto.name);
        assert_eq!(response.tags, dto.tags);
        assert_eq!(response.cases.len(), 1);
        assert_eq!(response.cases[0].id, "case-1");
        assert_eq!(response.cases[0].prompt, "Forecast next quarter revenue");
        assert_eq!(
            response.cases[0].expected_outcome.as_deref(),
            Some("Includes assumptions")
        );
        assert_eq!(response.cases[0].should_trigger, None);
        assert_eq!(response.cases[0].assertions.len(), 1);
        assert_eq!(response.cases[0].assertions[0].assertion_type, "contains");
        assert_eq!(response.cases[0].assertions[0].value, "assumptions");
    }

    #[test]
    fn load_scenario_command_returns_none_for_missing_scenario() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let response = load_scenario(
            "skills".into(),
            "forecast".into(),
            "Missing".into(),
            db_state(&db),
        )
        .unwrap();

        assert!(response.is_none());
    }

    #[test]
    fn save_scenario_command_persists_file_and_returns_detail() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");

        let response = save_scenario(
            "skills".into(),
            "forecast".into(),
            dto.clone(),
            None,
            db_state(&db),
        )
        .unwrap();

        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        assert!(path.exists());
        assert_eq!(response.name, dto.name);
        assert_eq!(response.tags, dto.tags);
        assert_eq!(response.cases.len(), 1);
        assert_eq!(response.cases[0].prompt, "Forecast next quarter revenue");
        let conn = db.0.lock().unwrap();
        assert_eq!(
            mirrored_scenario_prompt_set_count(
                &conn,
                "skills",
                "forecast",
                EvalWorkbenchMode::Performance,
            ),
            0
        );
        assert_eq!(
            mirrored_scenario_prompt_set_count(
                &conn,
                "skills",
                "forecast",
                EvalWorkbenchMode::Trigger,
            ),
            0
        );
    }

    #[test]
    fn delete_scenario_command_removes_saved_file_without_deleting_prompt_set_rows() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        let scenario = scenario_from_dto(dto.clone()).unwrap();
        scenarios::write_scenario_file(&path, &scenario).unwrap();
        {
            let mut conn = db.0.lock().unwrap();
            db_save_prompt_set(
                &mut conn,
                SaveEvalPromptSet {
                    id: Some(scenario_runtime_id(
                        "skills",
                        "forecast",
                        "Regression",
                        EvalWorkbenchMode::Performance,
                    )),
                    plugin_slug: "skills".to_string(),
                    skill_name: "forecast".to_string(),
                    mode: EvalWorkbenchMode::Performance,
                    name: "Regression".to_string(),
                    cases: vec![crate::db::SaveEvalPromptCase {
                        id: Some("case-1".to_string()),
                        prompt: "Forecast next quarter revenue".to_string(),
                        expected: Some("Includes assumptions".to_string()),
                        should_trigger: None,
                        assertions: serde_json::json!([]),
                        sort_order: Some(0),
                    }],
                },
            )
            .unwrap();
        }

        delete_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap();

        assert!(!path.exists());
        let conn = db.0.lock().unwrap();
        assert_eq!(
            mirrored_scenario_prompt_set_count(
                &conn,
                "skills",
                "forecast",
                EvalWorkbenchMode::Performance,
            ),
            1
        );
        drop(conn);
        let loaded = load_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn read_scenario_supports_yml_extension_for_run_path() {
        let tmp = tempfile::tempdir().unwrap();
        let dto = sample_scenario_dto("Regression");
        let scenario = scenario_from_dto(dto).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let path = eval_dir.join("regression.yml");
        scenarios::write_scenario_file(&path, &scenario).unwrap();

        let loaded = read_scenario(tmp.path(), "skills", "forecast", "Regression").unwrap();

        assert_eq!(loaded.name, "Regression");
        assert_eq!(loaded.cases.len(), 1);
        assert_eq!(loaded.cases[0].prompt, "Forecast next quarter revenue");
    }

    #[test]
    fn load_scenario_command_is_registered_in_tauri_builder_source() {
        let lib_rs = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/src/lib.rs"));

        assert!(lib_rs.contains("commands::eval_workbench::load_scenario,"));
    }

    #[test]
    fn load_scenario_runtime_allows_file_only_run_preparation() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let scenario = scenario_from_dto(dto).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &scenario.name);
        scenarios::write_scenario_file(&path, &scenario).unwrap();
        let mut conn = db.0.lock().unwrap();

        let prompt_set = load_scenario_runtime(
            &mut conn,
            tmp.path(),
            "skills",
            "forecast",
            "Regression",
            EvalWorkbenchMode::Performance,
        )
        .unwrap();

        assert_eq!(prompt_set.name, "Regression");
        assert_eq!(prompt_set.mode, EvalWorkbenchMode::Performance);
        assert_eq!(prompt_set.cases.len(), 1);
        assert_eq!(
            prompt_set.cases[0].expected.as_deref(),
            Some("Includes assumptions")
        );
        assert!(
            db_read_eval_prompt_set(
                &conn,
                &scenario_runtime_id(
                    "skills",
                    "forecast",
                    "Regression",
                    EvalWorkbenchMode::Performance,
                ),
            )
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn load_scenario_runtime_refreshes_stale_mirror_from_disk() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let original = sample_scenario_dto("Regression");
        let mut updated = sample_scenario_dto("Regression");
        updated.cases[0].prompt = "Forecast updated revenue".to_string();
        updated.cases[0].expected_outcome = Some("Uses latest assumptions".to_string());
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &original.name);
        scenarios::write_scenario_file(&path, &scenario_from_dto(original).unwrap()).unwrap();

        {
            let mut conn = db.0.lock().unwrap();
            let prompt_set = load_scenario_runtime(
                &mut conn,
                tmp.path(),
                "skills",
                "forecast",
                "Regression",
                EvalWorkbenchMode::Performance,
            )
            .unwrap();
            assert_eq!(prompt_set.cases[0].prompt, "Forecast next quarter revenue");
        }

        scenarios::write_scenario_file(&path, &scenario_from_dto(updated).unwrap()).unwrap();

        let mut conn = db.0.lock().unwrap();
        let prompt_set = load_scenario_runtime(
            &mut conn,
            tmp.path(),
            "skills",
            "forecast",
            "Regression",
            EvalWorkbenchMode::Performance,
        )
        .unwrap();

        assert_eq!(prompt_set.cases[0].prompt, "Forecast updated revenue");
        assert_eq!(
            prompt_set.cases[0].expected.as_deref(),
            Some("Uses latest assumptions")
        );
        assert!(
            db_read_eval_prompt_set(
                &conn,
                &scenario_runtime_id(
                    "skills",
                    "forecast",
                    "Regression",
                    EvalWorkbenchMode::Performance,
                ),
            )
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn load_scenario_runtime_allows_file_only_trigger_candidate_generation() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_trigger_scenario_dto("Routing checks");
        let scenario = scenario_from_dto(dto).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        let path = scenarios::scenario_file_path(&eval_dir, &scenario.name);
        scenarios::write_scenario_file(&path, &scenario).unwrap();
        let mut conn = db.0.lock().unwrap();

        let prompt_set = load_scenario_runtime(
            &mut conn,
            tmp.path(),
            "skills",
            "forecast",
            "Routing checks",
            EvalWorkbenchMode::Trigger,
        )
        .unwrap();

        assert_eq!(prompt_set.name, "Routing checks");
        assert_eq!(prompt_set.mode, EvalWorkbenchMode::Trigger);
        assert_eq!(prompt_set.cases.len(), 1);
        assert_eq!(prompt_set.cases[0].should_trigger, Some(true));
        assert!(
            db_read_eval_prompt_set(
                &conn,
                &scenario_runtime_id(
                    "skills",
                    "forecast",
                    "Routing checks",
                    EvalWorkbenchMode::Trigger,
                ),
            )
            .unwrap()
            .is_none()
        );
    }

    #[test]
    fn save_scenario_command_replaces_existing_yml_without_duplicate_entries() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let scenario = scenario_from_dto(dto.clone()).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let yml_path = eval_dir.join("regression.yml");
        scenarios::write_scenario_file(&yml_path, &scenario).unwrap();

        save_scenario(
            "skills".into(),
            "forecast".into(),
            dto.clone(),
            Some("Regression".into()),
            db_state(&db),
        )
        .unwrap();

        let yaml_path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        let visible = list_scenarios("skills".into(), "forecast".into(), db_state(&db)).unwrap();

        assert!(yaml_path.exists());
        assert!(!yml_path.exists());
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "Regression");
    }

    #[test]
    fn save_scenario_command_renames_without_leaving_duplicate_files() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());

        save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Regression"),
            None,
            db_state(&db),
        )
        .unwrap();

        let renamed = save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Renamed regression"),
            Some("Regression".into()),
            db_state(&db),
        )
        .unwrap();

        let visible = list_scenarios("skills".into(), "forecast".into(), db_state(&db)).unwrap();
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");

        assert_eq!(renamed.name, "Renamed regression");
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "Renamed regression");
        let filenames = std::fs::read_dir(&eval_dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .collect::<Vec<_>>();
        assert_eq!(filenames, vec!["renamed-regression.yaml"]);
    }

    #[test]
    fn save_scenario_command_rejects_duplicate_name_on_create_or_rename() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());

        save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Regression"),
            None,
            db_state(&db),
        )
        .unwrap();

        let create_err = save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Regression"),
            None,
            db_state(&db),
        )
        .unwrap_err();

        save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Fresh draft"),
            None,
            db_state(&db),
        )
        .unwrap();

        let rename_err = save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Regression"),
            Some("Fresh draft".into()),
            db_state(&db),
        )
        .unwrap_err();

        assert_eq!(create_err, "Scenario 'Regression' already exists");
        assert_eq!(rename_err, "Scenario 'Regression' already exists");
    }

    #[test]
    fn save_scenario_command_rejects_slug_collisions() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());

        save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("Happy Path"),
            None,
            db_state(&db),
        )
        .unwrap();

        let create_err = save_scenario(
            "skills".into(),
            "forecast".into(),
            sample_scenario_dto("happy-path"),
            None,
            db_state(&db),
        )
        .unwrap_err();

        assert_eq!(
            create_err,
            "Scenario 'happy-path' conflicts with existing slug 'happy-path'"
        );
    }

    #[test]
    fn load_scenario_command_loads_visible_scenario_even_when_filename_slug_mismatches() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let path = eval_dir.join("mismatched-file-name.yaml");
        scenarios::write_scenario_file(&path, &scenario_from_dto(dto.clone()).unwrap()).unwrap();

        let visible = list_scenarios("skills".into(), "forecast".into(), db_state(&db)).unwrap();
        let loaded = load_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap()
        .unwrap();

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "Regression");
        assert_eq!(loaded.name, "Regression");
        assert_eq!(loaded.cases[0].prompt, "Forecast next quarter revenue");
    }

    #[test]
    fn read_scenario_loads_visible_scenario_even_when_filename_slug_mismatches() {
        let tmp = tempfile::tempdir().unwrap();
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let path = eval_dir.join("manually-renamed.yaml");
        scenarios::write_scenario_file(&path, &scenario_from_dto(dto).unwrap()).unwrap();

        let loaded = read_scenario(tmp.path(), "skills", "forecast", "Regression").unwrap();

        assert_eq!(loaded.name, "Regression");
        assert_eq!(loaded.cases[0].prompt, "Forecast next quarter revenue");
    }

    #[test]
    fn load_scenario_command_ignores_broken_sibling_yaml_for_valid_target() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        scenarios::write_scenario_file(
            &eval_dir.join("valid-target.yaml"),
            &scenario_from_dto(dto.clone()).unwrap(),
        )
        .unwrap();
        std::fs::write(eval_dir.join("broken-sibling.yaml"), "name: [").unwrap();

        let loaded = load_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap()
        .unwrap();

        assert_eq!(loaded.name, "Regression");
        assert_eq!(loaded.cases[0].prompt, "Forecast next quarter revenue");
    }

    #[test]
    fn list_scenarios_command_ignores_broken_sibling_yaml_for_valid_target() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        scenarios::write_scenario_file(
            &eval_dir.join("valid-target.yaml"),
            &scenario_from_dto(dto).unwrap(),
        )
        .unwrap();
        std::fs::write(eval_dir.join("broken-sibling.yaml"), "name: [").unwrap();

        let visible = list_scenarios("skills".into(), "forecast".into(), db_state(&db)).unwrap();

        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "Regression");
        assert_eq!(visible[0].tags, vec!["performance".to_string()]);
    }

    #[test]
    fn save_scenario_command_succeeds_with_broken_sibling_yaml_present() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        std::fs::write(eval_dir.join("broken-sibling.yaml"), "name: [").unwrap();

        let saved = save_scenario(
            "skills".into(),
            "forecast".into(),
            dto.clone(),
            None,
            db_state(&db),
        )
        .unwrap();

        assert_eq!(saved.name, "Regression");
        assert!(scenarios::scenario_file_path(&eval_dir, &dto.name).exists());
    }

    #[test]
    fn delete_scenario_command_succeeds_with_broken_sibling_yaml_present() {
        let tmp = tempfile::tempdir().unwrap();
        let db = create_scenario_db(tmp.path());
        let dto = sample_scenario_dto("Regression");
        let eval_dir = resolve_eval_dir(tmp.path(), "skills", "forecast");
        std::fs::create_dir_all(&eval_dir).unwrap();
        let target_path = scenarios::scenario_file_path(&eval_dir, &dto.name);
        scenarios::write_scenario_file(&target_path, &scenario_from_dto(dto).unwrap()).unwrap();
        std::fs::write(eval_dir.join("broken-sibling.yaml"), "name: [").unwrap();

        delete_scenario(
            "skills".into(),
            "forecast".into(),
            "Regression".into(),
            db_state(&db),
        )
        .unwrap();

        assert!(!target_path.exists());
    }
}
