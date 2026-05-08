use rusqlite::{Connection, OptionalExtension};

type MigrationFn = fn(&Connection) -> Result<(), rusqlite::Error>;

pub(super) const NUMBERED_MIGRATIONS: &[(u32, MigrationFn)] = &[
    (1, run_add_skill_type_migration),
    (2, run_lock_table_migration),
    (3, run_author_migration),
    (4, run_usage_tracking_migration),
    (5, run_workflow_session_migration),
    (6, run_sessions_table_migration),
    (7, run_trigger_text_migration),
    (8, run_agent_stats_migration),
    (9, run_intake_migration),
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
    (26, run_content_hash_migration),
    (27, run_backfill_null_versions_migration),
    (28, run_rename_purpose_drop_domain_migration),
    (29, run_marketplace_source_url_migration),
    (30, run_skills_soft_delete_migration),
    (31, run_backfill_synthetic_sessions_migration),
    (32, run_reserved_model_settings_migration),
    (33, run_reconciliation_events_migration),
    (34, run_ghost_running_rows_migration),
    (35, run_drop_workflow_runs_metadata_migration),
    (36, run_consolidate_workspace_skills_migration),
    (37, run_fk_cascade_migration),
    (38, run_plugin_ownership_migration),
    (39, run_plugin_upgrade_locked_migration),
    (40, run_documents_migration),
    (41, run_reset_legacy_tags_migrated),
    (42, run_performance_indexes_migration),
    (43, run_openhands_settings_migration),
    (44, run_eval_workbench_migration),
    (45, run_workflow_artifact_tables_migration),
    (46, run_eval_workbench_scenario_identity_migration),
    (47, run_skill_conversations_migration),
    (48, run_scenarios_migration),
];

pub(super) fn ensure_migration_table(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );",
    )
}

pub(super) fn migration_applied(conn: &Connection, version: u32) -> bool {
    conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = ?1",
        rusqlite::params![version],
        |row| row.get::<_, i64>(0),
    )
    .unwrap_or(0)
        > 0
}

pub(super) fn mark_migration_applied(
    conn: &Connection,
    version: u32,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT OR IGNORE INTO schema_migrations (version) VALUES (?1)",
        rusqlite::params![version],
    )
    .map(|_| ())
}

pub(super) fn run_migrations(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS plugins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            version TEXT,
            source_type TEXT NOT NULL DEFAULT 'synthetic',
            source_url TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );


        -- workflow_runs tracks workflow execution state only.
        -- Metadata fields (description, version, model, argument_hint,
        -- user_invocable, disable_model_invocation) were added here temporarily
        -- in migration 16 but were moved to the `skills` master table in
        -- migration 24 and fully dropped from this table in migration 35.
        -- `skills` is the sole authoritative source for skill metadata.
        -- Do NOT add metadata columns back here.
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
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at   TEXT
        );",
    )
}

pub(super) fn run_openhands_settings_migration(_conn: &Connection) -> Result<(), rusqlite::Error> {
    // Reserved migration slot. The final OpenHands LLM settings design is a
    // clean break: legacy Anthropic/OpenHands fields are not backfilled into the
    // canonical `model_settings` object.
    Ok(())
}

pub(super) fn run_eval_workbench_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS eval_prompt_sets (
            id TEXT PRIMARY KEY,
            plugin_slug TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('performance')),
            name TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS eval_prompt_cases (
            id TEXT PRIMARY KEY,
            prompt_set_id TEXT NOT NULL REFERENCES eval_prompt_sets(id) ON DELETE CASCADE,
            prompt TEXT NOT NULL,
            expected TEXT,
            assertions_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS eval_runs (
            id TEXT PRIMARY KEY,
            prompt_set_id TEXT NOT NULL REFERENCES eval_prompt_sets(id) ON DELETE CASCADE,
            mode TEXT NOT NULL CHECK (mode IN ('performance')),
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );

        CREATE TABLE IF NOT EXISTS eval_run_results (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
            case_id TEXT NOT NULL,
            candidate_id TEXT NOT NULL,
            passed INTEGER NOT NULL,
            score REAL NOT NULL,
            output_json TEXT NOT NULL,
            reason TEXT
        );

        CREATE TABLE IF NOT EXISTS description_candidates (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
            label TEXT NOT NULL,
            description TEXT NOT NULL,
            rationale TEXT,
            rank INTEGER
        );

        CREATE INDEX IF NOT EXISTS idx_eval_prompt_sets_skill_mode
            ON eval_prompt_sets(plugin_slug, skill_name, mode, updated_at);
        CREATE INDEX IF NOT EXISTS idx_eval_prompt_cases_set_order
            ON eval_prompt_cases(prompt_set_id, sort_order);
        CREATE INDEX IF NOT EXISTS idx_eval_runs_prompt_set_mode_created
            ON eval_runs(prompt_set_id, mode, created_at);
        CREATE INDEX IF NOT EXISTS idx_eval_run_results_run
            ON eval_run_results(run_id);
        CREATE INDEX IF NOT EXISTS idx_description_candidates_run_rank
            ON description_candidates(run_id, rank);",
    )
}

pub(super) fn run_eval_workbench_scenario_identity_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute_batch("BEGIN IMMEDIATE")?;
    let result = conn.execute_batch(
        "DROP TABLE IF EXISTS eval_runs_v2;

        CREATE TABLE eval_runs_v2 (
            id TEXT PRIMARY KEY,
            prompt_set_id TEXT REFERENCES eval_prompt_sets(id) ON DELETE CASCADE,
            plugin_slug TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            scenario_name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('performance')),
            status TEXT NOT NULL,
            summary_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            completed_at TEXT
        );

        INSERT INTO eval_runs_v2 (
            id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
        )
        SELECT
            r.id,
            r.prompt_set_id,
            COALESCE(ps.plugin_slug, '__legacy__'),
            COALESCE(ps.skill_name, '__legacy__'),
            COALESCE(ps.name, r.id),
            r.mode,
            r.status,
            r.summary_json,
            r.created_at,
            r.completed_at
        FROM eval_runs r
        LEFT JOIN eval_prompt_sets ps ON ps.id = r.prompt_set_id;

        DROP TABLE eval_runs;
        ALTER TABLE eval_runs_v2 RENAME TO eval_runs;

        DROP INDEX IF EXISTS idx_eval_runs_prompt_set_mode_created;
        CREATE INDEX IF NOT EXISTS idx_eval_runs_skill_mode_created
            ON eval_runs(plugin_slug, skill_name, mode, created_at);
        CREATE INDEX IF NOT EXISTS idx_eval_runs_scenario_mode_created
            ON eval_runs(plugin_slug, skill_name, scenario_name, mode, created_at);",
    );

    match result {
        Ok(()) => conn.execute_batch("COMMIT"),
        Err(error) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

pub(super) fn run_skill_conversations_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_conversations (
            plugin_slug TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            conversation_id TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            PRIMARY KEY (plugin_slug, skill_name)
        );

        CREATE INDEX IF NOT EXISTS idx_skill_conversations_skill
            ON skill_conversations(skill_name, plugin_slug);",
    )
}

pub(super) fn run_scenarios_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS scenarios (
            id TEXT PRIMARY KEY,
            plugin_slug TEXT NOT NULL,
            skill_name TEXT NOT NULL,
            name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('performance')),
            prompt TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS assertions (
            id TEXT PRIMARY KEY,
            scenario_id TEXT NOT NULL REFERENCES scenarios(id) ON DELETE CASCADE,
            assertion TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_scenarios_skill ON scenarios(plugin_slug, skill_name, sort_order);
        CREATE INDEX IF NOT EXISTS idx_assertions_scenario ON assertions(scenario_id, sort_order);

        -- Migrate data from old tables
        INSERT INTO scenarios (id, plugin_slug, skill_name, name, mode, prompt, sort_order, created_at, updated_at)
        SELECT
            ps.id,
            ps.plugin_slug,
            ps.skill_name,
            ps.name,
            'performance',
            COALESCE(pc.prompt, ''),
            pc.sort_order,
            ps.created_at,
            ps.updated_at
        FROM eval_prompt_sets ps
        JOIN eval_prompt_cases pc ON pc.prompt_set_id = ps.id;

        INSERT INTO assertions (id, scenario_id, assertion, sort_order)
        SELECT
            'assert-' || lower(hex(randomblob(8))),
            pc.prompt_set_id,
            j.value,
            j.key
        FROM eval_prompt_cases pc,
        json_each(pc.assertions_json) AS j
        WHERE json_type(pc.assertions_json) = 'array';

        -- Drop old tables
        DROP TABLE IF EXISTS eval_run_results;
        DROP TABLE IF EXISTS description_candidates;
        DROP TABLE IF EXISTS eval_runs;
        DROP TABLE IF EXISTS eval_prompt_cases;
        DROP TABLE IF EXISTS eval_prompt_sets;

        -- Drop old indexes
        DROP INDEX IF EXISTS idx_eval_prompt_sets_skill_mode;
        DROP INDEX IF EXISTS idx_eval_prompt_cases_set_order;
        DROP INDEX IF EXISTS idx_eval_runs_skill_mode_created;
        DROP INDEX IF EXISTS idx_eval_runs_scenario_mode_created;
        DROP INDEX IF EXISTS idx_eval_run_results_run;
        DROP INDEX IF EXISTS idx_description_candidates_run_rank;",
    )
}

pub(super) fn run_plugin_ownership_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS plugins (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            slug TEXT NOT NULL UNIQUE,
            display_name TEXT NOT NULL,
            version TEXT,
            source_type TEXT NOT NULL DEFAULT 'synthetic',
            source_url TEXT,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );

        INSERT INTO plugins (slug, display_name, version, source_type, source_url, is_default)
        SELECT 'default', 'Default', NULL, 'synthetic', NULL, 1
        WHERE NOT EXISTS (SELECT 1 FROM plugins WHERE slug = 'default');",
    )?;

    conn.execute_batch(
        "DROP TABLE IF EXISTS skills_new;
        CREATE TABLE skills_new (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL,
            skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'imported')),
            plugin_id    INTEGER NOT NULL REFERENCES plugins(id),
            purpose      TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at   TEXT,
            description  TEXT,
            version      TEXT,
            model        TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            UNIQUE (plugin_id, name)
        );

        INSERT INTO skills_new (
            id, name, skill_source, plugin_id, purpose, created_at, updated_at, deleted_at,
            description, version, model, argument_hint, user_invocable, disable_model_invocation
        )
        SELECT
            s.id,
            s.name,
            s.skill_source,
            COALESCE(p.id, np.id),
            s.purpose,
            s.created_at,
            s.updated_at,
            s.deleted_at,
            s.description,
            s.version,
            s.model,
            s.argument_hint,
            s.user_invocable,
            s.disable_model_invocation
        FROM skills s
        CROSS JOIN (SELECT id FROM plugins WHERE slug = 'default') np
        LEFT JOIN plugins p
            ON p.slug = CASE
                WHEN s.skill_source = 'marketplace'
                    THEN 'marketplace-' || lower(replace(replace(COALESCE(s.name, ''), ' ', '-'), '_', '-'))
                ELSE 'default'
            END;

        DROP TABLE skills;
        ALTER TABLE skills_new RENAME TO skills;",
    )?;

    conn.execute_batch(
        "INSERT INTO plugins (slug, display_name, version, source_type, source_url, is_default)
         SELECT DISTINCT
            'marketplace-' || lower(replace(replace(i.skill_name, ' ', '-'), '_', '-')),
            COALESCE(NULLIF(i.skill_name, ''), 'Imported Plugin'),
            NULL,
            'marketplace',
            i.marketplace_source_url,
            0
         FROM imported_skills i
         WHERE i.marketplace_source_url IS NOT NULL
           AND NOT EXISTS (
                SELECT 1 FROM plugins p
                WHERE p.slug = 'marketplace-' || lower(replace(replace(i.skill_name, ' ', '-'), '_', '-'))
           );",
    )?;

    conn.execute_batch(
        "UPDATE skills
         SET plugin_id = (
            SELECT COALESCE(p.id, np.id)
            FROM (SELECT id FROM plugins WHERE slug = 'default') np
            LEFT JOIN plugins p
              ON p.slug = CASE
                  WHEN skills.skill_source = 'marketplace'
                      THEN 'marketplace-' || lower(replace(replace(skills.name, ' ', '-'), '_', '-'))
                  ELSE 'default'
              END
         );",
    )?;

    // Sanitize orphaned rows that would violate NOT NULL on skill_master_id
    conn.execute_batch("DELETE FROM imported_skills WHERE skill_master_id IS NULL;")?;

    conn.execute_batch(
        "DROP TABLE IF EXISTS imported_skills_new;
        CREATE TABLE imported_skills_new (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            is_bundled INTEGER NOT NULL DEFAULT 0,
            purpose TEXT,
            version TEXT,
            model TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            skill_master_id INTEGER NOT NULL UNIQUE REFERENCES skills(id) ON DELETE CASCADE,
            content_hash TEXT,
            marketplace_source_url TEXT
        );
        INSERT INTO imported_skills_new
            SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                   purpose, version, model, argument_hint, user_invocable,
                   disable_model_invocation, skill_master_id, content_hash,
                   marketplace_source_url
            FROM imported_skills;
        DROP TABLE imported_skills;
        ALTER TABLE imported_skills_new RENAME TO imported_skills;",
    )?;

    log::info!("migration 38: added first-class plugin ownership");
    Ok(())
}

pub(super) fn run_add_skill_type_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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

pub(super) fn run_lock_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skill_locks (
            skill_name TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );",
    )
}

pub(super) fn run_sessions_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
        conn.execute_batch("ALTER TABLE workflow_sessions ADD COLUMN reset_marker TEXT;")?;
    }
    Ok(())
}

pub(super) fn run_trigger_text_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_trigger_text = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| {
                    rows.filter_map(|r| r.ok())
                        .any(|name| name == "trigger_text")
                })
        })
        .unwrap_or(false);

    if !has_trigger_text {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN trigger_text TEXT;")?;
    }
    Ok(())
}

pub(super) fn run_intake_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "display_name") {
        conn.execute_batch("ALTER TABLE workflow_runs ADD COLUMN display_name TEXT;")?;
    }
    if !columns.iter().any(|name| name == "intake_json") {
        conn.execute_batch("ALTER TABLE workflow_runs ADD COLUMN intake_json TEXT;")?;
    }
    Ok(())
}

/// Migrate agent_runs from PRIMARY KEY (agent_id) to composite PRIMARY KEY (agent_id, model).
/// This allows multiple rows per agent when sub-agents use different models.
pub(super) fn run_composite_pk_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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

pub(super) fn run_bundled_skill_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
pub(super) fn run_drop_trigger_description_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    // Check if trigger_text column still exists (idempotent)
    let has_trigger_text = conn
        .prepare("PRAGMA table_info(imported_skills)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| {
                    rows.filter_map(|r| r.ok())
                        .any(|name| name == "trigger_text")
                })
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

pub(super) fn run_remove_validate_step_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
pub(super) fn run_source_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
pub(super) fn run_imported_skills_extended_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
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
pub(super) fn run_cleanup_stale_running_rows_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "UPDATE agent_runs
         SET status = 'shutdown', completed_at = datetime('now') || 'Z'
         WHERE status = 'running';",
    )
}

/// Migration 16: Add extended metadata columns to workflow_runs.
pub(super) fn run_workflow_runs_extended_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
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
            conn.execute_batch(&format!(
                "ALTER TABLE workflow_runs ADD COLUMN {} {};",
                col, def
            ))?;
        }
    }
    Ok(())
}

/// Migration 18: Create the `skills` master table — the single catalog backing
/// the skills library, test tab, and reconciliation.
pub(super) fn run_skills_table_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS skills (
            id           INTEGER PRIMARY KEY AUTOINCREMENT,
            name         TEXT NOT NULL UNIQUE,
            skill_source TEXT NOT NULL CHECK(skill_source IN ('skill-builder', 'marketplace', 'imported')),
            domain       TEXT,
            skill_type   TEXT,
            created_at   TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at   TEXT
        );",
    )?;
    log::info!("migration 17: created skills table");
    Ok(())
}

/// Migration 30: Add soft-delete timestamp to skills master table.
pub(super) fn run_skills_soft_delete_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_deleted_at = conn
        .prepare("PRAGMA table_info(skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .any(|r| r.map(|n| n == "deleted_at").unwrap_or(false));

    if !has_deleted_at {
        conn.execute_batch("ALTER TABLE skills ADD COLUMN deleted_at TEXT;")?;
    }
    Ok(())
}

/// Migration 31: Backfill missing workflow_sessions rows for historical synthetic
/// refine/test usage runs written before synthetic session persistence.
pub(super) fn run_backfill_synthetic_sessions_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "INSERT INTO workflow_sessions (session_id, skill_name, skill_id, pid, started_at, ended_at)
         SELECT
           ar.workflow_session_id,
           ar.skill_name,
           s.id,
           0,
           MIN(COALESCE(ar.started_at, datetime('now') || 'Z')),
           MAX(COALESCE(ar.completed_at, ar.started_at, datetime('now') || 'Z'))
         FROM agent_runs ar
         LEFT JOIN skills s ON s.name = ar.skill_name
         LEFT JOIN workflow_sessions ws ON ws.session_id = ar.workflow_session_id
         WHERE ar.workflow_session_id IS NOT NULL
           AND ar.workflow_session_id LIKE 'synthetic:%'
           AND ar.reset_marker IS NULL
           AND ws.session_id IS NULL
         GROUP BY ar.workflow_session_id, ar.skill_name, s.id",
        [],
    )?;
    Ok(())
}

/// Migration 32: reserved historical migration slot.
pub(super) fn run_reserved_model_settings_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    let _ = conn;
    log::info!(
        "migration 32: skipped model alias normalization; model IDs are stored exactly as emitted"
    );
    Ok(())
}

/// Migration 33: Record startup reconciliation actions in an auditable table.
pub(super) fn run_reconciliation_events_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS reconciliation_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            details TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );",
    )?;
    Ok(())
}

/// Migration 34: Convert any remaining ghost `status='running'` rows to `shutdown`.
/// The close guard no longer queries agent_runs; only terminal rows should exist.
/// These rows were created by the now-removed initial persist-on-start call in
/// the frontend's startRun(), which wrote a `status='running'` row before any
/// SDK events arrived.
pub(super) fn run_ghost_running_rows_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let updated = conn.execute(
        "UPDATE agent_runs
         SET status = 'shutdown', completed_at = datetime('now') || 'Z'
         WHERE status = 'running'",
        [],
    )?;
    log::info!(
        "migration 34: converted {} ghost running rows to shutdown",
        updated
    );
    Ok(())
}

/// Migration 35: Drop deprecated metadata columns from `workflow_runs`.
///
/// After migration 24 moved description/version/model/argument_hint/user_invocable/
/// disable_model_invocation to the `skills` master table, `workflow_runs` retained
/// them as a transitional snapshot. This migration removes the snapshot copies so
/// there is a single authoritative source.
///
/// Post-migration, `save_workflow_state` CANNOT receive or persist metadata from the
/// frontend even if the caller tries — the columns simply do not exist. Metadata reads
/// must always go through `get_skill_master` / `skills` table.
///
/// Uses the SQLite table-rebuild pattern since ALTER TABLE DROP COLUMN is not
/// widely supported.
pub(super) fn run_drop_workflow_runs_metadata_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    // Idempotency: if a previous run left workflow_runs_new behind (e.g. the process
    // crashed before mark_migration_applied was called), drop it first.
    conn.execute_batch("DROP TABLE IF EXISTS workflow_runs_new;")?;

    // Skip if workflow_runs already lacks the deprecated columns (migration already applied
    // to this DB but not recorded in schema_migrations due to a prior crash).
    let has_deprecated = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .any(|col| col == "description");
    if !has_deprecated {
        log::info!(
            "migration 35: workflow_runs already lacks deprecated columns, skipping rebuild"
        );
        return Ok(());
    }

    conn.execute_batch(
        "CREATE TABLE workflow_runs_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name  TEXT UNIQUE NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'pending',
            purpose     TEXT DEFAULT 'domain',
            created_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            source      TEXT NOT NULL DEFAULT 'created',
            author_login TEXT,
            author_avatar TEXT,
            display_name TEXT,
            intake_json TEXT,
            skill_id    INTEGER REFERENCES skills(id)
        );
        INSERT INTO workflow_runs_new (id, skill_name, current_step, status, purpose,
                                       created_at, updated_at, source,
                                       author_login, author_avatar, display_name,
                                       intake_json, skill_id)
            SELECT id, skill_name, current_step, status, purpose,
                   created_at, updated_at, source,
                   author_login, author_avatar, display_name,
                   intake_json, skill_id
            FROM workflow_runs;
        DROP TABLE workflow_runs;
        ALTER TABLE workflow_runs_new RENAME TO workflow_runs;",
    )?;
    log::info!("migration 35: dropped deprecated metadata columns from workflow_runs");
    Ok(())
}

/// Migration 36: Drop workspace_skills table.
/// The workspace_skills concept is removed entirely; imported_skills is the sole import table.
/// Data is not migrated — workspace_skills held transient bundled/toggle state that no longer
/// maps to any feature.
pub(super) fn run_consolidate_workspace_skills_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute_batch("DROP TABLE IF EXISTS workspace_skills;")?;
    log::info!("migration 36: dropped workspace_skills table");
    Ok(())
}

/// Migration 19: Backfill `skills` from `workflow_runs`, add FK column, backfill FK,
/// and remove marketplace rows from `workflow_runs` (now in skills master only).
pub(super) fn run_skills_backfill_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
    let removed: usize =
        conn.execute("DELETE FROM workflow_runs WHERE source = 'marketplace'", [])?;

    log::info!(
        "migration 18: backfilled {} skills, removed {} marketplace workflow_runs",
        backfilled,
        removed
    );
    Ok(())
}

pub(super) fn run_workspace_skills_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "
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
    ",
    )?;
    log::info!("migration 20: created workspace_skills table, migrated skill-builder rows");
    Ok(())
}

/// Migration 22: Add integer primary key to `workflow_runs`.
/// The table previously used `skill_name TEXT PRIMARY KEY`. We recreate it with
/// `id INTEGER PRIMARY KEY AUTOINCREMENT` and `skill_name TEXT UNIQUE NOT NULL`.
/// This unblocks rename_skill (no more INSERT+DELETE) and allows child tables to
/// reference `workflow_runs` by integer FK instead of text `skill_name`.
pub(super) fn run_workflow_runs_id_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Idempotency guard: check whether the `id` column already exists
    let has_id = conn
        .prepare("PRAGMA table_info(workflow_runs)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .any(|r| r.map(|n| n == "id").unwrap_or(false));
    if has_id {
        return Ok(());
    }

    conn.execute_batch(
        "
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
    ",
    )?;

    log::info!("migration 21: added integer PK to workflow_runs");
    Ok(())
}

/// Migration 23: Add integer FK columns to child tables and backfill from skill_name.
/// After this migration:
///   - workflow_steps, workflow_artifacts, agent_runs: have `workflow_run_id INT FK → workflow_runs(id)`
///   - skill_tags, skill_locks, workflow_sessions: have `skill_id INT FK → skills(id)`
///   - imported_skills: has `skill_master_id INT FK → skills(id)`
pub(super) fn run_fk_columns_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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
    conn.execute_batch(
        "
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
    ",
    )?;

    log::info!("migration 22: added FK columns to child tables and backfilled");
    Ok(())
}

/// Migration 24: Add SKILL.md frontmatter fields to the `skills` master table.
/// These fields (description, version, model, argument_hint, user_invocable,
/// disable_model_invocation) apply to ALL skill sources and belong in the canonical
/// `skills` table rather than per-source tables (workflow_runs / imported_skills).
/// Backfills from workflow_runs (skill-builder) and imported_skills (marketplace/imported).
pub(super) fn run_frontmatter_to_skills_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
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
pub(super) fn repair_skills_table_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    let cols: Vec<String> = conn
        .prepare("PRAGMA table_info(skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    let mut added_any = false;
    for (col, def) in &[
        ("deleted_at", "TEXT"),
        ("description", "TEXT"),
        ("version", "TEXT"),
        ("model", "TEXT"),
        ("argument_hint", "TEXT"),
        ("user_invocable", "INTEGER"),
        ("disable_model_invocation", "INTEGER"),
    ] {
        if !cols.contains(&col.to_string()) {
            conn.execute_batch(&format!("ALTER TABLE skills ADD COLUMN {} {};", col, def))?;
            log::info!(
                "repair_skills_table_schema: added missing column '{}' to skills",
                col
            );
            added_any = true;
        }
    }

    // If any column was missing, the migration 24 backfill never ran either.
    // Run it now so existing imported/marketplace skills have their version/model populated.
    // Note: workflow_runs no longer has metadata columns (dropped in migration 35),
    // so we only backfill from imported_skills for marketplace/imported skills.
    if added_any {
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
        log::info!(
            "repair_skills_table_schema: backfilled frontmatter fields from imported_skills"
        );
    }

    Ok(())
}

/// Ensure first-class plugin ownership exists even if migration 38 was marked applied
/// before the schema rebuild actually ran.
pub(crate) fn repair_plugin_ownership_schema(conn: &Connection) -> Result<(), rusqlite::Error> {
    let plugins_table_exists = conn.query_row(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'plugins'",
        [],
        |row| row.get::<_, i64>(0),
    )? > 0;

    let skill_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();

    let has_plugin_id = skill_cols.iter().any(|c| c == "plugin_id");
    if !plugins_table_exists || !has_plugin_id {
        log::warn!(
            "repair_plugin_ownership_schema: detected pre-plugin skills schema; rerunning migration 38 repair"
        );
        run_plugin_ownership_migration(conn)?;
        return Ok(());
    }

    // Ensure the default plugin exists — could be under legacy 'no-plugin' or current 'default' slug
    conn.execute_batch(
        "INSERT INTO plugins (slug, display_name, version, source_type, source_url, is_default)
         SELECT 'default', 'Default', NULL, 'synthetic', NULL, 1
         WHERE NOT EXISTS (SELECT 1 FROM plugins WHERE slug = 'default')
           AND NOT EXISTS (SELECT 1 FROM plugins WHERE slug = 'no-plugin');",
    )?;

    // Rename legacy 'no-plugin' to 'default' if it still exists
    conn.execute_batch(
        "UPDATE plugins SET slug = 'default', display_name = 'Default'
         WHERE slug = 'no-plugin';",
    )?;

    // Point orphaned skills at the default plugin
    conn.execute_batch(
        "UPDATE skills
         SET plugin_id = (SELECT id FROM plugins WHERE slug = 'default')
         WHERE plugin_id IS NULL;",
    )?;

    let default_plugin_id: i64 = conn.query_row(
        "SELECT id FROM plugins WHERE slug = 'default' LIMIT 1",
        [],
        |row| row.get(0),
    )?;

    if let Ok(legacy_plugin_id) = conn.query_row(
        "SELECT id FROM plugins WHERE slug = 'skills' LIMIT 1",
        [],
        |row| row.get::<_, i64>(0),
    ) {
        let legacy_rows: Vec<(i64, String)> = conn
            .prepare("SELECT id, name FROM skills WHERE plugin_id = ?1 ORDER BY id")?
            .query_map([legacy_plugin_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(|row| row.ok())
            .collect();

        for (legacy_skill_id, skill_name) in legacy_rows {
            let canonical_skill_id = conn
                .query_row(
                    "SELECT id FROM skills
                     WHERE plugin_id = ?1 AND name = ?2 AND id != ?3
                     LIMIT 1",
                    rusqlite::params![default_plugin_id, skill_name, legacy_skill_id],
                    |row| row.get::<_, i64>(0),
                )
                .optional()?;

            if let Some(canonical_skill_id) = canonical_skill_id {
                for table in [
                    "workflow_runs",
                    "skill_tags",
                    "skill_locks",
                    "workflow_sessions",
                    "document_skills",
                ] {
                    let sql = format!("UPDATE {table} SET skill_id = ?1 WHERE skill_id = ?2");
                    conn.execute(&sql, rusqlite::params![canonical_skill_id, legacy_skill_id])?;
                }
                conn.execute(
                    "DELETE FROM skills WHERE id = ?1",
                    rusqlite::params![legacy_skill_id],
                )?;
            } else {
                conn.execute(
                    "UPDATE skills SET plugin_id = ?1 WHERE id = ?2",
                    rusqlite::params![default_plugin_id, legacy_skill_id],
                )?;
            }
        }

        let legacy_skill_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM skills WHERE plugin_id = ?1",
            [legacy_plugin_id],
            |row| row.get(0),
        )?;
        if legacy_skill_count == 0 {
            conn.execute(
                "DELETE FROM plugins WHERE id = ?1 AND slug = 'skills' AND source_type = 'synthetic'",
                [legacy_plugin_id],
            )?;
        }
    }

    conn.execute(
        "UPDATE plugins
         SET is_default = CASE WHEN slug = 'default' THEN 1 ELSE 0 END",
        [],
    )?;

    Ok(())
}

pub(super) fn run_workspace_skills_purpose_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    let has_column = conn
        .prepare("PRAGMA table_info(workspace_skills)")
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

/// Migration 26: Add `content_hash TEXT` to workspace_skills and imported_skills.
/// Existing rows get NULL (treated as "unmodified baseline unknown").
pub(super) fn run_content_hash_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let check_col = |table: &str, col: &str| -> bool {
        conn.prepare(&format!("PRAGMA table_info({})", table))
            .and_then(|mut stmt| {
                stmt.query_map([], |r| r.get::<_, String>(1))
                    .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == col))
            })
            .unwrap_or(false)
    };
    let mut altered = false;
    if !check_col("workspace_skills", "content_hash") {
        conn.execute_batch("ALTER TABLE workspace_skills ADD COLUMN content_hash TEXT;")?;
        altered = true;
    }
    if !check_col("imported_skills", "content_hash") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN content_hash TEXT;")?;
        altered = true;
    }
    if altered {
        log::info!("migration 26: added content_hash to workspace_skills and imported_skills");
    }
    Ok(())
}

pub(super) fn run_backfill_null_versions_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    // One-time patch: set version = '1.0.0' wherever version is NULL in all three version-
    // tracking tables. Skills imported before version tracking was introduced had no version
    // recorded; this prevents them from showing false "Update available" badges.
    let skills_updated = conn.execute(
        "UPDATE skills SET version = '1.0.0' WHERE version IS NULL",
        [],
    )?;
    let imported_updated = conn.execute(
        "UPDATE imported_skills SET version = '1.0.0' WHERE version IS NULL",
        [],
    )?;
    let workspace_updated = conn.execute(
        "UPDATE workspace_skills SET version = '1.0.0' WHERE version IS NULL",
        [],
    )?;
    log::info!(
        "migration 27: backfilled null versions to '1.0.0' — skills={}, imported_skills={}, workspace_skills={}",
        skills_updated, imported_updated, workspace_updated
    );
    Ok(())
}

pub(super) fn run_rename_upload_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Rename upload → imported
    conn.execute(
        "UPDATE skills SET skill_source = 'imported' WHERE skill_source = 'upload'",
        [],
    )?;
    // Clean orphaned non-bundled imported_skills with no skills master row
    conn.execute(
        "DELETE FROM imported_skills
         WHERE is_bundled = 0
           AND skill_name NOT IN (SELECT name FROM skills WHERE COALESCE(deleted_at, '') = '')",
        [],
    )?;
    log::info!("migration 19: renamed upload→imported, cleaned orphaned imported_skills");
    Ok(())
}

pub(super) fn run_author_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let has_author = conn
        .prepare("PRAGMA table_info(workflow_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| {
                    rows.filter_map(|r| r.ok())
                        .any(|name| name == "author_login")
                })
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

pub(super) fn run_usage_tracking_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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

pub(super) fn run_workflow_session_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    let columns: Vec<String> = conn
        .prepare("PRAGMA table_info(agent_runs)")
        .and_then(|mut stmt| {
            stmt.query_map([], |row| row.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).collect())
        })
        .unwrap_or_default();

    if !columns.iter().any(|name| name == "workflow_session_id") {
        conn.execute_batch("ALTER TABLE agent_runs ADD COLUMN workflow_session_id TEXT;")?;
    }
    Ok(())
}

pub(super) fn run_agent_stats_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
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

/// Migration 28: Rename `skill_type` -> `purpose` and drop `domain` column from all 4 tables:
/// skills, workflow_runs, imported_skills, workspace_skills.
pub(super) fn run_rename_purpose_drop_domain_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    // Wrap in a transaction so partial failure rolls back, preventing irrecoverable state.
    // FK checks disabled during table rebuilds, re-enabled after commit.
    conn.execute_batch("PRAGMA foreign_keys = OFF; BEGIN;")?;

    // --- skills ---
    conn.execute_batch("
        CREATE TABLE skills_new (
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
        INSERT INTO skills_new (id, name, skill_source, purpose, created_at, updated_at,
                                description, version, model, argument_hint, user_invocable, disable_model_invocation)
            SELECT id, name, skill_source, skill_type, created_at, updated_at,
                   description, version, model, argument_hint, user_invocable, disable_model_invocation
            FROM skills;
        DROP TABLE skills;
        ALTER TABLE skills_new RENAME TO skills;
    ")?;

    // --- workflow_runs ---
    conn.execute_batch("
        CREATE TABLE workflow_runs_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name  TEXT UNIQUE NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'pending',
            purpose     TEXT DEFAULT 'domain',
            created_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
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
        INSERT INTO workflow_runs_new (id, skill_name, current_step, status, purpose,
                                       created_at, updated_at, source, description, version, model,
                                       argument_hint, user_invocable, disable_model_invocation,
                                       author_login, author_avatar, display_name, intake_json, skill_id)
            SELECT id, skill_name, current_step, status, skill_type,
                   created_at, updated_at, COALESCE(source, 'created'), description, version, model,
                   argument_hint, user_invocable, disable_model_invocation,
                   author_login, author_avatar, display_name, intake_json, skill_id
            FROM workflow_runs;
        DROP TABLE workflow_runs;
        ALTER TABLE workflow_runs_new RENAME TO workflow_runs;
    ")?;

    // --- imported_skills ---
    conn.execute_batch("
        CREATE TABLE imported_skills_new (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            is_bundled INTEGER NOT NULL DEFAULT 0,
            purpose TEXT,
            version TEXT,
            model TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            skill_master_id INTEGER REFERENCES skills(id),
            content_hash TEXT
        );
        INSERT INTO imported_skills_new (skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                                         purpose, version, model, argument_hint, user_invocable,
                                         disable_model_invocation, skill_master_id, content_hash)
            SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                   skill_type, version, model, argument_hint, user_invocable,
                   disable_model_invocation, skill_master_id, content_hash
            FROM imported_skills;
        DROP TABLE imported_skills;
        ALTER TABLE imported_skills_new RENAME TO imported_skills;
    ")?;

    // --- workspace_skills ---
    // Detect optional columns that may or may not exist (content_hash from m26, skill_master_id from test fixtures)
    let ws_cols: Vec<String> = conn
        .prepare("PRAGMA table_info(workspace_skills)")?
        .query_map([], |r| r.get::<_, String>(1))?
        .filter_map(|r| r.ok())
        .collect();
    let has_content_hash = ws_cols.iter().any(|c| c == "content_hash");
    let has_skill_master_id = ws_cols.iter().any(|c| c == "skill_master_id");

    let extra_cols_def = [
        if has_skill_master_id {
            ",\n            skill_master_id INTEGER REFERENCES skills(id)"
        } else {
            ""
        },
        if has_content_hash {
            ",\n            content_hash TEXT"
        } else {
            ""
        },
    ]
    .concat();

    let extra_cols_list = [
        if has_skill_master_id {
            ", skill_master_id"
        } else {
            ""
        },
        if has_content_hash {
            ", content_hash"
        } else {
            ""
        },
    ]
    .concat();

    let sql = format!("
        CREATE TABLE workspace_skills_new (
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
            disable_model_invocation INTEGER{extra_cols_def}
        );
        INSERT INTO workspace_skills_new (skill_id, skill_name, description, is_active, is_bundled,
                                          disk_path, imported_at, purpose, version, model,
                                          argument_hint, user_invocable, disable_model_invocation{extra_cols_list})
            SELECT skill_id, skill_name, description, is_active, is_bundled,
                   disk_path, imported_at, COALESCE(purpose, skill_type), version, model,
                   argument_hint, user_invocable, disable_model_invocation{extra_cols_list}
            FROM workspace_skills;
        DROP TABLE workspace_skills;
        ALTER TABLE workspace_skills_new RENAME TO workspace_skills;
    ");
    conn.execute_batch(&sql)?;

    // Commit transaction and re-enable FK checks
    conn.execute_batch("COMMIT; PRAGMA foreign_keys = ON;")?;

    log::info!("migration 28: renamed skill_type -> purpose, dropped domain from all 4 tables");
    Ok(())
}

/// Migration 29: Add `marketplace_source_url TEXT` to workspace_skills and imported_skills.
/// This column tracks which registry a skill was imported from (NULL for bundled/manually uploaded).
pub(super) fn run_marketplace_source_url_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    let check_col = |table: &str, col: &str| -> bool {
        conn.prepare(&format!("PRAGMA table_info({})", table))
            .and_then(|mut stmt| {
                stmt.query_map([], |r| r.get::<_, String>(1))
                    .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == col))
            })
            .unwrap_or(false)
    };
    let table_exists = |table: &str| -> bool {
        conn.query_row(
            "SELECT COUNT(*) > 0 FROM sqlite_master WHERE type='table' AND name=?1",
            [table],
            |row| row.get(0),
        )
        .unwrap_or(false)
    };
    let mut altered = false;
    if table_exists("workspace_skills") && !check_col("workspace_skills", "marketplace_source_url")
    {
        conn.execute_batch("ALTER TABLE workspace_skills ADD COLUMN marketplace_source_url TEXT;")?;
        altered = true;
    }
    if !check_col("imported_skills", "marketplace_source_url") {
        conn.execute_batch("ALTER TABLE imported_skills ADD COLUMN marketplace_source_url TEXT;")?;
        altered = true;
    }
    if altered {
        log::info!(
            "migration 29: added marketplace_source_url to workspace_skills and imported_skills"
        );
    }
    Ok(())
}

/// Migration 37: Recreate 7 child tables to add ON DELETE CASCADE to FK columns.
///
/// Migration 23 added integer FK columns via ALTER TABLE ADD COLUMN without CASCADE.
/// SQLite cannot alter column constraints in place, so we must recreate each table.
/// With PRAGMA foreign_keys = ON (set after migrations), DELETEs on parent rows would
/// fail without CASCADE because child rows block the delete.
pub(super) fn run_fk_cascade_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Idempotency: check if CASCADE is already present in the DDL for workflow_steps.
    let ws_sql: String = conn
        .query_row(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='workflow_steps'",
            [],
            |r| r.get(0),
        )
        .unwrap_or_default();
    if ws_sql.contains("ON DELETE CASCADE") {
        log::info!("migration 37: FK CASCADE already present, skipping");
        return Ok(());
    }

    // --- workflow_steps ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS workflow_steps_new;
        CREATE TABLE workflow_steps_new (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            started_at TEXT,
            completed_at TEXT,
            workflow_run_id INTEGER REFERENCES workflow_runs(id) ON DELETE CASCADE,
            PRIMARY KEY (skill_name, step_id)
        );
        INSERT INTO workflow_steps_new SELECT skill_name, step_id, status, started_at, completed_at, workflow_run_id FROM workflow_steps;
        DROP TABLE workflow_steps;
        ALTER TABLE workflow_steps_new RENAME TO workflow_steps;",
    )?;

    // --- workflow_artifacts ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS workflow_artifacts_new;
        CREATE TABLE workflow_artifacts_new (
            skill_name TEXT NOT NULL,
            step_id INTEGER NOT NULL,
            relative_path TEXT NOT NULL,
            content TEXT NOT NULL,
            size_bytes INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            workflow_run_id INTEGER REFERENCES workflow_runs(id) ON DELETE CASCADE,
            PRIMARY KEY (skill_name, step_id, relative_path)
        );
        INSERT INTO workflow_artifacts_new SELECT skill_name, step_id, relative_path, content, size_bytes, created_at, updated_at, workflow_run_id FROM workflow_artifacts;
        DROP TABLE workflow_artifacts;
        ALTER TABLE workflow_artifacts_new RENAME TO workflow_artifacts;",
    )?;

    // --- agent_runs ---
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
            workflow_run_id INTEGER REFERENCES workflow_runs(id) ON DELETE CASCADE,
            PRIMARY KEY (agent_id, model)
        );
        INSERT INTO agent_runs_new
            SELECT agent_id, skill_name, step_id, model, status,
                   input_tokens, output_tokens, total_cost, session_id,
                   started_at, completed_at,
                   cache_read_tokens, cache_write_tokens, duration_ms,
                   reset_marker, workflow_session_id,
                   num_turns, stop_reason, duration_api_ms,
                   tool_use_count, compaction_count, workflow_run_id
            FROM agent_runs;
        DROP TABLE agent_runs;
        ALTER TABLE agent_runs_new RENAME TO agent_runs;",
    )?;

    // --- skill_tags ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS skill_tags_new;
        CREATE TABLE skill_tags_new (
            skill_name TEXT NOT NULL,
            tag TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
            PRIMARY KEY (skill_name, tag)
        );
        INSERT INTO skill_tags_new SELECT skill_name, tag, created_at, skill_id FROM skill_tags;
        DROP TABLE skill_tags;
        ALTER TABLE skill_tags_new RENAME TO skill_tags;",
    )?;

    // --- skill_locks ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS skill_locks_new;
        CREATE TABLE skill_locks_new (
            skill_name TEXT PRIMARY KEY,
            instance_id TEXT NOT NULL,
            pid INTEGER NOT NULL,
            acquired_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE
        );
        INSERT INTO skill_locks_new SELECT skill_name, instance_id, pid, acquired_at, skill_id FROM skill_locks;
        DROP TABLE skill_locks;
        ALTER TABLE skill_locks_new RENAME TO skill_locks;",
    )?;

    // --- workflow_sessions ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS workflow_sessions_new;
        CREATE TABLE workflow_sessions_new (
            session_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL,
            pid INTEGER NOT NULL,
            started_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            ended_at TEXT,
            reset_marker TEXT,
            skill_id INTEGER REFERENCES skills(id) ON DELETE CASCADE
        );
        INSERT INTO workflow_sessions_new SELECT session_id, skill_name, pid, started_at, ended_at, reset_marker, skill_id FROM workflow_sessions;
        DROP TABLE workflow_sessions;
        ALTER TABLE workflow_sessions_new RENAME TO workflow_sessions;",
    )?;

    // --- imported_skills ---
    conn.execute_batch(
        "DROP TABLE IF EXISTS imported_skills_new;
        CREATE TABLE imported_skills_new (
            skill_id TEXT PRIMARY KEY,
            skill_name TEXT NOT NULL UNIQUE,
            is_active INTEGER NOT NULL DEFAULT 1,
            disk_path TEXT NOT NULL,
            imported_at TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            is_bundled INTEGER NOT NULL DEFAULT 0,
            purpose TEXT,
            version TEXT,
            model TEXT,
            argument_hint TEXT,
            user_invocable INTEGER,
            disable_model_invocation INTEGER,
            skill_master_id INTEGER REFERENCES skills(id) ON DELETE CASCADE,
            content_hash TEXT,
            marketplace_source_url TEXT
        );
        INSERT INTO imported_skills_new
            SELECT skill_id, skill_name, is_active, disk_path, imported_at, is_bundled,
                   purpose, version, model, argument_hint, user_invocable,
                   disable_model_invocation, skill_master_id, content_hash,
                   marketplace_source_url
            FROM imported_skills;
        DROP TABLE imported_skills;
        ALTER TABLE imported_skills_new RENAME TO imported_skills;",
    )?;

    // --- workflow_runs ---
    // workflow_runs.skill_id also references skills(id) without CASCADE (from m19/m28/m35).
    conn.execute_batch(
        "DROP TABLE IF EXISTS workflow_runs_new;
        CREATE TABLE workflow_runs_new (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_name  TEXT UNIQUE NOT NULL,
            current_step INTEGER NOT NULL DEFAULT 0,
            status      TEXT NOT NULL DEFAULT 'pending',
            purpose     TEXT DEFAULT 'domain',
            created_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            source      TEXT NOT NULL DEFAULT 'created',
            author_login TEXT,
            author_avatar TEXT,
            display_name TEXT,
            intake_json TEXT,
            skill_id    INTEGER REFERENCES skills(id) ON DELETE CASCADE
        );
        INSERT INTO workflow_runs_new (id, skill_name, current_step, status, purpose,
                                       created_at, updated_at, source,
                                       author_login, author_avatar, display_name,
                                       intake_json, skill_id)
            SELECT id, skill_name, current_step, status, purpose,
                   created_at, updated_at, source,
                   author_login, author_avatar, display_name,
                   intake_json, skill_id
            FROM workflow_runs;
        DROP TABLE workflow_runs;
        ALTER TABLE workflow_runs_new RENAME TO workflow_runs;",
    )?;

    log::info!("migration 37: added ON DELETE CASCADE to 8 child table FK columns");
    Ok(())
}

/// Migration 39: Add `upgrade_locked` flag to the `plugins` table.
/// When any skill in a marketplace plugin is edited, the whole plugin is locked
/// from auto-update and manual upgrade until the user explicitly unlocks it.
/// Migration 40: Create documents and document_skills tables for global document store.
pub(super) fn run_documents_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS documents (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            name        TEXT NOT NULL,
            source_type TEXT NOT NULL CHECK (source_type IN ('file', 'url', 'folder')),
            source_url  TEXT,
            file_path   TEXT NOT NULL,
            scope       TEXT NOT NULL CHECK (scope IN ('all', 'skill')) DEFAULT 'all',
            created_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z'),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now') || 'Z')
        );

        CREATE TABLE IF NOT EXISTS document_skills (
            document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
            skill_id    INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
            PRIMARY KEY (document_id, skill_id)
        );",
    )?;
    log::info!("migration 40: created documents and document_skills tables");
    Ok(())
}

/// Reset `legacy_tags_migrated` so the tag migration re-runs and converts
/// old marketplace tags (`{slug}/skills/{name}/vX.Y.Z`) to the simplified
/// layout (`{slug}/{name}/vX.Y.Z`).
pub(super) fn run_reset_legacy_tags_migrated(conn: &Connection) -> Result<(), rusqlite::Error> {
    // Settings are stored as JSON in a single row. Read, patch, write back.
    let json: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'app_settings'",
            [],
            |r| r.get(0),
        )
        .ok();
    if let Some(json) = json {
        if let Ok(mut val) = serde_json::from_str::<serde_json::Value>(&json) {
            if let Some(obj) = val.as_object_mut() {
                obj.insert(
                    "legacy_tags_migrated".to_string(),
                    serde_json::Value::Bool(false),
                );
                let updated = serde_json::to_string(&val).unwrap_or(json.clone());
                conn.execute(
                    "UPDATE settings SET value = ?1 WHERE key = 'app_settings'",
                    rusqlite::params![updated],
                )?;
            }
        }
    }
    log::info!("migration 41: reset legacy_tags_migrated for marketplace tag migration");
    Ok(())
}

pub(super) fn run_performance_indexes_migration(conn: &Connection) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_workflow_steps_run_step
            ON workflow_steps(workflow_run_id, step_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_artifacts_run
            ON workflow_artifacts(workflow_run_id);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_session_reset_started
            ON agent_runs(workflow_session_id, reset_marker, started_at);
        CREATE INDEX IF NOT EXISTS idx_agent_runs_skill_started
            ON agent_runs(skill_name, started_at);
        CREATE INDEX IF NOT EXISTS idx_workflow_sessions_reset_started_skill
            ON workflow_sessions(reset_marker, started_at, skill_name);",
    )?;
    log::info!("migration 42: added workflow performance indexes");
    Ok(())
}

pub(super) fn run_plugin_upgrade_locked_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    let has_upgrade_locked = conn
        .prepare("PRAGMA table_info(plugins)")
        .and_then(|mut stmt| {
            stmt.query_map([], |r| r.get::<_, String>(1))
                .map(|rows| rows.filter_map(|r| r.ok()).any(|n| n == "upgrade_locked"))
        })
        .unwrap_or(false);
    if !has_upgrade_locked {
        conn.execute_batch(
            "ALTER TABLE plugins ADD COLUMN upgrade_locked INTEGER NOT NULL DEFAULT 0;",
        )?;
        log::info!("migration 39: added upgrade_locked column to plugins");
    }
    Ok(())
}

/// Migration 44: workflow artifact tables for clarifications and decisions (VU-1157).
///
/// Creates seven tables that hold the canonical, fully normalized state for
/// workflow artifacts: clarifications (1:1 per skill) with sections, questions,
/// choices, and notes; decisions (1:1 per skill) with items.
///
/// All child tables are keyed by `skill_id TEXT` and CASCADE on delete from
/// their parent. `clarification_questions` self-references via
/// `parent_question_id` for refinements.
///
/// Booleans are INTEGER 0/1 (existing convention). Timestamps are unix-ms
/// INTEGER. Tri-state booleans (`scope_recommendation`) accept NULL/0/1.
/// Enum columns (`eval_verdict`, `decision_items.status`,
/// `clarification_questions.answer_verdict`,
/// `decisions.contradictory_inputs_state`) are stored as TEXT and validated at
/// the unpack boundary in higher-level code.
pub(super) fn run_workflow_artifact_tables_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    // Note: the parent rows (`clarifications`, `decisions`) do not declare an
    // FK to `skills`. The `skills` table's only UNIQUE keys are `id`
    // (INTEGER PK) and `(plugin_id, name)`; there is no UNIQUE on `name` alone
    // since the plugin-ownership migration. Per the repo data-integrity rule,
    // the application is responsible for cleaning up artifacts when a skill is
    // deleted — see `delete_clarifications` / `delete_decisions`.
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS clarifications (
            skill_id                  TEXT PRIMARY KEY,
            version                   TEXT NOT NULL,
            refinement_count          INTEGER NOT NULL DEFAULT 0,
            must_answer_count         INTEGER NOT NULL DEFAULT 0,
            question_count            INTEGER NOT NULL DEFAULT 0,
            section_count             INTEGER NOT NULL DEFAULT 0,
            title                     TEXT NOT NULL,
            scope_recommendation      INTEGER,
            scope_reason              TEXT,
            scope_next_action         TEXT,
            error_code                TEXT,
            error_message             TEXT,
            warning_code              TEXT,
            warning_message           TEXT,
            eval_verdict              TEXT,
            eval_reasoning            TEXT,
            eval_at                   INTEGER,
            eval_answered_count       INTEGER,
            eval_empty_count          INTEGER,
            eval_vague_count          INTEGER,
            eval_contradictory_count  INTEGER,
            created_at                INTEGER NOT NULL,
            updated_at                INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS clarification_sections (
            skill_id    TEXT NOT NULL REFERENCES clarifications(skill_id) ON DELETE CASCADE,
            section_id  INTEGER NOT NULL,
            ordinal     INTEGER NOT NULL,
            title       TEXT NOT NULL,
            description TEXT,
            PRIMARY KEY (skill_id, section_id)
        );

        CREATE TABLE IF NOT EXISTS clarification_questions (
            skill_id              TEXT NOT NULL REFERENCES clarifications(skill_id) ON DELETE CASCADE,
            question_id           TEXT NOT NULL,
            section_id            INTEGER NOT NULL,
            parent_question_id    TEXT,
            ordinal               INTEGER NOT NULL,
            title                 TEXT NOT NULL,
            text                  TEXT NOT NULL,
            must_answer           INTEGER NOT NULL DEFAULT 0,
            answer_choice         TEXT,
            answer_text           TEXT,
            recommendation        TEXT,
            answer_verdict        TEXT,
            answer_verdict_reason TEXT,
            PRIMARY KEY (skill_id, question_id)
        );

        CREATE TABLE IF NOT EXISTS clarification_choices (
            skill_id    TEXT NOT NULL REFERENCES clarifications(skill_id) ON DELETE CASCADE,
            question_id TEXT NOT NULL,
            choice_id   TEXT NOT NULL,
            ordinal     INTEGER NOT NULL,
            text        TEXT NOT NULL,
            is_other    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (skill_id, question_id, choice_id)
        );

        CREATE TABLE IF NOT EXISTS clarification_notes (
            note_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id TEXT NOT NULL REFERENCES clarifications(skill_id) ON DELETE CASCADE,
            ordinal  INTEGER NOT NULL,
            type     TEXT NOT NULL,
            title    TEXT NOT NULL,
            body     TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS decisions (
            skill_id                   TEXT PRIMARY KEY,
            version                    TEXT NOT NULL,
            round                      INTEGER NOT NULL DEFAULT 0,
            decision_count             INTEGER NOT NULL DEFAULT 0,
            conflicts_resolved         INTEGER NOT NULL DEFAULT 0,
            contradictory_inputs_state TEXT,
            scope_recommendation       INTEGER,
            created_at                 INTEGER NOT NULL,
            updated_at                 INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS decision_items (
            skill_id          TEXT NOT NULL REFERENCES decisions(skill_id) ON DELETE CASCADE,
            decision_id       TEXT NOT NULL,
            ordinal           INTEGER NOT NULL,
            title             TEXT NOT NULL,
            original_question TEXT NOT NULL,
            decision          TEXT NOT NULL,
            implication       TEXT NOT NULL,
            status            TEXT NOT NULL,
            PRIMARY KEY (skill_id, decision_id)
        );

        CREATE INDEX IF NOT EXISTS idx_clarification_questions_parent
            ON clarification_questions(skill_id, parent_question_id);
        CREATE INDEX IF NOT EXISTS idx_clarification_questions_section
            ON clarification_questions(skill_id, section_id);
        CREATE INDEX IF NOT EXISTS idx_clarification_choices_question
            ON clarification_choices(skill_id, question_id);
        CREATE INDEX IF NOT EXISTS idx_decision_items_skill
            ON decision_items(skill_id);",
    )?;
    log::info!("migration 44: created workflow artifact tables (clarifications + decisions)");
    Ok(())
}
