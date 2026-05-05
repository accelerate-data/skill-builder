//! Tauri commands for the decisions workflow artifact (VU-1157).

use crate::contracts::workflow_artifacts::DecisionsDto;
use crate::db::workflow_artifacts::{self as db_artifacts, DecisionItemEdit};
use crate::db::Db;

/// Persist user edits to specific decision items (decision text, implication,
/// status). Only items the user can edit — those with status `needs-review` or
/// `revised` — should be sent; the command updates whatever is supplied.
#[tauri::command]
pub fn save_decisions_edit(
    skill_id: String,
    items: Vec<DecisionItemEdit>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[workflow] save_decisions_edit skill_id={} item_count={}",
        skill_id,
        items.len()
    );
    let mut conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] save_decisions_edit skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    db_artifacts::update_decision_items_edit(&mut conn, &skill_id, &items).map_err(|e| {
        log::error!(
            "[workflow] save_decisions_edit skill_id={} write_failed: {}",
            skill_id,
            e
        );
        format!("Failed to save decision edits: {}", e)
    })
}

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
