use std::ffi::OsStr;
use std::path::Path;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::Db;
use crate::types::SkillFileContent;

use super::resolve_skills_path;

// ─── get_skill_content_for_refine ────────────────────────────────────────────

/// Returns the content of SKILL.md and all reference files for a skill.
/// Used by the preview panel in the refine chat UI.
#[tauri::command]
pub fn get_skill_content_for_refine(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillFileContent>, String> {
    log::info!("[get_skill_content_for_refine] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let skills_path = resolve_skills_path(&db, &workspace_path).map_err(|e| {
        log::error!(
            "[get_skill_content_for_refine] Failed to resolve skills path: {}",
            e
        );
        e
    })?;
    get_skill_content_inner(&skill_name, &skills_path).map_err(|e| {
        log::error!("[get_skill_content_for_refine] {}", e);
        e
    })
}

pub(crate) fn get_skill_content_inner(
    skill_name: &str,
    skills_path: &str,
) -> Result<Vec<SkillFileContent>, String> {
    let skill_root = Path::new(skills_path).join(skill_name);
    if !skill_root.exists() {
        return Err(format!(
            "Skill '{}' not found at {}",
            skill_name,
            skill_root.display()
        ));
    }

    log::debug!(
        "[get_skill_content_for_refine] reading from {}",
        skill_root.display()
    );
    let mut files = Vec::new();

    // 1. SKILL.md (the main skill file)
    let skill_md = skill_root.join("SKILL.md");
    if skill_md.exists() {
        let content = std::fs::read_to_string(&skill_md)
            .map_err(|e| format!("Failed to read SKILL.md: {}", e))?;
        files.push(SkillFileContent {
            path: "SKILL.md".to_string(),
            content,
        });
    }

    // 2. references/** only. Runtime context artifacts live under the
    // workspace directory and must not pollute authored skill preview.
    let references_dir = skill_root.join("references");
    if references_dir.is_dir() {
        collect_skill_content_files(&references_dir, "references", &mut files)?;
    }

    log::debug!(
        "[get_skill_content_for_refine] returning {} files",
        files.len()
    );
    Ok(files)
}

fn collect_skill_content_files(
    dir: &Path,
    relative_prefix: &str,
    files: &mut Vec<SkillFileContent>,
) -> Result<(), String> {
    let mut entries: Vec<_> = std::fs::read_dir(dir)
        .map_err(|e| format!("Failed to read {} dir: {}", relative_prefix, e))?
        .flatten()
        .collect();
    entries.sort_by_key(|entry| entry.file_name());

    for entry in entries {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let rel = format!("{}/{}", relative_prefix, name);

        if path.is_dir() {
            collect_skill_content_files(&path, &rel, files)?;
            continue;
        }

        let ext = path.extension().and_then(OsStr::to_str);
        if !matches!(ext, Some("md" | "txt")) {
            continue;
        }

        let content =
            std::fs::read_to_string(&path).map_err(|e| format!("Failed to read {}: {}", rel, e))?;
        files.push(SkillFileContent { path: rel, content });
    }

    Ok(())
}
