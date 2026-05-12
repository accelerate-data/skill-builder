use rusqlite::{Connection, OptionalExtension};

/// A structured skill identifier that can be resolved to a `skills.id` integer.
///
/// Bare skill names are intentionally excluded — name-based resolution requires
/// `(skill_name, plugin_slug)` via `get_skill_master_id_in_plugin`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SkillIdentifier {
    /// Direct `skills.id` integer (e.g. `"42"`).
    ById(i64),
    /// Builder library key (e.g. `"skill-builder:default:my-skill"`).
    ByBuilderKey { plugin: String, name: String },
    /// Imported skill ID (e.g. `"imported:123"`). After migration 51, these are
    /// `skills.id` integers. Kept as a separate variant for backward-compatible
    /// parsing of external callers still using the `imported:` prefix.
    ByImportedId(i64),
}

/// Errors returned by `SkillIdentifier::parse`.
#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ParseError {
    #[error("skill_id is required")]
    Empty,
    #[error("skill_id must be a numeric ID or structured key (skill-builder:plugin:name or imported:id)")]
    InvalidFormat,
}

impl SkillIdentifier {
    /// Parse a string into a `SkillIdentifier`. Rejects bare skill names.
    pub fn parse(input: &str) -> Result<Self, ParseError> {
        let input = input.trim();
        if input.is_empty() {
            return Err(ParseError::Empty);
        }

        // Try raw integer first
        if let Ok(id) = input.parse::<i64>() {
            return Ok(SkillIdentifier::ById(id));
        }

        // Try structured prefixes
        if let Some(rest) = input.strip_prefix("skill-builder:") {
            if let Some((plugin, name)) = rest.split_once(':') {
                if !plugin.is_empty() && !name.is_empty() {
                    return Ok(SkillIdentifier::ByBuilderKey {
                        plugin: plugin.to_string(),
                        name: name.to_string(),
                    });
                }
            }
        }

        if let Some(rest) = input.strip_prefix("imported:") {
            if let Ok(id) = rest.parse::<i64>() {
                return Ok(SkillIdentifier::ByImportedId(id));
            }
        }

        Err(ParseError::InvalidFormat)
    }

    /// Resolve this identifier to a `skills.id` integer.
    pub fn resolve_to_db_id(&self, conn: &Connection) -> Result<i64, String> {
        match self {
            SkillIdentifier::ById(id) => {
                let row = conn
                    .query_row(
                        "SELECT id FROM skills WHERE id = ?1 AND COALESCE(deleted_at, '') = ''",
                        rusqlite::params![id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                row.ok_or_else(|| format!("Skill not found: {}", id))
            }
            SkillIdentifier::ByBuilderKey { plugin, name } => {
                crate::db::get_skill_master_id_in_plugin(conn, name, plugin)?
                    .ok_or_else(|| {
                        format!("Skill not found: skill-builder:{}:{}", plugin, name)
                    })
            }
            SkillIdentifier::ByImportedId(id) => {
                let row = conn
                    .query_row(
                        "SELECT id FROM skills WHERE id = ?1 AND COALESCE(deleted_at, '') = ''",
                        rusqlite::params![id],
                        |row| row.get(0),
                    )
                    .optional()
                    .map_err(|e| e.to_string())?;
                row.ok_or_else(|| format!("Skill not found: imported:{}", id))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{create_test_db_for_tests, ensure_default_plugin, upsert_skill_in_plugin};

    #[test]
    fn parse_integer_id() {
        assert_eq!(SkillIdentifier::parse("42"), Ok(SkillIdentifier::ById(42)));
        assert_eq!(SkillIdentifier::parse("-1"), Ok(SkillIdentifier::ById(-1)));
        assert_eq!(SkillIdentifier::parse("0"), Ok(SkillIdentifier::ById(0)));
    }

    #[test]
    fn parse_builder_key() {
        assert_eq!(
            SkillIdentifier::parse("skill-builder:default:my-skill"),
            Ok(SkillIdentifier::ByBuilderKey {
                plugin: "default".to_string(),
                name: "my-skill".to_string(),
            })
        );
    }

    #[test]
    fn parse_imported_id() {
        assert_eq!(
            SkillIdentifier::parse("imported:123"),
            Ok(SkillIdentifier::ByImportedId(123))
        );
    }

    #[test]
    fn parse_rejects_bare_name() {
        assert!(matches!(
            SkillIdentifier::parse("my-skill"),
            Err(ParseError::InvalidFormat)
        ));
    }

    #[test]
    fn parse_rejects_empty() {
        assert!(matches!(
            SkillIdentifier::parse(""),
            Err(ParseError::Empty)
        ));
        assert!(matches!(
            SkillIdentifier::parse("  "),
            Err(ParseError::Empty)
        ));
    }

    #[test]
    fn parse_rejects_malformed_builder_key() {
        // Missing name segment
        assert!(matches!(
            SkillIdentifier::parse("skill-builder:default"),
            Err(ParseError::InvalidFormat)
        ));
        // Empty plugin
        assert!(matches!(
            SkillIdentifier::parse("skill-builder::name"),
            Err(ParseError::InvalidFormat)
        ));
    }

    #[test]
    fn resolve_by_id_finds_existing_skill() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let id = upsert_skill_in_plugin(
            &conn,
            "test-skill",
            "skill-builder",
            "domain",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )
        .unwrap();

        let resolved = SkillIdentifier::ById(id).resolve_to_db_id(&conn).unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_by_id_rejects_deleted_skill() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let id = upsert_skill_in_plugin(
            &conn,
            "deleted-skill",
            "skill-builder",
            "domain",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )
        .unwrap();
        // Soft-delete the skill
        conn.execute(
            "UPDATE skills SET deleted_at = datetime('now') WHERE id = ?1",
            rusqlite::params![id],
        )
        .unwrap();

        let result = SkillIdentifier::ById(id).resolve_to_db_id(&conn);
        assert!(result.is_err());
    }

    #[test]
    fn resolve_by_builder_key() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let id = upsert_skill_in_plugin(
            &conn,
            "builder-skill",
            "skill-builder",
            "domain",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )
        .unwrap();

        let resolved = SkillIdentifier::ByBuilderKey {
            plugin: crate::skill_paths::DEFAULT_PLUGIN_SLUG.to_string(),
            name: "builder-skill".to_string(),
        }
        .resolve_to_db_id(&conn)
        .unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_by_imported_id() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let id = upsert_skill_in_plugin(
            &conn,
            "imported-skill",
            "marketplace",
            "domain",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )
        .unwrap();

        let resolved = SkillIdentifier::ByImportedId(id)
            .resolve_to_db_id(&conn)
            .unwrap();
        assert_eq!(resolved, id);
    }

    #[test]
    fn resolve_returns_error_for_nonexistent_id() {
        let conn = create_test_db_for_tests();
        let result = SkillIdentifier::ById(99999).resolve_to_db_id(&conn);
        assert!(result.is_err());
    }
}
