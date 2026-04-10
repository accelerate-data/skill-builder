use crate::skill_paths::{resolve_skill_dir, resolve_workspace_skill_dir};
use std::path::Path;

/// Construct the agent prompt string injected into every `SidecarConfig`.
/// Embeds workspace path, skills output path, author, and date.
/// `subagent_directive` is appended as the final sentence — use it to instruct
/// the model to launch a named subagent (steps 1–3).
pub(crate) fn build_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skills_path: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
    subagent_directive: Option<&str>,
    step_id: u32,
) -> String {
    let workspace_dir = resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");
    let step_output_hint = match step_id {
        1 => " Your output MUST be a DetailedResearchOutput with top-level keys: status (\"detailed_research_complete\"), refinement_count, section_count, clarifications_json. Do NOT return a ResearchStepOutput — that is step 0's format, not yours.",
        2 => " Your output MUST be a DecisionsOutput with top-level keys: version, metadata, decisions. Do NOT return a ResearchStepOutput or DetailedResearchOutput.",
        3 => " Your output MUST include a status field.",
        _ => "",
    };
    let mut prompt = format!(
        "EXECUTE IMMEDIATELY — do not greet the user, do not ask questions, do not offer options. \
         Follow your agent instructions and produce structured JSON output.{} \
         The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         The user context file is at: {}/user-context.md. \
         The context directory is: {}/context. \
         All directories already exist — never create directories with mkdir or any other method. Never list directories with ls. Read only the specific files named in your instructions and write files directly.",
        step_output_hint,
        skill_name,
        workspace_str,
        skill_output_str,
        workspace_str,
        workspace_str,
    );

    if let Some(author) = author_login {
        prompt.push_str(&format!(" The author of this skill is: {}.", author));
        if let Some(created) = created_at {
            let created_date = &created[..10.min(created.len())];
            let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
            prompt.push_str(&format!(
                " The skill was created on: {}. Today's date (for the modified timestamp) is: {}.",
                created_date, today
            ));
        }
    }

    // Inject schema paths so agents can read the data contracts.
    let ws = workspace_path.replace('\\', "/");
    let shared_dir = format!(
        "{}/.claude/plugins/skill-content-researcher/shared",
        ws,
    );
    prompt.push_str(&format!(
        " The clarifications schema reference is at: {}/schemas.md.",
        shared_dir,
    ));
    let schema_file = match step_id {
        0 => "step-0-research.json",
        1 => "step-1-detailed-research.json",
        2 => "step-2-decisions.json",
        _ => "",
    };
    if !schema_file.is_empty() {
        prompt.push_str(&format!(
            " Your output JSON schema file is at: {}/output-schemas/{} — read this file to know the EXACT output structure. Do NOT read other step schema files.",
            shared_dir, schema_file,
        ));
    }

    prompt.push_str(" The workspace directory may contain other files written by the workflow (such as answer-evaluation.json) — read only the files explicitly named in your agent instructions. Do not read the logs/ directory or any file not named in your instructions.");

    if let Some(directive) = subagent_directive {
        prompt.push(' ');
        prompt.push_str(directive);
    }

    prompt
}

/// Build the prompt for step 0 (research) — invokes the research skill directly
/// so AskUserQuestion is one level deep and intercepted by the streaming session.
pub(crate) fn build_step0_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    max_dimensions: u32,
) -> String {
    let workspace_dir = resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let ws = workspace_path.replace('\\', "/");
    let plugin_dir = format!(
        "{}/.claude/plugins/skill-content-researcher",
        ws,
    );
    let schemas_path = format!("{}/shared/schemas.md", plugin_dir);
    let dimensions_dir = format!("{}/skills/research/references/dimensions", plugin_dir);
    format!(
        "EXECUTE IMMEDIATELY — do not ask questions, do not greet the user, do not offer options. \
         Your ONLY task: invoke the Skill tool with exactly `skill-content-researcher:research` to produce clarification questions. \
         Do NOT use `detailed-research` or any other agent/skill — ONLY `skill-content-researcher:research`. \
         Context for the skill invocation: \
         The skill name is: {}. The workspace directory is: {}. \
         The user context file is at: {}/user-context.md. \
         The context directory is: {}/context. \
         All directories already exist — never create directories with mkdir or any other method. Never list directories with ls. \
         Read only the specific files named in your instructions and write files directly. \
         The clarifications schema reference is at: {}. \
         The dimension reference files are in: {} (read individual .md files, not the directory itself). \
         The maximum research dimensions before scope warning is: {}.",
        skill_name,
        workspace_str,
        workspace_str,
        workspace_str,
        schemas_path,
        dimensions_dir,
        max_dimensions,
    )
}

/// Build the lighter prompt used by the answer-evaluator agent.
pub(crate) fn build_evaluator_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skills_path: &str,
) -> String {
    let workspace_dir = resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         The user context file is at: {}/user-context.md. \
         The context directory is: {}/context. \
         All directories already exist — do not create any directories. \
         Use user-context.md to evaluate answers in the user's specific domain. \
         Use the skill-content-researcher:answer-evaluator skill to evaluate the user's answers.",
        skill_name, workspace_str, skill_output_str,
        workspace_str, workspace_str,
    )
}
