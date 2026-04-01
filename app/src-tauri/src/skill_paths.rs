use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const DEFAULT_PLUGIN_SLUG: &str = "skills";
pub const DEFAULT_PLUGIN_DISPLAY_NAME: &str = "Skills";

// --- Centralised path templates (from app/plugin-paths.json) ---

#[derive(Debug, serde::Deserialize)]
pub struct PluginPaths {
    pub default_plugin_slug: String,
    pub skill_dir: String,
    pub workspace_skill_dir: String,
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

pub fn skill_tag_prefix(plugin_slug: &str, skill_name: &str) -> String {
    resolve_template(&paths().tag_prefix, &[("plugin_slug", plugin_slug), ("skill_name", skill_name)])
}

pub fn skill_tag_glob(plugin_slug: &str, skill_name: &str) -> String {
    resolve_template(&paths().tag_glob, &[("plugin_slug", plugin_slug), ("skill_name", skill_name)])
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

/// Workspace scratch directory for a skill (from `plugin-paths.json` → `workspace_skill_dir`).
pub fn workspace_skill_dir(workspace: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    resolve_path_template(
        &paths().workspace_skill_dir,
        &[("workspace", &workspace.to_string_lossy()), ("plugin_slug", plugin_slug), ("skill_name", skill_name)],
    )
}

/// Resolve the workspace scratch directory for a skill.
pub fn resolve_workspace_skill_dir(workspace: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    workspace_skill_dir(workspace, plugin_slug, skill_name)
}

/// Returns the canonical plugin-layout skill directory path
/// (`{root}/{plugin_slug}/{skill_name}`). Does not check existence.
pub fn resolve_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    resolve_path_template(
        &paths().skill_dir,
        &[("root", &root.to_string_lossy()), ("plugin_slug", plugin_slug), ("skill_name", skill_name)],
    )
}

/// Returns the canonical skill directory, creating the parent plugin
/// directory if it doesn't exist. Used when the `{plugin_slug}/` folder
/// may have been deleted and needs to be recreated before writing.
pub fn ensure_nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> Result<PathBuf, String> {
    let dir = resolve_skill_dir(root, plugin_slug, skill_name);
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create plugin directory '{}': {}", parent.display(), e))?;
    }
    Ok(dir)
}

/// Enumerate all skill locations under the root directory.
///
/// Primary scan: `root/{slug}/{name}/` (plugin layout).
/// Fallback: `root/{name}/` (legacy flat).
/// Deduplicates by (plugin_slug, skill_name).
pub fn enumerate_skill_locations(root: &Path) -> Result<Vec<SkillLocation>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut discovered = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Scan root/{slug}/*/ for skills, root/{name}/ for legacy flat
    for entry in fs::read_dir(root).map_err(|e| format!("Failed to read '{}': {}", root.display(), e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry in '{}': {}", root.display(), e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let is_default = name == DEFAULT_PLUGIN_SLUG;

        // Scan root/{slug}/*/ — each child directory that is a skill dir
        let mut found_child_skill = false;
        if let Ok(children) = fs::read_dir(&path) {
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
                if !seen.contains(&key) {
                    seen.insert(key);
                    discovered.push(SkillLocation {
                        plugin_slug: name.clone(),
                        plugin_display_name: if is_default { DEFAULT_PLUGIN_DISPLAY_NAME.to_string() } else { plugin_display_name(&name) },
                        is_default_plugin: is_default,
                        skill_name,
                        dir: skill_path,
                    });
                }
                found_child_skill = true;
            }
        }
        if found_child_skill {
            continue;
        }

        // Legacy flat: root/{name}/ with SKILL.md directly inside
        if is_skill_dir(&path) {
            let key = (DEFAULT_PLUGIN_SLUG.to_string(), name.clone());
            if !seen.contains(&key) {
                seen.insert(key);
                discovered.push(SkillLocation {
                    plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                    plugin_display_name: DEFAULT_PLUGIN_DISPLAY_NAME.to_string(),
                    is_default_plugin: true,
                    skill_name: name,
                    dir: path,
                });
            }
        }
    }

    discovered.sort_by(|a, b| {
        a.plugin_slug
            .cmp(&b.plugin_slug)
            .then_with(|| a.skill_name.cmp(&b.skill_name))
    });
    Ok(discovered)
}

/// Enumerate skills using the flat and nested layouts (for migration).
/// Scans `root/{name}/` (legacy flat) and `root/{slug}/{name}/` (nested).
pub fn enumerate_skill_locations_legacy(root: &Path) -> Result<Vec<SkillLocation>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut discovered = Vec::new();
    for entry in fs::read_dir(root).map_err(|e| format!("Failed to read '{}': {}", root.display(), e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry in '{}': {}", root.display(), e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') || name == "plugins" {
            continue;
        }

        if is_skill_dir(&path) {
            discovered.push(SkillLocation {
                plugin_slug: DEFAULT_PLUGIN_SLUG.to_string(),
                plugin_display_name: DEFAULT_PLUGIN_DISPLAY_NAME.to_string(),
                is_default_plugin: true,
                skill_name: name,
                dir: path,
            });
            continue;
        }

        for child in fs::read_dir(&path)
            .map_err(|e| format!("Failed to read plugin directory '{}': {}", path.display(), e))?
        {
            let child = child.map_err(|e| format!("Failed to read entry in '{}': {}", path.display(), e))?;
            let child_path = child.path();
            if !child_path.is_dir() {
                continue;
            }
            let skill_name = child.file_name().to_string_lossy().to_string();
            if skill_name.starts_with('.') || !is_skill_dir(&child_path) {
                continue;
            }
            discovered.push(SkillLocation {
                plugin_slug: name.clone(),
                plugin_display_name: plugin_display_name(&name),
                is_default_plugin: false,
                skill_name,
                dir: child_path,
            });
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
    path.join("SKILL.md").is_file()
        || path.join("references").is_dir()
        || path.join("context").is_dir()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_skill_dir_uses_slug_name_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        assert_eq!(
            resolve_skill_dir(root, "analytics", "weekly-report"),
            root.join("analytics").join("weekly-report")
        );
    }

    #[test]
    fn enumerate_discovers_plugin_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("analytics").join("weekly-report");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# plugin").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "weekly-report");
        assert_eq!(locations[0].dir, skill_dir);
    }

    #[test]
    fn enumerate_discovers_plugin_layout_and_legacy_flat() {
        let tmp = tempfile::tempdir().unwrap();

        // Legacy flat: root/{name}/SKILL.md
        let legacy = tmp.path().join("legacy-skill");
        fs::create_dir_all(&legacy).unwrap();
        fs::write(legacy.join("SKILL.md"), "# legacy").unwrap();

        // Plugin layout: root/{slug}/{name}/SKILL.md
        let plugin_skill = tmp.path().join("analytics").join("weekly-report");
        fs::create_dir_all(&plugin_skill).unwrap();
        fs::write(plugin_skill.join("SKILL.md"), "# plugin").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 2);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "weekly-report");
        assert_eq!(locations[1].plugin_slug, DEFAULT_PLUGIN_SLUG);
        assert_eq!(locations[1].skill_name, "legacy-skill");
    }

    #[test]
    fn enumerate_legacy_only_scans_flat_and_nested() {
        let tmp = tempfile::tempdir().unwrap();

        // Nested layout
        let nested = tmp.path().join("analytics").join("report");
        fs::create_dir_all(&nested).unwrap();
        fs::write(nested.join("SKILL.md"), "# nested").unwrap();

        let locations = enumerate_skill_locations_legacy(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "report");
        assert_eq!(locations[0].dir, nested);
    }

    #[test]
    fn enumerate_discovers_default_plugin_directly() {
        let tmp = tempfile::tempdir().unwrap();
        // Default plugin: root/skills/my-skill/SKILL.md
        let skill_dir = tmp.path().join(DEFAULT_PLUGIN_SLUG).join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# default plugin skill").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, DEFAULT_PLUGIN_SLUG);
        assert_eq!(locations[0].skill_name, "my-skill");
        assert!(locations[0].is_default_plugin);
        assert_eq!(locations[0].dir, skill_dir);
    }
}
