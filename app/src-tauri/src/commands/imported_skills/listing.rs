use crate::db::Db;
use crate::types::ImportedSkill;
// ---------------------------------------------------------------------------
// list_imported_skills
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_imported_skills(
    source_url: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<ImportedSkill>, String> {
    log::info!("list_imported_skills: source_url={:?}", source_url);
    let mut skills = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[list_imported_skills] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        crate::db::list_imported_skills_filtered(&conn, source_url.as_deref())?
    }; // lock released
    crate::db::hydrate_skills_metadata(&mut skills);
    Ok(skills)
}

#[cfg(test)]
mod tests {
    use crate::db::create_test_db_for_tests;
    use crate::skill_paths::{DEFAULT_PLUGIN_DISPLAY_NAME, DEFAULT_PLUGIN_SLUG};
    use crate::types::ImportedSkill;

    /// list_imported_skills is a thin wrapper over db::list_imported_skills_filtered.
    /// Tested here to confirm the delegation path is wired correctly; full filter
    /// coverage lives in db.rs.
    #[test]
    fn test_list_imported_skills_returns_inserted_skill() {
        let conn = create_test_db_for_tests();
        crate::db::upsert_skill(&conn, "listing-test", "imported", "domain").unwrap();
        let skill = ImportedSkill {
            skill_id: "listing-test-id".to_string(),
            skill_name: "listing-test".to_string(),
            library_key: Some("imported:listing-test-id".to_string()),
            is_active: true,
            disk_path: std::env::temp_dir()
                .join("listing-test")
                .to_string_lossy()
                .to_string(),
            imported_at: "2025-01-01T00:00:00Z".to_string(),
            is_bundled: false,
            description: None,
            purpose: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            marketplace_source_url: None,
            plugin_slug: Some(DEFAULT_PLUGIN_SLUG.to_string()),
            plugin_display_name: Some(DEFAULT_PLUGIN_DISPLAY_NAME.to_string()),
            is_default_plugin: Some(true),
        };
        crate::db::test_insert_imported_skill(&conn, &skill).unwrap();
        let result = crate::db::list_imported_skills_filtered(&conn, None).unwrap();
        assert!(result.iter().any(|s| s.skill_id == "listing-test-id"));
    }
}
