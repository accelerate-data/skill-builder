use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_PLUGIN_SLUG: &str = "skills";
pub const DEFAULT_PLUGIN_DISPLAY_NAME: &str = "Skills";

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

/// Skill directory: `root/{slug}/skills/{name}`
pub fn nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    root.join(plugin_slug).join("skills").join(skill_name)
}

/// Plugin directory: `root/{slug}`
pub fn plugin_dir(root: &Path, plugin_slug: &str) -> PathBuf {
    root.join(plugin_slug)
}

/// Legacy flat skill directory: `root/{name}` (pre-plugin era)
pub fn legacy_skill_dir(root: &Path, skill_name: &str) -> PathBuf {
    root.join(skill_name)
}

/// Pre-marketplace nested layout: `root/{slug}/{name}` (before plugins/ and skills/ nesting)
pub fn legacy_nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    root.join(plugin_slug).join(skill_name)
}

/// Resolve the skill directory, trying marketplace layout first, then old nested, then legacy flat.
pub fn resolve_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    let marketplace = nested_skill_dir(root, plugin_slug, skill_name);
    if marketplace.exists() {
        return marketplace;
    }
    let old_nested = legacy_nested_skill_dir(root, plugin_slug, skill_name);
    if old_nested.exists() {
        return old_nested;
    }
    legacy_skill_dir(root, skill_name)
}

pub fn ensure_nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> Result<PathBuf, String> {
    let dir = nested_skill_dir(root, plugin_slug, skill_name);
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create plugin directory '{}': {}", parent.display(), e))?;
    }
    Ok(dir)
}

/// Enumerate all skill locations under the root directory.
///
/// Primary scan: `root/{slug}/skills/*/` (plugin layout).
/// Fallback: `root/{name}/` (legacy flat, no skills/ nesting).
/// Deduplicates by (plugin_slug, skill_name).
pub fn enumerate_skill_locations(root: &Path) -> Result<Vec<SkillLocation>, String> {
    if !root.exists() {
        return Ok(vec![]);
    }

    let mut discovered = Vec::new();
    let mut seen = std::collections::HashSet::new();

    // Scan root/{slug}/skills/*/ for plugin layout, root/{name}/ for legacy flat
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

        // Plugin layout: root/{slug}/skills/*/
        let skills_subdir = path.join("skills");
        if skills_subdir.is_dir() {
            let is_default = name == DEFAULT_PLUGIN_SLUG;
            for skill_entry in fs::read_dir(&skills_subdir)
                .map_err(|e| format!("Failed to read '{}': {}", skills_subdir.display(), e))?
            {
                let skill_entry = skill_entry.map_err(|e| format!("Failed to read entry in '{}': {}", skills_subdir.display(), e))?;
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
            }
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

/// Enumerate skills using only the pre-marketplace layout (for migration).
/// Scans `root/{name}/` (legacy flat) and `root/{slug}/{name}/` (old nested).
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
    fn nested_skill_dir_uses_marketplace_layout() {
        let root = Path::new("/skills");
        assert_eq!(
            nested_skill_dir(root, "analytics", "weekly-report"),
            PathBuf::from("/skills/analytics/skills/weekly-report")
        );
    }

    #[test]
    fn plugin_dir_returns_correct_path() {
        let root = Path::new("/skills");
        assert_eq!(
            plugin_dir(root, "analytics"),
            PathBuf::from("/skills/analytics")
        );
    }

    #[test]
    fn enumerate_discovers_marketplace_layout() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = tmp.path().join("analytics").join("skills").join("weekly-report");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# marketplace").unwrap();

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

        // Plugin layout: root/{slug}/skills/{name}/SKILL.md
        let plugin_skill = tmp.path().join("analytics").join("skills").join("weekly-report");
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
    fn enumerate_marketplace_wins_over_legacy() {
        let tmp = tempfile::tempdir().unwrap();

        // Marketplace layout
        let marketplace = tmp.path().join("analytics").join("skills").join("report");
        fs::create_dir_all(&marketplace).unwrap();
        fs::write(marketplace.join("SKILL.md"), "# marketplace").unwrap();

        // Old nested with same slug/name
        let old = tmp.path().join("analytics").join("report");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("SKILL.md"), "# old").unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "report");
        assert_eq!(locations[0].dir, marketplace);
    }

    #[test]
    fn resolve_skill_dir_prefers_marketplace_then_old_nested_then_legacy() {
        let tmp = tempfile::tempdir().unwrap();

        // Only legacy flat exists
        let legacy = tmp.path().join("same-skill");
        fs::create_dir_all(&legacy).unwrap();
        let resolved = resolve_skill_dir(tmp.path(), "analytics", "same-skill");
        assert_eq!(resolved, legacy);

        // Old nested also exists — wins over legacy
        let old_nested = tmp.path().join("analytics").join("same-skill");
        fs::create_dir_all(&old_nested).unwrap();
        let resolved = resolve_skill_dir(tmp.path(), "analytics", "same-skill");
        assert_eq!(resolved, old_nested);

        // Marketplace also exists — wins over all
        let marketplace = tmp.path().join("analytics").join("skills").join("same-skill");
        fs::create_dir_all(&marketplace).unwrap();
        let resolved = resolve_skill_dir(tmp.path(), "analytics", "same-skill");
        assert_eq!(resolved, marketplace);
    }

    #[test]
    fn enumerate_legacy_only_scans_old_layout() {
        let tmp = tempfile::tempdir().unwrap();

        // Marketplace layout — should be ignored by legacy enumeration
        let marketplace = tmp.path().join("analytics").join("skills").join("report");
        fs::create_dir_all(&marketplace).unwrap();
        fs::write(marketplace.join("SKILL.md"), "# marketplace").unwrap();

        // Old nested
        let old = tmp.path().join("analytics").join("report");
        fs::create_dir_all(&old).unwrap();
        fs::write(old.join("SKILL.md"), "# old").unwrap();

        let locations = enumerate_skill_locations_legacy(tmp.path()).unwrap();
        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "report");
        assert_eq!(locations[0].dir, old);
    }
}
