/// Create an in-memory test database with all required tables.
/// Shared across command module tests to avoid duplication.
pub fn create_test_db() -> rusqlite::Connection {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
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
            skill_type TEXT DEFAULT 'domain',
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at TEXT NOT NULL DEFAULT (datetime('now')),
            author_login TEXT,
            author_avatar TEXT
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
        CREATE TABLE IF NOT EXISTS imported_skills (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT UNIQUE NOT NULL,
            domain TEXT,
            description TEXT,
            is_active INTEGER DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS skill_locks (
            skill_name TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        CREATE TABLE IF NOT EXISTS workflow_sessions (
            session_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            pid INTEGER NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            ended_at TEXT,
            reset_marker TEXT
        );",
    )
    .unwrap();
    conn
}
