use std::path::Path;

pub(crate) const DEFAULT_IMPORTED_SKILL_VERSION: &str = "1.0.0";

/// Parsed YAML frontmatter fields from a SKILL.md file.
#[derive(Default)]
pub(crate) struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub author: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
    pub has_metadata_version: bool,
}

#[allow(dead_code)]
pub(crate) struct NormalizedFrontmatter {
    pub version: String,
    pub author: Option<String>,
    pub modified: bool,
}

pub(crate) fn yaml_quote_scalar(value: &str) -> String {
    let escaped = value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n");
    format!("\"{}\"", escaped)
}

fn clean_scalar(raw: &str) -> String {
    let trimmed = raw.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        trimmed[1..trimmed.len().saturating_sub(1)].to_string()
    } else {
        trimmed.to_string()
    }
}

fn parse_bool(raw: &str) -> bool {
    matches!(raw.trim().to_ascii_lowercase().as_str(), "true" | "yes" | "1")
}

/// Parse YAML frontmatter from SKILL.md content.
/// Extracts `name` and `description` fields from YAML between `---` markers.
/// Multi-line YAML values (using `>` folded scalar) are joined into a single line.
#[allow(dead_code)]
pub(crate) fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let fm = parse_frontmatter_full(content);
    (fm.name, fm.description)
}

/// Parse YAML frontmatter returning all fields.
pub(crate) fn parse_frontmatter_full(content: &str) -> Frontmatter {
    let trimmed = content.trim_start();
    if !trimmed.starts_with("---") {
        return Frontmatter::default();
    }

    // Find the closing ---
    let after_first = &trimmed[3..];
    let end = match after_first.find("\n---") {
        Some(pos) => pos,
        None => return Frontmatter::default(),
    };

    let yaml_block = &after_first[..end];

    let mut name = None;
    let mut description = None;
    let mut version = None;
    let mut author = None;
    let mut model = None;
    let mut argument_hint = None;
    let mut user_invocable: Option<bool> = None;
    let mut disable_model_invocation: Option<bool> = None;
    let mut metadata_version = None;
    let mut metadata_author = None;
    let mut has_metadata_version = false;

    // Track which multi-line field we're accumulating (for `>` folded scalars)
    let mut current_multiline: Option<&str> = None;
    let mut multiline_buf = String::new();
    let mut current_section: Option<&str> = None;

    for line in yaml_block.lines() {
        let trimmed_line = line.trim();
        let is_indented = line.starts_with(' ') || line.starts_with('\t');

        // Check if this is a continuation line (indented, part of a multi-line value)
        if current_multiline.is_some() && is_indented && !trimmed_line.is_empty() {
            if !multiline_buf.is_empty() {
                multiline_buf.push(' ');
            }
            multiline_buf.push_str(trimmed_line);
            continue;
        }

        // Flush any accumulated multi-line value
        if current_multiline.take().is_some() {
            let val = multiline_buf.trim().to_string();
            if !val.is_empty() {
                description = Some(val);
            }
            multiline_buf.clear();
        }

        // Parse new field
        if !is_indented {
            current_section = None;
            if trimmed_line.ends_with(':') && !trimmed_line[..trimmed_line.len() - 1].contains(':') {
                current_section = Some(trimmed_line.trim_end_matches(':'));
                continue;
            }
        }

        if current_section == Some("metadata") && is_indented {
            if let Some(val) = trimmed_line.strip_prefix("version:") {
                has_metadata_version = true;
                metadata_version = Some(clean_scalar(val));
            } else if let Some(val) = trimmed_line.strip_prefix("author:") {
                metadata_author = Some(clean_scalar(val));
            }
            continue;
        }

        if let Some(val) = trimmed_line.strip_prefix("name:") {
            name = Some(clean_scalar(val));
        } else if let Some(val) = trimmed_line.strip_prefix("description:") {
            let val = val.trim();
            if val == ">" || val == "|" {
                current_multiline = Some("description");
            } else {
                description = Some(clean_scalar(val));
            }
        } else if let Some(val) = trimmed_line.strip_prefix("version:") {
            version = Some(clean_scalar(val));
        } else if let Some(val) = trimmed_line.strip_prefix("author:") {
            author = Some(clean_scalar(val));
        } else if let Some(val) = trimmed_line.strip_prefix("model:") {
            model = Some(clean_scalar(val));
        } else if let Some(val) = trimmed_line.strip_prefix("argument-hint:") {
            argument_hint = Some(clean_scalar(val));
        } else if let Some(val) = trimmed_line.strip_prefix("user-invocable:") {
            user_invocable = Some(parse_bool(val));
        } else if let Some(val) = trimmed_line.strip_prefix("disable-model-invocation:") {
            disable_model_invocation = Some(parse_bool(val));
        }
        // All other keys (domain:, type:, purpose:, tools:, trigger:, etc.) are silently ignored.
    }

    // Flush any trailing multi-line value
    if current_multiline.is_some() {
        let val = multiline_buf.trim().to_string();
        if !val.is_empty() {
            description = Some(val);
        }
    }

    // Trim all fields — frontmatter values may have leading/trailing whitespace or newlines
    let trim_opt = |s: Option<String>| -> Option<String> {
        s.map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
    };

    Frontmatter {
        name: trim_opt(name),
        description: trim_opt(description),
        version: trim_opt(metadata_version).or_else(|| trim_opt(version)),
        author: trim_opt(metadata_author).or_else(|| trim_opt(author)),
        model: trim_opt(model),
        argument_hint: trim_opt(argument_hint),
        user_invocable,
        disable_model_invocation,
        has_metadata_version,
    }
}

fn rebuild_frontmatter_lines(
    lines: &[String],
    closing_idx: usize,
    final_version: &str,
    final_author: Option<&str>,
) -> Vec<String> {
    let mut rewritten = vec![lines[0].clone()];
    let mut idx = 1;

    while idx < closing_idx {
        let line = &lines[idx];
        let trimmed = line.trim();

        if !line.starts_with(' ') && !line.starts_with('\t') {
            if trimmed.starts_with("version:") || trimmed.starts_with("author:") {
                idx += 1;
                continue;
            }
            if trimmed == "metadata:" {
                idx += 1;
                while idx < closing_idx
                    && (lines[idx].starts_with(' ') || lines[idx].starts_with('\t'))
                {
                    idx += 1;
                }
                continue;
            }
        }

        rewritten.push(line.clone());
        idx += 1;
    }

    rewritten.push("metadata:".to_string());
    rewritten.push(format!("  version: {}", yaml_quote_scalar(final_version)));
    if let Some(author) = final_author {
        rewritten.push(format!("  author: {}", yaml_quote_scalar(author)));
    }
    rewritten.push("---".to_string());
    rewritten
}

pub(crate) fn ensure_skill_frontmatter_metadata(
    skill_md_path: &Path,
    preferred_version: Option<&str>,
    preferred_author: Option<&str>,
) -> Result<NormalizedFrontmatter, String> {
    let content = std::fs::read_to_string(skill_md_path)
        .map_err(|e| format!("Failed to read '{}': {}", skill_md_path.display(), e))?;
    let normalized = content.replace("\r\n", "\n");
    let frontmatter = parse_frontmatter_full(&normalized);

    let requested_version = preferred_version
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let requested_author = preferred_author
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(str::to_string);
    let final_version = requested_version
        .or(frontmatter.version.clone())
        .unwrap_or_else(|| DEFAULT_IMPORTED_SKILL_VERSION.to_string());
    let final_author = requested_author.or(frontmatter.author.clone());

    if !normalized.starts_with("---") {
        return Err(format!(
            "SKILL.md at '{}' is missing YAML frontmatter",
            skill_md_path.display()
        ));
    }

    let lines: Vec<String> = normalized.split('\n').map(str::to_string).collect();
    let closing_idx = lines
        .iter()
        .enumerate()
        .skip(1)
        .find_map(|(idx, line)| (line.trim() == "---").then_some(idx))
        .ok_or_else(|| {
            format!(
                "SKILL.md at '{}' has an unclosed YAML frontmatter block",
                skill_md_path.display()
            )
        })?;

    let rewritten_frontmatter =
        rebuild_frontmatter_lines(&lines, closing_idx, &final_version, final_author.as_deref());
    let body = if closing_idx + 1 < lines.len() {
        lines[(closing_idx + 1)..].join("\n")
    } else {
        String::new()
    };
    let mut rewritten = rewritten_frontmatter.join("\n");
    if !body.is_empty() {
        rewritten.push('\n');
        rewritten.push_str(&body);
    }

    let modified = rewritten != normalized;
    if modified {
        std::fs::write(skill_md_path, rewritten)
            .map_err(|e| format!("Failed to write '{}': {}", skill_md_path.display(), e))?;
    }

    Ok(NormalizedFrontmatter {
        version: final_version,
        author: final_author,
        modified,
    })
}

#[cfg(test)]
pub(crate) fn ensure_skill_frontmatter_version(
    skill_md_path: &Path,
    preferred_version: Option<&str>,
) -> Result<String, String> {
    ensure_skill_frontmatter_metadata(skill_md_path, preferred_version, None).map(|result| result.version)
}

pub(crate) fn render_frontmatter_yaml(frontmatter: &Frontmatter) -> String {
    let mut yaml = String::new();
    let mut add_field = |key: &str, value: &Option<String>| {
        if let Some(value) = value {
            yaml.push_str(&format!("{}: {}\n", key, yaml_quote_scalar(value)));
        }
    };

    add_field("name", &frontmatter.name);
    add_field("description", &frontmatter.description);
    add_field("model", &frontmatter.model);
    add_field("argument-hint", &frontmatter.argument_hint);
    if let Some(user_invocable) = frontmatter.user_invocable {
        yaml.push_str(&format!("user-invocable: {}\n", user_invocable));
    }
    if let Some(disable_model_invocation) = frontmatter.disable_model_invocation {
        yaml.push_str(&format!(
            "disable-model-invocation: {}\n",
            disable_model_invocation
        ));
    }
    if frontmatter.version.is_some() || frontmatter.author.is_some() {
        yaml.push_str("metadata:\n");
        if let Some(version) = &frontmatter.version {
            yaml.push_str(&format!("  version: {}\n", yaml_quote_scalar(version)));
        }
        if let Some(author) = &frontmatter.author {
            yaml.push_str(&format!("  author: {}\n", yaml_quote_scalar(author)));
        }
    }

    yaml
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn valid_frontmatter() {
        let content = "---\nname: My Skill\ndescription: A useful skill\nmetadata:\n  version: 1.0\n  author: hb\n---\nBody content here.\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.name.as_deref(), Some("My Skill"));
        assert_eq!(fm.description.as_deref(), Some("A useful skill"));
        assert_eq!(fm.version.as_deref(), Some("1.0"));
        assert_eq!(fm.author.as_deref(), Some("hb"));
        assert!(fm.has_metadata_version);
    }

    #[test]
    fn missing_frontmatter() {
        let content = "No frontmatter markers here.\nJust plain text.\n";
        let fm = parse_frontmatter_full(content);
        assert!(fm.name.is_none());
        assert!(fm.description.is_none());
        assert!(fm.version.is_none());
        assert!(fm.author.is_none());
        assert!(fm.model.is_none());
        assert!(fm.user_invocable.is_none());
    }

    #[test]
    fn crlf_endings() {
        let content = "---\r\nname: CRLF Skill\r\ndescription: Works with Windows line endings\r\n---\r\nBody.\r\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.name.as_deref(), Some("CRLF Skill"));
        assert_eq!(
            fm.description.as_deref(),
            Some("Works with Windows line endings")
        );
    }

    #[test]
    fn folded_scalar() {
        let content = "---\nname: Folded\ndescription: >\n  This is a long\n  description that spans\n  multiple lines.\nmetadata:\n  version: 2.0.0\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.name.as_deref(), Some("Folded"));
        assert_eq!(
            fm.description.as_deref(),
            Some("This is a long description that spans multiple lines.")
        );
        assert_eq!(fm.version.as_deref(), Some("2.0.0"));
    }

    #[test]
    fn boolean_field_parsing() {
        // true
        let content = "---\nname: Bool Test\nuser-invocable: true\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.user_invocable, Some(true));

        // yes
        let content = "---\nname: Bool Test\nuser-invocable: yes\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.user_invocable, Some(true));

        // 1
        let content = "---\nname: Bool Test\nuser-invocable: 1\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.user_invocable, Some(true));

        // false
        let content = "---\nname: Bool Test\nuser-invocable: false\n---\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.user_invocable, Some(false));
    }

    #[test]
    fn missing_closing_markers() {
        let content = "---\nname: Unclosed\ndescription: No closing markers\n";
        let fm = parse_frontmatter_full(content);
        assert!(fm.name.is_none());
        assert!(fm.description.is_none());
    }

    #[test]
    fn metadata_version_wins_over_legacy_top_level_version() {
        let content = "---\nname: Test\nauthor: legacy-user\nversion: 0.1.0\nmetadata:\n  version: 2.0.0\n  author: metadata-user\n---\n# Body\n";
        let fm = parse_frontmatter_full(content);
        assert_eq!(fm.version.as_deref(), Some("2.0.0"));
        assert_eq!(fm.author.as_deref(), Some("metadata-user"));
    }

    #[test]
    fn ensure_skill_frontmatter_version_adds_default_version() {
        let dir = tempdir().unwrap();
        let skill_md = dir.path().join("SKILL.md");
        std::fs::write(
            &skill_md,
            "---\nname: Test Skill\ndescription: A test\ntrigger: do thing\n---\n# Body\n",
        )
        .unwrap();

        let version = ensure_skill_frontmatter_version(&skill_md, None).unwrap();
        let updated = std::fs::read_to_string(&skill_md).unwrap();

        assert_eq!(version, "1.0.0");
        assert!(updated.contains("metadata:"));
        assert!(updated.contains("version: \"1.0.0\""));
        assert!(updated.contains("trigger: do thing"));
    }

    #[test]
    fn ensure_skill_frontmatter_version_preserves_existing_unknown_fields() {
        let dir = tempdir().unwrap();
        let skill_md = dir.path().join("SKILL.md");
        std::fs::write(
            &skill_md,
            "---\nname: Test Skill\ndescription: A test\ntrigger: do thing\nversion: 0.1.0\n---\n# Body\n",
        )
        .unwrap();

        let version = ensure_skill_frontmatter_version(&skill_md, Some("2.1.0")).unwrap();
        let updated = std::fs::read_to_string(&skill_md).unwrap();

        assert_eq!(version, "2.1.0");
        assert!(updated.contains("trigger: do thing"));
        assert!(updated.contains("metadata:"));
        assert!(updated.contains("version: \"2.1.0\""));
        assert!(!updated.contains("\nversion: 0.1.0\n"));
    }

    #[test]
    fn ensure_skill_frontmatter_metadata_adds_author() {
        let dir = tempdir().unwrap();
        let skill_md = dir.path().join("SKILL.md");
        std::fs::write(
            &skill_md,
            "---\nname: Test Skill\ndescription: A test\nmetadata:\n  version: 1.0.0\n---\n# Body\n",
        )
        .unwrap();

        let normalized =
            ensure_skill_frontmatter_metadata(&skill_md, None, Some("hb@acceleratedata.ai"))
                .unwrap();
        let updated = std::fs::read_to_string(&skill_md).unwrap();

        assert_eq!(normalized.version, "1.0.0");
        assert_eq!(normalized.author.as_deref(), Some("hb@acceleratedata.ai"));
        assert!(updated.contains("author: \"hb@acceleratedata.ai\""));
    }

    #[test]
    fn render_frontmatter_yaml_uses_metadata_block() {
        let yaml = render_frontmatter_yaml(&Frontmatter {
            name: Some("test-skill".to_string()),
            description: Some("Does a thing".to_string()),
            version: Some("1.0.0".to_string()),
            author: Some("hb".to_string()),
            ..Default::default()
        });

        assert!(yaml.contains("name: \"test-skill\""));
        assert!(yaml.contains("metadata:\n  version: \"1.0.0\"\n  author: \"hb\""));
    }
}
