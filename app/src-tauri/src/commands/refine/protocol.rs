use std::path::Path;

use crate::skill_paths::resolve_skill_dir;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

pub(super) fn new_refine_usage_session_id(skill_name: &str) -> String {
    format!("synthetic:refine:{}:{}", skill_name, uuid::Uuid::new_v4())
}

pub(super) fn ensure_skill_workspace_dir(
    workspace_path: &str,
    plugin_slug: &str,
    skill_name: &str,
) {
    let skill_workspace_dir =
        crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    if !skill_workspace_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&skill_workspace_dir) {
            log::warn!(
                "[ensure_skill_workspace_dir] failed to create skill workspace dir '{}': {}",
                skill_workspace_dir.display(),
                e
            );
        } else {
            log::debug!(
                "[ensure_skill_workspace_dir] created skill workspace dir '{}'",
                skill_workspace_dir.display()
            );
        }
    }
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_followup_prompt(
    user_message: &str,
    skills_path: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    build_followup_prompt_for_plugin(
        user_message,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        skill_name,
        target_files,
    )
}

pub(super) fn build_followup_prompt_for_plugin(
    user_message: &str,
    skills_path: &str,
    plugin_slug: &str,
    skill_name: &str,
    target_files: Option<&[String]>,
) -> String {
    let skill_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    build_followup_prompt_with_output_dir(user_message, &skill_dir, target_files)
}

const REFINE_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/refine-initial.txt"
));

const REFINE_FOLLOWUP_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/refine-followup.txt"
));

pub(super) fn build_refine_prompt_with_output_dir(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skill_output_dir: &std::path::Path,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let workspace_dir =
        crate::skill_paths::workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");
    let context_str = format!("{}/context", workspace_str);

    let target_files_clause = match target_files {
        Some(files) if !files.is_empty() => format!(
            "\n\nIMPORTANT: Only edit these files (relative to skill output directory): {}. Do not modify any other files.",
            files.join(", ")
        ),
        _ => String::new(),
    };

    REFINE_PROMPT_TEMPLATE
        .replace("{{skill_name}}", skill_name)
        .replace("{{skill_dir}}", &skill_output_str)
        .replace("{{context_dir}}", &context_str)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{target_files_clause}}", &target_files_clause)
        .replace("{{user_message}}", user_message)
}

pub(super) fn build_followup_prompt_with_output_dir(
    user_message: &str,
    skill_output_dir: &std::path::Path,
    target_files: Option<&[String]>,
) -> String {
    let target_files_clause = match target_files {
        Some(files) if !files.is_empty() => {
            let skill_dir_str = skill_output_dir.to_string_lossy().replace('\\', "/");
            let abs_files: Vec<String> = files
                .iter()
                .map(|f| format!("{}/{}", skill_dir_str, f))
                .collect();
            format!(
                "IMPORTANT: Only edit these files: {}. Do not modify any other files.\n\n",
                abs_files.join(", ")
            )
        }
        _ => String::new(),
    };
    REFINE_FOLLOWUP_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{target_files_clause}}", &target_files_clause)
        .replace("{{user_message}}", user_message)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    build_refine_prompt_for_plugin(
        skill_name,
        workspace_path,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        user_message,
        target_files,
    )
}

pub(super) fn build_refine_prompt_for_plugin(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    plugin_slug: &str,
    user_message: &str,
    target_files: Option<&[String]>,
) -> String {
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    build_refine_prompt_with_output_dir(
        skill_name,
        workspace_path,
        plugin_slug,
        &skill_output_dir,
        user_message,
        target_files,
    )
}
