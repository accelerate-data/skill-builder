use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir};
use std::path::Path;

const WORKFLOW_STEP_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/workflow-step.txt"
));

const ANSWER_EVALUATOR_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/answer-evaluator.txt"
));

const RESEARCH_PROMPT_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/research.txt"
));

const DETAILED_RESEARCH_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/detailed-research.txt"
));

/// Parameters for [`build_prompt`].
pub(crate) struct PromptParams<'a> {
    pub skill_name: &'a str,
    pub workspace_path: &'a str,
    pub plugin_slug: &'a str,
    pub skills_path: &'a str,
    pub author_login: Option<&'a str>,
    pub created_at: Option<&'a str>,
    pub step_id: u32,
}

fn render_workspace_prompt(
    template: &str,
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
) -> String {
    let workspace_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    template
        .trim_end_matches('\n')
        .replace("{{skill_name}}", skill_name)
        .replace("{{workspace_dir}}", &workspace_str)
}

/// Construct the agent prompt string injected into every `SidecarConfig`.
/// Embeds workspace path, skills output path, author, and date.
pub(crate) fn build_prompt(p: &PromptParams<'_>) -> String {
    let skill_name = p.skill_name;
    let workspace_path = p.workspace_path;
    let plugin_slug = p.plugin_slug;
    let skills_path = p.skills_path;
    let author_login = p.author_login;
    let created_at = p.created_at;
    let step_id = p.step_id;
    let workspace_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");

    let step_output_hint = match step_id {
        1 => " Your output MUST be a DetailedResearchOutput with top-level keys: status (\"detailed_research_complete\"), refinement_count, section_count, clarifications_json. Do NOT return a ResearchStepOutput — that is step 0's format, not yours.",
        2 => " Your output MUST be a DecisionsOutput with top-level keys: version, metadata, decisions. Do NOT return a ResearchStepOutput or DetailedResearchOutput.",
        3 => " Your output MUST include a status field.",
        _ => "",
    };

    let author_sentence = match author_login {
        Some(author) => {
            let base = format!(" The author of this skill is: {}.", author);
            if let Some(created) = created_at {
                let created_date = &created[..10.min(created.len())];
                let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
                format!("{} The skill was created on: {}. Today's date (for the modified timestamp) is: {}.", base, created_date, today)
            } else {
                base
            }
        }
        None => String::new(),
    };

    WORKFLOW_STEP_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{step_output_hint}}", step_output_hint)
        .replace("{{skill_name}}", skill_name)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{skill_output_dir}}", &skill_output_str)
        .replace("{{author_sentence}}", &author_sentence)
}

/// Build the prompt for step 0 (research).
pub(crate) fn build_step0_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    max_dimensions: u32,
) -> String {
    render_workspace_prompt(
        RESEARCH_PROMPT_TEMPLATE,
        skill_name,
        workspace_path,
        plugin_slug,
    )
    .replace("{{max_dimensions}}", &max_dimensions.to_string())
}

/// Build the prompt for step 1 (detailed research).
pub(crate) fn build_step1_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
) -> String {
    render_workspace_prompt(
        DETAILED_RESEARCH_TEMPLATE,
        skill_name,
        workspace_path,
        plugin_slug,
    )
}

/// Build the lighter prompt used by the answer-evaluator agent.
pub(crate) fn build_evaluator_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skills_path: &str,
) -> String {
    let workspace_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    ANSWER_EVALUATOR_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{skill_name}}", skill_name)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{skill_output_dir}}", &skill_output_str)
}
