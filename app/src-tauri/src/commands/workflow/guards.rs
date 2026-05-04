use crate::db::workflow_artifacts as db_artifacts;

/// Check if scope_recommendation == Some(true) in DB clarifications for this skill.
/// Returns false when no record exists.
pub(crate) fn check_scope_recommendation_db(conn: &rusqlite::Connection, skill_id: &str) -> bool {
    match db_artifacts::read_clarifications(conn, skill_id) {
        Ok(Some(rec)) => rec.scope_recommendation == Some(true),
        _ => false,
    }
}

/// Check DB decisions record for guard conditions:
/// - decision_count == 0  → no decisions were derivable
/// - any decision_item has status 'needs-review' → contradictions detected
///
/// Returns false when no decisions record exists.
pub(crate) fn check_decisions_guard_db(conn: &rusqlite::Connection, skill_id: &str) -> bool {
    match db_artifacts::read_decisions(conn, skill_id) {
        Ok(Some(rec)) => {
            if rec.decision_count == 0 {
                return true;
            }
            rec.items.iter().any(|item| item.status == "needs-review")
        }
        _ => false,
    }
}

/// Generate a unique agent ID from skill name, label, and timestamp.
pub(crate) fn make_agent_id(skill_name: &str, label: &str) -> String {
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!("{}-{}-{}", skill_name, label, ts)
}

/// Convert a step config name to a lowercase-hyphenated runtime label.
pub(crate) fn workflow_step_runtime_label(step: &crate::types::StepConfig) -> String {
    step.name.to_ascii_lowercase().replace(' ', "-")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;
    use crate::db::workflow_artifacts as db_artifacts;

    fn seed_skill(conn: &rusqlite::Connection, skill_id: &str) {
        conn.execute(
            "INSERT OR IGNORE INTO skills (name, skill_source, plugin_id) \
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = 'skills'))",
            rusqlite::params![skill_id],
        )
        .unwrap();
    }

    fn make_clarifications_record(
        skill_id: &str,
        scope_recommendation: Option<bool>,
        refinement_count: i64,
    ) -> db_artifacts::ClarificationsRecord {
        db_artifacts::ClarificationsRecord {
            skill_id: skill_id.to_string(),
            version: "1".to_string(),
            refinement_count,
            must_answer_count: 0,
            question_count: 0,
            section_count: 0,
            title: "Test".to_string(),
            scope_recommendation,
            scope_reason: None,
            scope_next_action: None,
            error_code: None,
            error_message: None,
            warning_code: None,
            warning_message: None,
            eval_verdict: None,
            eval_reasoning: None,
            eval_at: None,
            eval_answered_count: None,
            eval_empty_count: None,
            eval_vague_count: None,
            eval_contradictory_count: None,
            created_at: 0,
            updated_at: 0,
            sections: vec![],
            questions: vec![],
            notes: vec![],
        }
    }

    fn make_decisions_record(
        skill_id: &str,
        decision_count: i64,
        items: Vec<db_artifacts::DecisionItem>,
    ) -> db_artifacts::DecisionsRecord {
        db_artifacts::DecisionsRecord {
            skill_id: skill_id.to_string(),
            version: "1".to_string(),
            round: 0,
            decision_count,
            conflicts_resolved: 0,
            contradictory_inputs_state: None,
            scope_recommendation: None,
            created_at: 0,
            updated_at: 0,
            items,
        }
    }

    // ── check_scope_recommendation_db ────────────────────────────────────

    #[test]
    fn scope_recommendation_true_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-scope-true");
        let record = make_clarifications_record("skill-scope-true", Some(true), 0);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(check_scope_recommendation_db(&conn, "skill-scope-true"));
    }

    #[test]
    fn scope_recommendation_false_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-scope-false");
        let record = make_clarifications_record("skill-scope-false", Some(false), 0);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(!check_scope_recommendation_db(&conn, "skill-scope-false"));
    }

    #[test]
    fn scope_recommendation_none_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-scope-none");
        let record = make_clarifications_record("skill-scope-none", None, 0);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(!check_scope_recommendation_db(&conn, "skill-scope-none"));
    }

    #[test]
    fn scope_recommendation_no_record_db() {
        let conn = create_test_db_for_tests();
        assert!(!check_scope_recommendation_db(&conn, "nonexistent-skill"));
    }

    // ── check_decisions_guard_db ──────────────────────────────────────────

    #[test]
    fn decisions_guard_zero_count_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-dec-zero");
        let record = make_decisions_record("skill-dec-zero", 0, vec![]);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(check_decisions_guard_db(&conn, "skill-dec-zero"));
    }

    #[test]
    fn decisions_guard_needs_review_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-dec-review");
        let items = vec![db_artifacts::DecisionItem {
            decision_id: "d1".to_string(),
            ordinal: 0,
            title: "Decision 1".to_string(),
            original_question: "Q?".to_string(),
            decision: "Maybe".to_string(),
            implication: "TBD".to_string(),
            status: "needs-review".to_string(),
        }];
        let record = make_decisions_record("skill-dec-review", 1, items);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(check_decisions_guard_db(&conn, "skill-dec-review"));
    }

    #[test]
    fn decisions_guard_normal_resolved_db() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-dec-normal");
        let items = vec![db_artifacts::DecisionItem {
            decision_id: "d1".to_string(),
            ordinal: 0,
            title: "Decision 1".to_string(),
            original_question: "Q?".to_string(),
            decision: "Yes".to_string(),
            implication: "Good".to_string(),
            status: "resolved".to_string(),
        }];
        let record = make_decisions_record("skill-dec-normal", 1, items);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(!check_decisions_guard_db(&conn, "skill-dec-normal"));
    }

    #[test]
    fn decisions_guard_no_record_db() {
        let conn = create_test_db_for_tests();
        assert!(!check_decisions_guard_db(&conn, "nonexistent-skill"));
    }

    #[test]
    fn decisions_guard_conflict_resolved_not_blocked_db() {
        // 'conflict-resolved' is resolved, not 'needs-review'
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-dec-conflict-resolved");
        let items = vec![db_artifacts::DecisionItem {
            decision_id: "d1".to_string(),
            ordinal: 0,
            title: "Decision 1".to_string(),
            original_question: "Q?".to_string(),
            decision: "Resolved".to_string(),
            implication: "OK".to_string(),
            status: "conflict-resolved".to_string(),
        }];
        let record = make_decisions_record("skill-dec-conflict-resolved", 1, items);
        let tx = conn.transaction().unwrap();
        db_artifacts::upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();
        assert!(!check_decisions_guard_db(&conn, "skill-dec-conflict-resolved"));
    }
}

/// Core logic for validating decisions.json existence — testable without tauri::State.
/// Checks in order: skill output dir (skillsPath), workspace dir.
/// Returns Ok(()) if found, Err with a clear message if missing.
pub(crate) fn validate_decisions_exist_inner(
    skill_name: &str,
    workspace_path: &str,
    plugin_slug: &str,
    _skills_path: &str,
) -> Result<(), String> {
    let workspace_dir = crate::skill_paths::resolve_workspace_skill_dir(
        std::path::Path::new(workspace_path),
        plugin_slug,
        skill_name,
    );
    let path = workspace_dir.join("context").join("decisions.json");
    if path.exists() {
        let content = std::fs::read_to_string(&path).unwrap_or_default();
        if !content.trim().is_empty() {
            return Ok(());
        }
    }

    Err(
        "Cannot start Generate Skill step: decisions.json was not found on the filesystem. \
         The Confirm Decisions step (step 2) must create a decisions file before the Generate Skill step can run. \
         Please re-run the Confirm Decisions step first."
            .to_string(),
    )
}
