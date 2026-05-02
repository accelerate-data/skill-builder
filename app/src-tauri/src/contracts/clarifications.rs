//! Canonical clarifications contract types.
//!
//! These types mirror the TypeScript definitions in `app/src/lib/clarifications-types.ts`
//! and serve as the single source of truth for the clarifications JSON schema.

/// Root type for a clarifications file.
#[derive(
    Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsFile {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub metadata: ClarificationsMetadata,
    #[serde(default)]
    pub sections: Vec<Section>,
    #[serde(default)]
    pub notes: Vec<Note>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_evaluator_notes: Option<Vec<Note>>,
}

/// Metadata block with counts, priority questions, and optional scope/research info.
#[derive(
    Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsMetadata {
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub question_count: i64,
    #[serde(default)]
    pub section_count: i64,
    #[serde(default)]
    pub refinement_count: i64,
    #[serde(default)]
    pub must_answer_count: i64,
    #[serde(default)]
    pub priority_questions: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicates_removed: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_next_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub research_plan: Option<ClarificationsResearchPlan>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<ClarificationsWarning>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<ClarificationsError>,
}

/// Warning attached to metadata.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsWarning {
    pub code: String,
    pub message: String,
}

/// Error attached to metadata.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsError {
    pub code: String,
    pub message: String,
}

/// Research plan with dimension scoring.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct ClarificationsResearchPlan {
    pub purpose: String,
    pub domain: String,
    pub topic_relevance: String,
    #[serde(default)]
    pub dimensions_evaluated: i64,
    #[serde(default)]
    pub dimensions_selected: i64,
    #[serde(default)]
    pub dimension_scores: Vec<DimensionScore>,
    #[serde(default)]
    pub selected_dimensions: Vec<SelectedDimension>,
}

/// A scored dimension in the research plan.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct DimensionScore {
    pub name: String,
    pub score: f64,
    pub reason: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub focus: Option<String>,
}

/// A dimension selected for deeper research.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct SelectedDimension {
    pub name: String,
    pub focus: String,
}

/// A section grouping related questions.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct Section {
    pub id: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default)]
    pub questions: Vec<Question>,
}

/// A question with choices and optional answer fields. Recursive via `refinements`.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct Question {
    pub id: String,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consolidated_from: Option<Vec<String>>,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
    #[serde(default)]
    pub refinements: Vec<Question>,
}

/// A multiple-choice option.
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct Choice {
    pub id: String,
    pub text: String,
    pub is_other: bool,
}

/// A note (research note or evaluator feedback).
#[derive(
    Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct Note {
    #[serde(rename = "type")]
    pub type_: String,
    pub title: String,
    pub body: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_round_trip_minimal_clarifications() {
        let file = ClarificationsFile {
            version: "1".to_string(),
            metadata: ClarificationsMetadata {
                title: "Test".to_string(),
                question_count: 1,
                section_count: 1,
                refinement_count: 0,
                must_answer_count: 1,
                priority_questions: vec!["Q1".to_string()],
                duplicates_removed: None,
                scope_recommendation: None,
                scope_reason: None,
                scope_next_action: None,
                research_plan: None,
                warning: None,
                error: None,
            },
            sections: vec![Section {
                id: 1,
                title: "Basics".to_string(),
                description: None,
                questions: vec![Question {
                    id: "Q1".to_string(),
                    title: "First question".to_string(),
                    text: "What is the purpose?".to_string(),
                    must_answer: true,
                    consolidated_from: None,
                    choices: vec![
                        Choice {
                            id: "A".to_string(),
                            text: "Option A".to_string(),
                            is_other: false,
                        },
                        Choice {
                            id: "B".to_string(),
                            text: "Option B".to_string(),
                            is_other: false,
                        },
                    ],
                    recommendation: Some("A".to_string()),
                    answer_choice: None,
                    answer_text: None,
                    refinements: vec![],
                }],
            }],
            notes: vec![],
            answer_evaluator_notes: None,
        };

        let json = serde_json::to_string(&file).expect("serialize");
        let deserialized: ClarificationsFile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.version, "1");
        assert_eq!(deserialized.metadata.question_count, 1);
        assert_eq!(deserialized.sections.len(), 1);
        assert_eq!(deserialized.sections[0].questions[0].id, "Q1");
        assert_eq!(deserialized.sections[0].questions[0].choices.len(), 2);
    }

    #[test]
    fn test_recursive_refinements() {
        let inner = Question {
            id: "R1.1a".to_string(),
            title: "Deep refinement".to_string(),
            text: "Nested question".to_string(),
            must_answer: false,
            consolidated_from: None,
            choices: vec![],
            recommendation: None,
            answer_choice: None,
            answer_text: None,
            refinements: vec![],
        };

        let outer = Question {
            id: "R1.1".to_string(),
            title: "Refinement".to_string(),
            text: "Follow-up question".to_string(),
            must_answer: false,
            consolidated_from: None,
            choices: vec![],
            recommendation: None,
            answer_choice: Some("A".to_string()),
            answer_text: None,
            refinements: vec![inner],
        };

        let json = serde_json::to_string(&outer).expect("serialize");
        let deserialized: Question = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.refinements.len(), 1);
        assert_eq!(deserialized.refinements[0].id, "R1.1a");
        assert_eq!(deserialized.refinements[0].refinements.len(), 0);
    }

    #[test]
    fn test_optional_fields_absent() {
        let json = r#"{
            "version": "1",
            "metadata": {
                "title": "Minimal",
                "question_count": 0,
                "section_count": 0,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [],
            "notes": []
        }"#;

        let file: ClarificationsFile = serde_json::from_str(json).expect("deserialize");
        assert!(file.answer_evaluator_notes.is_none());
        assert!(file.metadata.research_plan.is_none());
        assert!(file.metadata.warning.is_none());
        assert!(file.metadata.error.is_none());
        assert!(file.metadata.duplicates_removed.is_none());
        assert!(file.metadata.scope_recommendation.is_none());
        assert!(file.metadata.scope_reason.is_none());
        assert!(file.metadata.scope_next_action.is_none());

        // Re-serialize and confirm optional fields are omitted
        let reserialized = serde_json::to_string(&file).expect("serialize");
        assert!(!reserialized.contains("answer_evaluator_notes"));
        assert!(!reserialized.contains("research_plan"));
        assert!(!reserialized.contains("warning"));
        assert!(!reserialized.contains("error"));
    }

    #[test]
    fn test_note_type_rename() {
        let note = Note {
            type_: "inconsistency".to_string(),
            title: "Test note".to_string(),
            body: "Body text".to_string(),
        };

        let json = serde_json::to_string(&note).expect("serialize");
        assert!(json.contains(r#""type":"inconsistency"#));
        assert!(!json.contains("type_"));

        // Deserialize from JSON with "type" key
        let json_input = r#"{"type": "blocked", "title": "Blocked", "body": "reason"}"#;
        let deserialized: Note = serde_json::from_str(json_input).expect("deserialize");
        assert_eq!(deserialized.type_, "blocked");
    }

    #[test]
    fn test_full_metadata_with_research_plan() {
        let json = r#"{
            "version": "1",
            "metadata": {
                "title": "Full example",
                "question_count": 5,
                "section_count": 2,
                "refinement_count": 1,
                "must_answer_count": 3,
                "priority_questions": ["Q1", "Q2"],
                "duplicates_removed": 2,
                "scope_recommendation": true,
                "scope_reason": "Too broad",
                "scope_next_action": "Narrow focus",
                "research_plan": {
                    "purpose": "Understand domain",
                    "domain": "ML Ops",
                    "topic_relevance": "High",
                    "dimensions_evaluated": 8,
                    "dimensions_selected": 3,
                    "dimension_scores": [
                        {"name": "Data Quality", "score": 0.9, "reason": "Critical for ML", "focus": "Input validation"},
                        {"name": "Model Serving", "score": 0.7, "reason": "Important", "focus": "Latency"}
                    ],
                    "selected_dimensions": [
                        {"name": "Data Quality", "focus": "Input validation"},
                        {"name": "Model Serving", "focus": "Latency"}
                    ]
                },
                "warning": {"code": "scope_guard_triggered", "message": "Scope too broad"},
                "error": {"code": "missing_user_context", "message": "No context provided"}
            },
            "sections": [
                {
                    "id": 1,
                    "title": "Data Pipeline",
                    "description": "Questions about data flow",
                    "questions": [
                        {
                            "id": "Q1",
                            "title": "Data sources",
                            "text": "What data sources are used?",
                            "must_answer": true,
                            "choices": [
                                {"id": "A", "text": "Database", "is_other": false},
                                {"id": "B", "text": "API", "is_other": false},
                                {"id": "C", "text": "Other", "is_other": true}
                            ],
                            "recommendation": "A",
                            "answer_choice": "B",
                            "answer_text": null,
                            "refinements": [
                                {
                                    "id": "R1.1",
                                    "title": "API details",
                                    "text": "Which API?",
                                    "must_answer": false,
                                    "choices": [],
                                    "answer_choice": null,
                                    "answer_text": "REST API",
                                    "refinements": []
                                }
                            ]
                        }
                    ]
                }
            ],
            "notes": [
                {"type": "inconsistency", "title": "Conflict", "body": "Data sources conflict with pipeline design"}
            ],
            "answer_evaluator_notes": [
                {"type": "answer_feedback", "title": "Incomplete", "body": "Q1 needs more detail"}
            ]
        }"#;

        let file: ClarificationsFile = serde_json::from_str(json).expect("deserialize");

        // Metadata
        assert_eq!(file.metadata.title, "Full example");
        assert_eq!(file.metadata.question_count, 5);
        assert_eq!(file.metadata.duplicates_removed, Some(2));
        assert_eq!(file.metadata.scope_recommendation, Some(true));
        assert_eq!(file.metadata.scope_reason.as_deref(), Some("Too broad"));

        // Research plan
        let plan = file.metadata.research_plan.as_ref().expect("research_plan");
        assert_eq!(plan.purpose, "Understand domain");
        assert_eq!(plan.dimensions_evaluated, 8);
        assert_eq!(plan.dimension_scores.len(), 2);
        assert_eq!(plan.selected_dimensions.len(), 2);
        assert!((plan.dimension_scores[0].score - 0.9).abs() < f64::EPSILON);

        // Warning and error
        assert_eq!(
            file.metadata.warning.as_ref().unwrap().code,
            "scope_guard_triggered"
        );
        assert_eq!(
            file.metadata.error.as_ref().unwrap().code,
            "missing_user_context"
        );

        // Sections and questions
        assert_eq!(file.sections.len(), 1);
        assert_eq!(
            file.sections[0].description.as_deref(),
            Some("Questions about data flow")
        );
        let q1 = &file.sections[0].questions[0];
        assert_eq!(q1.answer_choice.as_deref(), Some("B"));
        assert!(q1.answer_text.is_none());
        assert_eq!(q1.refinements.len(), 1);
        assert_eq!(q1.refinements[0].answer_text.as_deref(), Some("REST API"));

        // Notes
        assert_eq!(file.notes.len(), 1);
        assert_eq!(file.notes[0].type_, "inconsistency");

        // Answer evaluator notes
        let eval_notes = file
            .answer_evaluator_notes
            .as_ref()
            .expect("evaluator notes");
        assert_eq!(eval_notes.len(), 1);
        assert_eq!(eval_notes[0].type_, "answer_feedback");

        // Round-trip
        let reserialized = serde_json::to_string_pretty(&file).expect("serialize");
        let roundtrip: ClarificationsFile = serde_json::from_str(&reserialized).expect("roundtrip");
        assert_eq!(roundtrip.metadata.title, file.metadata.title);
    }

    #[test]
    fn test_dimension_score_focus_accepts_null_for_unselected_dimensions() {
        let json = serde_json::json!({
            "name": "segmentation-and-periods",
            "score": 3.0,
            "reason": "Useful but mostly standard.",
            "focus": null
        });

        let score: DimensionScore = serde_json::from_value(json).unwrap();
        assert!(score.focus.is_none());
    }
}
