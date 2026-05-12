use rusqlite::Connection;

use super::skills::{get_skill_master_by_id, get_skill_master_id_in_plugin};

// --- Skill Locks ---

pub fn acquire_skill_lock_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    instance_id: &str,
    pid: u32,
) -> Result<(), String> {
    // Use BEGIN IMMEDIATE to prevent race conditions between instances
    // both detecting a dead lock and trying to reclaim it simultaneously.
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = (|| -> Result<(), String> {
        let skill = get_skill_master_by_id(conn, skill_id)?
            .ok_or_else(|| "Skill not found in skills master".to_string())?;
        if let Some(existing) = get_skill_lock_by_skill_id(conn, skill_id)? {
            if existing.instance_id == instance_id {
                return Ok(()); // Already locked by us
            }
            if !check_pid_alive(existing.pid) {
                // Dead process — reclaim using skill_id FK
                conn.execute(
                    "DELETE FROM skill_locks WHERE skill_id = ?1",
                    rusqlite::params![skill_id],
                )
                .map_err(|e| e.to_string())?;
            } else {
                return Err(format!(
                    "Skill '{}' is being edited in another instance",
                    skill.name
                ));
            }
        }

        conn.execute(
            "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![skill.name, skill_id, instance_id, pid as i64],
        )
        .map_err(|e| {
            if e.to_string().contains("UNIQUE") {
                format!(
                    "Skill '{}' is being edited in another instance",
                    skill.name
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

/// Convenience wrapper: resolves skill_id from name + default plugin, then acquires lock.
pub fn acquire_skill_lock(
    conn: &Connection,
    skill_name: &str,
    instance_id: &str,
    pid: u32,
) -> Result<(), String> {
    let skill_id = get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )?
    .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;
    acquire_skill_lock_by_skill_id(conn, skill_id, instance_id, pid)
}

pub fn release_skill_lock_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    instance_id: &str,
) -> Result<(), String> {
    conn.execute(
        "DELETE FROM skill_locks WHERE skill_id = ?1 AND instance_id = ?2",
        rusqlite::params![skill_id, instance_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

/// Convenience wrapper: resolves skill_id from name + default plugin, then releases lock.
pub fn release_skill_lock(
    conn: &Connection,
    skill_name: &str,
    instance_id: &str,
) -> Result<(), String> {
    let skill_id = get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )?
    .ok_or_else(|| format!("Skill '{}' not found", skill_name))?;
    release_skill_lock_by_skill_id(conn, skill_id, instance_id)
}

pub fn release_all_instance_locks(conn: &Connection, instance_id: &str) -> Result<u32, String> {
    let count = conn
        .execute(
            "DELETE FROM skill_locks WHERE instance_id = ?1",
            [instance_id],
        )
        .map_err(|e| e.to_string())?;
    Ok(count as u32)
}

pub fn get_skill_lock_by_skill_id(
    conn: &Connection,
    skill_id: i64,
) -> Result<Option<crate::types::SkillLock>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT skill_id, skill_name, instance_id, pid, acquired_at FROM skill_locks WHERE skill_id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let result = stmt.query_row(rusqlite::params![skill_id], |row| {
        Ok(crate::types::SkillLock {
            skill_id: row.get(0)?,
            skill_name: row.get(1)?,
            instance_id: row.get(2)?,
            pid: row.get::<_, i64>(3)? as u32,
            acquired_at: row.get(4)?,
        })
    });

    match result {
        Ok(lock) => Ok(Some(lock)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

/// Convenience wrapper: resolves skill_id from name + default plugin, then queries lock.
pub fn get_skill_lock(
    conn: &Connection,
    skill_name: &str,
) -> Result<Option<crate::types::SkillLock>, String> {
    let skill_id = match get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )? {
        Some(id) => id,
        None => return Ok(None),
    };
    get_skill_lock_by_skill_id(conn, skill_id)
}

pub fn get_all_skill_locks(conn: &Connection) -> Result<Vec<crate::types::SkillLock>, String> {
    let mut stmt = conn
        .prepare("SELECT skill_id, skill_name, instance_id, pid, acquired_at FROM skill_locks")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(crate::types::SkillLock {
                skill_id: row.get(0)?,
                skill_name: row.get(1)?,
                instance_id: row.get(2)?,
                pid: row.get::<_, i64>(3)? as u32,
                acquired_at: row.get(4)?,
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
                "DELETE FROM skill_locks WHERE skill_name = ?1 AND instance_id = ?2",
                rusqlite::params![lock.skill_name, lock.instance_id],
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
    use crate::db::create_test_db_for_tests;

    /// Insert a skill master row so lock functions can look it up.
    fn insert_skill(conn: &rusqlite::Connection, name: &str) -> i64 {
        super::super::skills::upsert_skill(conn, name, "skill-builder", "test").unwrap();
        crate::db::get_skill_master_id_in_plugin(conn, name, crate::skill_paths::DEFAULT_PLUGIN_SLUG)
            .unwrap()
            .unwrap()
    }

    #[test]
    fn test_acquire_skill_lock_succeeds_for_unlocked_skill() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "my-skill");

        let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "instance-1", std::process::id());
        assert!(
            result.is_ok(),
            "acquire_skill_lock should succeed for an unlocked skill"
        );

        // Lock row should now exist
        let lock = get_skill_lock_by_skill_id(&conn, skill_id).unwrap();
        assert!(
            lock.is_some(),
            "skill_locks row should be present after acquire"
        );
        let lock = lock.unwrap();
        assert_eq!(lock.instance_id, "instance-1");
        assert_eq!(lock.skill_name, "my-skill");
    }

    #[test]
    fn test_acquire_skill_lock_idempotent_for_same_instance() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "idem-skill");

        // Acquire twice with the same instance_id — should succeed both times.
        acquire_skill_lock_by_skill_id(&conn, skill_id, "same-instance", std::process::id()).unwrap();
        let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "same-instance", std::process::id());
        assert!(result.is_ok(), "re-acquiring own lock should succeed");
    }

    #[test]
    fn test_acquire_skill_lock_fails_when_held_by_live_process() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "live-skill");

        // Acquire with the current (live) process PID under a different instance_id.
        acquire_skill_lock_by_skill_id(&conn, skill_id, "instance-owner", std::process::id()).unwrap();

        // A second instance_id must not be able to steal the lock from a live process.
        let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "instance-thief", std::process::id());
        assert!(
            result.is_err(),
            "acquire should fail while skill is locked by a live process"
        );
        let err = result.unwrap_err();
        assert!(
            err.contains("being edited in another instance"),
            "error should describe lock conflict, got: {}",
            err
        );
    }

    #[test]
    fn test_acquire_skill_lock_reclaims_dead_pid_lock() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "dead-skill");

        // Manually insert a lock with a PID that is guaranteed not to be alive.
        conn.execute(
            "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES ('dead-skill', ?1, 'dead-instance', 9999999)",
            rusqlite::params![skill_id],
        )
        .unwrap();

        // A new instance should be able to reclaim the lock held by PID 9999999 (dead).
        let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "new-instance", std::process::id());
        assert!(
            result.is_ok(),
            "acquire should reclaim a lock held by a dead PID, got: {:?}",
            result
        );

        let lock = get_skill_lock_by_skill_id(&conn, skill_id).unwrap().unwrap();
        assert_eq!(
            lock.instance_id, "new-instance",
            "lock should now belong to new-instance"
        );
    }

    #[test]
    fn test_release_skill_lock_removes_lock_and_allows_reacquire() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "rel-skill");

        acquire_skill_lock_by_skill_id(&conn, skill_id, "holder", std::process::id()).unwrap();

        // Release the lock.
        release_skill_lock_by_skill_id(&conn, skill_id, "holder").unwrap();

        // Lock row should be gone.
        let lock = get_skill_lock_by_skill_id(&conn, skill_id).unwrap();
        assert!(lock.is_none(), "lock row should be absent after release");

        // Another instance should now be able to acquire.
        let result = acquire_skill_lock_by_skill_id(&conn, skill_id, "new-holder", std::process::id());
        assert!(result.is_ok(), "reacquire after release should succeed");
    }

    #[test]
    fn test_release_skill_lock_is_noop_for_wrong_instance() {
        let conn = create_test_db_for_tests();
        let skill_id = insert_skill(&conn, "wrong-rel-skill");

        acquire_skill_lock_by_skill_id(&conn, skill_id, "real-owner", std::process::id()).unwrap();

        // Releasing with a different instance_id must not remove the real owner's lock.
        release_skill_lock_by_skill_id(&conn, skill_id, "impostor").unwrap();

        let lock = get_skill_lock_by_skill_id(&conn, skill_id).unwrap();
        assert!(lock.is_some(), "real owner's lock should still be present");
        assert_eq!(lock.unwrap().instance_id, "real-owner");
    }

    #[test]
    fn test_reclaim_dead_locks_removes_dead_and_keeps_live() {
        let conn = create_test_db_for_tests();
        let live_id = insert_skill(&conn, "live-locked");
        let dead_id = insert_skill(&conn, "dead-locked");

        // Live lock (current process PID).
        acquire_skill_lock_by_skill_id(&conn, live_id, "live-inst", std::process::id()).unwrap();

        // Dead lock (bogus PID inserted directly).
        conn.execute(
            "INSERT INTO skill_locks (skill_name, skill_id, instance_id, pid) VALUES ('dead-locked', ?1, 'dead-inst', 9999999)",
            rusqlite::params![dead_id],
        )
        .unwrap();

        let reclaimed = reclaim_dead_locks(&conn).unwrap();

        // The dead lock should be reclaimed; the live lock must remain.
        assert_eq!(reclaimed, 1, "exactly one dead lock should be reclaimed");
        assert!(
            get_skill_lock_by_skill_id(&conn, live_id).unwrap().is_some(),
            "live lock must not be removed"
        );
        assert!(
            get_skill_lock_by_skill_id(&conn, dead_id).unwrap().is_none(),
            "dead lock should be removed"
        );
    }

    #[test]
    fn test_acquire_skill_lock_fails_for_unknown_skill() {
        let conn = create_test_db_for_tests();
        // No skill inserted — the lock function must return an error.
        let result = acquire_skill_lock_by_skill_id(&conn, 99999, "inst", 1);
        assert!(
            result.is_err(),
            "acquire should fail when skill is not in the skills table"
        );
    }
}
