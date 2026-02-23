use crate::types::{
    AgentRunRecord, AppSettings, ImportedSkill, SkillMasterRow, UsageByModel, UsageByStep,
    UsageSummary, WorkflowRunRow, WorkflowSessionRecord, WorkflowStepRow, WorkspaceSkill,
};
use rusqlite::{Connection, OptionalExtension};
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
        (14, run_source_migration),
        (15, run_imported_skills_extended_migration),
        (16, run_workflow_runs_extended_migration),
        (17, run_cleanup_stale_running_rows_migration),
        (18, run_skills_table_migration),
        (19, run_skills_backfill_migration),
        (20, run_rename_upload_migration),
        (21, run_workspace_skills_migration),
        (22, run_workflow_runs_id_migration),
        (23, run_fk_columns_migration),
        (24, run_frontmatter_to_skills_migration),
        (25, run_workspace_skills_purpose_migration),
    ];

    for &(version, migrate_fn) in migrations {
        if !migration_applied(&conn, version) {
            migrate_fn(&conn)?;
            mark_migration_applied(&conn, version)?;
        }
    }

    // Startup repair: ensure skills master has frontmatter columns regardless of migration state.
    // Idempotent — checks column existence before ALTER TABLE. Guards against dev builds that
    // recorded migration 24 in schema_migrations before the ALTER TABLE statements ran.
    repair_skills_table_schema(&conn).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

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
        );

        CREATE TABLE IF NOT EXISTS skills (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL UNIQUE,
            skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'imported')),
            domain       TEXT,
            skill_type   TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
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

/// Migration 14: Add `source` column to workflow_runs.
/// Defaults to 'created' for all existing rows (user-built skills).
/// 'marketplace' is used for skills imported from the marketplace.
fn run_source_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_source = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .any(|r| r.map(|n| n == "source").unwrap_or(false));
    if !has_source {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'created';",
        )?;
    }
    Ok(())
}

/// Migration 15: Add extended metadata columns to imported_skills.
fn run_imported_skills_extended_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|n| n == "skill_type") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN skill_type TEXT;")?;
    }
    if !columns.iter().any(|n| n == "version") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN version TEXT;")?;
    }
    if !columns.iter().any(|n| n == "model") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN model TEXT;")?;
    }
    if !columns.iter().any(|n| n == "argument_hint") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN argument_hint TEXT;")?;
    }
    if !columns.iter().any(|n| n == "user_invocable") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN user_invocable INTEGER;")?;
    }
    if !columns.iter().any(|n| n == "disable_model_invocation") {
        conn.execute_batch(
            "ALTER TABLE imported_skills ADD COLUMN disable_model_invocation INTEGER;",
        )?;
    }
    Ok(())
}

/// Migration 17: Clean up stale running rows left by crashed sessions.
fn run_cleanup_stale_running_rows_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "UPDATE agent_runs
         SET status = 'shutdown', completed_at = datetime('now') || 'Z'
         WHERE status = 'running';"
    )
}

/// Migration 16: Add extended metadata columns to workflow_runs.
fn run_workflow_runs_extended_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Add description, version, model, argument_hint, user_invocable, disable_model_invocation
    // to workflow_runs. Check each column before adding (idempotent).
    let existing: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    let columns = [
        ("description", "TEXT"),
        ("version", "TEXT DEFAULT '1.0.0'"),
        ("model", "TEXT"),
        ("argument_hint", "TEXT"),
        ("user_invocable", "INTEGER DEFAULT 1"),
        ("disable_model_invocation", "INTEGER DEFAULT 0"),
    ];
    for (col, def) in &columns {
        if !existing.contains(&col.to_string()) {
            conn.execute_batch(&format!("ALTER TABLE workflow_runs ADD COLUMN {} {};", col, def))?;
        }
    }
    Ok(())
}

/// Migration 17: Create the `skills` master table — the single catalog backing
/// the skills library, test tab, and reconciliation.
fn run_skills_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skills (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL UNIQUE,
            skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'imported')),
            domain       TEXT,
            skill_type   TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
        );",
    )?;
    log::info!("migration 17: created skills table");
    Ok(())
}

/// Migration 18: Backfill `skills` from `workflow_runs`, add FK column, backfill FK,
/// and remove marketplace rows from `workflow_runs` (now in skills master only).
fn run_skills_backfill_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Step 1: Backfill skills from workflow_runs
    let backfilled: usize = conn.execute(
        "INSERT OR IGNORE INTO skills (name, skill_source, domain, skill_type, created_at, updated_at)
         SELECT skill_name,
           CASE WHEN source = 'marketplace' THEN 'marketplace' ELSE 'skill-builder' END,
           domain, skill_type, created_at, updated_at
         FROM workflow_runs",
        [],
    )?;

    // Step 2: Add FK column (check PRAGMA table_info first for idempotency)
    let has_skill_id = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .any(|r| r.map(|n| n == "skill_id").unwrap_or(false));
    if !has_skill_id {
        conn.execute_batch(
            "ALTER TABLE workflow_runs ADD COLUMN skill_id INTEGER REFERENCES skills(id);",
        )?;
    }

    // Step 3: Backfill FK
    conn.execute(
        "UPDATE workflow_runs SET skill_id = (SELECT id FROM skills WHERE skills.name = workflow_runs.skill_name)",
        [],
    )?;

    // Step 4: Remove marketplace rows from workflow_runs (now in skills master only)
    conn.execute(
        "DELETE FROM workflow_steps WHERE skill_name IN (SELECT skill_name FROM workflow_runs WHERE source = 'marketplace')",
        [],
    ).ok(); // marketplace skills may not have step rows — ignore errors
    let removed: usize = conn.execute(
        "DELETE FROM workflow_runs WHERE source = 'marketplace'",
        [],
    )?;

    log::info!(
        "migration 18: backfilled {} skills, removed {} marketplace workflow_runs",
        backfilled, removed
    );
    Ok(())
}

fn run_workspace_skills_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch("
        BEGIN;

        CREATE TABLE IF NOT EXISTS workspace_skills (
            skill_id     TEXT PRIMARY KEY,
            skill_name   TEXT UNIQUE NOT NULL,
            domain       TEXT,
            description  TEXT,
            is_active    INTEGER NOT NULL DEFAULT 1,
            is_bundled   INTEGER NOT NULL DEFAULT 0,
            disk_path    TEXT NOT NULL,
            imported_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            skill_type   TEXT,
            version      TEXT,
            model        TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER
        );

        INSERT OR IGNORE INTO workspace_skills
            (skill_id, skill_name, domain, is_active, is_bundled,
             disk_path, imported_at, skill_type, version, model,
             argument_hint, user_invocable, disable_model_invocation)
        SELECT
            skill_id, skill_name, domain, is_active, is_bundled,
            disk_path, imported_at, skill_type, version, model,
            argument_hint, user_invocable, disable_model_invocation
        FROM imported_skills
        WHERE skill_type = 'skill-builder' OR is_bundled = 1;

        DELETE FROM imported_skills WHERE skill_type = 'skill-builder' OR is_bundled = 1;

        COMMIT;
    ")?;
    log::info!("migration 20: created workspace_skills table, migrated skill-builder rows");
    Ok(())
}

/// Migration 21: Add integer primary key to `workflow_runs`.
/// The table previously used `skill_name TEXT PRIMARY KEY`. We recreate it with
/// `id INTEGER PRIMARY KEY AUTOINCREMENT` and `skill_name TEXT UNIQUE NOT NULL`.
/// This unblocks rename_skill (no more INSERT+DELETE) and allows child tables to
/// reference `workflow_runs` by integer FK instead of text `skill_name`.
fn run_workflow_runs_id_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Idempotency guard: check whether the `id` column already exists
    let has_id = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .any(|r| r.map(|n| n == "id").unwrap_or(false));
    if has_id {
        return Ok(());
    }

    conn.execute_batch("
        BEGIN;

        DROP TABLE IF EXISTS workflow_runs_new;

        CREATE TABLE workflow_runs_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name  TEXT UNIQUE NOT NULL,
            domain      TEXT NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'pending',
            created_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            skill_type  TEXT DEFAULT 'domain',
            source      TEXT NOT NULL DEFAULT 'created',
            description TEXT,
            version     TEXT DEFAULT '1.0.0',
            model       TEXT,
            argument_hint TEXT,
            user_invocable INTEGER DEFAULT 1,
            disable_model_invocation INTEGER DEFAULT 0,
            author_login TEXT,
            author_avatar TEXT,
            display_name TEXT,
            intake_json TEXT,
            skill_id    INTEGER REFERENCES skills(id)
        );

        INSERT INTO workflow_runs_new
            (skill_name, domain, current_step, status, created_at, updated_at,
             skill_type, source, description, version, model, argument_hint,
             user_invocable, disable_model_invocation, author_login, author_avatar,
             display_name, intake_json, skill_id)
        SELECT skill_name, domain, current_step, status, created_at, updated_at,
               skill_type, COALESCE(source, 'created'), description, version, model,
               argument_hint, user_invocable, disable_model_invocation,
               author_login, author_avatar, display_name, intake_json, skill_id
        FROM workflow_runs;

        DROP TABLE workflow_runs;
        ALTER TABLE workflow_runs_new RENAME TO workflow_runs;

        COMMIT;
    ")?;

    log::info!("migration 21: added integer PK to workflow_runs");
    Ok(())
}

/// Migration 22: Add integer FK columns to child tables and backfill from skill_name.
/// After this migration:
///   - workflow_steps, workflow_artifacts, agent_runs: have `workflow_run_id INT FK → workflow_runs(id)`
///   - skill_tags, skill_locks, workflow_sessions: have `skill_id INT FK → skills(id)`
///   - imported_skills: has `skill_master_id INT FK → skills(id)`
fn run_fk_columns_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Helper to check if a column exists in a table
    let has_column = |table: &str, column: &str| -> bool {
        conn.prepare(&format!("PRAGMA table_info({})", table))
            .and_then(|mut stmt| {
                stmt.query_map([], |r| r.get::<_, String>(1))
                    .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == column))
            })
            .unwrap_or(false)
    };

    // --- workflow_steps ---
    if !has_column("workflow_steps", "workflow_run_id") {
        conn.execute_batch(
            "ALTER TABLE workflow_steps ADD COLUMN workflow_run_id INTEGER REFERENCES workflow_runs(id);",
        )?;
    }

    // --- workflow_artifacts ---
    if !has_column("workflow_artifacts", "workflow_run_id") {
        conn.execute_batch(
            "ALTER TABLE workflow_artifacts ADD COLUMN workflow_run_id INTEGER REFERENCES workflow_runs(id);",
        )?;
    }

    // --- agent_runs ---
    if !has_column("agent_runs", "workflow_run_id") {
        conn.execute_batch(
            "ALTER TABLE agent_runs ADD COLUMN workflow_run_id INTEGER REFERENCES workflow_runs(id);",
        )?;
    }

    // --- skill_tags ---
    if !has_column("skill_tags", "skill_id") {
        conn.execute_batch(
            "ALTER TABLE skill_tags ADD COLUMN skill_id INTEGER REFERENCES skills(id);",
        )?;
    }

    // --- skill_locks ---
    if !has_column("skill_locks", "skill_id") {
        conn.execute_batch(
            "ALTER TABLE skill_locks ADD COLUMN skill_id INTEGER REFERENCES skills(id);",
        )?;
    }

    // --- workflow_sessions ---
    if !has_column("workflow_sessions", "skill_id") {
        conn.execute_batch(
            "ALTER TABLE workflow_sessions ADD COLUMN skill_id INTEGER REFERENCES skills(id);",
        )?;
    }

    // --- imported_skills ---
    if !has_column("imported_skills", "skill_master_id") {
        conn.execute_batch(
            "ALTER TABLE imported_skills ADD COLUMN skill_master_id INTEGER REFERENCES skills(id);",
        )?;
    }

    // Backfill all new FK columns in a single transaction
    conn.execute_batch("
        BEGIN;

        UPDATE workflow_steps
        SET workflow_run_id = (
            SELECT wr.id FROM workflow_runs wr WHERE wr.skill_name = workflow_steps.skill_name
        )
        WHERE workflow_run_id IS NULL;

        UPDATE workflow_artifacts
        SET workflow_run_id = (
            SELECT wr.id FROM workflow_runs wr WHERE wr.skill_name = workflow_artifacts.skill_name
        )
        WHERE workflow_run_id IS NULL;

        UPDATE agent_runs
        SET workflow_run_id = (
            SELECT wr.id FROM workflow_runs wr WHERE wr.skill_name = agent_runs.skill_name
        )
        WHERE workflow_run_id IS NULL;

        UPDATE skill_tags
        SET skill_id = (
            SELECT s.id FROM skills s WHERE s.name = skill_tags.skill_name
        )
        WHERE skill_id IS NULL;

        UPDATE skill_locks
        SET skill_id = (
            SELECT s.id FROM skills s WHERE s.name = skill_locks.skill_name
        )
        WHERE skill_id IS NULL;

        UPDATE workflow_sessions
        SET skill_id = (
            SELECT s.id FROM skills s WHERE s.name = workflow_sessions.skill_name
        )
        WHERE skill_id IS NULL;

        UPDATE imported_skills
        SET skill_master_id = (
            SELECT s.id FROM skills s WHERE s.name = imported_skills.skill_name
        )
        WHERE skill_master_id IS NULL;

        COMMIT;
    ")?;

    log::info!("migration 22: added FK columns to child tables and backfilled");
    Ok(())
}

/// Migration 24: Add SKILL.md frontmatter fields to the `skills` master table.
/// These fields (description, version, model, argument_hint, user_invocable,
/// disable_model_invocation) apply to ALL skill sources and belong in the canonical
/// `skills` table rather than per-source tables (workflow_runs / imported_skills).
/// Backfills from workflow_runs (skill-builder) and imported_skills (marketplace/imported).
fn run_frontmatter_to_skills_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let existing_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    for (col, def) in &[
        ("description", "TEXT"),
        ("version", "TEXT"),
        ("model", "TEXT"),
        ("argument_hint", "TEXT"),
        ("user_invocable", "INTEGER"),
        ("disable_model_invocation", "INTEGER"),
    ] {
        if !existing_cols.contains(&col.to_string()) {
            conn.execute_batch(&format!("ALTER TABLE skills ADD COLUMN {} {};", col, def))?;
        }
    }

    // Backfill from workflow_runs for skill-builder skills
    conn.execute_batch(
        "UPDATE skills
         SET
           description = COALESCE(skills.description, (
               SELECT wr.description FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
           version = COALESCE(skills.version, (
               SELECT wr.version FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
           model = COALESCE(skills.model, (
               SELECT wr.model FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
           argument_hint = COALESCE(skills.argument_hint, (
               SELECT wr.argument_hint FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
           user_invocable = COALESCE(skills.user_invocable, (
               SELECT wr.user_invocable FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
           disable_model_invocation = COALESCE(skills.disable_model_invocation, (
               SELECT wr.disable_model_invocation FROM workflow_runs wr WHERE wr.skill_name = skills.name))
         WHERE skill_source = 'skill-builder';",
    )?;

    // Backfill from imported_skills for marketplace/imported skills
    // Note: description was dropped from imported_skills in migration 12; stays NULL here
    conn.execute_batch(
        "UPDATE skills
         SET
           version = COALESCE(skills.version, (
               SELECT imp.version FROM imported_skills imp WHERE imp.skill_name = skills.name)),
           model = COALESCE(skills.model, (
               SELECT imp.model FROM imported_skills imp WHERE imp.skill_name = skills.name)),
           argument_hint = COALESCE(skills.argument_hint, (
               SELECT imp.argument_hint FROM imported_skills imp WHERE imp.skill_name = skills.name)),
           user_invocable = COALESCE(skills.user_invocable, (
               SELECT imp.user_invocable FROM imported_skills imp WHERE imp.skill_name = skills.name)),
           disable_model_invocation = COALESCE(skills.disable_model_invocation, (
               SELECT imp.disable_model_invocation FROM imported_skills imp WHERE imp.skill_name = skills.name))
         WHERE skill_source IN ('marketplace', 'imported');",
    )?;

    log::info!("migration 24: added frontmatter fields to skills master, backfilled from workflow_runs and imported_skills");
    Ok(())
}

/// Ensure the six frontmatter columns exist in the `skills` table and are populated.
/// Idempotent — checks PRAGMA table_info before each ALTER TABLE.
/// Called every startup to guard against dev builds that recorded migration 24 in
/// schema_migrations before the ALTER TABLE statements actually executed.
fn repair_skills_table_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    let mut added_any = false;
    for (col, def) in &[
        ("description", "TEXT"),
        ("version", "TEXT"),
        ("model", "TEXT"),
        ("argument_hint", "TEXT"),
        ("user_invocable", "INTEGER"),
        ("disable_model_invocation", "INTEGER"),
    ] {
        if !cols.contains(&col.to_string()) {
            conn.execute_batch(&format!("ALTER TABLE skills ADD COLUMN {} {};", col, def))?;
            log::info!("repair_skills_table_schema: added missing column '{}' to skills", col);
            added_any = true;
        }
    }

    // If any column was missing, the migration 24 backfill never ran either.
    // Run it now so existing imported/marketplace skills have their version/model populated.
    if added_any {
        conn.execute_batch(
            "UPDATE skills
             SET
               description = COALESCE(skills.description, (
                   SELECT wr.description FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
               version = COALESCE(skills.version, (
                   SELECT wr.version FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
               model = COALESCE(skills.model, (
                   SELECT wr.model FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
               argument_hint = COALESCE(skills.argument_hint, (
                   SELECT wr.argument_hint FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
               user_invocable = COALESCE(skills.user_invocable, (
                   SELECT wr.user_invocable FROM workflow_runs wr WHERE wr.skill_name = skills.name)),
               disable_model_invocation = COALESCE(skills.disable_model_invocation, (
                   SELECT wr.disable_model_invocation FROM workflow_runs wr WHERE wr.skill_name = skills.name))
             WHERE skill_source = 'skill-builder';"
        )?;
        conn.execute_batch(
            "UPDATE skills
             SET
               version = COALESCE(skills.version, (
                   SELECT imp.version FROM imported_skills imp WHERE imp.skill_name = skills.name)),
               model = COALESCE(skills.model, (
                   SELECT imp.model FROM imported_skills imp WHERE imp.skill_name = skills.name)),
               argument_hint = COALESCE(skills.argument_hint, (
                   SELECT imp.argument_hint FROM imported_skills imp WHERE imp.skill_name = skills.name)),
               user_invocable = COALESCE(skills.user_invocable, (
                   SELECT imp.user_invocable FROM imported_skills imp WHERE imp.skill_name = skills.name)),
               disable_model_invocation = COALESCE(skills.disable_model_invocation, (
                   SELECT imp.disable_model_invocation FROM imported_skills imp WHERE imp.skill_name = skills.name))
             WHERE skill_source IN ('marketplace', 'imported');"
        )?;
        log::info!("repair_skills_table_schema: backfilled frontmatter fields from workflow_runs and imported_skills");
    }

    Ok(())
}

fn run_workspace_skills_purpose_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_column = conn.prepare("PRAGMA table_info(workspace_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == "purpose"))
        })
        .unwrap_or(false);
    if !has_column {
        conn.execute_batch("ALTER TABLE workspace_skills ADD COLUMN purpose TEXT;")?;
    }
    log::info!("migration 25: added purpose column to workspace_skills");
    Ok(())
}

fn run_rename_upload_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Rename upload → imported
    conn.execute("UPDATE skills SET skill_source = 'imported' WHERE skill_source = 'upload'", [])?;
    // Clean orphaned non-bundled imported_skills with no skills master row
    conn.execute(
        "DELETE FROM imported_skills WHERE is_bundled = 0 AND skill_name NOT IN (SELECT name FROM skills)",
        [],
    )?;
    log::info!("migration 19: renamed upload→imported, cleaned orphaned imported_skills");
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
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

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
             WHERE workflow_run_id = ?1 AND step_id = ?2
               AND status IN ('completed', 'error')
               AND reset_marker IS NULL
             ORDER BY completed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![wr_id, step_id], |row| {
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

// --- Skills Master ---

/// Upsert a row in the `skills` master table. Used by `save_workflow_run` (skill-builder)
/// and marketplace import. Returns the skill id.
pub fn upsert_skill(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    domain: &str,
    skill_type: &str,
) -> Result<i64, String> {
    log::debug!("upsert_skill: name={} skill_source={}", name, skill_source);
    conn.execute(
        "INSERT INTO skills (name, skill_source, domain, skill_type, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
             domain = ?3, skill_type = ?4, updated_at = datetime('now')",
        rusqlite::params![name, skill_source, domain, skill_type],
    )
    .map_err(|e| {
        log::error!("upsert_skill: failed to upsert '{}': {}", name, e);
        e.to_string()
    })?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(|e| {
            log::error!("upsert_skill: failed to retrieve id for '{}': {}", name, e);
            e.to_string()
        })?;
    Ok(id)
}

/// Like `upsert_skill`, but ALWAYS updates `skill_source` on conflict.
/// Use this when the caller explicitly wants to set the source (e.g. `resolve_discovery`).
/// `upsert_skill` intentionally skips `skill_source` on conflict to prevent
/// `save_workflow_run` from overwriting a marketplace skill's source.
pub fn upsert_skill_with_source(
    conn: &Connection,
    name: &str,
    skill_source: &str,
    domain: &str,
    skill_type: &str,
) -> Result<i64, String> {
    log::debug!("upsert_skill_with_source: name={} skill_source={}", name, skill_source);
    conn.execute(
        "INSERT INTO skills (name, skill_source, domain, skill_type, updated_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))
         ON CONFLICT(name) DO UPDATE SET
             skill_source = ?2, domain = ?3, skill_type = ?4, updated_at = datetime('now')",
        rusqlite::params![name, skill_source, domain, skill_type],
    )
    .map_err(|e| {
        log::error!("upsert_skill_with_source: failed to upsert '{}': {}", name, e);
        e.to_string()
    })?;
    let id: i64 = conn
        .query_row(
            "SELECT id FROM skills WHERE name = ?1",
            rusqlite::params![name],
            |row| row.get(0),
        )
        .map_err(|e| {
            log::error!("upsert_skill_with_source: failed to retrieve id for '{}': {}", name, e);
            e.to_string()
        })?;
    Ok(id)
}

/// List all skills from the master table, ordered by name.
pub fn list_all_skills(conn: &Connection) -> Result<Vec<SkillMasterRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, skill_source, domain, skill_type, created_at, updated_at,
                    description, version, model, argument_hint, user_invocable, disable_model_invocation
             FROM skills ORDER BY name",
        )
        .map_err(|e| {
            log::error!("list_all_skills: failed to prepare query: {}", e);
            e.to_string()
        })?;

    let rows = stmt
        .query_map([], |row| {
            Ok(SkillMasterRow {
                id: row.get(0)?,
                name: row.get(1)?,
                skill_source: row.get(2)?,
                domain: row.get(3)?,
                skill_type: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
                description: row.get(7)?,
                version: row.get(8)?,
                model: row.get(9)?,
                argument_hint: row.get(10)?,
                user_invocable: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
                disable_model_invocation: row.get::<_, Option<i32>>(12)?.map(|v| v != 0),
            })
        })
        .map_err(|e| {
            log::error!("list_all_skills: query failed: {}", e);
            e.to_string()
        })?;

    let result: Vec<SkillMasterRow> = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| {
            log::error!("list_all_skills: failed to collect rows: {}", e);
            e.to_string()
        })?;
    log::debug!("list_all_skills: returning {} skills", result.len());
    Ok(result)
}

/// Delete a skill from the master table by name.
pub fn delete_skill(conn: &Connection, name: &str) -> Result<(), String> {
    log::info!("delete_skill: name={}", name);
    conn.execute("DELETE FROM skills WHERE name = ?1", rusqlite::params![name])
        .map_err(|e| {
            log::error!("delete_skill: failed to delete '{}': {}", name, e);
            e.to_string()
        })?;
    Ok(())
}

/// Get the `workflow_runs.id` integer for a given `skill_name`. Returns None if not found.
pub fn get_workflow_run_id(conn: &Connection, skill_name: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM workflow_runs WHERE skill_name = ?1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

/// Get the `skills.id` integer for a given skill name. Returns None if not found.
pub fn get_skill_master_id(conn: &Connection, skill_name: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM skills WHERE name = ?1",
        rusqlite::params![skill_name],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
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
    // Ensure the skills master row exists (skill-builder source)
    let skill_id = upsert_skill(conn, skill_name, "skill-builder", domain, skill_type)?;
    conn.execute(
        "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, skill_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now') || 'Z')
         ON CONFLICT(skill_name) DO UPDATE SET
             domain = ?2, current_step = ?3, status = ?4, skill_type = ?5, skill_id = ?6, updated_at = datetime('now') || 'Z'",
        rusqlite::params![skill_name, domain, current_step, status, skill_type, skill_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Insert a marketplace skill into the skills master table only. No workflow_runs row.
/// Replaces `save_marketplace_skill_run` — marketplace skills no longer get workflow_runs rows.
pub fn save_marketplace_skill(
    conn: &Connection,
    skill_name: &str,
    domain: &str,
    skill_type: &str,
) -> Result<(), String> {
    log::info!("save_marketplace_skill: name={}", skill_name);
    upsert_skill(conn, skill_name, "marketplace", domain, skill_type).map_err(|e| {
        log::error!("save_marketplace_skill: failed for '{}': {}", skill_name, e);
        e
    })?;
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
    let disable_model_invocation_i: Option<i32> = disable_model_invocation.map(|v| if v { 1 } else { 0 });

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

    // Dual-write to workflow_runs for skill-builder skills (no-op for marketplace/imported).
    // These columns will be dropped from workflow_runs in a future migration.
    conn.execute(
        "UPDATE workflow_runs SET
            description = COALESCE(?2, description),
            version = COALESCE(?3, version),
            model = COALESCE(?4, model),
            argument_hint = COALESCE(?5, argument_hint),
            user_invocable = COALESCE(?6, user_invocable),
            disable_model_invocation = COALESCE(?7, disable_model_invocation),
            updated_at = datetime('now') || 'Z'
         WHERE skill_name = ?1",
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

pub fn get_workflow_run(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<WorkflowRunRow>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar, display_name, intake_json, COALESCE(source, 'created'), description, version, model, argument_hint, user_invocable, disable_model_invocation
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
            source: row.get(11)?,
            description: row.get(12)?,
            version: row.get(13)?,
            model: row.get(14)?,
            argument_hint: row.get(15)?,
            user_invocable: row.get::<_, Option<i32>>(16)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(17)?.map(|v| v != 0),
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
            "SELECT skill_name, domain, current_step, status, skill_type, created_at, updated_at, author_login, author_avatar, display_name, intake_json, COALESCE(source, 'created'), description, version, model, argument_hint, user_invocable, disable_model_invocation
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
                source: row.get(11)?,
                description: row.get(12)?,
                version: row.get(13)?,
                model: row.get(14)?,
                argument_hint: row.get(15)?,
                user_invocable: row.get::<_, Option<i32>>(16)?.map(|v| v != 0),
                disable_model_invocation: row.get::<_, Option<i32>>(17)?.map(|v| v != 0),
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn delete_workflow_run(conn: &Connection, skill_name: &str) -> Result<(), String> {
    // Look up FK ids before deleting the parent rows
    let wr_id = get_workflow_run_id(conn, skill_name)?
        .ok_or_else(|| format!("Workflow run not found for skill '{}'", skill_name))?;
    let s_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found in skills master", skill_name))?;

    // Delete child rows by FK columns only (migration 22 guarantees no NULL FKs)
    conn.execute(
        "DELETE FROM workflow_artifacts WHERE workflow_run_id = ?1",
        rusqlite::params![wr_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_steps WHERE workflow_run_id = ?1",
        rusqlite::params![wr_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM agent_runs WHERE workflow_run_id = ?1",
        rusqlite::params![wr_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM skill_locks WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_sessions WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM skill_tags WHERE skill_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    // Delete from imported_skills to prevent stale rows blocking re-import
    conn.execute(
        "DELETE FROM imported_skills WHERE skill_master_id = ?1",
        rusqlite::params![s_id],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "DELETE FROM workflow_runs WHERE skill_name = ?1",
        [skill_name],
    )
    .map_err(|e| e.to_string())?;

    // Also delete from skills master table
    delete_skill(conn, skill_name)?;
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

    let workflow_run_id = get_workflow_run_id(conn, skill_name)?;

    conn.execute(
        "INSERT INTO workflow_steps (skill_name, step_id, status, started_at, completed_at, workflow_run_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(skill_name, step_id) DO UPDATE SET
             status = ?3,
             started_at = COALESCE(?4, started_at),
             completed_at = ?5,
             workflow_run_id = COALESCE(?6, workflow_run_id)",
        rusqlite::params![skill_name, step_id, status, started, completed, workflow_run_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_workflow_steps(
    conn: &Connection,
    skill_name: &str,
) -> Result<Vec<WorkflowStepRow>, String> {
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let mut stmt = conn
        .prepare(
            "SELECT skill_name, step_id, status, started_at, completed_at
             FROM workflow_steps WHERE workflow_run_id = ?1 ORDER BY step_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params![wr_id], |row| {
            Ok(WorkflowStepRow {
                skill_name: row.get(0)?,
                step_id: row.get(1)?,
                status: row.get(2)?,
                started_at: row.get(3)?,
                completed_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())
}

pub fn reset_workflow_steps_from(
    conn: &Connection,
    skill_name: &str,
    from_step: i32,
) -> Result<(), String> {
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(()),
    };
    conn.execute(
        "UPDATE workflow_steps SET status = 'pending', started_at = NULL, completed_at = NULL
         WHERE workflow_run_id = ?1 AND step_id >= ?2",
        rusqlite::params![wr_id, from_step],
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
        "SELECT skill_name, tag FROM skill_tags WHERE skill_id IN (SELECT id FROM skills WHERE name IN ({})) ORDER BY skill_name, tag",
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
    let s_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| format!("Skill '{}' not found in skills master", skill_name))?;

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
pub fn insert_imported_skill(
    conn: &Connection,
    skill: &ImportedSkill,
) -> Result<(), String> {
    let skill_master_id = get_skill_master_id(conn, &skill.skill_name)?;
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled,
             skill_type, version, model, argument_hint, user_invocable, disable_model_invocation, skill_master_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.domain,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
            skill.skill_type,
            skill.version,
            skill.model,
            skill.argument_hint,
            skill.user_invocable.map(|v| v as i32),
            skill.disable_model_invocation.map(|v| v as i32),
            skill_master_id,
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
pub fn upsert_imported_skill(
    conn: &Connection,
    skill: &ImportedSkill,
) -> Result<(), String> {
    let skill_master_id = get_skill_master_id(conn, &skill.skill_name)?;
    conn.execute(
        "INSERT INTO imported_skills (skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled,
             skill_type, version, model, argument_hint, user_invocable, disable_model_invocation, skill_master_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(skill_name) DO UPDATE SET
             skill_id = excluded.skill_id,
             domain = excluded.domain,
             disk_path = excluded.disk_path,
             imported_at = excluded.imported_at,
             skill_type = excluded.skill_type,
             version = excluded.version,
             model = excluded.model,
             argument_hint = excluded.argument_hint,
             user_invocable = excluded.user_invocable,
             disable_model_invocation = excluded.disable_model_invocation,
             skill_master_id = excluded.skill_master_id",
        rusqlite::params![
            skill.skill_id,
            skill.skill_name,
            skill.domain,
            skill.is_active as i32,
            skill.disk_path,
            skill.imported_at,
            skill.is_bundled as i32,
            skill.skill_type,
            skill.version,
            skill.model,
            skill.argument_hint,
            skill.user_invocable.map(|v| v as i32),
            skill.disable_model_invocation.map(|v| v as i32),
            skill_master_id,
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
    conn.execute("DELETE FROM imported_skills WHERE skill_master_id = ?1", rusqlite::params![s_id])
        .map_err(|e| {
            log::error!("delete_imported_skill_by_name: failed to delete '{}': {}", name, e);
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
            "SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled,
                    skill_type, version, model, argument_hint, user_invocable, disable_model_invocation
             FROM imported_skills WHERE skill_master_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt.query_row(rusqlite::params![s_id], |row| {
        Ok(ImportedSkill {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            domain: row.get(2)?,
            is_active: row.get::<_, i32>(3)? != 0,
            disk_path: row.get(4)?,
            imported_at: row.get(5)?,
            is_bundled: row.get::<_, i32>(6)? != 0,
            description: None,
            skill_type: row.get(7)?,
            version: row.get(8)?,
            model: row.get(9)?,
            argument_hint: row.get(10)?,
            user_invocable: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
            disable_model_invocation: row.get::<_, Option<i32>>(12)?.map(|v| v != 0),
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
            "SELECT skill_id, skill_name, domain, is_active, disk_path, imported_at, is_bundled,
                    skill_type, version, model, argument_hint, user_invocable, disable_model_invocation
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
                skill_type: row.get(7)?,
                version: row.get(8)?,
                model: row.get(9)?,
                argument_hint: row.get(10)?,
                user_invocable: row.get::<_, Option<i32>>(11)?.map(|v| v != 0),
                disable_model_invocation: row.get::<_, Option<i32>>(12)?.map(|v| v != 0),
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

// --- Workspace Skills (Settings → Skills tab) ---

const WS_COLUMNS: &str = "skill_id, skill_name, domain, description, is_active, is_bundled, disk_path, imported_at, skill_type, version, model, argument_hint, user_invocable, disable_model_invocation, purpose";

fn ws_params(skill: &WorkspaceSkill) -> [rusqlite::types::Value; 15] {
    use rusqlite::types::Value;
    [
        Value::Text(skill.skill_id.clone()),
        Value::Text(skill.skill_name.clone()),
        skill.domain.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        skill.description.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        Value::Integer(skill.is_active as i64),
        Value::Integer(skill.is_bundled as i64),
        Value::Text(skill.disk_path.clone()),
        Value::Text(skill.imported_at.clone()),
        skill.skill_type.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        skill.version.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        skill.model.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        skill.argument_hint.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
        skill.user_invocable.map_or(Value::Null, |b| Value::Integer(b as i64)),
        skill.disable_model_invocation.map_or(Value::Null, |b| Value::Integer(b as i64)),
        skill.purpose.as_ref().map_or(Value::Null, |v| Value::Text(v.clone())),
    ]
}

pub fn insert_workspace_skill(conn: &Connection, skill: &WorkspaceSkill) -> Result<(), String> {
    conn.execute(
        &format!("INSERT INTO workspace_skills ({WS_COLUMNS}) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)"),
        rusqlite::params_from_iter(ws_params(skill)),
    ).map_err(|e| {
        if e.to_string().contains("UNIQUE") {
            format!("Skill '{}' has already been imported", skill.skill_name)
        } else {
            format!("insert_workspace_skill: {}", e)
        }
    })?;
    Ok(())
}

pub fn upsert_workspace_skill(conn: &Connection, skill: &WorkspaceSkill) -> Result<(), String> {
    conn.execute(
        &format!(
            "INSERT INTO workspace_skills ({WS_COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(skill_name) DO UPDATE SET
                 domain = excluded.domain,
                 description = excluded.description,
                 is_bundled = excluded.is_bundled,
                 disk_path = excluded.disk_path,
                 skill_type = excluded.skill_type,
                 version = excluded.version,
                 model = excluded.model,
                 argument_hint = excluded.argument_hint,
                 user_invocable = excluded.user_invocable,
                 disable_model_invocation = excluded.disable_model_invocation,
                 purpose = excluded.purpose"
        ),
        rusqlite::params_from_iter(ws_params(skill)),
    ).map_err(|e| format!("upsert_workspace_skill: {}", e))?;
    Ok(())
}

/// Re-seed a bundled skill: overwrites all frontmatter + disk path, preserves is_active.
pub fn upsert_bundled_workspace_skill(conn: &Connection, skill: &WorkspaceSkill) -> Result<(), String> {
    conn.execute(
        &format!(
            "INSERT INTO workspace_skills ({WS_COLUMNS})
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
             ON CONFLICT(skill_name) DO UPDATE SET
                 domain = excluded.domain,
                 description = excluded.description,
                 is_bundled = 1,
                 disk_path = excluded.disk_path,
                 skill_type = excluded.skill_type,
                 version = excluded.version,
                 model = excluded.model,
                 argument_hint = excluded.argument_hint,
                 user_invocable = excluded.user_invocable,
                 disable_model_invocation = excluded.disable_model_invocation,
                 purpose = excluded.purpose
                 -- is_active intentionally NOT updated: preserves user's deactivation"
        ),
        rusqlite::params_from_iter(ws_params(skill)),
    ).map_err(|e| format!("upsert_bundled_workspace_skill: {}", e))?;
    Ok(())
}

fn row_to_workspace_skill(row: &rusqlite::Row) -> rusqlite::Result<WorkspaceSkill> {
    let is_active: i64 = row.get(4)?;
    let is_bundled: i64 = row.get(5)?;
    let user_invocable: Option<i64> = row.get(12)?;
    let disable_model_invocation: Option<i64> = row.get(13)?;
    Ok(WorkspaceSkill {
        skill_id: row.get(0)?,
        skill_name: row.get(1)?,
        domain: row.get(2)?,
        description: row.get(3)?,
        is_active: is_active != 0,
        is_bundled: is_bundled != 0,
        disk_path: row.get(6)?,
        imported_at: row.get(7)?,
        skill_type: row.get(8)?,
        version: row.get(9)?,
        model: row.get(10)?,
        argument_hint: row.get(11)?,
        user_invocable: user_invocable.map(|v| v != 0),
        disable_model_invocation: disable_model_invocation.map(|v| v != 0),
        purpose: row.get(14)?,
    })
}

pub fn list_workspace_skills(conn: &Connection) -> Result<Vec<WorkspaceSkill>, String> {
    let mut stmt = conn.prepare(
        &format!("SELECT {WS_COLUMNS} FROM workspace_skills ORDER BY imported_at DESC")
    ).map_err(|e| format!("list_workspace_skills: {}", e))?;
    let skills = stmt.query_map([], row_to_workspace_skill)
        .map_err(|e| format!("list_workspace_skills query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list_workspace_skills collect: {}", e))?;
    Ok(skills)
}

pub fn list_active_workspace_skills(conn: &Connection) -> Result<Vec<WorkspaceSkill>, String> {
    let mut stmt = conn.prepare(
        &format!("SELECT {WS_COLUMNS} FROM workspace_skills WHERE is_active = 1 ORDER BY skill_name")
    ).map_err(|e| format!("list_active_workspace_skills: {}", e))?;
    let skills = stmt.query_map([], row_to_workspace_skill)
        .map_err(|e| format!("list_active_workspace_skills query: {}", e))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("list_active_workspace_skills collect: {}", e))?;
    Ok(skills)
}

pub fn update_workspace_skill_active(conn: &Connection, skill_id: &str, is_active: bool, new_disk_path: &str) -> Result<(), String> {
    let rows = conn.execute(
        "UPDATE workspace_skills SET is_active = ?1, disk_path = ?2 WHERE skill_id = ?3",
        rusqlite::params![is_active as i64, new_disk_path, skill_id],
    ).map_err(|e| format!("update_workspace_skill_active: {}", e))?;
    if rows == 0 {
        return Err(format!("Workspace skill with id '{}' not found", skill_id));
    }
    Ok(())
}

pub fn delete_workspace_skill(conn: &Connection, skill_id: &str) -> Result<(), String> {
    conn.execute(
        "DELETE FROM workspace_skills WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    ).map_err(|e| format!("delete_workspace_skill: {}", e))?;
    Ok(())
}

pub fn get_workspace_skill(conn: &Connection, skill_id: &str) -> Result<Option<WorkspaceSkill>, String> {
    let mut stmt = conn.prepare(
        &format!("SELECT {WS_COLUMNS} FROM workspace_skills WHERE skill_id = ?1")
    ).map_err(|e| format!("get_workspace_skill: {}", e))?;
    let mut rows = stmt.query_map(rusqlite::params![skill_id], row_to_workspace_skill)
        .map_err(|e| format!("get_workspace_skill query: {}", e))?;
    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("get_workspace_skill row: {}", e))?)),
        None => Ok(None),
    }
}

/// Look up a workspace skill by name. Used when skill_id is not known.
pub fn get_workspace_skill_by_name(conn: &Connection, skill_name: &str) -> Result<Option<WorkspaceSkill>, String> {
    let mut stmt = conn.prepare(
        &format!("SELECT {WS_COLUMNS} FROM workspace_skills WHERE skill_name = ?1")
    ).map_err(|e| format!("get_workspace_skill_by_name: {}", e))?;
    let mut rows = stmt.query_map(rusqlite::params![skill_name], row_to_workspace_skill)
        .map_err(|e| format!("get_workspace_skill_by_name query: {}", e))?;
    match rows.next() {
        Some(row) => Ok(Some(row.map_err(|e| format!("get_workspace_skill_by_name row: {}", e))?)),
        None => Ok(None),
    }
}

/// Look up an active workspace skill by its purpose tag.
/// Returns the first active skill with the given purpose, or None if not found.
pub fn get_workspace_skill_by_purpose(
    conn: &Connection,
    purpose: &str,
) -> rusqlite::Result<Option<WorkspaceSkill>> {
    let mut stmt = conn.prepare(
        &format!("SELECT {WS_COLUMNS} FROM workspace_skills WHERE purpose = ?1 AND is_active = 1 LIMIT 1")
    )?;
    let mut rows = stmt.query_map(rusqlite::params![purpose], row_to_workspace_skill)?;
    match rows.next() {
        Some(row) => Ok(Some(row?)),
        None => Ok(None),
    }
}

/// Return the names of all locally installed skills.
/// Combines workflow_runs (generated/marketplace skills), imported_skills (GitHub imports),
/// and workspace_skills (Settings → Skills).
pub fn get_all_installed_skill_names(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare(
        "SELECT skill_name FROM workflow_runs
         UNION
         SELECT skill_name FROM imported_skills
         UNION
         SELECT skill_name FROM workspace_skills"
    ).map_err(|e| e.to_string())?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
}

/// Return names of all skills in the skills master table.
/// Used by the skill-library (dashboard) path to check which skills are already installed.
pub fn get_dashboard_skill_names(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn.prepare("SELECT name FROM skills")
        .map_err(|e| e.to_string())?;
    let names = stmt.query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(names)
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

    let skill_master_id = get_skill_master_id(conn, skill_name)?
        .ok_or_else(|| "Skill not found in skills master".to_string());

    let result = (|| -> Result<(), String> {
        let s_id = skill_master_id?;
        if let Some(existing) = get_skill_lock(conn, skill_name)? {
            if existing.instance_id == instance_id {
                return Ok(()); // Already locked by us
            }
            if !check_pid_alive(existing.pid) {
                // Dead process — reclaim using skill_id FK
                conn.execute(
                    "DELETE FROM skill_locks WHERE skill_id = ?1",
                    rusqlite::params![s_id],
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
            "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![skill_name, s_id, instance_id, pid as i64],
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
    let s_id = match get_skill_master_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(()), // Lock doesn't exist — nothing to release
    };
    conn.execute(
        "DELETE FROM skill_locks WHERE skill_id = ?1 AND instance_id = ?2",
        rusqlite::params![s_id, instance_id],
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
    let s_id = match get_skill_master_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(None),
    };

    let mut stmt = conn
        .prepare(
            "SELECT skill_name, instance_id, pid, acquired_at FROM skill_locks WHERE skill_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt.query_row(rusqlite::params![s_id], |row| {
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
            // Use skill_id FK; fall back to skill_name only as a last-resort
            // defensive cleanup (reclaim is best-effort and must not abort on lookup failure).
            if let Ok(Some(s_id)) = get_skill_master_id(conn, &lock.skill_name) {
                conn.execute(
                    "DELETE FROM skill_locks WHERE skill_id = ?1",
                    rusqlite::params![s_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                conn.execute(
                    "DELETE FROM skill_locks WHERE skill_name = ?1",
                    [&lock.skill_name],
                )
                .map_err(|e| e.to_string())?;
            }
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
    let skill_master_id = get_skill_master_id(conn, skill_name)?;
    conn.execute(
        "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, skill_id, pid) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![session_id, skill_name, skill_master_id, pid as i64],
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
    let s_id = match get_skill_master_id(conn, skill_name) {
        Ok(Some(id)) => id,
        _ => return false,
    };

    let mut stmt = match conn.prepare(
        "SELECT pid FROM workflow_sessions WHERE skill_id = ?1 AND ended_at IS NULL",
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };

    let pids: Vec<u32> = match stmt.query_map(rusqlite::params![s_id], |row| {
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
        run_source_migration(&conn).unwrap();
        run_imported_skills_extended_migration(&conn).unwrap();
        run_workflow_runs_extended_migration(&conn).unwrap();
        run_skills_table_migration(&conn).unwrap();
        run_skills_backfill_migration(&conn).unwrap();
        run_rename_upload_migration(&conn).unwrap();
        run_workspace_skills_migration(&conn).unwrap();
        run_workflow_runs_id_migration(&conn).unwrap();
        run_fk_columns_migration(&conn).unwrap();
        run_frontmatter_to_skills_migration(&conn).unwrap();
        run_workspace_skills_purpose_migration(&conn).unwrap();
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
            marketplace_url: None,
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
            marketplace_url: None,
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
            marketplace_url: None,
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
            marketplace_url: None,
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
        // Workflow run must exist so get_workflow_steps can resolve the FK
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();
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
        // Workflow run must exist so reset_workflow_steps_from can resolve the FK
        save_workflow_run(&conn, "test-skill", "domain", 0, "pending", "domain").unwrap();
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

    // --- Skills Master CRUD tests ---

    #[test]
    fn test_upsert_skill_insert_and_return_id() {
        let conn = create_test_db();
        let id = upsert_skill(&conn, "my-skill", "skill-builder", "sales", "domain").unwrap();
        assert!(id > 0);

        // Verify the row exists
        let skills = list_all_skills(&conn).unwrap();
        let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
        assert_eq!(skill.name, "my-skill");
        assert_eq!(skill.skill_source, "skill-builder");
        assert_eq!(skill.domain.as_deref(), Some("sales"));
        assert_eq!(skill.skill_type.as_deref(), Some("domain"));
    }

    #[test]
    fn test_upsert_skill_update_on_conflict() {
        let conn = create_test_db();
        let id1 = upsert_skill(&conn, "my-skill", "skill-builder", "sales", "domain").unwrap();
        // Upsert same name — should update domain/skill_type, keep same id
        let id2 = upsert_skill(&conn, "my-skill", "skill-builder", "analytics", "platform").unwrap();
        assert_eq!(id1, id2);

        let skills = list_all_skills(&conn).unwrap();
        let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
        assert_eq!(skill.domain.as_deref(), Some("analytics"));
        assert_eq!(skill.skill_type.as_deref(), Some("platform"));
    }

    #[test]
    fn test_list_all_skills_empty() {
        let conn = create_test_db();
        let skills = list_all_skills(&conn).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_list_all_skills_returns_ordered_by_name() {
        let conn = create_test_db();
        upsert_skill(&conn, "gamma", "marketplace", "domain-c", "source").unwrap();
        upsert_skill(&conn, "alpha", "skill-builder", "domain-a", "domain").unwrap();
        upsert_skill(&conn, "beta", "imported", "domain-b", "platform").unwrap();

        let skills = list_all_skills(&conn).unwrap();
        assert_eq!(skills.len(), 3);
        assert_eq!(skills[0].name, "alpha");
        assert_eq!(skills[0].skill_source, "skill-builder");
        assert_eq!(skills[1].name, "beta");
        assert_eq!(skills[1].skill_source, "imported");
        assert_eq!(skills[2].name, "gamma");
        assert_eq!(skills[2].skill_source, "marketplace");
    }

    #[test]
    fn test_delete_skill_removes_from_master() {
        let conn = create_test_db();
        upsert_skill(&conn, "to-delete", "marketplace", "sales", "domain").unwrap();
        assert!(get_skill_master_id(&conn, "to-delete").unwrap().is_some());

        delete_skill(&conn, "to-delete").unwrap();
        assert!(get_skill_master_id(&conn, "to-delete").unwrap().is_none());
    }

    #[test]
    fn test_delete_skill_nonexistent_is_ok() {
        let conn = create_test_db();
        // Should not error when skill doesn't exist
        delete_skill(&conn, "nonexistent").unwrap();
    }

    #[test]
    fn test_save_marketplace_skill_creates_master_row_only() {
        let conn = create_test_db();
        save_marketplace_skill(&conn, "mkt-skill", "sales", "platform").unwrap();

        // Skills master row should exist with source=marketplace
        let skills = list_all_skills(&conn).unwrap();
        let skill = skills.into_iter().find(|s| s.name == "mkt-skill").unwrap();
        assert_eq!(skill.skill_source, "marketplace");
        assert_eq!(skill.domain.as_deref(), Some("sales"));

        // No workflow_runs row should be created
        let run = get_workflow_run(&conn, "mkt-skill").unwrap();
        assert!(run.is_none());
    }

    #[test]
    fn test_save_workflow_run_creates_skills_master_row() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "analytics", 0, "pending", "domain").unwrap();

        // save_workflow_run calls upsert_skill internally
        let skills = list_all_skills(&conn).unwrap();
        let skill = skills.into_iter().find(|s| s.name == "my-skill").unwrap();
        assert_eq!(skill.skill_source, "skill-builder");
        assert_eq!(skill.domain.as_deref(), Some("analytics"));
    }

    #[test]
    fn test_delete_workflow_run_also_deletes_from_skills_master() {
        let conn = create_test_db();
        save_workflow_run(&conn, "my-skill", "analytics", 0, "pending", "domain").unwrap();
        assert!(get_skill_master_id(&conn, "my-skill").unwrap().is_some());

        delete_workflow_run(&conn, "my-skill").unwrap();

        // Both workflow_runs and skills master should be cleaned
        assert!(get_workflow_run(&conn, "my-skill").unwrap().is_none());
        assert!(get_skill_master_id(&conn, "my-skill").unwrap().is_none());
    }

    // --- Skills Backfill Migration tests ---

    #[test]
    fn test_backfill_migration_populates_skills_from_workflow_runs() {
        // Simulate pre-migration state: workflow_runs exist but skills table is empty
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
        run_source_migration(&conn).unwrap();
        run_imported_skills_extended_migration(&conn).unwrap();
        run_workflow_runs_extended_migration(&conn).unwrap();

        // Insert workflow_runs rows BEFORE running skills migration
        conn.execute(
            "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, source)
             VALUES ('created-skill', 'sales', 3, 'in_progress', 'domain', 'created')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type, source)
             VALUES ('mkt-skill', 'analytics', 5, 'completed', 'platform', 'marketplace')",
            [],
        ).unwrap();

        // Run the skills table + backfill migrations
        run_skills_table_migration(&conn).unwrap();
        run_skills_backfill_migration(&conn).unwrap();
        run_rename_upload_migration(&conn).unwrap();
        run_workspace_skills_migration(&conn).unwrap();
        run_workflow_runs_id_migration(&conn).unwrap();
        run_fk_columns_migration(&conn).unwrap();
        run_frontmatter_to_skills_migration(&conn).unwrap();

        // Verify skills master was populated
        let skills = list_all_skills(&conn).unwrap();
        assert_eq!(skills.len(), 2);

        let created = skills.iter().find(|s| s.name == "created-skill").unwrap();
        assert_eq!(created.skill_source, "skill-builder");

        let mkt = skills.iter().find(|s| s.name == "mkt-skill").unwrap();
        assert_eq!(mkt.skill_source, "marketplace");

        // Marketplace row should be removed from workflow_runs
        let run = get_workflow_run(&conn, "mkt-skill").unwrap();
        assert!(run.is_none(), "marketplace rows should be removed from workflow_runs");

        // Created skill should still have a workflow_runs row
        let run = get_workflow_run(&conn, "created-skill").unwrap();
        assert!(run.is_some());

        // workflow_runs should have skill_id FK populated
        let skill_id: Option<i64> = conn.query_row(
            "SELECT skill_id FROM workflow_runs WHERE skill_name = 'created-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert!(skill_id.is_some());
        assert_eq!(skill_id.unwrap(), created.id);
    }

    // --- Skill Tags tests ---

    #[test]
    fn test_set_and_get_tags() {
        let conn = create_test_db();
        upsert_skill(&conn, "my-skill", "skill-builder", "domain", "domain").unwrap();
        set_skill_tags(&conn, "my-skill", &["analytics".into(), "salesforce".into()]).unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["analytics", "salesforce"]);
    }

    #[test]
    fn test_tags_normalize_lowercase_trim() {
        let conn = create_test_db();
        upsert_skill(&conn, "my-skill", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "my-skill", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "my-skill", "skill-builder", "domain", "domain").unwrap();
        set_skill_tags(&conn, "my-skill", &["old-tag".into()]).unwrap();
        set_skill_tags(&conn, "my-skill", &["new-tag".into()]).unwrap();
        let tags = get_tags_for_skills(&conn, &vec!["my-skill".to_string()]).unwrap().remove("my-skill").unwrap_or_default();
        assert_eq!(tags, vec!["new-tag"]);
    }

    #[test]
    fn test_get_tags_for_skills_batch() {
        let conn = create_test_db();
        upsert_skill(&conn, "skill-a", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-b", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-c", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "skill-a", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-b", "skill-builder", "domain", "domain").unwrap();
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
        run_source_migration(&conn).unwrap();
        run_workflow_runs_extended_migration(&conn).unwrap();
        run_skills_table_migration(&conn).unwrap();
        run_skills_backfill_migration(&conn).unwrap();

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
        // Skill must exist in master for FK-based locking
        upsert_skill(&conn, "test-skill", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "test-skill", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "test-skill", "skill-builder", "domain", "domain").unwrap();
        acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
        // Acquiring again from the same instance should succeed
        acquire_skill_lock(&conn, "test-skill", "inst-1", 12345).unwrap();
    }

    #[test]
    fn test_release_all_instance_locks() {
        let conn = create_test_db();
        run_lock_table_migration(&conn).unwrap();
        upsert_skill(&conn, "skill-a", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-b", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-c", "skill-builder", "domain", "domain").unwrap();
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
        upsert_skill(&conn, "skill-a", "skill-builder", "domain", "domain").unwrap();
        upsert_skill(&conn, "skill-b", "skill-builder", "domain", "domain").unwrap();
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


    // --- Marketplace Migration tests (14-16) ---

    #[test]
    fn test_source_migration_is_idempotent() {
        let conn = create_test_db();
        // All migrations already ran via create_test_db(); run again to verify idempotency
        run_source_migration(&conn).unwrap();
        // Verify the column exists exactly once
        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('workflow_runs') WHERE name = 'source'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 1, "'source' column should exist exactly once in workflow_runs");
    }

    #[test]
    fn test_imported_skills_extended_migration_is_idempotent() {
        let conn = create_test_db();
        // All migrations already ran via create_test_db(); run again to verify idempotency
        run_imported_skills_extended_migration(&conn).unwrap();
        // Verify the 6 new columns each exist exactly once
        let expected_cols = [
            "skill_type",
            "version",
            "model",
            "argument_hint",
            "user_invocable",
            "disable_model_invocation",
        ];
        for col in &expected_cols {
            let count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('imported_skills') WHERE name = '{}'",
                        col
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                count, 1,
                "'{}' column should exist exactly once in imported_skills",
                col
            );
        }
    }

    #[test]
    fn test_workflow_runs_extended_migration_is_idempotent() {
        let conn = create_test_db();
        // All migrations already ran via create_test_db(); run again to verify idempotency
        run_workflow_runs_extended_migration(&conn).unwrap();
        // Verify the 6 new columns each exist exactly once
        let expected_cols = [
            "description",
            "version",
            "model",
            "argument_hint",
            "user_invocable",
            "disable_model_invocation",
        ];
        for col in &expected_cols {
            let count: i64 = conn
                .query_row(
                    &format!(
                        "SELECT COUNT(*) FROM pragma_table_info('workflow_runs') WHERE name = '{}'",
                        col
                    ),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(
                count, 1,
                "'{}' column should exist exactly once in workflow_runs",
                col
            );
        }
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
            skill_type: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
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
            skill_type: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
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
            skill_type: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };
        insert_imported_skill(&conn, &skill3).unwrap();

        // Only active skills should be returned (inactive filtered out)
        let result = list_active_skills(&conn).unwrap();
        assert_eq!(result.len(), 2);
        // Sorted by skill_name
        assert_eq!(result[0].skill_name, "active-no-trigger");
        assert_eq!(result[1].skill_name, "active-with-trigger");
    }

    #[test]
    fn test_delete_imported_skill_by_name() {
        let conn = create_test_db();
        // Skills master row required for FK-based lookup
        upsert_skill(&conn, "delete-me", "imported", "test", "domain").unwrap();
        let skill = ImportedSkill {
            skill_id: "id-del".to_string(),
            skill_name: "delete-me".to_string(),
            domain: Some("test".to_string()),
            is_active: true,
            disk_path: "/tmp/delete-me".to_string(),
            imported_at: "2024-01-01".to_string(),
            is_bundled: false,
            description: None,
            skill_type: Some("domain".to_string()),
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
        };
        insert_imported_skill(&conn, &skill).unwrap();

        // Verify it exists
        assert!(get_imported_skill(&conn, "delete-me").unwrap().is_some());

        // Delete by name
        delete_imported_skill_by_name(&conn, "delete-me").unwrap();

        // Verify it's gone
        assert!(get_imported_skill(&conn, "delete-me").unwrap().is_none());

        // Deleting non-existent name should not error
        delete_imported_skill_by_name(&conn, "does-not-exist").unwrap();
    }

    #[test]
    fn test_migration_19_cleans_orphaned_imported_skills() {
        // Migration 19 performs two operations:
        //   1. UPDATE skills SET skill_source = 'imported' WHERE skill_source = 'upload'
        //   2. DELETE orphaned imported_skills (non-bundled, no matching skills master row)
        // The CHECK constraint on skills.skill_source prevents inserting 'upload' after
        // migration 17, so we test the orphan cleanup logic (the core new behavior).
        let conn = create_test_db();

        // Insert a skills master row that has a corresponding imported_skills row
        conn.execute(
            "INSERT INTO skills (name, skill_source, domain, skill_type) VALUES ('kept-skill', 'imported', 'test', 'domain')",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('kept-id', 'kept-skill', '/tmp/kept', 0)",
            [],
        ).unwrap();

        // Insert an orphaned imported_skills row (no skills master row)
        conn.execute(
            "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('orphan-id', 'orphan-skill', '/tmp/orphan', 0)",
            [],
        ).unwrap();

        // Insert a bundled imported_skills row (should be preserved even without master row)
        conn.execute(
            "INSERT INTO imported_skills (skill_id, skill_name, disk_path, is_bundled) VALUES ('bundled-id', 'bundled-skill', '/tmp/bundled', 1)",
            [],
        ).unwrap();

        // Run migration 19's orphan cleanup SQL directly
        conn.execute(
            "DELETE FROM imported_skills WHERE is_bundled = 0 AND skill_name NOT IN (SELECT name FROM skills)",
            [],
        ).unwrap();

        // Orphaned non-bundled row should be gone
        let orphan_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'orphan-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(orphan_count, 0, "Orphaned non-bundled row should be deleted");

        // Non-orphaned row should be preserved
        let kept_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'kept-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(kept_count, 1, "Non-orphaned row should be preserved");

        // Bundled row should be preserved (even without master row)
        let bundled_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM imported_skills WHERE skill_name = 'bundled-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(bundled_count, 1, "Bundled row should be preserved");
    }

    #[test]
    fn test_workflow_runs_id_migration_is_idempotent() {
        // Build a DB up through migration 20 only (not 21 yet).
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
        run_source_migration(&conn).unwrap();
        run_imported_skills_extended_migration(&conn).unwrap();
        run_workflow_runs_extended_migration(&conn).unwrap();
        run_skills_table_migration(&conn).unwrap();
        run_skills_backfill_migration(&conn).unwrap();
        run_rename_upload_migration(&conn).unwrap();
        run_workspace_skills_migration(&conn).unwrap();

        // Run migration 21 the first time — should succeed.
        run_workflow_runs_id_migration(&conn).unwrap();

        // Insert a row after migration 21 so the id column is present.
        conn.execute(
            "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
             VALUES ('idempotent-skill', 'test-domain', 0, 'pending', 'domain')",
            [],
        ).unwrap();

        // Run migration 21 a second time — must not error (idempotency guard).
        run_workflow_runs_id_migration(&conn).unwrap();

        // Verify the `id` column exists.
        let has_id: bool = conn
            .prepare("PRAGMA table_info(workflow_runs)").unwrap()
            .query_map([], |r| r.get::<_, String>(1)).unwrap()
            .any(|r| r.map(|n| n == "id").unwrap_or(false));
        assert!(has_id, "id column should exist after migration 21");

        // Verify skill_name UNIQUE constraint: duplicate insert must fail.
        let result = conn.execute(
            "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
             VALUES ('idempotent-skill', 'other-domain', 0, 'pending', 'domain')",
            [],
        );
        assert!(result.is_err(), "duplicate skill_name should violate UNIQUE constraint");
    }

    #[test]
    fn test_fk_columns_migration_is_idempotent() {
        // create_test_db() already runs migration 22 once.
        let conn = create_test_db();

        // Create a skill row (also creates skills master via save_workflow_run).
        save_workflow_run(&conn, "fk-idempotent-skill", "test-domain", 0, "pending", "domain").unwrap();

        // Run migration 22 again — must not error.
        run_fk_columns_migration(&conn).unwrap();

        // Save a workflow step and verify workflow_run_id is populated.
        save_workflow_step(&conn, "fk-idempotent-skill", 1, "in_progress").unwrap();

        let workflow_run_id: Option<i64> = conn.query_row(
            "SELECT workflow_run_id FROM workflow_steps WHERE skill_name = ?1 AND step_id = ?2",
            rusqlite::params!["fk-idempotent-skill", 1],
            |row| row.get(0),
        ).unwrap();
        assert!(workflow_run_id.is_some(), "workflow_run_id must be non-NULL after save_workflow_step");

        let expected_wr_id = get_workflow_run_id(&conn, "fk-idempotent-skill").unwrap().unwrap();
        assert_eq!(
            workflow_run_id.unwrap(),
            expected_wr_id,
            "workflow_run_id on workflow_steps must match workflow_runs.id"
        );
    }

    #[test]
    fn test_fk_backfill_populates_all_child_tables() {
        // Build a DB up through migration 21 only — no migration 22 yet.
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
        run_source_migration(&conn).unwrap();
        run_imported_skills_extended_migration(&conn).unwrap();
        run_workflow_runs_extended_migration(&conn).unwrap();
        run_skills_table_migration(&conn).unwrap();
        run_skills_backfill_migration(&conn).unwrap();
        run_rename_upload_migration(&conn).unwrap();
        run_workspace_skills_migration(&conn).unwrap();
        run_workflow_runs_id_migration(&conn).unwrap();
        // NOTE: run_fk_columns_migration NOT called yet.

        // Insert a skills master row.
        conn.execute(
            "INSERT INTO skills (name, skill_source, domain, skill_type) VALUES ('backfill-skill', 'skill-builder', 'test', 'domain')",
            [],
        ).unwrap();
        let skill_master_id: i64 = conn.query_row(
            "SELECT id FROM skills WHERE name = 'backfill-skill'",
            [],
            |row| row.get(0),
        ).unwrap();

        // Insert a workflow_runs row (without skill_id FK column — already present from migration 18,
        // but we set it anyway for the backfill to trace via skill_name).
        conn.execute(
            "INSERT INTO workflow_runs (skill_name, domain, current_step, status, skill_type)
             VALUES ('backfill-skill', 'test', 0, 'pending', 'domain')",
            [],
        ).unwrap();
        let wr_id: i64 = conn.query_row(
            "SELECT id FROM workflow_runs WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        ).unwrap();

        // Insert into workflow_steps without workflow_run_id (column doesn't exist yet).
        conn.execute(
            "INSERT INTO workflow_steps (skill_name, step_id, status) VALUES ('backfill-skill', 1, 'pending')",
            [],
        ).unwrap();

        // Insert into skill_tags without skill_id.
        conn.execute(
            "INSERT INTO skill_tags (skill_name, tag) VALUES ('backfill-skill', 'test-tag')",
            [],
        ).unwrap();

        // Insert into skill_locks without skill_id.
        conn.execute(
            "INSERT OR IGNORE INTO skill_locks (skill_name, instance_id, pid) VALUES ('backfill-skill', 'inst-1', 12345)",
            [],
        ).unwrap();

        // Now run migration 22 — this adds FK columns and backfills them.
        run_fk_columns_migration(&conn).unwrap();

        // Verify workflow_steps.workflow_run_id was backfilled.
        let ws_wrid: Option<i64> = conn.query_row(
            "SELECT workflow_run_id FROM workflow_steps WHERE skill_name = 'backfill-skill' AND step_id = 1",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(ws_wrid, Some(wr_id), "workflow_steps.workflow_run_id should be backfilled");

        // Verify skill_tags.skill_id was backfilled.
        let tag_sid: Option<i64> = conn.query_row(
            "SELECT skill_id FROM skill_tags WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(tag_sid, Some(skill_master_id), "skill_tags.skill_id should be backfilled");

        // Verify skill_locks.skill_id was backfilled.
        let lock_sid: Option<i64> = conn.query_row(
            "SELECT skill_id FROM skill_locks WHERE skill_name = 'backfill-skill'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(lock_sid, Some(skill_master_id), "skill_locks.skill_id should be backfilled");
    }

    #[test]
    fn test_get_step_agent_runs_uses_workflow_run_id_fk() {
        let conn = create_test_db();

        // Create skill via save_workflow_run (also creates skills master row).
        save_workflow_run(&conn, "step-test-skill", "test-domain", 0, "pending", "domain").unwrap();

        // Create a workflow session.
        create_workflow_session(&conn, "session-1", "step-test-skill", std::process::id()).unwrap();

        // Insert agent run with step_id=3 and status="completed" so it appears in get_step_agent_runs.
        persist_agent_run(
            &conn,
            "agent-step-1",
            "step-test-skill",
            3,
            "sonnet",
            "completed",
            100, 50, 0, 0, 0.01, 1000,
            1, None, None, 0, 0,
            None,
            Some("session-1"),
        ).unwrap();

        // persist_agent_run does not populate workflow_run_id — backfill it here, mirroring
        // what run_fk_columns_migration does for pre-existing rows.
        let wr_id = get_workflow_run_id(&conn, "step-test-skill").unwrap().unwrap();
        conn.execute(
            "UPDATE agent_runs SET workflow_run_id = ?1 WHERE agent_id = 'agent-step-1'",
            rusqlite::params![wr_id],
        ).unwrap();

        // Call get_step_agent_runs for the correct step — should return 1 run.
        let runs = get_step_agent_runs(&conn, "step-test-skill", 3).unwrap();
        assert_eq!(runs.len(), 1, "should find 1 agent run for step 3");
        assert_eq!(runs[0].step_id, 3);

        // Wrong step ID — should return empty.
        let wrong_step = get_step_agent_runs(&conn, "step-test-skill", 99).unwrap();
        assert!(wrong_step.is_empty(), "wrong step should return empty vec");

        // Nonexistent skill — should return empty (no workflow_run_id found).
        let no_skill = get_step_agent_runs(&conn, "nonexistent-skill", 3).unwrap();
        assert!(no_skill.is_empty(), "nonexistent skill should return empty vec");
    }

    #[test]
    fn test_has_active_session_with_live_pid_uses_skill_id_fk() {
        let conn = create_test_db();

        // Create skill via save_workflow_run (also creates skills master row).
        save_workflow_run(&conn, "session-skill", "test-domain", 0, "pending", "domain").unwrap();

        // No session yet — must return false.
        assert!(
            !has_active_session_with_live_pid(&conn, "session-skill"),
            "should return false when no session exists"
        );

        // Create session using current PID (guaranteed alive).
        let current_pid = std::process::id();
        create_workflow_session(&conn, "sess-live", "session-skill", current_pid).unwrap();

        // Session exists with live PID — must return true.
        assert!(
            has_active_session_with_live_pid(&conn, "session-skill"),
            "should return true with an active session for a live PID"
        );

        // End the session.
        end_workflow_session(&conn, "sess-live").unwrap();

        // Session is ended — must return false.
        assert!(
            !has_active_session_with_live_pid(&conn, "session-skill"),
            "should return false after session is ended"
        );

        // Skill not in skills master — must return false.
        assert!(
            !has_active_session_with_live_pid(&conn, "no-such-skill"),
            "should return false for a skill not in the skills master table"
        );
    }

    #[test]
    fn test_workspace_skill_crud_uses_uuid_skill_id() {
        let conn = create_test_db();

        let skill = WorkspaceSkill {
            skill_id: "ws-uuid-abc-123".to_string(),
            skill_name: "my-ws-skill".to_string(),
            domain: None,
            description: None,
            is_active: true,
            is_bundled: false,
            disk_path: "/tmp/ws-skill".to_string(),
            imported_at: "2024-01-01T00:00:00Z".to_string(),
            skill_type: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: None,
        };

        // Insert the workspace skill.
        insert_workspace_skill(&conn, &skill).unwrap();

        // List workspace skills — the skill must be in the list.
        let skills = list_workspace_skills(&conn).unwrap();
        let found = skills.iter().find(|s| s.skill_id == "ws-uuid-abc-123");
        assert!(found.is_some(), "inserted skill should appear in list_workspace_skills");
        assert_eq!(found.unwrap().skill_name, "my-ws-skill");
        assert!(found.unwrap().is_active);

        // Toggle active (also updates disk_path).
        update_workspace_skill_active(&conn, "ws-uuid-abc-123", false, "/tmp/ws-skill-updated").unwrap();

        let skills_after = list_workspace_skills(&conn).unwrap();
        let updated = skills_after.iter().find(|s| s.skill_id == "ws-uuid-abc-123").unwrap();
        assert!(!updated.is_active, "is_active should be false after update");

        // Delete the skill.
        delete_workspace_skill(&conn, "ws-uuid-abc-123").unwrap();

        // Verify it is gone.
        let skills_final = list_workspace_skills(&conn).unwrap();
        let gone = skills_final.iter().find(|s| s.skill_id == "ws-uuid-abc-123");
        assert!(gone.is_none(), "skill should not appear in list after deletion");
    }

    fn make_ws_skill(skill_id: &str, skill_name: &str, purpose: Option<&str>, is_active: bool) -> WorkspaceSkill {
        WorkspaceSkill {
            skill_id: skill_id.to_string(),
            skill_name: skill_name.to_string(),
            domain: None,
            description: None,
            is_active,
            is_bundled: false,
            disk_path: format!("/tmp/{}", skill_name),
            imported_at: "2025-01-01T00:00:00Z".to_string(),
            skill_type: None,
            version: None,
            model: None,
            argument_hint: None,
            user_invocable: None,
            disable_model_invocation: None,
            purpose: purpose.map(|s| s.to_string()),
        }
    }

    #[test]
    fn test_get_workspace_skill_by_purpose_happy_path() {
        let conn = create_test_db();
        let skill = make_ws_skill("id-research", "research-skill", Some("research"), true);
        insert_workspace_skill(&conn, &skill).unwrap();

        let found = get_workspace_skill_by_purpose(&conn, "research").unwrap();
        assert!(found.is_some(), "should find an active skill with purpose='research'");
        assert_eq!(found.unwrap().skill_name, "research-skill");
    }

    #[test]
    fn test_get_workspace_skill_by_purpose_no_match() {
        let conn = create_test_db();

        let found = get_workspace_skill_by_purpose(&conn, "nonexistent-purpose").unwrap();
        assert!(found.is_none(), "should return None for a purpose that has no matching skill");
    }

    #[test]
    fn test_get_workspace_skill_by_purpose_inactive_ignored() {
        let conn = create_test_db();
        // Insert an inactive skill with purpose "validate"
        let skill = make_ws_skill("id-validate", "validate-skill", Some("validate"), false);
        insert_workspace_skill(&conn, &skill).unwrap();

        let found = get_workspace_skill_by_purpose(&conn, "validate").unwrap();
        assert!(found.is_none(), "should return None when the only matching skill is inactive");
    }
}
