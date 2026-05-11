use std::path::Path;

use crate::skill_paths::resolve_skill_dir;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;

pub(crate) fn new_skill_usage_session_id(skill_name: &str) -> String {
    format!("synthetic:refine:{}:{}", skill_name, uuid::Uuid::new_v4())
}

const REFINE_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/refine-initial.txt"
));

pub(super) struct RefinePromptContext<'a> {
    pub user_context_block: &'a str,
    pub clarifications_json: &'a str,
    pub decisions_json: &'a str,
}

pub(super) struct RefinePromptRequest<'a> {
    pub skill_name: &'a str,
    pub workspace_path: &'a str,
    pub plugin_slug: &'a str,
    pub skill_output_dir: &'a std::path::Path,
    pub user_message: &'a str,
    pub target_files: Option<&'a [String]>,
    pub context: RefinePromptContext<'a>,
}

pub(super) fn build_refine_prompt_with_output_dir(request: RefinePromptRequest<'_>) -> String {
    let RefinePromptRequest {
        skill_name,
        workspace_path,
        plugin_slug,
        skill_output_dir,
        user_message,
        target_files,
        context:
            RefinePromptContext {
                user_context_block,
                clarifications_json,
                decisions_json,
            },
    } = request;

    let skill_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = skill_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");
    let target_files_clause = match target_files {
        Some(files) if !files.is_empty() => format!(
            "\n\nIMPORTANT: Only edit these files: {}. Do not modify any other files.",
            files
                .iter()
                .map(|file| format!("{}/{}", skill_output_str, file))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        _ => String::new(),
    };

    REFINE_PROMPT_TEMPLATE
        .replace("{{skill_name}}", skill_name)
        .replace("{{skill_dir}}", &skill_output_str)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{target_files_clause}}", &target_files_clause)
        .replace("{{user_context_block}}", user_context_block)
        .replace("{{clarifications_json}}", clarifications_json)
        .replace("{{decisions_json}}", decisions_json)
        .replace("{{user_message}}", user_message)
}

#[cfg_attr(not(test), allow(dead_code))]
pub(super) fn build_refine_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    user_message: &str,
    target_files: Option<&[String]>,
    context: RefinePromptContext<'_>,
) -> String {
    build_refine_prompt_for_plugin(
        skill_name,
        workspace_path,
        skills_path,
        DEFAULT_PLUGIN_SLUG,
        user_message,
        target_files,
        context,
    )
}

pub(super) fn build_refine_prompt_for_plugin(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    plugin_slug: &str,
    user_message: &str,
    target_files: Option<&[String]>,
    context: RefinePromptContext<'_>,
) -> String {
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    build_refine_prompt_with_output_dir(RefinePromptRequest {
        skill_name,
        workspace_path,
        plugin_slug,
        skill_output_dir: &skill_output_dir,
        user_message,
        target_files,
        context,
    })
}
