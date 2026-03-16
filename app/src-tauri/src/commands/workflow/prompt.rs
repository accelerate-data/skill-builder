use std::path::Path;

/// Construct the agent prompt string injected into every `SidecarConfig`.
/// Embeds workspace path, skills output path, author, date, and dimension cap.
pub(crate) fn build_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
    max_dimensions: u32,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_dir = Path::new(skills_path).join(skill_name);
    let skill_output_str = skill_output_dir.to_string_lossy().replace('\\', "/");
    let mut prompt = format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — never create directories with mkdir or any other method. Never list directories with ls. Read only the specific files named in your instructions and write files directly.",
        skill_name,
        workspace_str,
        skill_output_str,
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

    prompt.push_str(&format!(
        " The maximum research dimensions before scope warning is: {}.",
        max_dimensions
    ));

    prompt.push_str(" The workspace directory may contain other files written by the workflow (such as answer-evaluation.json) — read only the files explicitly named in your agent instructions. Do not read the logs/ directory or any file not named in your instructions.");

    prompt
}

/// Build the lighter prompt used by the answer-evaluator agent.
pub(crate) fn build_evaluator_prompt(
    skill_name: &str,
    workspace_path: &str,
    skills_path: &str,
) -> String {
    let workspace_dir = Path::new(workspace_path).join(skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = Path::new(skills_path)
        .join(skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    format!(
        "The skill name is: {}. The workspace directory is: {}. \
         The skill output directory (SKILL.md and references/) is: {}. \
         Read user-context.md from the workspace directory. \
         Derive context_dir as workspace_dir/context. \
         All directories already exist — do not create any directories. \
         Use user-context.md to evaluate answers in the user's specific domain.",
        skill_name, workspace_str, skill_output_str,
    )
}
