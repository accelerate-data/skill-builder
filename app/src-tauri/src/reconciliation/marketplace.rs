use std::path::Path;

/// Reconcile a marketplace skill: check that SKILL.md still exists on disk.
/// If missing, delete from skills master (scenario 12).
pub(crate) fn reconcile_marketplace(
    conn: &rusqlite::Connection,
    name: &str,
    skills_path: &str,
    notifications: &mut Vec<String>,
) -> Result<(), String> {
    let skill_md = Path::new(skills_path).join(name).join("SKILL.md");
    if skill_md.exists() {
        // Scenario 11: SKILL.md exists — no action
        log::debug!(
            "[reconcile] '{}': skill_source=marketplace, action=none (SKILL.md exists)",
            name
        );
    } else {
        // Scenario 12: SKILL.md missing — delete from master
        log::info!(
            "[reconcile] '{}': skill_source=marketplace, action=delete (SKILL.md not found)",
            name
        );
        crate::db::delete_skill(conn, name)?;
        notifications.push(format!(
            "'{}' marketplace skill removed — SKILL.md not found on disk",
            name
        ));
    }
    Ok(())
}
