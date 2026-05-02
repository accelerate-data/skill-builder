pub mod claude_md;
pub mod deploy;
pub mod evaluation;
pub mod guards;
pub mod output_format;
pub mod prompt;
pub mod runtime;
pub mod settings;
pub mod step_config;
pub mod user_context;

// Re-export items used by callers outside this module via `commands::workflow::*`.

// step_config
pub(crate) use step_config::build_betas;

// settings
pub(crate) use settings::read_initialized_runtime_context;

// deploy
pub(crate) use deploy::{
    ensure_workspace_prompts_sync, invalidate_workspace_cache, redeploy_agents,
    resolve_bundled_skills_dir, resolve_prompt_source_dirs_public,
};

// claude_md
pub(crate) use claude_md::rebuild_claude_md;

// evaluation
pub(crate) use evaluation::get_step_output_files;

// user_context
pub(crate) use user_context::write_user_context_file;

// ── LLM output coercion helpers ─────────────────────────────────────────────
// LLMs occasionally drift on JSON types: numbers as strings, strings as numbers,
// bools as strings, etc. These helpers accept the canonical type first, then
// fall back to the most common LLM drift.
//
// NOTE: With the typed contract structs in `contracts/`, most structural validation
// is now handled by serde deserialization. These helpers are retained only for the
// few remaining `serde_json::Value`-based call sites (e.g. `guards.rs`).

/// Coerce a JSON value to i64: accepts native integers or string-encoded integers.
pub(crate) fn coerce_to_i64(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
}

/// Coerce a JSON value to String: accepts strings, or stringifies numbers/bools.
#[deprecated(note = "Use typed contract structs instead of coercing serde_json::Value")]
#[allow(dead_code)]
pub(crate) fn coerce_to_string(v: &serde_json::Value) -> Option<String> {
    v.as_str().map(|s| s.to_string()).or_else(|| match v {
        serde_json::Value::Number(n) => Some(n.to_string()),
        serde_json::Value::Bool(b) => Some(b.to_string()),
        _ => None,
    })
}

/// Coerce a JSON value to bool: accepts bools or string "true"/"false".
#[deprecated(note = "Use typed contract structs instead of coercing serde_json::Value")]
#[allow(dead_code)]
pub(crate) fn coerce_to_bool(v: &serde_json::Value) -> Option<bool> {
    v.as_bool().or_else(|| match v.as_str() {
        Some("true") => Some(true),
        Some("false") => Some(false),
        _ => None,
    })
}

#[cfg(test)]
mod tests;
