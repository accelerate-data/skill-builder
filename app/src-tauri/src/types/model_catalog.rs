use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

// ─── Upstream models.dev mirror types ────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogProvider {
    pub id: String,
    pub env: Vec<String>,
    pub npm: String,
    pub api: Option<String>,
    pub name: String,
    pub doc: String,
    pub models: BTreeMap<String, CatalogModel>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogModel {
    pub id: String,
    pub name: String,
    pub family: Option<String>,
    pub attachment: bool,
    pub reasoning: bool,
    pub tool_call: bool,
    pub structured_output: Option<bool>,
    pub temperature: Option<bool>,
    pub knowledge: Option<String>,
    pub release_date: String,
    pub last_updated: String,
    pub modalities: CatalogModalities,
    pub open_weights: bool,
    pub cost: Option<CatalogCost>,
    pub limit: CatalogLimit,
    pub interleaved: Option<serde_json::Value>,
    pub provider: Option<serde_json::Value>,
    pub status: Option<String>,
    pub experimental: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogModalities {
    #[serde(default)]
    pub input: Vec<String>,
    #[serde(default)]
    pub output: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogCost {
    #[serde(default)]
    pub input: Option<f64>,
    #[serde(default)]
    pub output: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogLimit {
    #[serde(default)]
    pub context: Option<i64>,
}

// ─── DB row structs ─────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct ProviderCatalogRow {
    pub provider_id: String,
    pub name: String,
    pub npm: String,
    pub api_base_url: Option<String>,
    pub doc_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelCatalogEntry {
    pub full_id: String,
    pub provider_id: String,
    pub model_id: String,
    pub name: String,
    pub family: Option<String>,
    pub attachment: bool,
    pub reasoning: bool,
    pub tool_call: bool,
    pub structured_output: Option<bool>,
    pub temperature: Option<bool>,
    pub knowledge: Option<String>,
    pub release_date: String,
    pub last_updated: String,
    pub open_weights: bool,
    pub input_cost_per_token: Option<f64>,
    pub output_cost_per_token: Option<f64>,
    pub context_limit: Option<i64>,
    pub interleaved: Option<serde_json::Value>,
    pub status: Option<String>,
    pub experimental: Option<bool>,
    pub input_modalities: Vec<String>,
    pub output_modalities: Vec<String>,
}

// ─── Filter DTO ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelFilter {
    pub field: String,
    pub op: String,
    pub value: serde_json::Value,
}
