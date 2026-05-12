use rusqlite::Connection;

use crate::db::{read_cached_model_catalog, replace_model_catalog_snapshot};
use crate::types::{CatalogProvider, ModelCatalogEntry, ModelFilter};

const MODELS_DEV_API_URL: &str = "https://models.dev/api.json";

/// Fetch models.dev, store the exact provider/model key set in SQLite, and read it back.
pub async fn refresh_model_catalog(
    conn: &mut Connection,
) -> Result<Vec<ModelCatalogEntry>, String> {
    let body = fetch_models_dev_json().await?;
    let providers: Vec<CatalogProvider> =
        serde_json::from_str(&body).map_err(|e| format!("Failed to parse models.dev payload: {e}"))?;

    replace_model_catalog_snapshot(conn, &providers)
        .map_err(|e| format!("Failed to write catalog snapshot: {e}"))?;

    read_cached_model_catalog(conn).map_err(|e| format!("Failed to read cached catalog: {e}"))
}

/// Refresh from fixture JSON (for tests).
pub fn refresh_model_catalog_from_fixture(
    conn: &mut Connection,
    json: &str,
) -> Result<Vec<ModelCatalogEntry>, String> {
    let providers: Vec<CatalogProvider> =
        serde_json::from_str(json).map_err(|e| format!("Failed to parse fixture payload: {e}"))?;

    replace_model_catalog_snapshot(conn, &providers)
        .map_err(|e| format!("Failed to write catalog snapshot: {e}"))?;

    read_cached_model_catalog(conn).map_err(|e| format!("Failed to read cached catalog: {e}"))
}

async fn fetch_models_dev_json() -> Result<String, String> {
    let resp = reqwest::get(MODELS_DEV_API_URL)
        .await
        .map_err(|e| format!("Failed to fetch {MODELS_DEV_API_URL}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!(
            "models.dev returned HTTP {}",
            resp.status()
        ));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))
}

/// Pure filtering over a cached model vector.
pub fn filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: &[ModelFilter],
) -> Vec<ModelCatalogEntry> {
    if filters.is_empty() {
        return models;
    }

    models
        .into_iter()
        .filter(|entry| {
            filters.iter().all(|f| apply_filter(entry, f))
        })
        .collect()
}

fn apply_filter(entry: &ModelCatalogEntry, filter: &ModelFilter) -> bool {
    let field = &filter.field;
    let op = &filter.op;
    let value = &filter.value;

    let field_value = match field.as_str() {
        "provider_id" => serde_json::Value::String(entry.provider_id.clone()),
        "model_id" => serde_json::Value::String(entry.model_id.clone()),
        "name" => serde_json::Value::String(entry.name.clone()),
        "family" => entry.family.clone().map_or(serde_json::Value::Null, serde_json::Value::String),
        "reasoning" => serde_json::Value::Bool(entry.reasoning),
        "tool_call" => serde_json::Value::Bool(entry.tool_call),
        "attachment" => serde_json::Value::Bool(entry.attachment),
        "structured_output" => entry.structured_output.map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "temperature" => entry.temperature.map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "open_weights" => serde_json::Value::Bool(entry.open_weights),
        "context_limit" => entry.context_limit.map_or(serde_json::Value::Null, |v| serde_json::Value::Number(serde_json::Number::from(v))),
        "input_cost_per_token" => entry.input_cost_per_token.map_or(serde_json::Value::Null, |v| serde_json::Value::Number(serde_json::Number::from_f64(v).unwrap_or(serde_json::Number::from(0)))),
        "output_cost_per_token" => entry.output_cost_per_token.map_or(serde_json::Value::Null, |v| serde_json::Value::Number(serde_json::Number::from_f64(v).unwrap_or(serde_json::Number::from(0)))),
        "status" => entry.status.clone().map_or(serde_json::Value::Null, serde_json::Value::String),
        "experimental" => entry.experimental.map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "input_modalities" => serde_json::Value::Array(entry.input_modalities.iter().map(|m| serde_json::Value::String(m.clone())).collect()),
        "output_modalities" => serde_json::Value::Array(entry.output_modalities.iter().map(|m| serde_json::Value::String(m.clone())).collect()),
        _ => return true,
    };

    match op.as_str() {
        "eq" => field_value == *value,
        "neq" => field_value != *value,
        "contains" => match (&field_value, value) {
            (serde_json::Value::Array(arr), serde_json::Value::String(s)) => {
                arr.iter().any(|v| v.as_str() == Some(s))
            }
            (serde_json::Value::String(field_str), serde_json::Value::String(s)) => {
                field_str.contains(s)
            }
            _ => false,
        },
        "gte" => match (&field_value, value) {
            (serde_json::Value::Number(a), serde_json::Value::Number(b)) => {
                a.as_f64().unwrap_or(f64::MIN) >= b.as_f64().unwrap_or(f64::MIN)
            }
            _ => false,
        },
        "lte" => match (&field_value, value) {
            (serde_json::Value::Number(a), serde_json::Value::Number(b)) => {
                a.as_f64().unwrap_or(f64::MAX) <= b.as_f64().unwrap_or(f64::MAX)
            }
            _ => false,
        },
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture_json() -> &'static str {
        r#"[
            {
                "id": "anthropic",
                "env": ["ANTHROPIC_API_KEY"],
                "npm": "@anthropic-ai/sdk",
                "api": "https://api.anthropic.com",
                "name": "Anthropic",
                "doc": "https://docs.anthropic.com",
                "models": {
                    "claude-sonnet-4-6": {
                        "id": "claude-sonnet-4-6",
                        "name": "Claude Sonnet 4.6",
                        "family": "claude",
                        "attachment": true,
                        "reasoning": false,
                        "tool_call": true,
                        "structured_output": true,
                        "temperature": true,
                        "knowledge": null,
                        "release_date": "2025-01-01",
                        "last_updated": "2025-01-01",
                        "modalities": {
                            "input": ["text", "image"],
                            "output": ["text"]
                        },
                        "open_weights": false,
                        "cost": {
                            "input": 0.000003,
                            "output": 0.000015
                        },
                        "limit": {
                            "context": 200000
                        },
                        "interleaved": null,
                        "provider": null,
                        "status": null,
                        "experimental": null
                    }
                }
            }
        ]"#
    }

    fn create_test_db_with_catalog() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            r#"
            CREATE TABLE provider_catalog (
                provider_id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                npm TEXT NOT NULL,
                api_base_url TEXT,
                doc_url TEXT NOT NULL
            );
            CREATE TABLE provider_env (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_id TEXT NOT NULL REFERENCES provider_catalog(provider_id) ON DELETE CASCADE,
                env_var TEXT NOT NULL,
                UNIQUE(provider_id, env_var)
            );
            CREATE TABLE model_catalog (
                full_id TEXT PRIMARY KEY,
                provider_id TEXT NOT NULL REFERENCES provider_catalog(provider_id) ON DELETE CASCADE,
                model_id TEXT NOT NULL,
                name TEXT NOT NULL,
                family TEXT,
                attachment INTEGER NOT NULL DEFAULT 0,
                reasoning INTEGER NOT NULL DEFAULT 0,
                tool_call INTEGER NOT NULL DEFAULT 0,
                structured_output INTEGER,
                temperature INTEGER,
                knowledge TEXT,
                release_date TEXT NOT NULL,
                last_updated TEXT NOT NULL,
                open_weights INTEGER NOT NULL DEFAULT 0,
                input_cost_per_token REAL,
                output_cost_per_token REAL,
                context_limit INTEGER,
                interleaved TEXT,
                status TEXT,
                experimental INTEGER,
                UNIQUE(provider_id, model_id)
            );
            CREATE TABLE model_input_modalities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_id TEXT NOT NULL REFERENCES model_catalog(full_id) ON DELETE CASCADE,
                modality TEXT NOT NULL,
                UNIQUE(full_id, modality)
            );
            CREATE TABLE model_output_modalities (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                full_id TEXT NOT NULL REFERENCES model_catalog(full_id) ON DELETE CASCADE,
                modality TEXT NOT NULL,
                UNIQUE(full_id, modality)
            );
            "#,
        )
        .unwrap();
        conn
    }

    #[test]
    fn test_refresh_from_fixture_writes_all_tables() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        assert!(!entries.is_empty(), "should return cached entries");

        let entry = entries.iter().find(|e| e.model_id == "claude-sonnet-4-6").unwrap();
        assert_eq!(entry.provider_id, "anthropic");
        assert_eq!(entry.name, "Claude Sonnet 4.6");
        assert!(entry.attachment);
        assert!(!entry.reasoning);
        assert!(entry.tool_call);
        assert_eq!(entry.structured_output, Some(true));
        assert_eq!(entry.input_modalities, vec!["image", "text"]);
        assert_eq!(entry.output_modalities, vec!["text"]);
        assert!((entry.input_cost_per_token.unwrap() - 0.000003).abs() < 1e-9);
        assert_eq!(entry.context_limit, Some(200000));
    }

    #[test]
    fn test_filter_models_provider_id_eq() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "provider_id".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::String("anthropic".to_string()),
        }];

        let result = filter_models(entries, &filters);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].provider_id, "anthropic");
    }

    #[test]
    fn test_filter_models_reasoning_true() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "reasoning".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::Bool(false),
        }];

        let result = filter_models(entries, &filters);
        assert_eq!(result.len(), 1);
        assert!(!result[0].reasoning);
    }

    #[test]
    fn test_filter_models_context_limit_gte() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "context_limit".to_string(),
            op: "gte".to_string(),
            value: serde_json::Value::Number(serde_json::Number::from(100000)),
        }];

        let result = filter_models(entries, &filters);
        assert_eq!(result.len(), 1);
        assert!(result[0].context_limit.unwrap() >= 100000);
    }

    #[test]
    fn test_filter_models_input_modality_contains() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "input_modalities".to_string(),
            op: "contains".to_string(),
            value: serde_json::Value::String("image".to_string()),
        }];

        let result = filter_models(entries, &filters);
        assert_eq!(result.len(), 1);
        assert!(result[0].input_modalities.contains(&"image".to_string()));
    }

    #[test]
    fn test_filter_models_empty_filters_returns_all() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let result = filter_models(entries, &[]);
        assert_eq!(result.len(), 1);
    }
}
