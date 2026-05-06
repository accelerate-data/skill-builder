use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, BufReader};

pub const OPENHANDS_AGENT_SERVER_PACKAGE: &str = "openhands-agent-server==1.19.1";
pub const OPENHANDS_TOOLS_PACKAGE: &str = "openhands-tools==1.19.1";
pub const OPENHANDS_AGENT_SERVER_MISSING_TRANSITIVE_PACKAGES: &[&str] = &["libtmux"];
const CACHED_HEALTH_CHECK_TIMEOUT: Duration = Duration::from_millis(500);

/// Path to the uv binary bundled with the app, if present.
/// `None` (outer) means not yet initialized.
/// `Some(None)` means initialized but no bundled binary found — fall back to system uvx.
/// `Some(Some(path))` means the bundled binary is at `path`.
static BUNDLED_UV_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Call once at app startup from the Tauri setup hook.
/// Checks for a `uv` (or `uv.exe` on Windows) binary in `resource_dir` and
/// stores the path so `python_module_command_parts` can use it instead of
/// requiring a system-installed `uvx`.
pub fn init_bundled_uv_path(resource_dir: &Path) {
    let uv_name = if cfg!(windows) { "uv.exe" } else { "uv" };
    let candidate = resource_dir.join(uv_name);
    if candidate.is_file() {
        log::info!(
            "[openhands-agent-server] using bundled uv at {}",
            candidate.display()
        );
        let _ = BUNDLED_UV_PATH.set(Some(candidate));
    } else {
        log::info!(
            "[openhands-agent-server] no bundled uv found in resource dir; falling back to system uvx"
        );
        let _ = BUNDLED_UV_PATH.set(None);
    }
}

/// Resolve the absolute path the OpenHands SDK should persist conversation
/// state and per-event JSON to for a specific skill workspace.
pub(crate) fn compute_conversations_path(workspace_skill_dir: &Path) -> PathBuf {
    workspace_skill_dir.join("conversations")
}

fn apply_session_env(
    cmd: &mut tokio::process::Command,
    session_api_key: &str,
    conversations_path: Option<&str>,
) {
    cmd.env("SESSION_API_KEY", session_api_key)
        .env("OH_SESSION_API_KEYS_0", session_api_key)
        .env("OH_SECRET_KEY", session_api_key);
    if let Some(p) = conversations_path {
        cmd.env("OH_CONVERSATIONS_PATH", p);
    }
}

#[derive(Debug, Clone)]
pub struct OpenHandsAgentServerHandle {
    pub port: u16,
    pub session_api_key: String,
    pub conversations_path: String,
}

impl OpenHandsAgentServerHandle {
    pub fn base_url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    pub fn websocket_url(&self, conversation_id: &str) -> String {
        format!(
            "ws://127.0.0.1:{}/sockets/events/{}",
            self.port, conversation_id
        )
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenHandsServerCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl OpenHandsServerCommand {
    pub fn new(port: u16) -> Self {
        let (program, mut args) = python_module_command_parts();
        args.extend([
            "openhands.agent_server".to_string(),
            "--host".to_string(),
            "127.0.0.1".to_string(),
            "--port".to_string(),
            port.to_string(),
        ]);

        Self { program, args }
    }

    pub fn tokio_command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.program);
        command
            .args(&self.args)
            .env("OPENHANDS_SUPPRESS_BANNER", "1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(not(target_os = "windows"))]
        command
            .env("TMPDIR", "/tmp")
            .env("TMP", "/tmp")
            .env("TEMP", "/tmp");
        command
    }
}

fn python_module_command_parts() -> (String, Vec<String>) {
    let package_args = vec![
        "--from".to_string(),
        OPENHANDS_AGENT_SERVER_PACKAGE.to_string(),
        "--with".to_string(),
        OPENHANDS_TOOLS_PACKAGE.to_string(),
        "--with".to_string(),
        "libtmux".to_string(),
        "python".to_string(),
        "-m".to_string(),
    ];

    // Use bundled uv when available (set by init_bundled_uv_path at startup).
    // OnceLock::get() returns None when not yet initialized (e.g. unit tests),
    // which correctly falls through to the system-uvx path.
    if let Some(Some(uv_path)) = BUNDLED_UV_PATH.get() {
        let mut args = vec!["tool".to_string(), "run".to_string()];
        args.extend(package_args);
        return (uv_path.to_string_lossy().into_owned(), args);
    }

    ("uvx".to_string(), package_args)
}

#[derive(Debug)]
pub struct OpenHandsAgentServerProcess {
    pub port: u16,
    pub session_api_key: String,
    pub _command: OpenHandsServerCommand,
    _runtime_dir: tempfile::TempDir,
    _child: tokio::process::Child,
}

struct ManagedOpenHandsAgentServer {
    handle: OpenHandsAgentServerHandle,
    process: OpenHandsAgentServerProcess,
}

type OpenHandsAgentServerRegistry = tokio::sync::Mutex<Option<ManagedOpenHandsAgentServer>>;

fn agent_server_registry() -> &'static OpenHandsAgentServerRegistry {
    static REGISTRY: OnceLock<OpenHandsAgentServerRegistry> = OnceLock::new();
    REGISTRY.get_or_init(|| tokio::sync::Mutex::new(None))
}

pub async fn ensure_agent_server(
    timeout: Duration,
    workspace_skill_dir: &Path,
) -> Result<OpenHandsAgentServerHandle, String> {
    let mut registry = agent_server_registry().lock().await;
    let conversations_path = compute_conversations_path(workspace_skill_dir)
        .to_string_lossy()
        .into_owned();
    if let Some(server) = registry.as_mut() {
        let process_running = server.process.is_running();
        let health_result = if process_running {
            server
                .process
                .wait_until_healthy(CACHED_HEALTH_CHECK_TIMEOUT)
                .await
        } else {
            Err("cached process is not running".to_string())
        };
        if server.handle.conversations_path == conversations_path
            && should_reuse_cached_server(process_running, health_result.clone())
        {
            return Ok(server.handle.clone());
        }
        if server.handle.conversations_path != conversations_path {
            log::info!(
                "[openhands-agent-server] restarting cached server because conversations root changed: {} -> {}",
                server.handle.conversations_path,
                conversations_path
            );
        }
        if let Err(error) = &health_result {
            log::warn!(
                "[openhands-agent-server] cached server failed liveness probe: {error}; starting a new server"
            );
        }
        let _ = server.process.shutdown().await;
        *registry = None;
    }

    let process = OpenHandsAgentServerProcess::start(timeout, workspace_skill_dir).await?;
    let handle = OpenHandsAgentServerHandle {
        port: process.port,
        session_api_key: process.session_api_key.clone(),
        conversations_path,
    };
    *registry = Some(ManagedOpenHandsAgentServer {
        handle: handle.clone(),
        process,
    });
    Ok(handle)
}

pub async fn shutdown_agent_server() -> Result<(), String> {
    let mut registry = agent_server_registry().lock().await;
    if let Some(mut server) = registry.take() {
        server.process.shutdown().await?;
    }
    Ok(())
}

impl OpenHandsAgentServerProcess {
    pub async fn start(timeout: Duration, workspace_skill_dir: &Path) -> Result<Self, String> {
        let mut last_error = None;
        for attempt in 1..=5 {
            match Self::start_once(timeout, workspace_skill_dir).await {
                Ok(process) => return Ok(process),
                Err(error) => {
                    log::warn!(
                        "[openhands-agent-server] startup attempt {attempt} failed: {error}"
                    );
                    last_error = Some(error);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| "Failed to start OpenHands Agent Server".to_string()))
    }

    async fn start_once(timeout: Duration, workspace_skill_dir: &Path) -> Result<Self, String> {
        let port = select_random_local_port()?;
        let session_api_key = uuid::Uuid::new_v4().to_string();
        let command = OpenHandsServerCommand::new(port);
        let runtime_dir = tempfile::Builder::new()
            .prefix("openhands-agent-server-")
            .tempdir()
            .map_err(|e| format!("Failed to create OpenHands Agent Server runtime dir: {e}"))?;
        let mut tokio_command = command.tokio_command();
        tokio_command.current_dir(runtime_dir.path());
        let conversations_path_str = compute_conversations_path(workspace_skill_dir)
            .to_string_lossy()
            .into_owned();
        apply_session_env(
            &mut tokio_command,
            &session_api_key,
            Some(&conversations_path_str),
        );
        log::info!(
            "[openhands-agent-server] OH_CONVERSATIONS_PATH={}",
            conversations_path_str
        );
        let stderr_secrets = vec![session_api_key.clone()];
        let mut child = tokio_command
            .spawn()
            .map_err(|e| format!("Failed to spawn OpenHands Agent Server: {e}"))?;
        if let Some(stderr) = child.stderr.take() {
            tokio::spawn(async move {
                let mut lines = BufReader::new(stderr).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) if !line.trim().is_empty() => {
                            log::debug!(
                                "[openhands-agent-server] {}",
                                redact_stderr(&line, &stderr_secrets)
                            );
                        }
                        Ok(Some(_)) => {}
                        Ok(None) => break,
                        Err(e) => {
                            log::warn!("[openhands-agent-server] stderr read failed: {e}");
                            break;
                        }
                    }
                }
            });
        }
        let mut process = Self {
            port,
            session_api_key,
            _command: command,
            _runtime_dir: runtime_dir,
            _child: child,
        };
        if let Err(error) = process.wait_until_healthy(timeout).await {
            let _ = process.shutdown().await;
            return Err(error);
        }
        Ok(process)
    }

    pub async fn wait_until_healthy(&self, timeout: Duration) -> Result<(), String> {
        wait_until_healthy(self.port, timeout).await
    }

    pub fn is_running(&mut self) -> bool {
        match self._child.try_wait() {
            Ok(Some(status)) => {
                log::warn!("[openhands-agent-server] process exited with status {status}");
                false
            }
            Ok(None) => true,
            Err(e) => {
                log::warn!("[openhands-agent-server] failed to check process status: {e}");
                false
            }
        }
    }

    pub async fn shutdown(&mut self) -> Result<(), String> {
        if let Ok(Some(_)) = self._child.try_wait() {
            return Ok(());
        }
        self._child
            .start_kill()
            .map_err(|e| format!("Failed to stop OpenHands Agent Server: {e}"))?;
        self._child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait for OpenHands Agent Server shutdown: {e}"))?;
        Ok(())
    }
}

fn should_reuse_cached_server(is_running: bool, health_result: Result<(), String>) -> bool {
    is_running && health_result.is_ok()
}

pub fn select_random_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to reserve local OpenHands Agent Server port: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("Failed to read local OpenHands Agent Server port: {e}"))
}

pub fn redact_stderr(text: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.trim().is_empty())
        .fold(text.to_string(), |redacted, secret| {
            redacted.replace(secret, "[REDACTED]")
        })
}

async fn wait_until_healthy(port: u16, timeout: Duration) -> Result<(), String> {
    let client = reqwest::Client::new();
    let deadline = Instant::now() + timeout;
    let urls = [
        format!("http://127.0.0.1:{port}/alive"),
        format!("http://127.0.0.1:{port}/health"),
    ];

    loop {
        for url in &urls {
            if let Ok(response) = client.get(url).send().await {
                if response.status().is_success() {
                    return Ok(());
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for OpenHands Agent Server health on 127.0.0.1:{port}"
            ));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_local_port_is_loopback_and_bindable_after_selection() {
        let port = select_random_local_port().unwrap();
        assert_ne!(port, 0);

        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
        assert_eq!(listener.local_addr().unwrap().ip().to_string(), "127.0.0.1");
    }

    #[test]
    fn agent_server_command_uses_python_module_host_and_selected_port() {
        let command = OpenHandsServerCommand::new(54321);

        assert_eq!(command.program, "uvx");
        assert_eq!(command.args.first().map(String::as_str), Some("--from"));
        assert!(command
            .args
            .iter()
            .any(|arg| arg == OPENHANDS_AGENT_SERVER_PACKAGE));
        assert!(command
            .args
            .iter()
            .any(|arg| arg == OPENHANDS_TOOLS_PACKAGE));
        assert!(command
            .args
            .iter()
            .any(|arg| OPENHANDS_AGENT_SERVER_MISSING_TRANSITIVE_PACKAGES.contains(&arg.as_str())));
        assert!(command.args.iter().any(|arg| arg == "python"));

        assert!(command.args.iter().any(|arg| arg == "-m"));
        assert!(command
            .args
            .iter()
            .any(|arg| arg == "openhands.agent_server"));
        assert!(command.args.iter().any(|arg| arg == "--host"));
        assert!(command.args.iter().any(|arg| arg == "127.0.0.1"));
        assert!(command.args.iter().any(|arg| arg == "--port"));
        assert!(command.args.iter().any(|arg| arg == "54321"));
    }

    #[test]
    fn redact_stderr_replaces_known_secret_values() {
        let text = "failed with sk-test and bearer-token; sk-test again";
        let redacted = redact_stderr(text, &["sk-test".into(), "bearer-token".into()]);

        assert_eq!(
            redacted,
            "failed with [REDACTED] and [REDACTED]; [REDACTED] again"
        );
    }

    #[test]
    fn cached_server_reuse_requires_running_process_and_healthy_http_probe() {
        assert!(should_reuse_cached_server(true, Ok(())));
        assert!(!should_reuse_cached_server(false, Ok(())));
        assert!(!should_reuse_cached_server(
            true,
            Err("health check failed".to_string())
        ));
    }

    #[test]
    fn compute_conversations_path_resolves_under_workspace_skill_dir() {
        let path = compute_conversations_path(Path::new(
            "/tmp/workspace/default/skills/analyzing-bookings",
        ));
        let s = path.to_string_lossy().replace('\\', "/");
        assert!(
            s.ends_with("default/skills/analyzing-bookings/conversations"),
            "expected path to end with the skill-scoped conversations suffix; got {s}",
        );
    }

    #[test]
    fn apply_session_env_sets_conversations_path_when_present() {
        let mut cmd = tokio::process::Command::new("/usr/bin/true");
        apply_session_env(&mut cmd, "session-key-123", Some("/tmp/test/conversations"));
        let envs: Vec<(String, String)> = cmd
            .as_std()
            .get_envs()
            .filter_map(|(k, v)| {
                let key = k.to_string_lossy().into_owned();
                v.map(|val| (key, val.to_string_lossy().into_owned()))
            })
            .collect();
        assert!(
            envs.iter()
                .any(|(k, v)| k == "OH_CONVERSATIONS_PATH" && v == "/tmp/test/conversations"),
            "expected OH_CONVERSATIONS_PATH env var; got {:?}",
            envs
        );
    }

    #[test]
    fn apply_session_env_omits_conversations_path_when_none() {
        let mut cmd = tokio::process::Command::new("/usr/bin/true");
        apply_session_env(&mut cmd, "k", None);
        let has_it = cmd
            .as_std()
            .get_envs()
            .any(|(k, _)| k.to_string_lossy() == "OH_CONVERSATIONS_PATH");
        assert!(
            !has_it,
            "OH_CONVERSATIONS_PATH should be absent when path is None"
        );
    }
}
