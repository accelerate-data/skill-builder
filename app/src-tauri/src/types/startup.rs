use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeStatus {
    pub available: bool,
    pub version: Option<String>,
    pub meets_minimum: bool,
    pub error: Option<String>,
    /// Where the Node.js binary was found: "bundled", "system", or "" on failure.
    #[serde(default)]
    pub source: String,
}

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
