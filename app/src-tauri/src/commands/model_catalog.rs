use crate::db::{self, Db};
use crate::services::model_catalog;
use crate::types::{ModelCatalogEntry, ModelFilter};

#[tauri::command]
pub async fn refresh_model_catalog(
    db: tauri::State<'_, Db>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    log::info!("[refresh_model_catalog] refreshing catalog from models.dev");

    let body = model_catalog::fetch_models_dev_json().await?;

    let db_clone = db.inner().clone();
    tokio::task::spawn_blocking(move || {
        let mut conn = db_clone.0.lock().map_err(|e| {
            log::error!("[refresh_model_catalog] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        model_catalog::refresh_model_catalog_from_json(&mut conn, &body)
    })
    .await
    .map_err(|e| format!("refresh task panicked: {}", e))?
}

#[tauri::command]
pub fn get_cached_model_catalog(
    db: tauri::State<'_, Db>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    log::info!("[get_cached_model_catalog] reading cached catalog");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_cached_model_catalog] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    db::read_cached_model_catalog(&conn).map_err(|e| {
        log::error!("[get_cached_model_catalog] Failed to read cached catalog: {}", e);
        e.to_string()
    })
}

#[tauri::command]
pub fn filter_models(
    models: Vec<ModelCatalogEntry>,
    filters: Vec<ModelFilter>,
) -> Result<Vec<ModelCatalogEntry>, String> {
    log::info!("[filter_models] applying {} filters to {} models", filters.len(), models.len());
    model_catalog::filter_models(models, &filters)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
    use crate::services::model_catalog::refresh_model_catalog_from_fixture;

    fn fixture_json() -> &'static str {
        include_str!("../fixtures/model-catalog.json")
    }

    #[test]
    fn test_refresh_from_fixture_via_service() {
        let mut conn = create_test_db_for_tests();
        let entries = refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();
        assert!(!entries.is_empty());
    }

    #[test]
    fn test_get_cached_after_refresh() {
        let mut conn = create_test_db_for_tests();
        refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let cached = db::read_cached_model_catalog(&conn).unwrap();
        assert!(!cached.is_empty());
        assert!(cached.iter().any(|e| e.model_id == "claude-sonnet-4-6"));
        assert!(cached.iter().any(|e| e.model_id == "llama3"));
    }

    #[test]
    fn test_filter_round_trip() {
        let mut conn = create_test_db_for_tests();
        refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let all = db::read_cached_model_catalog(&conn).unwrap();
        let filters = vec![ModelFilter {
            field: "provider_id".to_string(),
            op: "eq".to_string(),
            value: serde_json::Value::String("anthropic".to_string()),
        }];

        let result = model_catalog::filter_models(all, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].provider_id, "anthropic");
        assert_eq!(result[0].model_id, "claude-sonnet-4-6");
    }

    #[test]
    fn test_filter_multiple_ops() {
        let mut conn = create_test_db_for_tests();
        refresh_model_catalog_from_fixture(&mut conn, fixture_json()).unwrap();

        let all = db::read_cached_model_catalog(&conn).unwrap();
        let filters = vec![
            ModelFilter {
                field: "tool_call".to_string(),
                op: "eq".to_string(),
                value: serde_json::Value::Bool(true),
            },
            ModelFilter {
                field: "context_limit".to_string(),
                op: "gte".to_string(),
                value: serde_json::Value::Number(serde_json::Number::from(50000)),
            },
        ];

        let result = model_catalog::filter_models(all, &filters).unwrap();
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].model_id, "claude-sonnet-4-6");
    }
}
