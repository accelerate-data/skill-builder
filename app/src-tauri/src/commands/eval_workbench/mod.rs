pub mod scenarios;
pub mod types;

use crate::agents::openhands_server;
use crate::agents::openhands_server::OpenHandsThrowawayRunParams;
use crate::agents::runtime_config::{
    build_openhands_runtime_config, BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeMode,
};
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::refine::content::get_skill_content_inner_for_plugin;
use crate::commands::skill_session::resolve_skills_path;
use crate::commands::workflow::{ensure_workspace_prompts, read_initialized_runtime_context};
use crate::db::Db;
use serde_json::Value;
use std::path::Path;
use tauri::Manager;
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
        expectations: dto.assertions,
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
        assertions: scenario.expectations,
    }
}

fn scenario_summary_to_dto(summary: scenarios::ScenarioSummary) -> ScenarioSummaryDto {
    ScenarioSummaryDto {
        name: summary.name,
        tags: scenario_tag_strings(&summary.tags),
    }
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

fn next_default_scenario_name(eval_dir: &std::path::Path) -> Result<String, String> {
    let prefix = "Performance";
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
    let text = state
        .get("result_text")
        .and_then(|v| v.as_str())
        .map(clean_openhands_structured_result_text)
        .ok_or_else(|| "Missing result_text in OpenHands state".to_string())?;
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
        expectations,
    })
}

#[allow(clippy::too_many_arguments)]
fn build_generation_runtime_config(
    app_data_root: &str,
    plugin_slug: &str,
    skill_name: &str,
    prompt: &str,
    skills_root: &str,
    skill_dir: &str,
    output_format: Value,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
) -> crate::agents::runtime_config::OpenHandsRuntimeConfig {
    build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
        prompt: prompt.to_string(),
        llm: runtime_ctx.llm.clone(),
        app_data_root: app_data_root.to_string(),
        skills_root: skills_root.replace('\\', "/"),
        skill_dir: skill_dir.replace('\\', "/"),
        mode: Some(OpenHandsRuntimeMode::Throwaway),
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
    })
}

async fn run_define_eval_scenario_throwaway_turn<
    EnsureRuntimeDir,
    EnsureRuntimeDirFuture,
    RunTurn,
    RunTurnFuture,
>(
    app_data_root: &str,
    plugin_slug: &str,
    skill_name: &str,
    prompt: &str,
    runtime_ctx: &crate::commands::workflow::settings::InitializedRuntimeContext,
    ensure_runtime_dir: EnsureRuntimeDir,
    run_turn: RunTurn,
) -> Result<openhands_server::OpenHandsThrowawayRun, String>
where
    EnsureRuntimeDir: FnOnce(&std::path::Path) -> EnsureRuntimeDirFuture,
    EnsureRuntimeDirFuture: std::future::Future<Output = Result<(), String>>,
    RunTurn: FnOnce(OpenHandsThrowawayRunParams) -> RunTurnFuture,
    RunTurnFuture:
        std::future::Future<Output = Result<openhands_server::OpenHandsThrowawayRun, String>>,
{
    let run_id = uuid::Uuid::new_v4().to_string();
    let runtime_run_dir = crate::skill_paths::throwaway_runtime_dir(
        std::path::Path::new(&runtime_ctx.skills_root),
        "eval-workbench",
        &run_id,
    );
    std::fs::create_dir_all(crate::skill_paths::throwaway_conversations_dir(
        &runtime_run_dir,
    ))
    .map_err(|e| format!("Failed to create throwaway conversations dir: {e}"))?;
    std::fs::create_dir_all(crate::skill_paths::throwaway_logs_dir(&runtime_run_dir))
        .map_err(|e| format!("Failed to create throwaway logs dir: {e}"))?;
    ensure_runtime_dir(&runtime_run_dir).await?;
    let config = build_generation_runtime_config(
        app_data_root,
        plugin_slug,
        skill_name,
        prompt,
        &runtime_ctx.skills_root,
        &runtime_run_dir.to_string_lossy(),
        suggested_scenario_output_format(),
        runtime_ctx,
    );
    run_turn(OpenHandsThrowawayRunParams {
        agent_id: format!("{skill_name}-scenario-suggest-{}", uuid::Uuid::new_v4()),
        config,
        timeout: std::time::Duration::from_secs(90),
    })
    .await
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
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db)?;
    let eval_dir =
        crate::skill_paths::resolve_eval_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
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
    ensure_workspace_prompts(&app, &runtime_ctx.skills_root).await?;
    let prompt = build_suggest_scenario_prompt(
        &skill_name,
        &existing_scenario,
        &skill_files,
        &clarifications_json,
        &decisions_json,
    );
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");
    let run = run_define_eval_scenario_throwaway_turn(
        &app_data_root,
        &plugin_slug,
        &skill_name,
        &prompt,
        &runtime_ctx,
        |runtime_run_dir| {
            let runtime_run_dir = runtime_run_dir.to_path_buf();
            let app = app.clone();
            async move {
                crate::commands::workflow::deploy::ensure_openhands_runtime_dir(
                    &app,
                    &runtime_run_dir,
                )
                .await
            }
        },
        |params| {
            let app = app.clone();
            async move { openhands_server::run_throwaway_openhands_session(&app, params).await }
        },
    )
    .await?;

    let suggested_scenario =
        parse_suggested_scenario_response(&run.conversation_state, &existing_scenario)?;
    persist_scenario_file(&eval_dir, &suggested_scenario, Some(&scenario_name))?;
    Ok(scenario_to_dto(suggested_scenario))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::openhands_server::OpenHandsThrowawayRun;
    use crate::commands::workflow::settings::InitializedRuntimeContext;

    #[test]
    fn define_eval_scenario_uses_throwaway_runtime_path() {
        let workspace = tempfile::tempdir().unwrap();
        let runtime_ctx = InitializedRuntimeContext {
            skills_root: workspace.path().to_string_lossy().into_owned(),
            llm: crate::types::WorkflowLlmConfig {
                model: "gpt-4.1".to_string(),
                api_key: Some(crate::types::SecretString::new("test-key".to_string())),
                base_url: None,
                api_version: None,
                temperature: None,
                max_output_tokens: None,
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: None,
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: None,
            },
        };

        let result = tokio::runtime::Runtime::new().unwrap().block_on(
            run_define_eval_scenario_throwaway_turn(
                "/tmp/app-data",
                "default",
                "lead-conversion",
                "prompt",
                &runtime_ctx,
                |runtime_run_dir| {
                    let runtime_run_dir = runtime_run_dir.to_path_buf();
                    async move {
                        assert!(runtime_run_dir.exists());
                        assert!(crate::skill_paths::throwaway_conversations_dir(&runtime_run_dir).is_dir());
                        assert!(crate::skill_paths::throwaway_logs_dir(&runtime_run_dir).is_dir());
                        Ok(())
                    }
                },
                |params| async move {
                    assert!(params.agent_id.contains("lead-conversion-scenario-suggest-"));
                    assert_eq!(params.config.mode.as_deref(), Some("throwaway"));
                    assert_eq!(params.config.task_kind.as_deref(), Some("scenario-suggest"));
                    assert!(params
                        .config
                        .skill_dir
                        .contains("/.openhands/throwaway/eval-workbench/"));
                    Ok(OpenHandsThrowawayRun {
                        conversation_state: serde_json::json!({
                            "result_text": "{\"name\":\"Performance 1\",\"prompt\":\"Prompt\",\"expectations\":[\"assertion\"]}"
                        }),
                    })
                },
            ),
        );

        assert!(result.is_ok());
    }
}
