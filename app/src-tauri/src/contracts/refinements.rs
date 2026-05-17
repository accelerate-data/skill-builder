//! Canonical refinements contract types.
//!
//! The shape intentionally matches `ClarificationsFile`, but the top-level type
//! name is distinct so step-1 contracts no longer mislabel `refinements_json`
//! as another clarifications file.

use crate::contracts::clarifications::{ClarificationsMetadata, Note, Section};

/// Root type for a refinements file.
#[derive(
    Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema,
)]
pub struct RefinementsFile {
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::clarifications::{Choice, Question};

    #[test]
    fn test_round_trip_minimal_refinements() {
        let file = RefinementsFile {
            version: "1".to_string(),
            metadata: ClarificationsMetadata {
                title: "Refinements".to_string(),
                question_count: 1,
                section_count: 1,
                refinement_count: 1,
                must_answer_count: 1,
                priority_questions: vec!["R1".to_string()],
                duplicates_removed: None,
                scope_recommendation: None,
                scope_reason: None,
                scope_next_action: None,
                warning: None,
                error: None,
            },
            sections: vec![Section {
                id: 1,
                title: "Follow-up".to_string(),
                description: None,
                questions: vec![Question {
                    id: "R1".to_string(),
                    title: "Refinement".to_string(),
                    text: "Need more detail?".to_string(),
                    must_answer: true,
                    consolidated_from: None,
                    choices: vec![Choice {
                        id: "A".to_string(),
                        text: "Yes".to_string(),
                        is_other: false,
                    }],
                    recommendation: Some("A".to_string()),
                    answer_choice: None,
                    answer_text: None,
                }],
            }],
            notes: vec![],
            answer_evaluator_notes: None,
        };

        let json = serde_json::to_string(&file).expect("serialize");
        let deserialized: RefinementsFile = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.version, "1");
        assert_eq!(deserialized.metadata.question_count, 1);
        assert_eq!(deserialized.sections[0].questions[0].id, "R1");
    }

    #[test]
    fn test_optional_fields_absent() {
        let json = r#"{
            "version": "1",
            "metadata": {
                "title": "Refinements",
                "question_count": 0,
                "section_count": 0,
                "refinement_count": 0,
                "must_answer_count": 0,
                "priority_questions": []
            },
            "sections": [],
            "notes": []
        }"#;

        let file: RefinementsFile = serde_json::from_str(json).expect("deserialize");
        assert!(file.answer_evaluator_notes.is_none());
        assert!(file.metadata.warning.is_none());
        assert!(file.metadata.error.is_none());

        let reserialized = serde_json::to_string(&file).expect("serialize");
        assert!(!reserialized.contains("answer_evaluator_notes"));
    }
}
