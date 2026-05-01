//! Canonical workflow step output wrapper types.
//!
//! Each struct mirrors exactly the JSON schema enforced by the agent's `output_format`
//! contract. These replace the `serde_json::Value` fields in the original
//! `commands/workflow_artifacts.rs` with strongly typed contract types.

use crate::contracts::clarifications::ClarificationsFile;
use crate::contracts::decisions::{Decision, DecisionsMetadata};

// ─── Step 0: Research Agent ──────────────────────────────────────────────────

/// Structured output produced by the OpenHands research workflow step.
///
/// Required fields: `status` (const `"research_complete"`), `dimensions_selected`,
/// `question_count`, `research_output`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct ResearchStepOutput {
    pub status: String,
    pub dimensions_selected: i64,
    pub question_count: i64,
    pub research_output: ClarificationsFile,
}

// ─── Step 1: Research Agent Refinement ───────────────────────────────────────

/// Structured output produced by the OpenHands detailed-research workflow step.
///
/// Required fields: `status` (const `"detailed_research_complete"`), `refinement_count`,
/// `section_count`, `clarifications_json`.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct DetailedResearchOutput {
    pub status: String,
    pub refinement_count: i64,
    pub section_count: i64,
    pub clarifications_json: ClarificationsFile,
}

// ─── Step 2: Decision Confirmation ───────────────────────────────────────────

/// Structured output produced by the OpenHands decision-confirmation workflow step.
///
/// All fields are required per the agent SKILL.md contract.
/// `version` is always `"1"`, `metadata` and `decisions` are always present.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct DecisionsOutput {
    pub version: String,
    pub metadata: DecisionsMetadata,
    pub decisions: Vec<Decision>,
}

// ─── Step 3: Generate / Benchmark Skill ──────────────────────────────────────

/// Structured output produced by the `generate-skill` agent (workflow step 3,
/// writing phase) or the `benchmark-skill` agent (benchmark phase).
///
/// generate-skill:  `{ status: "generated", skipped?: true, commit_summary?, version_bump?, call_trace }`
/// rewrite-skill:   `{ status: "rewritten", skipped?: true, commit_summary?, version_bump?, call_trace }`
/// benchmark-skill:  `{ status: "complete"|"partial"|"skipped", benchmark_path?, call_trace }`
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct GenerateSkillOutput {
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub benchmark_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skipped: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub commit_summary: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version_bump: Option<String>,
}

// ─── Answer Evaluator ────────────────────────────────────────────────────────

/// Per-question verdict entry within an [`AnswerEvaluationOutput`].
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct PerQuestionEntry {
    pub question_id: String,
    pub verdict: String,
    pub reason: Option<String>,
}

/// Structured output produced by the answer-evaluator agent (transition gate between
/// steps 1 and 2).
///
/// Required fields: `verdict`, `answered_count`, `empty_count`, `vague_count`,
/// `contradictory_count`, `total_count`, `reasoning`, `gate_decision`, `per_question`.
///
/// `gate_decision` is one of `"run_research"`, `"revise"` — set automatically by the agent
/// based on verdict and contradictory_count (no user interaction required).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct AnswerEvaluationOutput {
    pub verdict: String,
    #[serde(default)]
    pub answered_count: i64,
    #[serde(default)]
    pub empty_count: i64,
    #[serde(default)]
    pub vague_count: i64,
    #[serde(default)]
    pub contradictory_count: i64,
    #[serde(default)]
    pub total_count: i64,
    #[serde(default)]
    pub reasoning: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub gate_decision: Option<String>,
    #[serde(default)]
    pub per_question: Vec<PerQuestionEntry>,
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::clarifications::ClarificationsMetadata;
    use crate::contracts::decisions::DecisionStatus;

    #[test]
    fn test_research_step_output_round_trip() {
        let output = ResearchStepOutput {
            status: "research_complete".to_string(),
            dimensions_selected: 3,
            question_count: 7,
            research_output: ClarificationsFile {
                version: "1".to_string(),
                metadata: ClarificationsMetadata {
                    title: "Test".to_string(),
                    question_count: 7,
                    section_count: 2,
                    refinement_count: 0,
                    must_answer_count: 3,
                    priority_questions: vec![],
                    duplicates_removed: None,
                    scope_recommendation: None,
                    scope_reason: None,
                    scope_next_action: None,
                    research_plan: None,
                    warning: None,
                    error: None,
                },
                sections: vec![],
                notes: vec![],
                answer_evaluator_notes: None,
            },
        };

        let json = serde_json::to_string(&output).expect("serialize");
        let deserialized: ResearchStepOutput = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.status, "research_complete");
        assert_eq!(deserialized.dimensions_selected, 3);
        assert_eq!(deserialized.question_count, 7);
        assert_eq!(deserialized.research_output.version, "1");
    }

    #[test]
    fn test_research_step_output_from_json() {
        let json = serde_json::json!({
            "status": "research_complete",
            "dimensions_selected": 3,
            "question_count": 7,
            "research_output": {
                "version": "1",
                "metadata": {
                    "title": "Test",
                    "question_count": 7,
                    "section_count": 2,
                    "refinement_count": 0,
                    "must_answer_count": 3,
                    "priority_questions": []
                },
                "sections": [],
                "notes": []
            }
        });

        let parsed: ResearchStepOutput =
            serde_json::from_value(json).expect("deserialize ResearchStepOutput");
        assert_eq!(parsed.status, "research_complete");
        assert_eq!(parsed.research_output.metadata.question_count, 7);
    }

    #[test]
    fn test_detailed_research_output_round_trip() {
        let json = serde_json::json!({
            "status": "detailed_research_complete",
            "refinement_count": 2,
            "section_count": 3,
            "clarifications_json": {
                "version": "1",
                "metadata": {
                    "title": "Detailed",
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
        assert_eq!(parsed.clarifications_json.metadata.section_count, 3);
    }

    #[test]
    fn test_decisions_output_round_trip() {
        let json = serde_json::json!({
            "version": "1",
            "metadata": {
                "decision_count": 2,
                "conflicts_resolved": 1,
                "round": 1
            },
            "decisions": [
                {
                    "id": "D1",
                    "title": "Framework Choice",
                    "original_question": "Which framework?",
                    "decision": "Use React",
                    "implication": "Need React expertise",
                    "status": "resolved"
                },
                {
                    "id": "D2",
                    "title": "Database",
                    "original_question": "SQL vs NoSQL?",
                    "decision": "Use PostgreSQL",
                    "implication": "Need migrations",
                    "status": "conflict-resolved"
                }
            ]
        });

        let parsed: DecisionsOutput =
            serde_json::from_value(json).expect("deserialize DecisionsOutput");
        assert_eq!(parsed.version, "1");
        assert_eq!(parsed.metadata.decision_count, 2);
        assert_eq!(parsed.metadata.conflicts_resolved, 1);
        assert_eq!(parsed.decisions.len(), 2);
        assert_eq!(parsed.decisions[0].id, "D1");
        match parsed.decisions[1].status {
            DecisionStatus::ConflictResolved => {}
            ref other => panic!("expected ConflictResolved, got {:?}", other),
        }

        // Round-trip
        let reserialized = serde_json::to_value(&parsed).expect("serialize");
        assert_eq!(reserialized["version"], "1");
        assert_eq!(reserialized["decisions"].as_array().unwrap().len(), 2);
    }

    #[test]
    fn test_generate_skill_output_round_trip() {
        let json = serde_json::json!({
            "status": "generated",
            "commit_summary": "Added new skill",
            "version_bump": "1.0.0"
        });

        let parsed: GenerateSkillOutput =
            serde_json::from_value(json).expect("deserialize GenerateSkillOutput");
        assert_eq!(parsed.status, "generated");
        assert_eq!(parsed.commit_summary.as_deref(), Some("Added new skill"));
        assert_eq!(parsed.version_bump.as_deref(), Some("1.0.0"));
        assert!(parsed.benchmark_path.is_none());
        assert!(parsed.skipped.is_none());
    }

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
                {"question_id": "Q2", "verdict": "clear", "reason": null}
            ]
        });

        let parsed: AnswerEvaluationOutput =
            serde_json::from_value(json).expect("deserialize AnswerEvaluationOutput");
        assert_eq!(parsed.verdict, "sufficient");
        assert_eq!(parsed.answered_count, 5);
        assert_eq!(parsed.per_question.len(), 2);
        assert!(parsed.gate_decision.is_none());
    }
}
