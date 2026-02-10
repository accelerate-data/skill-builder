use crate::types::NodeStatus;

#[tauri::command]
pub async fn check_node() -> Result<NodeStatus, String> {
    let output = tokio::process::Command::new("node")
        .arg("--version")
        .output()
        .await;

    match output {
        Ok(output) if output.status.success() => {
            let version_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let meets_minimum = parse_meets_minimum(&version_str, 18);

            Ok(NodeStatus {
                available: true,
                version: Some(version_str),
                meets_minimum,
                error: None,
            })
        }
        Ok(output) => Ok(NodeStatus {
            available: false,
            version: None,
            meets_minimum: false,
            error: Some(format!(
                "Node.js exited with status {}: {}",
                output.status,
                String::from_utf8_lossy(&output.stderr).trim()
            )),
        }),
        Err(_) => Ok(NodeStatus {
            available: false,
            version: None,
            meets_minimum: false,
            error: Some(
                "Node.js not found. Please install Node.js 18+ from https://nodejs.org".to_string(),
            ),
        }),
    }
}

/// Parse a version string like "v20.11.0" and check if major >= min_major.
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
