use rusqlite::Connection;

use super::skills::get_skill_master_id;

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

pub fn release_all_instance_locks(conn: &Connection, instance_id: &str) -> Result<u32, String> {
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

pub fn get_all_skill_locks(conn: &Connection) -> Result<Vec<crate::types::SkillLock>, String> {
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

