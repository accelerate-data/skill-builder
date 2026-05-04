use std::path::{Path, PathBuf};

use tauri::Manager;
use thiserror::Error;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use super::protocol::{parse_sidecar_event, serialize_request, EvalRunResult, SidecarEvent};
use crate::agents::node_resolver::resolve_node_binary_for_preflight;

const RUNNER_FILE: &str = "runner.js";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PromptfooSidecarPathError {
    #[error("Could not find promptfoo sidecar runner -- run 'npm run build' in app/promptfoo-sidecar first")]
    Missing,
    #[error("Invalid promptfoo sidecar runner path")]
    InvalidUtf8,
}

pub async fn run_eval(
    app_handle: &tauri::AppHandle,
    request: &super::protocol::RunEvalRequest,
) -> Result<EvalRunResult, String> {
    let node_path = resolve_node_binary_for_preflight(app_handle)
        .await
        .map_err(|error| error.to_string())?;
    let runner_path =
        resolve_promptfoo_sidecar_path(app_handle).map_err(|error| error.to_string())?;
    let payload = serialize_request(request)?;

    let mut command = Command::new(&node_path);
    command.arg(&runner_path);
    command.stdin(std::process::Stdio::piped());
    command.stdout(std::process::Stdio::piped());
    command.stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    {
        command.creation_flags(0x08000000);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Failed to spawn Promptfoo sidecar: {error}"))?;

    let mut child_stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Promptfoo sidecar stdin was not available".to_string())?;
    child_stdin
        .write_all(payload.as_bytes())
        .await
        .map_err(|error| format!("Failed to write Promptfoo sidecar request: {error}"))?;
    drop(child_stdin);

    let output = child
        .wait_with_output()
        .await
        .map_err(|error| format!("Promptfoo sidecar did not finish cleanly: {error}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = if stderr.is_empty() {
            format!("Promptfoo sidecar exited with status {}", output.status)
        } else {
            format!("Promptfoo sidecar exited with status {}: {stderr}", output.status)
        };
        return Err(detail);
    }

    extract_result_from_stdout(&String::from_utf8_lossy(&output.stdout), &request.id)
}

pub fn resolve_promptfoo_sidecar_path(
    app_handle: &tauri::AppHandle,
) -> Result<String, PromptfooSidecarPathError> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        candidates.push(resource_dir.join("promptfoo-sidecar").join("dist"));
    }

    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("promptfoo-sidecar").join("dist"));
        }
    }

    if let Some(app_dir) = PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent() {
        candidates.push(app_dir.join("promptfoo-sidecar").join("dist"));
    }

    resolve_runner_from_dist_candidates(candidates)
}

pub(crate) fn resolve_runner_from_dist_candidates<I, P>(
    candidates: I,
) -> Result<String, PromptfooSidecarPathError>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    for candidate in candidates {
        let runner = candidate.as_ref().join(RUNNER_FILE);
        if runner.exists() {
            return normalize_path(&runner);
        }
    }

    Err(PromptfooSidecarPathError::Missing)
}

pub(crate) fn extract_result_from_stdout(
    stdout: &str,
    request_id: &str,
) -> Result<EvalRunResult, String> {
    let mut latest_result = None;

    for raw_line in stdout.lines() {
        let line = raw_line.trim();
        if line.is_empty() {
            continue;
        }

        match parse_sidecar_event(line)? {
            SidecarEvent::Progress { .. } => {}
            SidecarEvent::Result { id, result } => {
                if id == request_id {
                    latest_result = Some(result);
                }
            }
            SidecarEvent::Error { id, message } => {
                if id == request_id || id == "unknown" {
                    return Err(message);
                }
            }
        }
    }

    latest_result.ok_or_else(|| "Promptfoo sidecar did not return a result event".to_string())
}

fn normalize_path(path: &Path) -> Result<String, PromptfooSidecarPathError> {
    path.to_str()
        .map(|value| {
            value
                .strip_prefix("\\\\?\\")
                .unwrap_or(value)
                .replace('\\', "/")
        })
        .ok_or(PromptfooSidecarPathError::InvalidUtf8)
}
