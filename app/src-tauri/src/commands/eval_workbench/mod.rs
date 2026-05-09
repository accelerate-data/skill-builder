pub mod types;

use crate::agents::openhands_server;
use crate::commands::imported_skills::validate_skill_name;
use crate::commands::refine::{content::get_skill_content_inner_for_plugin, resolve_skills_path};
use crate::commands::workflow::read_initialized_runtime_context;
use crate::db::eval_workbench::{self, EvalWorkbenchMode, SaveScenario};
use crate::db::skills::get_skill_conversation_id;
use crate::db::Db;
use serde_json::Value;
use tauri::Listener;
pub use types::{ScenarioDto, ScenarioSummaryDto};

const GENERATE_SCENARIO_PROMPT_TEMPLATE: &str = include_str!(concat!(
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

fn scenario_from_dto(dto: ScenarioDto) -> Result<SaveScenario, String> {
    let mode = EvalWorkbenchMode::parse(
        &dto.tags
            .first()
            .cloned()
            .unwrap_or_else(|| "performance".to_string()),
    )?;
    Ok(SaveScenario {
        id: Some(dto.id),
        plugin_slug: dto.plugin_slug,
        skill_name: dto.skill_name,
        name: dto.name,
        mode,
        prompt: dto.prompt,
        assertions: dto.assertions,
    })
}

fn scenario_to_dto(scenario: eval_workbench::Scenario) -> ScenarioDto {
    ScenarioDto {
        id: scenario.id,
        plugin_slug: scenario.plugin_slug,
        skill_name: scenario.skill_name,
        name: scenario.name,
        tags: vec![scenario.mode.as_str().to_string()],
        prompt: scenario.prompt,
        assertions: scenario.assertions,
    }
}

fn scenario_summary_to_dto(scenario: eval_workbench::Scenario) -> ScenarioSummaryDto {
    ScenarioSummaryDto {
        id: scenario.id,
        plugin_slug: scenario.plugin_slug,
        skill_name: scenario.skill_name,
        name: scenario.name,
        tags: vec![scenario.mode.as_str().to_string()],
    }
}

fn build_generate_scenario_prompt(
    skill_name: &str,
    scenario: &eval_workbench::Scenario,
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
        template = GENERATE_SCENARIO_PROMPT_TEMPLATE,
        skill_name = skill_name,
        skill_context = skill_context,
        name = scenario.name,
        prompt = scenario.prompt,
        expectations = serde_json::to_string(&scenario.assertions).unwrap_or_default(),
        clarifications = clarifications_json,
        decisions = decisions_json,
    )
}

fn load_generate_eval_scenario_context(
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

fn parse_generated_scenario_response(
    state: &serde_json::Value,
    existing_scenario: &eval_workbench::Scenario,
) -> Result<(String, Vec<String>), String> {
    let output = parse_openhands_structured_output(state)?;
    let text = output
        .get("result")
        .and_then(|v| v.as_str())
        .map(clean_openhands_structured_result_text)
        .or_else(|| output.as_str())
        .ok_or_else(|| "Missing result text in scenario generation response".to_string())?;
    let parsed: serde_json::Value = serde_json::from_str(text)
        .map_err(|e| format!("Failed to parse generated scenario JSON: {}", e))?;
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
        .unwrap_or_else(|| existing_scenario.assertions.clone());
    Ok((prompt, expectations))
}

async fn wait_for_openhands_turn_result(
    app: &tauri::AppHandle,
    agent_id: &str,
    timeout: std::time::Duration,
) -> Result<serde_json::Value, String> {
    use tokio::sync::mpsc;

    fn parse_terminal_state(
        payload: &str,
        target_agent_id: &str,
    ) -> Option<Result<serde_json::Value, String>> {
        let value = serde_json::from_str::<serde_json::Value>(payload).ok()?;
        if value.get("agent_id").and_then(|v| v.as_str()) != Some(target_agent_id) {
            return None;
        }
        let message = value.get("message")?;
        if message.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
            return None;
        }
        match message.get("status").and_then(|v| v.as_str())? {
            "completed" => Some(Ok(message.clone())),
            "error" => Some(Err("OpenHands run failed".to_string())),
            "cancelled" | "canceled" => Some(Err("OpenHands run cancelled".to_string())),
            _ => None,
        }
    }

    let (tx, mut rx) = mpsc::unbounded_channel::<Result<serde_json::Value, String>>();
    let target_agent_id = agent_id.to_string();
    let tx_message = tx.clone();
    let message_listener = app.listen("agent-message", move |event: tauri::Event| {
        if let Some(result) = parse_terminal_state(event.payload(), target_agent_id.as_str()) {
            let _ = tx_message.send(result);
        }
    });

    let target_agent_id = agent_id.to_string();
    let tx_exit = tx.clone();
    let exit_listener = app.listen("agent-exit", move |event: tauri::Event| {
        let payload: serde_json::Value =
            serde_json::from_str(event.payload()).unwrap_or_default();
        if payload.get("agent_id").and_then(|v| v.as_str()) == Some(&target_agent_id) {
            let success = payload
                .get("success")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            if !success {
                let detail = payload
                    .get("error_detail")
                    .and_then(|v| v.as_str())
                    .unwrap_or("OpenHands run failed")
                    .to_string();
                let _ = tx_exit.send(Err(detail));
            }
        }
    });

    let wait_result = tokio::time::timeout(timeout, async {
        while let Some(result) = rx.recv().await {
            if let Ok(state) = result {
                return Ok(state);
            }
            if let Err(e) = result {
                return Err(e);
            }
        }
        Err("OpenHands listener closed unexpectedly".to_string())
    })
    .await;

    app.unlisten(message_listener);
    app.unlisten(exit_listener);

    match wait_result {
        Ok(Ok(state)) => Ok(state),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = crate::agents::openhands_server::pause_openhands_session(agent_id);
            Err("OpenHands generation timed out".to_string())
        }
    }
}

#[tauri::command]
pub fn list_scenarios(
    plugin_slug: String,
    skill_name: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ScenarioSummaryDto>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    eval_workbench::list_scenarios(&conn, &plugin_slug, &skill_name)
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
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    eval_workbench::read_scenario(&conn, &plugin_slug, &skill_name, &scenario_name)
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
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;

    let existing = eval_workbench::list_scenarios(&conn, &plugin_slug, &skill_name)?;
    let mut index = 1i64;
    loop {
        let candidate = format!("Performance {index}");
        if !existing.iter().any(|s| s.name == candidate) {
            break;
        }
        index += 1;
        if index > 1000 {
            return Err("Could not find an unused default scenario name".to_string());
        }
    };
    let name = format!("Performance {index}");

    let input = SaveScenario {
        id: None,
        plugin_slug: plugin_slug.clone(),
        skill_name: skill_name.clone(),
        name,
        mode: EvalWorkbenchMode::Performance,
        prompt: String::new(),
        assertions: vec![],
    };
    let saved = eval_workbench::save_scenario(&mut conn, input)?;
    Ok(scenario_to_dto(saved))
}

#[tauri::command]
pub fn save_scenario(
    plugin_slug: String,
    skill_name: String,
    scenario: ScenarioDto,
    _previous_scenario_name: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let input = scenario_from_dto(scenario)?;
    let saved = eval_workbench::save_scenario(&mut conn, input)?;
    Ok(scenario_to_dto(saved))
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
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    eval_workbench::delete_scenario(&mut conn, &plugin_slug, &skill_name, &scenario_name)
}

#[tauri::command]
pub async fn generate_eval_scenario_assertions(
    app: tauri::AppHandle,
    plugin_slug: String,
    skill_name: String,
    scenario_name: String,
    db: tauri::State<'_, Db>,
) -> Result<ScenarioDto, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;

    let runtime_ctx = read_initialized_runtime_context(&db)?;

    let (existing_scenario, conversation_id, skill_files, clarifications_json, decisions_json) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let existing_scenario =
            eval_workbench::read_scenario(&conn, &plugin_slug, &skill_name, &scenario_name)?
                .ok_or_else(|| format!("Scenario '{}' not found", scenario_name))?;

        let conversation_id = get_skill_conversation_id(&conn, &plugin_slug, &skill_name)?
            .ok_or_else(|| {
                format!(
                    "No active OpenHands conversation for skill '{}' in plugin '{}'. Select a skill conversation in Refine first.",
                    skill_name, plugin_slug
                )
            })?;

        let skills_path = resolve_skills_path(&db)?;
        let skill_files =
            get_skill_content_inner_for_plugin(&skill_name, &skills_path, &plugin_slug)?;

        let (clarifications_json, decisions_json) =
            load_generate_eval_scenario_context(&conn, &skill_name);

        (
            existing_scenario,
            conversation_id,
            skill_files,
            clarifications_json,
            decisions_json,
        )
    };

    let prompt = build_generate_scenario_prompt(
        &skill_name,
        &existing_scenario,
        &skill_files,
        &clarifications_json,
        &decisions_json,
    );

    let agent_id = format!(
        "{}-eval-generate-{}",
        skill_name,
        uuid::Uuid::new_v4().simple()
    );

    let config = crate::agents::sidecar::build_openhands_runtime_config(
        crate::agents::sidecar::OpenHandsRuntimeConfigParams {
            prompt,
            llm: runtime_ctx.llm,
            workspace_root_dir: runtime_ctx.workspace_path.clone(),
            workspace_run_dir: runtime_ctx.workspace_path.clone(),
            mode: None,
            agent_name: "skill-creator".to_string(),
            task_kind: Some("eval-workbench-generate".to_string()),
            user_message_suffix: None,
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 10,
            output_format: Some(generated_scenario_output_format()),
            skill_name: Some(skill_name.clone()),
            step_id: Some(-11),
            run_source: Some("eval-workbench-generate".to_string()),
            plugin_slug: plugin_slug.clone(),
        },
    );

    openhands_server::send_openhands_message(&app, &agent_id, config, conversation_id).await?;

    let terminal_state =
        wait_for_openhands_turn_result(&app, &agent_id, std::time::Duration::from_secs(90)).await?;

    let (prompt, assertions) =
        parse_generated_scenario_response(&terminal_state, &existing_scenario)?;

    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    let saved = eval_workbench::save_scenario(
        &mut conn,
        SaveScenario {
            id: Some(existing_scenario.id.clone()),
            plugin_slug: plugin_slug.clone(),
            skill_name: skill_name.clone(),
            name: existing_scenario.name.clone(),
            mode: existing_scenario.mode,
            prompt,
            assertions,
        },
    )?;

    Ok(scenario_to_dto(saved))
}

fn generated_scenario_output_format() -> Value {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_plugin_slug_rejects_empty() {
        assert!(validate_plugin_slug("").is_err());
    }

    #[test]
    fn validate_plugin_slug_rejects_path_traversal() {
        assert!(validate_plugin_slug("../bad").is_err());
    }

    #[test]
    fn validate_plugin_slug_accepts_valid() {
        assert!(validate_plugin_slug("default").is_ok());
    }
}
