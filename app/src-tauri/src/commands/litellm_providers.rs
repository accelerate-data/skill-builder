use crate::db::Db;
use crate::types::SecretString;

#[derive(serde::Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub enabled: Option<bool>,
    pub litellm_provider_prefix: Option<String>,
    pub settings_json: Option<String>,
}

#[tauri::command]
pub fn list_litellm_providers(
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::LlmProvider>, String> {
    log::info!("[list_litellm_providers]");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::list_providers(&conn)
}

#[tauri::command]
pub fn create_litellm_provider(
    db: tauri::State<'_, Db>,
    request: CreateProviderRequest,
) -> Result<String, String> {
    log::info!("[create_litellm_provider] name={}", request.name);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let provider = crate::db::LlmProvider {
        id: id.clone(),
        name: request.name,
        api_key: SecretString::new(request.api_key),
        base_url: request.base_url,
        enabled: request.enabled.unwrap_or(true),
        litellm_provider_prefix: request.litellm_provider_prefix,
        settings_json: request.settings_json,
        created_at: chrono::Utc::now().timestamp(),
    };
    crate::db::insert_provider(&conn, &provider)?;
    Ok(id)
}

#[tauri::command]
pub fn update_litellm_provider(
    db: tauri::State<'_, Db>,
    id: String,
    request: CreateProviderRequest,
) -> Result<(), String> {
    log::info!("[update_litellm_provider] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let provider = crate::db::LlmProvider {
        id,
        name: request.name,
        api_key: SecretString::new(request.api_key),
        base_url: request.base_url,
        enabled: request.enabled.unwrap_or(true),
        litellm_provider_prefix: request.litellm_provider_prefix,
        settings_json: request.settings_json,
        created_at: chrono::Utc::now().timestamp(),
    };
    crate::db::update_provider(&conn, &provider)
}

#[tauri::command]
pub fn delete_litellm_provider(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    log::info!("[delete_litellm_provider] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::delete_provider(&conn, &id)
}
