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

const CONFIRM_DECISIONS_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/confirm_decisions.txt"
));

const SKILL_GENERATION_TEMPLATE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../agent-sources/prompts/skill-generation.txt"
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
    user_context_block: &str,
) -> String {
    render_workspace_prompt(
        RESEARCH_PROMPT_TEMPLATE,
        skill_name,
        workspace_path,
        plugin_slug,
    )
    .replace("{{max_dimensions}}", &max_dimensions.to_string())
    .replace("{{user_context_block}}", user_context_block)
}

/// Build the prompt for step 1 (detailed research).
pub(crate) fn build_step1_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    user_context_block: &str,
    clarifications_json: &str,
    answer_verdicts_block: &str,
) -> String {
    render_workspace_prompt(
        DETAILED_RESEARCH_TEMPLATE,
        skill_name,
        workspace_path,
        plugin_slug,
    )
    .replace("{{user_context_block}}", user_context_block)
    .replace("{{clarifications_json}}", clarifications_json)
    .replace("{{answer_verdicts_block}}", answer_verdicts_block)
}

/// Build the prompt for step 2 (confirm decisions).
pub(crate) fn build_step2_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    user_context_block: &str,
    clarifications_json: &str,
) -> String {
    render_workspace_prompt(
        CONFIRM_DECISIONS_TEMPLATE,
        skill_name,
        workspace_path,
        plugin_slug,
    )
    .replace("{{user_context_block}}", user_context_block)
    .replace("{{clarifications_json}}", clarifications_json)
}

/// Build the prompt for step 3 (generate skill).
#[allow(clippy::too_many_arguments)]
pub(crate) fn build_step3_prompt(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    skills_path: &str,
    author_login: Option<&str>,
    created_at: Option<&str>,
    user_context_block: &str,
    clarifications_json: &str,
    decisions_json: &str,
) -> String {
    let workspace_dir =
        resolve_workspace_skill_dir(Path::new(workspace_path), plugin_slug, skill_name);
    let workspace_str = workspace_dir.to_string_lossy().replace('\\', "/");
    let skill_output_str = resolve_skill_dir(Path::new(skills_path), plugin_slug, skill_name)
        .to_string_lossy()
        .replace('\\', "/");

    let author_context = match author_login {
        Some(author) => {
            let mut context = format!("Author login: {}.", author);
            if let Some(created) = created_at {
                let created_date = &created[..10.min(created.len())];
                let today = chrono::Utc::now().format("%Y-%m-%d").to_string();
                context.push_str(&format!(
                    " Skill created date: {}. Current modified date: {}.",
                    created_date, today
                ));
            }
            context
        }
        None => "No author metadata was provided.".to_string(),
    };

    SKILL_GENERATION_TEMPLATE
        .trim_end_matches('\n')
        .replace("{{skill_name}}", skill_name)
        .replace("{{workspace_dir}}", &workspace_str)
        .replace("{{skill_output_dir}}", &skill_output_str)
        .replace("{{author_context}}", &author_context)
        .replace("{{user_context_block}}", user_context_block)
        .replace("{{clarifications_json}}", clarifications_json)
        .replace("{{decisions_json}}", decisions_json)
}

/// Render a `ClarificationsRecord` as a pretty-printed JSON string suitable
/// for inline injection into agent prompts.
pub(crate) fn clarifications_record_to_json_string(
    rec: &crate::db::workflow_artifacts::ClarificationsRecord,
) -> String {
    let sections: Vec<serde_json::Value> = rec
        .sections
        .iter()
        .map(|s| {
            let section_questions: Vec<&crate::db::workflow_artifacts::ClarificationQuestion> = rec
                .questions
                .iter()
                .filter(|q| q.section_id == s.section_id && q.parent_question_id.is_none())
                .collect();

            let questions_json: Vec<serde_json::Value> = section_questions
                .iter()
                .map(|q| question_to_json(q, &rec.questions))
                .collect();

            serde_json::json!({
                "id": s.section_id,
                "title": s.title,
                "description": s.description,
                "questions": questions_json
            })
        })
        .collect();

    let json_val = serde_json::json!({
        "version": rec.version,
        "metadata": {
            "title": rec.title,
            "question_count": rec.question_count,
            "section_count": rec.section_count,
            "refinement_count": rec.refinement_count,
            "must_answer_count": rec.must_answer_count,
            "scope_recommendation": rec.scope_recommendation,
            "scope_reason": rec.scope_reason,
            "scope_next_action": rec.scope_next_action,
        },
        "sections": sections,
        "notes": rec.notes.iter().map(|n| serde_json::json!({
            "type": n.note_type,
            "title": n.title,
            "body": n.body
        })).collect::<Vec<_>>()
    });

    serde_json::to_string_pretty(&json_val).unwrap_or_else(|_| "{}".to_string())
}

fn question_to_json(
    q: &crate::db::workflow_artifacts::ClarificationQuestion,
    all_questions: &[crate::db::workflow_artifacts::ClarificationQuestion],
) -> serde_json::Value {
    let choices: Vec<serde_json::Value> = q
        .choices
        .iter()
        .map(|c| {
            serde_json::json!({
                "id": c.choice_id,
                "text": c.text,
                "is_other": c.is_other
            })
        })
        .collect();

    let refinements: Vec<serde_json::Value> = all_questions
        .iter()
        .filter(|r| r.parent_question_id.as_deref() == Some(&q.question_id))
        .map(|r| question_to_json(r, all_questions))
        .collect();

    let mut obj = serde_json::json!({
        "id": q.question_id,
        "title": q.title,
        "text": q.text,
        "must_answer": q.must_answer,
        "choices": choices,
        "refinements": refinements
    });

    if let Some(v) = &q.answer_choice {
        obj["answer_choice"] = serde_json::Value::String(v.clone());
    }
    if let Some(v) = &q.answer_text {
        obj["answer_text"] = serde_json::Value::String(v.clone());
    }
    if let Some(v) = &q.recommendation {
        obj["recommendation"] = serde_json::Value::String(v.clone());
    }

    obj
}

/// Render per-question answer evaluation verdicts for inline prompt injection.
pub(crate) fn render_answer_verdicts(
    rec: &crate::db::workflow_artifacts::ClarificationsRecord,
) -> String {
    let questions_with_verdicts: Vec<&crate::db::workflow_artifacts::ClarificationQuestion> = rec
        .questions
        .iter()
        .filter(|q| q.answer_verdict.is_some())
        .collect();

    if questions_with_verdicts.is_empty() {
        return "No evaluation verdicts available. Treat all answers as unevaluated.".to_string();
    }

    let lines: Vec<String> = questions_with_verdicts
        .iter()
        .map(|q| {
            let verdict = q.answer_verdict.as_deref().unwrap_or("unknown");
            let reason = q.answer_verdict_reason.as_deref().unwrap_or("");
            if reason.is_empty() {
                format!("- {} ({}): {}", q.question_id, q.title, verdict)
            } else {
                format!(
                    "- {} ({}): {} — {}",
                    q.question_id, q.title, verdict, reason
                )
            }
        })
        .collect();

    lines.join("\n")
}

/// Render a `DecisionsRecord` as a pretty-printed JSON string suitable for
/// inline injection into agent prompts.
pub(crate) fn decisions_record_to_json_string(
    rec: &crate::db::workflow_artifacts::DecisionsRecord,
) -> String {
    let items: Vec<serde_json::Value> = rec
        .items
        .iter()
        .map(|item| {
            serde_json::json!({
                "id": item.decision_id,
                "title": item.title,
                "original_question": item.original_question,
                "decision": item.decision,
                "implication": item.implication,
                "status": item.status
            })
        })
        .collect();

    let mut metadata = serde_json::json!({
        "decision_count": rec.decision_count,
        "conflicts_resolved": rec.conflicts_resolved,
        "round": rec.round
    });
    if let Some(state) = &rec.contradictory_inputs_state {
        metadata["contradictory_inputs"] = serde_json::Value::String(state.clone());
    }
    if let Some(sr) = rec.scope_recommendation {
        metadata["scope_recommendation"] = serde_json::Value::Bool(sr);
    }

    let json_val = serde_json::json!({
        "version": rec.version,
        "metadata": metadata,
        "decisions": items
    });

    serde_json::to_string_pretty(&json_val).unwrap_or_else(|_| "{}".to_string())
}

/// Format user context fields into a `## User Context` markdown block.
///
/// Used by inline prompt rendering paths that embed the skill metadata block
/// directly into agent prompts. Returns `None` when all fields are empty.
///
/// VU-1157 dropped the `user-context.md` workspace file. The same content is
/// produced inline by this helper for prompt rendering.
#[allow(clippy::too_many_arguments)]
pub fn format_user_context(
    name: Option<&str>,
    tags: &[String],
    author: Option<&str>,
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
    documents: &[crate::db::DocumentContent],
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
    push_field(&mut skill_parts, "Author", author);
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

    // --- Intake: What the agent needs to know ---
    if let Some(ij) = intake_json {
        if let Ok(intake) = serde_json::from_str::<serde_json::Value>(ij) {
            // New unified field
            if let Some(v) = intake
                .get("context")
                .and_then(|v| v.as_str())
                .filter(|v| !v.is_empty())
            {
                sections.push(format!("### What the Agent Needs to Know\n{}", v));
            }
            // Legacy fields (backwards compat for existing skills)
            for (key, label) in [
                ("unique_setup", "What Makes This Setup Unique"),
                ("agent_mistakes", "What the Agent Gets Wrong"),
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

    if sections.is_empty() && documents.is_empty() {
        return None;
    }

    let mut result = if sections.is_empty() {
        String::new()
    } else {
        format!("## User Context\n\n{}", sections.join("\n\n"))
    };

    // Append reference documents section when applicable
    if !documents.is_empty() {
        let mut docs_section = String::from("\n\n## Reference Documents\n");
        for doc in documents {
            docs_section.push_str(&format!("\n### {}\n\n{}\n\n---\n", doc.name, doc.content));
        }
        result.push_str(&docs_section);
    }

    Some(result)
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
