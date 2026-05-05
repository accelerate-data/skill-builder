use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

// ─── JSON types for local marketplace manifests ─────────────────────────────

#[derive(Serialize, Deserialize)]
struct MarketplaceOwner {
    name: String,
}

#[derive(Serialize, Deserialize)]
struct MarketplacePluginEntry {
    name: String,
    source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct LocalMarketplaceJson {
    name: String,
    owner: MarketplaceOwner,
    plugins: Vec<MarketplacePluginEntry>,
}

#[derive(Serialize, Deserialize)]
struct PluginJson {
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    version: Option<String>,
}

// ─── Public API ─────────────────────────────────────────────────────────────

/// Ensure a plugin is listed in marketplace.json. If the plugin slug is not
/// already present, append it. If marketplace.json doesn't exist, create it.
pub fn ensure_plugin_in_marketplace(
    root: &Path,
    slug: &str,
    display_name: &str,
) -> Result<(), String> {
    let mj_path = root.join(".claude-plugin").join("marketplace.json");

    let mut marketplace = if mj_path.is_file() {
        let content = fs::read_to_string(&mj_path)
            .map_err(|e| format!("Failed to read marketplace.json: {}", e))?;
        serde_json::from_str::<LocalMarketplaceJson>(&content).unwrap_or_else(|_| {
            LocalMarketplaceJson {
                name: "skill-builder-local".to_string(),
                owner: MarketplaceOwner {
                    name: "Skill Builder".to_string(),
                },
                plugins: vec![],
            }
        })
    } else {
        LocalMarketplaceJson {
            name: "skill-builder-local".to_string(),
            owner: MarketplaceOwner {
                name: "Skill Builder".to_string(),
            },
            plugins: vec![],
        }
    };

    // Check if already listed
    let already_listed = marketplace.plugins.iter().any(|p| {
        let s = p
            .source
            .strip_prefix("./")
            .unwrap_or(&p.source)
            .trim_end_matches('/');
        s == slug
    });

    if !already_listed {
        // Read plugin.json for metadata
        let pj_path = root.join(slug).join(".claude-plugin").join("plugin.json");
        let (description, version) = if pj_path.is_file() {
            let content = fs::read_to_string(&pj_path).unwrap_or_default();
            match serde_json::from_str::<PluginJson>(&content) {
                Ok(pj) => (pj.description, pj.version),
                Err(_) => (None, None),
            }
        } else {
            (None, None)
        };

        marketplace.plugins.push(MarketplacePluginEntry {
            name: display_name.to_string(),
            source: format!("./{}", slug),
            description,
            version,
        });

        let config_dir = root.join(".claude-plugin");
        fs::create_dir_all(&config_dir)
            .map_err(|e| format!("Failed to create .claude-plugin dir: {}", e))?;
        let json = serde_json::to_string_pretty(&marketplace)
            .map_err(|e| format!("Failed to serialize marketplace.json: {}", e))?;
        fs::write(&mj_path, json)
            .map_err(|e| format!("Failed to write marketplace.json: {}", e))?;
    }

    Ok(())
}

/// Read `{root}/.claude-plugin/marketplace.json` and return a map of
/// plugin slug → display name from each plugin entry's `name` field.
/// The slug is derived from the `source` path (last segment after `./`).
pub fn read_plugin_display_names(root: &Path) -> std::collections::HashMap<String, String> {
    let mj_path = root.join(".claude-plugin").join("marketplace.json");
    let mut names = std::collections::HashMap::new();
    if !mj_path.is_file() {
        return names;
    }
    let content = match fs::read_to_string(&mj_path) {
        Ok(c) => c,
        Err(_) => return names,
    };
    let marketplace: LocalMarketplaceJson = match serde_json::from_str(&content) {
        Ok(m) => m,
        Err(_) => return names,
    };
    for entry in &marketplace.plugins {
        // Derive slug from source path: "./my-plugin" → "my-plugin"
        let slug = entry
            .source
            .strip_prefix("./")
            .unwrap_or(&entry.source)
            .trim_end_matches('/');
        if !slug.is_empty() {
            names.insert(slug.to_string(), entry.name.clone());
        }
    }
    names
}

/// Write or update a single plugin's `.claude-plugin/plugin.json`.
pub fn write_plugin_json(
    root: &Path,
    plugin_slug: &str,
    display_name: &str,
    description: Option<&str>,
    version: Option<&str>,
) -> Result<(), String> {
    let plugin_config_dir = root.join(plugin_slug).join(".claude-plugin");
    fs::create_dir_all(&plugin_config_dir).map_err(|e| {
        format!(
            "Failed to create plugin config dir '{}': {}",
            plugin_config_dir.display(),
            e
        )
    })?;

    let plugin_json_path = plugin_config_dir.join("plugin.json");

    // Preserve existing fields if plugin.json already exists
    let mut pj = if plugin_json_path.is_file() {
        let content = fs::read_to_string(&plugin_json_path)
            .map_err(|e| format!("Failed to read '{}': {}", plugin_json_path.display(), e))?;
        serde_json::from_str::<PluginJson>(&content).unwrap_or(PluginJson {
            name: plugin_slug.to_string(),
            description: None,
            version: None,
        })
    } else {
        PluginJson {
            name: plugin_slug.to_string(),
            description: None,
            version: None,
        }
    };

    // Update fields — caller-supplied values take precedence, but don't overwrite with None
    pj.name = display_name.to_string();
    if let Some(desc) = description {
        pj.description = Some(desc.to_string());
    }
    if let Some(ver) = version {
        pj.version = Some(ver.to_string());
    }

    let json = serde_json::to_string_pretty(&pj)
        .map_err(|e| format!("Failed to serialize plugin.json: {}", e))?;
    fs::write(&plugin_json_path, json)
        .map_err(|e| format!("Failed to write '{}': {}", plugin_json_path.display(), e))?;

    Ok(())
}

/// Scan `root/` for plugin directories and write `.claude-plugin/marketplace.json` at the root.
/// A directory is a plugin if it contains a `skills/` subdirectory or `.claude-plugin/plugin.json`.
pub fn write_marketplace_json(root: &Path) -> Result<(), String> {
    let plugins_dir = root.to_path_buf();
    let mut plugin_entries = Vec::new();

    if plugins_dir.is_dir() {
        let mut dirs: Vec<_> = fs::read_dir(&plugins_dir)
            .map_err(|e| format!("Failed to read plugins dir: {}", e))?
            .filter_map(|e| e.ok())
            .filter(|e| e.path().is_dir())
            .collect();
        dirs.sort_by_key(|e| e.file_name());

        for entry in dirs {
            let slug = entry.file_name().to_string_lossy().to_string();
            if slug.starts_with('.') {
                continue;
            }

            // Only include directories that are actual plugins (have skills/ or .claude-plugin/)
            let dir = entry.path();
            let has_skills = dir.join("skills").is_dir();
            let has_plugin_json = dir.join(".claude-plugin").join("plugin.json").is_file();
            if !has_skills && !has_plugin_json {
                continue;
            }

            // Read existing plugin.json for metadata
            let pj_path = dir.join(".claude-plugin").join("plugin.json");
            let (description, version) = if pj_path.is_file() {
                let content = fs::read_to_string(&pj_path).unwrap_or_default();
                match serde_json::from_str::<PluginJson>(&content) {
                    Ok(pj) => (pj.description, pj.version),
                    Err(_) => (None, None),
                }
            } else {
                (None, None)
            };

            plugin_entries.push(MarketplacePluginEntry {
                name: slug.clone(),
                source: format!("./{}", slug),
                description,
                version,
            });
        }
    }

    let marketplace = LocalMarketplaceJson {
        name: "skill-builder-local".to_string(),
        owner: MarketplaceOwner {
            name: "Skill Builder".to_string(),
        },
        plugins: plugin_entries,
    };

    let config_dir = root.join(".claude-plugin");
    fs::create_dir_all(&config_dir)
        .map_err(|e| format!("Failed to create .claude-plugin dir: {}", e))?;

    let json = serde_json::to_string_pretty(&marketplace)
        .map_err(|e| format!("Failed to serialize marketplace.json: {}", e))?;
    fs::write(config_dir.join("marketplace.json"), json)
        .map_err(|e| format!("Failed to write marketplace.json: {}", e))?;

    Ok(())
}

/// Regenerate all manifests: ensure each plugin under `root/` has a
/// `plugin.json`, then rewrite `marketplace.json`.
pub fn regenerate_all_manifests(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return write_marketplace_json(root);
    }

    for entry in fs::read_dir(root).map_err(|e| format!("Failed to read root dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read plugins entry: {}", e))?;
        let plugin_path = entry.path();
        if !plugin_path.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') {
            continue;
        }

        // Only process directories that are actual plugins
        let has_skills = plugin_path.join("skills").is_dir();
        let has_plugin_json = plugin_path
            .join(".claude-plugin")
            .join("plugin.json")
            .is_file();
        if !has_skills && !has_plugin_json {
            continue;
        }

        let pj_path = plugin_path.join(".claude-plugin").join("plugin.json");
        if !pj_path.is_file() {
            let display = crate::skill_paths::plugin_display_name(&slug);
            write_plugin_json(root, &slug, &display, None, None)?;
        }
    }

    write_marketplace_json(root)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_plugin_json_creates_manifest() {
        let tmp = tempfile::tempdir().unwrap();
        let plugin_dir = tmp.path().join("analytics");
        fs::create_dir_all(plugin_dir.join("skills").join("report")).unwrap();

        write_plugin_json(
            tmp.path(),
            "analytics",
            "Analytics",
            Some("Analytics skills"),
            Some("1.0.0"),
        )
        .unwrap();

        let pj_path = plugin_dir.join(".claude-plugin").join("plugin.json");
        assert!(pj_path.is_file());
        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&pj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "Analytics");
        assert_eq!(content["description"], "Analytics skills");
        assert_eq!(content["version"], "1.0.0");
    }

    #[test]
    fn write_plugin_json_preserves_existing_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("analytics").join(".claude-plugin");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(
            config_dir.join("plugin.json"),
            r#"{"name":"analytics","description":"existing desc","version":"2.0.0"}"#,
        )
        .unwrap();

        // Update name only, don't pass description or version
        write_plugin_json(tmp.path(), "analytics", "Analytics Updated", None, None).unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(config_dir.join("plugin.json")).unwrap())
                .unwrap();
        assert_eq!(content["name"], "Analytics Updated");
        assert_eq!(content["description"], "existing desc");
        assert_eq!(content["version"], "2.0.0");
    }

    #[test]
    fn write_marketplace_json_creates_catalog() {
        let tmp = tempfile::tempdir().unwrap();

        // Create two plugins with plugin.json
        let p1 = tmp.path().join("analytics").join(".claude-plugin");
        fs::create_dir_all(&p1).unwrap();
        fs::write(
            p1.join("plugin.json"),
            r#"{"name":"analytics","description":"Analytics skills","version":"1.0.0"}"#,
        )
        .unwrap();

        let p2 = tmp.path().join("devops").join(".claude-plugin");
        fs::create_dir_all(&p2).unwrap();
        fs::write(
            p2.join("plugin.json"),
            r#"{"name":"devops","description":"DevOps skills"}"#,
        )
        .unwrap();

        write_marketplace_json(tmp.path()).unwrap();

        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        assert!(mj_path.is_file());
        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&mj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "skill-builder-local");
        assert_eq!(content["owner"]["name"], "Skill Builder");

        let plugins = content["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0]["name"], "analytics");
        assert_eq!(plugins[0]["source"], "./analytics");
        assert_eq!(plugins[0]["description"], "Analytics skills");
        assert_eq!(plugins[1]["name"], "devops");
        assert_eq!(plugins[1]["source"], "./devops");
    }

    #[test]
    fn regenerate_all_manifests_fills_missing_plugin_json() {
        let tmp = tempfile::tempdir().unwrap();

        // Plugin with no plugin.json
        let skills_dir = tmp.path().join("my-tool").join("skills").join("hello");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("SKILL.md"), "# hello").unwrap();

        regenerate_all_manifests(tmp.path()).unwrap();

        // plugin.json should now exist
        let pj_path = tmp
            .path()
            .join("my-tool")
            .join(".claude-plugin")
            .join("plugin.json");
        assert!(pj_path.is_file());
        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&pj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "My Tool");

        // marketplace.json should exist
        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        assert!(mj_path.is_file());
    }

    #[test]
    fn write_marketplace_json_handles_empty_root() {
        let tmp = tempfile::tempdir().unwrap();
        // Root exists but has no plugin subdirectories

        write_marketplace_json(tmp.path()).unwrap();

        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&mj_path).unwrap()).unwrap();
        assert_eq!(content["plugins"].as_array().unwrap().len(), 0);
    }

    // ── ensure_plugin_in_marketplace tests ──

    #[test]
    fn ensure_plugin_in_marketplace_creates_file_if_missing() {
        let tmp = tempfile::tempdir().unwrap();
        // No marketplace.json exists yet
        ensure_plugin_in_marketplace(tmp.path(), "analytics", "Analytics").unwrap();

        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        assert!(mj_path.is_file());
        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(&mj_path).unwrap()).unwrap();
        let plugins = content["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["name"], "Analytics");
        assert_eq!(plugins[0]["source"], "./analytics");
    }

    #[test]
    fn ensure_plugin_in_marketplace_appends_if_not_listed() {
        let tmp = tempfile::tempdir().unwrap();
        // Create marketplace.json with one plugin
        let config = tmp.path().join(".claude-plugin");
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("marketplace.json"),
            r#"{
            "name": "test",
            "owner": {"name": "Test"},
            "plugins": [{"name": "existing", "source": "./existing"}]
        }"#,
        )
        .unwrap();

        ensure_plugin_in_marketplace(tmp.path(), "new-plugin", "New Plugin").unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(config.join("marketplace.json")).unwrap())
                .unwrap();
        let plugins = content["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[1]["name"], "New Plugin");
        assert_eq!(plugins[1]["source"], "./new-plugin");
    }

    #[test]
    fn ensure_plugin_in_marketplace_skips_if_already_listed() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join(".claude-plugin");
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("marketplace.json"),
            r#"{
            "name": "test",
            "owner": {"name": "Test"},
            "plugins": [{"name": "My Plugin", "source": "./my-plugin"}]
        }"#,
        )
        .unwrap();

        ensure_plugin_in_marketplace(tmp.path(), "my-plugin", "My Plugin Updated").unwrap();

        let content: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(config.join("marketplace.json")).unwrap())
                .unwrap();
        let plugins = content["plugins"].as_array().unwrap();
        // Should still be 1 — not duplicated
        assert_eq!(plugins.len(), 1);
        // Name should NOT be updated (only append, not modify)
        assert_eq!(plugins[0]["name"], "My Plugin");
    }

    // ── Marketplace.json mutation coverage ──

    #[test]
    fn regenerate_includes_new_plugin_after_create() {
        let tmp = tempfile::tempdir().unwrap();
        // Start with one plugin
        let p1 = tmp.path().join("existing").join("skills").join("s1");
        fs::create_dir_all(&p1).unwrap();
        fs::write(p1.join("SKILL.md"), "# s1").unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        // Create a new plugin
        let p2 = tmp.path().join("new-plugin").join("skills").join("s2");
        fs::create_dir_all(&p2).unwrap();
        fs::write(p2.join("SKILL.md"), "# s2").unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        let mj: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(tmp.path().join(".claude-plugin").join("marketplace.json"))
                .unwrap(),
        )
        .unwrap();
        let names: Vec<&str> = mj["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p["name"].as_str())
            .collect();
        assert!(
            names.contains(&"existing"),
            "existing plugin should be listed"
        );
        assert!(names.contains(&"new-plugin"), "new plugin should be listed");
    }

    #[test]
    fn regenerate_removes_plugin_after_delete() {
        let tmp = tempfile::tempdir().unwrap();
        // Create two plugins
        let p1 = tmp.path().join("keep").join("skills").join("s1");
        fs::create_dir_all(&p1).unwrap();
        fs::write(p1.join("SKILL.md"), "# s1").unwrap();
        let p2 = tmp.path().join("remove-me").join("skills").join("s2");
        fs::create_dir_all(&p2).unwrap();
        fs::write(p2.join("SKILL.md"), "# s2").unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        // Delete one plugin folder
        fs::remove_dir_all(tmp.path().join("remove-me")).unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        let mj: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(tmp.path().join(".claude-plugin").join("marketplace.json"))
                .unwrap(),
        )
        .unwrap();
        let names: Vec<&str> = mj["plugins"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|p| p["name"].as_str())
            .collect();
        assert!(names.contains(&"keep"));
        assert!(
            !names.contains(&"remove-me"),
            "deleted plugin should be gone from marketplace.json"
        );
    }

    #[test]
    fn regenerate_updates_after_skill_added_to_plugin() {
        let tmp = tempfile::tempdir().unwrap();
        // Plugin with one skill
        let s1 = tmp.path().join("my-plugin").join("skills").join("skill-a");
        fs::create_dir_all(&s1).unwrap();
        fs::write(s1.join("SKILL.md"), "# a").unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        // Add a second skill
        let s2 = tmp.path().join("my-plugin").join("skills").join("skill-b");
        fs::create_dir_all(&s2).unwrap();
        fs::write(s2.join("SKILL.md"), "# b").unwrap();
        regenerate_all_manifests(tmp.path()).unwrap();

        // Plugin should still be listed (regenerate doesn't remove it)
        let mj: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(tmp.path().join(".claude-plugin").join("marketplace.json"))
                .unwrap(),
        )
        .unwrap();
        let plugins = mj["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 1);
        assert_eq!(plugins[0]["name"], "my-plugin");
    }

    #[test]
    fn read_display_names_returns_marketplace_names() {
        let tmp = tempfile::tempdir().unwrap();
        let config = tmp.path().join(".claude-plugin");
        fs::create_dir_all(&config).unwrap();
        fs::write(
            config.join("marketplace.json"),
            r#"{
            "name": "test",
            "owner": {"name": "Test"},
            "plugins": [
                {"name": "My Analytics", "source": "./analytics"},
                {"name": "DevOps Tools", "source": "./devops"}
            ]
        }"#,
        )
        .unwrap();

        let names = read_plugin_display_names(tmp.path());
        assert_eq!(names.get("analytics").unwrap(), "My Analytics");
        assert_eq!(names.get("devops").unwrap(), "DevOps Tools");
        assert_eq!(names.len(), 2);
    }

    #[test]
    fn default_plugin_layout_no_double_nesting() {
        // Default plugin skills use the same canonical plugin layout as every
        // other plugin: root/default/skills/{name}/.
        let tmp = tempfile::tempdir().unwrap();
        let skill_dir = crate::skill_paths::resolve_skill_dir(
            tmp.path(),
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            "my-skill",
        );
        assert_eq!(
            skill_dir,
            tmp.path()
                .join(crate::skill_paths::DEFAULT_PLUGIN_SLUG)
                .join("skills")
                .join("my-skill"),
            "default plugin should resolve through the canonical skills/ subdir"
        );
        // Non-default plugins use the same canonical {slug}/skills/{name}/ layout.
        let other_dir = crate::skill_paths::resolve_skill_dir(tmp.path(), "analytics", "report");
        assert_eq!(
            other_dir,
            tmp.path().join("analytics").join("skills").join("report")
        );
    }
}
