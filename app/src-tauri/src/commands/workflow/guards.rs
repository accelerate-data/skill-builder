use std::path::Path;

/// Check if clarifications.json has `metadata.scope_recommendation == true`.
pub(crate) fn parse_scope_recommendation(clarifications_path: &Path) -> bool {
    let content = match std::fs::read_to_string(clarifications_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let value: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    value["metadata"]["scope_recommendation"] == true
}

/// Check decisions.json for guard conditions:
/// - metadata.decision_count == 0  → no decisions were derivable
/// - metadata.contradictory_inputs: true → unresolvable contradictions detected
///
/// `contradictory_inputs: revised` is NOT a block — the user has reviewed
/// and edited the flagged decisions; treat decisions.json as authoritative.
///
/// Returns true if step 3 should be disabled.
pub(crate) fn parse_decisions_guard(decisions_path: &Path) -> bool {
    let content = match std::fs::read_to_string(decisions_path) {
        Ok(c) => c,
        Err(_) => return false,
    };
    let data: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return false,
    };
    let metadata = &data["metadata"];
    if super::coerce_to_i64(&metadata["decision_count"]) == Some(0) {
        return true;
    }
    if metadata["contradictory_inputs"].as_bool() == Some(true) {
        return true;
    }
    false
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
    use std::io::Write;

    // ── parse_scope_recommendation ──────────────────────────────────────

    #[test]
    fn scope_recommendation_true() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, r#"{{"metadata":{{"scope_recommendation":true}}}}"#).unwrap();
        assert!(parse_scope_recommendation(f.path()));
    }

    #[test]
    fn scope_recommendation_false() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, r#"{{"metadata":{{"scope_recommendation":false}}}}"#).unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    #[test]
    fn scope_recommendation_missing_field() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, r#"{{"metadata":{{"other":1}}}}"#).unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    #[test]
    fn scope_recommendation_malformed_json() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, "not json at all").unwrap();
        assert!(!parse_scope_recommendation(f.path()));
    }

    #[test]
    fn scope_recommendation_missing_file() {
        let p = Path::new("/tmp/nonexistent-scope-rec-test.json");
        assert!(!parse_scope_recommendation(p));
    }

    // ── parse_decisions_guard ───────────────────────────────────────────

    #[test]
    fn decisions_guard_zero_count() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(
            f,
            r#"{{"metadata":{{"decision_count":0,"contradictory_inputs":false}}}}"#
        )
        .unwrap();
        assert!(parse_decisions_guard(f.path()));
    }

    #[test]
    fn decisions_guard_contradictory() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(
            f,
            r#"{{"metadata":{{"decision_count":5,"contradictory_inputs":true}}}}"#
        )
        .unwrap();
        assert!(parse_decisions_guard(f.path()));
    }

    #[test]
    fn decisions_guard_contradictory_revised() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(
            f,
            r#"{{"metadata":{{"decision_count":5,"contradictory_inputs":"revised"}}}}"#
        )
        .unwrap();
        assert!(!parse_decisions_guard(f.path()));
    }

    #[test]
    fn decisions_guard_normal() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(
            f,
            r#"{{"metadata":{{"decision_count":3,"contradictory_inputs":false}}}}"#
        )
        .unwrap();
        assert!(!parse_decisions_guard(f.path()));
    }

    #[test]
    fn decisions_guard_malformed_json() {
        let mut f = tempfile::NamedTempFile::new().unwrap();
        write!(f, "{{broken").unwrap();
        assert!(!parse_decisions_guard(f.path()));
    }

    #[test]
    fn decisions_guard_missing_file() {
        let p = Path::new("/tmp/nonexistent-decisions-guard-test.json");
        assert!(!parse_decisions_guard(p));
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
        Path::new(workspace_path),
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
