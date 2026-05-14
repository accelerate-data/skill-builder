use crate::db::Db;
use crate::skill_paths::DEFAULT_PLUGIN_SLUG;
use rusqlite::OptionalExtension;
use std::path::Path;

use super::frontmatter::parse_frontmatter_full;
use super::helpers::{
    extract_archive, find_skill_md, generate_skill_id, get_archive_prefix, validate_skill_name,
};

// ---------------------------------------------------------------------------
// parse_skill_file / import_skill_from_file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn parse_skill_file(file_path: String) -> Result<crate::types::SkillFileMeta, String> {
    log::info!("[parse_skill_file] file_path={}", file_path);
    let zip_file =
        std::fs::File::open(&file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|_| "not a valid skill package".to_string())?;
    let (_, skill_md_content) = find_skill_md(&mut archive)?;
    let fm = parse_frontmatter_full(&skill_md_content);
    if fm.name.is_none() {
        return Err("not a valid skill package: missing name field".to_string());
    }
    Ok(crate::types::SkillFileMeta {
        name: fm.name,
        description: fm.description,
        version: fm.version,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
    })
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn import_skill_from_file(
    file_path: String,
    name: String,
    description: String,
    version: String,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!("[import_skill_from_file] name={}", name);

    validate_skill_name(&name)?;

    let conn = db.0.lock().map_err(|e| {
        log::error!("[import_skill_from_file] failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn).map_err(|e| {
        log::error!("[import_skill_from_file] failed to read settings: {}", e);
        e
    })?;
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Set it in Settings.".to_string())?;
    let preferred_author = settings
        .github_user_email
        .clone()
        .or(settings.github_user_login.clone());
    let skill_id = import_skill_from_file_inner(
        &conn,
        &file_path,
        &name,
        &description,
        if version.is_empty() {
            None
        } else {
            Some(version.as_str())
        },
        user_invocable,
        disable_model_invocation,
        &skills_path,
        preferred_author.as_deref(),
    )?;
    Ok(skill_id)
}

#[allow(clippy::too_many_arguments)]
fn import_skill_from_file_inner(
    conn: &rusqlite::Connection,
    file_path: &str,
    name: &str,
    description: &str,
    version: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    skills_path: &str,
    preferred_author: Option<&str>,
) -> Result<String, String> {
    validate_skill_name(name)?;

    // Re-validate zip (prevent TOCTOU between parse and import)
    let zip_file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|_| "not a valid skill package".to_string())?;
    let (skill_md_path, _) = find_skill_md(&mut archive)?;
    let prefix = get_archive_prefix(&skill_md_path);

    // Conflict check: reject upload if a skill with this name already exists
    // in the default plugin (skills folder)
    let default_slug = crate::skill_paths::DEFAULT_PLUGIN_SLUG;
    let existing_source: Option<String> = conn
        .query_row(
            "SELECT s.skill_source
             FROM skills s
             JOIN plugins p ON p.id = s.plugin_id
             WHERE s.name = ?1 AND p.slug = ?2",
            rusqlite::params![&name, default_slug],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if existing_source.is_some() {
        return Err(format!(
            "A skill named '{}' already exists in the default plugin. Rename or delete it first.",
            name
        ));
    }

    // Extract to plugin-nested path: {skills_path}/{default_slug}/{name}/
    let dest_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(skills_path), default_slug, name);
    if let Some(parent) = dest_dir.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    // Re-open archive (consumed during prefix scan)
    let zip_file2 =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to re-open file: {}", e))?;
    let mut archive2 =
        zip::ZipArchive::new(zip_file2).map_err(|_| "not a valid skill package".to_string())?;
    extract_archive(&mut archive2, &prefix, &dest_dir)?;

    let skill_dir_for_git =
        crate::skill_paths::resolve_skill_dir(Path::new(skills_path), default_slug, name);
    let normalized_frontmatter = match super::frontmatter::ensure_skill_frontmatter_metadata(
        &dest_dir.join("SKILL.md"),
        version,
        preferred_author,
    ) {
        Ok(normalized) => normalized,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            return Err(e);
        }
    };
    let final_version = normalized_frontmatter.version.clone();

    let import_git_result = (|| -> Result<(), String> {
        crate::git::ensure_repo(&skill_dir_for_git)
            .map_err(|e| format!("Failed to init git repo: {}", e))?;
        if crate::git::skill_version_tag_exists(
            &skill_dir_for_git,
            default_slug,
            name,
            &final_version,
        )? {
            return Err(format!(
                "Tag '{}' already exists",
                crate::git::skill_version_tag_name(default_slug, name, &final_version)
            ));
        }

        crate::git::commit_all(&skill_dir_for_git, &format!("{}: import from upload", name))?;
        crate::git::create_skill_version_tag(
            &skill_dir_for_git,
            default_slug,
            name,
            &final_version,
        )?;
        Ok(())
    })();
    if let Err(e) = import_git_result {
        let _ = std::fs::remove_dir_all(&dest_dir);
        return Err(e);
    }

    // Step 1: Create/update skill master row (linked to default plugin)
    let skill_master_id = crate::db::upsert_skill_with_source_in_plugin(
        conn,
        name,
        "imported",
        "domain",
        DEFAULT_PLUGIN_SLUG,
    )?;

    // Update description on skill master
    conn.execute(
        "UPDATE skills SET description = ?2 WHERE id = ?1",
        rusqlite::params![skill_master_id, description],
    )
    .map_err(|e| e.to_string())?;

    // Step 2: Create/update imported_skills row (linked to skill master)
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let skill = crate::types::ImportedSkill {
        skill_id: skill_master_id,
        skill_name: name.to_string(),
        library_key: None,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        description: Some(description.to_string()),
        purpose: Some("domain".to_string()),
        version: Some(final_version),
        user_invocable,
        disable_model_invocation,
        marketplace_source_url: None,
        plugin_slug: Some(DEFAULT_PLUGIN_SLUG.to_string()),
        plugin_display_name: Some(crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME.to_string()),
        is_default_plugin: Some(true),
    };
    crate::db::upsert_imported_skill(conn, &skill, skill_master_id)?;

    log::info!(
        "[import_skill_from_file] imported '{}' to '{}'",
        name,
        dest_dir.display()
    );
    Ok(name.to_string())
}

#[cfg(test)]
mod tests {
    use super::import_skill_from_file_inner;
    use tempfile::tempdir;

    fn write_skill_zip(zip_path: &std::path::Path, skill_md: &str) {
        let file = std::fs::File::create(zip_path).unwrap();
        let mut writer = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        writer.start_file("SKILL.md", options).unwrap();
        std::io::Write::write_all(&mut writer, skill_md.as_bytes()).unwrap();
        writer.finish().unwrap();
    }

    #[test]
    fn import_skill_from_file_adds_default_version_commits_and_tags() {
        let conn = crate::db::create_test_db_for_tests();
        let dir = tempdir().unwrap();
        let skills_path = dir.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();
        // No ensure_repo at the root — per-skill repos only

        let zip_path = dir.path().join("skill.zip");
        write_skill_zip(
            &zip_path,
            "---\nname: imported-skill\ndescription: Uploaded skill\n---\n# Body\n",
        );

        let result = import_skill_from_file_inner(
            &conn,
            zip_path.to_str().unwrap(),
            "imported-skill",
            "Uploaded skill",
            None,
            None,
            None,
            skills_path.to_str().unwrap(),
            Some("hb@acceleratedata.ai"),
        );

        assert!(result.is_ok(), "expected import to succeed: {:?}", result);
        let skill_dir = crate::skill_paths::resolve_skill_dir(
            &skills_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "imported-skill",
        );
        assert!(crate::git::skill_version_tag_exists(
            &skill_dir,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "imported-skill",
            "1.0.0"
        )
        .unwrap());
        assert_eq!(
            crate::db::get_imported_skill(
                &conn,
                "imported-skill",
                crate::skill_paths::DEFAULT_PLUGIN_SLUG
            )
            .unwrap()
            .unwrap()
            .version
            .as_deref(),
            Some("1.0.0")
        );
        assert!(std::fs::read_to_string(skill_dir.join("SKILL.md"))
            .unwrap()
            .contains("metadata:\n  version: \"1.0.0\"\n  author: \"hb@acceleratedata.ai\""));
    }

    #[test]
    fn import_skill_from_file_rejects_existing_version_tag() {
        let conn = crate::db::create_test_db_for_tests();
        let dir = tempdir().unwrap();
        let skills_path = dir.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();
        // Seed a per-skill repo with the tag already present
        let seeded_skill_dir = crate::skill_paths::resolve_skill_dir(
            &skills_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "imported-skill",
        );
        std::fs::create_dir_all(&seeded_skill_dir).unwrap();
        std::fs::write(
            seeded_skill_dir.join("SKILL.md"),
            "---\nname: imported-skill\ndescription: Existing\nversion: 1.0.0\n---\n# Body\n",
        )
        .unwrap();
        crate::git::ensure_repo(&seeded_skill_dir).unwrap();
        crate::git::commit_all(&seeded_skill_dir, "imported-skill: seed").unwrap();
        crate::git::create_skill_version_tag(
            &seeded_skill_dir,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "imported-skill",
            "1.0.0",
        )
        .unwrap();
        // Remove only the SKILL.md so the .git dir (with the tag) is preserved,
        // but the skill is no longer "installed" — simulating a prior import that was cleaned.
        std::fs::remove_file(seeded_skill_dir.join("SKILL.md")).unwrap();

        let zip_path = dir.path().join("skill.zip");
        write_skill_zip(
            &zip_path,
            "---\nname: imported-skill\ndescription: Uploaded skill\nversion: 1.0.0\n---\n# Body\n",
        );

        let err = import_skill_from_file_inner(
            &conn,
            zip_path.to_str().unwrap(),
            "imported-skill",
            "Uploaded skill",
            Some("1.0.0"),
            None,
            None,
            skills_path.to_str().unwrap(),
            Some("hb@acceleratedata.ai"),
        )
        .unwrap_err();

        assert!(err.contains("already exists"));
        assert!(crate::db::get_imported_skill(
            &conn,
            "imported-skill",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG
        )
        .unwrap()
        .is_none());
    }

    #[test]
    fn import_skill_from_file_creates_per_skill_git_repo() {
        let conn = crate::db::create_test_db_for_tests();
        let dir = tempfile::tempdir().unwrap();
        let skills_path = dir.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();
        // Note: NO ensure_repo at skills root — per-skill repos only

        let zip_path = dir.path().join("skill.zip");
        write_skill_zip(
            &zip_path,
            "---\nname: per-skill-import\ndescription: Test\n---\n# Body\n",
        );

        let result = import_skill_from_file_inner(
            &conn,
            zip_path.to_str().unwrap(),
            "per-skill-import",
            "Test",
            None,
            None,
            None,
            skills_path.to_str().unwrap(),
            None,
        );
        assert!(result.is_ok(), "{:?}", result);

        let skill_dir = crate::skill_paths::resolve_skill_dir(
            &skills_path,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "per-skill-import",
        );
        assert!(
            skill_dir.join(".git").exists(),
            "per-skill .git must exist after import"
        );
        assert!(
            !skills_path.join(".git").exists(),
            "root .git must NOT exist"
        );
    }

    #[test]
    fn import_skill_from_file_rejects_when_skill_exists_in_default_plugin() {
        let conn = crate::db::create_test_db_for_tests();
        let dir = tempdir().unwrap();
        let skills_path = dir.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();
        // No ensure_repo at root — per-skill repos only

        // Pre-create a skill in the default plugin
        crate::db::ensure_default_plugin(&conn).unwrap();
        crate::db::upsert_skill(&conn, "existing-skill", "skill-builder", "domain").unwrap();

        let zip_path = dir.path().join("skill.zip");
        write_skill_zip(
            &zip_path,
            "---\nname: existing-skill\ndescription: Duplicate\n---\n# Body\n",
        );

        let err = import_skill_from_file_inner(
            &conn,
            zip_path.to_str().unwrap(),
            "existing-skill",
            "Duplicate",
            None,
            None,
            None,
            skills_path.to_str().unwrap(),
            None,
        )
        .unwrap_err();

        assert!(
            err.contains("already exists"),
            "expected 'already exists' error, got: {}",
            err
        );
    }
}
