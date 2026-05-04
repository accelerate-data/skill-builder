use crate::types::ModelSettings;

#[tauri::command]
pub async fn test_model_connection(settings: ModelSettings) -> Result<bool, String> {
    log::info!("[test_model_connection]");
    settings
        .selected_workflow_llm()
        .map(|_| true)
        .map_err(|err| err.to_string())
}
