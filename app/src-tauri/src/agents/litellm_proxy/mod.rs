pub mod client;
pub mod process;
pub mod types;

use std::path::Path;
use std::sync::OnceLock;
use tokio::sync::Mutex as AsyncMutex;

use self::process::{LiteLLMProxyHandle, ensure_proxy as ensure_proxy_process};

type LiteLLMProxyRegistry = AsyncMutex<Option<ManagedLiteLLMProxy>>;

struct ManagedLiteLLMProxy {
    handle: LiteLLMProxyHandle,
}

fn proxy_registry() -> &'static LiteLLMProxyRegistry {
    static REGISTRY: OnceLock<LiteLLMProxyRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| AsyncMutex::new(None))
}

pub async fn ensure_litellm_proxy(
    timeout: std::time::Duration,
    app_data_root: &Path,
) -> Result<LiteLLMProxyHandle, String> {
    let mut registry = proxy_registry().lock().await;
    if let Some(server) = registry.as_mut() {
        let health = server.handle.health_check().await;
        if health.is_ok() {
            return Ok(server.handle.clone());
        }
        log::warn!("[litellm-proxy] cached proxy failed health check; restarting");
        let _ = server.handle.shutdown().await;
        *registry = None;
    }

    let handle = ensure_proxy_process(timeout, app_data_root).await?;
    *registry = Some(ManagedLiteLLMProxy {
        handle: handle.clone(),
    });
    Ok(handle)
}

pub async fn try_get_proxy_handle() -> Option<LiteLLMProxyHandle> {
    let registry = proxy_registry().lock().await;
    registry.as_ref().map(|s| s.handle.clone())
}

pub async fn shutdown_litellm_proxy() -> Result<(), String> {
    let mut registry = proxy_registry().lock().await;
    if let Some(server) = registry.take() {
        server.handle.shutdown().await?;
    }
    Ok(())
}
