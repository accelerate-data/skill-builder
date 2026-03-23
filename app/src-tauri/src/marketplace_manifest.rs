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

/// Write or update a single plugin's `.claude-plugin/plugin.json`.
pub fn write_plugin_json(
    root: &Path,
    plugin_slug: &str,
    display_name: &str,
    description: Option<&str>,
    version: Option<&str>,
) -> Result<(), String> {
    let plugin_config_dir = root.join("plugins").join(plugin_slug).join(".claude-plugin");
    fs::create_dir_all(&plugin_config_dir)
        .map_err(|e| format!("Failed to create plugin config dir '{}': {}", plugin_config_dir.display(), e))?;

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

/// Scan `root/plugins/` and write `.claude-plugin/marketplace.json` at the root.
pub fn write_marketplace_json(root: &Path) -> Result<(), String> {
    let plugins_dir = root.join("plugins");
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

            // Read existing plugin.json for metadata
            let pj_path = entry.path().join(".claude-plugin").join("plugin.json");
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
                source: format!("./plugins/{}", slug),
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

/// Regenerate all manifests: ensure each plugin under `root/plugins/` has a
/// `plugin.json`, then rewrite `marketplace.json`.
pub fn regenerate_all_manifests(root: &Path) -> Result<(), String> {
    let plugins_dir = root.join("plugins");
    if !plugins_dir.is_dir() {
        // No plugins directory — just write an empty marketplace.json
        return write_marketplace_json(root);
    }

    for entry in fs::read_dir(&plugins_dir)
        .map_err(|e| format!("Failed to read plugins dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read plugins entry: {}", e))?;
        let plugin_path = entry.path();
        if !plugin_path.is_dir() {
            continue;
        }
        let slug = entry.file_name().to_string_lossy().to_string();
        if slug.starts_with('.') {
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
        let plugin_dir = tmp.path().join("plugins").join("analytics");
        fs::create_dir_all(plugin_dir.join("skills").join("report")).unwrap();

        write_plugin_json(tmp.path(), "analytics", "Analytics", Some("Analytics skills"), Some("1.0.0")).unwrap();

        let pj_path = plugin_dir.join(".claude-plugin").join("plugin.json");
        assert!(pj_path.is_file());
        let content: serde_json::Value = serde_json::from_str(&fs::read_to_string(&pj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "Analytics");
        assert_eq!(content["description"], "Analytics skills");
        assert_eq!(content["version"], "1.0.0");
    }

    #[test]
    fn write_plugin_json_preserves_existing_fields() {
        let tmp = tempfile::tempdir().unwrap();
        let config_dir = tmp.path().join("plugins").join("analytics").join(".claude-plugin");
        fs::create_dir_all(&config_dir).unwrap();
        fs::write(config_dir.join("plugin.json"), r#"{"name":"analytics","description":"existing desc","version":"2.0.0"}"#).unwrap();

        // Update name only, don't pass description or version
        write_plugin_json(tmp.path(), "analytics", "Analytics Updated", None, None).unwrap();

        let content: serde_json::Value = serde_json::from_str(&fs::read_to_string(config_dir.join("plugin.json")).unwrap()).unwrap();
        assert_eq!(content["name"], "Analytics Updated");
        assert_eq!(content["description"], "existing desc");
        assert_eq!(content["version"], "2.0.0");
    }

    #[test]
    fn write_marketplace_json_creates_catalog() {
        let tmp = tempfile::tempdir().unwrap();

        // Create two plugins with plugin.json
        let p1 = tmp.path().join("plugins").join("analytics").join(".claude-plugin");
        fs::create_dir_all(&p1).unwrap();
        fs::write(p1.join("plugin.json"), r#"{"name":"analytics","description":"Analytics skills","version":"1.0.0"}"#).unwrap();

        let p2 = tmp.path().join("plugins").join("devops").join(".claude-plugin");
        fs::create_dir_all(&p2).unwrap();
        fs::write(p2.join("plugin.json"), r#"{"name":"devops","description":"DevOps skills"}"#).unwrap();

        write_marketplace_json(tmp.path()).unwrap();

        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        assert!(mj_path.is_file());
        let content: serde_json::Value = serde_json::from_str(&fs::read_to_string(&mj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "skill-builder-local");
        assert_eq!(content["owner"]["name"], "Skill Builder");

        let plugins = content["plugins"].as_array().unwrap();
        assert_eq!(plugins.len(), 2);
        assert_eq!(plugins[0]["name"], "analytics");
        assert_eq!(plugins[0]["source"], "./plugins/analytics");
        assert_eq!(plugins[0]["description"], "Analytics skills");
        assert_eq!(plugins[1]["name"], "devops");
        assert_eq!(plugins[1]["source"], "./plugins/devops");
    }

    #[test]
    fn regenerate_all_manifests_fills_missing_plugin_json() {
        let tmp = tempfile::tempdir().unwrap();

        // Plugin with no plugin.json
        let skills_dir = tmp.path().join("plugins").join("my-tool").join("skills").join("hello");
        fs::create_dir_all(&skills_dir).unwrap();
        fs::write(skills_dir.join("SKILL.md"), "# hello").unwrap();

        regenerate_all_manifests(tmp.path()).unwrap();

        // plugin.json should now exist
        let pj_path = tmp.path().join("plugins").join("my-tool").join(".claude-plugin").join("plugin.json");
        assert!(pj_path.is_file());
        let content: serde_json::Value = serde_json::from_str(&fs::read_to_string(&pj_path).unwrap()).unwrap();
        assert_eq!(content["name"], "My Tool");

        // marketplace.json should exist
        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        assert!(mj_path.is_file());
    }

    #[test]
    fn write_marketplace_json_handles_empty_plugins_dir() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join("plugins")).unwrap();

        write_marketplace_json(tmp.path()).unwrap();

        let mj_path = tmp.path().join(".claude-plugin").join("marketplace.json");
        let content: serde_json::Value = serde_json::from_str(&fs::read_to_string(&mj_path).unwrap()).unwrap();
        assert_eq!(content["plugins"].as_array().unwrap().len(), 0);
    }
}
