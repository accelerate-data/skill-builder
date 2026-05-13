use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};

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

// ─── New model settings contract (PR 4) ─────────────────────────────────────

/// Per-provider runtime overrides keyed by provider id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ProviderOverride {
    #[serde(default)]
    pub api_key: Option<crate::types::SecretString>,
    #[serde(default, rename = "base_url_override")]
    pub base_url_override: Option<String>,
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

impl Default for ProviderOverride {
    fn default() -> Self {
        Self {
            api_key: None,
            base_url_override: None,
            api_version: None,
            temperature: None,
            max_output_tokens: None,
            timeout_seconds: Some(300),
            num_retries: Some(5),
            reasoning_effort: Some("auto".to_string()),
            extra_headers: None,
            input_cost_per_token: None,
            output_cost_per_token: None,
            usage_id: Some("workflow".to_string()),
        }
    }
}

/// Active model selection plus per-provider overrides.
#[derive(Clone, Serialize, Deserialize)]
pub struct ModelSettings {
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub provider_overrides: BTreeMap<String, ProviderOverride>,
}

impl std::fmt::Debug for ModelSettings {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModelSettings")
            .field("provider_id", &self.provider_id)
            .field("model_id", &self.model_id)
            .field(
                "provider_overrides",
                &self.provider_overrides.keys().collect::<Vec<_>>(),
            )
            .finish()
    }
}

impl Default for ModelSettings {
    fn default() -> Self {
        Self {
            provider_id: None,
            model_id: None,
            provider_overrides: BTreeMap::new(),
        }
    }
}

impl ModelSettings {
    fn normalize_runtime_model_id(provider_id: &str, model_id: String) -> String {
        let legacy_prefix = format!("{provider_id}:");
        model_id
            .strip_prefix(&legacy_prefix)
            .map_or(model_id.clone(), str::to_string)
    }

    pub(crate) fn normalized(mut self) -> Self {
        self.provider_id = trimmed_opt(self.provider_id);
        self.model_id = trimmed_opt(self.model_id);
        for override_value in self.provider_overrides.values_mut() {
            override_value.api_key = override_value.api_key.take().and_then(|key| {
                let trimmed = key.expose().trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(crate::types::SecretString::new(trimmed))
                }
            });
            override_value.base_url_override = trimmed_opt(override_value.base_url_override.clone());
            override_value.api_version = trimmed_opt(override_value.api_version.clone());
            override_value.reasoning_effort = trimmed_opt(override_value.reasoning_effort.clone());
            override_value.usage_id = trimmed_opt(override_value.usage_id.clone());
            override_value.extra_headers = override_value.extra_headers.take().and_then(|headers| {
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
        }
        self
    }

    /// Resolve the active provider override, falling back to defaults.
    fn active_override(&self) -> ProviderOverride {
        self.provider_id
            .as_ref()
            .and_then(|pid| self.provider_overrides.get(pid))
            .cloned()
            .unwrap_or_default()
    }

    pub(crate) fn selected_workflow_llm(&self) -> Result<WorkflowLlmConfig, String> {
        let settings = self.clone().normalized();
        let provider = settings.provider_id.as_deref().unwrap_or("").to_ascii_lowercase();
        let raw_model = settings.model_id.clone().ok_or_else(|| {
            "Model not configured. Select a model in Settings before running workflow steps."
                .to_string()
        })?;
        let model = Self::normalize_runtime_model_id(&provider, raw_model);

        let override_cfg = settings.active_override();

        if let Some(base_url) = override_cfg.base_url_override.as_deref() {
            validate_model_base_url(base_url)?;
        }
        validate_model_numbers(&override_cfg)?;
        let reasoning_effort = match override_cfg.reasoning_effort.as_deref() {
            None | Some("auto") => None,
            Some("low" | "medium" | "high") => override_cfg.reasoning_effort,
            Some(_) => {
                return Err(
                    "Reasoning effort must be one of auto, low, medium, or high.".to_string(),
                )
            }
        };

        let local_model = provider == "ollama"
            || model.starts_with("ollama/")
            || override_cfg
                .base_url_override
                .as_deref()
                .is_some_and(is_local_model_base_url);
        if !local_model && override_cfg.api_key.is_none() {
            return Err(
                "Add an API key or configure a local provider base URL before running workflow agents."
                    .to_string(),
            );
        }

        Ok(WorkflowLlmConfig {
            model,
            api_key: override_cfg.api_key,
            base_url: override_cfg.base_url_override,
            api_version: override_cfg.api_version,
            temperature: override_cfg.temperature,
            max_output_tokens: override_cfg.max_output_tokens,
            timeout_seconds: override_cfg.timeout_seconds,
            num_retries: override_cfg.num_retries,
            reasoning_effort,
            extra_headers: override_cfg.extra_headers,
            input_cost_per_token: override_cfg.input_cost_per_token,
            output_cost_per_token: override_cfg.output_cost_per_token,
            usage_id: Some("workflow".to_string()),
        })
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

fn validate_model_numbers(settings: &ProviderOverride) -> Result<(), String> {
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
