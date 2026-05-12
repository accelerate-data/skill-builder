use rusqlite::Connection;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub budget_monthly: Option<f64>,
    pub budget_total: Option<f64>,
    pub tpm_limit: Option<i64>,
    pub rpm_limit: Option<i64>,
    pub virtual_key: Option<String>,
    pub settings_json: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct LlmProfileModel {
    pub id: String,
    pub profile_id: String,
    pub model_name: String,
    pub provider_id: String,
    pub priority: i32,
    pub budget: Option<f64>,
}

pub fn insert_profile(conn: &Connection, profile: &LlmProfile) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_profiles (id, name, budget_monthly, budget_total, tpm_limit, rpm_limit, virtual_key, settings_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            profile.id, profile.name, profile.budget_monthly, profile.budget_total,
            profile.tpm_limit, profile.rpm_limit, profile.virtual_key,
            profile.settings_json, profile.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_profile(conn: &Connection, profile: &LlmProfile) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_profiles SET name = ?2, budget_monthly = ?3, budget_total = ?4,
         tpm_limit = ?5, rpm_limit = ?6, virtual_key = ?7, settings_json = ?8
         WHERE id = ?1",
        rusqlite::params![
            profile.id,
            profile.name,
            profile.budget_monthly,
            profile.budget_total,
            profile.tpm_limit,
            profile.rpm_limit,
            profile.virtual_key,
            profile.settings_json,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_profile_virtual_key(
    conn: &Connection,
    profile_id: &str,
    virtual_key: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_profiles SET virtual_key = ?2 WHERE id = ?1",
        rusqlite::params![profile_id, virtual_key],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_profile(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;
    if let Err(e) = conn.execute(
        "DELETE FROM llm_profile_models WHERE profile_id = ?1",
        rusqlite::params![id],
    ) {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e.to_string());
    }
    if let Err(e) = conn.execute(
        "DELETE FROM llm_profiles WHERE id = ?1",
        rusqlite::params![id],
    ) {
        let _ = conn.execute("ROLLBACK", []);
        return Err(e.to_string());
    }
    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_profile(conn: &Connection, id: &str) -> Result<Option<LlmProfile>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, budget_monthly, budget_total, tpm_limit, rpm_limit, virtual_key, settings_json, created_at
         FROM llm_profiles WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![id], |row| {
            Ok(LlmProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                budget_monthly: row.get(2)?,
                budget_total: row.get(3)?,
                tpm_limit: row.get(4)?,
                rpm_limit: row.get(5)?,
                virtual_key: row.get(6)?,
                settings_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let profiles: Vec<LlmProfile> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(profiles.into_iter().next())
}

pub fn list_profiles(conn: &Connection) -> Result<Vec<LlmProfile>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, budget_monthly, budget_total, tpm_limit, rpm_limit, virtual_key, settings_json, created_at
         FROM llm_profiles ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(LlmProfile {
                id: row.get(0)?,
                name: row.get(1)?,
                budget_monthly: row.get(2)?,
                budget_total: row.get(3)?,
                tpm_limit: row.get(4)?,
                rpm_limit: row.get(5)?,
                virtual_key: row.get(6)?,
                settings_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn insert_profile_model(conn: &Connection, model: &LlmProfileModel) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_profile_models (id, profile_id, model_name, provider_id, priority, budget)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            model.id,
            model.profile_id,
            model.model_name,
            model.provider_id,
            model.priority,
            model.budget
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[allow(dead_code)]
pub fn delete_profile_models(conn: &Connection, profile_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM llm_profile_models WHERE profile_id = ?1",
        rusqlite::params![profile_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_profile_models(
    conn: &Connection,
    profile_id: &str,
) -> Result<Vec<LlmProfileModel>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, model_name, provider_id, priority, budget FROM llm_profile_models
         WHERE profile_id = ?1 ORDER BY priority"
    ).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![profile_id], |row| {
            Ok(LlmProfileModel {
                id: row.get(0)?,
                profile_id: row.get(1)?,
                model_name: row.get(2)?,
                provider_id: row.get(3)?,
                priority: row.get(4)?,
                budget: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_profile_model(conn: &Connection, model_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM llm_profile_models WHERE id = ?1",
        rusqlite::params![model_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
