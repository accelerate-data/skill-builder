use crate::db::Db;
use std::io::Write;
use std::path::Path;

pub(crate) fn export_skill_as_file_inner(skill_dir: &Path, dest_path: &str) -> Result<(), String> {
    if !skill_dir.exists() {
        return Err(format!(
            "Skill directory not found: {}",
            skill_dir.display()
        ));
    }
    if !skill_dir.join("SKILL.md").is_file() {
        return Err("Not a valid skill: SKILL.md missing".to_string());
    }
    let file = std::fs::File::create(dest_path)
        .map_err(|e| format!("Failed to create export file '{}': {}", dest_path, e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    for entry in walkdir::WalkDir::new(skill_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_symlink() || entry.file_type().is_dir() {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(skill_dir)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        if relative.is_empty() {
            continue;
        }
        zip.start_file(&relative, options)
            .map_err(|e| format!("Failed to add '{}' to archive: {}", relative, e))?;
        let content = std::fs::read(path)
            .map_err(|e| format!("Failed to read '{}': {}", path.display(), e))?;
        zip.write_all(&content)
            .map_err(|e| format!("Failed to write '{}' to archive: {}", relative, e))?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize archive: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn export_skill_as_file(
    skill_name: String,
    plugin_slug: String,
    dest_path: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[export_skill_as_file] skill_name={} plugin_slug={} dest={}",
        skill_name,
        plugin_slug,
        dest_path
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[export_skill_as_file] failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    let settings = crate::db::read_settings(&conn).map_err(|e| {
        log::error!("[export_skill_as_file] failed to read settings: {}", e);
        e
    })?;
    let skills_path = settings
        .skills_path
        .ok_or_else(|| "Skills path not configured. Set it in Settings.".to_string())?;
    let skill_dir =
        crate::skill_paths::resolve_skill_dir(Path::new(&skills_path), &plugin_slug, &skill_name);
    let result = export_skill_as_file_inner(&skill_dir, &dest_path);
    if result.is_err() {
        let _ = std::fs::remove_file(&dest_path);
    }
    result.map_err(|e| {
        log::error!("[export_skill_as_file] export failed: {}", e);
        e
    })?;
    log::info!(
        "[export_skill_as_file] exported '{}' to '{}'",
        skill_name,
        dest_path
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::export_skill_as_file_inner;
    use std::fs;
    use tempfile::tempdir;

    fn make_skill_dir(dir: &std::path::Path) {
        fs::write(
            dir.join("SKILL.md"),
            "---\nname: test-skill\ndescription: A test skill\n---\n# Body\n",
        )
        .unwrap();
        fs::create_dir_all(dir.join("references")).unwrap();
        fs::write(dir.join("references").join("ref1.md"), "# Ref 1").unwrap();
    }

    #[test]
    fn export_creates_zip_with_skill_md_at_root() {
        let dir = tempdir().unwrap();
        make_skill_dir(dir.path());
        let dest = dir.path().join("out.skill");

        export_skill_as_file_inner(dir.path(), dest.to_str().unwrap()).unwrap();

        let file = fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(
            names.contains(&"SKILL.md".to_string()),
            "expected SKILL.md at root, got: {:?}",
            names
        );

        let mut content = String::new();
        std::io::Read::read_to_string(&mut archive.by_name("SKILL.md").unwrap(), &mut content)
            .unwrap();
        assert!(content.contains("test-skill"));
    }

    #[test]
    fn export_includes_references_subdir() {
        let dir = tempdir().unwrap();
        make_skill_dir(dir.path());
        let dest = dir.path().join("out.skill");

        export_skill_as_file_inner(dir.path(), dest.to_str().unwrap()).unwrap();

        let file = fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let names: Vec<String> = (0..archive.len())
            .map(|i| archive.by_index(i).unwrap().name().to_string())
            .collect();
        assert!(
            names.contains(&"references/ref1.md".to_string()),
            "expected references/ref1.md, got: {:?}",
            names
        );
    }

    #[test]
    fn export_zip_is_parseable_by_import_flow() {
        let dir = tempdir().unwrap();
        make_skill_dir(dir.path());
        let dest = dir.path().join("out.skill");

        export_skill_as_file_inner(dir.path(), dest.to_str().unwrap()).unwrap();

        let file = fs::File::open(&dest).unwrap();
        let mut archive = zip::ZipArchive::new(file).unwrap();
        let result = crate::commands::imported_skills::helpers::find_skill_md(&mut archive);
        assert!(
            result.is_ok(),
            "import flow could not parse exported zip: {:?}",
            result.err()
        );
        let (path, content) = result.unwrap();
        assert_eq!(path, "SKILL.md");
        assert!(content.contains("test-skill"));
    }

    #[test]
    fn export_fails_when_skill_dir_missing() {
        let dir = tempdir().unwrap();
        let missing = dir.path().join("does-not-exist");
        let dest = dir.path().join("out.skill");
        let err = export_skill_as_file_inner(&missing, dest.to_str().unwrap()).unwrap_err();
        assert!(
            err.contains("not found"),
            "expected 'not found' in: {}",
            err
        );
    }

    #[test]
    fn export_fails_when_no_skill_md() {
        let dir = tempdir().unwrap();
        // dir exists but has no SKILL.md
        let dest = dir.path().join("out.skill");
        let err = export_skill_as_file_inner(dir.path(), dest.to_str().unwrap()).unwrap_err();
        assert!(
            err.contains("SKILL.md missing"),
            "expected 'SKILL.md missing' in: {}",
            err
        );
    }
}
