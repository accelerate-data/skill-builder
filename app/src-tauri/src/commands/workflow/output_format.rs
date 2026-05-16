#[cfg(test)]
use std::path::{Path, PathBuf};

use std::collections::HashSet;

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
use crate::db::workflow_artifacts::{
    ClarificationsRecord, DecisionsRecord, RefinementChoice, RefinementQuestion, RefinementSection,
    RefinementsRecord,
};
use crate::db::Db;

pub(crate) fn extract_workflow_json_from_conversation_state(
    state: &serde_json::Value,
    workflow_label: &str,
) -> Result<serde_json::Value, String> {
    if state.get("type").and_then(|v| v.as_str()) != Some("conversation_state") {
        return Err(format!(
            "OpenHands {workflow_label} result was not a conversation_state"
        ));
    }

    match state.get("status").and_then(|v| v.as_str()) {
        Some("completed") => {}
        Some("error") => {
            let detail = state
                .get("error_detail")
                .or_else(|| state.get("errorDetail"))
                .and_then(|v| v.as_str())
                .filter(|detail| !detail.trim().is_empty())
                .unwrap_or("OpenHands workflow run failed");
            return Err(format!(
                "OpenHands {workflow_label} conversation_state failed: {}",
                detail
            ));
        }
        Some("cancelled") | Some("canceled") => {
            let detail = state
                .get("error_detail")
                .or_else(|| state.get("errorDetail"))
                .and_then(|v| v.as_str())
                .filter(|detail| !detail.trim().is_empty())
                .unwrap_or("OpenHands workflow run cancelled");
            return Err(format!(
                "OpenHands {workflow_label} conversation_state cancelled: {}",
                detail
            ));
        }
        Some(status) => {
            return Err(format!(
                "OpenHands {workflow_label} conversation_state status must be completed but got '{}'",
                status
            ));
        }
        None => {
            return Err(format!(
                "OpenHands {workflow_label} conversation_state missing status"
            ));
        }
    }

    let result_text = state
        .get("result_text")
        .or_else(|| state.get("resultText"))
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            format!("OpenHands {workflow_label} conversation_state missing result_text/resultText")
        })?;

    let trimmed = result_text.trim();
    if trimmed.is_empty() {
        return Err(format!(
            "OpenHands {workflow_label} conversation_state has empty result_text"
        ));
    }

    let parsed = parse_research_result_text(trimmed, workflow_label)?;
    if !parsed.is_object() {
        return Err(format!(
            "OpenHands {workflow_label} result_text must be a JSON object"
        ));
    }

    Ok(parsed)
}

#[cfg(test)]
pub(crate) fn extract_research_json_from_conversation_state(
    state: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    extract_workflow_json_from_conversation_state(state, "research")
}

fn parse_research_result_text(
    text: &str,
    workflow_label: &str,
) -> Result<serde_json::Value, String> {
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

            let repaired = jsonrepair_rs::jsonrepair(json_text).map_err(|repair_error| {
                format!(
                    "OpenHands {workflow_label} result_text invalid JSON: {}; repair failed: {}",
                    parse_error, repair_error
                )
            })?;
            let parsed = serde_json::from_str::<serde_json::Value>(&repaired).map_err(
                |repaired_parse_error| {
                    format!(
                        "OpenHands {workflow_label} result_text invalid JSON: {}; repaired parse failed: {}",
                        parse_error, repaired_parse_error
                    )
                },
            )?;
            if parsed.is_object() {
                log::warn!(
                    "[materialize_step] repaired OpenHands {} result_text with jsonrepair-rs",
                    workflow_label
                );
                return Ok(parsed);
            }

            Err(format!(
                "OpenHands {workflow_label} result_text invalid JSON: {}",
                parse_error
            ))
        }
    }
}

fn normalize_decisions_output_missing_statuses(
    workflow_result_payload: &serde_json::Value,
) -> Option<serde_json::Value> {
    let mut normalized = workflow_result_payload.clone();
    let decisions = normalized.get_mut("decisions")?.as_array_mut()?;
    let mut changed = false;

    for decision in decisions {
        let Some(object) = decision.as_object_mut() else {
            continue;
        };
        if object.contains_key("status") {
            continue;
        }
        object.insert(
            "status".to_string(),
            serde_json::Value::String("resolved".to_string()),
        );
        changed = true;
    }

    changed.then_some(normalized)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[allow(dead_code)]
enum JsonContainer {
    Object,
    Array { is_questions: bool },
}

#[allow(dead_code)]
fn repair_nested_numeric_sections_in_questions(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut repaired = String::with_capacity(text.len() + 32);
    let mut stack: Vec<JsonContainer> = Vec::new();
    let mut next_array_is_questions = false;
    let mut changed = false;
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] == b'"' {
            let start = i;
            i += 1;
            let mut escaped = false;
            while i < bytes.len() {
                let ch = bytes[i];
                i += 1;
                if escaped {
                    escaped = false;
                    continue;
                }
                if ch == b'\\' {
                    escaped = true;
                    continue;
                }
                if ch == b'"' {
                    break;
                }
            }

            repaired.push_str(&text[start..i]);

            if &text[start..i] == r#""questions""# {
                let mut cursor = i;
                while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                    cursor += 1;
                }
                if cursor < bytes.len() && bytes[cursor] == b':' {
                    cursor += 1;
                    while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
                        cursor += 1;
                    }
                    if cursor < bytes.len() && bytes[cursor] == b'[' {
                        next_array_is_questions = true;
                    }
                }
            }
            continue;
        }

        if starts_numeric_section_entry(bytes, i)
            && stack
                .iter()
                .any(|container| matches!(container, JsonContainer::Array { is_questions: true }))
        {
            while matches!(
                stack.last(),
                Some(JsonContainer::Array { is_questions: true })
            ) {
                stack.pop();
                repaired.push(']');
                if matches!(stack.last(), Some(JsonContainer::Object)) {
                    stack.pop();
                    repaired.push('}');
                }
                changed = true;
            }
        }

        match bytes[i] {
            b'{' => stack.push(JsonContainer::Object),
            b'[' => {
                stack.push(JsonContainer::Array {
                    is_questions: next_array_is_questions,
                });
                next_array_is_questions = false;
            }
            b'}' | b']' => {
                stack.pop();
            }
            _ => {}
        }

        repaired.push(bytes[i] as char);
        i += 1;
    }

    changed.then_some(repaired)
}

#[allow(dead_code)]
fn starts_numeric_section_entry(bytes: &[u8], index: usize) -> bool {
    if !bytes[index..].starts_with(br#",{"id":"#) {
        return false;
    }

    let mut cursor = index + br#",{"id":"#.len();
    let digit_start = cursor;
    while cursor < bytes.len() && bytes[cursor].is_ascii_digit() {
        cursor += 1;
    }

    cursor > digit_start && bytes[cursor..].starts_with(br#","title":"#)
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
    workflow_result_payload: &serde_json::Value,
    expected_status: &str,
) -> Result<GenerateSkillOutput, String> {
    let parsed = serde_json::from_value::<GenerateSkillOutput>(workflow_result_payload.clone())
        .map_err(|e| format!("invalid generate-skill output: {}", e))?;
    if parsed.status != expected_status {
        return Err(format!(
            "invalid generate-skill output: status must be '{}' but got '{}'",
            expected_status, parsed.status
        ));
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
    if let Some(verifier_result) = parsed.verifier_result.as_ref() {
        match verifier_result.status.as_str() {
            "pass" => {
                if !verifier_result.findings.is_empty() {
                    return Err(
                        "invalid generate-skill output: verifier_result with status 'pass' must have an empty findings array"
                            .to_string(),
                    );
                }
            }
            "needs_fix" => {
                if verifier_result.findings.is_empty() {
                    return Err(
                        "invalid generate-skill output: verifier_result with status 'needs_fix' must include at least one finding"
                            .to_string(),
                    );
                }
            }
            other => {
                return Err(format!(
                    "invalid generate-skill output: verifier_result.status must be 'pass' or 'needs_fix' but got '{}'",
                    other
                ));
            }
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

/// Convert a parsed agent `ClarificationsFile` (received as `refinements_json`)
/// into a `RefinementsRecord` for the new refinements table family.
///
/// Refinements are flat — no recursive `parent_question_id` nesting.
pub(crate) fn agent_json_to_refinements_record(
    skill_id: &str,
    file: ClarificationsFile,
    now_ms: i64,
) -> RefinementsRecord {
    let metadata = file.metadata;

    let mut sections_out: Vec<RefinementSection> = Vec::with_capacity(file.sections.len());
    let mut questions_out: Vec<RefinementQuestion> = Vec::new();

    for (section_idx, section) in file.sections.into_iter().enumerate() {
        sections_out.push(RefinementSection {
            section_id: section.id,
            ordinal: section_idx as i64,
            title: section.title,
            description: section.description,
        });
        for (q_idx, q) in section.questions.into_iter().enumerate() {
            let choices_out: Vec<RefinementChoice> = q
                .choices
                .into_iter()
                .enumerate()
                .map(|(idx, c)| RefinementChoice {
                    choice_id: c.id,
                    ordinal: idx as i64,
                    text: c.text,
                    is_other: c.is_other,
                })
                .collect();

            questions_out.push(RefinementQuestion {
                question_id: q.id,
                section_id: section.id,
                ordinal: q_idx as i64,
                title: q.title,
                text: q.text,
                must_answer: q.must_answer,
                answer_choice: q.answer_choice,
                answer_text: q.answer_text,
                recommendation: q.recommendation,
                answer_verdict: None,
                answer_verdict_reason: None,
                choices: choices_out,
            });
        }
    }

    let notes = file
        .notes
        .into_iter()
        .enumerate()
        .map(|(idx, note)| db_artifacts::RefinementNote {
            note_id: None,
            ordinal: idx as i64,
            note_type: note.type_,
            title: note.title,
            body: note.body,
        })
        .collect();

    let (error_code, error_message) = metadata
        .error
        .map(|e| (Some(e.code), Some(e.message)))
        .unwrap_or((None, None));
    let (warning_code, warning_message) = metadata
        .warning
        .map(|w| (Some(w.code), Some(w.message)))
        .unwrap_or((None, None));

    RefinementsRecord {
        skill_id: skill_id.to_string(),
        version: file.version,
        refinement_count: metadata.refinement_count,
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
        questions: questions_out,
        notes,
    }
}

/// Append new top-level questions from step 1 output to the clarifications tables
/// without deleting existing rows. Inserts into `clarification_sections`,
/// `clarification_questions`, and `clarification_choices`.
fn append_new_clarification_questions(
    conn: &rusqlite::Connection,
    skill_id: &str,
    sections: &[crate::contracts::clarifications::Section],
) -> Result<(), String> {
    // Ensure the clarifications parent row exists (may not if step 0 was skipped)
    conn.execute(
        "INSERT OR IGNORE INTO clarifications (
            skill_id, version, refinement_count, must_answer_count, question_count,
            section_count, title, created_at, updated_at
        ) VALUES (?1, '1', 0, 0, 0, 0, '', strftime('%s','now') * 1000, strftime('%s','now') * 1000)",
        rusqlite::params![skill_id],
    )
    .map_err(|e| format!("Failed to ensure clarifications parent row: {}", e))?;

    for section in sections {
        // Ensure the section exists
        conn.execute(
            "INSERT OR IGNORE INTO clarification_sections (skill_id, section_id, ordinal, title, description)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                skill_id,
                section.id,
                0,
                section.title,
                section.description.as_deref().unwrap_or(""),
            ],
        )
        .map_err(|e| format!("Failed to insert clarification section: {}", e))?;

        // Read existing question IDs for this skill to avoid duplicates
        let existing_qids: HashSet<String> = {
            let mut stmt = conn
                .prepare("SELECT question_id FROM clarification_questions WHERE skill_id = ?1")
                .map_err(|e| format!("Failed to prepare query: {}", e))?;
            let rows = stmt
                .query_map([skill_id], |row| row.get::<_, String>(0))
                .map_err(|e| format!("Failed to query: {}", e))?;
            rows.filter_map(|r| r.ok()).collect()
        };

        for (q_idx, q) in section.questions.iter().enumerate() {
            if existing_qids.contains(&q.id) {
                continue;
            }
            conn.execute(
                "INSERT OR IGNORE INTO clarification_questions (
                    skill_id, question_id, section_id, parent_question_id, ordinal,
                    title, text, must_answer, answer_choice, answer_text, recommendation
                ) VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, NULL, NULL, ?8)",
                rusqlite::params![
                    skill_id,
                    q.id,
                    section.id,
                    q_idx as i64,
                    q.title,
                    q.text,
                    q.must_answer as i64,
                    q.recommendation,
                ],
            )
            .map_err(|e| format!("Failed to insert clarification question: {}", e))?;

            for (c_idx, c) in q.choices.iter().enumerate() {
                conn.execute(
                    "INSERT OR IGNORE INTO clarification_choices (
                        skill_id, question_id, choice_id, ordinal, text, is_other
                    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![
                        skill_id,
                        q.id,
                        c.id,
                        c_idx as i64,
                        c.text,
                        c.is_other as i64,
                    ],
                )
                .map_err(|e| format!("Failed to insert clarification choice: {}", e))?;
            }
        }
    }
    Ok(())
}

/// Convert a single `Question` into a DB row.
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
    } = q;

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
        refinements: vec![],
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

/// Resolve a skill identifier (bare name or structured key) to a canonical
/// `SkillIdentifier` string. Bare names are resolved via the skills master
/// table to find the owning plugin, then formatted as `skill-builder:{plugin}:{name}`.
fn resolve_skill_to_canonical_id(conn: &rusqlite::Connection, skill_id: &str) -> String {
    // Already a structured identifier or numeric ID — pass through.
    if crate::db::SkillIdentifier::parse(skill_id).is_ok() {
        return skill_id.to_string();
    }
    // Bare name: look up the owning plugin and construct a builder key.
    let plugin_slug = super::evaluation::lookup_plugin_slug(conn, skill_id);
    format!("skill-builder:{}:{}", plugin_slug, skill_id)
}

/// Persist agent step output to the workflow artifact tables.
///
/// Steps 0/1 unpack to `clarifications` (+ children) and call
/// `upsert_clarifications`. Step 2 unpacks to `decisions` (+ items) and calls
/// `upsert_decisions`. Step 3 only validates the parsed workflow result
/// payload from `conversation_state.result_text`; benchmark metadata is no
/// longer persisted (eval/benchmark redo).
///
/// `skill_id` is the skill name (TEXT primary key on `clarifications` and
/// `decisions`).
pub(crate) fn materialize_workflow_step_output_value(
    db: &Db,
    skill_id: &str,
    step_id: u32,
    workflow_result_payload: &serde_json::Value,
) -> Result<(), String> {
    if !workflow_result_payload.is_object() {
        return Err("workflow result payload must be a JSON object".to_string());
    }

    // Resolve bare skill names to a structured identifier at the boundary.
    let canonical_id = {
        let conn =
            db.0.lock()
                .map_err(|e| format!("Failed to lock DB: {}", e))?;
        resolve_skill_to_canonical_id(&conn, skill_id)
    };

    log::info!(
        "[materialize_step] step_id={} skill_id={} output_keys={:?}",
        step_id,
        skill_id,
        workflow_result_payload
            .as_object()
            .map(|o| o.keys().collect::<Vec<_>>())
    );

    match step_id {
        0 => {
            let parsed =
                serde_json::from_value::<ResearchStepOutput>(workflow_result_payload.clone())
                    .map_err(|e| format!("invalid research step output: {}", e))?;

            if parsed.status != "research_complete" {
                return Err(format!(
                    "workflow result payload status must be 'research_complete' but got '{}'",
                    parsed.status
                ));
            }

            log::info!(
                "[materialize_step] step=0 research_output version={} skill_id={}",
                parsed.research_output.version,
                skill_id
            );

            let record = agent_json_to_clarifications_record(
                &canonical_id,
                0, // step 0 always starts at refinement 0
                parsed.research_output,
                now_ms(),
            );
            persist_clarifications(db, &record)
        }
        1 => {
            let parsed =
                serde_json::from_value::<DetailedResearchOutput>(workflow_result_payload.clone())
                    .map_err(|e| format!("invalid detailed research output: {}", e))?;

            if parsed.status != "detailed_research_complete" {
                return Err(format!(
                    "workflow result payload status must be 'detailed_research_complete' but got '{}'",
                    parsed.status
                ));
            }

            log::info!(
                "[materialize_step] step=1 clarifications_json version={} refinements_json version={} skill_id={} refinement_count={}",
                parsed.clarifications_json.version,
                parsed.refinements_json.version,
                skill_id,
                parsed.refinement_count
            );

            let mut conn =
                db.0.lock()
                    .map_err(|e| format!("Failed to lock DB: {}", e))?;

            // 1. Read existing clarifications to know which question_ids already exist
            let existing_qids: HashSet<String> =
                db_artifacts::read_clarifications(&conn, &canonical_id)
                    .map_err(|e| format!("Failed to read existing clarifications: {}", e))?
                    .iter()
                    .flat_map(|c| c.questions.iter().map(|q| q.question_id.clone()))
                    .collect();

            // 2. Extract new sections with filtered questions from clarifications_json
            let new_sections: Vec<crate::contracts::clarifications::Section> = parsed
                .clarifications_json
                .sections
                .into_iter()
                .map(|mut s| {
                    s.questions.retain(|q| !existing_qids.contains(&q.id));
                    s
                })
                .filter(|s| !s.questions.is_empty())
                .collect();

            // 3. Wrap clarifications append + refinements upsert in a single transaction
            let tx = conn
                .transaction()
                .map_err(|e| format!("Failed to start transaction: {}", e))?;

            if !new_sections.is_empty() {
                append_new_clarification_questions(&tx, &canonical_id, &new_sections)
                    .map_err(|e| format!("Failed to append new clarifications: {}", e))?;
            }

            // 4. Write refinements (full replace)
            let refinements_record =
                agent_json_to_refinements_record(&canonical_id, parsed.refinements_json, now_ms());
            db_artifacts::upsert_refinements(&tx, &refinements_record)
                .map_err(|e| format!("Failed to upsert refinements: {}", e))?;
            tx.commit()
                .map_err(|e| format!("Failed to commit transaction: {}", e))?;

            Ok(())
        }
        2 => {
            let parsed = match serde_json::from_value::<DecisionsOutput>(
                workflow_result_payload.clone(),
            ) {
                Ok(parsed) => parsed,
                Err(parse_error) => {
                    if let Some(normalized) =
                        normalize_decisions_output_missing_statuses(workflow_result_payload)
                    {
                        if let Ok(parsed) = serde_json::from_value::<DecisionsOutput>(normalized) {
                            log::warn!(
                                "[materialize_step] repaired OpenHands decisions output with missing decision status fields"
                            );
                            parsed
                        } else {
                            return Err(format!("invalid decisions output: {}", parse_error));
                        }
                    } else {
                        return Err(format!("invalid decisions output: {}", parse_error));
                    }
                }
            };

            log::info!(
                "[materialize_step] step=2 decisions version={} skill_id={} decision_count={}",
                parsed.version,
                skill_id,
                parsed.metadata.decision_count
            );

            let record = agent_json_to_decisions_record(&canonical_id, parsed, now_ms())?;
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
            let status = workflow_result_payload
                .get("status")
                .and_then(|s| s.as_str())
                .unwrap_or("");

            match status {
                "generated" => {
                    let parsed =
                        validate_generated_skill_output(workflow_result_payload, "generated")?;
                    log::info!(
                        "generate-skill completed for skill={}, skipped={}",
                        skill_id,
                        parsed.skipped.unwrap_or(false)
                    );
                    Ok(())
                }
                "rewritten" => {
                    let parsed =
                        validate_generated_skill_output(workflow_result_payload, "rewritten")?;
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
                    serde_json::from_value::<GenerateSkillOutput>(workflow_result_payload.clone())
                        .map_err(|e| format!("invalid benchmark skill output: {}", e))?;
                    Ok(())
                }
                _ => Err(format!(
                    "workflow result payload status must be 'generated', 'rewritten', or 'complete'|'partial'|'skipped' but got '{}'",
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
    let mut conn =
        db.0.lock()
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
    let mut conn =
        db.0.lock()
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

#[cfg(test)]
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

#[cfg(test)]
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
    let _frontmatter = crate::commands::imported_skills::parse_frontmatter_full(&published_content);
    let version = "1.0.0".to_string();

    if let Err(e) = crate::git::ensure_repo(&published_dir) {
        log::warn!(
            "[publish_commit_and_tag_generated_skill] failed to ensure repo for '{}': {}",
            skill_name,
            e
        );
    }

    match crate::git::commit_all(&published_dir, "generated skill").map_err(|e| {
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
        crate::git::create_skill_version_tag(&published_dir, plugin_slug, skill_name, &version)
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

/// Returns the JSON Schema for the answer-evaluator structured output.
///
/// Uses the generated schema from `contracts::workflow_outputs::AnswerEvaluationOutput`.
#[cfg_attr(not(test), allow(dead_code))]
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

/// Validate-only: VU-1157 dropped answer-evaluation workspace file writes.
/// Per-question verdicts now flow through `update_clarification_verdicts` from
/// the gate hook (see Task 7). The structured output is still validated here
/// so callers receive a clear error on shape drift, but no workspace file is
/// written.
pub(crate) fn materialize_answer_evaluation_output_value(
    evaluation_payload: &serde_json::Value,
) -> Result<(), String> {
    validate_answer_evaluation_json(evaluation_payload)
        .map_err(|e| format!("Invalid answer evaluation output: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn materialize_answer_evaluation_output(
    skill_name: String,
    evaluation_payload: serde_json::Value,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    let _ = db;
    log::info!(
        "[materialize_answer_evaluation_output] skill={} (validate-only, file write removed in VU-1157)",
        skill_name
    );
    log::debug!(
        "[materialize_answer_evaluation_output] skill={} evaluation_payload={}",
        skill_name,
        evaluation_payload
    );
    materialize_answer_evaluation_output_value(&evaluation_payload).map_err(|e| {
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
    fn extract_research_json_from_conversation_state_repairs_missing_trailing_brace() {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": "{\"status\":\"research_complete\",\"question_count\":1,\"research_output\":{\"version\":\"1\",\"metadata\":{\"title\":\"Research\",\"question_count\":1,\"section_count\":1,\"refinement_count\":0,\"must_answer_count\":1,\"priority_questions\":[\"Q1\"],\"scope_recommendation\":false,\"scope_reason\":null,\"scope_next_action\":null,\"warning\":null,\"error\":null},\"sections\":[{\"id\":1,\"title\":\"Scope\",\"questions\":[{\"id\":\"Q1\",\"title\":\"Scope\",\"text\":\"Question?\",\"must_answer\":true,\"choices\":[{\"id\":\"C1\",\"text\":\"Choice\",\"is_other\":false}],\"refinements\":[]}]}],\"notes\":[],\"answer_evaluator_notes\":[]}"
        });

        let parsed = extract_research_json_from_conversation_state(&state)
            .expect("missing trailing brace should be repaired");

        assert_eq!(
            parsed.get("status").and_then(|value| value.as_str()),
            Some("research_complete")
        );
    }

    #[test]
    fn extract_research_json_from_conversation_state_repairs_mismatched_closer_before_final_object_end(
    ) {
        let state = serde_json::json!({
            "type": "conversation_state",
            "status": "completed",
            "result_text": "{\"status\":\"research_complete\",\"question_count\":1,\"research_output\":{\"version\":\"1\",\"metadata\":{\"question_count\":1,\"section_count\":1,\"refinement_count\":0,\"must_answer_count\":1,\"priority_questions\":[\"Q1\"],\"scope_recommendation\":false,\"scope_reason\":null,\"warning\":null,\"error\":null},\"sections\":[{\"id\":1,\"title\":\"Scope\",\"questions\":[{\"id\":\"Q1\",\"title\":\"Scope\",\"text\":\"Question?\",\"must_answer\":true,\"choices\":[{\"id\":\"C1\",\"text\":\"Choice\",\"is_other\":false}],\"refinements\":[]}],\"notes\":[{\"type\":\"flag\",\"title\":\"Gap\",\"body\":\"Body\"}],\"answer_evaluator_notes\":[]}}"
        });

        let parsed = extract_research_json_from_conversation_state(&state)
            .expect("mismatched trailing closer should be repaired");

        assert_eq!(
            parsed.get("status").and_then(|value| value.as_str()),
            Some("research_complete")
        );
    }

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
