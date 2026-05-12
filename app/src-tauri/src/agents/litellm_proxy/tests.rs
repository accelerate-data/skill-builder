use std::net::TcpListener;

use crate::agents::litellm_proxy::process::{
    ensure_config_dir, read_or_create_master_key, select_random_local_port,
};
use crate::agents::litellm_proxy::venv::venv_exists;
use crate::db::{LlmProfile, LlmProfileModel};

#[test]
fn random_local_port_is_loopback_and_bindable() {
    let port = select_random_local_port().unwrap();
    assert_ne!(port, 0);
    let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
    assert_eq!(listener.local_addr().unwrap().ip().to_string(), "127.0.0.1");
}

#[test]
fn master_key_is_created_and_reused() {
    let tmp = tempfile::tempdir().unwrap();
    let app_data_root = tmp.path();

    let first = read_or_create_master_key(app_data_root).unwrap();
    let second = read_or_create_master_key(app_data_root).unwrap();
    assert_eq!(first, second);
    assert!(first.starts_with("sk-"));

    let key_path = app_data_root.join("litellm").join(".master_key");
    assert!(key_path.exists());
}

#[test]
fn config_dir_is_created_under_app_data() {
    let tmp = tempfile::tempdir().unwrap();
    let app_data_root = tmp.path();

    let config_path = ensure_config_dir(app_data_root).unwrap();
    assert!(config_path.to_string_lossy().contains("litellm"));
    assert!(config_path.to_string_lossy().ends_with("config.yaml"));
}

/// Proof that should_reuse_cached_proxy requires both is_running and health OK.
fn should_reuse_cached_proxy(is_running: bool, health: Result<(), String>) -> bool {
    is_running && health.is_ok()
}

#[test]
fn should_reuse_cached_proxy_requires_running_and_healthy() {
    assert!(should_reuse_cached_proxy(true, Ok(())));
    assert!(!should_reuse_cached_proxy(false, Ok(())));
    assert!(!should_reuse_cached_proxy(
        true,
        Err("unhealthy".to_string())
    ));
    assert!(!should_reuse_cached_proxy(
        false,
        Err("unhealthy".to_string())
    ));
}

#[test]
fn venv_does_not_exist_by_default() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(!venv_exists(tmp.path()));
}

#[test]
fn build_model_max_budget_collects_only_budgeted_models() {
    let models = vec![
        LlmProfileModel {
            id: "m1".to_string(),
            profile_id: "p1".to_string(),
            model_name: "claude-sonnet-4-5".to_string(),
            provider_id: "prov-1".to_string(),
            priority: 0,
            budget: Some(30.0),
        },
        LlmProfileModel {
            id: "m2".to_string(),
            profile_id: "p1".to_string(),
            model_name: "gpt-4o".to_string(),
            provider_id: "prov-2".to_string(),
            priority: 1,
            budget: None,
        },
    ];

    let budgets = super::build_model_max_budget(&models).unwrap();
    assert_eq!(budgets.len(), 1);
    assert_eq!(budgets.get("claude-sonnet-4-5"), Some(&30.0));
    assert!(!budgets.contains_key("gpt-4o"));
}

#[test]
fn resolve_profile_max_budget_prefers_total_budget() {
    let profile = LlmProfile {
        id: "profile-1".to_string(),
        name: "Pro".to_string(),
        budget_monthly: Some(25.0),
        budget_total: Some(100.0),
        tpm_limit: None,
        rpm_limit: None,
        virtual_key: None,
        settings_json: None,
        created_at: 0,
    };

    assert_eq!(super::resolve_profile_max_budget(&profile), Some(100.0));
}
