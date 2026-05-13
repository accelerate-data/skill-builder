use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum BootstrapStatus {
    Ready,
    Installing { detail: String },
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

// Legacy aliases for backward compatibility during transition
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StartupDeps {
    pub all_ok: bool,
    pub checks: Vec<DepStatus>,
}
