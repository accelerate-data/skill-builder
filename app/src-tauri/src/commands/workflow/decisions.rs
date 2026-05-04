//! Tauri commands for the decisions workflow artifact (VU-1157).

use crate::contracts::workflow_artifacts::DecisionsDto;
use crate::db::workflow_artifacts as db_artifacts;
use crate::db::Db;

/// Read the full decisions artifact for a skill. Returns `None` when the
/// parent row does not exist.
#[tauri::command]
pub fn get_decisions(
    skill_id: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<DecisionsDto>, String> {
    log::info!("[workflow] get_decisions skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] get_decisions skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    match db_artifacts::read_decisions(&conn, &skill_id) {
        Ok(Some(record)) => Ok(Some(record.into())),
        Ok(None) => Ok(None),
        Err(e) => {
            log::error!(
                "[workflow] get_decisions skill_id={} read_failed: {}",
                skill_id,
                e
            );
            Err(format!("Failed to read decisions: {}", e))
        }
    }
}
