use crate::db::Db;
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
        model: fm.model,
        argument_hint: fm.argument_hint,
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
    model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    force_overwrite: bool,
    db: tauri::State<'_, Db>,
) -> Result<String, String> {
    log::info!(
        "[import_skill_from_file] name={} force_overwrite={}",
        name,
        force_overwrite
    );

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
    let workspace_path = settings.workspace_path.unwrap_or_default();
    import_skill_from_file_inner(
        &conn,
        &file_path,
        &name,
        &description,
        if version.is_empty() {
            None
        } else {
            Some(version.as_str())
        },
        model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
        force_overwrite,
        &skills_path,
        &workspace_path,
    )
}

#[allow(clippy::too_many_arguments)]
fn import_skill_from_file_inner(
    conn: &rusqlite::Connection,
    file_path: &str,
    name: &str,
    description: &str,
    version: Option<&str>,
    model: Option<String>,
    argument_hint: Option<String>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
    force_overwrite: bool,
    skills_path: &str,
    workspace_path: &str,
) -> Result<String, String> {
    validate_skill_name(name)?;

    // Re-validate zip (prevent TOCTOU between parse and import)
    let zip_file =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to open file: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(zip_file).map_err(|_| "not a valid skill package".to_string())?;
    let (skill_md_path, _) = find_skill_md(&mut archive)?;
    let prefix = get_archive_prefix(&skill_md_path);

    // Conflict check
    let existing_source: Option<String> = conn
        .query_row(
            "SELECT skill_source FROM skills WHERE name = ?1",
            rusqlite::params![&name],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    match existing_source.as_deref() {
        Some("skill-builder") | Some("marketplace") => {
            return Err(format!("conflict_no_overwrite:{}", name));
        }
        Some("imported") if !force_overwrite => {
            return Err(format!("conflict_overwrite_required:{}", name));
        }
        Some("imported") => {
            // force_overwrite=true — clean up existing
            let dest = Path::new(skills_path).join(name);
            if dest.exists() {
                std::fs::remove_dir_all(&dest).map_err(|e| {
                    log::error!("[import_skill_from_file] failed to remove dir: {}", e);
                    e.to_string()
                })?;
            }
            crate::db::delete_imported_skill_by_name(conn, name)?;
            crate::db::delete_skill(conn, name)?;
        }
        _ => {} // Not found — proceed normally
    }

    // Extract all files to {skills_path}/{name}/
    let dest_dir = Path::new(skills_path).join(name);
    std::fs::create_dir_all(&dest_dir).map_err(|e| e.to_string())?;
    // Re-open archive (consumed during prefix scan)
    let zip_file2 =
        std::fs::File::open(file_path).map_err(|e| format!("Failed to re-open file: {}", e))?;
    let mut archive2 =
        zip::ZipArchive::new(zip_file2).map_err(|_| "not a valid skill package".to_string())?;
    extract_archive(&mut archive2, &prefix, &dest_dir)?;

    let skills_repo = Path::new(skills_path);
    let final_version = match super::frontmatter::ensure_skill_frontmatter_version(
        &dest_dir.join("SKILL.md"),
        version,
    ) {
        Ok(final_version) => final_version,
        Err(e) => {
            let _ = std::fs::remove_dir_all(&dest_dir);
            return Err(e);
        }
    };

    let import_git_result = (|| -> Result<(), String> {
        if crate::git::skill_version_tag_exists(skills_repo, name, &final_version)? {
            return Err(format!(
                "Tag '{}' already exists",
                crate::git::skill_version_tag_name(name, &final_version)
            ));
        }

        crate::git::commit_all(skills_repo, &format!("{}: import from upload", name))?;
        crate::git::create_skill_version_tag(skills_repo, name, &final_version)?;
        Ok(())
    })();
    if let Err(e) = import_git_result {
        let _ = std::fs::remove_dir_all(&dest_dir);
        return Err(e);
    }

    // Write to skills master table
    crate::db::upsert_skill_with_source(conn, name, "imported", "domain")?;

    // Update description (not mirrored by upsert_imported_skill)
    conn.execute(
        "UPDATE skills SET description = ?2 WHERE name = ?1",
        rusqlite::params![name, description],
    )
    .map_err(|e| e.to_string())?;

    // Build ImportedSkill and upsert to imported_skills + mirror frontmatter to skills master
    let skill_id = generate_skill_id(name);
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();
    let skill = crate::types::ImportedSkill {
        skill_id,
        skill_name: name.to_string(),
        plugin_name: None,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        description: Some(description.to_string()),
        purpose: Some("domain".to_string()),
        version: Some(final_version),
        model,
        argument_hint,
        user_invocable,
        disable_model_invocation,
        marketplace_source_url: None,
    };
    crate::db::upsert_imported_skill(conn, &skill)?;

    // Regenerate CLAUDE.md
    if !workspace_path.is_empty() {
        if let Err(e) = crate::commands::workflow::update_skills_section(workspace_path, conn) {
            log::warn!(
                "[import_skill_from_file] update_skills_section failed: {}",
                e
            );
        }
    }

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
        crate::git::ensure_repo(&skills_path).unwrap();

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
            None,
            None,
            false,
            skills_path.to_str().unwrap(),
            "",
        );

        assert!(result.is_ok(), "expected import to succeed: {:?}", result);
        assert!(
            crate::git::skill_version_tag_exists(&skills_path, "imported-skill", "1.0.0").unwrap()
        );
        assert_eq!(
            crate::db::get_imported_skill(&conn, "imported-skill")
                .unwrap()
                .unwrap()
                .version
                .as_deref(),
            Some("1.0.0")
        );
        assert!(
            std::fs::read_to_string(skills_path.join("imported-skill").join("SKILL.md"))
                .unwrap()
                .contains("version: 1.0.0")
        );
    }

    #[test]
    fn import_skill_from_file_rejects_existing_version_tag() {
        let conn = crate::db::create_test_db_for_tests();
        let dir = tempdir().unwrap();
        let skills_path = dir.path().join("skills");
        std::fs::create_dir_all(&skills_path).unwrap();
        crate::git::ensure_repo(&skills_path).unwrap();

        let skill_dir = skills_path.join("imported-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            "---\nname: imported-skill\ndescription: Existing\nversion: 1.0.0\n---\n# Body\n",
        )
        .unwrap();
        crate::git::commit_all(&skills_path, "imported-skill: seed").unwrap();
        crate::git::create_skill_version_tag(&skills_path, "imported-skill", "1.0.0").unwrap();
        std::fs::remove_dir_all(&skill_dir).unwrap();

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
            None,
            None,
            false,
            skills_path.to_str().unwrap(),
            "",
        )
        .unwrap_err();

        assert!(err.contains("already exists"));
        assert!(crate::db::get_imported_skill(&conn, "imported-skill")
            .unwrap()
            .is_none());
    }
}
