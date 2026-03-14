use std::io::{Read, Write};
use std::path::Path;

use crate::db::Db;
use crate::types::PackageResult;

use super::evaluation::read_skills_path;

#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    _workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    log::info!("[package_skill] skill={}", skill_name);
    let skills_path = read_skills_path(&db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;

    // skills_path is required — no workspace fallback
    let source_dir = Path::new(&skills_path).join(&skill_name);

    if !source_dir.exists() {
        log::error!(
            "package_skill: skill directory not found: {}",
            source_dir.display()
        );
        return Err(format!(
            "Skill directory not found: {}",
            source_dir.display()
        ));
    }

    let output_path = source_dir.join(format!("{}.skill", skill_name));

    let result = tokio::task::spawn_blocking(move || create_skill_zip(&source_dir, &output_path))
        .await
        .map_err(|e| {
            let msg = format!("Packaging task failed: {}", e);
            log::error!("package_skill: {}", msg);
            msg
        })??;

    Ok(result)
}

pub(crate) fn create_skill_zip(source_dir: &Path, output_path: &Path) -> Result<PackageResult, String> {
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create zip file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // SKILL.md and references/ are directly in source_dir
    let skill_md = source_dir.join("SKILL.md");
    if skill_md.exists() {
        add_file_to_zip(&mut zip, &skill_md, "SKILL.md", options)?;
    }

    let references_dir = source_dir.join("references");
    if references_dir.exists() && references_dir.is_dir() {
        add_dir_to_zip(&mut zip, &references_dir, "references", options)?;
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    let metadata = std::fs::metadata(output_path)
        .map_err(|e| format!("Failed to read zip metadata: {}", e))?;

    Ok(PackageResult {
        file_path: output_path.to_string_lossy().to_string(),
        size_bytes: metadata.len(),
    })
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    file_path: &Path,
    archive_name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let mut f = std::fs::File::open(file_path)
        .map_err(|e| format!("Failed to open {}: {}", file_path.display(), e))?;
    let mut buffer = Vec::new();
    f.read_to_end(&mut buffer)
        .map_err(|e| format!("Failed to read {}: {}", file_path.display(), e))?;
    zip.start_file(archive_name, options)
        .map_err(|e| format!("Failed to add {} to zip: {}", archive_name, e))?;
    zip.write_all(&buffer)
        .map_err(|e| format!("Failed to write {} to zip: {}", archive_name, e))?;
    Ok(())
}

fn add_dir_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    dir: &Path,
    prefix: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    let entries = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read directory {}: {}", dir.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let path = entry.path();
        let name = format!("{}/{}", prefix, entry.file_name().to_string_lossy());

        if path.is_dir() {
            add_dir_to_zip(zip, &path, &name, options)?;
        } else {
            add_file_to_zip(zip, &path, &name, options)?;
        }
    }

    Ok(())
}
