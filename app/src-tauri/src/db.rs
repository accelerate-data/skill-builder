use crate::types::{
    AgentRunRecord, AppSettings, ImportedSkill, UsageByModel, UsageByStep, UsageSummary,
    WorkflowRunRow, WorkflowSessionRecord, WorkflowStepRow,
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

    ensure_migration_table(&conn)?;

    // Migration 0: base schema (always runs via CREATE TABLE IF NOT EXISTS)
    run_migrations(&conn)?;

    // Numbered migrations: each runs once, tracked in schema_migrations.
    // To add a new migration, append a (version, function) entry to this array.
    #[allow(clippy::type_complexity)]
    let migrations: &[(u32, fn(&Connection) -> Result<(), rusqlite::Error>)] = &[
        (1,  run_add_skill_type_migration),
        (2,  run_lock_table_migration),
        (3,  run_author_migration),
        (4,  run_usage_tracking_migration),
        (5,  run_workflow_session_migration),
        (6,  run_sessions_table_migration),
        (7,  run_trigger_text_migration),
        (8,  run_agent_stats_migration),
        (9,  run_intake_migration),
        (10, run_composite_pk_migration),
        (11, run_bundled_skill_migration),
        (12, run_drop_trigger_description_migration),
        (13, run_remove_validate_step_migration),
    ];

    for &(version, migrate_fn) in migrations {
        if !migration_applied(&conn, version) {
            migrate_fn(&conn)?;
            mark_migration_applied(&conn, version)?;
        }
    }

    Ok(Db(Mutex::new(conn)))
}

fn ensure_migration_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );"
    )
}

fn migration_applied(conn: &Connection, version: u32) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        rusqlite::params![version],
        |row| row.get::<_, i64>(0),
    ).unwrap_or(0) > 0
}

fn mark_migration_applied(conn: &Connection, version: u32) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
        rusqlite::params![version],
    ).map(|_| ())
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
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
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
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS workflow_artifacts (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            content TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            PRIMARY KEY (skill_name, step_id, relative_path)
        );

        CREATE TABLE IF NOT EXISTS skill_tags (
            skill_name TEXT NOT NULL,
            tag TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            PRIMARY KEY (skill_name, tag)
        );

        CREATE TABLE IF NOT EXISTS imported_skills (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT UNIQUE NOT NULL,
            domain TEXT,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT DEFAULT (datetime('now') || 'Z')
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
            acquired_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );",
    )
}

fn run_sessions_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS workflow_sessions (
            session_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            pid INTEGER NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            ended_at TEXT,
            reset_marker TEXT
        );",
    )?;

    // Idempotent ALTER for existing databases that already have the table without reset_marker
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_sessions)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "reset_marker") {
        conn.execute_batch(
            "ALTER TABLE workflow_sessions ADD COLUMN reset_marker TEXT;",
        )?;
    }
    Ok(())
}

fn run_trigger_text_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_trigger_text = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == "trigger_text"))
        })
        .unwrap_or(false);

    if !has_trigger_text {
        conn.execute_batch(
            "ALTER TABLE imported_skills ADD COLUMN trigger_text TEXT;",
        )?;
    }
    Ok(())
}

fn run_intake_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "display_name") {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN display_name TEXT;",
        )?;
    }
    if !columns.iter().any(|name| name == "intake_json") {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN intake_json TEXT;",
        )?;
    }
    Ok(())
}

/// Migrate agent_runs from PRIMARY KEY (agent_id) to composite PRIMARY KEY (agent_id, model).
/// This allows multiple rows per agent when sub-agents use different models.
fn run_composite_pk_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Check if the table's PRIMARY KEY already includes `model` by inspecting
    // the CREATE TABLE statement stored in sqlite_master.
    let create_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'agent_runs'",
            [],
            |row| row.get(0),
        )
        .unwrap_or_default();

    // After migration the DDL contains "PRIMARY KEY (agent_id, model)".
    // Before migration it has "agent_id TEXT PRIMARY KEY" (inline PK on one column).
    if create_sql.contains("agent_id, model") {
        return Ok(());
    }

    // Recreate the table with composite PK
    conn.execute_batch(
        "DROP TABLE IF EXISTS agent_runs_new;

        CREATE TABLE agent_runs_new (
            agent_id TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            input_tokens INTEGER,
            output_tokens INTEGER,
            total_cost REAL,
            session_id TEXT,
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            completed_at TEXT,
            cache_read_tokens INTEGER DEFAULT 0,
            cache_write_tokens INTEGER DEFAULT 0,
            duration_ms INTEGER,
            reset_marker TEXT,
            workflow_session_id TEXT,
            num_turns INTEGER DEFAULT 0,
            stop_reason TEXT,
            duration_api_ms INTEGER,
            tool_use_count INTEGER DEFAULT 0,
            compaction_count INTEGER DEFAULT 0,
            PRIMARY KEY (agent_id, model)
        );

        INSERT INTO agent_runs_new
            SELECT agent_id, skill_name, step_id, model, status,
                   input_tokens, output_tokens, total_cost, session_id,
                   started_at, completed_at,
                   cache_read_tokens, cache_write_tokens, duration_ms,
                   reset_marker, workflow_session_id,
                   num_turns, stop_reason, duration_api_ms,
                   tool_use_count, compaction_count
            FROM agent_runs;

        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_new RENAME TO agent_runs;",
    )?;

    Ok(())
}

fn run_bundled_skill_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_is_bundled = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == "is_bundled"))
        })
        .unwrap_or(false);

    if !has_is_bundled {
        conn.execute_batch(
            "ALTER TABLE imported_skills ADD COLUMN is_bundled INTEGER NOT NULL DEFAULT 0;",
        )?;
    }
    Ok(())
}

/// Drop `trigger_text` and `description` columns from imported_skills.
/// Skill metadata is now read from SKILL.md frontmatter on disk.
/// SQLite < 3.35 doesn't support DROP COLUMN, so we recreate the table.
fn run_drop_trigger_description_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Check if trigger_text column still exists (idempotent)
    let has_trigger_text = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|name| name == "trigger_text"))
        })
        .unwrap_or(false);

    if !has_trigger_text {
        return Ok(()); // Already migrated
    }

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS imported_skills_new (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL UNIQUE,
            domain TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT NOT NULL,
            is_bundled INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO imported_skills_new (skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled)
            SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled FROM imported_skills;
        DROP TABLE imported_skills;
        ALTER TABLE imported_skills_new RENAME TO imported_skills;",
    )?;

    Ok(())
}

fn run_remove_validate_step_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Delete step 6+ records from all skills (validate step and any beyond)
    conn.execute("DELETE FROM workflow_steps WHERE step_id >= 6", [])?;
    // Reset any skill whose current_step is 6+ back to 5 (completed)
    conn.execute(
        "UPDATE workflow_runs SET current_step = 5, status = 'completed' WHERE current_step >= 6",
        [],
    )?;
    Ok(())
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

fn run_usage_tracking_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(agent_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "cache_read_tokens") {
        conn.execute_batch(
            "ALTER TABLE agent_runs ADD COLUMN cache_read_tokens INTEGER DEFAULT 0;",
        )?;
    }
    if !columns.iter().any(|name| name == "cache_write_tokens") {
        conn.execute_batch(
            "ALTER TABLE agent_runs ADD COLUMN cache_write_tokens INTEGER DEFAULT 0;",
        )?;
    }
    if !columns.iter().any(|name| name == "duration_ms") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN duration_ms INTEGER;")?;
    }
    if !columns.iter().any(|name| name == "reset_marker") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN reset_marker TEXT;")?;
    }
    Ok(())
}

fn run_workflow_session_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(agent_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "workflow_session_id") {
        conn.execute_batch(
            "ALTER TABLE agent_runs ADD COLUMN workflow_session_id TEXT;",
        )?;
    }
    Ok(())
}

fn run_agent_stats_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(agent_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "num_turns") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN num_turns INTEGER DEFAULT 0;")?;
    }
    if !columns.iter().any(|name| name == "stop_reason") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN stop_reason TEXT;")?;
    }
    if !columns.iter().any(|name| name == "duration_api_ms") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN duration_api_ms INTEGER;")?;
    }
    if !columns.iter().any(|name| name == "tool_use_count") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN tool_use_count INTEGER DEFAULT 0;")?;
    }
    if !columns.iter().any(|name| name == "compaction_count") {
        conn.execute_batch(
            "ALTER TABLE agent_runs ADD COLUMN compaction_count INTEGER DEFAULT 0;",
        )?;
    }
    Ok(())
}

// --- Usage Tracking ---

fn step_name(step_id: i32) -> String {
    match step_id {
        0 => "Research".to_string(),
        1 => "Review".to_string(),
        2 => "Detailed Research".to_string(),
        3 => "Review".to_string(),
        4 => "Confirm Decisions".to_string(),
        5 => "Generate Skill".to_string(),
        _ => format!("Step {}", step_id),
    }
}

#[allow(clippy::too_many_arguments)]
pub fn persist_agent_run(
    conn: &Connection,
    agent_id: &str,
    skill_name: &str,
    step_id: i32,
    model: &str,
    status: &str,
    input_tokens: i32,
    output_tokens: i32,
    cache_read_tokens: i32,
    cache_write_tokens: i32,
    total_cost: f64,
    duration_ms: i64,
    num_turns: i32,
    stop_reason: Option<&str>,
    duration_api_ms: Option<i64>,
    tool_use_count: i32,
    compaction_count: i32,
    session_id: Option<&str>,
    workflow_session_id: Option<&str>,
) -> Result<(), String> {
    // Don't overwrite a completed/error run with shutdown status — the completed
    // data is more valuable than the partial shutdown snapshot.
    if status == "shutdown" {
        let existing_status: Option<String> = conn
            .query_row(
                "SELECT status FROM agent_runs WHERE agent_id = ?1 AND model = ?2",
                rusqlite::params![agent_id, model],
                |row| row.get(0),
            )
            .ok();
        if matches!(existing_status.as_deref(), Some("completed") | Some("error")) {
            return Ok(());
        }
    }

    conn.execute(
        "INSERT OR REPLACE INTO agent_runs
         (agent_id, skill_name, step_id, model, status, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, total_cost, duration_ms,
          num_turns, stop_reason, duration_api_ms, tool_use_count, compaction_count,
          session_id, workflow_session_id, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                 ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18,
                 COALESCE((SELECT started_at FROM agent_runs WHERE agent_id = ?1 AND model = ?4), datetime('now') || 'Z'),
                 datetime('now') || 'Z')",
        rusqlite::params![
            agent_id,
            skill_name,
            step_id,
            model,
            status,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            total_cost,
            duration_ms,
            num_turns,
            stop_reason,
            duration_api_ms,
            tool_use_count,
            compaction_count,
            session_id,
            workflow_session_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_usage_summary(conn: &Connection, hide_cancelled: bool) -> Result<UsageSummary, String> {
    const SQL_WITH_HAVING: &str =
        "SELECT COALESCE(SUM(sub.session_cost), 0.0),
                COUNT(*),
                COALESCE(AVG(sub.session_cost), 0.0)
         FROM (
           SELECT ws.session_id, COALESCE(SUM(ar.total_cost), 0.0) as session_cost
           FROM workflow_sessions ws
           LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                  AND ar.reset_marker IS NULL
           WHERE ws.reset_marker IS NULL
           GROUP BY ws.session_id
           HAVING COALESCE(SUM(ar.total_cost), 0) > 0 OR COUNT(DISTINCT ar.agent_id) = 0
         ) sub";
    const SQL_WITHOUT_HAVING: &str =
        "SELECT COALESCE(SUM(sub.session_cost), 0.0),
                COUNT(*),
                COALESCE(AVG(sub.session_cost), 0.0)
         FROM (
           SELECT ws.session_id, COALESCE(SUM(ar.total_cost), 0.0) as session_cost
           FROM workflow_sessions ws
           LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                  AND ar.reset_marker IS NULL
           WHERE ws.reset_marker IS NULL
           GROUP BY ws.session_id
         ) sub";

    let sql = if hide_cancelled { SQL_WITH_HAVING } else { SQL_WITHOUT_HAVING };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;

    stmt.query_row([], |row| {
        Ok(UsageSummary {
            total_cost: row.get(0)?,
            total_runs: row.get(1)?,
            avg_cost_per_run: row.get(2)?,
        })
    })
    .map_err(|e| e.to_string())
}

pub fn get_recent_runs(conn: &Connection, limit: usize) -> Result<Vec<AgentRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE reset_marker IS NULL
             ORDER BY completed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit as i64], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_recent_workflow_sessions(conn: &Connection, limit: usize, hide_cancelled: bool) -> Result<Vec<WorkflowSessionRecord>, String> {
    let sql = if hide_cancelled {
        "SELECT ws.session_id,
                ws.skill_name,
                COALESCE(MIN(ar.step_id), 0),
                COALESCE(MAX(ar.step_id), 0),
                COALESCE(GROUP_CONCAT(DISTINCT ar.step_id), ''),
                COUNT(DISTINCT ar.agent_id),
                COALESCE(SUM(ar.total_cost), 0.0),
                COALESCE(SUM(ar.input_tokens), 0),
                COALESCE(SUM(ar.output_tokens), 0),
                COALESCE(SUM(ar.cache_read_tokens), 0),
                COALESCE(SUM(ar.cache_write_tokens), 0),
                COALESCE(SUM(ar.duration_ms), 0),
                ws.started_at,
                ws.ended_at
         FROM workflow_sessions ws
         LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                AND ar.reset_marker IS NULL
         WHERE ws.reset_marker IS NULL
         GROUP BY ws.session_id
         HAVING COALESCE(SUM(ar.total_cost), 0) > 0 OR COUNT(DISTINCT ar.agent_id) = 0
         ORDER BY ws.started_at DESC
         LIMIT ?1"
    } else {
        "SELECT ws.session_id,
                ws.skill_name,
                COALESCE(MIN(ar.step_id), 0),
                COALESCE(MAX(ar.step_id), 0),
                COALESCE(GROUP_CONCAT(DISTINCT ar.step_id), ''),
                COUNT(DISTINCT ar.agent_id),
                COALESCE(SUM(ar.total_cost), 0.0),
                COALESCE(SUM(ar.input_tokens), 0),
                COALESCE(SUM(ar.output_tokens), 0),
                COALESCE(SUM(ar.cache_read_tokens), 0),
                COALESCE(SUM(ar.cache_write_tokens), 0),
                COALESCE(SUM(ar.duration_ms), 0),
                ws.started_at,
                ws.ended_at
         FROM workflow_sessions ws
         LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                AND ar.reset_marker IS NULL
         WHERE ws.reset_marker IS NULL
         GROUP BY ws.session_id
         ORDER BY ws.started_at DESC
         LIMIT ?1"
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit as i64], |row| {
            Ok(WorkflowSessionRecord {
                session_id: row.get(0)?,
                skill_name: row.get(1)?,
                min_step: row.get(2)?,
                max_step: row.get(3)?,
                steps_csv: row.get(4)?,
                agent_count: row.get(5)?,
                total_cost: row.get(6)?,
                total_input_tokens: row.get(7)?,
                total_output_tokens: row.get(8)?,
                total_cache_read: row.get(9)?,
                total_cache_write: row.get(10)?,
                total_duration_ms: row.get(11)?,
                started_at: row.get(12)?,
                completed_at: row.get(13)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_session_agent_runs(conn: &Connection, session_id: &str) -> Result<Vec<AgentRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE workflow_session_id = ?1
             ORDER BY started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_step_agent_runs(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
) -> Result<Vec<AgentRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE skill_name = ?1 AND step_id = ?2
               AND status IN ('completed', 'error')
               AND reset_marker IS NULL
             ORDER BY completed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![skill_name, step_id], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_usage_by_step(conn: &Connection, hide_cancelled: bool) -> Result<Vec<UsageByStep>, String> {
    let sql = if hide_cancelled {
        "SELECT step_id, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL
           AND total_cost > 0
         GROUP BY step_id
         ORDER BY SUM(total_cost) DESC"
    } else {
        "SELECT step_id, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL
         GROUP BY step_id
         ORDER BY SUM(total_cost) DESC"
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            let sid: i32 = row.get(0)?;
            Ok(UsageByStep {
                step_id: sid,
                step_name: step_name(sid),
                total_cost: row.get(1)?,
                run_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_usage_by_model(conn: &Connection, hide_cancelled: bool) -> Result<Vec<UsageByModel>, String> {
    let sql = if hide_cancelled {
        "SELECT model, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL
           AND total_cost > 0
         GROUP BY model
         ORDER BY SUM(total_cost) DESC"
    } else {
        "SELECT model, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL
         GROUP BY model
         ORDER BY SUM(total_cost) DESC"
    };
    let mut stmt = conn
        .prepare(sql)
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(UsageByModel {
                model: row.get(0)?,
                total_cost: row.get(1)?,
                run_count: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn reset_usage(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "UPDATE agent_runs SET reset_marker = datetime('now') || 'Z' WHERE reset_marker IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workflow_sessions SET reset_marker = datetime('now') || 'Z' WHERE reset_marker IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
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

/// Read settings (including secrets stored directly in SQLite).
///
/// Alias for `read_settings()` — kept for call-site compatibility.
pub fn read_settings_hydrated(conn: &Connection) -> Result<AppSettings, String> {
    read_settings(conn)
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
         VALUES (?1, ?2, ?3, ?4, ?5, datetime('now') || 'Z')
         ON CONFLICT(skill_name) DO UPDATE SET
             domain = ?2, current_step = ?3, status = ?4, skill_type = ?5, updated_at = datetime('now') || 'Z'",
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

#[cfg(test)]
pub fn set_skill_display_name(
    conn: &Connection,
    skill_name: &str,
    display_name: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET display_name = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params![skill_name, display_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn set_skill_intake(
    conn: &Connection,
    skill_name: &str,
    intake_json: Option<&str>,
) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_runs SET intake_json = ?2, updated_at = datetime('now') || 'Z' WHERE skill_name = ?1",
        rusqlite::params![skill_name, intake_json],
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
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar, display_name, intake_json
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
            display_name: row.get(9)?,
            intake_json: row.get(10)?,
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
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar, display_name, intake_json
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
                display_name: row.get(9)?,
                intake_json: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_workflow_run(conn: &Connection, skill_name: &str) -> Result<(), String> {
    // Delete workflow artifacts
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

    // Delete skill locks
    conn.execute(
        "DELETE FROM skill_locks WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

    // Delete workflow sessions
    conn.execute(
        "DELETE FROM workflow_sessions WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

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

    // Safety: The format! below only injects positional bind-parameter placeholders
    // (?1, ?2, ...) — never user-supplied values. All skill_name values are bound via
    // rusqlite's parameterized query API, so there is no SQL injection risk.
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

/// Read SKILL.md frontmatter from disk and populate `description` and `trigger_text`
/// on an ImportedSkill struct. These fields are not stored in the DB.
pub fn hydrate_skill_metadata(skill: &mut ImportedSkill) {
    let skill_md_path = std::path::Path::new(&skill.disk_path).join("SKILL.md");
    if let Ok(content) = fs::read_to_string(&skill_md_path) {
        let fm = crate::commands::imported_skills::parse_frontmatter_full(&content);
        skill.description = fm.description;
        skill.trigger_text = fm.trigger;
    }
}

pub fn insert_imported_skill(
    conn: &Connection,
    skill: &ImportedSkill,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.domain,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
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

/// Upsert a bundled skill into the database. Uses `INSERT OR REPLACE` keyed on
/// `skill_name` (via UNIQUE constraint) for idempotent re-seeding on startup.
/// Preserves `is_active` if the skill already exists.
pub fn upsert_bundled_skill(conn: &Connection, skill: &ImportedSkill) -> Result<(), String> {
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(skill_name) DO UPDATE SET
             skill_id = excluded.skill_id,
             domain = excluded.domain,
             disk_path = excluded.disk_path,
             is_bundled = excluded.is_bundled",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.domain,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_imported_skills(conn: &Connection) -> Result<Vec<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled
             FROM imported_skills ORDER BY imported_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ImportedSkill {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                domain: row.get(2)?,
                is_active: row.get::<_, i32>(3)? != 0,
                disk_path: row.get(4)?,
                imported_at: row.get(5)?,
                is_bundled: row.get::<_, i32>(6)? != 0,
                description: None,
                trigger_text: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut skills: Vec<ImportedSkill> = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for skill in &mut skills {
        hydrate_skill_metadata(skill);
    }

    Ok(skills)
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
            "SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled
             FROM imported_skills WHERE skill_name = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![skill_name], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            domain: row.get(2)?,
            is_active: row.get::<_, i32>(3)? != 0,
            disk_path: row.get(4)?,
            imported_at: row.get(5)?,
            is_bundled: row.get::<_, i32>(6)? != 0,
            description: None,
            trigger_text: None,
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

pub fn list_active_skills(conn: &Connection) -> Result<Vec<ImportedSkill>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled
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
                domain: row.get(2)?,
                is_active: row.get::<_, i32>(3)? != 0,
                disk_path: row.get(4)?,
                imported_at: row.get(5)?,
                is_bundled: row.get::<_, i32>(6)? != 0,
                description: None,
                trigger_text: None,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut skills: Vec<ImportedSkill> = rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    for skill in &mut skills {
        hydrate_skill_metadata(skill);
    }

    Ok(skills)
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

// --- Workflow Sessions ---

pub fn create_workflow_session(
    conn: &Connection,
    session_id: &str,
    skill_name: &str,
    pid: u32,
) -> Result<(), String> {
    conn.execute(
        "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, pid) VALUES (?1, ?2, ?3)",
        rusqlite::params![session_id, skill_name, pid as i64],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn end_workflow_session(conn: &Connection, session_id: &str) -> Result<(), String> {
    conn.execute(
        "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE session_id = ?1 AND ended_at IS NULL",
        [session_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn end_all_sessions_for_pid(conn: &Connection, pid: u32) -> Result<u32, String> {
    let count = conn
        .execute(
            "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE pid = ?1 AND ended_at IS NULL",
            rusqlite::params![pid as i64],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

/// Returns true if the given skill has an active workflow session (ended_at IS NULL)
/// whose PID is still alive. Used by startup reconciliation to skip skills owned by
/// another running instance.
pub fn has_active_session_with_live_pid(conn: &Connection, skill_name: &str) -> bool {
    let mut stmt = match conn.prepare(
        "SELECT pid FROM workflow_sessions WHERE skill_name = ?1 AND ended_at IS NULL",
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let pids: Vec<u32> = match stmt.query_map([skill_name], |row| {
        Ok(row.get::<_, i64>(0)? as u32)
    }) {
        Ok(rows) => rows.filter_map(|r| r.ok()).collect(),
        Err(_) => return false,
    };

    pids.iter().any(|&pid| check_pid_alive(pid))
}

pub fn reconcile_orphaned_sessions(conn: &Connection) -> Result<u32, String> {
    // Find all sessions that were never ended
    let mut stmt = conn
        .prepare("SELECT session_id, skill_name, pid FROM workflow_sessions WHERE ended_at IS NULL")
        .map_err(|e| e.to_string())?;

    let orphans: Vec<(String, String, u32)> = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)? as u32,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut reconciled = 0u32;
    for (session_id, skill_name, pid) in orphans {
        if !check_pid_alive(pid) {
            // Process is dead — close the session with the best available timestamp.
            // Use the latest agent_runs completed_at for this session, or fall back to started_at.
            let fallback_time: Option<String> = conn
                .query_row(
                    "SELECT COALESCE(
                        (SELECT MAX(completed_at) FROM agent_runs WHERE session_id = ?1 AND completed_at IS NOT NULL),
                        (SELECT started_at FROM workflow_sessions WHERE session_id = ?1)
                    )",
                    [&session_id],
                    |row| row.get(0),
                )
                .ok();

            if let Some(ended_at) = fallback_time {
                conn.execute(
                    "UPDATE workflow_sessions SET ended_at = ?1 WHERE session_id = ?2",
                    rusqlite::params![ended_at, session_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                // No timestamp available — use current time
                conn.execute(
                    "UPDATE workflow_sessions SET ended_at = datetime('now') || 'Z' WHERE session_id = ?1",
                    [&session_id],
                )
                .map_err(|e| e.to_string())?;
            }

            log::info!(
                "Reconciled orphaned session {} for skill '{}' (PID {} is dead)",
                session_id, skill_name, pid
            );
            reconciled += 1;
        }
    }

    Ok(reconciled)
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
        run_usage_tracking_migration(&conn).unwrap();
        run_workflow_session_migration(&conn).unwrap();
        run_sessions_table_migration(&conn).unwrap();
        run_trigger_text_migration(&conn).unwrap();
        run_agent_stats_migration(&conn).unwrap();
        run_intake_migration(&conn).unwrap();
        run_composite_pk_migration(&conn).unwrap();
        run_bundled_skill_migration(&conn).unwrap();
        run_remove_validate_step_migration(&conn).unwrap();
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
            remote_repo_owner: None,
            remote_repo_name: None,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
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
            remote_repo_owner: None,
            remote_repo_name: None,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
        };
        write_settings(&conn, &settings).unwrap();

        let loaded = read_settings(&conn).unwrap();
        assert_eq!(loaded.skills_path.as_deref(), Some("/home/user/my-skills"));
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
            remote_repo_owner: None,
            remote_repo_name: None,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
        };
        write_settings(&conn, &v1).unwrap();

        let v2 = AppSettings {
            anthropic_api_key: Some("key-2".to_string()),
            workspace_path: Some("/new/path".to_string()),
            skills_path: None,
            preferred_model: Some("opus".to_string()),
            debug_mode: false,
            log_level: "info".to_string(),
            extended_context: false,
            extended_thinking: false,
            splash_shown: false,
            github_oauth_token: None,
            github_user_login: None,
            github_user_avatar: None,
            github_user_email: None,
            remote_repo_owner: None,
            remote_repo_name: None,
            max_dimensions: 5,
            industry: None,
            function_role: None,
            dashboard_view_mode: None,
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
        run_intake_migration(&conn).unwrap();

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

    // --- Usage Tracking tests ---

    #[test]
    fn test_usage_tracking_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_usage_tracking_migration(&conn).unwrap();
        // Running again should not error
        run_usage_tracking_migration(&conn).unwrap();
    }

    #[test]
    fn test_persist_agent_run_inserts_correctly() {
        let conn = create_test_db();
        persist_agent_run(
            &conn,
            "agent-1",
            "my-skill",
            3,
            "sonnet",
            "completed",
            1000,
            500,
            200,
            100,
            0.05,
            12345,
            0, None, None, 0, 0,
            Some("session-abc"),
            Some("wf-test-session"),
        )
        .unwrap();

        let runs = get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.agent_id, "agent-1");
        assert_eq!(run.skill_name, "my-skill");
        assert_eq!(run.step_id, 3);
        assert_eq!(run.model, "sonnet");
        assert_eq!(run.status, "completed");
        assert_eq!(run.input_tokens, 1000);
        assert_eq!(run.output_tokens, 500);
        assert_eq!(run.cache_read_tokens, 200);
        assert_eq!(run.cache_write_tokens, 100);
        assert!((run.total_cost - 0.05).abs() < f64::EPSILON);
        assert_eq!(run.duration_ms, 12345);
        assert_eq!(run.session_id.as_deref(), Some("session-abc"));
        assert!(run.started_at.len() > 0);
        assert!(run.completed_at.is_some());
        assert_eq!(run.num_turns, 0);
        assert_eq!(run.stop_reason, None);
        assert_eq!(run.duration_api_ms, None);
        assert_eq!(run.tool_use_count, 0);
        assert_eq!(run.compaction_count, 0);
    }

    #[test]
    fn test_persist_agent_run_without_session_id() {
        let conn = create_test_db();
        persist_agent_run(
            &conn, "agent-2", "my-skill", 1, "haiku", "completed",
            500, 200, 0, 0, 0.01, 5000,
            0, None, None, 0, 0,
            None, None,
        )
        .unwrap();

        let runs = get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert!(runs[0].session_id.is_none());
    }

    #[test]
    fn test_persist_agent_run_shutdown_does_not_overwrite_completed() {
        let conn = create_test_db();
        let ws = Some("wf-session-1");

        // First persist as completed with real data
        persist_agent_run(
            &conn, "agent-1", "my-skill", 0, "sonnet", "completed",
            1000, 500, 200, 100, 0.15, 8000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        // Then attempt to overwrite with shutdown (partial/zero data)
        persist_agent_run(
            &conn, "agent-1", "my-skill", 0, "sonnet", "shutdown",
            0, 0, 0, 0, 0.0, 0,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        // Completed data should be preserved
        let runs = get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "completed");
        assert_eq!(runs[0].input_tokens, 1000);
        assert!((runs[0].total_cost - 0.15).abs() < 1e-10);
    }

    #[test]
    fn test_persist_agent_run_shutdown_overwrites_running() {
        let conn = create_test_db();
        let ws = Some("wf-session-1");

        // First persist as running (agent start)
        persist_agent_run(
            &conn, "agent-1", "my-skill", 0, "sonnet", "running",
            0, 0, 0, 0, 0.0, 0,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        // Then shutdown with partial data — should succeed
        persist_agent_run(
            &conn, "agent-1", "my-skill", 0, "sonnet", "shutdown",
            500, 200, 0, 0, 0.05, 3000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        let runs = get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "shutdown");
        assert_eq!(runs[0].input_tokens, 500);
    }

    #[test]
    fn test_get_usage_summary_correct_aggregates() {
        let conn = create_test_db();
        let ws = Some("wf-session-1");
        create_workflow_session(&conn, "wf-session-1", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-a", 3, "opus", "completed",
            2000, 1000, 0, 0, 0.30, 10000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        // Running agents are included (toggle hides zero-cost sessions, not individual statuses)
        persist_agent_run(
            &conn, "agent-3", "skill-a", 5, "sonnet", "running",
            100, 50, 0, 0, 0.01, 0,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        let summary = get_usage_summary(&conn, false).unwrap();
        // All three agents share one workflow session → 1 run, total 0.41
        assert_eq!(summary.total_runs, 1);
        assert!((summary.total_cost - 0.41).abs() < 1e-10);
        assert!((summary.avg_cost_per_run - 0.41).abs() < 1e-10);
    }

    #[test]
    fn test_get_usage_summary_empty() {
        let conn = create_test_db();
        let summary = get_usage_summary(&conn, false).unwrap();
        assert_eq!(summary.total_runs, 0);
        assert!((summary.total_cost - 0.0).abs() < f64::EPSILON);
        assert!((summary.avg_cost_per_run - 0.0).abs() < f64::EPSILON);
    }

    #[test]
    fn test_reset_usage_marks_runs() {
        let conn = create_test_db();
        let ws = Some("wf-session-r");
        create_workflow_session(&conn, "wf-session-r", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-a", 3, "opus", "completed",
            2000, 1000, 0, 0, 0.30, 10000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        reset_usage(&conn).unwrap();

        // After reset, summary should show zero (both agent_runs and workflow_sessions are marked)
        let summary = get_usage_summary(&conn, false).unwrap();
        assert_eq!(summary.total_runs, 0);
        assert!((summary.total_cost - 0.0).abs() < f64::EPSILON);

        // Recent runs should also be empty (filtered by reset_marker IS NULL)
        let runs = get_recent_runs(&conn, 10).unwrap();
        assert!(runs.is_empty());

        // Recent workflow sessions should also be empty
        let sessions = get_recent_workflow_sessions(&conn, 10, false).unwrap();
        assert!(sessions.is_empty());

        // New runs after reset should still be visible
        create_workflow_session(&conn, "wf-session-r2", "skill-b", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-3", "skill-b", 6, "sonnet", "completed",
            500, 200, 0, 0, 0.05, 3000,
            0, None, None, 0, 0,
            None, Some("wf-session-r2"),
        )
        .unwrap();

        let summary = get_usage_summary(&conn, false).unwrap();
        assert_eq!(summary.total_runs, 1);
        assert!((summary.total_cost - 0.05).abs() < 1e-10);
    }

    #[test]
    fn test_get_usage_by_step_groups_correctly() {
        let conn = create_test_db();
        let ws = Some("wf-session-s");
        create_workflow_session(&conn, "wf-session-s", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-a", 1, "sonnet", "completed",
            800, 400, 0, 0, 0.08, 4000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-3", "skill-a", 5, "sonnet", "completed",
            2000, 1000, 0, 0, 0.25, 8000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        let by_step = get_usage_by_step(&conn, false).unwrap();
        assert_eq!(by_step.len(), 2);

        // Ordered by total_cost DESC: step 5 ($0.25) then step 1 ($0.18)
        assert_eq!(by_step[0].step_id, 5);
        assert_eq!(by_step[0].step_name, "Generate Skill");
        assert_eq!(by_step[0].run_count, 1);
        assert!((by_step[0].total_cost - 0.25).abs() < 1e-10);

        assert_eq!(by_step[1].step_id, 1);
        assert_eq!(by_step[1].step_name, "Review");
        assert_eq!(by_step[1].run_count, 2);
        assert!((by_step[1].total_cost - 0.18).abs() < 1e-10);
    }

    #[test]
    fn test_get_usage_by_model_groups_correctly() {
        let conn = create_test_db();
        let ws = Some("wf-session-m");
        create_workflow_session(&conn, "wf-session-m", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-a", 5, "opus", "completed",
            2000, 1000, 0, 0, 0.50, 10000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-3", "skill-a", 3, "sonnet", "completed",
            500, 200, 0, 0, 0.05, 3000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        let by_model = get_usage_by_model(&conn, false).unwrap();
        assert_eq!(by_model.len(), 2);

        // Ordered by total_cost DESC: opus ($0.50) then sonnet ($0.15)
        assert_eq!(by_model[0].model, "opus");
        assert_eq!(by_model[0].run_count, 1);
        assert!((by_model[0].total_cost - 0.50).abs() < 1e-10);

        assert_eq!(by_model[1].model, "sonnet");
        assert_eq!(by_model[1].run_count, 2);
        assert!((by_model[1].total_cost - 0.15).abs() < 1e-10);
    }

    #[test]
    fn test_reset_usage_excludes_from_by_step_and_by_model() {
        let conn = create_test_db();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, None,
        )
        .unwrap();

        reset_usage(&conn).unwrap();

        let by_step = get_usage_by_step(&conn, false).unwrap();
        assert!(by_step.is_empty());

        let by_model = get_usage_by_model(&conn, false).unwrap();
        assert!(by_model.is_empty());
    }

    // --- Composite PK (agent_id, model) tests ---

    #[test]
    fn test_composite_pk_allows_same_agent_different_models() {
        let conn = create_test_db();
        let ws = Some("wf-session-cpk");
        create_workflow_session(&conn, "wf-session-cpk", "skill-a", 1000).unwrap();

        // Insert same agent_id with two different models (simulates sub-agent spawning)
        persist_agent_run(
            &conn, "orchestrator-1", "skill-a", 1, "opus", "completed",
            2000, 1000, 0, 0, 0.50, 10000,
            3, Some("end_turn"), Some(8000), 5, 0,
            Some("sess-1"), ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "orchestrator-1", "skill-a", 1, "sonnet", "completed",
            800, 400, 0, 0, 0.08, 4000,
            2, Some("end_turn"), Some(3000), 3, 0,
            Some("sess-1"), ws,
        )
        .unwrap();

        // Both rows should exist
        let runs = get_session_agent_runs(&conn, "wf-session-cpk").unwrap();
        assert_eq!(runs.len(), 2);

        // Verify distinct models
        let models: Vec<&str> = runs.iter().map(|r| r.model.as_str()).collect();
        assert!(models.contains(&"opus"));
        assert!(models.contains(&"sonnet"));

        // Both should have the same agent_id
        assert!(runs.iter().all(|r| r.agent_id == "orchestrator-1"));

        // get_usage_by_model should aggregate correctly
        let by_model = get_usage_by_model(&conn, false).unwrap();
        assert_eq!(by_model.len(), 2);

        let opus = by_model.iter().find(|m| m.model == "opus").unwrap();
        assert!((opus.total_cost - 0.50).abs() < 1e-10);
        assert_eq!(opus.run_count, 1);

        let sonnet = by_model.iter().find(|m| m.model == "sonnet").unwrap();
        assert!((sonnet.total_cost - 0.08).abs() < 1e-10);
        assert_eq!(sonnet.run_count, 1);
    }

    #[test]
    fn test_composite_pk_upsert_same_agent_and_model() {
        let conn = create_test_db();

        // Insert then update same agent_id + model — should replace, not duplicate
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "running",
            0, 0, 0, 0, 0.0, 0,
            0, None, None, 0, 0,
            None, None,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            3, Some("end_turn"), Some(4000), 5, 1,
            None, None,
        )
        .unwrap();

        let runs = get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "completed");
        assert_eq!(runs[0].input_tokens, 1000);
    }

    #[test]
    fn test_composite_pk_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_add_skill_type_migration(&conn).unwrap();
        run_lock_table_migration(&conn).unwrap();
        run_author_migration(&conn).unwrap();
        run_usage_tracking_migration(&conn).unwrap();
        run_workflow_session_migration(&conn).unwrap();
        run_sessions_table_migration(&conn).unwrap();
        run_trigger_text_migration(&conn).unwrap();
        run_agent_stats_migration(&conn).unwrap();
        run_intake_migration(&conn).unwrap();
        run_composite_pk_migration(&conn).unwrap();
        // Running again should not error
        run_composite_pk_migration(&conn).unwrap();
    }

    #[test]
    fn test_composite_pk_session_agent_count_uses_distinct() {
        let conn = create_test_db();
        let ws = Some("wf-session-distinct");
        create_workflow_session(&conn, "wf-session-distinct", "skill-a", 1000).unwrap();

        // Same agent uses two models
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "opus", "completed",
            2000, 1000, 0, 0, 0.50, 10000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            800, 400, 0, 0, 0.08, 4000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        // Different agent, one model
        persist_agent_run(
            &conn, "agent-2", "skill-a", 1, "sonnet", "completed",
            500, 200, 0, 0, 0.05, 3000,
            0, None, None, 0, 0,
            None, ws,
        )
        .unwrap();

        let sessions = get_recent_workflow_sessions(&conn, 10, false).unwrap();
        assert_eq!(sessions.len(), 1);
        // agent_count should be 2 (distinct agents), not 3 (rows)
        assert_eq!(sessions[0].agent_count, 2);
        // Total cost should sum all three rows
        assert!((sessions[0].total_cost - 0.63).abs() < 1e-10);
    }

    #[test]
    fn test_step_name_mapping() {
        assert_eq!(step_name(0), "Research");
        assert_eq!(step_name(1), "Review");
        assert_eq!(step_name(2), "Detailed Research");
        assert_eq!(step_name(3), "Review");
        assert_eq!(step_name(4), "Confirm Decisions");
        assert_eq!(step_name(5), "Generate Skill");
        assert_eq!(step_name(6), "Step 6");
        assert_eq!(step_name(-1), "Step -1");
        assert_eq!(step_name(99), "Step 99");
    }

    // --- Workflow Session tests ---

    #[test]
    fn test_create_workflow_session() {
        let conn = create_test_db();
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

        let ended_at: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at.is_none());
    }

    #[test]
    fn test_create_workflow_session_idempotent() {
        let conn = create_test_db();
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
        // Second insert with same ID should be ignored (INSERT OR IGNORE)
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_end_workflow_session() {
        let conn = create_test_db();
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
        end_workflow_session(&conn, "sess-1").unwrap();

        let ended_at: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at.is_some());
    }

    #[test]
    fn test_end_workflow_session_idempotent() {
        let conn = create_test_db();
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();
        end_workflow_session(&conn, "sess-1").unwrap();

        let first_ended: String = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();

        // Calling again should not update (WHERE ended_at IS NULL won't match)
        end_workflow_session(&conn, "sess-1").unwrap();

        let second_ended: String = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(first_ended, second_ended);
    }

    #[test]
    fn test_end_all_sessions_for_pid() {
        let conn = create_test_db();
        create_workflow_session(&conn, "sess-1", "skill-a", 100).unwrap();
        create_workflow_session(&conn, "sess-2", "skill-b", 100).unwrap();
        create_workflow_session(&conn, "sess-3", "skill-c", 200).unwrap();

        let count = end_all_sessions_for_pid(&conn, 100).unwrap();
        assert_eq!(count, 2);

        // sess-3 (pid 200) should still be open
        let ended: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-3'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended.is_none());
    }

    #[test]
    fn test_reconcile_orphaned_sessions_dead_pid() {
        let conn = create_test_db();
        // PID 99999999 is dead
        create_workflow_session(&conn, "sess-1", "my-skill", 99999999).unwrap();

        let reconciled = reconcile_orphaned_sessions(&conn).unwrap();
        assert_eq!(reconciled, 1);

        // Session should now be ended
        let ended_at: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at.is_some());
    }

    #[test]
    fn test_reconcile_orphaned_sessions_live_pid() {
        let conn = create_test_db();
        let pid = std::process::id();
        create_workflow_session(&conn, "sess-1", "my-skill", pid).unwrap();

        let reconciled = reconcile_orphaned_sessions(&conn).unwrap();
        assert_eq!(reconciled, 0);

        // Session should still be open
        let ended_at: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at.is_none());
    }

    #[test]
    fn test_delete_workflow_run_cascades_sessions() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "domain", 0, "pending", "domain").unwrap();
        create_workflow_session(&conn, "sess-1", "my-skill", 12345).unwrap();

        delete_workflow_run(&conn, "my-skill").unwrap();

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM workflow_sessions WHERE skill_name = 'my-skill'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn test_sessions_table_migration_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_sessions_table_migration(&conn).unwrap();
        // Running again should not error
        run_sessions_table_migration(&conn).unwrap();
    }

    #[test]
    fn test_get_usage_summary_hide_cancelled() {
        let conn = create_test_db();

        // Session with real cost
        create_workflow_session(&conn, "sess-cost", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 200, 100, 0.15, 8000,
            0, None, None, 0, 0,
            None, Some("sess-cost"),
        )
        .unwrap();

        // Session with zero cost (cancelled)
        create_workflow_session(&conn, "sess-zero", "skill-b", 2000).unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-b", 0, "sonnet", "shutdown",
            0, 0, 0, 0, 0.0, 0,
            0, None, None, 0, 0,
            None, Some("sess-zero"),
        )
        .unwrap();

        let summary = get_usage_summary(&conn, true).unwrap();
        assert_eq!(summary.total_runs, 1);
        assert!((summary.total_cost - 0.15).abs() < 1e-10);
    }

    #[test]
    fn test_get_recent_workflow_sessions_returns_sessions() {
        let conn = create_test_db();

        // Session 1
        create_workflow_session(&conn, "sess-1", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 200, 100, 0.10, 5000,
            0, None, None, 0, 0,
            None, Some("sess-1"),
        )
        .unwrap();

        // Session 2
        create_workflow_session(&conn, "sess-2", "skill-b", 2000).unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-b", 3, "opus", "completed",
            2000, 1000, 400, 200, 0.30, 10000,
            0, None, None, 0, 0,
            None, Some("sess-2"),
        )
        .unwrap();

        let sessions = get_recent_workflow_sessions(&conn, 10, false).unwrap();
        assert_eq!(sessions.len(), 2);

        // Find each session by ID (ordering may vary when timestamps match)
        let s1 = sessions.iter().find(|s| s.session_id == "sess-1").unwrap();
        assert_eq!(s1.skill_name, "skill-a");
        assert!((s1.total_cost - 0.10).abs() < 1e-10);
        assert_eq!(s1.total_input_tokens, 1000);
        assert_eq!(s1.total_output_tokens, 500);

        let s2 = sessions.iter().find(|s| s.session_id == "sess-2").unwrap();
        assert_eq!(s2.skill_name, "skill-b");
        assert!((s2.total_cost - 0.30).abs() < 1e-10);
        assert_eq!(s2.total_input_tokens, 2000);
        assert_eq!(s2.total_output_tokens, 1000);
    }

    #[test]
    fn test_get_recent_workflow_sessions_hide_cancelled() {
        let conn = create_test_db();

        // Session with cost
        create_workflow_session(&conn, "sess-good", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, Some("sess-good"),
        )
        .unwrap();

        // Session with zero cost
        create_workflow_session(&conn, "sess-cancelled", "skill-b", 2000).unwrap();
        persist_agent_run(
            &conn, "agent-2", "skill-b", 0, "sonnet", "shutdown",
            0, 0, 0, 0, 0.0, 0,
            0, None, None, 0, 0,
            None, Some("sess-cancelled"),
        )
        .unwrap();

        let sessions = get_recent_workflow_sessions(&conn, 10, true).unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].session_id, "sess-good");
    }

    #[test]
    fn test_get_usage_summary_multiple_sessions() {
        let conn = create_test_db();

        // Session 1: two agent runs
        create_workflow_session(&conn, "sess-1", "skill-a", 1000).unwrap();
        persist_agent_run(
            &conn, "agent-1a", "skill-a", 1, "sonnet", "completed",
            1000, 500, 0, 0, 0.10, 5000,
            0, None, None, 0, 0,
            None, Some("sess-1"),
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-1b", "skill-a", 3, "opus", "completed",
            2000, 1000, 0, 0, 0.30, 10000,
            0, None, None, 0, 0,
            None, Some("sess-1"),
        )
        .unwrap();

        // Session 2: one agent run
        create_workflow_session(&conn, "sess-2", "skill-b", 2000).unwrap();
        persist_agent_run(
            &conn, "agent-2a", "skill-b", 1, "sonnet", "completed",
            500, 200, 0, 0, 0.05, 3000,
            0, None, None, 0, 0,
            None, Some("sess-2"),
        )
        .unwrap();

        // Session 3: two agent runs
        create_workflow_session(&conn, "sess-3", "skill-c", 3000).unwrap();
        persist_agent_run(
            &conn, "agent-3a", "skill-c", 5, "opus", "completed",
            3000, 1500, 0, 0, 0.50, 15000,
            0, None, None, 0, 0,
            None, Some("sess-3"),
        )
        .unwrap();
        persist_agent_run(
            &conn, "agent-3b", "skill-c", 6, "sonnet", "completed",
            800, 400, 0, 0, 0.08, 4000,
            0, None, None, 0, 0,
            None, Some("sess-3"),
        )
        .unwrap();

        let summary = get_usage_summary(&conn, false).unwrap();
        // 3 sessions (not 5 agent runs)
        assert_eq!(summary.total_runs, 3);
        // Total cost: 0.10 + 0.30 + 0.05 + 0.50 + 0.08 = 1.03
        assert!((summary.total_cost - 1.03).abs() < 1e-10);
    }

    // --- Trigger Text Migration tests ---

    #[test]
    fn test_trigger_text_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_trigger_text_migration(&conn).unwrap();
        // Running again should not error
        run_trigger_text_migration(&conn).unwrap();
    }

    #[test]
    fn test_drop_trigger_description_migration_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        run_migrations(&conn).unwrap();
        run_trigger_text_migration(&conn).unwrap();
        run_bundled_skill_migration(&conn).unwrap();
        run_drop_trigger_description_migration(&conn).unwrap();
        // Running again should not error (columns already removed)
        run_drop_trigger_description_migration(&conn).unwrap();
    }

    #[test]
    fn test_list_active_skills() {
        let conn = create_test_db();

        // Skill 1: active (trigger comes from disk, not DB)
        let skill1 = ImportedSkill {
            skill_id: "imp-1".to_string(),
            skill_name: "active-with-trigger".to_string(),
            domain: None,
            is_active: true,
            disk_path: "/tmp/s1".to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,
            trigger_text: None,
        };
        insert_imported_skill(&conn, &skill1).unwrap();

        // Skill 2: active
        let skill2 = ImportedSkill {
            skill_id: "imp-2".to_string(),
            skill_name: "active-no-trigger".to_string(),
            domain: None,
            is_active: true,
            disk_path: "/tmp/s2".to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,
            trigger_text: None,
        };
        insert_imported_skill(&conn, &skill2).unwrap();

        // Skill 3: inactive
        let skill3 = ImportedSkill {
            skill_id: "imp-3".to_string(),
            skill_name: "inactive-with-trigger".to_string(),
            domain: None,
            is_active: false,
            disk_path: "/tmp/s3".to_string(),
            imported_at: "2025-01-01 00:00:00".to_string(),
            is_bundled: false,
            description: None,
            trigger_text: None,
        };
        insert_imported_skill(&conn, &skill3).unwrap();

        // Only active skills should be returned (inactive filtered out)
        let result = list_active_skills(&conn).unwrap();
        assert_eq!(result.len(), 2);
        // Sorted by skill_name
        assert_eq!(result[0].skill_name, "active-no-trigger");
        assert_eq!(result[1].skill_name, "active-with-trigger");
    }
}
