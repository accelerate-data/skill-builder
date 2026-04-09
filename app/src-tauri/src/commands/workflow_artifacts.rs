//! Typed Rust structs for structured workflow step outputs.
//!
//! All struct definitions now live in `contracts::workflow_outputs`. This module
//! re-exports them for backward compatibility with existing consumers.

#[allow(unused_imports)] // PerQuestionEntry re-exported for downstream crate consumers
pub use crate::contracts::workflow_outputs::{
    AnswerEvaluationOutput, DecisionsOutput, DetailedResearchOutput, GenerateSkillOutput,
    PerQuestionEntry, ResearchStepOutput,
};

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
                    "title": "Test",
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
            "research_output": {
                "version": "1",
                "metadata": {
                    "title": "Test",
                    "question_count": 7,
                    "section_count": 0,
                    "refinement_count": 0,
                    "must_answer_count": 0
                }
            }
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
                "decision_count": 1,
                "conflicts_resolved": 0,
                "round": 1
            },
            "decisions": [
                {
                    "id": "D1",
                    "title": "Scope",
                    "original_question": "Include ETL pipeline?",
                    "decision": "Include ETL pipeline",
                    "implication": "Core requirement",
                    "status": "resolved"
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
    fn test_decisions_output_defaults_missing_version() {
        let json = serde_json::json!({
            "metadata": { "decision_count": 0, "conflicts_resolved": 0, "round": 1 },
            "decisions": []
        });
        let parsed: DecisionsOutput = serde_json::from_value(json).expect("should default missing fields");
        assert_eq!(parsed.version, "");
    }

    #[test]
    fn test_decisions_output_defaults_missing_decisions() {
        let json = serde_json::json!({
            "version": "1",
            "metadata": { "decision_count": 0, "conflicts_resolved": 0, "round": 1 }
        });
        let parsed: DecisionsOutput = serde_json::from_value(json).expect("should default missing fields");
        assert!(parsed.decisions.is_empty());
    }

    // ── GenerateSkillOutput ───────────────────────────────────────────────

    #[test]
    fn test_benchmark_skill_output_round_trip() {
        let json = serde_json::json!({
            "status": "complete",
            "benchmark_path": "evals/iterations/iteration-1"
        });

        let parsed: GenerateSkillOutput =
            serde_json::from_value(json).expect("deserialize GenerateSkillOutput");
        assert_eq!(parsed.status, "complete");
        assert_eq!(parsed.benchmark_path.as_deref(), Some("evals/iterations/iteration-1"));
    }

    #[test]
    fn test_generate_skill_output_no_benchmark_fields() {
        let json = serde_json::json!({
            "status": "generated",
            "call_trace": ["read-user-context", "write-skill"]
        });

        let parsed: GenerateSkillOutput =
            serde_json::from_value(json).expect("deserialize GenerateSkillOutput");
        assert_eq!(parsed.status, "generated");
        assert!(parsed.benchmark_path.is_none());
        assert!(parsed.skipped.is_none());
    }

    #[test]
    fn test_generate_skill_output_skipped() {
        let json = serde_json::json!({
            "status": "generated",
            "skipped": true
        });

        let parsed: GenerateSkillOutput =
            serde_json::from_value(json).expect("deserialize GenerateSkillOutput");
        assert_eq!(parsed.status, "generated");
        assert_eq!(parsed.skipped, Some(true));
    }

    #[test]
    fn test_generate_skill_output_rejects_missing_status() {
        let json = serde_json::json!({
            "benchmark_path": "evals/iterations/iteration-1"
        });
        let result = serde_json::from_value::<GenerateSkillOutput>(json);
        assert!(result.is_err(), "should reject missing status");
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
                {"question_id": "Q2", "verdict": "clear", "reason": null}
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
            "gate_decision": "revise",
            "per_question": [
                {
                    "question_id": "Q1",
                    "verdict": "contradictory",
                    "reason": "Conflicts with Q3."
                }
            ]
        });

        let parsed: AnswerEvaluationOutput =
            serde_json::from_value(json).expect("deserialize AnswerEvaluationOutput with contradictory");
        let entry = &parsed.per_question[0];
        assert_eq!(entry.verdict, "contradictory");
        assert_eq!(entry.reason.as_deref(), Some("Conflicts with Q3."));
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
    fn test_answer_evaluation_output_defaults_missing_per_question() {
        let json = serde_json::json!({
            "verdict": "sufficient",
            "answered_count": 5,
            "empty_count": 0,
            "vague_count": 0,
            "contradictory_count": 0,
            "total_count": 5,
            "reasoning": "All answered."
        });
        let parsed: AnswerEvaluationOutput = serde_json::from_value(json).expect("should default missing fields");
        assert!(parsed.per_question.is_empty());
    }
}
