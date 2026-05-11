use std::net::TcpListener;

use crate::agents::litellm_proxy::process::{
    ensure_config_dir, read_or_create_master_key, select_random_local_port,
};

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
