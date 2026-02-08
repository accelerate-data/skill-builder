use crate::agents::sidecar::{self, AgentRegistry, SidecarConfig};
use crate::types::AppSettings;
use tauri_plugin_store::StoreExt;

const STORE_FILE: &str = "settings.json";
const SETTINGS_KEY: &str = "app_settings";

#[tauri::command]
pub async fn start_agent(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRegistry>,
    agent_id: String,
    prompt: String,
    model: String,
    cwd: String,
    allowed_tools: Option<Vec<String>>,
    max_turns: Option<u32>,
) -> Result<String, String> {
    // Read API key from store
    let store = app.store(STORE_FILE).map_err(|e| e.to_string())?;
    let settings: AppSettings = match store.get(SETTINGS_KEY) {
        Some(v) => serde_json::from_value(v.clone()).map_err(|e| e.to_string())?,
        None => AppSettings::default(),
    };

    let api_key = settings
        .anthropic_api_key
        .ok_or_else(|| "Anthropic API key not configured".to_string())?;

    let config = SidecarConfig {
        prompt,
        model,
        api_key,
        cwd,
        allowed_tools,
        max_turns,
        permission_mode: None,
    };

    sidecar::spawn_sidecar(agent_id.clone(), config, state.inner().clone(), app).await?;

    Ok(agent_id)
}

#[tauri::command]
pub async fn cancel_agent(
    state: tauri::State<'_, AgentRegistry>,
    agent_id: String,
) -> Result<(), String> {
    sidecar::cancel_sidecar(agent_id, state.inner().clone()).await
}
