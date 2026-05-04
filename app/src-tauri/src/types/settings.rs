use serde::{Deserialize, Serialize};
use std::collections::HashMap;

// ─── Security newtypes ──────────────────────────────────────────────────────

/// Newtype wrapper for API keys that redacts the value in Debug output.
/// Prevents API keys from leaking into Tauri debug logs.
#[derive(Clone, Serialize, Deserialize)]
pub struct ApiKey(String);

impl ApiKey {
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl std::fmt::Debug for ApiKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl From<String> for ApiKey {
    fn from(s: String) -> Self {
        ApiKey(s)
    }
}

impl AsRef<str> for ApiKey {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

// ─── marketplace.json deserialization types ──────────────────────────────────

#[derive(Debug, Deserialize)]
pub struct MarketplaceJson {
    pub name: Option<String>,
    pub metadata: Option<MarketplaceMetadata>,
    pub plugins: Vec<MarketplacePlugin>,
}

/// Optional top-level metadata block in `marketplace.json`.
#[derive(Debug, Deserialize)]
pub struct MarketplaceMetadata {
    /// Base path prepended to bare (non-`./`) source values.
    pub plugin_root: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct MarketplacePlugin {
    pub name: Option<String>,
    pub source: MarketplacePluginSource,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<MarketplaceAuthor>,
    pub category: Option<String>,
    pub tags: Option<Vec<String>>,
}

#[derive(Debug, Deserialize)]
pub struct MarketplaceAuthor {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// The `source` field in a marketplace plugin entry can be a plain string
/// (relative path such as `"./analytics-skill"`) or an object (e.g. npm, pip,
/// url). Only string sources are supported for listing; object sources are
/// skipped with a warning.
#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub enum MarketplacePluginSource {
    Path(String),
    External {
        source: String,
        #[serde(flatten)]
        extra: serde_json::Value,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceRegistry {
    pub name: String,
    pub source_url: String,
    pub enabled: bool,
}

// ─── App settings ───────────────────────────────────────────────────────────

fn default_log_level() -> String {
    "info".to_string()
}

fn default_max_dimensions() -> u32 {
    5
}

fn default_true() -> bool {
    true
}

fn trimmed_opt(value: Option<String>) -> Option<String> {
    value.and_then(|v| {
        let trimmed = v.trim().to_string();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed)
        }
    })
}

#[derive(Clone, Serialize, Deserialize)]
pub struct ModelSettings {
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub api_key: Option<crate::types::SecretString>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub api_version: Option<String>,
    #[serde(default)]
    pub temperature: Option<f64>,
    #[serde(default)]
    pub max_output_tokens: Option<u32>,
    #[serde(default)]
    pub timeout_seconds: Option<u32>,
    #[serde(default)]
    pub num_retries: Option<u32>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
    #[serde(default)]
    pub extra_headers: Option<HashMap<String, String>>,
    #[serde(default)]
    pub input_cost_per_token: Option<f64>,
    #[serde(default)]
    pub output_cost_per_token: Option<f64>,
    #[serde(default)]
    pub usage_id: Option<String>,
}

impl std::fmt::Debug for ModelSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelSettings")
            .field("provider", &self.provider)
            .field("model", &self.model)
            .field("api_key", &"[REDACTED]")
            .field("base_url", &self.base_url)
            .field("api_version", &self.api_version)
            .field("temperature", &self.temperature)
            .field("max_output_tokens", &self.max_output_tokens)
            .field("timeout_seconds", &self.timeout_seconds)
            .field("num_retries", &self.num_retries)
            .field("reasoning_effort", &self.reasoning_effort)
            .field(
                "extra_headers",
                &self
                    .extra_headers
                    .as_ref()
                    .map(|headers| headers.keys().collect::<Vec<_>>()),
            )
            .field("input_cost_per_token", &self.input_cost_per_token)
            .field("output_cost_per_token", &self.output_cost_per_token)
            .field("usage_id", &self.usage_id)
            .finish()
    }
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            provider: None,
            model: None,
            api_key: None,
            base_url: None,
            api_version: None,
            temperature: None,
            max_output_tokens: None,
            timeout_seconds: None,
            num_retries: None,
            reasoning_effort: None,
            extra_headers: None,
            input_cost_per_token: None,
            output_cost_per_token: None,
            usage_id: Some("workflow".to_string()),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct WorkflowLlmConfig {
    pub model: String,
    #[serde(rename = "apiKey", skip_serializing_if = "Option::is_none")]
    pub api_key: Option<crate::types::SecretString>,
    #[serde(rename = "baseUrl", skip_serializing_if = "Option::is_none")]
    pub base_url: Option<String>,
    #[serde(rename = "apiVersion", skip_serializing_if = "Option::is_none")]
    pub api_version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f64>,
    #[serde(rename = "maxOutputTokens", skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(rename = "timeoutSeconds", skip_serializing_if = "Option::is_none")]
    pub timeout_seconds: Option<u32>,
    #[serde(rename = "numRetries", skip_serializing_if = "Option::is_none")]
    pub num_retries: Option<u32>,
    #[serde(rename = "reasoningEffort", skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,
    #[serde(rename = "extraHeaders", skip_serializing_if = "Option::is_none")]
    pub extra_headers: Option<HashMap<String, String>>,
    #[serde(rename = "inputCostPerToken", skip_serializing_if = "Option::is_none")]
    pub input_cost_per_token: Option<f64>,
    #[serde(rename = "outputCostPerToken", skip_serializing_if = "Option::is_none")]
    pub output_cost_per_token: Option<f64>,
    #[serde(rename = "usageId", skip_serializing_if = "Option::is_none")]
    pub usage_id: Option<String>,
}

impl ModelSettings {
    pub(crate) fn normalized(mut self) -> Self {
        self.provider = trimmed_opt(self.provider);
        self.model = trimmed_opt(self.model);
        self.api_key = self.api_key.and_then(|key| {
            let trimmed = key.expose().trim().to_string();
            if trimmed.is_empty() {
                None
            } else {
                Some(crate::types::SecretString::new(trimmed))
            }
        });
        self.base_url = trimmed_opt(self.base_url);
        self.api_version = trimmed_opt(self.api_version);
        self.reasoning_effort = trimmed_opt(self.reasoning_effort);
        self.usage_id = trimmed_opt(self.usage_id);
        self.extra_headers = self.extra_headers.and_then(|headers| {
            let normalized: HashMap<String, String> = headers
                .into_iter()
                .filter_map(|(key, value)| {
                    let key = key.trim().to_string();
                    let value = value.trim().to_string();
                    if key.is_empty() || value.is_empty() {
                        None
                    } else {
                        Some((key, value))
                    }
                })
                .collect();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        });
        self
    }

    pub(crate) fn selected_workflow_llm(&self) -> Result<WorkflowLlmConfig, String> {
        let model_settings = self.clone().normalized();
        let provider = model_settings
            .provider
            .as_deref()
            .unwrap_or("anthropic")
            .to_ascii_lowercase();
        let model = model_settings.model.clone().ok_or_else(|| {
            "Model not configured. Select a model in Settings before running workflow steps."
                .to_string()
        })?;

        if let Some(base_url) = model_settings.base_url.as_deref() {
            validate_model_base_url(base_url)?;
        }
        validate_model_numbers(&model_settings)?;
        let reasoning_effort = match model_settings.reasoning_effort.as_deref() {
            None | Some("auto") => None,
            Some("low" | "medium" | "high") => model_settings.reasoning_effort,
            Some(_) => {
                return Err(
                    "Reasoning effort must be one of auto, low, medium, or high.".to_string(),
                )
            }
        };

        let local_model = provider == "ollama"
            || model.starts_with("ollama/")
            || model_settings
                .base_url
                .as_deref()
                .is_some_and(is_local_model_base_url);
        if !local_model && model_settings.api_key.is_none() {
            return Err(
                "Add an API key or configure a local provider base URL before running workflow agents."
                    .to_string(),
            );
        }

        Ok(WorkflowLlmConfig {
            model,
            api_key: model_settings.api_key,
            base_url: model_settings.base_url,
            api_version: model_settings.api_version,
            temperature: model_settings.temperature,
            max_output_tokens: model_settings.max_output_tokens,
            timeout_seconds: model_settings.timeout_seconds,
            num_retries: model_settings.num_retries,
            reasoning_effort,
            extra_headers: model_settings.extra_headers,
            input_cost_per_token: model_settings.input_cost_per_token,
            output_cost_per_token: model_settings.output_cost_per_token,
            usage_id: Some("workflow".to_string()),
        })
    }
}

fn validate_model_base_url(base_url: &str) -> Result<(), String> {
    let url = reqwest::Url::parse(base_url)
        .map_err(|_| "Base URL must be a valid HTTP(S) URL.".to_string())?;
    match url.scheme() {
        "http" | "https" => Ok(()),
        _ => Err("Base URL must be a valid HTTP(S) URL.".to_string()),
    }
}

fn is_local_model_base_url(base_url: &str) -> bool {
    reqwest::Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == "localhost" || host == "127.0.0.1" || host == "::1")
}

fn validate_model_numbers(settings: &ModelSettings) -> Result<(), String> {
    if let Some(temperature) = settings.temperature {
        if !temperature.is_finite() || !(0.0..=2.0).contains(&temperature) {
            return Err("Temperature must be between 0 and 2.".to_string());
        }
    }
    if let Some(tokens) = settings.max_output_tokens {
        if tokens == 0 {
            return Err("Max output tokens must be greater than 0.".to_string());
        }
    }
    if let Some(timeout) = settings.timeout_seconds {
        if timeout == 0 {
            return Err("Timeout must be greater than 0 seconds.".to_string());
        }
    }
    if let Some(retries) = settings.num_retries {
        if retries > 10 {
            return Err("Number of retries must be 10 or less.".to_string());
        }
    }
    if let Some(cost) = settings.input_cost_per_token {
        if !cost.is_finite() || cost < 0.0 {
            return Err("Input cost per token must be zero or greater.".to_string());
        }
    }
    if let Some(cost) = settings.output_cost_per_token {
        if !cost.is_finite() || cost < 0.0 {
            return Err("Output cost per token must be zero or greater.".to_string());
        }
    }
    Ok(())
}

#[derive(Clone, Serialize, Deserialize)]
pub struct AppSettings {
    #[serde(default)]
    pub model_settings: ModelSettings,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub skills_path: Option<String>,
    #[serde(default)]
    pub debug_mode: bool,
    /// One of "error", "warn", "info", "debug". Defaults to "info".
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default)]
    pub extended_context: bool,
    #[serde(default = "default_true")]
    pub refine_prompt_suggestions: bool,
    #[serde(default)]
    pub splash_shown: bool,
    #[serde(default)]
    pub github_oauth_token: Option<String>,
    #[serde(default)]
    pub github_user_login: Option<String>,
    #[serde(default)]
    pub github_user_avatar: Option<String>,
    #[serde(default)]
    pub github_user_email: Option<String>,
    #[serde(default)]
    pub marketplace_url: Option<String>,
    #[serde(default)]
    pub marketplace_registries: Vec<MarketplaceRegistry>,
    /// Set to true after the one-time marketplace registry migration has run.
    #[serde(default)]
    pub marketplace_initialized: bool,
    /// Set to true after the one-time legacy tag migration (`{name}/vX.Y.Z` → plugin-scoped) has run.
    #[serde(default)]
    pub legacy_tags_migrated: bool,
    #[serde(default = "default_max_dimensions")]
    pub max_dimensions: u32,
    #[serde(default)]
    pub industry: Option<String>,
    #[serde(default)]
    pub function_role: Option<String>,
    /// Dashboard view mode: "grid" | "list" | None (auto-select based on skill count)
    #[serde(default)]
    pub dashboard_view_mode: Option<String>,
    /// Automatically apply marketplace updates at startup (default: false).
    #[serde(default)]
    pub auto_update: bool,
}

impl std::fmt::Debug for AppSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppSettings")
            .field("model_settings", &self.model_settings)
            .field("workspace_path", &self.workspace_path)
            .field("skills_path", &self.skills_path)
            .field("debug_mode", &self.debug_mode)
            .field("log_level", &self.log_level)
            .field("extended_context", &self.extended_context)
            .field("refine_prompt_suggestions", &self.refine_prompt_suggestions)
            .field("splash_shown", &self.splash_shown)
            .field("github_oauth_token", &"[REDACTED]")
            .field("github_user_login", &self.github_user_login)
            .field("github_user_avatar", &self.github_user_avatar)
            .field("github_user_email", &self.github_user_email)
            .field("marketplace_url", &self.marketplace_url)
            .field("marketplace_registries", &self.marketplace_registries)
            .field("marketplace_initialized", &self.marketplace_initialized)
            .field("legacy_tags_migrated", &self.legacy_tags_migrated)
            .field("max_dimensions", &self.max_dimensions)
            .field("industry", &self.industry)
            .field("function_role", &self.function_role)
            .field("dashboard_view_mode", &self.dashboard_view_mode)
            .field("auto_update", &self.auto_update)
            .finish()
    }
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            model_settings: ModelSettings::default(),
            workspace_path: None,
            skills_path: None,
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            refine_prompt_suggestions: true,
            splash_shown: false,
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
            marketplace_url: None,
            marketplace_registries: vec![],
            marketplace_initialized: false,
            legacy_tags_migrated: false,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
            auto_update: false,
        }
    }
}
