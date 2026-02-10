use crate::agents::sidecar::{self, AgentRegistry};

#[tauri::command]
pub async fn has_running_agents(
    state: tauri::State<'_, AgentRegistry>,
) -> Result<bool, String> {
    let reg = state.lock().await;
    Ok(!reg.agents.is_empty())
}

#[tauri::command]
pub async fn cancel_all_agents(
    app: tauri::AppHandle,
    state: tauri::State<'_, AgentRegistry>,
) -> Result<(), String> {
    sidecar::cancel_all_sidecars(state.inner(), &app).await
}
