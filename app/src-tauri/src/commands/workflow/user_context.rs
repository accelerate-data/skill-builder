use std::path::Path;

/// Write `user-context.md` to the workspace so sub-agents can read it from disk.
/// Captures purpose, description, user context, industry, function/role,
/// and behaviour settings provided by the user.
/// Non-fatal: logs a warning on failure rather than blocking the workflow.
#[allow(clippy::too_many_arguments)]
pub fn write_user_context_file(
    workspace_path: &str,
    skill_name: &str,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) {
    let Some(ctx) = format_user_context(
        Some(skill_name),
        tags,
        industry,
        function_role,
        intake_json,
        description,
        purpose,
        version,
        skill_model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
    ) else {
        return;
    };

    let workspace_dir = Path::new(workspace_path).join(skill_name);
    // Safety net: create directory if missing
    if let Err(e) = std::fs::create_dir_all(&workspace_dir) {
        log::warn!(
            "[write_user_context_file] Failed to create dir {}: {}",
            workspace_dir.display(),
            e
        );
        return;
    }
    let file_path = workspace_dir.join("user-context.md");
    let content = format!(
        "# User Context\n\n{}\n",
        ctx.strip_prefix("## User Context\n\n").unwrap_or(&ctx)
    );

    match std::fs::write(&file_path, &content) {
        Ok(()) => {
            log::info!(
                "[write_user_context_file] Wrote user-context.md ({} bytes) to {}",
                content.len(),
                file_path.display()
            );
        }
        Err(e) => {
            log::warn!(
                "[write_user_context_file] Failed to write {}: {}",
                file_path.display(),
                e
            );
        }
    }
}

/// Format user context fields into a `## User Context` markdown block.
///
/// Shared by `write_user_context_file` (for file-based agents) and
/// `build_prompt` / refine's `send_refine_message` (for inline embedding).
/// Returns `None` when all fields are empty.
#[allow(clippy::too_many_arguments)]
pub fn format_user_context(
    name: Option<&str>,
    tags: &[String],
    industry: Option<&str>,
    function_role: Option<&str>,
    intake_json: Option<&str>,
    description: Option<&str>,
    purpose: Option<&str>,
    version: Option<&str>,
    skill_model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Option<String> {
    /// Push `**label**: value` to `parts` when `opt` is non-empty.
    fn push_field(parts: &mut Vec<String>, label: &str, opt: Option<&str>) {
        if let Some(v) = opt.filter(|s| !s.is_empty()) {
            parts.push(format!("**{}**: {}", label, v));
        }
    }

    /// Build a markdown subsection from `parts`, or return None if empty.
    fn build_subsection(heading: &str, parts: Vec<String>) -> Option<String> {
        if parts.is_empty() {
            None
        } else {
            Some(format!("### {}\n{}", heading, parts.join("\n")))
        }
    }

    let mut sections: Vec<String> = Vec::new();

    // --- Skill identity ---
    let mut skill_parts: Vec<String> = Vec::new();
    push_field(&mut skill_parts, "Name", name);
    if let Some(p) = purpose.filter(|s| !s.is_empty()) {
        let label = match p {
            "domain" => "Business process knowledge",
            "source" => "Source system customizations",
            "data-engineering" => "Organization specific data engineering standards",
            "platform" => "Organization specific Azure or Fabric standards",
            other => other,
        };
        skill_parts.push(format!("**Purpose**: {}", label));
    }
    push_field(&mut skill_parts, "Description", description);
    if !tags.is_empty() {
        skill_parts.push(format!("**Tags**: {}", tags.join(", ")));
    }
    sections.extend(build_subsection("Skill", skill_parts));

    // --- User profile ---
    let mut profile_parts: Vec<String> = Vec::new();
    push_field(&mut profile_parts, "Industry", industry);
    push_field(&mut profile_parts, "Function", function_role);
    sections.extend(build_subsection("About You", profile_parts));

    // --- Intake: What Claude needs to know ---
    if let Some(ij) = intake_json {
        if let Ok(intake) = serde_json::from_str::<serde_json::Value>(ij) {
            // New unified field
            if let Some(v) = intake
                .get("context")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
            {
                sections.push(format!("### What Claude Needs to Know\n{}", v));
            }
            // Legacy fields (backwards compat for existing skills)
            for (key, label) in [
                ("unique_setup", "What Makes This Setup Unique"),
                ("claude_mistakes", "What Claude Gets Wrong"),
                ("scope", "Scope"),
                ("challenges", "Key Challenges"),
                ("audience", "Target Audience"),
            ] {
                if let Some(v) = intake
                    .get(key)
                    .and_then(|v| v.as_str())
                    .filter(|v| !v.is_empty())
                {
                    sections.push(format!("### {}\n{}", label, v));
                }
            }
        }
    }

    // --- Configuration ---
    let mut config_parts: Vec<String> = Vec::new();
    push_field(&mut config_parts, "Version", version);
    if let Some(m) = skill_model.filter(|s| !s.is_empty() && *s != "inherit") {
        config_parts.push(format!("**Preferred Model**: {}", m));
    }
    push_field(&mut config_parts, "Argument Hint", argument_hint);
    if let Some(inv) = user_invocable {
        config_parts.push(format!("**User Invocable**: {}", inv));
    }
    if let Some(dmi) = disable_model_invocation {
        config_parts.push(format!("**Disable Model Invocation**: {}", dmi));
    }
    sections.extend(build_subsection("Configuration", config_parts));

    if sections.is_empty() {
        None
    } else {
        Some(format!("## User Context\n\n{}", sections.join("\n\n")))
    }
}
