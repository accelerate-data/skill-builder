use crate::types::{
    AppSettings, ArtifactRow, ImportedSkill, WorkflowRunRow,
    WorkflowStepRow,
};
use rusqlite::Connection;
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn init_db(app: &tauri::App) -> Result<Db, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_dir)?;
    let conn = Connection::open(app_dir.join("skill-builder.db"))?;
    run_migrations(&conn)?;
    run_add_skill_type_migration(&conn)?;
    Ok(Db(Mutex::new(conn)))
}

fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS workflow_runs (
            skill_name TEXT PRIMARY KEY,
            domain TEXT NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workflow_steps (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT,
            completed_at TEXT,
            PRIMARY KEY (skill_name, step_id)
        );

        CREATE TABLE IF NOT EXISTS agent_runs (
            agent_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            input_tokens INTEGER,
            output_tokens INTEGER,
            total_cost REAL,
            session_id TEXT,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS chat_sessions (
            id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'conversational',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );

        CREATE TABLE IF NOT EXISTS workflow_artifacts (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            content TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_name, step_id, relative_path)
        );

        CREATE TABLE IF NOT EXISTS skill_tags (
            skill_name TEXT NOT NULL,
            tag TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            PRIMARY KEY (skill_name, tag)
        );

        CREATE TABLE IF NOT EXISTS imported_skills (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT UNIQUE NOT NULL,
            domain TEXT,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT DEFAULT (datetime('now'))
        );",
    )
}

fn run_add_skill_type_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_skill_type = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == "skill_type"))
        })
        .unwrap_or(false);

    if !has_skill_type {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN skill_type TEXT DEFAULT 'domain';",
        )?;
        // Backfill existing rows that may have NULL from the ALTER TABLE
        conn.execute_batch(
            "UPDATE workflow_runs SET skill_type = 'domain' WHERE skill_type IS NULL;",
        )?;
    }
    Ok(())
}

pub fn read_settings(conn: &Connection) -> Result<AppSettings, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM settings WHERE key = ?1")
        .map_err(|e| e.to_string())?;

    let result: Result<String, _> = stmt.query_row(["app_settings"], |row| row.get(0));

    match result {
        Ok(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(AppSettings::default()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write_settings(conn: &Connection, settings: &AppSettings) -> Result<(), String> {
    let json = serde_json::to_string(settings).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        ["app_settings", &json],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Workflow Run ---

pub fn save_workflow_run(
    conn: &Connection,
    skill_name: &str,
    domain: &str,
    current_step: i32,
    status: &str,
    skill_type: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'))
         ON CONFLICT(skill_name) DO UPDATE SET
             domain = ?2, current_step = ?3, status = ?4, skill_type = ?5, updated_at = datetime('now')",
        rusqlite::params![skill_name, domain, current_step, status, skill_type],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_run(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at
             FROM workflow_runs WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(WorkflowRunRow {
            skill_name: row.get(0)?,
            domain: row.get(1)?,
            current_step: row.get(2)?,
            status: row.get(3)?,
            skill_type: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    });

    match result {
        Ok(run) => Ok(Some(run)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_skill_type(conn: &Connection, skill_name: &str) -> Result<String, String> {
    get_workflow_run(conn, skill_name).map(|opt| {
        opt.map(|run| run.skill_type)
            .unwrap_or_else(|| "domain".to_string())
    })
}

pub fn list_all_workflow_runs(conn: &Connection) -> Result<Vec<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at
             FROM workflow_runs ORDER BY skill_name",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(WorkflowRunRow {
                skill_name: row.get(0)?,
                domain: row.get(1)?,
                current_step: row.get(2)?,
                status: row.get(3)?,
                skill_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_workflow_run(conn: &Connection, skill_name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workflow_runs WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM workflow_steps WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM agent_runs WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM skill_tags WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    delete_all_artifacts(conn, skill_name)?;
    Ok(())
}

// --- Workflow Steps ---

pub fn save_workflow_step(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
    status: &str,
) -> Result<(), String> {
    let now = chrono::Utc::now().to_rfc3339();
    let (started, completed) = match status {
        "in_progress" => (Some(now.clone()), None),
        "completed" => (None, Some(now)),
        _ => (None, None),
    };

    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(skill_name, step_id) DO UPDATE SET
             status = ?3,
             started_at = COALESCE(?4, started_at),
             completed_at = ?5",
        rusqlite::params![skill_name, step_id, status, started, completed],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_steps(
    conn: &Connection,
    skill_name: &str,
) -> Result<Vec<WorkflowStepRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, step_id, status, started_at, completed_at
             FROM workflow_steps WHERE skill_name = ?1 ORDER BY step_id",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![skill_name], |row| {
            Ok(WorkflowStepRow {
                skill_name: row.get(0)?,
                step_id: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn reset_workflow_steps_from(
    conn: &Connection,
    skill_name: &str,
    from_step: i32,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_steps SET status = 'pending', started_at = NULL, completed_at = NULL
         WHERE skill_name = ?1 AND step_id >= ?2",
        rusqlite::params![skill_name, from_step],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

// --- Workflow Artifacts ---

pub fn save_artifact(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
    relative_path: &str,
    content: &str,
) -> Result<(), String> {
    let size_bytes = content.len() as i64;
    conn.execute(
        "INSERT INTO workflow_artifacts
         (skill_name, step_id, relative_path, content, size_bytes, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now'), datetime('now'))
         ON CONFLICT(skill_name, step_id, relative_path) DO UPDATE SET
             content = ?4, size_bytes = ?5, updated_at = datetime('now')",
        rusqlite::params![skill_name, step_id, relative_path, content, size_bytes],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_skill_artifacts(
    conn: &Connection,
    skill_name: &str,
) -> Result<Vec<ArtifactRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, step_id, relative_path, content, size_bytes, created_at, updated_at
             FROM workflow_artifacts WHERE skill_name = ?1 ORDER BY step_id, relative_path",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![skill_name], |row| {
            Ok(ArtifactRow {
                skill_name: row.get(0)?,
                step_id: row.get(1)?,
                relative_path: row.get(2)?,
                content: row.get(3)?,
                size_bytes: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_artifact_by_path(
    conn: &Connection,
    skill_name: &str,
    relative_path: &str,
) -> Result<Option<ArtifactRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, step_id, relative_path, content, size_bytes, created_at, updated_at
             FROM workflow_artifacts WHERE skill_name = ?1 AND relative_path = ?2",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name, relative_path], |row| {
        Ok(ArtifactRow {
            skill_name: row.get(0)?,
            step_id: row.get(1)?,
            relative_path: row.get(2)?,
            content: row.get(3)?,
            size_bytes: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    });

    match result {
        Ok(artifact) => Ok(Some(artifact)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn delete_artifacts_from(
    conn: &Connection,
    skill_name: &str,
    from_step_id: i32,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE skill_name = ?1 AND step_id >= ?2",
        rusqlite::params![skill_name, from_step_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn delete_all_artifacts(conn: &Connection, skill_name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn has_artifacts(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
) -> Result<bool, String> {
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM workflow_artifacts WHERE skill_name = ?1 AND step_id = ?2",
            [skill_name, &step_id.to_string()],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    Ok(count > 0)
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
            let chunk_result = get_tags_for_skills(conn, &chunk.to_vec())?;
            map.extend(chunk_result);
        }
        return Ok(map);
    }

    let placeholders: Vec<String> = (1..=skill_names.len()).map(|i| format!("?{}", i)).collect();
    let sql = format!(
        "SELECT skill_name, tag FROM skill_tags WHERE skill_name IN ({}) ORDER BY skill_name, tag",
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
    tags: &[String],
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM skill_tags WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("INSERT OR IGNORE INTO skill_tags (skill_name, tag) VALUES (?1, ?2)")
        .map_err(|e| e.to_string())?;

    for tag in tags {
        let normalized = tag.trim().to_lowercase();
        if !normalized.is_empty() {
            stmt.execute(rusqlite::params![skill_name, normalized])
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

// --- Imported Skills ---

pub fn insert_imported_skill(
    conn: &Connection,
    skill: &ImportedSkill,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, domain, description, is_active, disk_path, imported_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.domain,
            skill.description,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
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

pub fn list_imported_skills(conn: &Connection) -> Result<Vec<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, domain, description, is_active, disk_path, imported_at
             FROM imported_skills ORDER BY imported_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportedSkill {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                domain: row.get(2)?,
                description: row.get(3)?,
                is_active: row.get::<_, i32>(4)? != 0,
                disk_path: row.get(5)?,
                imported_at: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn update_imported_skill_active(
    conn: &Connection,
    skill_name: &str,
    is_active: bool,
    new_disk_path: &str,
) -> Result<(), String> {
    let rows = conn
        .execute(
            "UPDATE imported_skills SET is_active = ?1, disk_path = ?2 WHERE skill_name = ?3",
            rusqlite::params![is_active as i32, new_disk_path, skill_name],
        )
        .map_err(|e| e.to_string())?;

    if rows == 0 {
        return Err(format!("Imported skill '{}' not found", skill_name));
    }
    Ok(())
}

pub fn delete_imported_skill(conn: &Connection, skill_name: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_imported_skill(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, domain, description, is_active, disk_path, imported_at
             FROM imported_skills WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            domain: row.get(2)?,
            description: row.get(3)?,
            is_active: row.get::<_, i32>(4)? != 0,
            disk_path: row.get(5)?,
            imported_at: row.get(6)?,
        })
    });

    match result {
        Ok(skill) => Ok(Some(skill)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();
        conn
    }

    #[test]
    fn test_read_default_settings() {
        let conn = create_test_db();
        let settings = read_settings(&conn).unwrap();
        assert!(settings.anthropic_api_key.is_none());
        assert!(settings.workspace_path.is_none());
    }

    #[test]
    fn test_write_and_read_settings() {
        let conn = create_test_db();
        let settings = AppSettings {
            anthropic_api_key: Some("sk-test-key".to_string()),
            workspace_path: Some("/home/user/skills".to_string()),
            skills_path: None,
            preferred_model: Some("sonnet".to_string()),
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_pat: None,
        };
        write_settings(&conn, &settings).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.anthropic_api_key.as_deref(), Some("sk-test-key"));
        assert_eq!(
            loaded.workspace_path.as_deref(),
            Some("/home/user/skills")
        );
    }

    #[test]
    fn test_write_and_read_settings_with_skills_path() {
        let conn = create_test_db();
        let settings = AppSettings {
            anthropic_api_key: Some("sk-test".to_string()),
            workspace_path: Some("/workspace".to_string()),
            skills_path: Some("/home/user/my-skills".to_string()),
            preferred_model: None,
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_pat: None,
        };
        write_settings(&conn, &settings).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.skills_path.as_deref(), Some("/home/user/my-skills"));
    }

    #[test]
    fn test_write_and_read_settings_with_debug_mode() {
        let conn = create_test_db();
        let settings = AppSettings {
            anthropic_api_key: None,
            workspace_path: None,
            skills_path: None,
            preferred_model: None,
            debug_mode: true,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_pat: None,
        };
        write_settings(&conn, &settings).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert!(loaded.debug_mode);
    }

    #[test]
    fn test_overwrite_settings() {
        let conn = create_test_db();
        let v1 = AppSettings {
            anthropic_api_key: Some("key-1".to_string()),
            workspace_path: None,
            skills_path: None,
            preferred_model: None,
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_pat: None,
        };
        write_settings(&conn, &v1).unwrap();

        let v2 = AppSettings {
            anthropic_api_key: Some("key-2".to_string()),
            workspace_path: Some("/new/path".to_string()),
            skills_path: None,
            preferred_model: Some("opus".to_string()),
            debug_mode: true,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_pat: None,
        };
        write_settings(&conn, &v2).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.anthropic_api_key.as_deref(), Some("key-2"));
        assert_eq!(loaded.workspace_path.as_deref(), Some("/new/path"));
    }

    #[test]
    fn test_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_migrations(&conn).unwrap();

        let settings = read_settings(&conn).unwrap();
        assert!(settings.anthropic_api_key.is_none());
    }

    #[test]
    fn test_workflow_run_crud() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "test domain", 3, "in_progress", "domain").unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(run.skill_name, "test-skill");
        assert_eq!(run.domain, "test domain");
        assert_eq!(run.current_step, 3);
        assert_eq!(run.status, "in_progress");
        let none = get_workflow_run(&conn, "nonexistent").unwrap();
        assert!(none.is_none());
    }

    #[test]
    fn test_workflow_run_upsert() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "domain1", 0, "pending", "domain").unwrap();
        save_workflow_run(&conn, "test-skill", "domain1", 5, "in_progress", "domain").unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(run.current_step, 5);
        assert_eq!(run.status, "in_progress");
    }

    #[test]
    fn test_workflow_steps_crud() {
        let conn = create_test_db();
        save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
        save_workflow_step(&conn, "test-skill", 1, "in_progress").unwrap();
        save_workflow_step(&conn, "test-skill", 2, "pending").unwrap();
        let steps = get_workflow_steps(&conn, "test-skill").unwrap();
        assert_eq!(steps.len(), 3);
        assert_eq!(steps[0].status, "completed");
        assert_eq!(steps[1].status, "in_progress");
        assert_eq!(steps[2].status, "pending");
    }

    #[test]
    fn test_workflow_steps_reset() {
        let conn = create_test_db();
        save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
        save_workflow_step(&conn, "test-skill", 1, "completed").unwrap();
        save_workflow_step(&conn, "test-skill", 2, "completed").unwrap();
        save_workflow_step(&conn, "test-skill", 3, "in_progress").unwrap();

        reset_workflow_steps_from(&conn, "test-skill", 2).unwrap();

        let steps = get_workflow_steps(&conn, "test-skill").unwrap();
        assert_eq!(steps[0].status, "completed");
        assert_eq!(steps[1].status, "completed");
        assert_eq!(steps[2].status, "pending");
        assert_eq!(steps[3].status, "pending");
    }

    #[test]
    fn test_delete_workflow_run() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();
        save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
        delete_workflow_run(&conn, "test-skill").unwrap();
        assert!(get_workflow_run(&conn, "test-skill").unwrap().is_none());
        assert!(get_workflow_steps(&conn, "test-skill").unwrap().is_empty());
    }

    // --- Workflow Artifacts tests ---

    #[test]
    fn test_save_and_get_artifact() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 0, "context/clarifications-concepts.md", "# Concepts\nSome content").unwrap();

        let artifacts = get_skill_artifacts(&conn, "my-skill").unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].skill_name, "my-skill");
        assert_eq!(artifacts[0].step_id, 0);
        assert_eq!(artifacts[0].relative_path, "context/clarifications-concepts.md");
        assert_eq!(artifacts[0].content, "# Concepts\nSome content");
        assert_eq!(artifacts[0].size_bytes, 23);
    }

    #[test]
    fn test_save_artifact_upsert() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 0, "context/test.md", "v1").unwrap();
        save_artifact(&conn, "my-skill", 0, "context/test.md", "v2 updated content").unwrap();

        let artifacts = get_skill_artifacts(&conn, "my-skill").unwrap();
        assert_eq!(artifacts.len(), 1);
        assert_eq!(artifacts[0].content, "v2 updated content");
        assert_eq!(artifacts[0].size_bytes, 18);
    }

    #[test]
    fn test_get_artifact_by_path() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 0, "context/concepts.md", "concepts").unwrap();
        save_artifact(&conn, "my-skill", 2, "context/patterns.md", "patterns").unwrap();

        let found = get_artifact_by_path(&conn, "my-skill", "context/concepts.md").unwrap();
        assert!(found.is_some());
        assert_eq!(found.unwrap().content, "concepts");

        let not_found = get_artifact_by_path(&conn, "my-skill", "nonexistent.md").unwrap();
        assert!(not_found.is_none());
    }

    #[test]
    fn test_delete_artifacts_from() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 0, "context/step0.md", "step 0").unwrap();
        save_artifact(&conn, "my-skill", 2, "context/step2.md", "step 2").unwrap();
        save_artifact(&conn, "my-skill", 3, "context/step3.md", "step 3").unwrap();
        save_artifact(&conn, "my-skill", 5, "context/step5.md", "step 5").unwrap();

        delete_artifacts_from(&conn, "my-skill", 3).unwrap();

        let artifacts = get_skill_artifacts(&conn, "my-skill").unwrap();
        assert_eq!(artifacts.len(), 2);
        assert_eq!(artifacts[0].step_id, 0);
        assert_eq!(artifacts[1].step_id, 2);
    }

    #[test]
    fn test_delete_all_artifacts() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 0, "context/a.md", "a").unwrap();
        save_artifact(&conn, "my-skill", 2, "context/b.md", "b").unwrap();
        save_artifact(&conn, "other-skill", 0, "context/c.md", "c").unwrap();

        delete_all_artifacts(&conn, "my-skill").unwrap();

        let my = get_skill_artifacts(&conn, "my-skill").unwrap();
        assert!(my.is_empty());

        let other = get_skill_artifacts(&conn, "other-skill").unwrap();
        assert_eq!(other.len(), 1);
    }

    #[test]
    fn test_delete_workflow_run_also_deletes_artifacts() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "domain", 0, "pending", "domain").unwrap();
        save_artifact(&conn, "my-skill", 0, "context/test.md", "content").unwrap();

        delete_workflow_run(&conn, "my-skill").unwrap();

        assert!(get_workflow_run(&conn, "my-skill").unwrap().is_none());
        assert!(get_skill_artifacts(&conn, "my-skill").unwrap().is_empty());
    }

    #[test]
    fn test_get_skill_artifacts_ordering() {
        let conn = create_test_db();
        save_artifact(&conn, "my-skill", 5, "context/decisions.md", "decisions").unwrap();
        save_artifact(&conn, "my-skill", 0, "context/concepts.md", "concepts").unwrap();
        save_artifact(&conn, "my-skill", 2, "context/patterns.md", "patterns").unwrap();
        save_artifact(&conn, "my-skill", 2, "context/data.md", "data").unwrap();

        let artifacts = get_skill_artifacts(&conn, "my-skill").unwrap();
        assert_eq!(artifacts.len(), 4);
        assert_eq!(artifacts[0].step_id, 0);
        assert_eq!(artifacts[1].step_id, 2);
        assert_eq!(artifacts[1].relative_path, "context/data.md");
        assert_eq!(artifacts[2].step_id, 2);
        assert_eq!(artifacts[2].relative_path, "context/patterns.md");
        assert_eq!(artifacts[3].step_id, 5);
    }

    // --- Skill Tags tests ---

    #[test]
    fn test_set_and_get_tags() {
        let conn = create_test_db();
        set_skill_tags(&conn, "my-skill", &["analytics".into(), "salesforce".into()]).unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["analytics", "salesforce"]);
    }

    #[test]
    fn test_tags_normalize_lowercase_trim() {
        let conn = create_test_db();
        set_skill_tags(
            &conn,
            "my-skill",
            &["  Analytics ".into(), "SALESFORCE".into(), "  ".into()],
        )
        .unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["analytics", "salesforce"]);
    }

    #[test]
    fn test_tags_deduplicate() {
        let conn = create_test_db();
        set_skill_tags(
            &conn,
            "my-skill",
            &["analytics".into(), "analytics".into(), "Analytics".into()],
        )
        .unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["analytics"]);
    }

    #[test]
    fn test_set_tags_replaces() {
        let conn = create_test_db();
        set_skill_tags(&conn, "my-skill", &["old-tag".into()]).unwrap();
        set_skill_tags(&conn, "my-skill", &["new-tag".into()]).unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["new-tag"]);
    }

    #[test]
    fn test_get_tags_for_skills_batch() {
        let conn = create_test_db();
        set_skill_tags(&conn, "skill-a", &["tag1".into(), "tag2".into()]).unwrap();
        set_skill_tags(&conn, "skill-b", &["tag2".into(), "tag3".into()]).unwrap();
        set_skill_tags(&conn, "skill-c", &["tag1".into()]).unwrap();

        let names = vec!["skill-a".into(), "skill-b".into(), "skill-c".into()];
        let map = get_tags_for_skills(&conn, &names).unwrap();
        assert_eq!(map.get("skill-a").unwrap(), &vec!["tag1", "tag2"]);
        assert_eq!(map.get("skill-b").unwrap(), &vec!["tag2", "tag3"]);
        assert_eq!(map.get("skill-c").unwrap(), &vec!["tag1"]);
    }

    #[test]
    fn test_get_all_tags() {
        let conn = create_test_db();
        set_skill_tags(&conn, "skill-a", &["beta".into(), "alpha".into()]).unwrap();
        set_skill_tags(&conn, "skill-b", &["beta".into(), "gamma".into()]).unwrap();

        let all = get_all_tags(&conn).unwrap();
        assert_eq!(all, vec!["alpha", "beta", "gamma"]);
    }

    #[test]
    fn test_delete_workflow_run_cascades_tags() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "domain", 0, "pending", "domain").unwrap();
        set_skill_tags(&conn, "my-skill", &["tag1".into(), "tag2".into()]).unwrap();

        delete_workflow_run(&conn, "my-skill").unwrap();

        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert!(tags.is_empty());
    }

    #[test]
    fn test_skill_type_migration() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();

        // Verify skill_type column exists by inserting a row with it
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "platform").unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(run.skill_type, "platform");
    }

    #[test]
    fn test_skill_type_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();
        // Running again should not error
        run_add_skill_type_migration(&conn).unwrap();
    }

    #[test]
    fn test_get_skill_type_default() {
        let conn = create_test_db();
        // No workflow run exists — should return "domain" default
        let skill_type = get_skill_type(&conn, "nonexistent-skill").unwrap();
        assert_eq!(skill_type, "domain");
    }

    #[test]
    fn test_get_skill_type_explicit() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "test", 0, "pending", "source").unwrap();
        let skill_type = get_skill_type(&conn, "my-skill").unwrap();
        assert_eq!(skill_type, "source");
    }

    #[test]
    fn test_list_all_workflow_runs_empty() {
        let conn = create_test_db();
        let runs = list_all_workflow_runs(&conn).unwrap();
        assert!(runs.is_empty());
    }

    #[test]
    fn test_list_all_workflow_runs_multiple() {
        let conn = create_test_db();
        save_workflow_run(&conn, "alpha-skill", "domain-a", 3, "in_progress", "domain").unwrap();
        save_workflow_run(&conn, "beta-skill", "domain-b", 0, "pending", "platform").unwrap();
        save_workflow_run(&conn, "gamma-skill", "domain-c", 7, "completed", "source").unwrap();

        let runs = list_all_workflow_runs(&conn).unwrap();
        assert_eq!(runs.len(), 3);
        // Ordered by skill_name
        assert_eq!(runs[0].skill_name, "alpha-skill");
        assert_eq!(runs[0].current_step, 3);
        assert_eq!(runs[1].skill_name, "beta-skill");
        assert_eq!(runs[1].skill_type, "platform");
        assert_eq!(runs[2].skill_name, "gamma-skill");
        assert_eq!(runs[2].status, "completed");
    }

    #[test]
    fn test_list_all_workflow_runs_after_delete() {
        let conn = create_test_db();
        save_workflow_run(&conn, "skill-a", "domain", 0, "pending", "domain").unwrap();
        save_workflow_run(&conn, "skill-b", "domain", 0, "pending", "domain").unwrap();

        delete_workflow_run(&conn, "skill-a").unwrap();

        let runs = list_all_workflow_runs(&conn).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].skill_name, "skill-b");
    }

    #[test]
    fn test_workflow_run_preserves_skill_type() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "test", 0, "pending", "data-engineering").unwrap();
        let run = get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.skill_type, "data-engineering");

        // Update step/status — skill_type should be preserved
        save_workflow_run(&conn, "my-skill", "test", 3, "in_progress", "data-engineering").unwrap();
        let run = get_workflow_run(&conn, "my-skill").unwrap().unwrap();
        assert_eq!(run.skill_type, "data-engineering");
        assert_eq!(run.current_step, 3);
    }
}
