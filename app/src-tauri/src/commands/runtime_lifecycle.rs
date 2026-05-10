use crate::db::Db;
use crate::{CloseGuardState, InstanceInfo};
use rusqlite::Connection;

fn release_instance_runtime_state(
    conn: &Connection,
    instance: &InstanceInfo,
) -> Result<(), String> {
    let _ = crate::db::release_all_instance_locks(conn, &instance.id)?;
    let _ = crate::commands::workflow_lifecycle::shutdown_sessions_for_pid(conn, instance.pid)?;
    Ok(())
}

/// Stop the OpenHands agent server for the current skill.
/// Called when navigating away from a skill (workflow or workspace) so that
/// Python's __aexit__ runs, conversation leases are released, and the next
/// skill's server starts with a clean slate.
#[tauri::command]
pub async fn stop_openhands_server() -> Result<(), String> {
    log::info!("[stop_openhands_server] shutting down OpenHands agent server");
    crate::agents::openhands_server::process::shutdown_agent_server()
        .await
        .map_err(|e| {
            log::warn!("[stop_openhands_server] shutdown failed: {e}");
            e.to_string()
        })
}

/// Graceful shutdown: release locks, end sessions, then exit.
/// Called by the close-guard when the user confirms closing with agents running.
///
/// Wraps the entire operation in a configurable timeout (default 5s). If the
/// timeout expires, logs a warning and force-exits the process.
#[tauri::command]
pub async fn graceful_shutdown(
    db: tauri::State<'_, Db>,
    instance: tauri::State<'_, InstanceInfo>,
) -> Result<(), String> {
    const TIMEOUT_SECS: u64 = 5;
    log::info!("[graceful_shutdown] called (timeout={}s)", TIMEOUT_SECS);

    let shutdown_result =
        tokio::time::timeout(std::time::Duration::from_secs(TIMEOUT_SECS), async {
            // Release all skill locks and end workflow sessions for this instance
            if let Ok(conn) = db.0.lock() {
                let _ = release_instance_runtime_state(&conn, &instance);
                log::info!("[graceful_shutdown] locks released, sessions ended");
            }

            crate::agents::openhands_server::process::shutdown_agent_server()
                .await
                .map_err(|e| format!("OpenHands Agent Server shutdown failed: {e}"))?;
            log::info!("[graceful_shutdown] OpenHands Agent Server shutdown complete");

            Ok::<(), String>(())
        })
        .await;

    match shutdown_result {
        Ok(Ok(())) => {
            log::info!("[graceful_shutdown] complete");
            Ok(())
        }
        Ok(Err(error)) => {
            log::warn!("[graceful_shutdown] failed: {error}");
            Err(error)
        }
        Err(_) => {
            log::warn!("[graceful_shutdown] timed out after {}s", TIMEOUT_SECS,);
            Err(format!(
                "Graceful shutdown timed out after {}s. Force-exit required.",
                TIMEOUT_SECS
            ))
        }
    }
}

#[tauri::command]
pub fn allow_app_exit(close_guard: tauri::State<'_, CloseGuardState>) {
    log::info!("[allow_app_exit] marked");
    close_guard.allow_exit();
}

#[cfg(test)]
mod tests {
    use super::release_instance_runtime_state;
    use crate::commands::test_utils::create_test_db;
    use crate::db::{acquire_skill_lock, create_workflow_session};
    use crate::InstanceInfo;

    #[test]
    fn release_instance_runtime_state_releases_locks_and_ends_sessions_for_instance() {
        let conn = create_test_db();
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id)
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
            rusqlite::params!["skill-a", crate::skill_paths::DEFAULT_PLUGIN_SLUG],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id)
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = ?2))",
            rusqlite::params!["skill-b", crate::skill_paths::DEFAULT_PLUGIN_SLUG],
        )
        .unwrap();

        acquire_skill_lock(&conn, "skill-a", "instance-a", 4242).unwrap();
        acquire_skill_lock(&conn, "skill-b", "instance-b", 5151).unwrap();
        create_workflow_session(&conn, "sess-a", "skill-a", 4242).unwrap();
        create_workflow_session(&conn, "sess-b", "skill-b", 5151).unwrap();

        release_instance_runtime_state(
            &conn,
            &InstanceInfo {
                id: "instance-a".to_string(),
                pid: 4242,
            },
        )
        .unwrap();

        let remaining_lock_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skill_locks WHERE instance_id = 'instance-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(remaining_lock_count, 0);

        let other_lock_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM skill_locks WHERE instance_id = 'instance-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(other_lock_count, 1);

        let ended_at_a: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-a'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at_a.is_some());

        let ended_at_b: Option<String> = conn
            .query_row(
                "SELECT ended_at FROM workflow_sessions WHERE session_id = 'sess-b'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(ended_at_b.is_none());
    }
}
