//! DTO contracts for the workflow artifact storage commands (VU-1157).
//!
//! These types mirror the DB row structs in `db/workflow_artifacts.rs` but are
//! exported across the Tauri boundary via Specta + Schemars codegen. Enum
//! columns (`eval_verdict`, `answer_verdict`, `decision_items.status`,
//! `contradictory_inputs_state`) stay stringly-typed in the DTO and are
//! validated at the command boundary (see `commands/workflow/clarifications.rs`,
//! `commands/workflow/decisions.rs`). Booleans stored as INTEGER in SQLite are
//! exposed as `bool` (or `Option<bool>` for tri-state nullable values).
//! Timestamps are unix-ms `i64`.
//!
//! Field naming matches the existing snake_case convention used by
//! `contracts/clarifications.rs` and `contracts/decisions.rs` so the
//! frontend sees the same column shape it would in the raw `serde_json::Value`
//! representation today.

// ─── Clarifications ─────────────────────────────────────────────────────────

/// Full clarifications artifact for a skill.
///
/// Mirrors `db::workflow_artifacts::ClarificationsRecord`. Children
/// (`sections`, `questions`, `notes`) are reconstructed by the read path;
/// refinements are nested inside each `ClarificationQuestionDto.refinements`.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsDto {
    pub skill_id: String,
    pub version: String,
    pub refinement_count: i64,
    pub must_answer_count: i64,
    pub question_count: i64,
    pub section_count: i64,
    pub title: String,
    /// Tri-state: `None` = unset, `Some(false)` = not recommended,
    /// `Some(true)` = recommended.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_next_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_message: Option<String>,
    /// Allowed values: `"sufficient" | "insufficient"`. Validated at the
    /// command boundary, stored as TEXT.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_reasoning: Option<String>,
    /// Unix-ms timestamp.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_answered_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_empty_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_vague_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_contradictory_count: Option<i64>,
    /// Unix-ms timestamp.
    pub created_at: i64,
    /// Unix-ms timestamp.
    pub updated_at: i64,
    pub sections: Vec<ClarificationSectionDto>,
    /// Top-level questions only. Refinements live under each question's
    /// `refinements` field.
    pub questions: Vec<ClarificationQuestionDto>,
    pub notes: Vec<ClarificationNoteDto>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationSectionDto {
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Question DTO.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationQuestionDto {
    pub question_id: String,
    pub section_id: i64,
    /// `Some(parent_id)` for refinements, `None` for top-level questions.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent_question_id: Option<String>,
    pub ordinal: i64,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    /// Allowed values: `"clear" | "vague" | "not_answered" | "needs_refinement"
    /// | "contradictory"`. Validated at the command boundary.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict_reason: Option<String>,
    pub choices: Vec<ClarificationChoiceDto>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationChoiceDto {
    pub choice_id: String,
    pub ordinal: i64,
    pub text: String,
    pub is_other: bool,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationNoteDto {
    /// Auto-assigned by SQLite on insert; populated by the read path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<i64>,
    pub ordinal: i64,
    pub note_type: String,
    pub title: String,
    pub body: String,
}

/// Per-question verdict update payload accepted by
/// `update_clarification_verdicts`. `None` for `verdict` or `reason` clears
/// the corresponding column. `verdict` is validated against the allowed
/// answer-verdict set at the command boundary.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationVerdictUpdate {
    pub question_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

// ─── Decisions ──────────────────────────────────────────────────────────────

/// Full decisions artifact for a skill. Mirrors
/// `db::workflow_artifacts::DecisionsRecord`.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct DecisionsDto {
    pub skill_id: String,
    pub version: String,
    pub round: i64,
    pub decision_count: i64,
    pub conflicts_resolved: i64,
    /// Allowed values: `"inactive" | "active" | "revised"`. Validated upstream
    /// of writes; the read path returns whatever is in the column.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contradictory_inputs_state: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
    /// Unix-ms timestamp.
    pub created_at: i64,
    /// Unix-ms timestamp.
    pub updated_at: i64,
    pub items: Vec<DecisionItemDto>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct DecisionItemDto {
    pub decision_id: String,
    pub ordinal: i64,
    pub title: String,
    pub original_question: String,
    pub decision: String,
    pub implication: String,
    /// Allowed values: `"resolved" | "conflict-resolved" | "needs-review" |
    /// "revised"`.
    pub status: String,
}

// ─── Refinements ──────────────────────────────────────────────────────────────

/// Full refinements artifact for a skill.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementsDto {
    pub skill_id: String,
    pub version: String,
    pub refinement_count: i64,
    pub must_answer_count: i64,
    pub question_count: i64,
    pub section_count: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_next_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_answered_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_empty_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_vague_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_contradictory_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub sections: Vec<RefinementSectionDto>,
    pub questions: Vec<RefinementQuestionDto>,
    pub notes: Vec<RefinementNoteDto>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementSectionDto {
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementQuestionDto {
    pub question_id: String,
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict_reason: Option<String>,
    pub choices: Vec<RefinementChoiceDto>,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementChoiceDto {
    pub choice_id: String,
    pub ordinal: i64,
    pub text: String,
    pub is_other: bool,
}

#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementNoteDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<i64>,
    pub ordinal: i64,
    pub note_type: String,
    pub title: String,
    pub body: String,
}

// ─── Conversions from DB row records ────────────────────────────────────────

use crate::db::workflow_artifacts as db_artifacts;

impl From<db_artifacts::ClarificationChoice> for ClarificationChoiceDto {
    fn from(c: db_artifacts::ClarificationChoice) -> Self {
        Self {
            choice_id: c.choice_id,
            ordinal: c.ordinal,
            text: c.text,
            is_other: c.is_other,
        }
    }
}

impl From<db_artifacts::ClarificationQuestion> for ClarificationQuestionDto {
    fn from(q: db_artifacts::ClarificationQuestion) -> Self {
        Self {
            question_id: q.question_id,
            section_id: q.section_id,
            parent_question_id: q.parent_question_id,
            ordinal: q.ordinal,
            title: q.title,
            text: q.text,
            must_answer: q.must_answer,
            answer_choice: q.answer_choice,
            answer_text: q.answer_text,
            recommendation: q.recommendation,
            answer_verdict: q.answer_verdict,
            answer_verdict_reason: q.answer_verdict_reason,
            choices: q.choices.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<db_artifacts::ClarificationSection> for ClarificationSectionDto {
    fn from(s: db_artifacts::ClarificationSection) -> Self {
        Self {
            section_id: s.section_id,
            ordinal: s.ordinal,
            title: s.title,
            description: s.description,
        }
    }
}

impl From<db_artifacts::ClarificationNote> for ClarificationNoteDto {
    fn from(n: db_artifacts::ClarificationNote) -> Self {
        Self {
            note_id: n.note_id,
            ordinal: n.ordinal,
            note_type: n.note_type,
            title: n.title,
            body: n.body,
        }
    }
}

impl From<db_artifacts::ClarificationsRecord> for ClarificationsDto {
    fn from(r: db_artifacts::ClarificationsRecord) -> Self {
        Self {
            skill_id: r.skill_id,
            version: r.version,
            refinement_count: r.refinement_count,
            must_answer_count: r.must_answer_count,
            question_count: r.question_count,
            section_count: r.section_count,
            title: r.title,
            scope_recommendation: r.scope_recommendation,
            scope_reason: r.scope_reason,
            scope_next_action: r.scope_next_action,
            error_code: r.error_code,
            error_message: r.error_message,
            warning_code: r.warning_code,
            warning_message: r.warning_message,
            eval_verdict: r.eval_verdict,
            eval_reasoning: r.eval_reasoning,
            eval_at: r.eval_at,
            eval_answered_count: r.eval_answered_count,
            eval_empty_count: r.eval_empty_count,
            eval_vague_count: r.eval_vague_count,
            eval_contradictory_count: r.eval_contradictory_count,
            created_at: r.created_at,
            updated_at: r.updated_at,
            sections: r.sections.into_iter().map(Into::into).collect(),
            questions: r.questions.into_iter().map(Into::into).collect(),
            notes: r.notes.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<db_artifacts::DecisionItem> for DecisionItemDto {
    fn from(i: db_artifacts::DecisionItem) -> Self {
        Self {
            decision_id: i.decision_id,
            ordinal: i.ordinal,
            title: i.title,
            original_question: i.original_question,
            decision: i.decision,
            implication: i.implication,
            status: i.status,
        }
    }
}

impl From<db_artifacts::DecisionsRecord> for DecisionsDto {
    fn from(r: db_artifacts::DecisionsRecord) -> Self {
        Self {
            skill_id: r.skill_id,
            version: r.version,
            round: r.round,
            decision_count: r.decision_count,
            conflicts_resolved: r.conflicts_resolved,
            contradictory_inputs_state: r.contradictory_inputs_state,
            scope_recommendation: r.scope_recommendation,
            created_at: r.created_at,
            updated_at: r.updated_at,
            items: r.items.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<db_artifacts::RefinementChoice> for RefinementChoiceDto {
    fn from(c: db_artifacts::RefinementChoice) -> Self {
        Self {
            choice_id: c.choice_id,
            ordinal: c.ordinal,
            text: c.text,
            is_other: c.is_other,
        }
    }
}

impl From<db_artifacts::RefinementQuestion> for RefinementQuestionDto {
    fn from(q: db_artifacts::RefinementQuestion) -> Self {
        Self {
            question_id: q.question_id,
            section_id: q.section_id,
            ordinal: q.ordinal,
            title: q.title,
            text: q.text,
            must_answer: q.must_answer,
            answer_choice: q.answer_choice,
            answer_text: q.answer_text,
            recommendation: q.recommendation,
            answer_verdict: q.answer_verdict,
            answer_verdict_reason: q.answer_verdict_reason,
            choices: q.choices.into_iter().map(Into::into).collect(),
        }
    }
}

impl From<db_artifacts::RefinementSection> for RefinementSectionDto {
    fn from(s: db_artifacts::RefinementSection) -> Self {
        Self {
            section_id: s.section_id,
            ordinal: s.ordinal,
            title: s.title,
            description: s.description,
        }
    }
}

impl From<db_artifacts::RefinementNote> for RefinementNoteDto {
    fn from(n: db_artifacts::RefinementNote) -> Self {
        Self {
            note_id: n.note_id,
            ordinal: n.ordinal,
            note_type: n.note_type,
            title: n.title,
            body: n.body,
        }
    }
}

impl From<db_artifacts::RefinementsRecord> for RefinementsDto {
    fn from(r: db_artifacts::RefinementsRecord) -> Self {
        Self {
            skill_id: r.skill_id,
            version: r.version,
            refinement_count: r.refinement_count,
            must_answer_count: r.must_answer_count,
            question_count: r.question_count,
            section_count: r.section_count,
            title: r.title,
            scope_recommendation: r.scope_recommendation,
            scope_reason: r.scope_reason,
            scope_next_action: r.scope_next_action,
            error_code: r.error_code,
            error_message: r.error_message,
            warning_code: r.warning_code,
            warning_message: r.warning_message,
            eval_verdict: r.eval_verdict,
            eval_reasoning: r.eval_reasoning,
            eval_at: r.eval_at,
            eval_answered_count: r.eval_answered_count,
            eval_empty_count: r.eval_empty_count,
            eval_vague_count: r.eval_vague_count,
            eval_contradictory_count: r.eval_contradictory_count,
            created_at: r.created_at,
            updated_at: r.updated_at,
            sections: r.sections.into_iter().map(Into::into).collect(),
            questions: r.questions.into_iter().map(Into::into).collect(),
            notes: r.notes.into_iter().map(Into::into).collect(),
        }
    }
}

// ─── Boundary validation helpers ────────────────────────────────────────────

/// Validate `eval_verdict` strings: `"sufficient" | "insufficient"`.
pub fn validate_eval_verdict(v: &str) -> Result<(), String> {
    match v {
        "sufficient" | "insufficient" => Ok(()),
        other => Err(format!(
            "invalid eval_verdict '{}': expected 'sufficient' or 'insufficient'",
            other
        )),
    }
}

/// Validate `answer_verdict` strings: one of the five answer-verdict values.
pub fn validate_answer_verdict(v: &str) -> Result<(), String> {
    match v {
        "clear" | "vague" | "not_answered" | "needs_refinement" | "contradictory" => Ok(()),
        other => Err(format!(
            "invalid answer_verdict '{}': expected one of 'clear', 'vague', 'not_answered', 'needs_refinement', 'contradictory'",
            other
        )),
    }
}

/// Validate `decision_items.status` strings.
pub fn validate_decision_status(v: &str) -> Result<(), String> {
    match v {
        "resolved" | "conflict-resolved" | "needs-review" | "revised" => Ok(()),
        other => Err(format!(
            "invalid decision status '{}': expected one of 'resolved', 'conflict-resolved', 'needs-review', 'revised'",
            other
        )),
    }
}

/// Validate `contradictory_inputs_state` strings.
pub fn validate_contradictory_inputs_state(v: &str) -> Result<(), String> {
    match v {
        "inactive" | "active" | "revised" => Ok(()),
        other => Err(format!(
            "invalid contradictory_inputs_state '{}': expected one of 'inactive', 'active', 'revised'",
            other
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_eval_verdict_accepts_known_values() {
        assert!(validate_eval_verdict("sufficient").is_ok());
        assert!(validate_eval_verdict("insufficient").is_ok());
        assert!(validate_eval_verdict("maybe").is_err());
        assert!(validate_eval_verdict("").is_err());
    }

    #[test]
    fn validate_answer_verdict_accepts_known_values() {
        for v in [
            "clear",
            "vague",
            "not_answered",
            "needs_refinement",
            "contradictory",
        ] {
            assert!(validate_answer_verdict(v).is_ok(), "{} should be valid", v);
        }
        assert!(validate_answer_verdict("ok").is_err());
        assert!(validate_answer_verdict("CLEAR").is_err());
    }

    #[test]
    fn validate_decision_status_accepts_known_values() {
        for v in ["resolved", "conflict-resolved", "needs-review", "revised"] {
            assert!(validate_decision_status(v).is_ok(), "{} should be valid", v);
        }
        assert!(validate_decision_status("conflict_resolved").is_err());
        assert!(validate_decision_status("done").is_err());
    }

    #[test]
    fn validate_contradictory_inputs_state_accepts_known_values() {
        for v in ["inactive", "active", "revised"] {
            assert!(
                validate_contradictory_inputs_state(v).is_ok(),
                "{} should be valid",
                v
            );
        }
        assert!(validate_contradictory_inputs_state("idle").is_err());
    }

    #[test]
    fn dto_round_trip_preserves_fields() {
        let dto = ClarificationsDto {
            skill_id: "s".to_string(),
            version: "1".to_string(),
            refinement_count: 0,
            must_answer_count: 1,
            question_count: 1,
            section_count: 1,
            title: "t".to_string(),
            scope_recommendation: Some(true),
            scope_reason: None,
            scope_next_action: None,
            error_code: None,
            error_message: None,
            warning_code: None,
            warning_message: None,
            eval_verdict: Some("sufficient".to_string()),
            eval_reasoning: Some("looks good".to_string()),
            eval_at: Some(1_700_000_000_000),
            eval_answered_count: Some(1),
            eval_empty_count: Some(0),
            eval_vague_count: Some(0),
            eval_contradictory_count: Some(0),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            sections: vec![ClarificationSectionDto {
                section_id: 1,
                ordinal: 0,
                title: "Section".to_string(),
                description: None,
            }],
            questions: vec![ClarificationQuestionDto {
                question_id: "q1".to_string(),
                section_id: 1,
                parent_question_id: None,
                ordinal: 0,
                title: "Q".to_string(),
                text: "T".to_string(),
                must_answer: true,
                answer_choice: Some("c1".to_string()),
                answer_text: None,
                recommendation: None,
                answer_verdict: Some("clear".to_string()),
                answer_verdict_reason: None,
                choices: vec![ClarificationChoiceDto {
                    choice_id: "c1".to_string(),
                    ordinal: 0,
                    text: "Choice".to_string(),
                    is_other: false,
                }],
            }],
            notes: vec![],
        };

        let json = serde_json::to_string(&dto).expect("serialize");
        let back: ClarificationsDto = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.skill_id, "s");
        assert_eq!(back.questions.len(), 1);
        assert_eq!(back.questions[0].choices.len(), 1);
        assert_eq!(back.eval_verdict.as_deref(), Some("sufficient"));
    }

    #[test]
    fn verdict_update_payload_round_trip() {
        let upd = ClarificationVerdictUpdate {
            question_id: "q1".to_string(),
            verdict: Some("clear".to_string()),
            reason: Some("answered".to_string()),
        };
        let json = serde_json::to_string(&upd).expect("serialize");
        let back: ClarificationVerdictUpdate = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.question_id, "q1");
        assert_eq!(back.verdict.as_deref(), Some("clear"));
    }

    #[test]
    fn decisions_dto_round_trip() {
        let dto = DecisionsDto {
            skill_id: "s".to_string(),
            version: "1".to_string(),
            round: 0,
            decision_count: 1,
            conflicts_resolved: 0,
            contradictory_inputs_state: Some("inactive".to_string()),
            scope_recommendation: Some(false),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            items: vec![DecisionItemDto {
                decision_id: "d1".to_string(),
                ordinal: 0,
                title: "T".to_string(),
                original_question: "Q?".to_string(),
                decision: "Yes".to_string(),
                implication: "OK".to_string(),
                status: "resolved".to_string(),
            }],
        };
        let json = serde_json::to_string(&dto).expect("serialize");
        let back: DecisionsDto = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.items[0].status, "resolved");
        assert_eq!(back.contradictory_inputs_state.as_deref(), Some("inactive"));
    }
}
