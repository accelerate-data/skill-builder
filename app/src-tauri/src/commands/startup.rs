#[cfg(target_os = "windows")]
use crate::agents::node_resolver;
use crate::types::{DepStatus, StartupDeps};

fn dep_ok(code: &str, name: &str, detail: String) -> DepStatus {
    DepStatus {
        code: Some(code.to_string()),
        failure_kind: None,
        name: name.to_string(),
        ok: true,
        detail,
        remediation: None,
    }
}

fn dep_fail(
    code: &str,
    failure_kind: &str,
    name: &str,
    detail: String,
    remediation: impl Into<String>,
) -> DepStatus {
    DepStatus {
        code: Some(code.to_string()),
        failure_kind: Some(failure_kind.to_string()),
        name: name.to_string(),
        ok: false,
        detail,
        remediation: Some(remediation.into()),
    }
}

#[tauri::command]
pub async fn check_startup_deps(_app: tauri::AppHandle) -> Result<StartupDeps, String> {
    log::info!("[check_startup_deps]");
    let mut checks = Vec::new();

    // 1. OpenHands Agent Server Python package.
    let agent_server = check_openhands_agent_server_available().await;
    checks.push(agent_server);

    // 2. Git (required by agent runtime for version control operations)
    //    Windows: also validates git-bash for shell-compatible tool execution.
    let git_check = check_git_available().await;
    checks.push(git_check);

    let all_ok = checks.iter().all(|c| c.ok);
    Ok(StartupDeps { all_ok, checks })
}

/// Check that git is available on PATH (both platforms) and git-bash is
/// available on Windows (required by the Claude Code SDK for the Bash tool).
async fn check_git_available() -> DepStatus {
    // Check git on PATH
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
        // On Windows, also need git-bash for the SDK's Bash tool
        match (git_version, node_resolver::find_git_bash()) {
            (Some(ver), Some(bash_path)) => dep_ok(
                "git_binary",
                "Git",
                format!("{} (bash: {})", ver, bash_path),
            ),
            (Some(ver), None) => dep_fail(
                "git_binary",
                "missing_dependency",
                "Git",
                format!(
                    "{} found but bash.exe missing — install Git for Windows from https://git-scm.com/downloads/win",
                    ver
                ),
                "Install Git for Windows (includes bash.exe), then restart Skill Builder.",
            ),
            (None, Some(bash_path)) => dep_fail(
                "git_binary",
                "missing_dependency",
                "Git",
                format!("git not on PATH (bash at {})", bash_path),
                "Ensure Git is installed and available on PATH, then restart Skill Builder.",
            ),
            (None, None) => dep_fail(
                "git_binary",
                "missing_dependency",
                "Git",
                "Not found — install Git for Windows from https://git-scm.com/downloads/win"
                    .to_string(),
                "Install Git for Windows, then restart Skill Builder.",
            ),
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        match git_version {
            Some(ver) => dep_ok("git_binary", "Git", ver),
            None => dep_fail(
                "git_binary",
                "missing_dependency",
                "Git",
                "Not found — install via Xcode CLT (xcode-select --install) or https://git-scm.com"
                    .to_string(),
                "Install Git (macOS: `xcode-select --install`), then restart Skill Builder.",
            ),
        }
    }
}

async fn check_openhands_agent_server_available() -> DepStatus {
    let (program, args) = crate::agents::openhands_server::process::bundled_uv_tool_run_args();
    let script = "import openhands.agent_server; print(openhands.agent_server.__file__)";
    let mut command = tokio::process::Command::new(&program);
    command.args(&args).arg("-c").arg(script);

    match command.output().await {
        Ok(out) if out.status.success() => dep_ok(
            "openhands_agent_server",
            "OpenHands Agent Server",
            String::from_utf8_lossy(&out.stdout).trim().to_string(),
        ),
        Ok(out) => dep_fail(
            "openhands_agent_server",
            "missing_dependency",
            "OpenHands Agent Server",
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
            "The app will attempt to install the required runtime packages automatically on first use.",
        ),
        Err(e) => dep_fail(
            "openhands_agent_server",
            "missing_dependency",
            "OpenHands Agent Server",
            e.to_string(),
            "The app will attempt to install the required runtime packages automatically on first use.",
        ),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn openhands_agent_server_probe_uses_bundled_uv_or_uvx_fallback() {
        let (program, args) =
            crate::agents::openhands_server::process::bundled_uv_tool_run_args();

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
        assert!(args.iter().any(|arg| arg == "-m"));
    }
}
