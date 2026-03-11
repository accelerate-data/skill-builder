use crate::agents::sidecar_pool;
use crate::types::{DepStatus, NodeStatus, StartupDeps};

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
pub async fn check_node(app: tauri::AppHandle) -> Result<NodeStatus, String> {
    log::info!("[check_node]");
    match sidecar_pool::resolve_node_binary(&app).await {
        Ok(resolution) => {
            let meets_minimum = resolution.meets_minimum;
            let error = if !meets_minimum {
                resolution.version.as_ref().map(|v| {
                    format!(
                        "Node.js {} found ({}) but version 18-24 is required",
                        v, resolution.source
                    )
                })
            } else {
                None
            };

            Ok(NodeStatus {
                available: true,
                version: resolution.version,
                meets_minimum,
                error,
                source: resolution.source,
            })
        }
        Err(e) => Ok(NodeStatus {
            available: false,
            version: None,
            meets_minimum: false,
            error: Some(e),
            source: String::new(),
        }),
    }
}

#[tauri::command]
pub async fn check_startup_deps(app: tauri::AppHandle) -> Result<StartupDeps, String> {
    log::info!("[check_startup_deps]");
    let mut checks = Vec::new();

    // 1. Node.js
    let node = match sidecar_pool::resolve_node_binary(&app).await {
        Ok(res) if res.meets_minimum => dep_ok(
            "node_runtime",
            "Node.js",
            format!("{} ({})", res.version.unwrap_or_default(), res.source),
        ),
        Ok(res) => dep_fail(
            "node_runtime",
            "compatibility",
            "Node.js",
            format!(
                "{} found ({}) — need 18-24",
                res.version.unwrap_or("unknown".to_string()),
                res.source
            ),
            "Install Node.js 18-24 from https://nodejs.org and restart Skill Builder.",
        ),
        Err(e) => dep_fail(
            "node_runtime",
            "missing_dependency",
            "Node.js",
            e,
            "Install Node.js 18-24 from https://nodejs.org and restart Skill Builder.",
        ),
    };
    checks.push(node);

    // 2. Sidecar (agent-runner.js)
    let sidecar = match sidecar_pool::resolve_sidecar_path_public(&app) {
        Ok(path) => dep_ok("agent_sidecar_bundle", "Agent sidecar", path),
        Err(e) => dep_fail(
            "agent_sidecar_bundle",
            "missing_dependency",
            "Agent sidecar",
            e,
            "From the repository root run: `cd app && npm run sidecar:build`, then restart Skill Builder.",
        ),
    };
    checks.push(sidecar);

    // 3. SDK CLI (cli.js)
    let sdk = match crate::agents::sidecar::resolve_sdk_cli_path_public(&app) {
        Ok(path) => dep_ok("claude_sdk_cli", "Claude SDK", path),
        Err(e) => dep_fail(
            "claude_sdk_cli",
            "missing_dependency",
            "Claude SDK",
            e,
            "From the repository root run: `cd app && npm run sidecar:build`, then restart Skill Builder.",
        ),
    };
    checks.push(sdk);

    // 4. Git (required by Claude Code for version control operations)
    //    Windows: also validates git-bash which the SDK needs for the Bash tool
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
        match (git_version, sidecar_pool::find_git_bash()) {
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

/// Parse a version string like "v20.11.0" and check if major >= min_major.
#[cfg(test)]
fn parse_meets_minimum(version: &str, min_major: u32) -> bool {
    let trimmed = version.strip_prefix('v').unwrap_or(version);
    let parts: Vec<&str> = trimmed.split('.').collect();
    if let Some(major_str) = parts.first() {
        if let Ok(major) = major_str.parse::<u32>() {
            return major >= min_major;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_v20_meets_min_18() {
        assert!(parse_meets_minimum("v20.11.0", 18));
    }

    #[test]
    fn test_v18_meets_min_18() {
        assert!(parse_meets_minimum("v18.0.0", 18));
    }

    #[test]
    fn test_v16_does_not_meet_min_18() {
        assert!(!parse_meets_minimum("v16.0.0", 18));
    }

    #[test]
    fn test_no_v_prefix_meets_min() {
        assert!(parse_meets_minimum("20.11.0", 18));
    }

    #[test]
    fn test_empty_string() {
        assert!(!parse_meets_minimum("", 18));
    }

    #[test]
    fn test_garbage_string() {
        assert!(!parse_meets_minimum("abc", 18));
    }
}
