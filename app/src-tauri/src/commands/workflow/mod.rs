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
pub(crate) use step_config::{build_betas, resolve_model_id};

// deploy
pub(crate) use deploy::{
    ensure_workspace_prompts_sync, invalidate_workspace_cache,
    redeploy_agents, resolve_bundled_plugins_dir, resolve_bundled_skills_dir,
    resolve_prompt_source_dirs_public,
};

// claude_md
pub(crate) use claude_md::rebuild_claude_md;

// evaluation
pub(crate) use evaluation::get_step_output_files;

// user_context
pub(crate) use user_context::write_user_context_file;

/// Coerce a JSON value to i64: accepts native integers or string-encoded integers.
/// LLMs occasionally emit numbers as strings (e.g., `"3"` instead of `3`).
pub(crate) fn coerce_to_i64(v: &serde_json::Value) -> Option<i64> {
    v.as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse::<i64>().ok()))
}

#[cfg(test)]
mod tests;
