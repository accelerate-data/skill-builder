use crate::types::ImportedSkill;
use rusqlite::Connection;
use std::fs;

use super::skills::get_skill_master_id;

// --- Imported Skills ---

/// Read SKILL.md frontmatter from disk and populate `description`
/// on an ImportedSkill struct. This field is not stored in the DB.
pub fn hydrate_skill_metadata(skill: &mut ImportedSkill) {
    let skill_md_path = std::path::Path::new(&skill.disk_path).join("SKILL.md");
    if let Ok(content) = fs::read_to_string(&skill_md_path) {
        let fm = crate::commands::imported_skills::parse_frontmatter_full(&content);
        skill.description = fm.description;
    }
}

#[allow(dead_code)]
pub fn insert_imported_skill(conn: &Connection, skill: &ImportedSkill) -> Result<(), String> {
    let skill_master_id = get_skill_master_id(conn, &skill.skill_name)?;
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
             purpose, version, model, argument_hint, user_invocable, disable_model_invocation, skill_master_id, marketplace_source_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
            skill.purpose,
            skill.version,
            skill.model,
            skill.argument_hint,
            skill.user_invocable.map(|v| v as i32),
            skill.disable_model_invocation.map(|v| v as i32),
            skill_master_id,
            skill.marketplace_source_url,
        ],
    )
    .map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            format!("Skill '{}' has already been imported", skill.skill_name)
        } else {
            e.to_string()
        }
    })?;
    Ok(())
}

/// Upsert a marketplace-imported skill. Uses `INSERT OR REPLACE` so that re-importing
/// (e.g. after the skills_path setting changed or files were manually deleted) always
/// updates the existing record rather than failing with a UNIQUE constraint.
/// Also mirrors frontmatter fields to the `skills` master table (canonical store).
pub fn upsert_imported_skill(conn: &Connection, skill: &ImportedSkill) -> Result<(), String> {
    let skill_master_id = get_skill_master_id(conn, &skill.skill_name)?;
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
             purpose, version, model, argument_hint, user_invocable, disable_model_invocation, skill_master_id, marketplace_source_url)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(skill_name) DO UPDATE SET
             skill_id = excluded.skill_id,
             disk_path = excluded.disk_path,
             imported_at = excluded.imported_at,
             purpose = excluded.purpose,
             version = excluded.version,
             model = excluded.model,
             argument_hint = excluded.argument_hint,
             user_invocable = excluded.user_invocable,
             disable_model_invocation = excluded.disable_model_invocation,
             skill_master_id = excluded.skill_master_id,
             marketplace_source_url = excluded.marketplace_source_url",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
            skill.purpose,
            skill.version,
            skill.model,
            skill.argument_hint,
            skill.user_invocable.map(|v| v as i32),
            skill.disable_model_invocation.map(|v| v as i32),
            skill_master_id,
            skill.marketplace_source_url,
        ],
    )
    .map_err(|e| e.to_string())?;

    // Mirror frontmatter fields to skills master — these values are the merged result
    // (new frontmatter wins if non-empty, installed value as fallback) so we overwrite directly.
    conn.execute(
        "UPDATE skills SET
            version = ?2,
            model = ?3,
            argument_hint = ?4,
            user_invocable = ?5,
            disable_model_invocation = ?6,
            updated_at = datetime('now')
         WHERE name = ?1",
        rusqlite::params![
            skill.skill_name,
            skill.version,
            skill.model,
            skill.argument_hint,
            skill.user_invocable.map(|v| v as i32),
            skill.disable_model_invocation.map(|v| v as i32),
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[allow(dead_code)]
pub fn update_imported_skill_active(
    conn: &Connection,
    skill_name: &str,
    is_active: bool,
    new_disk_path: &str,
) -> Result<(), String> {
    let s_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found in skills master", skill_name))?;

    let rows = conn
        .execute(
            "UPDATE imported_skills SET is_active = ?1, disk_path = ?2 WHERE skill_master_id = ?3",
            rusqlite::params![is_active as i32, new_disk_path, s_id],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err(format!("Imported skill '{}' not found", skill_name));
    }
    Ok(())
}

#[allow(dead_code)]
pub fn delete_imported_skill(conn: &Connection, skill_name: &str) -> Result<(), String> {
    let s_id = match get_skill_master_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(()), // Skill not in library — nothing to delete
    };
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_master_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_imported_skill_by_name(conn: &Connection, name: &str) -> Result<(), String> {
    log::debug!("delete_imported_skill_by_name: name={}", name);
    let s_id = match get_skill_master_id(conn, name)? {
        Some(id) => id,
        None => return Ok(()), // Skill not in library — nothing to delete
    };
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_master_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| {
        log::error!(
            "delete_imported_skill_by_name: failed to delete '{}': {}",
            name,
            e
        );
        e.to_string()
    })?;
    Ok(())
}

pub fn get_imported_skill(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<ImportedSkill>, String> {
    let s_id = match get_skill_master_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(None),
    };

    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                    purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
             FROM imported_skills WHERE skill_master_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![s_id], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? != 0,
            disk_path: row.get(3)?,
            imported_at: row.get(4)?,
            is_bundled: row.get::<_, i32>(5)? != 0,
            description: None,
            purpose: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            marketplace_source_url: row.get(12)?,
        })
    });

    match result {
        Ok(mut skill) => {
            hydrate_skill_metadata(&mut skill);
            Ok(Some(skill))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[allow(dead_code)]
pub fn list_active_skills(conn: &Connection) -> Result<Vec<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                    purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
             FROM imported_skills
             WHERE is_active = 1
             ORDER BY skill_name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportedSkill {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                is_active: row.get::<_, i32>(2)? != 0,
                disk_path: row.get(3)?,
                imported_at: row.get(4)?,
                is_bundled: row.get::<_, i32>(5)? != 0,
                description: None,
                purpose: row.get(6)?,
                version: row.get(7)?,
                model: row.get(8)?,
                argument_hint: row.get(9)?,
                user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
                disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
                marketplace_source_url: row.get(12)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut skills: Vec<ImportedSkill> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for skill in &mut skills {
        hydrate_skill_metadata(skill);
    }

    Ok(skills)
}

/// List imported skills, optionally filtered by marketplace source URL.
pub fn list_imported_skills_filtered(
    conn: &Connection,
    source_url: Option<&str>,
) -> Result<Vec<ImportedSkill>, String> {
    let query = match source_url {
        Some(_) => {
            "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                    purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
             FROM imported_skills
             WHERE marketplace_source_url = ?1
             ORDER BY imported_at DESC"
        }
        None => {
            "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                    purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
             FROM imported_skills
             ORDER BY imported_at DESC"
        }
    };

    let mut stmt = conn.prepare(query).map_err(|e| format!("list_imported_skills_filtered: {}", e))?;

    let row_mapper = |row: &rusqlite::Row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? != 0,
            disk_path: row.get(3)?,
            imported_at: row.get(4)?,
            is_bundled: row.get::<_, i32>(5)? != 0,
            description: None,
            purpose: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            marketplace_source_url: row.get(12)?,
        })
    };

    let results = match source_url {
        Some(url) => stmt.query_map(rusqlite::params![url], row_mapper),
        None => stmt.query_map([], row_mapper),
    }
    .map_err(|e| format!("list_imported_skills_filtered query: {}", e))?;

    let mut skills: Vec<ImportedSkill> = results
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list_imported_skills_filtered collect: {}", e))?;

    for skill in &mut skills {
        hydrate_skill_metadata(skill);
    }

    Ok(skills)
}

/// Get an imported skill by its skill_id primary key.
pub fn get_imported_skill_by_id(
    conn: &Connection,
    skill_id: &str,
) -> Result<Option<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                    purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
             FROM imported_skills WHERE skill_id = ?1",
        )
        .map_err(|e| format!("get_imported_skill_by_id: {}", e))?;

    let result = stmt.query_row(rusqlite::params![skill_id], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? != 0,
            disk_path: row.get(3)?,
            imported_at: row.get(4)?,
            is_bundled: row.get::<_, i32>(5)? != 0,
            description: None,
            purpose: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            marketplace_source_url: row.get(12)?,
        })
    });

    match result {
        Ok(mut skill) => {
            hydrate_skill_metadata(&mut skill);
            Ok(Some(skill))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("get_imported_skill_by_id: {}", e)),
    }
}

/// Delete an imported skill by its skill_id primary key.
pub fn delete_imported_skill_by_skill_id(conn: &Connection, skill_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )
    .map_err(|e| format!("delete_imported_skill_by_skill_id: {}", e))?;
    Ok(())
}

/// Look up an active imported skill by its purpose tag.
/// Returns the first active skill with the given purpose, or None if not found.
pub fn get_imported_skill_by_purpose(
    conn: &Connection,
    purpose: &str,
) -> rusqlite::Result<Option<ImportedSkill>> {
    let mut stmt = conn.prepare(
        "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
         FROM imported_skills WHERE purpose = ?1 AND is_active = 1
         ORDER BY imported_at DESC, skill_name ASC LIMIT 1"
    )?;
    let result = stmt.query_row(rusqlite::params![purpose], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? != 0,
            disk_path: row.get(3)?,
            imported_at: row.get(4)?,
            is_bundled: row.get::<_, i32>(5)? != 0,
            description: None,
            purpose: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            marketplace_source_url: row.get(12)?,
        })
    });
    match result {
        Ok(mut skill) => {
            hydrate_skill_metadata(&mut skill);
            Ok(Some(skill))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

/// Update the content_hash for an imported skill row identified by skill_name.
pub fn set_imported_skill_content_hash(
    conn: &Connection,
    skill_name: &str,
    hash: &str,
) -> Result<(), String> {
    conn.execute(
        "UPDATE imported_skills SET content_hash = ?1 WHERE skill_name = ?2",
        rusqlite::params![hash, skill_name],
    )
    .map_err(|e| format!("set_imported_skill_content_hash: {}", e))?;
    Ok(())
}

/// Read disk_path and content_hash for an imported (marketplace/library) skill by name.
pub fn get_imported_skill_hash_info(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<(String, Option<String>)>, String> {
    let mut stmt = conn
        .prepare("SELECT disk_path, content_hash FROM imported_skills WHERE skill_name = ?1")
        .map_err(|e| format!("get_imported_skill_hash_info: {}", e))?;
    let mut rows = stmt
        .query_map(rusqlite::params![skill_name], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
        })
        .map_err(|e| format!("get_imported_skill_hash_info query: {}", e))?;
    match rows.next() {
        Some(row) => {
            Ok(Some(row.map_err(|e| {
                format!("get_imported_skill_hash_info row: {}", e)
            })?))
        }
        None => Ok(None),
    }
}

/// Look up an imported (library) skill by name and source registry URL.
/// Returns only skills that were imported from the specified registry (marketplace_source_url = source_url).
/// Used to avoid false-positive update notifications for bundled skills sharing a name with marketplace skills.
#[allow(dead_code)]
pub fn get_imported_skill_by_name_and_source(
    conn: &Connection,
    skill_name: &str,
    source_url: &str,
) -> Result<Option<ImportedSkill>, String> {
    let mut stmt = conn.prepare(
        "SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                purpose, version, model, argument_hint, user_invocable, disable_model_invocation, marketplace_source_url
         FROM imported_skills WHERE skill_name = ?1 AND marketplace_source_url = ?2"
    ).map_err(|e| format!("get_imported_skill_by_name_and_source: {}", e))?;

    let result = stmt.query_row(rusqlite::params![skill_name, source_url], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            is_active: row.get::<_, i32>(2)? != 0,
            disk_path: row.get(3)?,
            imported_at: row.get(4)?,
            is_bundled: row.get::<_, i32>(5)? != 0,
            description: None,
            purpose: row.get(6)?,
            version: row.get(7)?,
            model: row.get(8)?,
            argument_hint: row.get(9)?,
            user_invocable: row.get::<_, Option<i32>>(10)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            marketplace_source_url: row.get(12)?,
        })
    });

    match result {
        Ok(mut skill) => {
            hydrate_skill_metadata(&mut skill);
            Ok(Some(skill))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(format!("get_imported_skill_by_name_and_source: {}", e)),
    }
}

/// Return the names of all locally installed skills.
/// Combines workflow_runs (generated/marketplace skills) and imported_skills.
pub fn get_all_installed_skill_names(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name FROM workflow_runs
         UNION
         SELECT skill_name FROM imported_skills",
        )
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Return names of all skills in the skills master table.
/// Used by the skill-library (dashboard) path to check which skills are already installed.
pub fn get_dashboard_skill_names(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT name FROM skills WHERE COALESCE(deleted_at, '') = ''")
        .map_err(|e| e.to_string())?;
    let names = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

