//! Typed Rust structs for structured workflow step outputs.
//!
//! Each struct mirrors exactly the JSON schema enforced by the agent's `output_format`
//! contract (see `workflow/step_config.rs` and `commands/agent.rs`). Deserialization
//! via `serde_json::from_value::<T>()` is the boundary check; any mismatch is caught
//! here and surfaced as a typed error before file I/O occurs.

use serde::{Deserialize, Serialize};

// ─── Step 0: Research Orchestrator ───────────────────────────────────────────

/// Structured output produced by the `research-orchestrator` agent (workflow step 0).
///
/// Required fields: `status` (const `"research_complete"`), `dimensions_selected`,
/// `question_count`, `research_output`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResearchStepOutput {
    pub status: String,
    pub dimensions_selected: i64,
    pub question_count: i64,
    pub research_output: serde_json::Value,
}

// ─── Step 1: Detailed Research ───────────────────────────────────────────────

/// Structured output produced by the `detailed-research` agent (workflow step 1).
///
/// Required fields: `status` (const `"detailed_research_complete"`), `refinement_count`,
/// `section_count`, `clarifications_json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetailedResearchOutput {
    pub status: String,
    pub refinement_count: i64,
    pub section_count: i64,
    pub clarifications_json: serde_json::Value,
}

// ─── Step 2: Confirm Decisions ───────────────────────────────────────────────

/// Structured output produced by the `confirm-decisions` agent (workflow step 2).
///
/// Required fields: `version`, `metadata`, `decisions`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecisionsOutput {
    pub version: String,
    pub metadata: serde_json::Value,
    pub decisions: Vec<serde_json::Value>,
}

// ─── Step 3: Generate Skill ───────────────────────────────────────────────────

/// Structured output produced by the `generate-skill` agent (workflow step 3).
///
/// Required fields: `status` (const `"generated"`), `evaluations_markdown`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GenerateSkillOutput {
    pub status: String,
    pub evaluations_markdown: String,
}

// ─── Answer Evaluator ────────────────────────────────────────────────────────

/// Per-question verdict entry within an [`AnswerEvaluationOutput`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PerQuestionEntry {
    pub question_id: String,
    pub verdict: String,
    pub reason: Option<String>,
    pub contradicts: Option<String>,
}

/// Structured output produced by the answer-evaluator agent (transition gate between
/// steps 1 and 2).
///
/// Required fields: `verdict`, `answered_count`, `empty_count`, `vague_count`,
/// `contradictory_count`, `total_count`, `reasoning`, `per_question`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AnswerEvaluationOutput {
    pub verdict: String,
    pub answered_count: i64,
    pub empty_count: i64,
    pub vague_count: i64,
    pub contradictory_count: i64,
    pub total_count: i64,
    pub reasoning: String,
    pub per_question: Vec<PerQuestionEntry>,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── ResearchStepOutput ────────────────────────────────────────────────

    #[test]
    fn test_research_step_output_round_trip() {
        let json = serde_json::json!({
            "status": "research_complete",
            "dimensions_selected": 3,
            "question_count": 7,
            "research_output": {
                "version": "1",
                "metadata": {
                    "question_count": 7,
                    "section_count": 2,
                    "refinement_count": 0,
                    "must_answer_count": 1,
                    "priority_questions": []
                },
                "sections": [],
                "notes": []
            }
        });

        let parsed: ResearchStepOutput =
            serde_json::from_value(json.clone()).expect("deserialize ResearchStepOutput");
        assert_eq!(parsed.status, "research_complete");
        assert_eq!(parsed.dimensions_selected, 3);
        assert_eq!(parsed.question_count, 7);

        let re_serialized = serde_json::to_value(&parsed).expect("serialize ResearchStepOutput");
        assert_eq!(re_serialized["status"], "research_complete");
        assert_eq!(re_serialized["dimensions_selected"], 3);
    }

    #[test]
    fn test_research_step_output_rejects_missing_status() {
        let json = serde_json::json!({
            "dimensions_selected": 3,
            "question_count": 7,
            "research_output": {}
        });
        let result = serde_json::from_value::<ResearchStepOutput>(json);
        assert!(result.is_err(), "should reject missing status");
    }

    #[test]
    fn test_research_step_output_rejects_missing_research_output() {
        let json = serde_json::json!({
            "status": "research_complete",
            "dimensions_selected": 3,
            "question_count": 7
        });
        let result = serde_json::from_value::<ResearchStepOutput>(json);
        assert!(result.is_err(), "should reject missing research_output");
    }

    // ── DetailedResearchOutput ────────────────────────────────────────────

    #[test]
    fn test_detailed_research_output_round_trip() {
        let json = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 2,
            "section_count": 3,
            "clarifications_json": {
                "version": "1",
                "metadata": {
                    "question_count": 5,
                    "section_count": 3,
                    "refinement_count": 2,
                    "must_answer_count": 0,
                    "priority_questions": []
                },
                "sections": [],
                "notes": []
            }
        });

        let parsed: DetailedResearchOutput =
            serde_json::from_value(json).expect("deserialize DetailedResearchOutput");
        assert_eq!(parsed.status, "detailed_research_complete");
        assert_eq!(parsed.refinement_count, 2);
        assert_eq!(parsed.section_count, 3);

        let re_serialized =
            serde_json::to_value(&parsed).expect("serialize DetailedResearchOutput");
        assert_eq!(re_serialized["status"], "detailed_research_complete");
        assert_eq!(re_serialized["refinement_count"], 2);
    }

    #[test]
    fn test_detailed_research_output_rejects_missing_clarifications_json() {
        let json = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 1,
            "section_count": 1
        });
        let result = serde_json::from_value::<DetailedResearchOutput>(json);
        assert!(result.is_err(), "should reject missing clarifications_json");
    }

    // ── DecisionsOutput ───────────────────────────────────────────────────

    #[test]
    fn test_decisions_output_round_trip() {
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "skill_name": "my-skill",
                "created_at": "2025-01-01"
            },
            "decisions": [
                {
                    "id": "D1",
                    "category": "scope",
                    "decision": "Include ETL pipeline",
                    "rationale": "Core requirement"
                }
            ]
        });

        let parsed: DecisionsOutput =
            serde_json::from_value(json).expect("deserialize DecisionsOutput");
        assert_eq!(parsed.version, "1");
        assert_eq!(parsed.decisions.len(), 1);

        let re_serialized = serde_json::to_value(&parsed).expect("serialize DecisionsOutput");
        assert_eq!(re_serialized["version"], "1");
        assert_eq!(re_serialized["decisions"].as_array().unwrap().len(), 1);
    }

    #[test]
    fn test_decisions_output_rejects_missing_version() {
        let json = serde_json::json!({
            "metadata": {},
            "decisions": []
        });
        let result = serde_json::from_value::<DecisionsOutput>(json);
        assert!(result.is_err(), "should reject missing version");
    }

    #[test]
    fn test_decisions_output_rejects_missing_decisions() {
        let json = serde_json::json!({
            "version": "1",
            "metadata": {}
        });
        let result = serde_json::from_value::<DecisionsOutput>(json);
        assert!(result.is_err(), "should reject missing decisions");
    }

    // ── GenerateSkillOutput ───────────────────────────────────────────────

    #[test]
    fn test_generate_skill_output_round_trip() {
        let json = serde_json::json!({
            "status": "generated",
            "evaluations_markdown": "## Evaluation\n\nAll criteria met."
        });

        let parsed: GenerateSkillOutput =
            serde_json::from_value(json).expect("deserialize GenerateSkillOutput");
        assert_eq!(parsed.status, "generated");
        assert!(parsed.evaluations_markdown.contains("Evaluation"));

        let re_serialized = serde_json::to_value(&parsed).expect("serialize GenerateSkillOutput");
        assert_eq!(re_serialized["status"], "generated");
    }

    #[test]
    fn test_generate_skill_output_rejects_missing_status() {
        let json = serde_json::json!({
            "evaluations_markdown": "## Evaluation\n\nAll criteria met."
        });
        let result = serde_json::from_value::<GenerateSkillOutput>(json);
        assert!(result.is_err(), "should reject missing status");
    }

    #[test]
    fn test_generate_skill_output_rejects_missing_evaluations_markdown() {
        let json = serde_json::json!({
            "status": "generated"
        });
        let result = serde_json::from_value::<GenerateSkillOutput>(json);
        assert!(result.is_err(), "should reject missing evaluations_markdown");
    }

    // ── AnswerEvaluationOutput ────────────────────────────────────────────

    #[test]
    fn test_answer_evaluation_output_round_trip() {
        let json = serde_json::json!({
            "verdict": "sufficient",
            "answered_count": 5,
            "empty_count": 0,
            "vague_count": 0,
            "contradictory_count": 0,
            "total_count": 5,
            "reasoning": "All questions answered clearly.",
            "per_question": [
                {"question_id": "Q1", "verdict": "clear"},
                {"question_id": "Q2", "verdict": "clear", "reason": null, "contradicts": null}
            ]
        });

        let parsed: AnswerEvaluationOutput =
            serde_json::from_value(json).expect("deserialize AnswerEvaluationOutput");
        assert_eq!(parsed.verdict, "sufficient");
        assert_eq!(parsed.answered_count, 5);
        assert_eq!(parsed.per_question.len(), 2);

        let re_serialized =
            serde_json::to_value(&parsed).expect("serialize AnswerEvaluationOutput");
        assert_eq!(re_serialized["verdict"], "sufficient");
        assert_eq!(re_serialized["answered_count"], 5);
    }

    #[test]
    fn test_answer_evaluation_output_with_vague_verdict() {
        let json = serde_json::json!({
            "verdict": "mixed",
            "answered_count": 3,
            "empty_count": 1,
            "vague_count": 1,
            "contradictory_count": 0,
            "total_count": 5,
            "reasoning": "Mostly answered with one vague response.",
            "per_question": [
                {"question_id": "Q1", "verdict": "vague", "reason": "Too generic."}
            ]
        });

        let parsed: AnswerEvaluationOutput =
            serde_json::from_value(json).expect("deserialize AnswerEvaluationOutput with vague");
        assert_eq!(parsed.verdict, "mixed");
        assert_eq!(parsed.vague_count, 1);
        let vague = &parsed.per_question[0];
        assert_eq!(vague.verdict, "vague");
        assert_eq!(vague.reason.as_deref(), Some("Too generic."));
    }

    #[test]
    fn test_answer_evaluation_output_with_contradictory_verdict() {
        let json = serde_json::json!({
            "verdict": "insufficient",
            "answered_count": 0,
            "empty_count": 0,
            "vague_count": 0,
            "contradictory_count": 1,
            "total_count": 1,
            "reasoning": "Contradiction found.",
            "per_question": [
                {
                    "question_id": "Q1",
                    "verdict": "contradictory",
                    "reason": "Conflicts with earlier answer.",
                    "contradicts": "Q3"
                }
            ]
        });

        let parsed: AnswerEvaluationOutput =
            serde_json::from_value(json).expect("deserialize AnswerEvaluationOutput with contradictory");
        let entry = &parsed.per_question[0];
        assert_eq!(entry.verdict, "contradictory");
        assert_eq!(entry.contradicts.as_deref(), Some("Q3"));
    }

    #[test]
    fn test_answer_evaluation_output_rejects_missing_verdict() {
        let json = serde_json::json!({
            "answered_count": 5,
            "empty_count": 0,
            "vague_count": 0,
            "contradictory_count": 0,
            "total_count": 5,
            "reasoning": "All answered.",
            "per_question": []
        });
        let result = serde_json::from_value::<AnswerEvaluationOutput>(json);
        assert!(result.is_err(), "should reject missing verdict");
    }

    #[test]
    fn test_answer_evaluation_output_rejects_missing_per_question() {
        let json = serde_json::json!({
            "verdict": "sufficient",
            "answered_count": 5,
            "empty_count": 0,
            "vague_count": 0,
            "contradictory_count": 0,
            "total_count": 5,
            "reasoning": "All answered."
        });
        let result = serde_json::from_value::<AnswerEvaluationOutput>(json);
        assert!(result.is_err(), "should reject missing per_question");
    }
}
