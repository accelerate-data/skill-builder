use crate::db::Db;

#[derive(serde::Deserialize)]
pub struct CreateProfileRequest {
    pub name: String,
    pub budget_monthly: Option<f64>,
    pub budget_total: Option<f64>,
    pub tpm_limit: Option<i64>,
    pub rpm_limit: Option<i64>,
    pub settings_json: Option<String>,
}

#[derive(serde::Deserialize)]
pub struct AddProfileModelRequest {
    pub profile_id: String,
    pub model_name: String,
    pub provider_id: String,
    pub priority: i32,
    pub budget: Option<f64>,
}

#[derive(serde::Deserialize)]
pub struct ReorderProfileModelsRequest {
    pub profile_id: String,
    pub model_ids: Vec<String>,
}

#[tauri::command]
pub fn list_litellm_profiles(db: tauri::State<'_, Db>) -> Result<Vec<crate::db::LlmProfile>, String> {
    log::info!("[list_litellm_profiles]");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::list_profiles(&conn)
}

#[tauri::command]
pub fn get_litellm_profile_models(
    db: tauri::State<'_, Db>,
    profile_id: String,
) -> Result<Vec<crate::db::LlmProfileModel>, String> {
    log::info!("[get_litellm_profile_models] profile_id={}", profile_id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::get_profile_models(&conn, &profile_id)
}

#[tauri::command]
pub fn create_litellm_profile(
    db: tauri::State<'_, Db>,
    request: CreateProfileRequest,
) -> Result<String, String> {
    log::info!("[create_litellm_profile] name={}", request.name);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let profile = crate::db::LlmProfile {
        id: id.clone(),
        name: request.name,
        budget_monthly: request.budget_monthly,
        budget_total: request.budget_total,
        tpm_limit: request.tpm_limit,
        rpm_limit: request.rpm_limit,
        virtual_key: None,
        settings_json: request.settings_json,
        created_at: chrono::Utc::now().timestamp(),
    };
    crate::db::insert_profile(&conn, &profile)?;
    Ok(id)
}

#[tauri::command]
pub fn update_litellm_profile(
    db: tauri::State<'_, Db>,
    id: String,
    request: CreateProfileRequest,
) -> Result<(), String> {
    log::info!("[update_litellm_profile] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let existing = crate::db::get_profile(&conn, &id)?
        .ok_or_else(|| "Profile not found".to_string())?;
    let profile = crate::db::LlmProfile {
        id,
        name: request.name,
        budget_monthly: request.budget_monthly,
        budget_total: request.budget_total,
        tpm_limit: request.tpm_limit,
        rpm_limit: request.rpm_limit,
        virtual_key: existing.virtual_key,
        settings_json: request.settings_json.or(existing.settings_json),
        created_at: existing.created_at,
    };
    crate::db::update_profile(&conn, &profile)
}

#[tauri::command]
pub fn delete_litellm_profile(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    log::info!("[delete_litellm_profile] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::delete_profile(&conn, &id)
}

#[tauri::command]
pub fn add_profile_model(
    db: tauri::State<'_, Db>,
    request: AddProfileModelRequest,
) -> Result<String, String> {
    log::info!("[add_profile_model] profile_id={} model={}", request.profile_id, request.model_name);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let model = crate::db::LlmProfileModel {
        id: id.clone(),
        profile_id: request.profile_id,
        model_name: request.model_name,
        provider_id: request.provider_id,
        priority: request.priority,
        budget: request.budget,
    };
    crate::db::insert_profile_model(&conn, &model)?;
    Ok(id)
}

#[tauri::command]
pub fn remove_profile_model(
    db: tauri::State<'_, Db>,
    model_id: String,
) -> Result<(), String> {
    log::info!("[remove_profile_model] model_id={}", model_id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::delete_profile_model(&conn, &model_id)
}

#[tauri::command]
pub fn reorder_profile_models(
    db: tauri::State<'_, Db>,
    request: ReorderProfileModelsRequest,
) -> Result<(), String> {
    log::info!("[reorder_profile_models] profile_id={}", request.profile_id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    for (i, model_id) in request.model_ids.iter().enumerate() {
        conn.execute(
            "UPDATE llm_profile_models SET priority = ?1 WHERE id = ?2 AND profile_id = ?3",
            rusqlite::params![i as i32, model_id, request.profile_id],
        ).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn verify_profile_virtual_key(
    db: tauri::State<'_, Db>,
    profile_id: String,
) -> Result<bool, String> {
    log::info!("[verify_profile_virtual_key] profile_id={}", profile_id);
    let virtual_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let profile = crate::db::get_profile(&conn, &profile_id)?
            .ok_or_else(|| "Profile not found".to_string())?;
        profile.virtual_key.clone()
            .ok_or_else(|| "Profile has no virtual key".to_string())?
    };

    let handle = crate::agents::litellm_proxy::try_get_proxy_handle()
        .await
        .ok_or_else(|| "LiteLLM proxy not running".to_string())?;

    let client = handle.admin_client();
    let _info = client.key_info(&virtual_key).await?;
    Ok(true)
}
