use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

pub mod imported_skills;
pub mod locks;
pub mod migrations;
pub mod settings;
pub mod skills;
pub mod usage;
pub mod workflow;

pub use imported_skills::*;
pub use locks::*;
pub use settings::*;
pub use skills::*;
pub use usage::*;
pub use workflow::*;

// Re-export migration helpers needed by init_db, create_test_db_for_tests, and tests
use migrations::{
    ensure_migration_table, mark_migration_applied, migration_applied, repair_skills_table_schema,
    run_marketplace_source_url_migration, run_migrations, NUMBERED_MIGRATIONS,
};

pub struct Db(pub Mutex<Connection>);

#[cfg(test)]
pub(crate) fn create_test_db_for_tests() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    ensure_migration_table(&conn).unwrap();
    conn.pragma_update(None, "foreign_keys", false).unwrap();
    run_migrations(&conn).unwrap();
    for &(version, migrate_fn) in NUMBERED_MIGRATIONS {
        migrate_fn(&conn).unwrap();
        mark_migration_applied(&conn, version).unwrap();
    }
    repair_skills_table_schema(&conn).unwrap();
    run_marketplace_source_url_migration(&conn).unwrap();
    conn.pragma_update(None, "foreign_keys", true).unwrap();
    conn
}

pub fn init_db(data_dir: &Path) -> Result<Db, Box<dyn std::error::Error>> {
    fs::create_dir_all(data_dir)?;
    let db_dir = data_dir.join("db");
    fs::create_dir_all(&db_dir)?;

    let legacy_db_path = data_dir.join("skill-builder.db");
    let db_path = db_dir.join("skill-builder.db");
    migrate_legacy_db_path(&legacy_db_path, &db_path)?;

    let conn = Connection::open(db_path)?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;
    conn.pragma_update(None, "busy_timeout", "5000")
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    ensure_migration_table(&conn)?;

    // Keep FK enforcement OFF for the entire migration sequence. Some migrations
    // (e.g. migration 28) call `PRAGMA foreign_keys = ON` after table rebuilds, which
    // leaves FK checks enabled for subsequent migrations on the same connection. Later
    // migrations that copy rows with orphaned FK values (e.g. workflow_runs.skill_id
    // pointing to deleted skills rows) would then fail. Migrations must never rely on
    // FK enforcement being ON — data integrity is the responsibility of application code.
    conn.pragma_update(None, "foreign_keys", false)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    // Migration 0: base schema (always runs via CREATE TABLE IF NOT EXISTS)
    run_migrations(&conn)?;

    for &(version, migrate_fn) in NUMBERED_MIGRATIONS {
        if !migration_applied(&conn, version) {
            migrate_fn(&conn)?;
            mark_migration_applied(&conn, version)?;
        }
    }

    // Startup repair: ensure skills master has frontmatter columns regardless of migration state.
    // Idempotent — checks column existence before ALTER TABLE. Guards against dev builds that
    // recorded migration 24 in schema_migrations before the ALTER TABLE statements ran.
    repair_skills_table_schema(&conn).map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    // Startup repair: ensure marketplace_source_url columns exist regardless of migration state.
    // Guards against dev builds that recorded migration 29 before the ALTER TABLE statements ran.
    run_marketplace_source_url_migration(&conn)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    // Re-enable FK enforcement now that all migrations are complete.
    // This ensures ON DELETE CASCADE and other FK constraints are active for all app writes.
    conn.pragma_update(None, "foreign_keys", true)
        .map_err(|e| Box::new(e) as Box<dyn std::error::Error>)?;

    // Run one-time settings migrations (marketplace registry init + URL normalization).
    // These previously ran on every get_settings call; now they run once at startup.
    if let Err(e) = crate::commands::settings::run_settings_startup_migrations(&conn) {
        log::error!("[init_db] settings startup migrations failed: {}", e);
    }

    Ok(Db(Mutex::new(conn)))
}

fn migrate_legacy_db_path(
    legacy_path: &Path,
    new_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    if new_path.exists() || !legacy_path.exists() {
        return Ok(());
    }

    if let Some(parent) = new_path.parent() {
        fs::create_dir_all(parent)?;
    }

    match fs::rename(legacy_path, new_path) {
        Ok(()) => {
            log::info!(
                "[init_db] migrated legacy database path from {} to {}",
                legacy_path.display(),
                new_path.display()
            );
            Ok(())
        }
        Err(rename_err) => {
            log::warn!(
                "[init_db] failed to rename legacy db path ({} -> {}): {}; trying copy fallback",
                legacy_path.display(),
                new_path.display(),
                rename_err
            );
            fs::copy(legacy_path, new_path)?;
            if let Err(remove_err) = fs::remove_file(legacy_path) {
                log::warn!(
                    "[init_db] copied legacy db but could not remove old file {}: {}",
                    legacy_path.display(),
                    remove_err
                );
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests;
