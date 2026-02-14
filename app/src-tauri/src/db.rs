use crate::types::{
    AppSettings, ImportedSkill, WorkflowRunRow,
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
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    conn.pragma_update(None, "busy_timeout", "5000")
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    run_migrations(&conn)?;
    run_add_skill_type_migration(&conn)?;
    run_lock_table_migration(&conn)?;
    run_author_migration(&conn)?;
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

fn run_lock_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_locks (
            skill_name TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )
}

fn run_author_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_author = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == "author_login"))
        })
        .unwrap_or(false);
    if !has_author {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN author_login TEXT;
             ALTER TABLE workflow_runs ADD COLUMN author_avatar TEXT;",
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

pub fn set_skill_author(
    conn: &Connection,
    skill_name: &str,
    author_login: &str,
    author_avatar: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET author_login = ?2, author_avatar = ?3 WHERE skill_name = ?1",
        rusqlite::params![skill_name, author_login, author_avatar],
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
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar
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
            author_login: row.get(7)?,
            author_avatar: row.get(8)?,
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
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar
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
                author_login: row.get(7)?,
                author_avatar: row.get(8)?,
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

// --- Skill Locks ---

pub fn acquire_skill_lock(
    conn: &Connection,
    skill_name: &str,
    instance_id: &str,
    pid: u32,
) -> Result<(), String> {
    // Use BEGIN IMMEDIATE to prevent race conditions between instances
    // both detecting a dead lock and trying to reclaim it simultaneously.
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        if let Some(existing) = get_skill_lock(conn, skill_name)? {
            if existing.instance_id == instance_id {
                return Ok(()); // Already locked by us
            }
            if !check_pid_alive(existing.pid) {
                // Dead process — reclaim
                conn.execute(
                    "DELETE FROM skill_locks WHERE skill_name = ?1",
                    [skill_name],
                )
                .map_err(|e| e.to_string())?;
            } else {
                return Err(format!(
                    "Skill '{}' is being edited in another instance",
                    skill_name
                ));
            }
        }

        conn.execute(
            "INSERT INTO skill_locks (skill_name, instance_id, pid) VALUES (?1, ?2, ?3)",
            rusqlite::params![skill_name, instance_id, pid as i64],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                format!(
                    "Skill '{}' is being edited in another instance",
                    skill_name
                )
            } else {
                e.to_string()
            }
        })?;
        Ok(())
    })();

    if result.is_ok() {
        conn.execute_batch("COMMIT").map_err(|e| e.to_string())?;
    } else {
        let _ = conn.execute_batch("ROLLBACK");
    }
    result
}

pub fn release_skill_lock(
    conn: &Connection,
    skill_name: &str,
    instance_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM skill_locks WHERE skill_name = ?1 AND instance_id = ?2",
        [skill_name, instance_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn release_all_instance_locks(
    conn: &Connection,
    instance_id: &str,
) -> Result<u32, String> {
    let count = conn
        .execute(
            "DELETE FROM skill_locks WHERE instance_id = ?1",
            [instance_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

pub fn get_skill_lock(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<crate::types::SkillLock>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, instance_id, pid, acquired_at FROM skill_locks WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row([skill_name], |row| {
        Ok(crate::types::SkillLock {
            skill_name: row.get(0)?,
            instance_id: row.get(1)?,
            pid: row.get::<_, i64>(2)? as u32,
            acquired_at: row.get(3)?,
        })
    });

    match result {
        Ok(lock) => Ok(Some(lock)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn get_all_skill_locks(
    conn: &Connection,
) -> Result<Vec<crate::types::SkillLock>, String> {
    let mut stmt = conn
        .prepare("SELECT skill_name, instance_id, pid, acquired_at FROM skill_locks")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(crate::types::SkillLock {
                skill_name: row.get(0)?,
                instance_id: row.get(1)?,
                pid: row.get::<_, i64>(2)? as u32,
                acquired_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn reclaim_dead_locks(conn: &Connection) -> Result<u32, String> {
    let locks = get_all_skill_locks(conn)?;
    let mut reclaimed = 0u32;
    for lock in locks {
        if !check_pid_alive(lock.pid) {
            conn.execute(
                "DELETE FROM skill_locks WHERE skill_name = ?1",
                [&lock.skill_name],
            )
            .map_err(|e| e.to_string())?;
            reclaimed += 1;
        }
    }
    Ok(reclaimed)
}

#[cfg(unix)]
pub fn check_pid_alive(pid: u32) -> bool {
    use nix::sys::signal::kill;
    use nix::unistd::Pid;
    // Signal 0 checks if process exists without sending a signal
    kill(Pid::from_raw(pid as i32), None).is_ok()
}

#[cfg(not(unix))]
pub fn check_pid_alive(pid: u32) -> bool {
    use std::process::Command;
    // tasklist /FI "PID eq N" /NH outputs "INFO: No tasks are running..."
    // when the PID doesn't exist, or a process row when it does.
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {}", pid), "/NH"])
        .output()
        .map(|out| {
            let stdout = String::from_utf8_lossy(&out.stdout);
            let trimmed = stdout.trim();
            !trimmed.is_empty() && !trimmed.contains("No tasks")
        })
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();
        run_lock_table_migration(&conn).unwrap();
        run_author_migration(&conn).unwrap();
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
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
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
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
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
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
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
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
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
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
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
    fn test_set_skill_author() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();

        // Set author with avatar
        set_skill_author(&conn, "test-skill", "testuser", Some("https://avatars.example.com/u/123")).unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(run.author_login.as_deref(), Some("testuser"));
        assert_eq!(run.author_avatar.as_deref(), Some("https://avatars.example.com/u/123"));
    }

    #[test]
    fn test_set_skill_author_without_avatar() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();

        // Set author without avatar
        set_skill_author(&conn, "test-skill", "testuser", None).unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(run.author_login.as_deref(), Some("testuser"));
        assert!(run.author_avatar.is_none());
    }

    #[test]
    fn test_workflow_run_default_no_author() {
        let conn = create_test_db();
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();
        let run = get_workflow_run(&conn, "test-skill").unwrap().unwrap();
        assert!(run.author_login.is_none());
        assert!(run.author_avatar.is_none());
    }

    #[test]
    fn test_author_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();
        run_lock_table_migration(&conn).unwrap();
        run_author_migration(&conn).unwrap();
        // Running again should not error
        run_author_migration(&conn).unwrap();
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
        run_author_migration(&conn).unwrap();

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

    // --- WAL and busy_timeout tests ---

    #[test]
    fn test_wal_mode_enabled() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "journal_mode", "WAL").unwrap();
        let mode: String =
            conn.pragma_query_value(None, "journal_mode", |row| row.get(0)).unwrap();
        // In-memory DBs use "memory" journal mode, but the pragma still succeeds
        assert!(mode == "wal" || mode == "memory");
    }

    #[test]
    fn test_busy_timeout_set() {
        let conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "busy_timeout", "5000").unwrap();
        let timeout: i64 =
            conn.pragma_query_value(None, "busy_timeout", |row| row.get(0)).unwrap();
        assert_eq!(timeout, 5000);
    }

    // --- Skill Lock tests ---

    #[test]
    fn test_acquire_and_release_lock() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
        let lock = get_skill_lock(&conn, "test-skill").unwrap().unwrap();
        assert_eq!(lock.skill_name, "test-skill");
        assert_eq!(lock.instance_id, "inst-1");
        assert_eq!(lock.pid, 12345);

        release_skill_lock(&conn, "test-skill", "inst-1").unwrap();
        assert!(get_skill_lock(&conn, "test-skill").unwrap().is_none());
    }

    #[test]
    fn test_acquire_lock_conflict() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        // Use the current PID so the lock appears "live"
        let pid = std::process::id();
        acquire_skill_lock(&conn, "test-skill", "inst-1", pid).unwrap();
        let result = acquire_skill_lock(&conn, "test-skill", "inst-2", pid);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("being edited"));
    }

    #[test]
    fn test_acquire_lock_idempotent_same_instance() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
        // Acquiring again from the same instance should succeed
        acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
    }

    #[test]
    fn test_release_all_instance_locks() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        acquire_skill_lock(&conn, "skill-a", "inst-1", 12345).unwrap();
        acquire_skill_lock(&conn, "skill-b", "inst-1", 12345).unwrap();
        acquire_skill_lock(&conn, "skill-c", "inst-2", 67890).unwrap();

        let count = release_all_instance_locks(&conn, "inst-1").unwrap();
        assert_eq!(count, 2);

        // inst-2's lock should remain
        assert!(get_skill_lock(&conn, "skill-c").unwrap().is_some());
        assert!(get_skill_lock(&conn, "skill-a").unwrap().is_none());
    }

    #[test]
    fn test_get_all_skill_locks() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        acquire_skill_lock(&conn, "skill-a", "inst-1", 12345).unwrap();
        acquire_skill_lock(&conn, "skill-b", "inst-2", 67890).unwrap();

        let locks = get_all_skill_locks(&conn).unwrap();
        assert_eq!(locks.len(), 2);
    }

    #[test]
    fn test_check_pid_alive_current_process() {
        let pid = std::process::id();
        assert!(check_pid_alive(pid));
    }

    #[test]
    fn test_check_pid_alive_dead_process() {
        // PID 99999999 almost certainly doesn't exist
        assert!(!check_pid_alive(99999999));
    }
}
