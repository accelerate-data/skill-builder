//! Canonical decisions contract types.
//!
//! These types mirror the TypeScript definitions in
//! `app/src/components/decisions-summary-card.tsx` and serve as the
//! single source of truth for the decisions JSON schema.

/// Union type for contradictory inputs: `true` (active) or `"revised"` (string).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
#[serde(untagged)]
pub enum ContradictoryInputs {
    Active(bool),
    Revised(String),
}

/// Status of a single decision.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
#[serde(rename_all = "kebab-case")]
pub enum DecisionStatus {
    Resolved,
    ConflictResolved,
    NeedsReview,
    Revised,
}

/// Top-level metadata block for a decisions file.
#[derive(Debug, Clone, Default, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct DecisionsMetadata {
    #[serde(default)]
    pub decision_count: i64,
    #[serde(default)]
    pub conflicts_resolved: i64,
    #[serde(default)]
    pub round: i64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub contradictory_inputs: Option<ContradictoryInputs>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
}

/// A single decision entry.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct Decision {
    pub id: String,
    pub title: String,
    pub original_question: String,
    pub decision: String,
    pub implication: String,
    pub status: DecisionStatus,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decisions_metadata_round_trip() {
        let meta = DecisionsMetadata {
            decision_count: 5,
            conflicts_resolved: 2,
            round: 1,
            contradictory_inputs: Some(ContradictoryInputs::Active(true)),
            scope_recommendation: Some(true),
        };

        let json = serde_json::to_string(&meta).expect("serialize");
        let deserialized: DecisionsMetadata = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.decision_count, 5);
        assert_eq!(deserialized.conflicts_resolved, 2);
        assert_eq!(deserialized.round, 1);
    }

    #[test]
    fn test_decision_status_kebab_case() {
        let cases = vec![
            (DecisionStatus::Resolved, "\"resolved\""),
            (DecisionStatus::ConflictResolved, "\"conflict-resolved\""),
            (DecisionStatus::NeedsReview, "\"needs-review\""),
            (DecisionStatus::Revised, "\"revised\""),
        ];

        for (status, expected) in cases {
            let json = serde_json::to_string(&status).expect("serialize");
            assert_eq!(json, expected, "status {:?} serialized wrong", status);

            let deserialized: DecisionStatus =
                serde_json::from_str(&json).expect("deserialize");
            // Round-trip check: re-serialize should match
            assert_eq!(serde_json::to_string(&deserialized).unwrap(), expected);
        }
    }

    #[test]
    fn test_contradictory_inputs_active() {
        let ci = ContradictoryInputs::Active(true);
        let json = serde_json::to_string(&ci).expect("serialize");
        assert_eq!(json, "true");

        let deserialized: ContradictoryInputs = serde_json::from_str(&json).expect("deserialize");
        match deserialized {
            ContradictoryInputs::Active(v) => assert!(v),
            _ => panic!("expected Active variant"),
        }
    }

    #[test]
    fn test_contradictory_inputs_revised() {
        let ci = ContradictoryInputs::Revised("revised".to_string());
        let json = serde_json::to_string(&ci).expect("serialize");
        assert_eq!(json, "\"revised\"");

        let deserialized: ContradictoryInputs = serde_json::from_str(&json).expect("deserialize");
        match deserialized {
            ContradictoryInputs::Revised(v) => assert_eq!(v, "revised"),
            _ => panic!("expected Revised variant"),
        }
    }

    #[test]
    fn test_decision_round_trip() {
        let decision = Decision {
            id: "D1".to_string(),
            title: "API Framework".to_string(),
            original_question: "Which API framework?".to_string(),
            decision: "Use Actix-Web".to_string(),
            implication: "Need to learn Actix".to_string(),
            status: DecisionStatus::Resolved,
        };

        let json = serde_json::to_string(&decision).expect("serialize");
        assert!(json.contains("\"status\":\"resolved\""));

        let deserialized: Decision = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(deserialized.id, "D1");
        assert_eq!(deserialized.title, "API Framework");
    }

    #[test]
    fn test_optional_fields_absent() {
        let json = r#"{
            "decision_count": 3,
            "conflicts_resolved": 1,
            "round": 2
        }"#;

        let meta: DecisionsMetadata = serde_json::from_str(json).expect("deserialize");
        assert!(meta.contradictory_inputs.is_none());
        assert!(meta.scope_recommendation.is_none());

        // Re-serialize and confirm optional fields are omitted
        let reserialized = serde_json::to_string(&meta).expect("serialize");
        assert!(!reserialized.contains("contradictory_inputs"));
        assert!(!reserialized.contains("scope_recommendation"));
    }

    #[test]
    fn test_full_decisions_json() {
        let json = r#"{
            "version": "1",
            "metadata": {
                "decision_count": 2,
                "conflicts_resolved": 1,
                "round": 1,
                "contradictory_inputs": "revised",
                "scope_recommendation": true
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
        }"#;

        #[derive(serde::Deserialize)]
        struct DecisionsFile {
            version: String,
            metadata: DecisionsMetadata,
            decisions: Vec<Decision>,
        }

        let file: DecisionsFile = serde_json::from_str(json).expect("deserialize");
        assert_eq!(file.version, "1");
        assert_eq!(file.metadata.decision_count, 2);
        assert_eq!(file.decisions.len(), 2);

        match &file.metadata.contradictory_inputs {
            Some(ContradictoryInputs::Revised(v)) => assert_eq!(v, "revised"),
            other => panic!("expected Revised, got {:?}", other),
        }

        match file.decisions[1].status {
            DecisionStatus::ConflictResolved => {}
            ref other => panic!("expected ConflictResolved, got {:?}", other),
        }
    }
}
