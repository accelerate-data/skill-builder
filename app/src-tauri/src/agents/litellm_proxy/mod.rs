#![allow(dead_code)]

pub mod client;
pub mod process;
pub mod types;

#[cfg(test)]
mod tests;

use std::path::Path;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex as AsyncMutex;

use self::process::{LiteLLMProxyHandle, LiteLLMProxyProcess};

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
) -> Result<LiteLLMProxyHandle, String> {
    let mut registry = proxy_registry().lock().await;
    if let Some(managed) = registry.as_mut() {
        let health = managed.handle.health_check().await;
        if health.is_ok() {
            return Ok(managed.handle.clone());
        }
        log::warn!("[litellm-proxy] cached proxy failed health check; restarting");
        let _ = managed.process.shutdown().await;
        *registry = None;
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
    Ok(handle)
}

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
