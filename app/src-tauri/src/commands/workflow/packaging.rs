use std::io::{Read, Write};
use std::path::Path;

use crate::db::Db;
use crate::skill_paths::resolve_skill_dir;
use crate::types::PackageResult;

use super::evaluation::read_skills_path;

#[tauri::command]
pub async fn package_skill(
    skill_name: String,
    _workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    log::info!("[package_skill] skill={}", skill_name);
    let plugin_slug = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_master(&conn, &skill_name)?
            .ok_or_else(|| format!("Skill '{}' not found", skill_name))?
            .plugin_slug
    };
    package_plugin_inner(&db, &plugin_slug).await
}

#[tauri::command]
pub async fn package_plugin(
    plugin_slug: String,
    db: tauri::State<'_, Db>,
) -> Result<PackageResult, String> {
    log::info!("[package_plugin] plugin_slug={}", plugin_slug);
    package_plugin_inner(&db, &plugin_slug).await
}

pub(crate) async fn package_plugin_inner(
    db: &tauri::State<'_, Db>,
    plugin_slug: &str,
) -> Result<PackageResult, String> {
    let skills_path = read_skills_path(db)
        .ok_or_else(|| "Skills path not configured. Please set it in Settings.".to_string())?;
    let (plugin, skill_names) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let plugins = crate::db::list_plugins(&conn)?;
        let plugin = plugins
            .into_iter()
            .find(|p| p.slug == plugin_slug)
            .ok_or_else(|| format!("Plugin '{}' not found", plugin_slug))?;
        let skill_names: Vec<(String, String)> = crate::db::list_all_skills(&conn)?
            .into_iter()
            .filter(|skill| skill.plugin_slug == plugin.slug)
            .map(|skill| (skill.plugin_slug, skill.name))
            .collect();
        (plugin, skill_names)
    };

    if skill_names.is_empty() {
        return Err(format!("Plugin '{}' has no skills to package", plugin_slug));
    }

    let output_path = Path::new(&skills_path).join(format!("{}.plugin.zip", plugin.slug));
    let plugin_slug = plugin.slug.clone();
    let plugin_display_name = plugin.display_name.clone();
    tokio::task::spawn_blocking(move || {
        create_plugin_zip(
            Path::new(&skills_path),
            &skill_names,
            &plugin_slug,
            &plugin_display_name,
            &output_path,
        )
    })
    .await
    .map_err(|e| format!("Packaging task failed: {}", e))?
}

pub(crate) fn create_plugin_zip(
    skills_root: &Path,
    skill_names: &[(String, String)],
    _plugin_slug: &str,
    plugin_display_name: &str,
    output_path: &Path,
) -> Result<PackageResult, String> {
    let file = std::fs::File::create(output_path)
        .map_err(|e| format!("Failed to create plugin zip file: {}", e))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    let plugin_json = serde_json::json!({ "name": plugin_display_name });
    zip.start_file(".claude-plugin/plugin.json", options)
        .map_err(|e| format!("Failed to add plugin.json to zip: {}", e))?;
    zip.write_all(plugin_json.to_string().as_bytes())
        .map_err(|e| format!("Failed to write plugin.json: {}", e))?;

    for (skill_plugin_slug, skill_name) in skill_names {
        let source_dir = resolve_skill_dir(skills_root, skill_plugin_slug, skill_name);
        if !source_dir.exists() {
            continue;
        }

        let skill_md = source_dir.join("SKILL.md");
        if skill_md.exists() {
            add_file_to_zip(
                &mut zip,
                &skill_md,
                &format!("skills/{skill_name}/SKILL.md"),
                options,
            )?;
        }

        let references_dir = source_dir.join("references");
        if references_dir.exists() && references_dir.is_dir() {
            add_dir_to_zip(
                &mut zip,
                &references_dir,
                &format!("skills/{skill_name}/references"),
                options,
            )?;
        }
    }

    zip.finish()
        .map_err(|e| format!("Failed to finalize plugin zip: {}", e))?;

    let metadata = std::fs::metadata(output_path)
        .map_err(|e| format!("Failed to read plugin zip metadata: {}", e))?;
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

