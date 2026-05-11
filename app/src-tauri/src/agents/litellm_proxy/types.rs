#![allow(dead_code)]

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Deserialize)]
pub struct HealthResponse {
    pub status: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CreateUserResponse {
    pub user_id: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GenerateKeyResponse {
    pub key: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfoResponse {
    pub key: String,
    pub info: KeyInfo,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KeyInfo {
    pub spend: f64,
    pub models: Vec<String>,
}

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
}
