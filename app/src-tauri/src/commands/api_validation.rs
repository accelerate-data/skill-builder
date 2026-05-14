use std::time::Duration;

use tauri::{Manager, State};

use crate::agents::skill_creator::{
    build_skill_creator_config, SkillCreatorIntent, SkillCreatorRuntimeContext,
    throwaway_non_skill_dir,
};
use crate::agents::tracked_openhands::{self, OpenHandsThrowawayRunParams};
use crate::commands::workflow::deploy::ensure_openhands_runtime_dir;
use crate::db::Db;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use crate::types::ModelSettings;

const MODEL_CONNECTION_TEST_PROMPT: &str = "Reply with exactly OK and nothing else.";
const MODEL_CONNECTION_TEST_SURFACE: &str = "model-connection-test";
const MODEL_CONNECTION_TEST_TIMEOUT_SECS: u64 = 45;

#[tauri::command]
pub async fn test_model_connection(
    app: tauri::AppHandle,
    db: State<'_, Db>,
    settings: ModelSettings,
) -> Result<bool, String> {
    log::info!("[test_model_connection]");

    let llm = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let app_settings = crate::types::AppSettings {
            model_settings: settings,
            ..crate::types::AppSettings::default()
        };
        crate::db::selected_workflow_llm(&conn, &app_settings)?
    };
    let skills_path = read_initialized_skills_path(&db)?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let runtime_run_dir = throwaway_non_skill_dir(MODEL_CONNECTION_TEST_SURFACE, &run_id);

    std::fs::create_dir_all(crate::skill_paths::throwaway_conversations_dir(
        std::path::Path::new(&runtime_run_dir),
    ))
    .map_err(|e| format!("Failed to create model-test conversations dir: {e}"))?;
    std::fs::create_dir_all(crate::skill_paths::throwaway_logs_dir(
        std::path::Path::new(&runtime_run_dir),
    ))
    .map_err(|e| format!("Failed to create model-test logs dir: {e}"))?;
    ensure_openhands_runtime_dir(&app, std::path::Path::new(&runtime_run_dir)).await?;

    let timeout = Duration::from_secs(
        u64::from(
            llm.timeout_seconds
                .unwrap_or(MODEL_CONNECTION_TEST_TIMEOUT_SECS as u32),
        )
        .clamp(5, MODEL_CONNECTION_TEST_TIMEOUT_SECS),
    );
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");
    let config = build_skill_creator_config(SkillCreatorRuntimeContext {
        app_data_root,
        skills_root: skills_path.clone(),
        skill_name: String::new(),
        plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
        prompt: MODEL_CONNECTION_TEST_PROMPT.to_string(),
        llm,
        intent: SkillCreatorIntent::ModelValidation,
        skill_dir_override: Some(throwaway_non_skill_dir(
            MODEL_CONNECTION_TEST_SURFACE,
            &run_id,
        )),
    });
    let run = tracked_openhands::send_tracked_throwaway(
        &app,
        OpenHandsThrowawayRunParams {
            agent_id: format!("model-connection-test-{}", uuid::Uuid::new_v4()),
            config,
            timeout,
        },
    )
    .await?;

    ensure_model_connection_succeeded(&run.conversation_state)?;
    Ok(true)
}

fn read_initialized_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let skills_path = settings
        .skills_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Skills path not configured".to_string())?;
    if !std::path::Path::new(&skills_path).is_dir() {
        return Err(format!(
            "Skills path is not initialized: {}. Update Settings -> Skills Path to a valid directory.",
            skills_path
        ));
    }
    Ok(skills_path)
}

fn ensure_model_connection_succeeded(state: &serde_json::Value) -> Result<(), String> {
    if state.get("type").and_then(|value| value.as_str()) != Some("conversation_state") {
        return Err("Model test did not return an OpenHands conversation_state".to_string());
    }

    match state.get("status").and_then(|value| value.as_str()) {
        Some("completed") => Ok(()),
        Some("error") | Some("cancelled") => Err(extract_terminal_error_detail(state)
            .unwrap_or_else(|| "OpenHands model test failed".to_string())),
        Some(status) => Err(format!(
            "OpenHands model test did not reach a completed state: {status}"
        )),
        None => Err("Model test conversation_state missing status".to_string()),
    }
}

fn extract_terminal_error_detail(state: &serde_json::Value) -> Option<String> {
    [
        "/error_detail",
        "/errorDetail",
        "/result_text",
        "/resultText",
        "/last_error",
        "/lastError",
    ]
    .into_iter()
    .find_map(|pointer| {
        state
            .pointer(pointer)
            .and_then(|value| value.as_str())
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_connection_uses_terminal_error_detail() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "error",
            "error_detail": "Subscription quota exceeded.",
        });

        let err = ensure_model_connection_succeeded(&state).unwrap_err();
        assert_eq!(err, "Subscription quota exceeded.");
    }

    #[test]
    fn model_connection_requires_completed_terminal_state() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "running",
        });

        let err = ensure_model_connection_succeeded(&state).unwrap_err();
        assert_eq!(
            err,
            "OpenHands model test did not reach a completed state: running"
        );
    }
}
