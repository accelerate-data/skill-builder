use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "status")]
pub enum BootstrapStatus {
    Ready,
    Failed { detail: String, remediation: Option<String> },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BootstrapCheck {
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupResult {
    pub status: BootstrapStatus,
    pub checks: Vec<BootstrapCheck>,
}

// Legacy types — deprecated, use BootstrapCheck / StartupResult instead.
#[deprecated(since = "0.1.0", note = "use BootstrapCheck and StartupResult")]
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepStatus {
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub failure_kind: Option<String>,
    pub name: String,
    pub ok: bool,
    pub detail: String,
    #[serde(default)]
    pub remediation: Option<String>,
}

#[deprecated(since = "0.1.0", note = "use StartupResult")]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[allow(deprecated)]
pub struct StartupDeps {
    pub all_ok: bool,
    pub checks: Vec<DepStatus>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_status_ready_serializes_as_internally_tagged() {
        let status = BootstrapStatus::Ready;
        let json = serde_json::to_string(&status).unwrap();
        assert_eq!(json, r#"{"status":"Ready"}"#);
    }

    #[test]
    fn bootstrap_status_failed_serializes_as_internally_tagged() {
        let status = BootstrapStatus::Failed {
            detail: "check failed".to_string(),
            remediation: Some("retry".to_string()),
        };
        let json = serde_json::to_string(&status).unwrap();
        assert!(json.contains(r#""status":"Failed""#));
        assert!(json.contains(r#""detail":"check failed""#));
        assert!(json.contains(r#""remediation":"retry""#));
    }

    #[test]
    fn startup_result_serializes_with_expected_shape() {
        let result = StartupResult {
            status: BootstrapStatus::Ready,
            checks: vec![
                BootstrapCheck {
                    name: "Git".to_string(),
                    ok: true,
                    detail: "git version 2.49.0".to_string(),
                },
            ],
        };
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["status"]["status"], "Ready");
        assert_eq!(json["checks"][0]["name"], "Git");
        assert_eq!(json["checks"][0]["ok"], true);
    }
}
