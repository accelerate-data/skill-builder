pub mod scenarios;
pub mod types;

use crate::agents::openhands_server::{
    run_openhands_one_shot, OpenHandsOneShotRunParams,
};
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::refine::{content::get_skill_content_inner_for_plugin, resolve_skills_path};
use crate::commands::workflow::{ensure_workspace_prompts, read_initialized_runtime_context};
use crate::db::{Db, EvalWorkbenchMode};
use serde_json::Value;
use std::path::Path;
pub use types::{ScenarioDto, ScenarioSummaryDto};

const SUGGEST_SCENARIO_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/eval-workbench-suggest-scenario.txt"
));

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

fn parse_scenario_tags(tags: &[String]) -> Result<Vec<scenarios::ScenarioTag>, String> {
    if tags.is_empty() {
        return Err("Scenario tags must include at least one mode".to_string());
    }

    let mut parsed = Vec::new();
    for tag in tags {
        let next = match tag.trim() {
            "performance" => scenarios::ScenarioTag::Performance,
            other => return Err(format!("Unsupported performance scenario tag: {other}")),
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
        })
        .map(str::to_string)
        .collect()
}

fn scenario_from_dto(dto: ScenarioDto) -> Result<scenarios::Scenario, String> {
    let tags = if dto.tags.is_empty() {
        vec![scenarios::ScenarioTag::Performance]
    } else {
        parse_scenario_tags(&dto.tags)?
    };
    let scenario = scenarios::Scenario {
        id: dto.id,
        name: dto.name,
        tags,
        prompt: dto.prompt,
        expectations: dto.expectations,
    };
    scenarios::validate_scenario(&scenario)?;
    Ok(scenario)
}

fn scenario_to_dto(scenario: scenarios::Scenario) -> ScenarioDto {
    ScenarioDto {
        id: scenario.id,
        name: scenario.name,
        tags: scenario_tag_strings(&scenario.tags),
        prompt: scenario.prompt,
        expectations: scenario.expectations,
    }
}

fn scenario_summary_to_dto(summary: scenarios::ScenarioSummary) -> ScenarioSummaryDto {
    ScenarioSummaryDto {
        name: summary.name,
        tags: scenario_tag_strings(&summary.tags),
    }
}

fn scenario_expectations_json(scenario: &scenarios::Scenario) -> Value {
    Value::Array(
        scenario
            .expectations
            .iter()
            .map(|expectation| Value::String(expectation.clone()))
            .collect(),
    )
}

fn persist_scenario_file(
    eval_dir: &std::path::Path,
    scenario: &scenarios::Scenario,
    previous_scenario_name: Option<&str>,
) -> Result<(), String> {
    if let Some(previous_scenario_name) = previous_scenario_name {
        scenarios::validate_scenario_name(previous_scenario_name)?;
    }
    let path = scenarios::scenario_file_path(eval_dir, &scenario.name);
    let existing_scenario = scenarios::load_scenario(eval_dir, &scenario.name)?;
    let existing_target_scenario = if path.exists() {
        scenarios::read_scenario_file(&path).ok()
    } else {
        None
    };
    let is_rename = previous_scenario_name.is_some_and(|previous| previous != scenario.name);
    let is_create = previous_scenario_name.is_none();
    if existing_scenario.is_some() && (is_create || is_rename) {
        return Err(format!("Scenario '{}' already exists", scenario.name));
    }
    let target_path_matches_existing = existing_target_scenario.as_ref().is_some_and(|existing| {
        existing.name == scenario.name || previous_scenario_name == Some(existing.name.as_str())
    });
    if existing_target_scenario.is_some() && !target_path_matches_existing {
        return Err(format!(
            "Scenario '{}' conflicts with existing slug '{}'",
            scenario.name,
            scenarios::slugify_scenario_name(&scenario.name)
        ));
    }
    scenarios::write_scenario_file(&path, scenario)?;
    scenarios::delete_other_scenario_files(eval_dir, &scenario.name, &path)?;
    if let Some(previous_scenario_name) = previous_scenario_name {
        if previous_scenario_name != scenario.name {
            scenarios::delete_scenario_file(eval_dir, previous_scenario_name)?;
        }
    }

    Ok(())
}

fn next_default_scenario_name(
    eval_dir: &std::path::Path,
    mode: EvalWorkbenchMode,
) -> Result<String, String> {
    let prefix = match mode {
        EvalWorkbenchMode::Performance => "Performance",
        EvalWorkbenchMode::Trigger => "Trigger",
    };
    let existing = scenarios::list_scenarios(eval_dir)?;
    let mut index = 1;
    loop {
        let candidate = format!("{prefix} {index}");
        if !existing.iter().any(|s| s.name == candidate) {
            return Ok(candidate);
        }
        index += 1;
        if index > 1000 {
            return Err("Could not find an unused default scenario name".to_string());
        }
    }
}

fn load_scenarios_for_mode(
    eval_dir: &std::path::Path,
    mode: EvalWorkbenchMode,
) -> Result<Vec<scenarios::Scenario>, String> {
    scenarios::list_scenarios(eval_dir).map(|summaries| {
        summaries
            .into_iter()
            .filter_map(|summary| scenarios::load_scenario(eval_dir, &summary.name).ok().flatten())
            .filter(|scenario| {
                scenario.tags.iter().any(|tag| tag.matches_mode(mode))
            })
            .collect()
    })
}

fn load_package_runtime(
    eval_dir: &std::path::Path,
    mode: EvalWorkbenchMode,
) -> Result<scenarios::Scenario, String> {
    let scenarios = load_scenarios_for_mode(eval_dir, mode)?;
    if scenarios.is_empty() {
        return Err(format!(
            "No {mode} scenarios found. Create at least one scenario before running evaluation.",
            mode = mode.as_str()
        ));
    }
    Ok(scenarios.into_iter().next().unwrap())
}

fn suggested_scenario_output_format() -> Value {
    serde_json::json!({
        "type": "object",
        "properties": {
            "name": { "type": "string" },
            "prompt": { "type": "string" },
            "expectations": {
                "type": "array",
                "items": { "type": "string" }
            }
        },
        "required": ["name", "prompt", "expectations"]
    })
}

fn build_suggest_scenario_prompt(
    skill_name: &str,
    existing_scenario: &scenarios::Scenario,
    skill_files: &[crate::types::SkillFileContent],
    clarifications_json: &str,
    decisions_json: &str,
) -> String {
    let skill_context = skill_files
        .iter()
        .map(|file| format!("{}:\n{}", file.path, file.content))
        .collect::<Vec<_>>()
        .join("\n\n");
    format!(
        "{template}\n\nSkill: {skill_name}\n\nSkill files:\n{skill_context}\n\nExisting scenario:\nname: {name}\nprompt: {prompt}\nexpectations: {expectations}\n\nClarifications:\n{clarifications}\n\nDecisions:\n{decisions}",
        template = SUGGEST_SCENARIO_PROMPT_TEMPLATE,
        skill_name = skill_name,
        skill_context = skill_context,
        name = existing_scenario.name,
        prompt = existing_scenario.prompt,
        expectations = serde_json::to_string(&existing_scenario.expectations).unwrap_or_default(),
        clarifications = clarifications_json,
        decisions = decisions_json,
    )
}

fn load_define_eval_scenario_context(
    conn: &rusqlite::Connection,
    skill_name: &str,
) -> (String, String) {
    let clarifications = crate::db::workflow_artifacts::read_clarifications(conn, skill_name)
        .ok()
        .flatten()
        .map(|r| serde_json::to_string(&r).unwrap_or_default())
        .unwrap_or_default();
    let decisions = crate::db::workflow_artifacts::read_decisions(conn, skill_name)
        .ok()
        .flatten()
        .map(|r| serde_json::to_string(&r).unwrap_or_default())
        .unwrap_or_default();
    (clarifications, decisions)
}

fn parse_openhands_response_text(state: &serde_json::Value) -> Result<String, String> {
    state
        .get("response_text")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Missing response_text in OpenHands state".to_string())
}

fn parse_openhands_structured_output(state: &serde_json::Value) -> Result<Value, String> {
    state
        .get("structured_output")
        .cloned()
        .ok_or_else(|| "Missing structured_output in OpenHands state".to_string())
}

fn clean_openhands_structured_result_text(text: &str) -> &str {
    text.trim_start_matches("```json")
        .trim_start_matches("```")
        .trim_end_matches("```")
        .trim()
}

fn parse_suggested_scenario_response(
    state: &serde_json::Value,
    existing_scenario: &scenarios::Scenario,
) -> Result<scenarios::Scenario, String> {
    let output = parse_openhands_structured_output(state)?;
    let text = output
        .get("result")
        .and_then(|v| v.as_str())
        .map(clean_openhands_structured_result_text)
        .or_else(|| output.as_str())
        .ok_or_else(|| "Missing result text in scenario suggestion response".to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("Failed to parse suggested scenario JSON: {}", e))?;
    let name = parsed
        .get("name")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| existing_scenario.name.clone());
    let prompt = parsed
        .get("prompt")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| existing_scenario.prompt.clone());
    let expectations = parsed
        .get("expectations")
        .and_then(|v| v.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|v| v.as_str().map(|s| s.to_string()))
                .collect()
        })
        .unwrap_or_else(|| existing_scenario.expectations.clone());
    Ok(scenarios::Scenario {
        id: existing_scenario.id.clone(),
        name,
        tags: existing_scenario.tags.clone(),
        prompt,
        should_trigger: existing_scenario.should_trigger,
        expectations,
    })
}

fn build_generation_sidecar_config(
    plugin_slug: &str,
    skill_name: &str,
    prompt: &str,
    output_format: Value,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::sidecar::SidecarConfig {
    let workspace_skill_dir = crate::skill_paths::workspace_skill_dir(
        std::path::Path::new(&runtime_ctx.workspace_path),
        plugin_slug,
        skill_name,
    )
    .to_string_lossy()
    .replace('\\', "/");
    crate::agents::sidecar::build_openhands_one_shot_config(
        crate::agents::sidecar::OpenHandsOneShotConfigParams {
            prompt: prompt.to_string(),
            llm: runtime_ctx.llm.clone(),
            workspace_root_dir: runtime_ctx.workspace_path.replace('\\', "/"),
            workspace_run_dir: workspace_skill_dir,
            agent_name: "skill-creator".to_string(),
            task_kind: Some("scenario-suggest".to_string()),
            user_message_suffix: None,
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 10,
            output_format: Some(output_format),
            skill_name: Some(skill_name.to_string()),
            step_id: Some(-11),
            run_source: Some("scenario-suggest".to_string()),
            plugin_slug: plugin_slug.to_string(),
        }
    )
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
pub fn create_scenario(
    plugin_slug: String,
    skill_name: String,
    mode: EvalWorkbenchMode,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    if mode != EvalWorkbenchMode::Performance {
        return Err("Eval Workbench only supports performance mode".to_string());
    }
    let name = next_default_scenario_name(&eval_dir)?;
    let scenario = scenarios::Scenario {
        id: format!("case-{}", uuid::Uuid::new_v4().simple()),
        name,
        tags: vec![scenarios::ScenarioTag::Performance],
        prompt: String::new(),
        expectations: vec![],
    };
    let path = scenarios::scenario_file_path(&eval_dir, &scenario.name);
    scenarios::write_scenario_file(&path, &scenario)?;
    Ok(scenario_to_dto(scenario))
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
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    persist_scenario_file(&eval_dir, &scenario, previous_scenario_name.as_deref())?;

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
pub async fn define_eval_scenario(
    app: tauri::AppHandle,
    plugin_slug: String,
    skill_name: String,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    scenarios::validate_scenario_name(&scenario_name)?;

    let skills_path = resolve_skills_path(&db)?;
    let skill_files = get_skill_content_inner_for_plugin(&skill_name, &skills_path, &plugin_slug)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    let existing_scenario = scenarios::load_scenario(&eval_dir, &scenario_name)?
        .ok_or_else(|| format!("Scenario '{}' not found", scenario_name))?;
    let (clarifications_json, decisions_json) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        load_define_eval_scenario_context(&conn, &skill_name)
    };
    let runtime_ctx = read_initialized_runtime_context(&db)?;
    ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    let prompt = build_define_eval_scenario_prompt(
        &skill_name,
        &existing_scenario,
        &skill_files,
        &clarifications_json,
        &decisions_json,
    );
    let config = build_generation_sidecar_config(
        &plugin_slug,
        &skill_name,
        &prompt,
        suggested_scenario_output_format(),
        &runtime_ctx,
    );
    let run = run_persistent_eval_turn(
        &app,
        &format!("{skill_name}-scenario-suggest"),
        config,
        std::time::Duration::from_secs(90),
    )
    .await?;

    let suggested_scenario = parse_suggested_scenario_response(&run, &existing_scenario)?;
    persist_scenario_file(&eval_dir, &suggested_scenario, Some(&scenario_name))?;
    Ok(scenario_to_dto(suggested_scenario))
}
