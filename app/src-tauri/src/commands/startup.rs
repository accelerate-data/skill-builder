#[cfg(target_os = "windows")]
use crate::agents::node_resolver;
use crate::types::{BootstrapCheck, BootstrapStatus, StartupResult};
use std::time::Duration;

fn check_ok(name: &str, detail: String) -> BootstrapCheck {
    BootstrapCheck {
        name: name.to_string(),
        ok: true,
        detail,
    }
}

fn check_fail(name: &str, detail: String) -> BootstrapCheck {
    BootstrapCheck {
        name: name.to_string(),
        ok: false,
        detail,
    }
}

#[tauri::command]
pub async fn check_startup_deps(_app: tauri::AppHandle) -> Result<StartupResult, String> {
    log::info!("[check_startup_deps]");
    let mut checks = Vec::new();

    let agent_server = check_openhands_agent_server_available().await;
    checks.push(agent_server);

    let git_check = check_git_available().await;
    checks.push(git_check);

    let all_ok = checks.iter().all(|c| c.ok);
    let status = if all_ok {
        BootstrapStatus::Ready
    } else {
        let failed: Vec<&BootstrapCheck> = checks.iter().filter(|c| !c.ok).collect();
        BootstrapStatus::Failed {
            detail: format!(
                "{} check(s) failed: {}",
                failed.len(),
                failed
                    .iter()
                    .map(|c| c.name.as_str())
                    .collect::<Vec<_>>()
                    .join(", ")
            ),
            remediation: Some(
                "The app will attempt to install missing runtime packages automatically."
                    .to_string(),
            ),
        }
    };

    Ok(StartupResult { status, checks })
}

#[tauri::command]
pub async fn ensure_openhands_runtime_ready(
    data_dir: tauri::State<'_, crate::DataDir>,
) -> Result<(), String> {
    log::info!("[ensure_openhands_runtime_ready]");
    crate::agents::openhands_server::process::ensure_agent_server(
        Duration::from_secs(60),
        &data_dir.0,
    )
    .await
    .map(|_| ())
}

/// Check that git is available on PATH (both platforms) and git-bash is
/// available on Windows (required by the Claude Code SDK for the Bash tool).
async fn check_git_available() -> BootstrapCheck {
    let git_output = tokio::process::Command::new("git")
        .arg("--version")
        .output()
        .await;

    let git_version = match git_output {
        Ok(out) if out.status.success() => {
            Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
        }
        _ => None,
    };

    #[cfg(target_os = "windows")]
    {
        match (git_version, node_resolver::find_git_bash()) {
            (Some(ver), Some(bash_path)) => {
                check_ok("Git", format!("{} (bash: {})", ver, bash_path))
            }
            (Some(ver), None) => check_fail("Git", format!("{} found but bash.exe missing", ver)),
            (None, Some(bash_path)) => check_fail(
                "Git",
                format!("git not on PATH (git-bash found at {})", bash_path),
            ),
            (None, None) => check_fail("Git", "Not found".to_string()),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        match git_version {
            Some(ver) => check_ok("Git", ver),
            None => check_fail("Git", "Not found".to_string()),
        }
    }
}

async fn check_openhands_agent_server_available() -> BootstrapCheck {
    let (program, args) = crate::agents::openhands_server::process::bundled_uv_python_run_args();
    let script = "import openhands.agent_server; print(openhands.agent_server.__file__)";
    let mut command = tokio::process::Command::new(&program);
    command.args(&args).arg("-c").arg(script);

    match command.output().await {
        Ok(out) if out.status.success() => check_ok(
            "OpenHands Agent Server",
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        ),
        Ok(out) => check_fail(
            "OpenHands Agent Server",
            format!(
                "Not available: {}",
                String::from_utf8_lossy(&out.stderr).trim()
            ),
        ),
        Err(e) => check_fail("OpenHands Agent Server", format!("Not available: {e}")),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn openhands_agent_server_probe_uses_bundled_uv_or_uvx_fallback() {
        let (program, args) =
            crate::agents::openhands_server::process::bundled_uv_python_run_args();

        // Without init_bundled_uv_path called, falls back to uvx
        assert_eq!(program, "uvx");
        assert_eq!(args.first().map(String::as_str), Some("--from"));
        assert!(args
            .iter()
            .any(|arg| arg
                == crate::agents::openhands_server::process::OPENHANDS_AGENT_SERVER_PACKAGE));
        assert!(args
            .iter()
            .any(|arg| arg == crate::agents::openhands_server::process::OPENHANDS_TOOLS_PACKAGE));
        assert!(args.iter().any(|arg| arg == "python"));
        assert!(!args.iter().any(|arg| arg == "-m"));
    }
}
