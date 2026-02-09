use crate::types::{
    AgentRunRow, AppSettings, ArtifactRow, ChatMessageRow, ChatSessionRow, WorkflowRunRow,
    WorkflowStepRow,
};
use rusqlite::Connection;
use std::fs;
use std::sync::Mutex;

pub struct Db(pub Mutex<Connection>);

pub fn init_db(app: &tauri::App) -> Result<Db, Box<dyn std::error::Error>> {
    use tauri::Manager;
    let app_dir = app.path().app_data_dir()?;
    fs::create_dir_all(&app_dir)?;
    let conn = Connection::open(app_dir.join("skill-builder.db"))?;
    run_migrations(&conn)?;
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
        );",
    )
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
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(skill_name) DO UPDATE SET
             domain = ?2, current_step = ?3, status = ?4, updated_at = datetime('now')",
        rusqlite::params![skill_name, domain, current_step, status],
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
            "SELECT skill_name, domain, current_step, status, created_at, updated_at
             FROM workflow_runs WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(WorkflowRunRow {
            skill_name: row.get(0)?,
            domain: row.get(1)?,
            current_step: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    });

    match result {
        Ok(run) => Ok(Some(run)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
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

// --- Agent Runs ---

pub fn save_agent_run(conn: &Connection, run: &AgentRunRow) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO agent_runs
         (agent_id, skill_name, step_id, model, status, input_tokens, output_tokens, total_cost, session_id, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        rusqlite::params![
            run.agent_id,
            run.skill_name,
            run.step_id,
            run.model,
            run.status,
            run.input_tokens,
            run.output_tokens,
            run.total_cost,
            run.session_id,
            run.started_at,
            run.completed_at
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_agent_runs(conn: &Connection, skill_name: &str) -> Result<Vec<AgentRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status, input_tokens, output_tokens,
                    total_cost, session_id, started_at, completed_at
             FROM agent_runs WHERE skill_name = ?1 ORDER BY started_at",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![skill_name], |row| {
            Ok(AgentRunRow {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                total_cost: row.get(7)?,
                session_id: row.get(8)?,
                started_at: row.get(9)?,
                completed_at: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
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

// --- Chat Sessions ---

pub fn create_chat_session_row(
    conn: &Connection,
    id: &str,
    skill_name: &str,
    mode: &str,
) -> Result<ChatSessionRow, String> {
    conn.execute(
        "INSERT INTO chat_sessions (id, skill_name, mode) VALUES (?1, ?2, ?3)",
        rusqlite::params![id, skill_name, mode],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, skill_name, mode, created_at, updated_at
             FROM chat_sessions WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(rusqlite::params![id], |row| {
        Ok(ChatSessionRow {
            id: row.get(0)?,
            skill_name: row.get(1)?,
            mode: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())
}

pub fn get_chat_sessions(
    conn: &Connection,
    skill_name: &str,
) -> Result<Vec<ChatSessionRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, skill_name, mode, created_at, updated_at
             FROM chat_sessions WHERE skill_name = ?1 ORDER BY updated_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![skill_name], |row| {
            Ok(ChatSessionRow {
                id: row.get(0)?,
                skill_name: row.get(1)?,
                mode: row.get(2)?,
                created_at: row.get(3)?,
                updated_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn add_chat_message_row(
    conn: &Connection,
    id: &str,
    session_id: &str,
    role: &str,
    content: &str,
) -> Result<ChatMessageRow, String> {
    conn.execute(
        "INSERT INTO chat_messages (id, session_id, role, content) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![id, session_id, role, content],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?1",
        rusqlite::params![session_id],
    )
    .map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, created_at
             FROM chat_messages WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_row(rusqlite::params![id], |row| {
        Ok(ChatMessageRow {
            id: row.get(0)?,
            session_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    })
    .map_err(|e| e.to_string())
}

pub fn get_chat_messages(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ChatMessageRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, role, content, created_at
             FROM chat_messages WHERE session_id = ?1 ORDER BY created_at",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(ChatMessageRow {
                id: row.get(0)?,
                session_id: row.get(1)?,
                role: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
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
            preferred_model: Some("sonnet".to_string()),
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
    fn test_overwrite_settings() {
        let conn = create_test_db();
        let v1 = AppSettings {
            anthropic_api_key: Some("key-1".to_string()),
            workspace_path: None,
            preferred_model: None,
        };
        write_settings(&conn, &v1).unwrap();

        let v2 = AppSettings {
            anthropic_api_key: Some("key-2".to_string()),
            workspace_path: Some("/new/path".to_string()),
            preferred_model: Some("opus".to_string()),
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
        save_workflow_run(&conn, "test-skill", "test domain", 3, "in_progress").unwrap();
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
        save_workflow_run(&conn, "test-skill", "domain1", 0, "pending").unwrap();
        save_workflow_run(&conn, "test-skill", "domain1", 5, "in_progress").unwrap();
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
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending").unwrap();
        save_workflow_step(&conn, "test-skill", 0, "completed").unwrap();
        delete_workflow_run(&conn, "test-skill").unwrap();
        assert!(get_workflow_run(&conn, "test-skill").unwrap().is_none());
        assert!(get_workflow_steps(&conn, "test-skill").unwrap().is_empty());
    }

    #[test]
    fn test_chat_session_crud() {
        let conn = create_test_db();
        let session =
            create_chat_session_row(&conn, "sess-1", "test-skill", "conversational").unwrap();
        assert_eq!(session.id, "sess-1");
        assert_eq!(session.skill_name, "test-skill");
        assert_eq!(session.mode, "conversational");

        let sessions = get_chat_sessions(&conn, "test-skill").unwrap();
        assert_eq!(sessions.len(), 1);
    }

    #[test]
    fn test_chat_messages_crud() {
        let conn = create_test_db();
        create_chat_session_row(&conn, "sess-1", "test-skill", "conversational").unwrap();

        add_chat_message_row(&conn, "msg-1", "sess-1", "user", "Hello").unwrap();
        add_chat_message_row(&conn, "msg-2", "sess-1", "assistant", "Hi there!").unwrap();

        let messages = get_chat_messages(&conn, "sess-1").unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0].role, "user");
        assert_eq!(messages[0].content, "Hello");
        assert_eq!(messages[1].role, "assistant");
    }

    #[test]
    fn test_agent_run_crud() {
        let conn = create_test_db();
        let run = AgentRunRow {
            agent_id: "agent-1".to_string(),
            skill_name: "test-skill".to_string(),
            step_id: 0,
            model: "sonnet".to_string(),
            status: "completed".to_string(),
            input_tokens: Some(1000),
            output_tokens: Some(500),
            total_cost: Some(0.05),
            session_id: None,
            started_at: "2024-01-01T00:00:00Z".to_string(),
            completed_at: Some("2024-01-01T00:01:00Z".to_string()),
        };
        save_agent_run(&conn, &run).unwrap();

        let runs = get_agent_runs(&conn, "test-skill").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].agent_id, "agent-1");
        assert_eq!(runs[0].input_tokens, Some(1000));
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
        save_workflow_run(&conn, "my-skill", "domain", 0, "pending").unwrap();
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
}
