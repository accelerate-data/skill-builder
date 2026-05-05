use crate::skill_paths::{DEFAULT_PLUGIN_DISPLAY_NAME, DEFAULT_PLUGIN_SLUG};
use crate::types::SkillMasterRow;
use rusqlite::{Connection, OptionalExtension};
use std::collections::HashMap;

/// Map a row from the standard skills+plugins join into a SkillMasterRow.
/// Column order must match the SELECT used in list_all_skills, get_skill_master_*:
///   s.id, s.name, s.skill_source, p.id, p.slug, p.display_name, p.is_default,
///   s.purpose, s.created_at, s.updated_at, s.description, s.version, s.model,
///   s.argument_hint, s.user_invocable, s.disable_model_invocation
fn map_skill_master_row(row: &rusqlite::Row) -> rusqlite::Result<SkillMasterRow> {
    Ok(SkillMasterRow {
        id: row.get(0)?,
        name: row.get(1)?,
        skill_source: row.get(2)?,
        plugin_id: row.get(3)?,
        plugin_slug: row.get(4)?,
        plugin_display_name: row.get(5)?,
        plugin_is_default: row.get::<_, i32>(6)? != 0,
        purpose: row.get(7)?,
        created_at: row.get(8)?,
        updated_at: row.get(9)?,
        description: row.get(10)?,
        version: row.get(11)?,
        model: row.get(12)?,
        argument_hint: row.get(13)?,
        user_invocable: row.get::<_, Option<i32>>(14)?.map(|v| v != 0),
        disable_model_invocation: row.get::<_, Option<i32>>(15)?.map(|v| v != 0),
    })
}

pub fn slugify_plugin_name(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut last_dash = false;
    for ch in name.chars() {
        let mapped = match ch {
            'a'..='z' | '0'..='9' => Some(ch),
            'A'..='Z' => Some(ch.to_ascii_lowercase()),
            _ => Some('-'),
        };
        if let Some(c) = mapped {
            if c == '-' {
                if !last_dash {
                    slug.push(c);
                }
                last_dash = true;
            } else {
                slug.push(c);
                last_dash = false;
            }
        }
    }
    let slug = slug.trim_matches('-');
    if slug.is_empty() {
        DEFAULT_PLUGIN_SLUG.to_string()
    } else {
        slug.to_string()
    }
}

pub fn ensure_plugin(
    conn: &Connection,
    slug: &str,
    display_name: &str,
    source_type: &str,
    source_url: Option<&str>,
    version: Option<&str>,
    is_default: bool,
) -> Result<i64, String> {
    conn.execute(
        "INSERT INTO plugins (slug, display_name, version, source_type, source_url, is_default, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now') || 'Z')
         ON CONFLICT(slug) DO UPDATE SET
             display_name = excluded.display_name,
             version = COALESCE(excluded.version, plugins.version),
             source_type = excluded.source_type,
             source_url = COALESCE(excluded.source_url, plugins.source_url),
             is_default = excluded.is_default,
             updated_at = datetime('now') || 'Z'",
        rusqlite::params![
            slug,
            display_name,
            version,
            source_type,
            source_url,
            if is_default { 1 } else { 0 },
        ],
    )
    .map_err(|e| format!("ensure_plugin: {}", e))?;
    conn.query_row(
        "SELECT id FROM plugins WHERE slug = ?1",
        rusqlite::params![slug],
        |row| row.get(0),
    )
    .map_err(|e| format!("ensure_plugin id lookup: {}", e))
}

pub fn ensure_default_plugin(conn: &Connection) -> Result<i64, String> {
    ensure_plugin(
        conn,
        DEFAULT_PLUGIN_SLUG,
        DEFAULT_PLUGIN_DISPLAY_NAME,
        "synthetic",
        None,
        None,
        true,
    )
}

/// Delete a plugin row by slug. Only succeeds if the plugin has no skills
/// (enforced by FK RESTRICT on skills.plugin_id). Refuses to delete the default plugin.
pub fn delete_plugin_by_slug(conn: &Connection, slug: &str) -> Result<(), String> {
    if slug == DEFAULT_PLUGIN_SLUG {
        return Err("Cannot delete the default plugin".to_string());
    }
    conn.execute(
        "DELETE FROM plugins WHERE slug = ?1",
        rusqlite::params![slug],
    )
    .map_err(|e| format!("delete_plugin_by_slug: {}", e))?;
    Ok(())
}

/// Update a plugin's display_name by slug.
pub fn update_plugin_display_name(
    conn: &Connection,
    slug: &str,
    display_name: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE plugins SET display_name = ?2, updated_at = datetime('now') || 'Z' WHERE slug = ?1",
        rusqlite::params![slug, display_name],
    )
    .map_err(|e| format!("update_plugin_display_name: {}", e))?;
    Ok(())
}

pub fn get_plugin_id_by_slug(conn: &Connection, slug: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM plugins WHERE slug = ?1",
        rusqlite::params![slug],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| format!("get_plugin_id_by_slug: {}", e))
}

pub fn list_plugins(conn: &Connection) -> Result<Vec<crate::types::LibraryPlugin>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, slug, display_name, version, source_type, source_url, is_default, COALESCE(upgrade_locked, 0)
             FROM plugins
             ORDER BY is_default DESC, display_name ASC",
        )
        .map_err(|e| format!("list_plugins: {}", e))?;
    let rows = stmt
        .query_map([], |row| {
            Ok(crate::types::LibraryPlugin {
                id: row.get(0)?,
                slug: row.get(1)?,
                display_name: row.get(2)?,
                version: row.get(3)?,
                source_type: row.get(4)?,
                source_url: row.get(5)?,
                is_default: row.get::<_, i32>(6)? != 0,
                upgrade_locked: row.get::<_, i32>(7)? != 0,
            })
        })
        .map_err(|e| format!("list_plugins query: {}", e))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list_plugins collect: {}", e))
}

/// Set the `upgrade_locked` flag on a plugin by slug.
pub fn set_plugin_upgrade_locked(
    conn: &Connection,
    slug: &str,
    locked: bool,
) -> Result<(), String> {
    conn.execute(
        "UPDATE plugins SET upgrade_locked = ?2, updated_at = datetime('now') || 'Z' WHERE slug = ?1",
        rusqlite::params![slug, if locked { 1i32 } else { 0i32 }],
    )
    .map_err(|e| format!("set_plugin_upgrade_locked: {}", e))?;
    Ok(())
}

/// Lock the plugin that owns `skill_name` against upgrades.
/// Only applies to marketplace plugins (source_type = 'marketplace').
/// This is a no-op for builder or non-marketplace plugins.
pub fn lock_plugin_for_skill(conn: &Connection, skill_name: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE plugins SET upgrade_locked = 1, updated_at = datetime('now') || 'Z'
         WHERE id = (SELECT plugin_id FROM skills WHERE name = ?1 AND COALESCE(deleted_at, '') = '' LIMIT 1)
           AND source_type = 'marketplace'",
        rusqlite::params![skill_name],
    )
    .map_err(|e| format!("lock_plugin_for_skill: {}", e))?;
    Ok(())
}

pub fn create_plugin(
    conn: &Connection,
    display_name: &str,
    source_type: &str,
    source_url: Option<&str>,
    version: Option<&str>,
) -> Result<(i64, String), String> {
    let base_slug = slugify_plugin_name(display_name);
    let mut slug = base_slug.clone();
    let mut suffix = 2;
    while get_plugin_id_by_slug(conn, &slug)?.is_some() {
        slug = format!("{base_slug}-{suffix}");
        suffix += 1;
    }
    let id = ensure_plugin(
        conn,
        &slug,
        display_name,
        source_type,
        source_url,
        version,
        false,
    )?;
    Ok((id, slug))
}

// --- Skills Master ---

/// Upsert a row in the `skills` master table. Used by `save_workflow_run` (skill-builder)
/// and marketplace import. Returns the skill id.
pub fn upsert_skill(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
) -> Result<i64, String> {
    upsert_skill_in_plugin(conn, name, skill_source, purpose, DEFAULT_PLUGIN_SLUG)
}

/// Resolve the plugin_id for a given slug, creating the default plugin if needed.
fn resolve_plugin_id(conn: &Connection, plugin_slug: &str) -> Result<i64, String> {
    if plugin_slug == DEFAULT_PLUGIN_SLUG {
        ensure_default_plugin(conn)
    } else {
        get_plugin_id_by_slug(conn, plugin_slug)?
            .ok_or_else(|| format!("Unknown plugin slug '{}'", plugin_slug))
    }
}

/// Shared implementation for skill upsert. When `update_source` is true,
/// the ON CONFLICT clause also overwrites `skill_source`.
fn upsert_skill_impl(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
    plugin_slug: &str,
    update_source: bool,
) -> Result<i64, String> {
    log::debug!(
        "upsert_skill: name={} skill_source={} update_source={}",
        name,
        skill_source,
        update_source
    );
    let plugin_id = resolve_plugin_id(conn, plugin_slug)?;
    let sql = if update_source {
        "INSERT INTO skills (name, skill_source, plugin_id, purpose, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(plugin_id, name) DO UPDATE SET
             skill_source = excluded.skill_source,
             purpose = excluded.purpose,
             updated_at = datetime('now'),
             deleted_at = NULL"
    } else {
        "INSERT INTO skills (name, skill_source, plugin_id, purpose, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(plugin_id, name) DO UPDATE SET
             purpose = excluded.purpose,
             updated_at = datetime('now'),
             deleted_at = NULL"
    };
    conn.execute(
        sql,
        rusqlite::params![name, skill_source, plugin_id, purpose],
    )
    .map_err(|e| {
        log::error!("upsert_skill: failed to upsert '{}': {}", name, e);
        e.to_string()
    })?;
    conn.query_row(
        "SELECT id FROM skills WHERE name = ?1 AND plugin_id = ?2",
        rusqlite::params![name, plugin_id],
        |row| row.get(0),
    )
    .map_err(|e| {
        log::error!("upsert_skill: failed to retrieve id for '{}': {}", name, e);
        e.to_string()
    })
}

pub fn upsert_skill_in_plugin(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
    plugin_slug: &str,
) -> Result<i64, String> {
    upsert_skill_impl(conn, name, skill_source, purpose, plugin_slug, false)
}

pub fn upsert_skill_with_source_in_plugin(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    purpose: &str,
    plugin_slug: &str,
) -> Result<i64, String> {
    upsert_skill_impl(conn, name, skill_source, purpose, plugin_slug, true)
}

/// List all skills from the master table, ordered by name.
pub fn list_all_skills(conn: &Connection) -> Result<Vec<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.skill_source,
                    p.id, p.slug, p.display_name, p.is_default,
                    s.purpose, s.created_at, s.updated_at,
                    s.description, s.version, s.model, s.argument_hint, s.user_invocable, s.disable_model_invocation
             FROM skills s
             JOIN plugins p ON p.id = s.plugin_id
             WHERE COALESCE(s.deleted_at, '') = ''
             ORDER BY p.display_name, s.name",
        )
        .map_err(|e| {
            log::error!("list_all_skills: failed to prepare query: {}", e);
            e.to_string()
        })?;

    let rows = stmt.query_map([], map_skill_master_row).map_err(|e| {
        log::error!("list_all_skills: query failed: {}", e);
        e.to_string()
    })?;

    let result: Vec<SkillMasterRow> = rows.collect::<Result<Vec<_>, _>>().map_err(|e| {
        log::error!("list_all_skills: failed to collect rows: {}", e);
        e.to_string()
    })?;
    log::debug!("list_all_skills: returning {} skills", result.len());
    Ok(result)
}

/// Get a single skill from the master table by name.
pub fn get_skill_master(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<SkillMasterRow>, String> {
    get_skill_master_in_plugin(conn, skill_name, DEFAULT_PLUGIN_SLUG)
}

/// Look up a skill's master row across all plugins (not restricted to the default plugin).
pub fn get_skill_master_any_plugin(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.skill_source,
                    p.id, p.slug, p.display_name, p.is_default,
                    s.purpose, s.created_at, s.updated_at,
                    s.description, s.version, s.model, s.argument_hint, s.user_invocable, s.disable_model_invocation
             FROM skills s
             JOIN plugins p ON p.id = s.plugin_id
             WHERE s.name = ?1 AND COALESCE(s.deleted_at, '') = ''
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], map_skill_master_row);

    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_skill_master_in_plugin(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<Option<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, s.skill_source,
                    p.id, p.slug, p.display_name, p.is_default,
                    s.purpose, s.created_at, s.updated_at,
                    s.description, s.version, s.model, s.argument_hint, s.user_invocable, s.disable_model_invocation
             FROM skills s
             JOIN plugins p ON p.id = s.plugin_id
             WHERE s.name = ?1 AND p.slug = ?2 AND COALESCE(s.deleted_at, '') = ''",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(
        rusqlite::params![skill_name, plugin_slug],
        map_skill_master_row,
    );

    match result {
        Ok(row) => Ok(Some(row)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Delete a skill from the master table by name (default plugin only).
/// Production code should use `delete_skill_in_plugin` with an explicit plugin slug.
#[cfg(test)]
pub fn delete_skill(conn: &Connection, name: &str) -> Result<(), String> {
    delete_skill_in_plugin(conn, name, DEFAULT_PLUGIN_SLUG)
}

pub fn delete_skill_in_plugin(
    conn: &Connection,
    name: &str,
    plugin_slug: &str,
) -> Result<(), String> {
    log::info!("delete_skill: name={}", name);
    conn.execute(
        "UPDATE skills
         SET deleted_at = CASE
               WHEN deleted_at IS NULL OR deleted_at = '' THEN datetime('now') || 'Z'
               ELSE deleted_at
             END,
             updated_at = datetime('now')
         WHERE name = ?1
           AND plugin_id = COALESCE((SELECT id FROM plugins WHERE slug = ?2), -1)",
        rusqlite::params![name, plugin_slug],
    )
    .map_err(|e| {
        log::error!("delete_skill: failed to delete '{}': {}", name, e);
        e.to_string()
    })?;
    Ok(())
}

/// Get the `skills.id` integer for a given skill name (default plugin only).
/// Production code should use `get_skill_master_id_in_plugin` with an explicit plugin slug.
#[cfg(test)]
pub fn get_skill_master_id(conn: &Connection, skill_name: &str) -> Result<Option<i64>, String> {
    get_skill_master_id_in_plugin(conn, skill_name, DEFAULT_PLUGIN_SLUG)
}

/// Look up a skill's row ID across all plugins (not just the default one).
/// Used by lock acquisition, which must work for imported and marketplace skills.
pub fn get_skill_master_id_any_plugin(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM skills WHERE name = ?1 AND COALESCE(deleted_at, '') = '' LIMIT 1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn get_skill_master_id_in_plugin(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT s.id
         FROM skills s
         JOIN plugins p ON p.id = s.plugin_id
         WHERE s.name = ?1 AND p.slug = ?2 AND COALESCE(s.deleted_at, '') = ''",
        rusqlite::params![skill_name, plugin_slug],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn move_skill_to_plugin(
    conn: &Connection,
    skill_name: &str,
    from_plugin_slug: &str,
    to_plugin_slug: &str,
) -> Result<(), String> {
    let target_plugin_id = get_plugin_id_by_slug(conn, to_plugin_slug)?
        .ok_or_else(|| format!("Unknown plugin slug '{}'", to_plugin_slug))?;
    let changed = conn
        .execute(
            "UPDATE skills
         SET plugin_id = ?3, updated_at = datetime('now') || 'Z'
         WHERE name = ?1
           AND plugin_id = COALESCE((SELECT id FROM plugins WHERE slug = ?2), -1)",
            rusqlite::params![skill_name, from_plugin_slug, target_plugin_id],
        )
        .map_err(|e| format!("move_skill_to_plugin: {}", e))?;
    if changed == 0 {
        return Err(format!(
            "move_skill_to_plugin: skill '{}' not found in plugin '{}' (0 rows affected)",
            skill_name, from_plugin_slug
        ));
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn set_skill_behaviour(
    conn: &Connection,
    skill_name: &str,
    description: Option<&str>,
    version: Option<&str>,
    model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    let user_invocable_i: Option<i32> = user_invocable.map(|v| if v { 1 } else { 0 });
    let disable_model_invocation_i: Option<i32> =
        disable_model_invocation.map(|v| if v { 1 } else { 0 });

    // Write to skills master — canonical store for all skill sources
    conn.execute(
        "UPDATE skills SET
            description = COALESCE(?2, description),
            version = COALESCE(?3, version),
            model = COALESCE(?4, model),
            argument_hint = COALESCE(?5, argument_hint),
            user_invocable = COALESCE(?6, user_invocable),
            disable_model_invocation = COALESCE(?7, disable_model_invocation),
            updated_at = datetime('now')
         WHERE name = ?1",
        rusqlite::params![
            skill_name,
            description,
            version,
            model,
            argument_hint,
            user_invocable_i,
            disable_model_invocation_i,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn set_skill_behaviour_in_plugin(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
    description: Option<&str>,
    version: Option<&str>,
    model: Option<&str>,
    argument_hint: Option<&str>,
    user_invocable: Option<bool>,
    disable_model_invocation: Option<bool>,
) -> Result<(), String> {
    let user_invocable_i: Option<i32> = user_invocable.map(|v| if v { 1 } else { 0 });
    let disable_model_invocation_i: Option<i32> =
        disable_model_invocation.map(|v| if v { 1 } else { 0 });

    conn.execute(
        "UPDATE skills SET
            description = COALESCE(?3, description),
            version = COALESCE(?4, version),
            model = COALESCE(?5, model),
            argument_hint = COALESCE(?6, argument_hint),
            user_invocable = COALESCE(?7, user_invocable),
            disable_model_invocation = COALESCE(?8, disable_model_invocation),
            updated_at = datetime('now')
         WHERE name = ?1
           AND plugin_id = (SELECT id FROM plugins WHERE slug = ?2)",
        rusqlite::params![
            skill_name,
            plugin_slug,
            description,
            version,
            model,
            argument_hint,
            user_invocable_i,
            disable_model_invocation_i,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// --- Skill Tags ---

pub fn get_tags_for_skills(
    conn: &Connection,
    skill_names: &[String],
) -> Result<HashMap<String, Vec<String>>, String> {
    if skill_names.is_empty() {
        return Ok(HashMap::new());
    }

    // SQLite default SQLITE_MAX_VARIABLE_NUMBER is 999; chunk if needed
    if skill_names.len() > 900 {
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for chunk in skill_names.chunks(900) {
            let chunk_result = get_tags_for_skills(conn, chunk)?;
            map.extend(chunk_result);
        }
        return Ok(map);
    }

    // Safety: The format! below only injects positional bind-parameter placeholders
    // (?1, ?2, ...) — never user-supplied values. All skill_name values are bound via
    // rusqlite's parameterized query API, so there is no SQL injection risk.
    let placeholders: Vec<String> = (1..=skill_names.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(

        "SELECT s.name, st.tag FROM skill_tags st JOIN skills s ON st.skill_id = s.id WHERE s.name IN ({}) ORDER BY s.name, st.tag",
        placeholders.join(", ")
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let params: Vec<&dyn rusqlite::types::ToSql> = skill_names
        .iter()
        .map(|s| s as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(params.as_slice(), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?;

    let mut map: HashMap<String, Vec<String>> = HashMap::new();
    for row in rows {
        let (name, tag) = row.map_err(|e| e.to_string())?;
        map.entry(name).or_default().push(tag);
    }

    Ok(map)
}

pub fn set_skill_tags(
    conn: &Connection,
    skill_name: &str,
    plugin_slug: &str,
    tags: &[String],
) -> Result<(), String> {
    let s_id = get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)?.ok_or_else(|| {
        format!(
            "Skill '{}' not found in plugin '{}'",
            skill_name, plugin_slug
        )
    })?;

    conn.execute(
        "DELETE FROM skill_tags WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO skill_tags (skill_name, skill_id, tag) VALUES (?1, ?2, ?3)")
        .map_err(|e| e.to_string())?;

    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if !normalized.is_empty() {
            stmt.execute(rusqlite::params![skill_name, s_id, normalized])
                .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

pub fn get_all_tags(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT DISTINCT tag FROM skill_tags ORDER BY tag")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;

    #[test]
    fn ensure_default_plugin_uses_shared_default_plugin_constants() {
        let conn = create_test_db_for_tests();

        ensure_default_plugin(&conn).expect("ensure_default_plugin");

        let plugins = list_plugins(&conn).expect("list_plugins should succeed");
        let default_plugin = plugins
            .iter()
            .find(|plugin| plugin.is_default)
            .expect("default plugin exists");

        assert_eq!(default_plugin.slug, crate::skill_paths::DEFAULT_PLUGIN_SLUG);
        assert_eq!(
            default_plugin.display_name,
            crate::skill_paths::DEFAULT_PLUGIN_DISPLAY_NAME
        );
    }

    #[test]
    fn upgrade_locked_column_exists_and_defaults_to_false() {
        let conn = create_test_db_for_tests();
        // Default plugin is created by migrations; verify upgrade_locked defaults to 0.
        let plugins = list_plugins(&conn).expect("list_plugins should succeed");
        assert!(
            !plugins.is_empty(),
            "at least the default plugin should exist"
        );
        for p in &plugins {
            assert!(
                !p.upgrade_locked,
                "upgrade_locked should default to false for plugin '{}'",
                p.slug
            );
        }
    }

    #[test]
    fn set_plugin_upgrade_locked_toggles_flag() {
        let conn = create_test_db_for_tests();
        ensure_plugin(
            &conn,
            "test-pkg",
            "Test Pkg",
            "marketplace",
            Some("https://example.com/pkg"),
            None,
            false,
        )
        .expect("ensure_plugin");

        // Lock it
        set_plugin_upgrade_locked(&conn, "test-pkg", true).expect("set locked");
        let plugins = list_plugins(&conn).expect("list_plugins");
        let p = plugins
            .iter()
            .find(|p| p.slug == "test-pkg")
            .expect("plugin exists");
        assert!(
            p.upgrade_locked,
            "upgrade_locked should be true after locking"
        );

        // Unlock it
        set_plugin_upgrade_locked(&conn, "test-pkg", false).expect("set unlocked");
        let plugins = list_plugins(&conn).expect("list_plugins");
        let p = plugins
            .iter()
            .find(|p| p.slug == "test-pkg")
            .expect("plugin exists");
        assert!(
            !p.upgrade_locked,
            "upgrade_locked should be false after unlocking"
        );
    }

    #[test]
    fn lock_plugin_for_skill_locks_marketplace_plugin() {
        let conn = create_test_db_for_tests();
        // Create a marketplace plugin and a skill in it.
        ensure_plugin(
            &conn,
            "mkt-pkg",
            "Mkt Pkg",
            "marketplace",
            Some("https://example.com/mkt"),
            None,
            false,
        )
        .expect("ensure_plugin");
        upsert_skill_in_plugin(&conn, "mkt-skill", "marketplace", "domain", "mkt-pkg")
            .expect("upsert skill");

        lock_plugin_for_skill(&conn, "mkt-skill").expect("lock_plugin_for_skill");

        let plugins = list_plugins(&conn).expect("list_plugins");
        let p = plugins
            .iter()
            .find(|p| p.slug == "mkt-pkg")
            .expect("plugin exists");
        assert!(
            p.upgrade_locked,
            "marketplace plugin should be locked after editing a skill"
        );
    }

    #[test]
    fn lock_plugin_for_skill_no_op_for_non_marketplace_plugin() {
        let conn = create_test_db_for_tests();
        // The default plugin is source_type = 'synthetic', not 'marketplace'.
        upsert_skill(&conn, "builder-skill", "skill-builder", "domain").expect("upsert skill");

        lock_plugin_for_skill(&conn, "builder-skill").expect("lock_plugin_for_skill");

        let plugins = list_plugins(&conn).expect("list_plugins");
        let default_plugin = plugins
            .iter()
            .find(|p| p.is_default)
            .expect("default plugin exists");
        assert!(
            !default_plugin.upgrade_locked,
            "non-marketplace plugin must not be locked"
        );
    }

    #[test]
    fn get_skill_master_id_any_plugin_finds_imported_skill() {
        let conn = create_test_db_for_tests();
        ensure_plugin(
            &conn,
            "ext-plugin",
            "Ext Plugin",
            "marketplace",
            Some("https://example.com/ext"),
            None,
            false,
        )
        .expect("ensure_plugin");
        upsert_skill_in_plugin(&conn, "ext-skill", "marketplace", "domain", "ext-plugin")
            .expect("upsert skill");

        // get_skill_master_id (default-plugin-only) should NOT find it
        let default_id = get_skill_master_id(&conn, "ext-skill").expect("query ok");
        assert!(
            default_id.is_none(),
            "default-plugin lookup must not find skills in other plugins"
        );

        // get_skill_master_id_any_plugin SHOULD find it
        let any_id = get_skill_master_id_any_plugin(&conn, "ext-skill").expect("query ok");
        assert!(
            any_id.is_some(),
            "any-plugin lookup must find skills in non-default plugins"
        );
    }

    #[test]
    fn plugin_aware_operations_work_for_non_default_plugin() {
        let conn = create_test_db_for_tests();
        // Create a non-default plugin and a skill in it.
        ensure_plugin(
            &conn,
            "mkt-ops",
            "Mkt Ops",
            "marketplace",
            Some("https://example.com/mkt"),
            None,
            false,
        )
        .expect("ensure_plugin");
        upsert_skill_in_plugin(&conn, "mkt-op-skill", "marketplace", "domain", "mkt-ops")
            .expect("upsert skill");

        // set_skill_tags with explicit plugin_slug should succeed
        set_skill_tags(
            &conn,
            "mkt-op-skill",
            "mkt-ops",
            &["tag-a".into(), "tag-b".into()],
        )
        .expect("set_skill_tags for non-default plugin");
        let tags = get_tags_for_skills(&conn, &vec!["mkt-op-skill".to_string()]).expect("get_tags");
        assert_eq!(tags.get("mkt-op-skill").map(|v| v.len()), Some(2));

        // get_skill_master_id_in_plugin should find it
        let id = get_skill_master_id_in_plugin(&conn, "mkt-op-skill", "mkt-ops").expect("query ok");
        assert!(id.is_some(), "in-plugin lookup must find the skill");

        // default-plugin lookup must NOT find it
        let default_id = get_skill_master_id(&conn, "mkt-op-skill").expect("query ok");
        assert!(
            default_id.is_none(),
            "default lookup must not find non-default plugin skills"
        );
    }

    #[test]
    fn move_skill_to_plugin_returns_err_on_wrong_from_plugin() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let (_, target_slug) = create_plugin(&conn, "target-plugin", "local", None, None).unwrap();
        upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();

        // 'my-skill' is in the default plugin, but we claim it's in 'target-plugin'
        let result = move_skill_to_plugin(
            &conn,
            "my-skill",
            &target_slug,
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        );
        assert!(
            result.is_err(),
            "must return Err when from_plugin_slug is wrong"
        );
        let msg = result.unwrap_err();
        assert!(
            msg.contains("0 rows affected"),
            "error should mention 0 rows affected, got: {}",
            msg
        );
    }

    #[test]
    fn move_skill_to_plugin_succeeds_and_join_reflects_new_plugin() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let (_, target_slug) = create_plugin(&conn, "target-plugin", "local", None, None).unwrap();
        upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();

        move_skill_to_plugin(
            &conn,
            "my-skill",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
            &target_slug,
        )
        .expect("move should succeed");

        // The JOIN-derived plugin_slug in get_skill_master_in_plugin should reflect the new plugin
        let master = get_skill_master_in_plugin(&conn, "my-skill", &target_slug)
            .expect("query ok")
            .expect("skill should exist in target plugin");
        assert_eq!(master.plugin_slug, target_slug);
    }

    #[test]
    fn set_skill_behaviour_in_plugin_only_updates_target_plugin_row() {
        let conn = create_test_db_for_tests();
        ensure_default_plugin(&conn).unwrap();
        let (_, target_slug) = create_plugin(&conn, "target-plugin", "local", None, None).unwrap();
        upsert_skill(&conn, "my-skill", "skill-builder", "domain").unwrap();
        upsert_skill_in_plugin(&conn, "my-skill", "marketplace", "domain", &target_slug).unwrap();

        set_skill_behaviour(&conn, "my-skill", Some("default description"), None, None, None, None, None)
            .unwrap();
        set_skill_behaviour_in_plugin(
            &conn,
            "my-skill",
            &target_slug,
            Some("target description"),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();

        let default_skill = get_skill_master_in_plugin(&conn, "my-skill", crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap();
        let target_skill = get_skill_master_in_plugin(&conn, "my-skill", &target_slug)
            .unwrap()
            .unwrap();

        assert_eq!(default_skill.description.as_deref(), Some("default description"));
        assert_eq!(target_skill.description.as_deref(), Some("target description"));
    }
}
