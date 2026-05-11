#![allow(dead_code)]

pub mod client;
pub mod config;
pub mod process;
pub mod types;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tokio::sync::Mutex as AsyncMutex;

use self::process::{LiteLLMProxyHandle, LiteLLMProxyProcess};
use self::types::{CreateUserRequest, GenerateKeyRequest};
use crate::db::Db;

const PROVISIONING_MAX_RETRIES: u32 = 3;
const PROVISIONING_RETRY_DELAY: Duration = Duration::from_secs(1);

struct ManagedLiteLLMProxy {
    handle: LiteLLMProxyHandle,
    process: LiteLLMProxyProcess,
}

type LiteLLMProxyRegistry = AsyncMutex<Option<ManagedLiteLLMProxy>>;

fn proxy_registry() -> &'static LiteLLMProxyRegistry {
    static REGISTRY: OnceLock<LiteLLMProxyRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| AsyncMutex::new(None))
}

pub async fn ensure_litellm_proxy(
    timeout: std::time::Duration,
    app_data_root: &Path,
    db: Db,
) -> Result<LiteLLMProxyHandle, String> {
    let mut registry = proxy_registry().lock().await;

    if let Some(managed) = registry.as_mut() {
        let process_alive = managed.process.is_running();
        let health_result = if process_alive {
            managed.handle.health_check().await
        } else {
            Err("process is not running".to_string())
        };
        if process_alive && health_result.is_ok() {
            return Ok(managed.handle.clone());
        }
        log::warn!("[litellm-proxy] cached proxy failed health check or is not running; restarting");
        let _ = managed.process.shutdown().await;
        *registry = None;
    }

    let master_key = process::read_or_create_master_key(app_data_root)?;
    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        config::write_config(&conn, app_data_root, &master_key)?;
    }

    let process = LiteLLMProxyProcess::start(timeout, app_data_root).await?;
    let handle = LiteLLMProxyHandle {
        port: process.port,
        master_key: process.master_key.clone(),
        stderr_tail: Arc::clone(&process.stderr_tail),
    };
    *registry = Some(ManagedLiteLLMProxy {
        handle: handle.clone(),
        process,
    });

    // Bootstrap shared user and provision virtual keys in a detached task
    let handle_clone = handle.clone();
    let db_clone = db.clone();
    tokio::spawn(async move {
        let mut last_err = None;
        for attempt in 1..=PROVISIONING_MAX_RETRIES {
            match bootstrap_shared_user_and_provision_keys(&handle_clone, &db_clone).await {
                Ok(()) => {
                    log::info!("[litellm-proxy] provisioning completed successfully");
                    return;
                }
                Err(e) => {
                    last_err = Some(e);
                    if attempt < PROVISIONING_MAX_RETRIES {
                        log::warn!(
                            "[litellm-proxy] provisioning attempt {}/{} failed: {}; retrying in {}s",
                            attempt,
                            PROVISIONING_MAX_RETRIES,
                            last_err.as_ref().unwrap(),
                            PROVISIONING_RETRY_DELAY.as_secs()
                        );
                        tokio::time::sleep(PROVISIONING_RETRY_DELAY).await;
                    }
                }
            }
        }
        log::error!(
            "[litellm-proxy] provisioning failed after {} attempts: {}",
            PROVISIONING_MAX_RETRIES,
            last_err.unwrap_or_default()
        );
    });

    Ok(handle)
}

#[allow(dead_code)]
pub async fn try_get_proxy_handle() -> Option<LiteLLMProxyHandle> {
    let registry = proxy_registry().lock().await;
    registry.as_ref().map(|m| m.handle.clone())
}

pub async fn shutdown_litellm_proxy() -> Result<(), String> {
    let mut registry = proxy_registry().lock().await;
    if let Some(mut managed) = registry.take() {
        managed.process.shutdown().await?;
    }
    Ok(())
}

async fn bootstrap_shared_user_and_provision_keys(
    handle: &LiteLLMProxyHandle,
    db: &Db,
) -> Result<(), String> {
    let client = handle.admin_client();

    // Bootstrap shared user (ignore 409 if already exists)
    let user_req = CreateUserRequest {
        user_id: "skill-builder".to_string(),
        max_budget: None,
        budget_duration: None,
        tpm_limit: None,
        rpm_limit: None,
    };
    match client.create_user(&user_req).await {
        Ok(_) => log::info!("[litellm-proxy] created shared user 'skill-builder'"),
        Err(e) if e.contains("409") || e.to_lowercase().contains("already exists") => {
            log::info!("[litellm-proxy] shared user 'skill-builder' already exists");
        }
        Err(e) => return Err(format!("Failed to create shared user: {e}")),
    }

    // Provision virtual keys for profiles without one
    let profiles = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::list_profiles(&conn)?
    };

    for profile in &profiles {
        if profile.virtual_key.is_some() {
            continue;
        }

        let models = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            crate::db::get_profile_models(&conn, &profile.id)?
        };

        let model_names: Vec<String> = models.iter().map(|m| m.model_name.clone()).collect();

        let model_max_budget: std::collections::HashMap<String, f64> = models
            .iter()
            .filter_map(|m| m.budget.map(|b| (m.model_name.clone(), b)))
            .collect();
        let model_max_budget = if model_max_budget.is_empty() {
            None
        } else {
            Some(model_max_budget)
        };

        let max_budget = profile.budget_total.or(profile.budget_monthly);

        let key_req = GenerateKeyRequest {
            user_id: "skill-builder".to_string(),
            models: model_names,
            max_budget,
            budget_duration: profile.budget_monthly.map(|_| "30d".to_string()),
            tpm_limit: profile.tpm_limit.map(|v| v as u64),
            rpm_limit: profile.rpm_limit.map(|v| v as u64),
            model_max_budget,
        };
        let key_resp = client.generate_key(&key_req).await?;

        {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let updated_profile = crate::db::LlmProfile {
                id: profile.id.clone(),
                name: profile.name.clone(),
                budget_monthly: profile.budget_monthly,
                budget_total: profile.budget_total,
                tpm_limit: profile.tpm_limit,
                rpm_limit: profile.rpm_limit,
                virtual_key: Some(key_resp.key.clone()),
                settings_json: profile.settings_json.clone(),
                created_at: profile.created_at,
            };
            crate::db::update_profile(&conn, &updated_profile)?;
        }

        log::info!("[litellm-proxy] provisioned virtual key for profile '{}'", profile.name);
    }

    Ok(())
}
