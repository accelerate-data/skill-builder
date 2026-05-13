use std::time::Duration;

use tauri::{Manager, State};

use crate::agents::tracked_openhands::{self, OpenHandsThrowawayRunParams};
use crate::agents::runtime_config::{
    BuildOpenHandsRuntimeConfigParams, OpenHandsRuntimeConfig, OpenHandsRuntimeMode,
};
use crate::commands::workflow::deploy::ensure_openhands_runtime_dir;
use crate::db::Db;
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
    let workspace_path = read_initialized_workspace_path(&db)?;

    let run_id = uuid::Uuid::new_v4().to_string();
    let runtime_run_dir = crate::skill_paths::throwaway_runtime_dir(
        std::path::Path::new(&workspace_path),
        MODEL_CONNECTION_TEST_SURFACE,
        &run_id,
    );

    std::fs::create_dir_all(crate::skill_paths::throwaway_conversations_dir(
        &runtime_run_dir,
    ))
    .map_err(|e| format!("Failed to create model-test conversations dir: {e}"))?;
    std::fs::create_dir_all(crate::skill_paths::throwaway_logs_dir(&runtime_run_dir))
        .map_err(|e| format!("Failed to create model-test logs dir: {e}"))?;
    ensure_openhands_runtime_dir(&app, &runtime_run_dir).await?;

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
    let config =
        build_model_connection_test_config(&app_data_root, &workspace_path, &runtime_run_dir, llm);
    let run = tracked_openhands::run_tracked_throwaway_openhands_session(
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

fn read_initialized_workspace_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = crate::db::read_settings(&conn)?;
    let workspace_path = settings
        .skills_path
        .clone()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "Skills path not configured".to_string())?;
    if !std::path::Path::new(&workspace_path).is_dir() {
        return Err(format!(
            "Skills path is not initialized: {}. Update Settings -> Skills Path to a valid directory.",
            workspace_path
        ));
    }
    Ok(workspace_path)
}

fn build_model_connection_test_config(
    app_data_root: &str,
    skills_path: &str,
    runtime_run_dir: &std::path::Path,
    llm: crate::types::WorkflowLlmConfig,
) -> OpenHandsRuntimeConfig {
    crate::agents::runtime_config::build_openhands_runtime_config(
        BuildOpenHandsRuntimeConfigParams {
            prompt: MODEL_CONNECTION_TEST_PROMPT.to_string(),
            llm,
            app_data_root: app_data_root.to_string(),
            skills_root: skills_path.replace('\\', "/"),
            skill_dir: runtime_run_dir.to_string_lossy().replace('\\', "/"),
            mode: Some(OpenHandsRuntimeMode::Throwaway),
            agent_name: "settings-model-test".to_string(),
            task_kind: Some("settings.model_connection_test".to_string()),
            user_message_suffix: None,
            allowed_tools: Vec::new(),
            max_turns: 1,
            output_format: None,
            skill_name: None,
            step_id: Some(-40),
            run_source: Some("test".to_string()),
            plugin_slug: crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
        },
    )
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
