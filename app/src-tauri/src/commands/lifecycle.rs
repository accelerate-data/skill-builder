use crate::agents::sidecar::AgentRegistry;

#[tauri::command]
pub async fn has_running_agents(
    state: tauri::State<'_, AgentRegistry>,
) -> Result<bool, String> {
    let reg = state.lock().await;
    Ok(!reg.agents.is_empty())
}
