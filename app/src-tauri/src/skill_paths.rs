use std::fs;
use std::path::{Path, PathBuf};

pub const DEFAULT_PLUGIN_SLUG: &str = "no-plugin";
pub const DEFAULT_PLUGIN_DISPLAY_NAME: &str = "No Plugin";

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

pub fn nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    root.join(plugin_slug).join(skill_name)
}

pub fn legacy_skill_dir(root: &Path, skill_name: &str) -> PathBuf {
    root.join(skill_name)
}

pub fn resolve_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> PathBuf {
    let nested = nested_skill_dir(root, plugin_slug, skill_name);
    if nested.exists() {
        nested
    } else {
        legacy_skill_dir(root, skill_name)
    }
}

pub fn ensure_nested_skill_dir(root: &Path, plugin_slug: &str, skill_name: &str) -> Result<PathBuf, String> {
    let dir = nested_skill_dir(root, plugin_slug, skill_name);
    if let Some(parent) = dir.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create plugin directory '{}': {}", parent.display(), e))?;
    }
    Ok(dir)
}

pub fn enumerate_skill_locations(root: &Path) -> Result<Vec<SkillLocation>, String> {
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
        if name.starts_with('.') {
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
    fn enumerate_supports_legacy_and_nested_layouts() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("legacy-skill")).unwrap();
        fs::write(tmp.path().join("legacy-skill").join("SKILL.md"), "# legacy").unwrap();

        fs::create_dir_all(tmp.path().join("analytics").join("weekly-report")).unwrap();
        fs::write(
            tmp.path().join("analytics").join("weekly-report").join("SKILL.md"),
            "# nested",
        )
        .unwrap();

        let locations = enumerate_skill_locations(tmp.path()).unwrap();
        assert_eq!(locations.len(), 2);
        assert_eq!(locations[0].plugin_slug, "analytics");
        assert_eq!(locations[0].skill_name, "weekly-report");
        assert_eq!(locations[1].plugin_slug, DEFAULT_PLUGIN_SLUG);
        assert_eq!(locations[1].skill_name, "legacy-skill");
    }

    #[test]
    fn resolve_skill_dir_prefers_nested_then_legacy() {
        let tmp = tempfile::tempdir().unwrap();
        let legacy = tmp.path().join("same-skill");
        fs::create_dir_all(&legacy).unwrap();
        let resolved = resolve_skill_dir(tmp.path(), "analytics", "same-skill");
        assert_eq!(resolved, legacy);

        let nested = tmp.path().join("analytics").join("same-skill");
        fs::create_dir_all(&nested).unwrap();
        let resolved = resolve_skill_dir(tmp.path(), "analytics", "same-skill");
        assert_eq!(resolved, nested);
    }
}
