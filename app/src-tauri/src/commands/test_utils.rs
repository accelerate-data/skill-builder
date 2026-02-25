/// Create an in-memory test database with all required tables.
/// Shared across command module tests to avoid duplication.
pub fn create_test_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS skills (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL UNIQUE,
            skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'imported')),
            purpose      TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            description  TEXT,
            version      TEXT,
            model        TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER
        );
        CREATE TABLE IF NOT EXISTS workflow_runs (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name  TEXT UNIQUE NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'pending',
            purpose TEXT DEFAULT 'domain',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            author_login TEXT,
            author_avatar TEXT,
            display_name TEXT,
            intake_json TEXT,
            source TEXT NOT NULL DEFAULT 'created',
            description TEXT,
            version TEXT DEFAULT '1.0.0',
            model TEXT,
            argument_hint TEXT,
            user_invocable INTEGER DEFAULT 1,
            disable_model_invocation INTEGER DEFAULT 0,
            skill_id INTEGER REFERENCES skills(id)
        );
        CREATE TABLE IF NOT EXISTS workflow_steps (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT,
            completed_at TEXT,
            workflow_run_id INTEGER REFERENCES workflow_runs(id),
            PRIMARY KEY (skill_name, step_id)
        );
        CREATE TABLE IF NOT EXISTS agent_runs (
            agent_id TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            model TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'running',
            input_tokens INTEGER,
            output_tokens INTEGER,
            total_cost REAL,
            session_id TEXT,
            started_at TEXT NOT NULL DEFAULT (datetime('now')),
            completed_at TEXT,
            workflow_run_id INTEGER REFERENCES workflow_runs(id),
            PRIMARY KEY (agent_id, model)
        );
        CREATE TABLE IF NOT EXISTS workflow_artifacts (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            content TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            workflow_run_id INTEGER REFERENCES workflow_runs(id),
            PRIMARY KEY (skill_name, step_id, relative_path)
        );
        CREATE TABLE IF NOT EXISTS skill_tags (
            skill_name TEXT NOT NULL,
            tag TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            skill_id INTEGER REFERENCES skills(id),
            PRIMARY KEY (skill_name, tag)
        );
        CREATE TABLE IF NOT EXISTS imported_skills (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now')),
            is_bundled INTEGER NOT NULL DEFAULT 0,
            purpose TEXT,
            version TEXT,
            model TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            skill_master_id INTEGER REFERENCES skills(id),
            content_hash TEXT,
            marketplace_source_url TEXT
        );
        CREATE TABLE IF NOT EXISTS workspace_skills (
            skill_id     TEXT PRIMARY KEY,
            skill_name   TEXT UNIQUE NOT NULL,
            description  TEXT,
            is_active    INTEGER NOT NULL DEFAULT 1,
            is_bundled   INTEGER NOT NULL DEFAULT 0,
            disk_path    TEXT NOT NULL,
            imported_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            purpose      TEXT,
            version      TEXT,
            model        TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            skill_master_id INTEGER REFERENCES skills(id),
            content_hash TEXT,
            marketplace_source_url TEXT
        );
        CREATE TABLE IF NOT EXISTS skill_locks (
            skill_name TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
            skill_id INTEGER REFERENCES skills(id)
        );
        CREATE TABLE IF NOT EXISTS workflow_sessions (
            session_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            pid INTEGER NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            ended_at TEXT,
            reset_marker TEXT,
            skill_id INTEGER REFERENCES skills(id)
        );",
    )
    .unwrap();
    conn
}
