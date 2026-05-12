# LiteLLM Proxy Sidecar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-provider model settings with a Rust-managed LiteLLM proxy sidecar for provider routing, budget enforcement, and spend tracking.

**Architecture:** Rust spawns and manages a LiteLLM proxy process on app launch (async, non-blocking). The proxy reads a generated config.yaml containing provider API keys and model routing rules. OpenHands points to the proxy instead of direct provider endpoints. Usage tracking moves from app SQLite to LiteLLM's own SQLite DB.

**Tech Stack:** Rust (Tauri), SQLite (rusqlite), Tokio, LiteLLM proxy (uvx), React/TypeScript (frontend), shadcn/ui

---

## PR Decomposition

| PR | Title | Scope | Depends On |
|---|---|---|---|
| 1 | `feat: LiteLLM proxy process management` | Rust spawns/manages proxy, health check, shutdown, master key, port selection | None |
| 2 | `feat: provider/profile DB schema + config generation` | New SQLite tables, CRUD commands, config.yaml generation | PR 1 |
| 3 | `feat: virtual key management + profile activation` | Create LiteLLM users/keys, bind profiles to virtual keys | PR 2 |
| 3a | `fix: persistent venv for LiteLLM + Prisma` | Replace `uvx` with persistent venv, bootstrap Prisma, update spawn command | PR 1 |
| 4 | `feat: OpenHands runtime config → proxy routing` | Change OpenHands to use proxy URL + virtual key | PR 3, PR 3a |
| 5 | `feat: Providers settings page` | Frontend UI for managing providers | PR 2 |
| 6 | `feat: Models settings page` | Frontend UI for profiles, budgets, virtual keys | PR 3, PR 5 |
| 7 | `feat: usage migration to LiteLLM` | Drop agent_runs, new LiteLLM-backed usage commands + UI | PR 3 |

---

## File Map

### PR 1: Proxy Process Management
| File | Action |
|---|---|
| `app/src-tauri/src/agents/litellm_proxy/mod.rs` | Create — module root, registry, public API ✅ |
| `app/src-tauri/src/agents/litellm_proxy/process.rs` | Create — spawn, health check, shutdown, port selection, master key ✅ |
| `app/src-tauri/src/agents/litellm_proxy/client.rs` | Create — HTTP client for LiteLLM admin API ✅ |
| `app/src-tauri/src/agents/litellm_proxy/types.rs` | Create — request/response types for admin API ✅ |
| `app/src-tauri/src/agents/mod.rs` | Modify — add `pub mod litellm_proxy` ✅ |
| `app/src-tauri/src/lib.rs` | Modify — add proxy startup in Tauri setup hook ✅ |
| `app/src-tauri/src/agents/litellm_proxy/tests.rs` | Create — unit tests for port selection, redaction, config path ✅ |

### PR 2: Provider/Profile DB + Config Generation
| File | Action |
|---|---|
| `app/src-tauri/src/db/litellm_providers.rs` | Create — CRUD for llm_providers table |
| `app/src-tauri/src/db/litellm_profiles.rs` | Create — CRUD for llm_profiles + llm_profile_models tables |
| `app/src-tauri/src/db/mod.rs` | Modify — add new modules, re-exports |
| `app/src-tauri/src/db/migrations.rs` | Modify — add migration for new tables + drop agent_runs |
| `app/src-tauri/src/types/litellm.rs` | Create — Rust types for providers, profiles, config generation |
| `app/src-tauri/src/commands/litellm_providers.rs` | Create — Tauri commands for provider CRUD |
| `app/src-tauri/src/commands/litellm_profiles.rs` | Create — Tauri commands for profile CRUD |
| `app/src-tauri/src/commands/mod.rs` | Modify — add new command modules |
| `app/src-tauri/src/agents/litellm_proxy/config.rs` | Create — config.yaml generation from DB data |
| `app/src-tauri/src/agents/litellm_proxy/mod.rs` | Modify — integrate config generation into startup |
| `app/src-tauri/src/lib.rs` | Modify — register new Tauri commands |
| `app/src-tauri/src/db/tests.rs` | Modify — add tests for new tables |

### PR 3: Virtual Key Management
| File | Action |
|---|---|
| `app/src-tauri/src/agents/litellm_proxy/types.rs` | Modify — remove `deny_unknown_fields`, add `model_max_budget` to `GenerateKeyRequest` |
| `app/src-tauri/src/agents/litellm_proxy/client.rs` | Modify — revert `urlencoding` in `key_info` |
| `app/src-tauri/src/agents/litellm_proxy/mod.rs` | Modify — single shared user bootstrap, detached provisioning, per-model budgets |
| `app/src-tauri/src/commands/litellm_profiles.rs` | Modify — add `verify_profile_virtual_key` command (replaces `test_profile_connection`) |
| `app/src-tauri/src/db/litellm_profiles.rs` | Modify — drop `litellm_user_id`, add `budget` to `LlmProfileModel` |
| `app/src-tauri/src/db/migrations.rs` | Modify — drop `litellm_user_id` column, add `budget` column |
| `app/src-tauri/Cargo.toml` | Modify — remove `urlencoding` dependency |
| `app/src-tauri/src/lib.rs` | Modify — register `verify_profile_virtual_key` |
| `docs/design/litellm-integration/README.md` | Modify — rename from model-settings, update startup flow, schema |
| `docs/design/litellm-integration/budgets.md` | Create — LiteLLM budget hierarchy and Skill Builder usage |

### PR 4: OpenHands → Proxy Routing
| File | Action |
|---|---|
| `app/src-tauri/src/agents/runtime_config.rs` | Modify — add `litellm_proxy_port` and `litellm_virtual_key` fields |
| `app/src-tauri/src/agents/openhands_server/mod.rs` | Modify — ensure LiteLLM proxy is ready before OpenHands starts |
| `app/src-tauri/src/types/settings.rs` | Modify — add `profile_id` to ModelSettings, remove `api_key`/`base_url`/`provider` |
| `app/src-tauri/src/commands/settings.rs` | Modify — update diff/persist for new settings shape |
| `app/src-tauri/src/commands/workflow/runtime.rs` | Modify — pass proxy URL + virtual key to OpenHands config |
| `app/src/lib/types.ts` | Modify — update ModelSettings TypeScript type |
| `app/src-tauri/src/agents/runtime_config.rs` (tests) | Modify — update tests for new config shape |
| `app/src-tauri/src/agents/litellm_proxy/process.rs` | Modify — spawn uses venv python path (from PR 3a) |

### PR 5: Providers Frontend Page
| File | Action |
|---|---|
| `app/src/pages/settings/providers-page.tsx` | Create — Providers page |
| `app/src/components/settings/providers/provider-list.tsx` | Create — provider list table |
| `app/src/components/settings/providers/provider-dialog.tsx` | Create — add/edit provider dialog |
| `app/src/components/settings/providers/provider-test-indicator.tsx` | Create — test connection indicator |
| `app/src/lib/queries/litellm.ts` | Create — TanStack Query hooks for provider/profile commands |
| `app/src/lib/tauri-command-types.ts` | Modify — add new Tauri command types |
| `app/src/router.tsx` | Modify — add `/settings/providers` route |
| `app/src/__tests__/pages/settings/providers-page.test.tsx` | Create — page tests |
| `app/src/__tests__/components/settings/providers/provider-list.test.tsx` | Create — component tests |

### PR 6: Models Frontend Page
| File | Action |
|---|---|
| `app/src/pages/settings/models-page.tsx` | Create — Models page |
| `app/src/components/settings/models/profile-list.tsx` | Create — profile cards |
| `app/src/components/settings/models/profile-editor.tsx` | Create — profile editor with model selection, fallback ordering |
| `app/src/components/settings/models/virtual-key-display.tsx` | Create — masked key display |
| `app/src/components/settings/models/profile-test-modal.tsx` | Create — test modal |
| `app/src/components/settings/models/spend-indicator.tsx` | Create — progress bar vs budget |
| `app/src/lib/queries/litellm.ts` | Modify — add profile-related query hooks |
| `app/src/lib/tauri-command-types.ts` | Modify — add profile command types |
| `app/src/router.tsx` | Modify — add `/settings/models` route |
| `app/src/__tests__/pages/settings/models-page.test.tsx` | Create — page tests |

### PR 7: Usage Migration
| File | Action |
|---|---|
| `app/src-tauri/src/commands/litellm_usage.rs` | Create — new Tauri commands proxying LiteLLM spend APIs |
| `app/src-tauri/src/commands/mod.rs` | Modify — remove `usage`, add `litellm_usage` |
| `app/src-tauri/src/commands/usage.rs` | Delete |
| `app/src-tauri/src/db/usage.rs` | Delete |
| `app/src-tauri/src/db/mod.rs` | Modify — remove `usage` module |
| `app/src-tauri/src/db/migrations.rs` | Modify — add migration to drop agent_runs table |
| `app/src-tauri/src/types/usage.rs` | Modify — remove old types, add LiteLLM spend types |
| `app/src-tauri/src/types/mod.rs` | Modify — update re-exports |
| `app/src-tauri/src/lib.rs` | Modify — replace old usage commands with new ones |
| `app/src/lib/queries/usage.ts` | Modify — replace with LiteLLM-backed queries |
| `app/src/stores/usage-store.ts` | Delete |
| `app/src/components/settings/usage-section.tsx` | Modify — replace with new LiteLLM-backed UI |
| `app/src/pages/settings/usage-page.tsx` | Create — new usage page |
| `app/src/__tests__/commands/litellm_usage.test.ts` | Create — Rust command tests |

---

## PR 1: LiteLLM Proxy Process Management

**Goal:** Rust can spawn, health-check, and shutdown a LiteLLM proxy process. No DB changes, no UI.

### Task 1: Create module structure

**Files:**
- Create: `app/src-tauri/src/agents/litellm_proxy/mod.rs`
- Create: `app/src-tauri/src/agents/litellm_proxy/process.rs`
- Create: `app/src-tauri/src/agents/litellm_proxy/client.rs`
- Create: `app/src-tauri/src/agents/litellm_proxy/types.rs`
- Modify: `app/src-tauri/src/agents/mod.rs`

- [x] **Step 1: Create mod.rs**

```rust
pub mod client;
pub mod process;
pub mod types;

use std::path::Path;
use std::sync::{Arc, OnceLock};
use tokio::sync::Mutex as AsyncMutex;

use self::process::{LiteLLMProxyHandle, ensure_proxy as ensure_proxy_process};

/// Static registry for the LiteLLM proxy process.
/// Same pattern as OpenHandsAgentServerRegistry.
type LiteLLMProxyRegistry = AsyncMutex<Option<ManagedLiteLLMProxy>>;

struct ManagedLiteLLMProxy {
    handle: LiteLLMProxyHandle,
}

fn proxy_registry() -> &'static LiteLLMProxyRegistry {
    static REGISTRY: OnceLock<LiteLLMProxyRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| AsyncMutex::new(None))
}

/// Ensure the LiteLLM proxy is running. Starts it if not.
/// Called asynchronously during app startup.
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

/// Best-effort: return cached handle if proxy is running.
/// Does NOT start a new proxy.
pub async fn try_get_proxy_handle() -> Option<LiteLLMProxyHandle> {
    let registry = proxy_registry().lock().await;
    registry.as_ref().map(|s| s.handle.clone())
}

/// Shutdown the LiteLLM proxy process.
pub async fn shutdown_litellm_proxy() -> Result<(), String> {
    let mut registry = proxy_registry().lock().await;
    if let Some(mut server) = registry.take() {
        server.handle.shutdown().await?;
    }
    Ok(())
}
```

- [x] **Step 2: Create types.rs**

```rust
use serde::{Deserialize, Serialize};

/// Response from LiteLLM /health endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

/// Response from LiteLLM /user/new endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct CreateUserResponse {
    pub user_id: String,
}

/// Response from LiteLLM /key/generate endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct GenerateKeyResponse {
    pub key: String,
}

/// Response from LiteLLM /key/info endpoint
#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfoResponse {
    pub key: String,
    pub info: KeyInfo,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfo {
    pub spend: f64,
    pub models: Vec<String>,
}

/// Request body for /user/new
#[derive(Debug, Clone, Serialize)]
pub struct CreateUserRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_budget: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm_limit: Option<u64>,
}

/// Request body for /key/generate
#[derive(Debug, Clone, Serialize)]
pub struct GenerateKeyRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_budget: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm_limit: Option<u64>,
}
```

- [x] **Step 3: Create client.rs**

```rust
use reqwest::Client;
use url::Url;

use crate::agents::litellm_proxy::types::{
    CreateUserRequest, CreateUserResponse, GenerateKeyRequest, GenerateKeyResponse,
    HealthResponse, KeyInfoResponse,
};

pub struct LiteLLMAdminClient {
    client: Client,
    base_url: Url,
    master_key: String,
}

impl LiteLLMAdminClient {
    pub fn new(base_url: Url, master_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            master_key,
        }
    }

    pub async fn health_check(&self) -> Result<HealthResponse, String> {
        let url = self.base_url.join("/health").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("LiteLLM health check failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("LiteLLM health check returned {}", resp.status()));
        }
        resp.json::<HealthResponse>()
            .await
            .map_err(|e| format!("Failed to parse health response: {e}"))
    }

    pub async fn create_user(&self, req: &CreateUserRequest) -> Result<CreateUserResponse, String> {
        let url = self.base_url.join("/user/new").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .json(req)
            .send()
            .await
            .map_err(|e| format!("LiteLLM create user failed: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM create user returned {}: {}", resp.status(), body));
        }
        resp.json::<CreateUserResponse>()
            .await
            .map_err(|e| format!("Failed to parse create user response: {e}"))
    }

    pub async fn generate_key(&self, req: &GenerateKeyRequest) -> Result<GenerateKeyResponse, String> {
        let url = self.base_url.join("/key/generate").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .json(req)
            .send()
            .await
            .map_err(|e| format!("LiteLLM generate key failed: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM generate key returned {}: {}", resp.status(), body));
        }
        resp.json::<GenerateKeyResponse>()
            .await
            .map_err(|e| format!("Failed to parse generate key response: {e}"))
    }

    pub async fn key_info(&self, key: &str) -> Result<KeyInfoResponse, String> {
        let url = self.base_url
            .join(&format!("/key/info?key={}", key))
            .map_err(|e| e.to_string())?;
        let resp = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .send()
            .await
            .map_err(|e| format!("LiteLLM key info failed: {e}"))?;
        if !resp.status().is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM key info returned {}: {}", resp.status(), body));
        }
        resp.json::<KeyInfoResponse>()
            .await
            .map_err(|e| format!("Failed to parse key info response: {e}"))
    }
}
```

- [x] **Step 4: Create process.rs**

```rust
#[cfg(unix)]
use nix::sys::signal::{kill, Signal};
#[cfg(unix)]
use nix::unistd::Pid;
use std::collections::VecDeque;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Mutex as AsyncMutex;

use crate::agents::litellm_proxy::client::LiteLLMAdminClient;

const SHUTDOWN_WAIT_TIMEOUT: Duration = Duration::from_secs(5);
const STDERR_TAIL_MAX_LINES: usize = 200;
const MASTER_KEY_FILENAME: &str = ".master_key";

#[derive(Debug, Clone)]
pub struct LiteLLMProxyHandle {
    pub port: u16,
    pub master_key: String,
    pub stderr_tail: Arc<AsyncMutex<VecDeque<String>>>,
}

impl LiteLLMProxyHandle {
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn admin_client(&self) -> LiteLLMAdminClient {
        use url::Url;
        LiteLLMAdminClient::new(
            Url::parse(&self.base_url()).expect("invalid base URL"),
            self.master_key.clone(),
        )
    }

    pub async fn health_check(&self) -> Result<(), String> {
        let client = reqwest::Client::new();
        let url = format!("{}/health", self.base_url());
        let resp = client
            .get(&url)
            .timeout(Duration::from_secs(2))
            .send()
            .await
            .map_err(|e| format!("LiteLLM health check failed: {e}"))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("LiteLLM health check returned {}", resp.status()))
        }
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        // Shutdown is handled by the process manager; this is a no-op for the handle.
        // The actual SIGTERM is sent by LiteLLMProxyProcess::shutdown.
        Ok(())
    }
}

pub struct LiteLLMProxyProcess {
    pub port: u16,
    pub master_key: String,
    pub stderr_tail: Arc<AsyncMutex<VecDeque<String>>>,
    _child: tokio::process::Child,
}

impl LiteLLMProxyProcess {
    pub async fn start(timeout: Duration, app_data_root: &Path) -> Result<Self, String> {
        let port = select_random_local_port()?;
        let master_key = read_or_create_master_key(app_data_root)?;
        let config_path = ensure_config_dir(app_data_root)?;

        let mut child = spawn_proxy(port, &master_key, &config_path)
            .map_err(|e| format!("Failed to spawn LiteLLM proxy: {e}"))?;

        let stderr_tail = Arc::new(AsyncMutex::new(VecDeque::with_capacity(STDERR_TAIL_MAX_LINES)));
        if let Some(stderr) = child.stderr.take() {
            let tail = Arc::clone(&stderr_tail);
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    if !line.trim().is_empty() {
                        let mut guard = tail.lock().await;
                        if guard.len() == STDERR_TAIL_MAX_LINES {
                            guard.pop_front();
                        }
                        guard.push_back(line);
                    }
                }
            });
        }

        let mut process = Self {
            port,
            master_key,
            stderr_tail,
            _child: child,
        };

        if let Err(error) = process.wait_until_healthy(timeout).await {
            let _ = process.shutdown().await;
            return Err(error);
        }

        Ok(process)
    }

    pub async fn wait_until_healthy(&self, timeout: Duration) -> Result<(), String> {
        let client = reqwest::Client::new();
        let deadline = Instant::now() + timeout;
        loop {
            let url = format!("http://127.0.0.1:{}/health", self.port);
            if let Ok(resp) = client.get(&url).timeout(Duration::from_secs(1)).send().await {
                if resp.status().is_success() {
                    return Ok(());
                }
            }
            if Instant::now() >= deadline {
                return Err(format!("Timed out waiting for LiteLLM proxy health on port {}", self.port));
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    pub async fn shutdown(&mut self) -> Result<(), String> {
        if let Ok(Some(_)) = self._child.try_wait() {
            return Ok(());
        }
        #[cfg(unix)]
        if let Some(pid) = self._child.id() {
            let process_group = -(pid as i32);
            log::info!("[litellm-proxy] shutting down process group {} with SIGTERM", process_group);
            kill(Pid::from_raw(process_group), Signal::SIGTERM)
                .map_err(|e| format!("Failed to signal LiteLLM proxy: {e}"))?;
            let deadline = Instant::now() + SHUTDOWN_WAIT_TIMEOUT;
            loop {
                if let Ok(Some(_)) = self._child.try_wait() {
                    return Ok(());
                }
                if Instant::now() >= deadline {
                    log::warn!("[litellm-proxy] process did not exit after SIGTERM; forcing kill");
                    kill(Pid::from_raw(process_group), Signal::SIGKILL)
                        .map_err(|e| format!("Failed to force-kill LiteLLM proxy: {e}"))?;
                    let _ = self._child.wait().await;
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }
        self._child
            .start_kill()
            .map_err(|e| format!("Failed to stop LiteLLM proxy: {e}"))?;
        let _ = self._child.wait().await;
        Ok(())
    }
}

fn spawn_proxy(
    port: u16,
    master_key: &str,
    config_path: &Path,
) -> Result<tokio::process::Child, String> {
    let mut cmd = tokio::process::Command::new("uvx");
    cmd.args([
        "litellm[proxy]",
        "--config",
        &config_path.to_string_lossy(),
        "--port",
        &port.to_string(),
    ])
    .env("LITELLM_MASTER_KEY", master_key)
    .env("LITELLM_DATABASE_URL", &format!("sqlite:///{}/litellm.db", config_path.parent().unwrap().to_string_lossy()))
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            "Python uv tool is required. Install uv from https://docs.astral.sh/uv/".to_string()
        } else {
            format!("Failed to spawn uvx: {e}")
        }
    })
}

pub async fn ensure_proxy(
    timeout: Duration,
    app_data_root: &Path,
) -> Result<LiteLLMProxyHandle, String> {
    let process = LiteLLMProxyProcess::start(timeout, app_data_root).await?;
    Ok(LiteLLMProxyHandle {
        port: process.port,
        master_key: process.master_key,
        stderr_tail: process.stderr_tail,
    })
}

fn select_random_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to reserve local LiteLLM proxy port: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("Failed to read local LiteLLM proxy port: {e}"))
}

fn read_or_create_master_key(app_data_root: &Path) -> Result<String, String> {
    let litellm_dir = app_data_root.join("litellm");
    fs::create_dir_all(&litellm_dir).map_err(|e| {
        format!("Failed to create litellm directory: {e}")
    })?;
    let key_path = litellm_dir.join(MASTER_KEY_FILENAME);

    if let Ok(existing) = fs::read_to_string(&key_path) {
        let trimmed = existing.trim().to_string();
        if !trimmed.is_empty() {
            return Ok(trimmed);
        }
    }

    let key = format!("sk-{}", uuid::Uuid::new_v4().simple());
    fs::write(&key_path, format!("{key}\n")).map_err(|e| {
        format!("Failed to write master key: {e}")
    })?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&key_path, fs::Permissions::from_mode(0o600));
    }
    Ok(key)
}

fn ensure_config_dir(app_data_root: &Path) -> Result<PathBuf, String> {
    let litellm_dir = app_data_root.join("litellm");
    fs::create_dir_all(&litellm_dir).map_err(|e| {
        format!("Failed to create litellm directory: {e}")
    })?;
    Ok(litellm_dir.join("config.yaml"))
}
```

- [x] **Step 5: Update agents/mod.rs**

```rust
// Add to existing agents/mod.rs:
pub mod litellm_proxy;
```

- [x] **Step 6: Add Cargo.toml dependency for `url` crate**

Check if `url` is already in `app/src-tauri/Cargo.toml`. If not, add:

```toml
url = "2"
```

- [x] **Step 7: Write tests**

Create `app/src-tauri/src/agents/litellm_proxy/tests.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::agents::litellm_proxy::process::select_random_local_port;

    #[test]
    fn random_local_port_is_loopback_and_bindable() {
        let port = select_random_local_port().unwrap();
        assert_ne!(port, 0);
        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
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
}
```

- [x] **Step 8: Run tests**

```bash
cd app/src-tauri && cargo test litellm_proxy -- --nocapture
```

Expected: All 3 tests pass.

- [x] **Step 9: Commit**

```bash
git add app/src-tauri/src/agents/litellm_proxy/ app/src-tauri/src/agents/mod.rs app/src-tauri/Cargo.toml
git commit -m "feat: LiteLLM proxy process management (spawn, health, shutdown)"
```

### Manual smoke test for PR 1

- [x] Run `cd app && LITELLM_PROXY_LIVE_SMOKE=1 npm run test:litellm:live-smoke`
- [ ] Verify PASS output; test covers spawn → health → admin API auth → shutdown

---

## PR 2: Provider/Profile DB Schema + Config Generation

**Goal:** SQLite tables for providers and profiles, CRUD Tauri commands, config.yaml generation from DB data.

### Task 1: Add DB migration

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`

- [x] **Step 1: Add migration for new tables**

In `NUMBERED_MIGRATIONS`, add the next migration number (check current highest):

```rust
// Add to NUMBERED_MIGRATIONS:
(next_num, |conn: &Connection| -> Result<(), rusqlite::Error> {
    // llm_providers table
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS llm_providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            api_key TEXT NOT NULL,
            base_url TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            created_at INTEGER NOT NULL
        );
    "#)?;

    // llm_profiles table
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS llm_profiles (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            budget_monthly REAL,
            budget_total REAL,
            tpm_limit INTEGER,
            rpm_limit INTEGER,
            virtual_key TEXT,
            litellm_user_id TEXT,
            created_at INTEGER NOT NULL
        );
    "#)?;

    // llm_profile_models table
    conn.execute_batch(r#"
        CREATE TABLE IF NOT EXISTS llm_profile_models (
            id TEXT PRIMARY KEY,
            profile_id TEXT NOT NULL,
            model_name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            priority INTEGER NOT NULL,
            FOREIGN KEY (profile_id) REFERENCES llm_profiles(id),
            FOREIGN KEY (provider_id) REFERENCES llm_providers(id)
        );
    "#)?;

    Ok(())
}),
```

### Task 2: Create DB query modules

**Files:**
- Create: `app/src-tauri/src/db/litellm_providers.rs`
- Create: `app/src-tauri/src/db/litellm_profiles.rs`
- Modify: `app/src-tauri/src/db/mod.rs`

- [x] **Step 2: Create litellm_providers.rs**

```rust
use rusqlite::Connection;
use crate::types::SecretString;

#[derive(Debug, Clone)]
pub struct LlmProvider {
    pub id: String,
    pub name: String,
    pub api_key: SecretString,
    pub base_url: Option<String>,
    pub enabled: bool,
    pub created_at: i64,
}

pub fn insert_provider(conn: &Connection, provider: &LlmProvider) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_providers (id, name, api_key, base_url, enabled, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        rusqlite::params![
            provider.id,
            provider.name,
            provider.api_key.expose(),
            provider.base_url,
            provider.enabled as i32,
            provider.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_provider(conn: &Connection, provider: &LlmProvider) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_providers SET name = ?2, api_key = ?3, base_url = ?4, enabled = ?5
         WHERE id = ?1",
        rusqlite::params![
            provider.id,
            provider.name,
            provider.api_key.expose(),
            provider.base_url,
            provider.enabled as i32,
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
        "SELECT id, name, api_key, base_url, enabled, created_at FROM llm_providers ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            api_key: SecretString::new(row.get(2)?),
            base_url: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn get_provider(conn: &Connection, id: &str) -> Result<Option<LlmProvider>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, api_key, base_url, enabled, created_at FROM llm_providers WHERE id = ?1"
    ).map_err(|e| e.to_string())?;
    stmt.query_row(rusqlite::params![id], |row| {
        Ok(LlmProvider {
            id: row.get(0)?,
            name: row.get(1)?,
            api_key: SecretString::new(row.get(2)?),
            base_url: row.get(3)?,
            enabled: row.get::<_, i32>(4)? != 0,
            created_at: row.get(5)?,
        })
    }).optional().map_err(|e| e.to_string())
}
```

- [x] **Step 3: Create litellm_profiles.rs**

```rust
use rusqlite::Connection;

#[derive(Debug, Clone)]
pub struct LlmProfile {
    pub id: String,
    pub name: String,
    pub budget_monthly: Option<f64>,
    pub budget_total: Option<f64>,
    pub tpm_limit: Option<i64>,
    pub rpm_limit: Option<i64>,
    pub virtual_key: Option<String>,
    pub litellm_user_id: Option<String>,
    pub created_at: i64,
}

#[derive(Debug, Clone)]
pub struct LlmProfileModel {
    pub id: String,
    pub profile_id: String,
    pub model_name: String,
    pub provider_id: String,
    pub priority: i32,
}

pub fn insert_profile(conn: &Connection, profile: &LlmProfile) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_profiles (id, name, budget_monthly, budget_total, tpm_limit, rpm_limit, virtual_key, litellm_user_id, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            profile.id, profile.name, profile.budget_monthly, profile.budget_total,
            profile.tpm_limit, profile.rpm_limit, profile.virtual_key,
            profile.litellm_user_id, profile.created_at,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_profile(conn: &Connection, profile: &LlmProfile) -> Result<(), String> {
    conn.execute(
        "UPDATE llm_profiles SET name = ?2, budget_monthly = ?3, budget_total = ?4,
         tpm_limit = ?5, rpm_limit = ?6, virtual_key = ?7, litellm_user_id = ?8
         WHERE id = ?1",
        rusqlite::params![
            profile.id, profile.name, profile.budget_monthly, profile.budget_total,
            profile.tpm_limit, profile.rpm_limit, profile.virtual_key,
            profile.litellm_user_id,
        ],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_profile(conn: &Connection, id: &str) -> Result<(), String> {
    conn.execute("DELETE FROM llm_profile_models WHERE profile_id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM llm_profiles WHERE id = ?1", rusqlite::params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_profiles(conn: &Connection) -> Result<Vec<LlmProfile>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, name, budget_monthly, budget_total, tpm_limit, rpm_limit, virtual_key, litellm_user_id, created_at
         FROM llm_profiles ORDER BY name"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([], |row| {
        Ok(LlmProfile {
            id: row.get(0)?, name: row.get(1)?, budget_monthly: row.get(2)?,
            budget_total: row.get(3)?, tpm_limit: row.get(4)?, rpm_limit: row.get(5)?,
            virtual_key: row.get(6)?, litellm_user_id: row.get(7)?, created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn insert_profile_model(conn: &Connection, model: &LlmProfileModel) -> Result<(), String> {
    conn.execute(
        "INSERT INTO llm_profile_models (id, profile_id, model_name, provider_id, priority)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![model.id, model.profile_id, model.model_name, model.provider_id, model.priority],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_profile_models(conn: &Connection, profile_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM llm_profile_models WHERE profile_id = ?1",
        rusqlite::params![profile_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_profile_models(conn: &Connection, profile_id: &str) -> Result<Vec<LlmProfileModel>, String> {
    let mut stmt = conn.prepare(
        "SELECT id, profile_id, model_name, provider_id, priority FROM llm_profile_models
         WHERE profile_id = ?1 ORDER BY priority"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map(rusqlite::params![profile_id], |row| {
        Ok(LlmProfileModel {
            id: row.get(0)?, profile_id: row.get(1)?, model_name: row.get(2)?,
            provider_id: row.get(3)?, priority: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}
```

- [x] **Step 4: Update db/mod.rs**

```rust
// Add to module declarations:
pub mod litellm_providers;
pub mod litellm_profiles;

// Add to re-exports:
pub use litellm_providers::*;
pub use litellm_profiles::*;
```

### Task 3: Create config generation

**Files:**
- Create: `app/src-tauri/src/agents/litellm_proxy/config.rs`

- [x] **Step 5: Create config.rs**

```rust
use std::path::Path;
use rusqlite::Connection;
use serde::Serialize;

use crate::db::{list_providers, list_profiles, get_profile_models};

#[derive(Serialize)]
struct LiteLLMConfig {
    model_list: Vec<ModelEntry>,
    fallbacks: Vec<Vec<String>>,
    general_settings: GeneralSettings,
    litellm_settings: LiteLLMSettings,
}

#[derive(Serialize)]
struct ModelEntry {
    model_name: String,
    litellm_params: LiteLLMParams,
}

#[derive(Serialize)]
struct LiteLLMParams {
    model: String,
    api_key: String,
}

#[derive(Serialize)]
struct GeneralSettings {
    master_key: String,
    database_url: String,
}

#[derive(Serialize)]
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
                // Build model_name from provider prefix + model
                // NOTE: After PR 5 ships, use provider.litellm_provider_prefix instead of provider.name
                // to build the LiteLLM-compatible model name (e.g., "anthropic/claude-sonnet").
                let prefix = provider.litellm_provider_prefix.as_deref().unwrap_or(&provider.name);
                let full_model = if pm.model_name.contains('/') {
                    pm.model_name.clone()
                } else {
                    format!("{}/{}", prefix, pm.model_name)
                };
                model_list.push(ModelEntry {
                    model_name: pm.model_name.clone(),
                    litellm_params: LiteLLMParams {
                        model: full_model.clone(),
                        api_key: provider.api_key.expose().clone(),
                    },
                });
                group.push(pm.model_name.clone());
            }
        }
        if group.len() > 1 {
            fallback_groups.push(group);
        }
    }

    let litellm_db = app_data_root.join("litellm").join("litellm.db");
    let config = LiteLLMConfig {
        model_list,
        fallbacks: fallback_groups,
        general_settings: GeneralSettings {
            master_key: master_key.to_string(),
            database_url: format!("sqlite:///{}", litellm_db.to_string_lossy()),
        },
        litellm_settings: LiteLLMSettings { max_budget: 0 },
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
```

### Task 4: Integrate config generation into proxy startup

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/mod.rs`
- Modify: `app/src-tauri/src/agents/litellm_proxy/process.rs`

- [x] **Step 6: Update mod.rs to integrate config generation**

```rust
// Add to mod.rs:
pub mod config;

// Update ensure_litellm_proxy to accept Db state:
use crate::db::Db;

pub async fn ensure_litellm_proxy(
    timeout: std::time::Duration,
    app_data_root: &Path,
    db: &Db,
) -> Result<LiteLLMProxyHandle, String> {
    // Write config before starting proxy
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    config::write_config(&conn, app_data_root, &master_key)?;

    // ... rest of existing startup logic
}
```

### Task 5: Add `is_running()` process liveness check

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/process.rs`
- Modify: `app/src-tauri/src/agents/litellm_proxy/mod.rs`

- [x] **Step 6b: Add `is_running()` to `LiteLLMProxyProcess`**

Follow the OpenHands pattern — check `try_wait()` before health polling:

```rust
impl LiteLLMProxyProcess {
    pub fn is_running(&self) -> bool {
        match self._child.try_wait() {
            Ok(None) => true,
            Ok(Some(status)) => {
                log::warn!("[litellm-proxy] process exited with status {status}");
                false
            }
            Err(e) => {
                log::warn!("[litellm-proxy] failed to check process status: {e}");
                false
            }
        }
    }
}
```

- [x] **Step 6c: Update `ensure_litellm_proxy` to check liveness before health**

```rust
// In ensure_litellm_proxy, before health check:
let process_alive = managed.process.is_running();
let health_result = if process_alive {
    managed.handle.health_check().await
} else {
    Err("process is not running".to_string())
};
if process_alive && health_result.is_ok() {
    return Ok(managed.handle.clone());
}
```

- [x] **Step 6d: Add test for `is_running()`**

```rust
#[test]
fn should_reuse_cached_proxy_requires_running_and_healthy() {
    // Proof that is_running + health check are both required
    assert!(should_reuse_cached_proxy(true, Ok(())));
    assert!(!should_reuse_cached_proxy(false, Ok(())));
    assert!(!should_reuse_cached_proxy(true, Err("unhealthy".to_string())));
}
```

### Task 6: Create Tauri commands

**Files:**
- Create: `app/src-tauri/src/commands/litellm_providers.rs`
- Create: `app/src-tauri/src/commands/litellm_profiles.rs`
- Modify: `app/src-tauri/src/commands/mod.rs`
- Modify: `app/src-tauri/src/lib.rs`

- [x] **Step 7: Create litellm_providers.rs commands**

```rust
use crate::db::Db;
use crate::types::SecretString;

#[tauri::command]
pub fn list_litellm_providers(db: tauri::State<'_, Db>) -> Result<Vec<crate::db::LlmProvider>, String> {
    log::info!("[list_litellm_providers]");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::list_providers(&conn)
}

#[derive(serde::Deserialize)]
pub struct CreateProviderRequest {
    pub name: String,
    pub api_key: String,
    pub base_url: Option<String>,
    pub enabled: Option<bool>,
}

#[tauri::command]
pub fn create_litellm_provider(
    db: tauri::State<'_, Db>,
    request: CreateProviderRequest,
) -> Result<String, String> {
    log::info!("[create_litellm_provider] name={}", request.name);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let id = uuid::Uuid::new_v4().to_string();
    let provider = crate::db::LlmProvider {
        id: id.clone(),
        name: request.name,
        api_key: SecretString::new(request.api_key),
        base_url: request.base_url,
        enabled: request.enabled.unwrap_or(true),
        created_at: chrono::Utc::now().timestamp(),
    };
    crate::db::insert_provider(&conn, &provider)?;
    Ok(id)
}

#[tauri::command]
pub fn update_litellm_provider(
    db: tauri::State<'_, Db>,
    request: CreateProviderRequest,
    id: String,
) -> Result<(), String> {
    log::info!("[update_litellm_provider] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let provider = crate::db::LlmProvider {
        id,
        name: request.name,
        api_key: SecretString::new(request.api_key),
        base_url: request.base_url,
        enabled: request.enabled.unwrap_or(true),
        created_at: chrono::Utc::now().timestamp(),
    };
    crate::db::update_provider(&conn, &provider)
}

#[tauri::command]
pub fn delete_litellm_provider(db: tauri::State<'_, Db>, id: String) -> Result<(), String> {
    log::info!("[delete_litellm_provider] id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::delete_provider(&conn, &id)
}
```

- [x] **Step 8: Create litellm_profiles.rs commands**

Similar pattern to providers — CRUD commands for profiles and profile models.

- [x] **Step 9: Update commands/mod.rs**

```rust
pub mod litellm_providers;
pub mod litellm_profiles;
```

- [x] **Step 10: Register commands in lib.rs**

Add to `invoke_handler`:

```rust
commands::litellm_providers::list_litellm_providers,
commands::litellm_providers::create_litellm_provider,
commands::litellm_providers::update_litellm_provider,
commands::litellm_providers::delete_litellm_provider,
commands::litellm_profiles::list_litellm_profiles,
commands::litellm_profiles::create_litellm_profile,
commands::litellm_profiles::update_litellm_profile,
commands::litellm_profiles::delete_litellm_profile,
commands::litellm_profiles::add_profile_model,
commands::litellm_profiles::remove_profile_model,
commands::litellm_profiles::reorder_profile_models,
```

- [x] **Step 11: Run tests**

```bash
cd app/src-tauri && cargo test -- --nocapture
```

- [x] **Step 12: Commit**

```bash
git add app/src-tauri/src/db/litellm_*.rs app/src-tauri/src/db/mod.rs app/src-tauri/src/db/migrations.rs app/src-tauri/src/commands/litellm_*.rs app/src-tauri/src/commands/mod.rs app/src-tauri/src/agents/litellm_proxy/config.rs app/src-tauri/src/agents/litellm_proxy/mod.rs app/src-tauri/src/lib.rs
git commit -m "feat: provider/profile DB schema, CRUD commands, config generation"
```

### Manual smoke test for PR 2

- [ ] Run `cd app && npm run dev`
- [ ] Open Tauri devtools → Console
- [ ] Call `invoke('list_litellm_providers')` — should return `[]`
- [ ] Call `invoke('create_litellm_provider', { name: 'anthropic', api_key: 'sk-test-123' })` — should return UUID
- [ ] Call `invoke('list_litellm_providers')` — should return the created provider
- [ ] Verify `{app_data}/litellm/config.yaml` contains the provider entry

### Known limitations / follow-ups (post-merge)

- [ ] **Runtime config regeneration**: `config.yaml` is only written during proxy startup. If a user adds/updates/deletes a provider or profile while the proxy is running, the LiteLLM proxy continues using stale config. A `regenerate_config()` command that triggers a proxy restart is needed. Track as follow-up issue.
- [ ] **`reorder_profile_models` validation**: The command silently ignores model IDs that don't exist or don't belong to the profile. Add server-side validation that the count of updated rows matches `model_ids.len()`.
- [ ] **Provider name vs LiteLLM prefix**: The config generator uses the provider's display `name` as the LiteLLM model prefix (e.g., `anthropic/claude-sonnet`). If a user names a provider "My Custom Provider", the generated model name becomes `My Custom Provider/claude-sonnet` which LiteLLM won't recognize. Requires a separate `litellm_provider_prefix` field in the DB schema and a matching UI input in the Providers page (PR 5).

---

## PR 3: Virtual Key Management + Profile Activation

**Goal:** After proxy starts, create a single shared LiteLLM user and generate virtual keys for each profile. Bind profiles to keys with per-profile and per-model budgets.

### Task 1: Fix response types — remove `deny_unknown_fields`

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/types.rs`

- [x] **Step 1: Remove `#[serde(deny_unknown_fields)]` from all response types**

LiteLLM returns many more fields than modeled. `deny_unknown_fields` causes deserialization failures on first real use. Remove from `HealthResponse`, `CreateUserResponse`, `GenerateKeyResponse`, `KeyInfoResponse`, and `KeyInfo`.

### Task 1b: Drop `urlencoding` dependency

**Files:**
- Modify: `app/src-tauri/Cargo.toml`
- Modify: `app/src-tauri/src/agents/litellm_proxy/client.rs`

- [x] **Step 1b: Remove `urlencoding` crate and revert to plain key interpolation**

Virtual keys are `sk-<uuid>` format with no special characters. The `url` crate already in deps handles encoding. Remove `urlencoding = "1"` from `Cargo.toml` and revert `key_info` to:

```rust
.join(&format!("/key/info?key={}", key))
```

### Task 1c: Add per-model budget to `GenerateKeyRequest`

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/types.rs`

- [x] **Step 1c: Add `model_max_budget` field to `GenerateKeyRequest`**

```rust
#[derive(Debug, Clone, Serialize)]
pub struct GenerateKeyRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_budget: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_max_budget: Option<std::collections::HashMap<String, f64>>,
}
```

### Task 2: Add DB migration — drop `litellm_user_id`, add per-model budget

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`

- [x] **Step 2: Add migration**

```rust
// Add to NUMBERED_MIGRATIONS (next number after current highest):
(next_num, |conn: &Connection| -> Result<(), rusqlite::Error> {
    // Drop litellm_user_id column (not needed with single shared user)
    conn.execute_batch(r#"
        ALTER TABLE llm_profiles DROP COLUMN litellm_user_id;
    "#)?;

    // Add per-model budget column
    conn.execute_batch(r#"
        ALTER TABLE llm_profile_models ADD COLUMN budget REAL;
    "#)?;

    Ok(())
}),
```

### Task 3: Update DB types — drop `litellm_user_id`, add per-model budget

**Files:**
- Modify: `app/src-tauri/src/db/litellm_profiles.rs`
- Modify: `app/src-tauri/src/db/litellm_providers.rs` (no changes, just verify)

- [x] **Step 3: Update `LlmProfile` struct**

Remove `litellm_user_id` field from `LlmProfile`. Update all SQL queries that reference it (INSERT, UPDATE, SELECT).

- [x] **Step 4: Update `LlmProfileModel` struct**

Add `pub budget: Option<f64>` field. Update INSERT and SELECT queries.

### Task 4: Add virtual key provisioning to startup (single user, detached task)

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/mod.rs`

- [x] **Step 5: Bootstrap shared user**

Create a single user `"skill-builder"` at proxy bootstrap. Ignore 409 if user already exists from a previous run.

```rust
async fn bootstrap_shared_user(client: &LiteLLMAdminClient) -> Result<(), String> {
    let req = CreateUserRequest {
        user_id: "skill-builder".to_string(),
        max_budget: None,
        budget_duration: None,
        tpm_limit: None,
        rpm_limit: None,
    };
    match client.create_user(&req).await {
        Ok(_) => {
            log::info!("[litellm-proxy] created shared user 'skill-builder'");
            Ok(())
        }
        Err(e) if e.contains("409") || e.to_lowercase().contains("already exists") => {
            log::info!("[litellm-proxy] shared user 'skill-builder' already exists");
            Ok(())
        }
        Err(e) => Err(format!("Failed to create shared user: {e}")),
    }
}
```

- [x] **Step 6: Rewrite `provision_virtual_keys` — single user, per-profile keys, per-model budgets**

```rust
async fn provision_virtual_keys(
    handle: &LiteLLMProxyHandle,
    db: &Db,
) -> Result<(), String> {
    let profiles = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::list_profiles(&conn)?
    };

    let client = handle.admin_client();

    for profile in &profiles {
        if profile.virtual_key.is_some() {
            continue;
        }

        let models = {
            let conn = db.0.lock().map_err(|e| e.to_string())?;
            crate::db::get_profile_models(&conn, &profile.id)?
        };

        let model_names: Vec<String> = models.iter().map(|m| m.model_name.clone()).collect();

        // Build per-model budget map from models that have a budget set
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
                created_at: profile.created_at,
            };
            crate::db::update_profile(&conn, &updated_profile)?;
        }

        log::info!("[litellm-proxy] provisioned virtual key for profile '{}'", profile.name);
    }

    Ok(())
}
```

- [x] **Step 7: Provisioning runs in detached task, not blocking `ensure_litellm_proxy`**

```rust
// In ensure_litellm_proxy, after registering the proxy:
let handle_clone = handle.clone();
let db_clone = db.clone(); // Db is Arc<Mutex<Connection>>
tokio::spawn(async move {
    if let Err(e) = provision_virtual_keys(&handle_clone, &db_clone).await {
        log::error!("[litellm-proxy] provisioning failed: {e}");
    }
});
```

This releases the registry lock immediately after proxy registration. Provisioning runs asynchronously without blocking `try_get_proxy_handle` callers.

### Task 5: Add `verify_profile_virtual_key` command

**Files:**
- Modify: `app/src-tauri/src/commands/litellm_profiles.rs`

- [x] **Step 8: Add command using `get_profile` instead of `list_profiles`**

```rust
#[tauri::command]
pub async fn verify_profile_virtual_key(
    db: tauri::State<'_, Db>,
    profile_id: String,
) -> Result<bool, String> {
    log::info!("[verify_profile_virtual_key] profile_id={}", profile_id);
    let virtual_key = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let profile = crate::db::get_profile(&conn, &profile_id)?
            .ok_or_else(|| "Profile not found".to_string())?;
        profile.virtual_key.clone()
            .ok_or_else(|| "Profile has no virtual key".to_string())?
    };

    let handle = crate::agents::litellm_proxy::try_get_proxy_handle()
        .await
        .ok_or_else(|| "LiteLLM proxy not running".to_string())?;

    let client = handle.admin_client();
    let _info = client.key_info(&virtual_key).await?;
    Ok(true)
}
```

- [x] **Step 9: Register command in `lib.rs`**

Replace `test_profile_connection` with `verify_profile_virtual_key` in the invoke handler.

### Task 6: Update design documentation

**Files:**
- Modify: `docs/design/litellm-integration/README.md`
- Create: `docs/design/litellm-integration/budgets.md`

- [x] **Step 10: Update design doc**

- Rename from "Model Settings" to "LiteLLM Integration"
- Update startup flow: single shared user, detached provisioning
- Remove `litellm_user_id` from `llm_profiles` table schema
- Add `budget` column to `llm_profile_models` table schema
- Add budgets.md child page documenting LiteLLM budget hierarchy and Skill Builder's usage

### Task 7: Update implementation plan checkboxes

**Files:**
- Modify: `docs/plans/2026-05-11-litellm-proxy-implementation.md`

- [ ] **Step 11: Reset PR3 checkboxes to `[ ]`**

All PR3 items were previously marked `[x]` against the old implementation. Reset them to `[ ]` for the new implementation.

### Task 8: Run tests

- [ ] **Step 12: Run tests**

```bash
cd app/src-tauri && cargo test -- --nocapture
```

### Task 9: Commit

- [ ] **Step 13: Commit**

```bash
git add app/src-tauri/ docs/design/ docs/plans/
git commit -m "feat: virtual key provisioning with single shared user, per-model budgets"
```

### Manual smoke test for PR 3

- [ ] Run `cd app && npm run dev`
- [ ] Create a provider and profile via Tauri invoke
- [ ] Check logs for `[litellm-proxy] created shared user 'skill-builder'`
- [ ] Check logs for `[litellm-proxy] provisioned virtual key for profile '...'`
- [ ] Call `invoke('verify_profile_virtual_key', { profile_id: '...' })` — should return `true`
- [ ] Verify `{app_data}/litellm/litellm.db` exists and has LiteLLM tables

---

## PR 3a: Persistent Venv for LiteLLM + Prisma

**Goal:** Replace `uvx litellm[proxy]` with a persistent Python venv at `{app_data}/litellm/venv/` that includes both `litellm[proxy]` and `prisma`. LiteLLM's admin API (`/user/new`, `/key/generate`, `/key/info`) requires Prisma — without it, all admin endpoints fail. The persistent venv installs once on first launch, caches forever, and works offline thereafter.

### Task 1: Add venv bootstrap module

**Files:**
- Create: `app/src-tauri/src/agents/litellm_proxy/venv.rs`
- Modify: `app/src-tauri/src/agents/litellm_proxy/mod.rs`

- [ ] **Step 1: Create venv.rs**

```rust
use std::path::{Path, PathBuf};
use std::process::Command;

const VENV_DIR: &str = "venv";

#[cfg(unix)]
fn python_path(venv_root: &Path) -> PathBuf {
    venv_root.join("bin/python")
}

#[cfg(windows)]
fn python_path(venv_root: &Path) -> PathBuf {
    venv_root.join("Scripts/python.exe")
}

#[cfg(unix)]
fn prisma_path(venv_root: &Path) -> PathBuf {
    venv_root.join("bin/prisma")
}

#[cfg(windows)]
fn prisma_path(venv_root: &Path) -> PathBuf {
    venv_root.join("Scripts/prisma.exe")
}

/// Check if the venv already exists and has the required packages.
pub fn venv_exists(app_data_root: &Path) -> bool {
    let venv_root = app_data_root.join("litellm").join(VENV_DIR);
    python_path(&venv_root).exists()
}

/// Bootstrap the persistent venv for LiteLLM + Prisma.
/// Returns the path to the Python interpreter in the venv.
pub fn ensure_venv(app_data_root: &Path) -> Result<PathBuf, String> {
    let litellm_dir = app_data_root.join("litellm");
    let venv_root = litellm_dir.join(VENV_DIR);
    let python = python_path(&venv_root);

    if python.exists() {
        log::info!("[litellm-proxy] venv already exists at {:?}", venv_root);
        return Ok(python);
    }

    log::info!("[litellm-proxy] bootstrapping venv at {:?}", venv_root);

    // Step 1: Create venv
    let status = Command::new("uv")
        .args(["venv", venv_root.to_str().ok_or("Invalid venv path")?])
        .status()
        .map_err(|e| {
            if e.kind() == std::io::ErrorKind::NotFound {
                "Python uv tool is required. Install uv from https://docs.astral.sh/uv/".to_string()
            } else {
                format!("Failed to create venv: {e}")
            }
        })?;

    if !status.success() {
        return Err("Failed to create LiteLLM venv".to_string());
    }

    // Step 2: Install litellm[proxy] + prisma
    let python_str = python.to_str().ok_or("Invalid python path")?;
    let status = Command::new("uv")
        .args([
            "pip",
            "install",
            "--python",
            python_str,
            "litellm[proxy]",
            "prisma",
        ])
        .status()
        .map_err(|e| format!("Failed to install packages: {e}"))?;

    if !status.success() {
        return Err("Failed to install LiteLLM + Prisma in venv".to_string());
    }

    // Step 3: Run prisma generate
    let status = Command::new(prisma_path(&venv_root))
        .arg("generate")
        .status()
        .map_err(|e| format!("Failed to run prisma generate: {e}"))?;

    if !status.success() {
        return Err("prisma generate failed".to_string());
    }

    log::info!("[litellm-proxy] venv bootstrapped successfully");
    Ok(python)
}
```

- [ ] **Step 2: Update mod.rs to export venv module**

```rust
// Add to existing mod.rs:
pub mod venv;
```

### Task 2: Update process.rs to use venv instead of `uvx`

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/process.rs`

- [ ] **Step 3: Update `spawn_proxy` to accept python_path**

Change the spawn function signature and implementation:

```rust
fn spawn_proxy(
    port: u16,
    master_key: &str,
    config_path: &Path,
    python_path: &Path,
) -> Result<tokio::process::Child, String> {
    let mut cmd = tokio::process::Command::new(python_path);
    cmd.args([
        "-m",
        "litellm",
        "--config",
        &config_path.to_string_lossy(),
        "--port",
        &port.to_string(),
    ])
    .env("LITELLM_MASTER_KEY", master_key)
    .env("LITELLM_DATABASE_URL", &format!("sqlite:///{}/litellm.db", config_path.parent().unwrap().to_string_lossy()))
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::piped())
    .kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);

    cmd.spawn().map_err(|e| {
        format!("Failed to spawn LiteLLM proxy: {e}")
    })
}
```

- [ ] **Step 4: Update `LiteLLMProxyProcess::start` to call `ensure_venv`**

```rust
impl LiteLLMProxyProcess {
    pub async fn start(timeout: Duration, app_data_root: &Path) -> Result<Self, String> {
        // Bootstrap venv first
        let python_path = crate::agents::litellm_proxy::venv::ensure_venv(app_data_root)?;

        let port = select_random_local_port()?;
        let master_key = read_or_create_master_key(app_data_root)?;
        let config_path = ensure_config_dir(app_data_root)?;

        let mut child = spawn_proxy(port, &master_key, &config_path, &python_path)
            .map_err(|e| format!("Failed to spawn LiteLLM proxy: {e}"))?;

        // ... rest of existing startup logic (stderr tail, health check)
    }
}
```

### Task 3: Update tests

**Files:**
- Modify: `app/src-tauri/src/agents/litellm_proxy/tests.rs`

- [ ] **Step 5: Add venv_exists test**

```rust
#[test]
fn venv_does_not_exist_by_default() {
    let tmp = tempfile::tempdir().unwrap();
    assert!(!crate::agents::litellm_proxy::venv::venv_exists(tmp.path()));
}
```

### Task 4: Update File Map

**Files:**
- Modify: `docs/plans/2026-05-11-litellm-proxy-implementation.md`

- [ ] **Step 6: Add PR 3a entries to File Map**

Add to the File Map section:

```markdown
### PR 3a: Persistent Venv
| File | Action |
|---|---|
| `app/src-tauri/src/agents/litellm_proxy/venv.rs` | Create — venv bootstrap, existence check, python/prisma paths |
| `app/src-tauri/src/agents/litellm_proxy/mod.rs` | Modify — add `pub mod venv` |
| `app/src-tauri/src/agents/litellm_proxy/process.rs` | Modify — use venv python instead of `uvx`, update spawn signature |
| `app/src-tauri/src/agents/litellm_proxy/tests.rs` | Modify — add venv_exists test |
```

### Task 5: Run tests

- [ ] **Step 7: Run tests**

```bash
cd app/src-tauri && cargo test litellm_proxy -- --nocapture
```

### Task 6: Commit

- [ ] **Step 8: Commit**

```bash
git add app/src-tauri/src/agents/litellm_proxy/venv.rs app/src-tauri/src/agents/litellm_proxy/mod.rs app/src-tauri/src/agents/litellm_proxy/process.rs app/src-tauri/src/agents/litellm_proxy/tests.rs
git commit -m "fix: persistent venv for LiteLLM + Prisma (replaces uvx)"
```

### Manual smoke test for PR 3a

- [ ] Delete any existing `{app_data}/litellm/venv/` directory
- [ ] Run `cd app && npm run dev`
- [ ] Verify logs show `[litellm-proxy] bootstrapping venv at ...`
- [ ] Verify venv directory is created with `bin/python` and `bin/prisma`
- [ ] Verify proxy starts successfully after venv bootstrap
- [ ] Restart app — verify logs show `[litellm-proxy] venv already exists at ...` (fast startup)
- [ ] Verify admin API endpoints work: `invoke('verify_profile_virtual_key', { profile_id: '...' })` returns `true`

---

## PR 4: OpenHands Runtime Config → Proxy Routing

**Goal:** OpenHands points to LiteLLM proxy instead of direct provider.

### Task 1: Update ModelSettings

**Files:**
- Modify: `app/src-tauri/src/types/settings.rs`

- [ ] **Step 1: Update ModelSettings struct**

```rust
// Remove fields:
// - api_key
// - base_url
// - provider

// Add field:
pub profile_id: Option<String>,
```

Update `Default`, `Debug`, and `normalized()` implementations accordingly.

### Task 2: Update OpenHandsRuntimeConfig

**Files:**
- Modify: `app/src-tauri/src/agents/runtime_config.rs`

- [ ] **Step 2: Add proxy fields**

```rust
pub struct OpenHandsRuntimeConfig {
    // ... existing fields ...
    #[serde(rename = "litellmProxyPort", skip_serializing_if = "Option::is_none")]
    pub litellm_proxy_port: Option<u16>,
    #[serde(rename = "litellmVirtualKey", skip_serializing_if = "Option::is_none")]
    pub litellm_virtual_key: Option<SecretString>,
}
```

### Task 3: Update workflow runtime to use proxy

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/runtime.rs`

- [ ] **Step 3: Pass proxy URL + virtual key to OpenHands config**

```rust
// When building OpenHandsRuntimeConfig:
let proxy_handle = crate::agents::litellm_proxy::try_get_proxy_handle().await;
let (proxy_url, virtual_key) = if let Some(handle) = proxy_handle {
    (
        Some(format!("http://127.0.0.1:{}/v1", handle.port)),
        Some(SecretString::new(virtual_key_from_profile.clone())),
    )
} else {
    (None, None)
};

let config = build_openhands_runtime_config(BuildOpenHandsRuntimeConfigParams {
    // ... existing params ...
    litellm_proxy_port: handle.map(|h| h.port),
    litellm_virtual_key: virtual_key,
});
```

### Task 4: Update frontend types

**Files:**
- Modify: `app/src/lib/types.ts`

- [ ] **Step 4: Update ModelSettings TypeScript type**

```typescript
type ModelSettings = {
  profileId?: string | null;
  model: string | null;
  temperature?: number | null;
  maxOutputTokens?: number | null;
  timeoutSeconds?: number | null;
  numRetries?: number | null;
  reasoningEffort?: "auto" | "low" | "medium" | "high" | null;
  extraHeaders?: Record<string, string> | null;
  inputCostPerToken?: number | null;
  outputCostPerToken?: number | null;
  usageId?: string | null;
};
```

### Task 5: Ensure LiteLLM proxy before OpenHands

**Files:**
- Modify: `app/src-tauri/src/agents/openhands_server/mod.rs`

- [ ] **Step 5: Add proxy ensure step**

```rust
// In resolve_openhands_conversation_id or ensure_openhands_server:
let _ = crate::agents::litellm_proxy::ensure_litellm_proxy(
    Duration::from_secs(30),
    Path::new(&request.app_data_root),
    &db,
).await?;
```

- [ ] **Step 6: Run tests**

```bash
cd app/src-tauri && cargo test -- --nocapture
cd app && npm run test:unit
```

- [ ] **Step 7: Commit**

```bash
git add app/src-tauri/src/types/settings.rs app/src-tauri/src/agents/runtime_config.rs app/src-tauri/src/commands/workflow/runtime.rs app/src-tauri/src/agents/openhands_server/mod.rs app/src/lib/types.ts
git commit -m "feat: OpenHands runtime config routes through LiteLLM proxy"
```

### Manual smoke test for PR 4

- [ ] Run `cd app && npm run dev`
- [ ] Configure a provider and profile
- [ ] Run a skill workflow step
- [ ] Check logs — OpenHands should show `base_url: http://127.0.0.1:<port>/v1`
- [ ] Verify the request goes through LiteLLM (check `{app_data}/litellm/litellm.db` spend logs)

---

## PR 5: Providers Frontend Page

**Goal:** Settings page for managing LLM providers.

### Task 1: Create Tauri command types

**Files:**
- Modify: `app/src/lib/tauri-command-types.ts`

- [ ] **Step 1: Add provider command types**

```typescript
interface ListLitellmProviders {
  input: void;
  output: LlmProvider[];
}

interface CreateLitellmProvider {
  input: { name: string; apiKey: string; baseUrl?: string; enabled?: boolean };
  output: string;
}

interface UpdateLitellmProvider {
  input: { id: string; name: string; apiKey: string; baseUrl?: string; enabled?: boolean };
  output: void;
}

interface DeleteLitellmProvider {
  input: { id: string };
  output: void;
}
```

### Task 2: Create query hooks

**Files:**
- Create: `app/src/lib/queries/litellm.ts`

- [ ] **Step 2: Create provider query hooks**

```typescript
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { invoke } from '@tauri-apps/api/core';

export function useProviders() {
  return useQuery({
    queryKey: ['litellm', 'providers'],
    queryFn: () => invoke<LlmProvider[]>('list_litellm_providers'),
  });
}

export function useCreateProvider() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; apiKey: string; baseUrl?: string }) =>
      invoke<string>('create_litellm_provider', { request: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['litellm', 'providers'] }),
  });
}

// Similar for update, delete
```

### Task 3: Create Providers page

**Files:**
- Create: `app/src/pages/settings/providers-page.tsx`
- Create: `app/src/components/settings/providers/provider-list.tsx`
- Create: `app/src/components/settings/providers/provider-dialog.tsx`
- Create: `app/src/components/settings/providers/provider-test-indicator.tsx`

- [ ] **Step 3: Create provider-list.tsx**

```tsx
import { useProviders, useDeleteProvider } from '@/lib/queries/litellm';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Pencil, Trash2, Plus } from 'lucide-react';

export function ProviderList({ onAdd, onEdit }: { onAdd: () => void; onEdit: (id: string) => void }) {
  const { data: providers, isLoading } = useProviders();
  const deleteProvider = useDeleteProvider();

  if (isLoading) return <div>Loading...</div>;

  return (
    <div>
      <div className="flex justify-between mb-4">
        <h2 className="text-lg font-semibold">Providers</h2>
        <Button onClick={onAdd}><Plus className="w-4 h-4 mr-1" /> Add Provider</Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Base URL</TableHead>
            <TableHead className="w-24">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {providers?.map((p) => (
            <TableRow key={p.id}>
              <TableCell className="font-medium">{p.name}</TableCell>
              <TableCell>
                <Badge variant={p.enabled ? 'default' : 'secondary'}>
                  {p.enabled ? 'Enabled' : 'Disabled'}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground">{p.baseUrl || '(default)'}</TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <Button variant="ghost" size="icon" onClick={() => onEdit(p.id)}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => deleteProvider.mutate({ id: p.id })}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
```

- [ ] **Step 4: Create provider-dialog.tsx**

Form dialog with fields: name (select: Anthropic, OpenAI, Azure, Ollama, Custom), API key, base URL.

> **Note:** The provider dialog must also include a `litellm_provider_prefix` field (e.g., `anthropic`, `openai`) that is stored separately from the display name. This prefix is used by the config generator to build LiteLLM-compatible model names (e.g., `anthropic/claude-sonnet`). For known providers, auto-fill the prefix from the display name selection.

- [ ] **Step 5: Create providers-page.tsx**

```tsx
import { ProviderList } from '@/components/settings/providers/provider-list';
import { ProviderDialog } from '@/components/settings/providers/provider-dialog';
import { useState } from 'react';

export function ProvidersPage() {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">LLM Providers</h1>
      <p className="text-muted-foreground mb-6">
        Configure the LLM providers your skills can use. API keys are stored securely.
      </p>
      <ProviderList onAdd={() => setIsAdding(true)} onEdit={setEditingId} />
      <ProviderDialog
        open={isAdding || editingId !== null}
        onOpenChange={(open) => { if (!open) { setIsAdding(false); setEditingId(null); } }}
        providerId={editingId ?? undefined}
      />
    </div>
  );
}
```

### Task 4: Add route

**Files:**
- Modify: `app/src/router.tsx`

- [ ] **Step 6: Add `/settings/providers` route**

```tsx
const providersPage = lazy(() => import('./pages/settings/providers-page'));
// Add to settings route group:
<Route path="providers" element={<ProvidersPage />} />
```

### Task 5: Write tests

**Files:**
- Create: `app/src/__tests__/pages/settings/providers-page.test.tsx`
- Create: `app/src/__tests__/components/settings/providers/provider-list.test.tsx`

- [ ] **Step 7: Write tests**

```tsx
// provider-list.test.tsx
import { render, screen } from '@testing-library/react';
import { ProviderList } from '@/components/settings/providers/provider-list';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

function renderWithQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

test('shows provider list', () => {
  // Mock useProviders to return test data
  renderWithQuery(<ProviderList onAdd={vi.fn()} onEdit={vi.fn()} />);
  // ... assertions
});
```

- [ ] **Step 8: Run tests**

```bash
cd app && npm run test:unit
```

- [ ] **Step 9: Commit**

```bash
git add app/src/pages/settings/providers-page.tsx app/src/components/settings/providers/ app/src/lib/queries/litellm.ts app/src/lib/tauri-command-types.ts app/src/router.tsx app/src/__tests__/
git commit -m "feat: Providers settings page"
```

### Manual smoke test for PR 5

- [ ] Run `cd app && npm run dev`
- [ ] Navigate to Settings → Providers
- [ ] Add a provider (e.g., Anthropic with test key)
- [ ] Verify it appears in the list
- [ ] Edit the provider — changes should persist
- [ ] Delete the provider — list should update

---

## PR 6: Models Frontend Page

**Goal:** Settings page for profiles, budgets, virtual keys.

### Task 1: Create profile components

**Files:**
- Create: `app/src/pages/settings/models-page.tsx`
- Create: `app/src/components/settings/models/profile-list.tsx`
- Create: `app/src/components/settings/models/profile-editor.tsx`
- Create: `app/src/components/settings/models/virtual-key-display.tsx`
- Create: `app/src/components/settings/models/profile-test-modal.tsx`
- Create: `app/src/components/settings/models/spend-indicator.tsx`

- [ ] **Step 1: Create profile-list.tsx**

Card-based layout showing profile name, budget, current spend, status.

- [ ] **Step 2: Create profile-editor.tsx**

Form with: profile name, model selection (from available providers), fallback ordering (drag to reorder), budget inputs (monthly, total), rate limits (TPM, RPM).

- [ ] **Step 3: Create virtual-key-display.tsx**

```tsx
export function VirtualKeyDisplay({ virtualKey }: { virtualKey: string }) {
  const [copied, setCopied] = useState(false);
  const masked = virtualKey.slice(0, 6) + '...' + virtualKey.slice(-4);

  return (
    <div className="flex items-center gap-2">
      <code className="text-sm bg-muted px-2 py-1 rounded">{masked}</code>
      <Button variant="ghost" size="icon" onClick={() => { navigator.clipboard.writeText(virtualKey); setCopied(true); }}>
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}
```

- [ ] **Step 4: Create models-page.tsx**

```tsx
export function ModelsPage() {
  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-bold mb-6">Models</h1>
      <p className="text-muted-foreground mb-6">
        Define model profiles with budgets and fallbacks. Each profile gets a virtual key for use with workflow agents.
      </p>
      <ProfileList />
    </div>
  );
}
```

### Task 2: Add route

**Files:**
- Modify: `app/src/router.tsx`

- [ ] **Step 5: Add `/settings/models` route**

### Task 3: Write tests

**Files:**
- Create: `app/src/__tests__/pages/settings/models-page.test.tsx`

- [ ] **Step 6: Run tests**

```bash
cd app && npm run test:unit
```

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/settings/models-page.tsx app/src/components/settings/models/ app/src/__tests__/
git commit -m "feat: Models settings page"
```

### Manual smoke test for PR 6

- [ ] Run `cd app && npm run dev`
- [ ] Navigate to Settings → Models
- [ ] Create a profile with models from configured providers
- [ ] Verify virtual key is generated and displayed
- [ ] Test the profile — should return success
- [ ] Check spend indicator shows $0

---

## PR 7: Usage Migration to LiteLLM

**Goal:** Drop `agent_runs` table, replace usage commands with LiteLLM-backed spend APIs.

### Task 1: Create LiteLLM usage commands

**Files:**
- Create: `app/src-tauri/src/commands/litellm_usage.rs`

- [ ] **Step 1: Create litellm_usage.rs**

```rust
use crate::db::Db;
use crate::agents::litellm_proxy::try_get_proxy_handle;

#[derive(serde::Serialize)]
pub struct SpendSummary {
    pub total_spend: f64,
    pub start_date: String,
    pub end_date: String,
}

#[tauri::command]
pub async fn get_litellm_spend_summary(
    db: tauri::State<'_, Db>,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<SpendSummary, String> {
    log::info!("[get_litellm_spend_summary]");
    let handle = try_get_proxy_handle().await
        .ok_or_else(|| "LiteLLM proxy not running".to_string())?;
    let client = handle.admin_client();

    let start = start_date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());
    let end = end_date.unwrap_or_else(|| chrono::Utc::now().format("%Y-%m-%d").to_string());

    // Call /global/spend/report
    let url = format!("{}/global/spend/report?start_date={}&end_date={}",
        handle.base_url(), start, end);
    let resp = reqwest::Client::new()
        .get(&url)
        .header("Authorization", format!("Bearer {}", handle.master_key))
        .send()
        .await
        .map_err(|e| format!("LiteLLM spend report failed: {e}"))?;

    let body: serde_json::Value = resp.json().await
        .map_err(|e| format!("Failed to parse spend report: {e}"))?;

    // Parse response and return summary
    let total_spend = body.as_array()
        .map(|arr| arr.iter().filter_map(|row| row.get("total_spend").and_then(|v| v.as_f64())).sum::<f64>())
        .unwrap_or(0.0);

    Ok(SpendSummary { total_spend, start_date: start, end_date: end })
}

#[tauri::command]
pub async fn get_litellm_profile_spend(
    profile_id: String,
) -> Result<f64, String> {
    // Call /key/info with profile's virtual key
    // ...
}

#[tauri::command]
pub async fn get_litellm_daily_activity(
    start_date: String,
    end_date: String,
) -> Result<serde_json::Value, String> {
    // Call /user/daily/activity
    // ...
}

#[tauri::command]
pub async fn reset_litellm_spend() -> Result<(), String> {
    // Call POST /global/spend/reset
    // ...
}
```

### Task 2: Delete old usage code

**Files:**
- Delete: `app/src-tauri/src/commands/usage.rs`
- Delete: `app/src-tauri/src/db/usage.rs`
- Delete: `app/src/stores/usage-store.ts`

- [ ] **Step 2: Remove old usage modules**

```bash
rm app/src-tauri/src/commands/usage.rs
rm app/src-tauri/src/db/usage.rs
rm app/src/stores/usage-store.ts
```

- [ ] **Step 3: Update db/mod.rs**

Remove `pub mod usage;` and `pub use usage::*;`

- [ ] **Step 4: Update commands/mod.rs**

Replace `pub mod usage;` with `pub mod litellm_usage;`

### Task 3: Add migration to drop agent_runs

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs`

- [ ] **Step 5: Add drop migration**

```rust
// Add to NUMBERED_MIGRATIONS:
(next_num, |conn: &Connection| -> Result<(), rusqlite::Error> {
    conn.execute_batch(r#"
        DROP TABLE IF EXISTS agent_runs;
    "#)?;
    Ok(())
}),
```

### Task 4: Update lib.rs commands

**Files:**
- Modify: `app/src-tauri/src/lib.rs`

- [ ] **Step 6: Replace old usage commands**

Remove:
```rust
commands::usage::get_usage_summary,
commands::usage::get_usage_by_step,
// ... all usage commands
```

Add:
```rust
commands::litellm_usage::get_litellm_spend_summary,
commands::litellm_usage::get_litellm_profile_spend,
commands::litellm_usage::get_litellm_daily_activity,
commands::litellm_usage::reset_litellm_spend,
```

### Task 5: Update frontend usage components

**Files:**
- Modify: `app/src/lib/queries/usage.ts`
- Modify: `app/src/components/settings/usage-section.tsx`
- Create: `app/src/pages/settings/usage-page.tsx`

- [ ] **Step 7: Update usage queries**

Replace old queries with LiteLLM-backed ones.

- [ ] **Step 8: Run tests**

```bash
cd app/src-tauri && cargo test -- --nocapture
cd app && npm run test:unit
```

- [ ] **Step 9: Commit**

```bash
git add app/src-tauri/src/commands/litellm_usage.rs app/src-tauri/src/commands/mod.rs app/src-tauri/src/commands/usage.rs app/src-tauri/src/db/usage.rs app/src-tauri/src/db/mod.rs app/src-tauri/src/db/migrations.rs app/src-tauri/src/lib.rs app/src/stores/usage-store.ts app/src/lib/queries/usage.ts app/src/components/settings/usage-section.tsx app/src/pages/settings/usage-page.tsx
git commit -m "feat: migrate usage tracking to LiteLLM spend APIs"
```

### Manual smoke test for PR 7

- [ ] Run `cd app && npm run dev`
- [ ] Run a skill workflow step (generates spend)
- [ ] Navigate to Settings → Usage
- [ ] Verify spend is shown (should be non-zero after the run)
- [ ] Check daily activity shows today's date with spend data
- [ ] Click "Reset Spend" — verify spend goes back to $0

---

## PR Dependency Graph

```
PR 1: Proxy process management
    ↓
PR 2: Provider/Profile DB + config generation
    ↓
PR 3: Virtual key management
    ↓           ↘
PR 4: OpenHands → proxy    PR 5: Providers UI
    ↓                       ↓
                   PR 6: Models UI
                       ↓
                   PR 7: Usage migration
```

PRs 4 and 5 can be developed in parallel after PR 3. PR 6 depends on both PR 3 (backend) and PR 5 (UI patterns). PR 7 depends on PR 3 (virtual keys needed for spend queries).
