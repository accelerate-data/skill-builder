use std::path::Path;
use rusqlite::Connection;
use serde::Serialize;

use crate::db::{list_providers, list_profiles, get_profile_models};
use crate::agents::litellm_proxy::process::litellm_db_url;

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct LiteLLMConfig {
    model_list: Vec<ModelEntry>,
    fallbacks: Vec<Vec<String>>,
    general_settings: GeneralSettings,
    litellm_settings: LiteLLMSettings,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct ModelEntry {
    model_name: String,
    litellm_params: LiteLLMParams,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct LiteLLMParams {
    model: String,
    api_key: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct GeneralSettings {
    master_key: String,
    database_url: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
struct LiteLLMSettings {
    max_budget: i32,
}

pub fn generate_config(
    conn: &Connection,
    app_data_root: &Path,
    master_key: &str,
) -> Result<String, String> {
    let providers = list_providers(conn)?;
    let profiles = list_profiles(conn)?;

    let mut model_list = Vec::new();
    let mut fallback_groups: Vec<Vec<String>> = Vec::new();

    for profile in &profiles {
        let models = get_profile_models(conn, &profile.id)?;
        let mut group = Vec::new();
        for pm in &models {
            let provider = providers.iter().find(|p| p.id == pm.provider_id);
            if let Some(provider) = provider {
                let full_model = if pm.model_name.contains('/') {
                    pm.model_name.clone()
                } else {
                    format!("{}/{}", provider.name, pm.model_name)
                };
                model_list.push(ModelEntry {
                    model_name: pm.model_name.clone(),
                    litellm_params: LiteLLMParams {
                        model: full_model.clone(),
                        api_key: provider.api_key.expose().to_string(),
                    },
                });
                group.push(pm.model_name.clone());
            }
        }
        if group.len() > 1 {
            fallback_groups.push(group);
        }
    }

    let config = LiteLLMConfig {
        model_list,
        fallbacks: fallback_groups,
        general_settings: GeneralSettings {
            master_key: master_key.to_string(),
            database_url: litellm_db_url(app_data_root),
        },
        litellm_settings: LiteLLMSettings { max_budget: 0 }, // 0 = unlimited (no global budget cap)
    };

    serde_yaml::to_string(&config).map_err(|e| format!("Failed to serialize config: {e}"))
}

pub fn write_config(
    conn: &Connection,
    app_data_root: &Path,
    master_key: &str,
) -> Result<(), String> {
    let config_yaml = generate_config(conn, app_data_root, master_key)?;
    let config_path = app_data_root.join("litellm").join("config.yaml");
    std::fs::write(&config_path, config_yaml)
        .map_err(|e| format!("Failed to write config.yaml: {e}"))
}
