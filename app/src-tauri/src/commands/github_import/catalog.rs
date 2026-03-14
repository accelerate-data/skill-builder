/// Pure skill-discovery kernel: given a marketplace catalog and a pre-built set of
/// repository-relative directory paths that contain a `SKILL.md` blob, return all
/// importable [`AvailableSkill`] entries.
///
/// Each catalog entry's `source` points to a **plugin directory**. Skills live exactly
/// one level below that directory's `skills/` subdirectory:
///
/// ```text
/// {plugin_path}/skills/{skill_name}/SKILL.md
/// ```
///
/// Source path resolution rules (in order):
/// 1. Paths starting with `./` are stripped of `./` and anchored to the marketplace
///    directory (i.e. relative to `subpath`, or repo root if `subpath` is `None`).
/// 2. Bare names (no `./`) have `plugin_root` prepended when set, then are anchored
///    the same way.
/// 3. `subpath` is always prepended to anchor sources to the repo root.
///
/// External source types (`github`, `npm`, `pip`, `url`) are skipped with a warning.
/// Plugin entries that yield no skills are silently skipped (logged at `debug`).
/// No fallback paths are attempted.
pub(crate) fn discover_skills_from_catalog(
    plugins: &[crate::types::MarketplacePlugin],
    plugin_root: Option<&str>,
    skill_dirs: &std::collections::HashSet<String>,
    subpath: Option<&str>,
) -> Vec<crate::types::AvailableSkill> {
    use crate::types::{AvailableSkill, MarketplacePluginSource};

    let mut skills = Vec::new();

    for plugin in plugins {
        let source_str = match &plugin.source {
            MarketplacePluginSource::Path(s) => s,
            MarketplacePluginSource::External { source, .. } => {
                let name = plugin.name.as_deref().unwrap_or("<unnamed>");
                log::warn!(
                    "[discover_skills] skipping plugin '{}' — unsupported source type '{}'",
                    name,
                    source
                );
                continue;
            }
        };

        // Resolve the plugin directory path relative to the repo root.
        //
        // • Relative paths (start with `./`): strip `./` prefix; the remainder is
        //   relative to the marketplace directory.
        // • Bare names (no `./`): prepend `plugin_root` if set.
        // • Then prepend `subpath` to anchor to the repo root.
        let relative_part: String = if source_str.starts_with("./") {
            source_str
                .strip_prefix("./")
                .unwrap_or(source_str)
                .trim_end_matches('/')
                .to_string()
        } else {
            let trimmed = source_str.trim_end_matches('/');
            match plugin_root.filter(|r| !r.is_empty()) {
                Some(root) => format!("{}/{}", root.trim_end_matches('/'), trimmed),
                None => trimmed.to_string(),
            }
        };

        let plugin_path: String = match subpath.filter(|s| !s.is_empty()) {
            Some(sp) if !relative_part.is_empty() => {
                format!("{}/{}", sp.trim_end_matches('/'), relative_part)
            }
            Some(sp) => sp.trim_end_matches('/').to_string(),
            None => relative_part,
        };

        // Skills prefix: all valid skill dirs for this plugin start with this.
        // When plugin_path is empty (source was `"./"`), prefix is simply `"skills/"`.
        let skills_prefix = if plugin_path.is_empty() {
            "skills/".to_string()
        } else {
            format!("{}/skills/", plugin_path)
        };

        let plugin_name = plugin.name.as_deref().unwrap_or("<unnamed>");
        let before = skills.len();

        // Collect skill entries: dirs that start with skills_prefix and whose
        // remainder (the skill name) is a single path segment — no further `/`.
        for dir in skill_dirs {
            if let Some(skill_name) = dir.strip_prefix(&skills_prefix) {
                if skill_name.is_empty() || skill_name.contains('/') {
                    continue;
                }
                skills.push(AvailableSkill {
                    path: dir.clone(),
                    name: skill_name.to_string(),
                    plugin_name: None, // populated later from plugin.json
                    description: plugin.description.clone(),
                    purpose: Some("general-purpose".to_string()),
                    version: None,
                    model: None,
                    argument_hint: None,
                    user_invocable: None,
                    disable_model_invocation: None,
                });
            }
        }

        let found = skills.len() - before;
        if found == 0 {
            log::debug!(
                "[discover_skills] plugin '{}' (source='{}') — no skills found under '{}'",
                plugin_name,
                source_str,
                skills_prefix
            );
        } else {
            log::debug!(
                "[discover_skills] plugin '{}' — found {} skill(s) under '{}'",
                plugin_name,
                found,
                skills_prefix
            );
        }
    }

    skills
}

/// Given a skill's repo-relative path (`{plugin_path}/skills/{skill_name}`), return the
/// plugin directory prefix.
///
/// Examples:
/// - `"engineering/skills/standup"` → `"engineering"`
/// - `"plugins/eng/skills/standup"` → `"plugins/eng"`
/// - `"skills/standup"` → `""` (root plugin: `skills/` is at the repo root)
pub(crate) fn extract_plugin_path(skill_path: &str) -> &str {
    if let Some(idx) = skill_path.find("/skills/") {
        &skill_path[..idx]
    } else {
        // root plugin — skills/ is directly under the repo root (or subpath root),
        // or unrecognised path structure
        ""
    }
}
