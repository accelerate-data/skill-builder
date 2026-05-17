use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const DEFAULT_PLUGIN_SLUG: &str = "default";
pub const DEFAULT_PLUGIN_DISPLAY_NAME: &str = "Default";

// --- Centralised path templates (from app/plugin-paths.json) ---

#[derive(Debug, serde::Deserialize)]
pub struct PluginPaths {
    #[allow(dead_code)]
    pub default_plugin_slug: String,
    pub skill_dir: String,
    pub eval_dir: String,
    pub tag_prefix: String,
    pub tag_glob: String,
}

static PLUGIN_PATHS: OnceLock<PluginPaths> = OnceLock::new();

pub fn paths() -> &'static PluginPaths {
    PLUGIN_PATHS.get_or_init(|| {
        let json = include_str!("../../plugin-paths.json");
        serde_json::from_str(json).expect("plugin-paths.json is invalid")
    })
}

/// Replace `{key}` placeholders in a template string.
pub fn resolve_template(template: &str, vars: &[(&str, &str)]) -> String {
    let mut result = template.to_string();
    for (key, value) in vars {
        result = result.replace(&format!("{{{}}}", key), value);
    }
    result
}

/// Resolve a path template, returning a proper OS-native PathBuf.
/// The root variable (first path segment) may already contain OS separators,
/// so we only join the template segments that follow the root.
fn resolve_path_template(template: &str, vars: &[(&str, &str)]) -> PathBuf {
    // Find the first variable in the template — it's the root/base path.
    // Extract just the non-root segments from the template and join them onto the root.
    let resolved = resolve_template(template, vars);
    // The root variable value may contain native separators; the rest uses `/` from the template.
    // Strategy: find the root value, use it as PathBuf, then join remaining segments.
    if let Some((root_key, root_val)) = vars.first() {
        let placeholder = format!("{{{}}}", root_key);
        if let Some(rest) = template.strip_prefix(&placeholder) {
            // rest is like "/{plugin_slug}/{skill_name}"
            let rest_resolved = resolve_template(rest, vars);
            let mut path = PathBuf::from(*root_val);
            for segment in rest_resolved.split('/') {
                if !segment.is_empty() {
                    path.push(segment);
                }
            }
            return path;
        }
    }
    // Fallback: just use the resolved string as-is
    PathBuf::from(resolved)
}

/// Returns the tag prefix (e.g. "v"). Parameters are preserved for backward
/// compatibility with callers that still pass plugin/skill context.
pub fn skill_tag_prefix(_plugin_slug: &str, _skill_name: &str) -> String {
    paths().tag_prefix.clone()
}

/// Returns the tag glob (e.g. "v*"). Parameters are preserved for backward
/// compatibility with callers that still pass plugin/skill context.
pub fn skill_tag_glob(_plugin_slug: &str, _skill_name: &str) -> String {
    paths().tag_glob.clone()
}

// --- Skill location types ---

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillLocation {
    pub plugin_slug: String,
    pub plugin_display_name: String,
    pub is_default_plugin: bool,
    pub skill_name: String,
    pub dir: PathBuf,
}

pub fn skill_library_key(plugin_slug: &str, skill_name: &str) -> String {
    format!("skill-builder:{plugin_slug}:{skill_name}")
}

/// Resolve the system temp directory used for throwaway runtime work.
///
/// Resolution order:
/// - `TMPDIR`
/// - `TMP`
/// - `TEMP`
/// - `std::env::temp_dir()`
pub fn system_temp_root() -> PathBuf {
    for key in ["TMPDIR", "TMP", "TEMP"] {
        if let Some(value) = std::env::var_os(key).filter(|value| !value.is_empty()) {
            return PathBuf::from(value);
        }
    }
    std::env::temp_dir()
}

/// Canonical throwaway runtime root for a product surface run.
///
/// Shape:
/// `{system_tmp}/skill-builder/throwaway/{surface}/{run_id}/`
pub fn throwaway_runtime_dir(surface: &str, run_id: &str) -> PathBuf {
    system_temp_root()
        .join("skill-builder")
        .join("throwaway")
        .join(surface)
        .join(run_id)
}

/// Conversation storage for a throwaway runtime run.
pub fn throwaway_conversations_dir(run_dir: &Path) -> PathBuf {
    run_dir.join("conversations")
}

/// Optional logs directory for a throwaway runtime run.
pub fn throwaway_logs_dir(run_dir: &Path) -> PathBuf {
    run_dir.join("logs")
}

/// Returns the canonical plugin-layout skill directory path
/// (`{skills_root}/{plugin_slug}/skills/{skill_name}`). Does not check existence.
pub fn resolve_skill_dir(skills_root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    resolve_path_template(
        &paths().skill_dir,
        &[
            ("skills_root", &skills_root.to_string_lossy()),
            ("plugin_slug", plugin_slug),
            ("skill_name", skill_name),
        ],
    )
}

pub fn resolve_eval_dir(skills_root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    resolve_path_template(
        &paths().eval_dir,
        &[
            ("skills_root", &skills_root.to_string_lossy()),
            ("plugin_slug", plugin_slug),
            ("skill_name", skill_name),
        ],
    )
}

pub fn resolve_existing_skill_dir(
    skills_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> PathBuf {
    resolve_skill_dir(skills_root, plugin_slug, skill_name)
}

/// Check that a skill has published content (SKILL.md or references/ directory).
/// Returns `Ok(())` if content exists, or a clear error message if missing.
pub fn validate_skill_content_exists(
    skills_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<(), String> {
    let skill_dir = resolve_existing_skill_dir(skills_root, plugin_slug, skill_name);
    if !skill_dir.join("SKILL.md").exists() && !skill_dir.join("references").is_dir() {
        return Err(format!(
            "Skill '{}' has no published content. The skill may have been moved or deleted. Run the skill workflow to regenerate it.",
            skill_name
        ));
    }
    Ok(())
}

/// Returns the canonical skill directory path, creating parent directories
/// (`{skills_root}/{plugin_slug}/skills/`) if they don't exist.
///
/// **Note:** This does NOT create the skill directory itself — only its parents.
/// Callers must create the final skill directory separately if needed.
pub fn ensure_nested_skill_dir(
    skills_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<PathBuf, String> {
    let dir = resolve_skill_dir(skills_root, plugin_slug, skill_name);
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent).map_err(|e| {
            format!(
                "Failed to create plugin directory '{}': {}",
                parent.display(),
                e
            )
        })?;
    }
    Ok(dir)
}

/// Enumerate all skill locations under the skills root directory using the
/// canonical plugin layout: `skills_root/{slug}/skills/{name}/`.
pub fn enumerate_skill_locations(skills_root: &Path) -> Result<Vec<SkillLocation>, String> {
    if !skills_root.exists() {
        return Ok(vec![]);
    }

    let mut discovered = Vec::new();
    let mut seen = std::collections::HashSet::new();

    for entry in fs::read_dir(skills_root)
        .map_err(|e| format!("Failed to read '{}': {}", skills_root.display(), e))?
    {
        let entry = entry
            .map_err(|e| format!("Failed to read entry in '{}': {}", skills_root.display(), e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let is_default = name == DEFAULT_PLUGIN_SLUG;
        let plugin_display_name = if is_default {
            DEFAULT_PLUGIN_DISPLAY_NAME.to_string()
        } else {
            plugin_display_name(&name)
        };

        let skills_subdir = path.join("skills");
        let mut found_canonical_skill = false;
        if skills_subdir.is_dir() {
            if let Ok(children) = fs::read_dir(&skills_subdir) {
                for skill_entry in children.flatten() {
                    let skill_path = skill_entry.path();
                    if !skill_path.is_dir() {
                        continue;
                    }
                    let skill_name = skill_entry.file_name().to_string_lossy().to_string();
                    if skill_name.starts_with('.') || !is_skill_dir(&skill_path) {
                        continue;
                    }
                    let key = (name.clone(), skill_name.clone());
                    if seen.insert(key) {
                        discovered.push(SkillLocation {
                            plugin_slug: name.clone(),
                            plugin_display_name: plugin_display_name.clone(),
                            is_default_plugin: is_default,
                            skill_name,
                            dir: skill_path,
                        });
                    }
                    found_canonical_skill = true;
                }
            }
        }

        if found_canonical_skill {
            continue;
        }
    }

    discovered.sort_by(|a, b| {
        a.plugin_slug
            .cmp(&b.plugin_slug)
            .then_with(|| a.skill_name.cmp(&b.skill_name))
    });
    Ok(discovered)
}

pub fn plugin_display_name(slug: &str) -> String {
    if slug == DEFAULT_PLUGIN_SLUG {
        return DEFAULT_PLUGIN_DISPLAY_NAME.to_string();
    }
    slug.split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn is_skill_dir(path: &Path) -> bool {
    path.join("SKILL.md").is_file() || path.join("references").is_dir()
}

// ─── Skill content reading ───────────────────────────────────────────────────

/// Read SKILL.md and all references/ files from a skill directory.
pub fn read_skill_content(
    skill_root: &Path,
) -> Result<Vec<crate::types::SkillFileContent>, String> {
    if !skill_root.exists() {
        return Err(format!(
            "Skill directory not found at {}",
            skill_root.display()
        ));
    }

    let mut files = Vec::new();

    let skill_md = skill_root.join("SKILL.md");
    if skill_md.exists() {
        let content = std::fs::read_to_string(&skill_md)
            .map_err(|e| format!("Failed to read SKILL.md: {}", e))?;
        files.push(crate::types::SkillFileContent {
            path: "SKILL.md".to_string(),
            content,
        });
    }

    let references_dir = skill_root.join("references");
    if references_dir.is_dir() {
        collect_skill_content_files(&references_dir, "references", &mut files)?;
    }

    Ok(files)
}

/// Read skill content by name and plugin slug from a skills root.
pub fn read_skill_content_by_name(
    skills_root: &Path,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<Vec<crate::types::SkillFileContent>, String> {
    let skill_root = resolve_skill_dir(skills_root, plugin_slug, skill_name);
    read_skill_content(&skill_root)
}

fn collect_skill_content_files(
    dir: &Path,
    relative_prefix: &str,
    files: &mut Vec<crate::types::SkillFileContent>,
) -> Result<(), String> {
    use std::ffi::OsStr;

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
        files.push(crate::types::SkillFileContent { path: rel, content });
    }

    Ok(())
}

#[cfg(test)]
mod tag_format_tests {
    use super::*;

    #[test]
    fn skill_tag_prefix_is_plain_v() {
        assert_eq!(skill_tag_prefix("my-plugin", "my-skill"), "v");
    }

    #[test]
    fn skill_tag_glob_is_plain_v_star() {
        assert_eq!(skill_tag_glob("any-plugin", "any-skill"), "v*");
    }

    #[test]
    fn test_skill_version_tag_name_returns_v_prefixed() {
        let name = crate::git::skill_version_tag_name("my-plugin", "my-skill", "1.0.0");
        assert_eq!(name, "v1.0.0");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_plugin_slug_is_default() {
        assert_eq!(DEFAULT_PLUGIN_SLUG, "default");
        assert_eq!(DEFAULT_PLUGIN_DISPLAY_NAME, "Default");
    }

    #[test]
    fn resolve_skill_dir_includes_skills_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_root = tmp.path();
        assert_eq!(
            resolve_skill_dir(skills_root, "analytics", "weekly-report"),
            skills_root
                .join("analytics")
                .join("skills")
                .join("weekly-report")
        );
    }

    #[test]
    fn resolve_eval_dir_includes_evals_subdir() {
        let tmp = tempfile::tempdir().unwrap();
        let skills_root = tmp.path();

        assert_eq!(
            resolve_eval_dir(skills_root, "analytics", "weekly-report"),
            skills_root
                .join("analytics")
                .join("evals")
                .join("weekly-report")
        );
    }

    #[test]
    fn throwaway_runtime_dirs_resolve_under_system_temp_root() {
        let runtime_dir = throwaway_runtime_dir("scope_review", "run-123");

        assert_eq!(
            runtime_dir,
            system_temp_root()
                .join("skill-builder")
                .join("throwaway")
                .join("scope_review")
                .join("run-123")
        );
        assert_eq!(
            throwaway_conversations_dir(&runtime_dir),
            runtime_dir.join("conversations")
        );
        assert_eq!(throwaway_logs_dir(&runtime_dir), runtime_dir.join("logs"));
    }

    #[test]
    fn enumerate_discovers_new_canonical_plugin_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp
            .path()
            .join("analytics")
            .join("skills")
            .join("weekly-report");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# plugin").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "weekly-report");
        assert_eq!(locations[0].dir, skill_dir);
    }

    #[test]
    fn enumerate_ignores_legacy_flat_and_nested_layouts() {
        let tmp = tempfile::tempdir().unwrap();

        // Legacy flat: root/{name}/SKILL.md
        let legacy = tmp.path().join("legacy-skill");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("SKILL.md"), "# legacy").unwrap();

        // New canonical plugin layout: root/{slug}/skills/{name}/SKILL.md
        let plugin_skill = tmp
            .path()
            .join("analytics")
            .join("skills")
            .join("weekly-report");
        fs::create_dir_all(&plugin_skill).unwrap();
        fs::write(plugin_skill.join("SKILL.md"), "# plugin").unwrap();

        // Old plugin layout: root/{slug}/{name}/SKILL.md
        let old_plugin_skill = tmp.path().join("reports").join("weekly-summary");
        fs::create_dir_all(&old_plugin_skill).unwrap();
        fs::write(old_plugin_skill.join("SKILL.md"), "# old plugin").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "weekly-report");
        assert_eq!(locations[0].dir, plugin_skill);
    }

    #[test]
    fn enumerate_discovers_default_plugin_directly() {
        let tmp = tempfile::tempdir().unwrap();
        // Default plugin: root/default/skills/my-skill/SKILL.md
        let skill_dir = tmp
            .path()
            .join(DEFAULT_PLUGIN_SLUG)
            .join("skills")
            .join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# default plugin skill").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, DEFAULT_PLUGIN_SLUG);
        assert_eq!(locations[0].skill_name, "my-skill");
        assert!(locations[0].is_default_plugin);
        assert_eq!(locations[0].dir, skill_dir);
    }

    #[test]
    fn context_only_directory_is_not_treated_as_skill() {
        let tmp = tempfile::tempdir().unwrap();
        let context_only = tmp.path().join("orphan-folder");
        fs::create_dir_all(context_only.join("context")).unwrap();
        fs::write(context_only.join("context").join("notes.md"), "# Notes").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert!(locations.is_empty());
    }

    #[test]
    fn resolves_eval_dir_from_plugin_layout() {
        let skills_root = Path::new("/users/alice/my-plugins");
        let dir = resolve_eval_dir(skills_root, "superpowers", "analyzing-bookings");
        assert_eq!(
            dir,
            Path::new("/users/alice/my-plugins/superpowers/evals/analyzing-bookings")
        );
    }
}
