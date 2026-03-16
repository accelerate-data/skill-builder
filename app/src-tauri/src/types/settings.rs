use serde::{Deserialize, Serialize};

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

#[derive(Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub anthropic_api_key: Option<String>,
    pub workspace_path: Option<String>,
    #[serde(default)]
    pub skills_path: Option<String>,
    pub preferred_model: Option<String>,
    #[serde(default)]
    pub debug_mode: bool,
    /// One of "error", "warn", "info", "debug". Defaults to "info".
    #[serde(default = "default_log_level")]
    pub log_level: String,
    #[serde(default)]
    pub extended_context: bool,
    #[serde(default)]
    pub extended_thinking: bool,
    #[serde(default = "default_true")]
    pub interleaved_thinking_beta: bool,
    #[serde(default)]
    pub sdk_effort: Option<String>,
    #[serde(default)]
    pub fallback_model: Option<String>,
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
            .field("anthropic_api_key", &"[REDACTED]")
            .field("workspace_path", &self.workspace_path)
            .field("skills_path", &self.skills_path)
            .field("preferred_model", &self.preferred_model)
            .field("debug_mode", &self.debug_mode)
            .field("log_level", &self.log_level)
            .field("extended_context", &self.extended_context)
            .field("extended_thinking", &self.extended_thinking)
            .field("interleaved_thinking_beta", &self.interleaved_thinking_beta)
            .field("sdk_effort", &self.sdk_effort)
            .field("fallback_model", &self.fallback_model)
            .field("refine_prompt_suggestions", &self.refine_prompt_suggestions)
            .field("splash_shown", &self.splash_shown)
            .field("github_oauth_token", &"[REDACTED]")
            .field("github_user_login", &self.github_user_login)
            .field("github_user_avatar", &self.github_user_avatar)
            .field("github_user_email", &self.github_user_email)
            .field("marketplace_url", &self.marketplace_url)
            .field("marketplace_registries", &self.marketplace_registries)
            .field("marketplace_initialized", &self.marketplace_initialized)
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
            anthropic_api_key: None,
            workspace_path: None,
            skills_path: None,
            preferred_model: None,
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            interleaved_thinking_beta: true,
            sdk_effort: None,
            fallback_model: None,
            refine_prompt_suggestions: true,
            splash_shown: false,
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
            marketplace_url: None,
            marketplace_registries: vec![],
            marketplace_initialized: false,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
            auto_update: false,
        }
    }
}
