use std::fmt;

use tokio::process::Command;

/// Result of Node.js binary resolution: the path and where it was found.
pub struct NodeResolution {
    pub path: String,
    pub source: String,
    pub version: Option<String>,
    pub meets_minimum: bool,
}

/// Structured error from `resolve_node_binary_for_preflight()` so callers can
/// pattern-match instead of parsing error strings.
#[derive(Debug)]
pub(crate) enum NodeBinaryError {
    NotFound,
    Incompatible { version: String },
}

impl fmt::Display for NodeBinaryError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotFound => write!(
                f,
                "Node.js not found. Please install Node.js 18+ from https://nodejs.org"
            ),
            Self::Incompatible { version } => write!(
                f,
                "Node.js {} is not compatible. This app requires Node.js 18+.",
                version
            ),
        }
    }
}

/// Resolve the system Node.js binary (18+ required).
///
/// Returns `NodeResolution` with full metadata (path, source, version, meets_minimum).
/// Used by `check_node` and `check_startup_deps` commands that need rich status info.
pub async fn resolve_node_binary(
    _app_handle: &tauri::AppHandle,
) -> Result<NodeResolution, String> {
    resolve_system_node().await
}

/// Internal: resolve Node.js binary path for `preflight_check()`.
///
/// Returns `Ok(path)` if a compatible Node.js (18+) is found.
/// Returns `NodeBinaryError::Incompatible` if Node is found but below v18.
/// Returns `NodeBinaryError::NotFound` if Node is not found at all.
pub(crate) async fn resolve_node_binary_for_preflight(
    app_handle: &tauri::AppHandle,
) -> Result<String, NodeBinaryError> {
    match resolve_node_binary(app_handle).await {
        Ok(resolution) if resolution.meets_minimum => Ok(resolution.path),
        Ok(resolution) => Err(NodeBinaryError::Incompatible {
            version: resolution.version.unwrap_or_else(|| "unknown".to_string()),
        }),
        Err(_) => Err(NodeBinaryError::NotFound),
    }
}

/// System Node.js discovery: searches PATH and well-known locations, validates version 18+.
async fn resolve_system_node() -> Result<NodeResolution, String> {
    let candidates: Vec<std::path::PathBuf> = {
        let mut v = vec![std::path::PathBuf::from("node")];
        for p in &[
            "/usr/local/bin/node",
            "/opt/homebrew/bin/node",
            "/usr/bin/node",
        ] {
            v.push(std::path::PathBuf::from(p));
        }
        v
    };

    let mut first_available: Option<(String, String)> = None; // (path, version)

    for candidate in &candidates {
        let mut cmd = Command::new(candidate);
        cmd.arg("--version");

        #[cfg(target_os = "windows")]
        {
            cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
        }

        let output = cmd.output().await;

        if let Ok(out) = output {
            if out.status.success() {
                let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
                let path_str = candidate.to_string_lossy().to_string();

                if first_available.is_none() {
                    first_available = Some((path_str.clone(), version.clone()));
                }

                if is_node_compatible(&version) {
                    log::info!("Using system Node.js {} at {}", version, path_str);
                    return Ok(NodeResolution {
                        path: path_str,
                        source: "system".to_string(),
                        version: Some(version),
                        meets_minimum: true,
                    });
                }
            }
        }
    }

    // Found a Node but it doesn't meet version requirements -- still return it
    // (check_node and check_startup_deps callers want a best-effort path to report the mismatch)
    if let Some((path, version)) = first_available {
        return Ok(NodeResolution {
            path,
            source: "system".to_string(),
            version: Some(version),
            meets_minimum: false,
        });
    }

    Err("Node.js not found. Install Node.js 18+ from https://nodejs.org".to_string())
}

/// Check whether a Node.js version string (e.g. "v20.11.0") has major >= 18.
pub(crate) fn is_node_compatible(version: &str) -> bool {
    let trimmed = version.strip_prefix('v').unwrap_or(version);
    if let Some(major_str) = trimmed.split('.').next() {
        if let Ok(major) = major_str.parse::<u32>() {
            return major >= 18;
        }
    }
    false
}

/// Auto-detect git-bash on Windows.
/// Checks PATH then standard install locations.
/// Public so `check_startup_deps` can call it for preflight validation.
#[cfg(target_os = "windows")]
pub fn find_git_bash() -> Option<String> {
    use std::path::PathBuf;

    // 1. Check if bash.exe is already in PATH
    if let Ok(output) = std::process::Command::new("where").arg("bash.exe").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            // `where` can return multiple lines — pick the first Git one
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("Git") && PathBuf::from(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    // 2. Check standard install locations
    let candidates = [
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ];

    for path in &candidates {
        if PathBuf::from(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_node_compatible_v18() {
        assert!(is_node_compatible("v18.0.0"));
    }

    #[test]
    fn test_is_node_compatible_v22() {
        assert!(is_node_compatible("v22.0.0"));
    }

    #[test]
    fn test_is_node_compatible_v24() {
        assert!(is_node_compatible("v24.13.0"));
    }

    #[test]
    fn test_is_node_compatible_v25() {
        assert!(is_node_compatible("v25.0.0"));
    }

    #[test]
    fn test_is_node_incompatible_v16() {
        assert!(!is_node_compatible("v16.0.0"));
    }

    #[test]
    fn test_is_node_incompatible_v17() {
        assert!(!is_node_compatible("v17.9.9"));
    }

    #[test]
    fn test_is_node_compatible_no_prefix() {
        assert!(is_node_compatible("20.11.0"));
    }

    #[test]
    fn test_is_node_compatible_empty() {
        assert!(!is_node_compatible(""));
    }

    #[test]
    fn test_is_node_compatible_garbage() {
        assert!(!is_node_compatible("abc"));
    }

    #[test]
    fn test_is_node_compatible_major_only() {
        assert!(is_node_compatible("v22"));
        assert!(!is_node_compatible("v16"));
    }

    #[test]
    fn test_is_node_compatible_boundary() {
        // Exactly v18 should pass
        assert!(is_node_compatible("v18.0.0"));
        // Just below v18 should fail
        assert!(!is_node_compatible("v17.99.99"));
    }
}
