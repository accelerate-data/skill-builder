use std::path::{Path, PathBuf};

use tauri::Manager;
use thiserror::Error;

const RUNNER_FILE: &str = "runner.js";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PromptfooSidecarPathError {
    #[error("Could not find promptfoo sidecar runner -- run 'npm run build' in app/promptfoo-sidecar first")]
    Missing,
    #[error("Invalid promptfoo sidecar runner path")]
    InvalidUtf8,
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
