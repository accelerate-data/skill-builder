use std::path::{Path, PathBuf};

use crate::commands::workflow_artifacts::{
    AnswerEvaluationOutput, DecisionsOutput, DetailedResearchOutput, GenerateSkillOutput,
    ResearchStepOutput,
};
use crate::contracts::clarifications::{ClarificationsFile, Question, Section};
use crate::contracts::decisions::{ContradictoryInputs, Decision, DecisionStatus};
use crate::contracts::workflow_artifacts::{
    validate_contradictory_inputs_state, validate_decision_status,
};
use crate::db::workflow_artifacts as db_artifacts;
use crate::db::workflow_artifacts::{ClarificationsRecord, DecisionsRecord};
use crate::db::Db;

pub(crate) fn extract_research_json_from_conversation_state(
    state: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    if state.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return Err("OpenHands research result was not a conversation_state".to_string());
    }

    match state.get("status").and_then(|v| v.as_str()) {
        Some("completed") => {}
        Some("error") => {
            let detail = state
                .get("error_detail")
                .or_else(|| state.get("errorDetail"))
                .and_then(|v| v.as_str())
                .filter(|detail| !detail.trim().is_empty())
                .unwrap_or("OpenHands research run failed");
            return Err(format!(
                "OpenHands research conversation_state failed: {}",
                detail
            ));
        }
        Some("cancelled") | Some("canceled") => {
            let detail = state
                .get("error_detail")
                .or_else(|| state.get("errorDetail"))
                .and_then(|v| v.as_str())
                .filter(|detail| !detail.trim().is_empty())
                .unwrap_or("OpenHands research run cancelled");
            return Err(format!(
                "OpenHands research conversation_state cancelled: {}",
                detail
            ));
        }
        Some(status) => {
            return Err(format!(
                "OpenHands research conversation_state status must be completed but got '{}'",
                status
            ));
        }
        None => {
            return Err("OpenHands research conversation_state missing status".to_string());
        }
    }

    let result_text = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            "OpenHands research conversation_state missing result_text/resultText".to_string()
        })?;

    let trimmed = result_text.trim();
    if trimmed.is_empty() {
        return Err("OpenHands research conversation_state has empty result_text".to_string());
    }

    let parsed = parse_research_result_text(trimmed)?;
    if !parsed.is_object() {
        return Err("OpenHands research result_text must be a JSON object".to_string());
    }

    Ok(parsed)
}

fn parse_research_result_text(text: &str) -> Result<serde_json::Value, String> {
    let json_text = strip_single_json_markdown_fence(text);
    match serde_json::from_str::<serde_json::Value>(json_text) {
        Ok(parsed) => Ok(parsed),
        Err(parse_error) => {
            let mut fallback_object = None;
            for candidate in top_level_json_object_candidates(json_text)
                .into_iter()
                .rev()
            {
                let Ok(parsed) = serde_json::from_str::<serde_json::Value>(candidate) else {
                    continue;
                };
                if !parsed.is_object() {
                    continue;
                }
                if parsed.get("status").and_then(|value| value.as_str())
                    == Some("research_complete")
                    && parsed.get("research_output").is_some()
                {
                    return Ok(parsed);
                }
                fallback_object.get_or_insert(parsed);
            }

            if let Some(parsed) = fallback_object {
                return Ok(parsed);
            }

            if let Some(repaired) = repair_missing_commas_between_json_values(json_text) {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&repaired) {
                    if parsed.is_object() {
                        log::warn!(
                            "[materialize_step] repaired OpenHands research result_text with missing JSON commas"
                        );
                        return Ok(parsed);
                    }
                }
            }

            Err(format!(
                "OpenHands research result_text invalid JSON: {}",
                parse_error
            ))
        }
    }
}

fn repair_missing_commas_between_json_values(text: &str) -> Option<String> {
    let mut repaired = String::with_capacity(text.len());
    let mut changed = false;
    let mut in_string = false;
    let mut escaped = false;
    let mut last_significant: Option<char> = None;

    for ch in text.chars() {
        if in_string {
            repaired.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
                last_significant = Some('"');
            }
            continue;
        }

        if ch == '"' {
            if last_significant.is_some_and(json_value_can_precede_missing_comma) {
                repaired.push(',');
                changed = true;
            }
            in_string = true;
            repaired.push(ch);
            continue;
        }

        if !ch.is_whitespace() {
            if json_value_can_start(ch)
                && last_significant.is_some_and(json_value_can_precede_missing_comma)
            {
                repaired.push(',');
                changed = true;
            }
            last_significant = Some(ch);
        }

        repaired.push(ch);
    }

    changed.then_some(repaired)
}

fn json_value_can_start(ch: char) -> bool {
    matches!(ch, '{' | '[' | '"' | '-' | '0'..='9' | 't' | 'f' | 'n')
}

fn json_value_can_precede_missing_comma(ch: char) -> bool {
    matches!(ch, '}' | ']' | '"')
}

fn top_level_json_object_candidates(text: &str) -> Vec<&str> {
    let mut candidates = Vec::new();
    let mut depth = 0usize;
    let mut start = None;
    let mut in_string = false;
    let mut escaped = false;

    for (idx, ch) in text.char_indices() {
        if in_string {
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        match ch {
            '"' => in_string = true,
            '{' => {
                if depth == 0 {
                    start = Some(idx);
                }
                depth += 1;
            }
            '}' => {
                if depth == 0 {
                    continue;
                }
                depth -= 1;
                if depth == 0 {
                    if let Some(start_idx) = start.take() {
                        candidates.push(&text[start_idx..idx + ch.len_utf8()]);
                    }
                }
            }
            _ => {}
        }
    }

    candidates
}

fn strip_single_json_markdown_fence(text: &str) -> &str {
    let Some(after_opening) = text.strip_prefix("```") else {
        return text;
    };
    let Some(before_closing) = after_opening.strip_suffix("```") else {
        return text;
    };

    let inner = before_closing.trim();
    if let Some(rest) = inner.strip_prefix("json") {
        rest.trim_start_matches([' ', '\t', '\r', '\n']).trim()
    } else {
        inner
    }
}

fn validate_generated_skill_output(
    structured_output: &serde_json::Value,
    expected_status: &str,
) -> Result<GenerateSkillOutput, String> {
    let parsed = serde_json::from_value::<GenerateSkillOutput>(structured_output.clone())
        .map_err(|e| format!("invalid generate-skill output: {}", e))?;
    if parsed.status != expected_status {
        return Err(format!(
            "invalid generate-skill output: status must be '{}' but got '{}'",
            expected_status, parsed.status
        ));
    }
    if expected_status == "generated" && parsed.version_bump.as_deref() != Some("1.0.0") {
        return Err(
            "invalid generate-skill output: version_bump must be '1.0.0' for generated skills"
                .to_string(),
        );
    }
    if expected_status != "generated"
        && parsed
            .version_bump
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err("invalid generate-skill output: missing version_bump".to_string());
    }
    match parsed.call_trace.as_ref() {
        Some(trace) if !trace.is_empty() && trace.iter().all(|entry| !entry.trim().is_empty()) => {}
        _ => {
            return Err(
                "invalid generate-skill output: call_trace must be a non-empty string array"
                    .to_string(),
            );
        }
    }
    if expected_status == "generated" {
        let trace = parsed.call_trace.as_ref().expect("checked above");
        let required = [
            "read-user-context",
            "read-decisions",
            "read-clarifications",
            "synthesize-generation-brief",
            "use-creating-skills",
            "write-skill",
            "fresh-context-verifier-review",
        ];
        if let Some(missing) = required
            .iter()
            .find(|entry| !trace.iter().any(|actual| actual == *entry))
        {
            return Err(format!(
                "invalid generate-skill output: call_trace missing required entry '{}'",
                missing
            ));
        }
    }
    if !parsed.skipped.unwrap_or(false)
        && parsed
            .commit_summary
            .as_deref()
            .unwrap_or("")
            .trim()
            .is_empty()
    {
        return Err(
            "invalid generate-skill output: missing commit_summary for generated output"
                .to_string(),
        );
    }
    Ok(parsed)
}

/// Convert a parsed agent `ClarificationsFile` into the normalized DB record.
///
/// Drops three fields silently per VU-1157 unpack rules:
/// `metadata.priority_questions`, `metadata.duplicates_removed`,
/// `question.consolidated_from`. Question merging/splitting/deduplication
/// is not a supported workflow.
///
/// `answer_evaluator_notes` from the agent JSON is also ignored — per-question
/// verdicts flow through `update_clarification_verdicts` from the gate hook.
/// Preserves any prior verdict columns by leaving them NULL on this path; the
/// DB transaction wipes children before re-insert so existing verdicts are
/// implicitly cleared on each step boundary.
pub(crate) fn agent_json_to_clarifications_record(
    skill_id: &str,
    refinement_count: i64,
    file: ClarificationsFile,
    now_ms: i64,
) -> ClarificationsRecord {
    let metadata = file.metadata;
    // Build top-level questions per section. Each section's questions are
    // ordered by their position in the agent output; we assign that as the
    // ordinal. Refinements recurse via `convert_question`.
    let mut sections_out: Vec<db_artifacts::ClarificationSection> =
        Vec::with_capacity(file.sections.len());
    let mut top_level_questions: Vec<db_artifacts::ClarificationQuestion> = Vec::new();
    for (section_idx, section) in file.sections.into_iter().enumerate() {
        let Section {
            id,
            title,
            description,
            questions,
        } = section;
        sections_out.push(db_artifacts::ClarificationSection {
            section_id: id,
            ordinal: section_idx as i64,
            title,
            description,
        });
        for (q_idx, q) in questions.into_iter().enumerate() {
            top_level_questions.push(convert_question(q, id, q_idx as i64));
        }
    }

    let notes = file
        .notes
        .into_iter()
        .enumerate()
        .map(|(idx, note)| db_artifacts::ClarificationNote {
            note_id: None,
            ordinal: idx as i64,
            note_type: note.type_,
            title: note.title,
            body: note.body,
        })
        .collect();

    // Flatten metadata error/warning into discrete columns.
    let (error_code, error_message) = metadata
        .error
        .map(|e| (Some(e.code), Some(e.message)))
        .unwrap_or((None, None));
    let (warning_code, warning_message) = metadata
        .warning
        .map(|w| (Some(w.code), Some(w.message)))
        .unwrap_or((None, None));

    ClarificationsRecord {
        skill_id: skill_id.to_string(),
        version: file.version,
        refinement_count,
        must_answer_count: metadata.must_answer_count,
        question_count: metadata.question_count,
        section_count: metadata.section_count,
        title: metadata.title,
        scope_recommendation: metadata.scope_recommendation,
        scope_reason: metadata.scope_reason,
        scope_next_action: metadata.scope_next_action,
        error_code,
        error_message,
        warning_code,
        warning_message,
        eval_verdict: None,
        eval_reasoning: None,
        eval_at: None,
        eval_answered_count: None,
        eval_empty_count: None,
        eval_vague_count: None,
        eval_contradictory_count: None,
        created_at: now_ms,
        updated_at: now_ms,
        sections: sections_out,
        questions: top_level_questions,
        notes,
    }
}

/// Convert a single `Question` (and its refinements recursively) into a DB row.
fn convert_question(
    q: Question,
    section_id: i64,
    ordinal: i64,
) -> db_artifacts::ClarificationQuestion {
    let Question {
        id,
        title,
        text,
        must_answer,
        consolidated_from: _, // explicitly dropped per VU-1157 unpack rules
        choices,
        recommendation,
        answer_choice,
        answer_text,
        refinements,
    } = q;

    let refinements_out: Vec<db_artifacts::ClarificationQuestion> = refinements
        .into_iter()
        .enumerate()
        .map(|(idx, child)| convert_question(child, section_id, idx as i64))
        .collect();

    let choices_out: Vec<db_artifacts::ClarificationChoice> = choices
        .into_iter()
        .enumerate()
        .map(|(idx, c)| db_artifacts::ClarificationChoice {
            choice_id: c.id,
            ordinal: idx as i64,
            text: c.text,
            is_other: c.is_other,
        })
        .collect();

    db_artifacts::ClarificationQuestion {
        question_id: id,
        section_id,
        parent_question_id: None,
        ordinal,
        title,
        text,
        must_answer,
        answer_choice,
        answer_text,
        recommendation,
        answer_verdict: None,
        answer_verdict_reason: None,
        choices: choices_out,
        refinements: refinements_out,
    }
}

/// Convert a parsed `DecisionsOutput` into the normalized DB record.
///
/// Validates `status` enum on each item and the optional
/// `contradictory_inputs_state` derived from the agent's
/// `metadata.contradictory_inputs` union (boolean | "revised" | "active").
pub(crate) fn agent_json_to_decisions_record(
    skill_id: &str,
    output: DecisionsOutput,
    now_ms: i64,
) -> Result<DecisionsRecord, String> {
    let DecisionsOutput {
        version,
        metadata,
        decisions,
    } = output;

    // Map the agent's `contradictory_inputs` union onto the DB's enum string.
    // - `Some(Active(true))` → "active"
    // - `Some(Active(false))` → "inactive"
    // - `Some(Revised(s))` → use `s` (agent emits "revised"; validate enum)
    // - `None` → None
    let contradictory_inputs_state = match metadata.contradictory_inputs {
        Some(ContradictoryInputs::Active(true)) => Some("active".to_string()),
        Some(ContradictoryInputs::Active(false)) => Some("inactive".to_string()),
        Some(ContradictoryInputs::Revised(s)) => Some(s),
        None => None,
    };
    if let Some(ref state) = contradictory_inputs_state {
        validate_contradictory_inputs_state(state)?;
    }

    let mut items: Vec<db_artifacts::DecisionItem> = Vec::with_capacity(decisions.len());
    for (idx, d) in decisions.into_iter().enumerate() {
        let Decision {
            id,
            title,
            original_question,
            decision,
            implication,
            status,
        } = d;
        let status_str = match status {
            DecisionStatus::Resolved => "resolved",
            DecisionStatus::ConflictResolved => "conflict-resolved",
            DecisionStatus::NeedsReview => "needs-review",
            DecisionStatus::Revised => "revised",
        };
        validate_decision_status(status_str)?;
        items.push(db_artifacts::DecisionItem {
            decision_id: id,
            ordinal: idx as i64,
            title,
            original_question,
            decision,
            implication,
            status: status_str.to_string(),
        });
    }

    Ok(DecisionsRecord {
        skill_id: skill_id.to_string(),
        version,
        round: metadata.round,
        decision_count: metadata.decision_count,
        conflicts_resolved: metadata.conflicts_resolved,
        contradictory_inputs_state,
        scope_recommendation: metadata.scope_recommendation,
        created_at: now_ms,
        updated_at: now_ms,
        items,
    })
}

fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Persist agent step output to the workflow artifact tables.
///
/// Steps 0/1 unpack to `clarifications` (+ children) and call
/// `upsert_clarifications`. Step 2 unpacks to `decisions` (+ items) and calls
/// `upsert_decisions`. Step 3 only validates the structured output; benchmark
/// metadata is no longer persisted (eval/benchmark redo).
///
/// `skill_id` is the skill name (TEXT primary key on `clarifications` and
/// `decisions`).
pub(crate) fn materialize_workflow_step_output_value(
    db: &Db,
    skill_id: &str,
    step_id: u32,
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    if !structured_output.is_object() {
        return Err("structured_output must be a JSON object".to_string());
    }

    log::info!(
        "[materialize_step] step_id={} skill_id={} output_keys={:?}",
        step_id,
        skill_id,
        structured_output
            .as_object()
            .map(|o| o.keys().collect::<Vec<_>>())
    );

    match step_id {
        0 => {
            let parsed = serde_json::from_value::<ResearchStepOutput>(structured_output.clone())
                .map_err(|e| format!("invalid research step output: {}", e))?;

            if parsed.status != "research_complete" {
                return Err(format!(
                    "structured_output.status must be 'research_complete' but got '{}'",
                    parsed.status
                ));
            }

            log::info!(
                "[materialize_step] step=0 research_output version={} skill_id={}",
                parsed.research_output.version,
                skill_id
            );

            let record = agent_json_to_clarifications_record(
                skill_id,
                0, // step 0 always starts at refinement 0
                parsed.research_output,
                now_ms(),
            );
            persist_clarifications(db, &record)
        }
        1 => {
            let parsed =
                serde_json::from_value::<DetailedResearchOutput>(structured_output.clone())
                    .map_err(|e| format!("invalid detailed research output: {}", e))?;

            if parsed.status != "detailed_research_complete" {
                return Err(format!(
                    "structured_output.status must be 'detailed_research_complete' but got '{}'",
                    parsed.status
                ));
            }

            log::info!(
                "[materialize_step] step=1 clarifications_json version={} skill_id={} refinement_count={}",
                parsed.clarifications_json.version,
                skill_id,
                parsed.refinement_count
            );

            let record = agent_json_to_clarifications_record(
                skill_id,
                parsed.refinement_count,
                parsed.clarifications_json,
                now_ms(),
            );
            persist_clarifications(db, &record)
        }
        2 => {
            let parsed = serde_json::from_value::<DecisionsOutput>(structured_output.clone())
                .map_err(|e| format!("invalid decisions output: {}", e))?;

            log::info!(
                "[materialize_step] step=2 decisions version={} skill_id={} decision_count={}",
                parsed.version,
                skill_id,
                parsed.metadata.decision_count
            );

            let record = agent_json_to_decisions_record(skill_id, parsed, now_ms())?;
            persist_decisions(db, &record)
        }
        3 => {
            // Step 3 can receive output from either generate-skill or benchmark-skill.
            // generate-skill: { status: "generated"|"rewritten", skipped?, call_trace }
            // benchmark-skill: { status: "complete"|"partial"|"skipped", benchmark_path?, call_trace }
            //
            // VU-1157: no DB table replaces benchmark-meta.json. Eval/benchmark
            // is being redone in a separate effort. We validate the agent
            // output for both paths and log; no persistence is required here.
            let status = structured_output
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("");

            match status {
                "generated" => {
                    let parsed = validate_generated_skill_output(structured_output, "generated")?;
                    log::info!(
                        "generate-skill completed for skill={}, skipped={}",
                        skill_id,
                        parsed.skipped.unwrap_or(false)
                    );
                    Ok(())
                }
                "rewritten" => {
                    let parsed = validate_generated_skill_output(structured_output, "rewritten")?;
                    log::info!(
                        "rewrite-skill completed for skill={}, skipped={}",
                        skill_id,
                        parsed.skipped.unwrap_or(false)
                    );
                    Ok(())
                }
                "complete" | "partial" | "skipped" => {
                    log::info!(
                        "event=benchmark_skill_complete operation=materialize_output status={} skill={}",
                        status,
                        skill_id
                    );
                    serde_json::from_value::<GenerateSkillOutput>(structured_output.clone())
                        .map_err(|e| format!("invalid benchmark skill output: {}", e))?;
                    Ok(())
                }
                _ => Err(format!(
                    "structured_output.status must be 'generated', 'rewritten', or 'complete'|'partial'|'skipped' but got '{}'",
                    status
                )),
            }
        }
        _ => Err(format!(
            "materialize_workflow_step_output supports only steps 0-3; got {}",
            step_id
        )),
    }
}

fn persist_clarifications(db: &Db, record: &ClarificationsRecord) -> Result<(), String> {
    let mut conn = db
        .0
        .lock()
        .map_err(|e| format!("Failed to lock DB: {}", e))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    db_artifacts::upsert_clarifications(&tx, record)
        .map_err(|e| format!("Failed to upsert clarifications: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit clarifications: {}", e))?;
    Ok(())
}

fn persist_decisions(db: &Db, record: &DecisionsRecord) -> Result<(), String> {
    let mut conn = db
        .0
        .lock()
        .map_err(|e| format!("Failed to lock DB: {}", e))?;
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start transaction: {}", e))?;
    db_artifacts::upsert_decisions(&tx, record)
        .map_err(|e| format!("Failed to upsert decisions: {}", e))?;
    tx.commit()
        .map_err(|e| format!("Failed to commit decisions: {}", e))?;
    Ok(())
}

pub(crate) fn publish_generated_skill_output(
    workspace_skill_root: &Path,
    skills_path: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<PathBuf, String> {
    let generated_dir = workspace_skill_root.join("skill");
    let generated_skill_md = generated_dir.join("SKILL.md");
    let published_dir = crate::skill_paths::resolve_skill_dir(skills_path, plugin_slug, skill_name);
    let published_skill_md = published_dir.join("SKILL.md");

    if !generated_skill_md.is_file() {
        if published_skill_md.is_file() {
            log::info!(
                "[publish_generated_skill_output] skill={} plugin={} already published at {}",
                skill_name,
                plugin_slug,
                published_skill_md.display()
            );
            return Ok(published_dir);
        }

        return Err(format!(
            "Generated skill output missing: expected '{}' or '{}'",
            generated_skill_md.display(),
            published_skill_md.display()
        ));
    }

    if let Some(parent) = published_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create plugin directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }

    crate::fs_utils::copy_dir_recursive(&generated_dir, &published_dir)?;
    log::info!(
        "[publish_generated_skill_output] skill={} plugin={} source={} target={}",
        skill_name,
        plugin_slug,
        generated_dir.display(),
        published_dir.display()
    );
    Ok(published_dir)
}

pub(crate) fn publish_commit_and_tag_generated_skill(
    workspace_skill_root: &Path,
    skills_dir: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<(), String> {
    let published_dir =
        publish_generated_skill_output(workspace_skill_root, skills_dir, plugin_slug, skill_name)?;
    let published_skill_md = published_dir.join("SKILL.md");
    let published_content = std::fs::read_to_string(&published_skill_md).map_err(|e| {
        format!(
            "Failed to read generated skill frontmatter '{}': {}",
            published_skill_md.display(),
            e
        )
    })?;
    let frontmatter = crate::commands::imported_skills::parse_frontmatter_full(&published_content);
    if !frontmatter.has_metadata_version {
        return Err(format!(
            "Generated skill '{}' is missing metadata.version in '{}'",
            skill_name,
            published_skill_md.display()
        ));
    }
    let version = frontmatter.version.ok_or_else(|| {
        format!(
            "Generated skill '{}' is missing metadata.version in '{}'",
            skill_name,
            published_skill_md.display()
        )
    })?;
    if version != "1.0.0" {
        return Err(format!(
            "Generated skill '{}' must use metadata.version 1.0.0 but found '{}'",
            skill_name, version
        ));
    }

    let commit_message = format!("{}: generated skill", skill_name);
    match crate::git::commit_all(skills_dir, &commit_message).map_err(|e| {
        format!(
            "Generated skill publish commit failed for '{}': {}",
            skill_name, e
        )
    })? {
        Some(sha) => log::info!(
            "[materialize_workflow_step_output] committed generated skill={} sha={}",
            skill_name,
            &sha[..8.min(sha.len())]
        ),
        None => log::info!(
            "[materialize_workflow_step_output] no generated skill changes to commit skill={}",
            skill_name
        ),
    }

    let tag_name =
        crate::git::create_skill_version_tag(skills_dir, plugin_slug, skill_name, &version)
            .map_err(|e| {
                format!(
                    "Generated skill version tag failed for '{}': {}",
                    skill_name, e
                )
            })?;
    log::info!(
        "[materialize_workflow_step_output] tagged generated skill={} tag={}",
        skill_name,
        tag_name
    );

    Ok(())
}

#[tauri::command]
pub fn materialize_workflow_step_output(
    skill_name: String,
    step_id: u32,
    structured_output: serde_json::Value,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    log::info!(
        "[materialize_workflow_step_output] skill={} step={} step_id={}",
        skill_name,
        super::evaluation::workflow_step_log_name(step_id as i32),
        step_id
    );
    materialize_workflow_step_output_value(&db, &skill_name, step_id, &structured_output).map_err(
        |e| {
            log::error!(
                "[materialize_workflow_step_output] skill={} step={} step_id={} failed: {}",
                skill_name,
                super::evaluation::workflow_step_log_name(step_id as i32),
                step_id,
                e
            );
            e
        },
    )?;

    // After successful generate materialization, publish, commit, and tag the skill.
    // Benchmark output does not trigger a commit (benchmark data is in workspace, not git).
    // Rewrite/refine commit+tag is handled by finalize_refine_run.
    if step_id == 3 {
        let status = structured_output
            .get("status")
            .and_then(|s| s.as_str())
            .unwrap_or("");
        let skipped = structured_output
            .get("skipped")
            .and_then(|s| s.as_bool())
            .unwrap_or(false);

        if status == "generated" && !skipped {
            let workspace_path = super::evaluation::read_workspace_path(&db).ok_or_else(|| {
                "Workspace path not configured. Please set it in Settings.".to_string()
            })?;
            let plugin_slug = {
                let conn = db.0.lock().map_err(|e| e.to_string())?;
                super::evaluation::lookup_plugin_slug(&conn, &skill_name)
            };
            let skill_root = crate::skill_paths::workspace_skill_dir(
                Path::new(&workspace_path),
                &plugin_slug,
                &skill_name,
            );

            let conn = db.0.lock().map_err(|e| e.to_string())?;
            let settings = crate::db::read_settings(&conn)?;
            let skills_path = settings
                .skills_path
                .unwrap_or_else(|| workspace_path.clone());
            drop(conn);

            let skills_dir = Path::new(&skills_path);
            publish_commit_and_tag_generated_skill(
                &skill_root,
                skills_dir,
                &plugin_slug,
                &skill_name,
            )?;

            match git2::Repository::open(skills_dir) {
                Ok(repo) => {
                    if let Some(sha) = repo
                        .head()
                        .ok()
                        .and_then(|h| h.peel_to_commit().ok())
                        .map(|c| c.id().to_string())
                    {
                        log::info!(
                            "[materialize_workflow_step_output] generated skill repo head skill={} sha={}",
                            skill_name, &sha[..8.min(sha.len())]
                        );
                    }
                }
                Err(e) => {
                    log::warn!(
                        "[materialize_workflow_step_output] could not open repo for skill={}: {}",
                        skill_name,
                        e
                    );
                }
            }
        }
    }

    Ok(())
}

/// Returns the JSON Schema for the answer-evaluator structured output.
///
/// Uses the generated schema from `contracts::workflow_outputs::AnswerEvaluationOutput`.
pub(crate) fn answer_evaluator_output_format() -> serde_json::Value {
    let schema: serde_json::Value =
        serde_json::from_str(crate::generated::schemas::ANSWER_EVALUATION_SCHEMA)
            .expect("generated ANSWER_EVALUATION_SCHEMA must be valid JSON");
    serde_json::json!({
        "type": "json_schema",
        "schema": schema
    })
}

/// Validate an answer evaluation JSON payload via typed deserialization and
/// apply semantic business rules (verdict enum, vague/contradictory reason requirement).
///
/// The typed deserialization into `AnswerEvaluationOutput` handles structural
/// validation. The semantic checks below enforce business rules that go beyond
/// the JSON schema (e.g. "reason is required when verdict is vague").
pub(crate) fn validate_answer_evaluation_json(
    evaluation: &serde_json::Value,
) -> Result<AnswerEvaluationOutput, String> {
    let parsed = serde_json::from_value::<AnswerEvaluationOutput>(evaluation.clone())
        .map_err(|e| format!("invalid answer evaluation output: {}", e))?;

    // Semantic validation: verdict enum
    if !["sufficient", "mixed", "insufficient"].contains(&parsed.verdict.as_str()) {
        return Err(
            "answer_evaluation.verdict must be one of sufficient|mixed|insufficient".to_string(),
        );
    }

    // Semantic validation: reasoning must not be empty
    if parsed.reasoning.trim().is_empty() {
        return Err("answer_evaluation.reasoning must not be empty".to_string());
    }

    // Semantic validation: vague/contradictory entries must have a reason
    for (idx, entry) in parsed.per_question.iter().enumerate() {
        if ![
            "clear",
            "needs_refinement",
            "not_answered",
            "vague",
            "contradictory",
        ]
        .contains(&entry.verdict.as_str())
        {
            return Err(format!(
                "answer_evaluation.per_question[{}].verdict is invalid",
                idx
            ));
        }
        if entry.verdict == "vague" || entry.verdict == "contradictory" {
            match &entry.reason {
                Some(r) if !r.trim().is_empty() => {}
                _ => {
                    return Err(format!(
                        "answer_evaluation.per_question[{}].reason is required for {} verdict",
                        idx, entry.verdict
                    ));
                }
            }
        }
    }

    // Semantic validation: gate_decision enum
    if let Some(ref gd) = parsed.gate_decision {
        if !["run_research", "revise"].contains(&gd.as_str()) {
            return Err(format!(
                "answer_evaluation.gate_decision must be one of run_research|revise (got '{}')",
                gd
            ));
        }
    }

    Ok(parsed)
}

/// Validate-only: VU-1157 dropped the `answer-evaluation.json` file write.
/// Per-question verdicts now flow through `update_clarification_verdicts` from
/// the gate hook (see Task 7). The structured output is still validated here
/// so callers receive a clear error on shape drift, but no workspace file is
/// written.
pub(crate) fn materialize_answer_evaluation_output_value(
    structured_output: &serde_json::Value,
) -> Result<(), String> {
    validate_answer_evaluation_json(structured_output)
        .map_err(|e| format!("Invalid answer evaluation output: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn materialize_answer_evaluation_output(
    skill_name: String,
    workspace_path: String,
    structured_output: serde_json::Value,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    let _ = (workspace_path, db);
    log::info!(
        "[materialize_answer_evaluation_output] skill={} (validate-only, file write removed in VU-1157)",
        skill_name
    );
    log::debug!(
        "[materialize_answer_evaluation_output] skill={} structured_output={}",
        skill_name,
        structured_output
    );
    materialize_answer_evaluation_output_value(&structured_output).map_err(|e| {
        log::error!(
            "[materialize_answer_evaluation_output] skill={} failed: {}",
            skill_name,
            e
        );
        e
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn publish_generated_skill_output_copies_workspace_skill_to_library_layout() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("lead-routing");
        let generated_refs = workspace_skill_root.join("skill").join("references");
        fs::create_dir_all(&generated_refs).unwrap();
        fs::write(
            workspace_skill_root.join("skill").join("SKILL.md"),
            "---\nname: lead-routing\n---\n# Lead Routing\n",
        )
        .unwrap();
        fs::write(generated_refs.join("terms.md"), "# Terms\n").unwrap();

        let published_dir = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "lead-routing",
        )
        .unwrap();

        assert_eq!(
            published_dir,
            crate::skill_paths::resolve_skill_dir(skills.path(), "skills", "lead-routing")
        );
        assert_eq!(
            fs::read_to_string(published_dir.join("SKILL.md")).unwrap(),
            "---\nname: lead-routing\n---\n# Lead Routing\n"
        );
        assert_eq!(
            fs::read_to_string(published_dir.join("references").join("terms.md")).unwrap(),
            "# Terms\n"
        );
    }

    #[test]
    fn publish_generated_skill_output_errors_when_neither_workspace_nor_library_has_skill_md() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("missing-skill");

        let err = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "missing-skill",
        )
        .unwrap_err();

        assert!(
            err.contains("Generated skill output missing"),
            "unexpected error: {err}"
        );
    }

    #[test]
    fn publish_generated_skill_output_accepts_directly_published_skill() {
        let workspace = tempfile::tempdir().unwrap();
        let skills = tempfile::tempdir().unwrap();
        let workspace_skill_root = workspace.path().join("skills").join("direct-skill");
        let published_dir =
            crate::skill_paths::resolve_skill_dir(skills.path(), "skills", "direct-skill");
        fs::create_dir_all(&published_dir).unwrap();
        fs::write(published_dir.join("SKILL.md"), "# Direct\n").unwrap();

        let result = publish_generated_skill_output(
            &workspace_skill_root,
            skills.path(),
            "skills",
            "direct-skill",
        )
        .unwrap();

        assert_eq!(result, published_dir);
        assert_eq!(
            fs::read_to_string(result.join("SKILL.md")).unwrap(),
            "# Direct\n"
        );
    }
}
