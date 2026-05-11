#[cfg(unix)]
use nix::sys::signal::{kill, Signal};
#[cfg(unix)]
use nix::unistd::Pid;
use std::collections::VecDeque;
use std::fs;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
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
    let litellm_db = config_path
        .parent()
        .unwrap_or(Path::new("."))
        .join("litellm.db");

    let mut cmd = tokio::process::Command::new("uvx");
    cmd.args([
        "litellm[proxy]",
        "--config",
        &config_path.to_string_lossy(),
        "--port",
        &port.to_string(),
    ])
    .env("LITELLM_MASTER_KEY", master_key)
    .env("LITELLM_DATABASE_URL", &format!("sqlite:///{}", litellm_db.to_string_lossy()))
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

pub fn select_random_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to reserve local LiteLLM proxy port: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("Failed to read local LiteLLM proxy port: {e}"))
}

pub fn read_or_create_master_key(app_data_root: &Path) -> Result<String, String> {
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

pub fn ensure_config_dir(app_data_root: &Path) -> Result<PathBuf, String> {
    let litellm_dir = app_data_root.join("litellm");
    fs::create_dir_all(&litellm_dir).map_err(|e| {
        format!("Failed to create litellm directory: {e}")
    })?;
    Ok(litellm_dir.join("config.yaml"))
}
