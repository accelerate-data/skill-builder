use std::fs;
use std::path::Path;

use sha2::Digest;

use crate::types::ImportedSkill;

/// Merge existing field values into a new `ImportedSkill`: each field on `skill`
/// is left unchanged if already `Some`, otherwise falls back to the `existing` value.
pub(crate) fn merge_imported_fields(skill: &mut ImportedSkill, existing: &ImportedSkill) {
    if skill.purpose.is_none() {
        skill.purpose = existing.purpose.clone();
    }
    if skill.description.is_none() {
        skill.description = existing.description.clone();
    }
    if skill.model.is_none() {
        skill.model = existing.model.clone();
    }
    if skill.argument_hint.is_none() {
        skill.argument_hint = existing.argument_hint.clone();
    }
    if skill.user_invocable.is_none() {
        skill.user_invocable = existing.user_invocable;
    }
    if skill.disable_model_invocation.is_none() {
        skill.disable_model_invocation = existing.disable_model_invocation;
    }
}

/// Wrap a YAML string value in double quotes, escaping backslashes, double
/// quotes, and newlines so that user-supplied values cannot inject extra keys.
#[cfg(test)]
pub(crate) fn yaml_quote(s: &str) -> String {
    crate::commands::imported_skills::frontmatter::yaml_quote_scalar(s)
}

/// Rewrite the SKILL.md frontmatter block in the destination directory with values from `fm`.
pub(crate) fn rewrite_skill_md(
    dest_dir: &Path,
    fm: &super::super::imported_skills::Frontmatter,
) -> Result<(), String> {
    let skill_md_path = dest_dir.join("SKILL.md");
    let existing = fs::read_to_string(&skill_md_path)
        .map_err(|e| format!("Failed to read SKILL.md for rewrite: {}", e))?;
    let existing = existing.replace("\r\n", "\n");

    // Extract body: find the closing --- that ends the frontmatter block.
    // Must be a standalone line (not embedded in content) to avoid truncating
    // body content that contains markdown horizontal rules.
    let body = if existing.trim_start().starts_with("---") {
        let after_open = &existing.trim_start()[3..];
        // Skip past the opening marker's line ending
        let content = after_open.strip_prefix('\n').unwrap_or(after_open);
        // Find the first line that is exactly "---"
        let mut body_start: Option<usize> = None;
        let mut pos = 0;
        for line in content.lines() {
            if line.trim() == "---" {
                body_start = Some(pos + line.len() + 1); // +1 for newline
                break;
            }
            pos += line.len() + 1; // +1 for \n
        }
        match body_start {
            Some(start) if start < content.len() => content[start..].to_string(),
            _ => String::new(),
        }
    } else {
        // No frontmatter — keep original content as body
        existing.clone()
    };

    let yaml = crate::commands::imported_skills::frontmatter::render_frontmatter_yaml(fm);

    let new_content = format!("---\n{}---\n{}", yaml, body);
    fs::write(&skill_md_path, new_content)
        .map_err(|e| format!("Failed to write updated SKILL.md: {}", e))?;

    Ok(())
}

/// Import a single skill directory from the repo tree.
///
/// When `overwrite` is `true`, an existing destination directory is removed before
/// downloading. This is used by marketplace imports so that re-imports (e.g. after
/// `skills_path` changed or files were manually deleted) always succeed.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn import_single_skill(
    client: &reqwest::Client,
    raw_base_url: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    skill_path: &str,
    tree: &[serde_json::Value],
    skills_root: &Path,
    plugin_slug: &str,
    overwrite: bool,
    metadata_override: Option<&crate::types::SkillMetadataOverride>,
) -> Result<ImportedSkill, String> {
    let prefix = if skill_path.is_empty() {
        String::new()
    } else if skill_path.ends_with('/') {
        skill_path.to_string()
    } else {
        format!("{}/", skill_path)
    };

    // Find all blob files under this skill's directory
    let files: Vec<&str> = tree
        .iter()
        .filter_map(|entry| {
            let entry_path = entry["path"].as_str()?;
            let entry_type = entry["type"].as_str()?;
            if entry_type != "blob" {
                return None;
            }
            if prefix.is_empty() {
                // Importing from repo root — only include root-level files
                Some(entry_path)
            } else if entry_path.starts_with(&prefix) {
                Some(entry_path)
            } else {
                None
            }
        })
        .collect();

    if files.is_empty() {
        return Err("No files found in skill directory".to_string());
    }

    // Make sure there is a SKILL.md
    let has_skill_md = files.iter().any(|f| {
        let relative = if prefix.is_empty() {
            f.to_string()
        } else {
            f.strip_prefix(&prefix).unwrap_or(f).to_string()
        };
        relative == "SKILL.md"
    });

    if !has_skill_md {
        return Err("SKILL.md not found in skill directory".to_string());
    }

    // Determine skill name from directory name
    let dir_name = skill_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(skill_path);

    // Download SKILL.md first to get frontmatter
    let skill_md_url = format!(
        "{}/{}/{}/{}/{}",
        raw_base_url,
        owner,
        repo,
        branch,
        if prefix.is_empty() {
            "SKILL.md".to_string()
        } else {
            format!("{}SKILL.md", prefix)
        }
    );

    let skill_md_content = client
        .get(&skill_md_url)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch SKILL.md: {}", e))?
        .text()
        .await
        .map_err(|e| format!("Failed to read SKILL.md content: {}", e))?;

    let mut fm = super::super::imported_skills::parse_frontmatter_full(&skill_md_content);
    let version_was_missing = fm.version.is_none();
    if version_was_missing {
        fm.version = Some(
            super::super::imported_skills::frontmatter::DEFAULT_IMPORTED_SKILL_VERSION.to_string(),
        );
    }
    if fm.author.is_none() {
        fm.author = Some(owner.to_string());
    }

    // purpose is set by the caller at import time (DB-only), not read from frontmatter.
    let override_purpose: Option<String> = metadata_override.and_then(|ov| ov.purpose.clone());

    // Apply metadata overrides if provided (before validation, so user-supplied values satisfy requirements)
    if let Some(ov) = metadata_override {
        fm.name = ov.name.clone().or(fm.name);
        fm.description = ov.description.clone().or(fm.description);
        fm.version = ov.version.clone().or(fm.version);
        fm.argument_hint = ov.argument_hint.clone().or(fm.argument_hint);
        fm.user_invocable = ov.user_invocable.or(fm.user_invocable);
        fm.disable_model_invocation = ov.disable_model_invocation.or(fm.disable_model_invocation);
        log::debug!(
            "[import_single_skill] applied metadata override for '{}': name={:?} purpose={:?}",
            dir_name,
            fm.name,
            override_purpose
        );
    }

    // Skill name MUST come from SKILL.md frontmatter `name:` field — no directory fallback.
    let skill_name = fm.name.clone().ok_or_else(|| {
        format!(
            "SKILL.md at '{}' is missing the 'name' frontmatter field",
            skill_path
        )
    })?;

    if skill_name.is_empty() {
        return Err("Could not determine skill name".to_string());
    }

    super::super::imported_skills::validate_skill_name(&skill_name)?;

    // Validate required frontmatter fields
    let missing_required: Vec<&str> = [("description", fm.description.is_none())]
        .iter()
        .filter(|(_, missing)| *missing)
        .map(|(f, _)| *f)
        .collect();
    if !missing_required.is_empty() {
        log::error!(
            "[import_single_skill] '{}' missing required frontmatter fields: {}",
            skill_name,
            missing_required.join(", ")
        );
        return Err(format!(
            "missing_mandatory_fields:{}",
            missing_required.join(",")
        ));
    }

    // Check if skill directory already exists on disk
    let dest_dir = crate::skill_paths::resolve_skill_dir(skills_root, plugin_slug, &skill_name);
    if dest_dir.exists() {
        if overwrite {
            log::debug!(
                "[import_single_skill] removing existing dir for re-import: {}",
                dest_dir.display()
            );
            fs::remove_dir_all(&dest_dir)
                .map_err(|e| format!("Failed to remove existing skill directory: {}", e))?;
        } else {
            return Err(format!(
                "Skill '{}' already exists at '{}'",
                skill_name,
                dest_dir.display()
            ));
        }
    }

    // Create destination directory and canonicalize for secure containment checks
    fs::create_dir_all(&dest_dir)
        .map_err(|e| format!("Failed to create skill directory: {}", e))?;
    let canonical_dest = dest_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination: {}", e))?;

    // Download all files
    for file_path in &files {
        let relative = if prefix.is_empty() {
            file_path.to_string()
        } else {
            match file_path.strip_prefix(&prefix) {
                Some(rel) => rel.to_string(),
                None => continue,
            }
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = dest_dir.join(&relative);

        // Security: lexical check first
        if !out_path.starts_with(&dest_dir) {
            continue;
        }

        // Create parent directories and verify canonicalized path stays within dest_dir
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for '{}': {}", relative, e))?;
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize parent: {}", e))?;
            if !canonical_parent.starts_with(&canonical_dest) {
                return Err(format!(
                    "Path traversal detected: '{}' escapes destination",
                    relative
                ));
            }
        }

        let raw_url = format!(
            "{}/{}/{}/{}/{}",
            raw_base_url, owner, repo, branch, file_path
        );

        let response = client
            .get(&raw_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download '{}': {}", file_path, e))?;

        let content = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;

        // Reject files larger than 10 MB. Check actual byte count after download
        // rather than Content-Length header, which is absent for chunked responses
        // (the norm for raw.githubusercontent.com).
        if content.len() > 10_000_000 {
            return Err(format!(
                "File '{}' too large: {} bytes (max 10 MB)",
                file_path,
                content.len()
            ));
        }

        fs::write(&out_path, &content)
            .map_err(|e| format!("Failed to write '{}': {}", out_path.display(), e))?;
    }

    // Rewrite SKILL.md if overrides changed frontmatter or if we injected a default version.
    if metadata_override.is_some() || version_was_missing {
        log::info!(
            "[import_single_skill] rewriting SKILL.md frontmatter for '{}'",
            skill_name
        );
        if let Err(e) = rewrite_skill_md(&dest_dir, &fm) {
            log::error!(
                "[import_single_skill] failed to rewrite SKILL.md for '{}': {}",
                skill_name,
                e
            );
            // Clean up the disk directory to avoid leaving orphaned files
            if let Err(cleanup_err) = fs::remove_dir_all(&dest_dir) {
                log::warn!(
                    "[import_single_skill] failed to clean up '{}' after rewrite failure: {}",
                    dest_dir.display(),
                    cleanup_err
                );
            }
            return Err(e);
        }
        log::debug!(
            "[import_single_skill] rewrote SKILL.md frontmatter for '{}'",
            skill_name
        );
    }

    let skill_id = super::super::imported_skills::generate_skill_id(&skill_name);
    let imported_at = chrono::Utc::now().format("%Y-%m-%d %H:%M:%S").to_string();

    Ok(ImportedSkill {
        skill_id,
        skill_name,
        library_key: None,
        is_active: true,
        disk_path: dest_dir.to_string_lossy().to_string(),
        imported_at,
        is_bundled: false,
        // Populated from frontmatter/override for the response, not stored in DB here
        description: fm.description,
        purpose: override_purpose,
        version: fm.version,
        model: fm.model,
        argument_hint: fm.argument_hint,
        user_invocable: fm.user_invocable,
        disable_model_invocation: fm.disable_model_invocation,
        marketplace_source_url: None,
        plugin_slug: Some(plugin_slug.to_string()),
        plugin_display_name: None,
        is_default_plugin: Some(plugin_slug == crate::skill_paths::DEFAULT_PLUGIN_SLUG),
    })
}

/// Compute a SHA256 hex digest of the SKILL.md file in the given disk directory.
/// Returns `Some(hex)` on success, or `None` if the file cannot be read.
pub(crate) fn compute_skill_content_hash(disk_path: &str) -> Option<String> {
    let skill_md = Path::new(disk_path).join("SKILL.md");
    let bytes = fs::read(&skill_md).ok()?;
    let digest = sha2::Sha256::digest(&bytes);
    Some(hex::encode(digest))
}

/// Download an entire plugin directory from GitHub into the local skills_path.
///
/// Downloads all files under `plugin_path` in the repo tree to
/// `{dest_plugin_dir}/` preserving the relative directory structure.
/// This includes `.claude-plugin/plugin.json`, `skills/`, `agents/`, `hooks/`, etc.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn download_plugin_directory(
    client: &reqwest::Client,
    raw_base_url: &str,
    owner: &str,
    repo: &str,
    branch: &str,
    plugin_path: &str,
    tree: &[serde_json::Value],
    dest_plugin_dir: &Path,
) -> Result<usize, String> {
    let prefix = if plugin_path.is_empty() {
        String::new()
    } else if plugin_path.ends_with('/') {
        plugin_path.to_string()
    } else {
        format!("{}/", plugin_path)
    };

    // Find all blob files under this plugin's directory
    let files: Vec<&str> = tree
        .iter()
        .filter_map(|entry| {
            let entry_path = entry["path"].as_str()?;
            let entry_type = entry["type"].as_str()?;
            if entry_type != "blob" {
                return None;
            }
            if !prefix.is_empty() && !entry_path.starts_with(&prefix) {
                return None;
            }
            Some(entry_path)
        })
        .collect();

    if files.is_empty() {
        return Err(format!("No files found under plugin path '{}'", plugin_path));
    }

    log::info!(
        "[download_plugin_directory] downloading {} files from '{}'",
        files.len(),
        plugin_path
    );

    // Remove existing plugin dir if present (clean re-import)
    if dest_plugin_dir.exists() {
        fs::remove_dir_all(dest_plugin_dir)
            .map_err(|e| format!("Failed to remove existing plugin directory: {}", e))?;
    }

    fs::create_dir_all(dest_plugin_dir)
        .map_err(|e| format!("Failed to create plugin directory: {}", e))?;
    let canonical_dest = dest_plugin_dir
        .canonicalize()
        .map_err(|e| format!("Failed to canonicalize destination: {}", e))?;

    let mut downloaded = 0;
    for file_path in &files {
        let relative = if prefix.is_empty() {
            file_path.to_string()
        } else {
            match file_path.strip_prefix(&prefix) {
                Some(rel) => rel.to_string(),
                None => continue,
            }
        };

        if relative.is_empty() {
            continue;
        }

        let out_path = dest_plugin_dir.join(&relative);

        // Security: lexical check
        if !out_path.starts_with(dest_plugin_dir) {
            continue;
        }

        // Create parent directories and verify canonicalized path stays within dest
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory for '{}': {}", relative, e))?;
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| format!("Failed to canonicalize parent: {}", e))?;
            if !canonical_parent.starts_with(&canonical_dest) {
                return Err(format!(
                    "Path traversal detected: '{}' escapes destination",
                    relative
                ));
            }
        }

        let raw_url = format!(
            "{}/{}/{}/{}/{}",
            raw_base_url, owner, repo, branch, file_path
        );

        let response = client
            .get(&raw_url)
            .send()
            .await
            .map_err(|e| format!("Failed to download '{}': {}", file_path, e))?;

        let content = response
            .bytes()
            .await
            .map_err(|e| format!("Failed to read '{}': {}", file_path, e))?;

        // Reject files larger than 10 MB
        if content.len() > 10_000_000 {
            return Err(format!(
                "File '{}' too large: {} bytes (max 10 MB)",
                file_path,
                content.len()
            ));
        }

        fs::write(&out_path, &content)
            .map_err(|e| format!("Failed to write '{}': {}", out_path.display(), e))?;
        downloaded += 1;
    }

    log::info!(
        "[download_plugin_directory] downloaded {} files to '{}'",
        downloaded,
        dest_plugin_dir.display()
    );

    Ok(downloaded)
}

/// Read plugin.json from a downloaded plugin directory.
/// Returns (name, description, version) — all optional except name which falls back to slug.
pub(crate) fn read_plugin_json(plugin_dir: &Path) -> (String, Option<String>, Option<String>) {
    let pj_path = plugin_dir.join(".claude-plugin").join("plugin.json");
    if let Ok(content) = fs::read_to_string(&pj_path) {
        if let Ok(pj) = serde_json::from_str::<serde_json::Value>(&content) {
            let name = pj["name"].as_str().unwrap_or("").to_string();
            let description = pj["description"].as_str().map(|s| s.to_string());
            let version = pj["version"].as_str().map(|s| s.to_string());
            if !name.is_empty() {
                return (name, description, version);
            }
        }
    }
    // Fallback: derive name from directory
    let fallback = plugin_dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    (fallback, None, None)
}

/// Enumerate skills from a downloaded plugin directory on disk.
/// Returns a list of (skill_name, skill_dir) pairs.
pub(crate) fn enumerate_plugin_skills(plugin_dir: &Path) -> Vec<(String, std::path::PathBuf)> {
    let skills_dir = plugin_dir.join("skills");
    if !skills_dir.is_dir() {
        return vec![];
    }
    let mut skills = Vec::new();
    if let Ok(entries) = fs::read_dir(&skills_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with('.') {
                continue;
            }
            // Must have SKILL.md
            if path.join("SKILL.md").is_file() {
                skills.push((name, path));
            }
        }
    }
    skills.sort_by(|a, b| a.0.cmp(&b.0));
    skills
}
