use rusqlite::{Connection, OptionalExtension};
use crate::types::SecretString;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub api_key: SecretString,
    pub base_url: Option<String>,
    pub enabled: bool,
    pub litellm_provider_prefix: Option<String>,
    pub settings_json: Option<String>,
    pub created_at: i64,
}

pub fn insert_provider(conn: &Connection, provider: &LlmProvider) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_providers (id, name, api_key, base_url, enabled, litellm_provider_prefix, settings_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        rusqlite::params![
            provider.id,
            provider.name,
            provider.api_key.expose(),
            provider.base_url,
            provider.enabled as i32,
            provider.litellm_provider_prefix,
            provider.settings_json,
            provider.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_provider(conn: &Connection, provider: &LlmProvider) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_providers SET name = ?2, api_key = ?3, base_url = ?4, enabled = ?5,
         litellm_provider_prefix = ?6, settings_json = ?7 WHERE id = ?1",
        rusqlite::params![
            provider.id,
            provider.name,
            provider.api_key.expose(),
            provider.base_url,
            provider.enabled as i32,
            provider.litellm_provider_prefix,
            provider.settings_json,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_provider(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM llm_providers WHERE id = ?1",
        rusqlite::params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_providers(conn: &Connection) -> Result<Vec<LlmProvider>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, api_key, base_url, enabled, litellm_provider_prefix, settings_json, created_at FROM llm_providers ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            api_key: SecretString::new(row.get(2)?),
            base_url: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            litellm_provider_prefix: row.get(5)?,
            settings_json: row.get(6)?,
            created_at: row.get(7)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn get_provider(conn: &Connection, id: &str) -> Result<Option<LlmProvider>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, api_key, base_url, enabled, litellm_provider_prefix, settings_json, created_at FROM llm_providers WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(rusqlite::params![id], |row| {
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            api_key: SecretString::new(row.get(2)?),
            base_url: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            litellm_provider_prefix: row.get(5)?,
            settings_json: row.get(6)?,
            created_at: row.get(7)?,
        })
    }).optional().map_err(|e| e.to_string())
}
