#![allow(unused_imports)]
pub mod claude_md;
pub mod deploy;
pub mod evaluation;
pub mod output_format;
pub mod packaging;
pub mod runtime;
pub mod step_config;

// Re-export everything so callers using `commands::workflow::*` continue to work.

// step_config
pub(crate) use step_config::{build_betas, resolve_model_id};

// deploy
pub(crate) use deploy::{
    ensure_workspace_prompts, ensure_workspace_prompts_sync, invalidate_workspace_cache,
    redeploy_agents, resolve_bundled_plugins_dir, resolve_bundled_skills_dir,
    resolve_prompt_source_dirs_public,
};

// claude_md
pub(crate) use claude_md::{rebuild_claude_md, update_skills_section};

// output_format
pub(crate) use output_format::{materialize_answer_evaluation_output, materialize_workflow_step_output};

// packaging
pub(crate) use packaging::package_skill;

// evaluation
pub(crate) use evaluation::{
    get_clarifications_content, get_context_file_content, get_decisions_content,
    get_disabled_steps, get_step_output_files, get_workflow_state, navigate_back_to_step,
    preview_step_reset, reset_legacy_skills, reset_workflow_step, save_clarifications_content,
    save_decisions_content, save_workflow_state, scan_legacy_clarifications, verify_step_output,
};

// runtime
pub(crate) use runtime::{
    format_user_context, log_gate_decision, run_answer_evaluator, run_workflow_step,
    write_user_context_file,
};

#[cfg(test)]
mod tests;
