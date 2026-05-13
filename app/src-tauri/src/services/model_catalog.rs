use std::collections::BTreeMap;

use rusqlite::Connection;
use serde::Deserialize;

use crate::db::{read_cached_model_catalog, replace_model_catalog_snapshot};
use crate::types::{CatalogProvider, ModelCatalogEntry, ModelFilter};

const MODELS_DEV_API_URL: &str = "https://models.dev/api.json";

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum UpstreamCatalog {
    Providers(Vec<CatalogProvider>),
    ProviderMap(BTreeMap<String, CatalogProvider>),
}

/// Fetch models.dev, store the exact provider/model key set in SQLite, and read it back.
pub async fn refresh_model_catalog(db: &crate::db::Db) -> Result<Vec<ModelCatalogEntry>, String> {
    let body = fetch_models_dev_json().await?;
    let db_clone = db.0.clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = db_clone.lock().map_err(|e| {
            log::error!("[refresh_model_catalog] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        refresh_model_catalog_from_json(&mut conn, &body)
    })
    .await
    .map_err(|e| format!("refresh task panicked: {}", e))?
}

/// Refresh from raw JSON string (used by the Tauri command after async fetch).
pub fn refresh_model_catalog_from_json(
    conn: &mut Connection,
    json: &str,
) -> Result<Vec<ModelCatalogEntry>, String> {
    let providers = parse_catalog_providers(json)?;

    replace_model_catalog_snapshot(conn, &providers)
        .map_err(|e| format!("Failed to write catalog snapshot: {e}"))?;

    read_cached_model_catalog(conn).map_err(|e| format!("Failed to read cached catalog: {e}"))
}

fn parse_catalog_providers(json: &str) -> Result<Vec<CatalogProvider>, String> {
    let catalog: UpstreamCatalog = serde_json::from_str(json)
        .map_err(|e| format!("Failed to parse models.dev payload: {e}"))?;

    Ok(match catalog {
        UpstreamCatalog::Providers(providers) => providers,
        UpstreamCatalog::ProviderMap(provider_map) => provider_map.into_values().collect(),
    })
}

/// Fetch the raw JSON from models.dev (public for use by the service).
pub async fn fetch_models_dev_json() -> Result<String, String> {
    let resp = reqwest::get(MODELS_DEV_API_URL)
        .await
        .map_err(|e| format!("Failed to fetch {MODELS_DEV_API_URL}: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("models.dev returned HTTP {}", resp.status()));
    }

    resp.text()
        .await
        .map_err(|e| format!("Failed to read response body: {e}"))
}

/// Pure filtering over a cached model vector.
pub fn filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: &[ModelFilter],
) -> Result<Vec<ModelCatalogEntry>, String> {
    if filters.is_empty() {
        return Ok(models);
    }

    // Validate all filters first before applying
    for f in filters {
        validate_filter(f)?;
    }

    let mut result = Vec::new();
    for entry in models {
        let mut matches = true;
        for f in filters {
            if !apply_filter(&entry, f)? {
                matches = false;
                break;
            }
        }
        if matches {
            result.push(entry);
        }
    }
    Ok(result)
}

fn validate_filter(filter: &ModelFilter) -> Result<(), String> {
    match filter.field.as_str() {
        "provider_id"
        | "model_id"
        | "name"
        | "family"
        | "reasoning"
        | "tool_call"
        | "attachment"
        | "structured_output"
        | "temperature"
        | "open_weights"
        | "context_limit"
        | "input_cost_per_token"
        | "output_cost_per_token"
        | "status"
        | "experimental"
        | "input_modalities"
        | "output_modalities" => {}
        _ => return Err(format!("unknown filter field: {}", filter.field)),
    }

    match filter.op.as_str() {
        "eq" | "neq" | "contains" | "gte" | "lte" => {}
        _ => return Err(format!("unknown filter operator: {}", filter.op)),
    }

    Ok(())
}

fn apply_filter(entry: &ModelCatalogEntry, filter: &ModelFilter) -> Result<bool, String> {
    let field = &filter.field;
    let op = &filter.op;
    let value = &filter.value;

    let field_value = match field.as_str() {
        "provider_id" => serde_json::Value::String(entry.provider_id.clone()),
        "model_id" => serde_json::Value::String(entry.model_id.clone()),
        "name" => serde_json::Value::String(entry.name.clone()),
        "family" => entry
            .family
            .clone()
            .map_or(serde_json::Value::Null, serde_json::Value::String),
        "reasoning" => serde_json::Value::Bool(entry.reasoning),
        "tool_call" => serde_json::Value::Bool(entry.tool_call),
        "attachment" => serde_json::Value::Bool(entry.attachment),
        "structured_output" => entry
            .structured_output
            .map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "temperature" => entry
            .temperature
            .map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "open_weights" => serde_json::Value::Bool(entry.open_weights),
        "context_limit" => entry.context_limit.map_or(serde_json::Value::Null, |v| {
            serde_json::Value::Number(serde_json::Number::from(v))
        }),
        "input_cost_per_token" => entry
            .input_cost_per_token
            .map_or(serde_json::Value::Null, |v| {
                serde_json::Value::Number(
                    serde_json::Number::from_f64(v).unwrap_or(serde_json::Number::from(0)),
                )
            }),
        "output_cost_per_token" => {
            entry
                .output_cost_per_token
                .map_or(serde_json::Value::Null, |v| {
                    serde_json::Value::Number(
                        serde_json::Number::from_f64(v).unwrap_or(serde_json::Number::from(0)),
                    )
                })
        }
        "status" => entry
            .status
            .clone()
            .map_or(serde_json::Value::Null, serde_json::Value::String),
        "experimental" => entry
            .experimental
            .map_or(serde_json::Value::Null, serde_json::Value::Bool),
        "input_modalities" => serde_json::Value::Array(
            entry
                .input_modalities
                .iter()
                .map(|m| serde_json::Value::String(m.clone()))
                .collect(),
        ),
        "output_modalities" => serde_json::Value::Array(
            entry
                .output_modalities
                .iter()
                .map(|m| serde_json::Value::String(m.clone()))
                .collect(),
        ),
        _ => return Err(format!("unknown filter field: {}", field)),
    };

    match op.as_str() {
        "eq" => Ok(field_value == *value),
        "neq" => Ok(field_value != *value),
        "contains" => Ok(match (&field_value, value) {
            (serde_json::Value::Array(arr), serde_json::Value::String(s)) => {
                arr.iter().any(|v| v.as_str() == Some(s))
            }
            (serde_json::Value::String(field_str), serde_json::Value::String(s)) => {
                field_str.contains(s)
            }
            _ => false,
        }),
        "gte" => Ok(match (&field_value, value) {
            (serde_json::Value::Number(a), serde_json::Value::Number(b)) => {
                a.as_f64().unwrap_or(f64::MIN) >= b.as_f64().unwrap_or(f64::MIN)
            }
            _ => false,
        }),
        "lte" => Ok(match (&field_value, value) {
            (serde_json::Value::Number(a), serde_json::Value::Number(b)) => {
                a.as_f64().unwrap_or(f64::MAX) <= b.as_f64().unwrap_or(f64::MAX)
            }
            _ => false,
        }),
        _ => Err(format!("unknown filter operator: {}", op)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    fn fixture_json() -> &'static str {
        include_str!("../fixtures/model-catalog.json")
    }

    fn wrapper_shape_fixture_json() -> &'static str {
        r#"{
          "opencode": {
            "id": "opencode",
            "env": ["OPENCODE_API_KEY"],
            "npm": "@ai-sdk/openai-compatible",
            "api": "https://api.opencode.ai/v1",
            "name": "OpenCode",
            "doc": "https://opencode.ai/docs/models",
            "models": {
              "claude-sonnet-4-6": {
                "id": "claude-sonnet-4-6",
                "name": "Claude Sonnet 4.6",
                "attachment": true,
                "reasoning": false,
                "tool_call": true,
                "temperature": true,
                "release_date": "2025-02-24",
                "last_updated": "2025-02-24",
                "modalities": {
                  "input": ["text", "image"],
                  "output": ["text"]
                },
                "open_weights": false,
                "limit": {
                  "context": 200000
                },
                "provider": {
                  "npm": "@ai-sdk/anthropic"
                }
              }
            }
          },
          "databricks": {
            "id": "databricks",
            "env": ["DATABRICKS_TOKEN"],
            "npm": "@ai-sdk/openai-compatible",
            "api": "https://databricks.example/v1",
            "name": "Databricks",
            "doc": "https://docs.databricks.com",
            "models": {
              "databricks-gpt-5-5": {
                "id": "databricks-gpt-5-5",
                "name": "Databricks GPT-5.5",
                "attachment": false,
                "reasoning": true,
                "tool_call": true,
                "temperature": true,
                "release_date": "2026-01-01",
                "last_updated": "2026-01-01",
                "modalities": {
                  "input": ["text"],
                  "output": ["text"]
                },
                "open_weights": false,
                "limit": {
                  "context": 272000
                },
                "experimental": {
                  "modes": {
                    "fast": {
                      "provider": {
                        "body": {
                          "service_tier": "priority"
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }"#
    }

    #[test]
    fn test_parse_catalog_providers_accepts_provider_map_shape() {
        let providers = parse_catalog_providers(fixture_json()).unwrap();

        assert_eq!(providers.len(), 2);
        assert!(providers.iter().any(|provider| provider.id == "anthropic"));
        assert!(providers.iter().any(|provider| provider.id == "ollama"));
    }

    #[test]
    fn test_parse_catalog_providers_accepts_object_provider_and_experimental_fields() {
        let providers = parse_catalog_providers(wrapper_shape_fixture_json()).unwrap();

        assert_eq!(providers.len(), 2);
        assert!(providers.iter().any(|provider| provider.id == "opencode"));
        assert!(providers.iter().any(|provider| provider.id == "databricks"));
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

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        assert!(!entries.is_empty(), "should return cached entries");

        let entry = entries
            .iter()
            .find(|e| e.model_id == "claude-sonnet-4-6")
            .unwrap();
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

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "provider_id".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::String("anthropic".to_string()),
        }];

        let result = filter_models(entries, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].provider_id, "anthropic");
    }

    #[test]
    fn test_filter_models_reasoning_false() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "reasoning".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::Bool(false),
        }];

        let result = filter_models(entries, &filters).unwrap();
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|e| !e.reasoning));
    }

    #[test]
    fn test_filter_models_context_limit_gte() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "context_limit".to_string(),
            op: "gte".to_string(),
            value: serde_json::Value::Number(serde_json::Number::from(100000)),
        }];

        let result = filter_models(entries, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].context_limit.unwrap() >= 100000);
    }

    #[test]
    fn test_filter_models_input_modality_contains() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "input_modalities".to_string(),
            op: "contains".to_string(),
            value: serde_json::Value::String("image".to_string()),
        }];

        let result = filter_models(entries, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert!(result[0].input_modalities.contains(&"image".to_string()));
    }

    #[test]
    fn test_filter_models_empty_filters_returns_all() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let result = filter_models(entries, &[]).unwrap();
        assert_eq!(result.len(), 2);
    }

    #[test]
    fn test_filter_models_unknown_field_returns_error() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "nonexistent_field".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::String("test".to_string()),
        }];

        let result = filter_models(entries, &filters);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown filter field"));
    }

    #[test]
    fn test_filter_models_unknown_op_returns_error() {
        let mut conn = create_test_db_with_catalog();

        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "provider_id".to_string(),
            op: "regex".to_string(),
            value: serde_json::Value::String("test".to_string()),
        }];

        let result = filter_models(entries, &filters);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("unknown filter operator"));
    }

    #[test]
    fn test_filter_models_structured_output_true() {
        let mut conn = create_test_db_with_catalog();
        let entries = refresh_model_catalog_from_json(&mut conn, fixture_json()).unwrap();

        let filters = vec![ModelFilter {
            field: "structured_output".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::Bool(true),
        }];

        let result = filter_models(entries, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].model_id, "claude-sonnet-4-6");
        assert_eq!(result[0].structured_output, Some(true));
    }
}
