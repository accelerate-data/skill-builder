use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepStatus {
    /// Stable machine-readable identifier for this check.
    #[serde(default)]
    pub code: Option<String>,
    /// Failure class used by frontend messaging ("compatibility", "transient", "missing_dependency", etc).
    #[serde(default)]
    pub failure_kind: Option<String>,
    pub name: String,
    pub ok: bool,
    pub detail: String,
    /// Actionable remediation guidance for failed checks.
    #[serde(default)]
    pub remediation: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupDeps {
    pub all_ok: bool,
    pub checks: Vec<DepStatus>,
}
