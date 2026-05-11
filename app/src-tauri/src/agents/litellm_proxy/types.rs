use serde::{Deserialize, Serialize};

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct CreateUserResponse {
    pub user_id: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct GenerateKeyResponse {
    pub key: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfoResponse {
    pub key: String,
    pub info: KeyInfo,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfo {
    pub spend: f64,
    pub models: Vec<String>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct CreateUserRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_budget: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm_limit: Option<u64>,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Serialize)]
pub struct GenerateKeyRequest {
    pub user_id: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub models: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_budget: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget_duration: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rpm_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_max_budget: Option<std::collections::HashMap<String, f64>>,
}
