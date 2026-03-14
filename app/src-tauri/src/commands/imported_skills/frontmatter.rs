/// Parsed YAML frontmatter fields from a SKILL.md file.
#[derive(Default)]
pub(crate) struct Frontmatter {
    pub name: Option<String>,
    pub description: Option<String>,
    pub version: Option<String>,
    pub model: Option<String>,
    pub argument_hint: Option<String>,
    pub user_invocable: Option<bool>,
    pub disable_model_invocation: Option<bool>,
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
    let mut model = None;
    let mut argument_hint = None;
    let mut user_invocable: Option<bool> = None;
    let mut disable_model_invocation: Option<bool> = None;

    // Track which multi-line field we're accumulating (for `>` folded scalars)
    let mut current_multiline: Option<&str> = None;
    let mut multiline_buf = String::new();

    for line in yaml_block.lines() {
        let trimmed_line = line.trim();

        // Check if this is a continuation line (indented, part of a multi-line value)
        if current_multiline.is_some()
            && (line.starts_with(' ') || line.starts_with('\t'))
            && !trimmed_line.is_empty()
        {
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
        if let Some(val) = trimmed_line.strip_prefix("name:") {
            name = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("description:") {
            let val = val.trim();
            if val == ">" || val == "|" {
                current_multiline = Some("description");
            } else {
                description = Some(val.trim_matches('"').trim_matches('\'').to_string());
            }
        } else if let Some(val) = trimmed_line.strip_prefix("version:") {
            version = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("model:") {
            model = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("argument-hint:") {
            argument_hint = Some(val.trim().trim_matches('"').trim_matches('\'').to_string());
        } else if let Some(val) = trimmed_line.strip_prefix("user-invocable:") {
            let v = val.trim().to_lowercase();
            user_invocable = Some(v == "true" || v == "yes" || v == "1");
        } else if let Some(val) = trimmed_line.strip_prefix("disable-model-invocation:") {
            let v = val.trim().to_lowercase();
            disable_model_invocation = Some(v == "true" || v == "yes" || v == "1");
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
        version: trim_opt(version),
        model: trim_opt(model),
        argument_hint: trim_opt(argument_hint),
        user_invocable,
        disable_model_invocation,
    }
}
