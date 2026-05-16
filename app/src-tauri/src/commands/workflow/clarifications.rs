//! Tauri commands for the clarifications workflow artifact (VU-1157).
//!
//! Reads and writes funnel through `db::workflow_artifacts`. Enum values on
//! incoming payloads are validated against the contract DTOs in
//! `contracts::workflow_artifacts` before any DB call.

use crate::contracts::workflow_artifacts::{
    validate_answer_verdict, ClarificationVerdictUpdate, ClarificationsDto, RefinementsDto,
};
use crate::db::workflow_artifacts as db_artifacts;
use crate::db::Db;

/// Read the full clarifications artifact for a skill. Returns `None` when the
/// parent row does not exist.
#[tauri::command]
pub fn get_clarifications(
    skill_id: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<ClarificationsDto>, String> {
    log::info!("[workflow] get_clarifications skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] get_clarifications skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    match db_artifacts::read_clarifications(&conn, &skill_id) {
        Ok(Some(record)) => Ok(Some(record.into())),
        Ok(None) => Ok(None),
        Err(e) => {
            log::error!(
                "[workflow] get_clarifications skill_id={} read_failed: {}",
                skill_id,
                e
            );
            Err(format!("Failed to read clarifications: {}", e))
        }
    }
}

/// Update a single question's persisted answer. `None` for either column
/// explicitly clears it.
#[tauri::command]
pub fn update_clarification_answer(
    skill_id: String,
    question_id: String,
    answer_choice: Option<String>,
    answer_text: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[workflow] update_clarification_answer skill_id={} question_id={}",
        skill_id,
        question_id
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] update_clarification_answer skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    db_artifacts::update_question_answer(
        &conn,
        &skill_id,
        &question_id,
        answer_choice.as_deref(),
        answer_text.as_deref(),
    )
    .map_err(|e| {
        log::error!(
            "[workflow] update_clarification_answer skill_id={} question_id={} write_failed: {}",
            skill_id,
            question_id,
            e
        );
        format!("Failed to update clarification answer: {}", e)
    })
}

/// Bulk-update per-question verdicts (used by the answer-evaluator gate). Each
/// entry's `verdict` is validated against the answer-verdict enum before any
/// DB write happens.
#[tauri::command]
pub fn update_clarification_verdicts(
    skill_id: String,
    updates: Vec<ClarificationVerdictUpdate>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[workflow] update_clarification_verdicts skill_id={} count={}",
        skill_id,
        updates.len()
    );

    // Validate every payload at the boundary before grabbing the DB lock or
    // writing anything. Reject the whole batch on the first invalid entry.
    for u in &updates {
        if let Some(v) = u.verdict.as_deref() {
            if let Err(err) = validate_answer_verdict(v) {
                log::error!(
                    "[workflow] update_clarification_verdicts skill_id={} invalid_verdict question_id={} err={}",
                    skill_id,
                    u.question_id,
                    err
                );
                return Err(err);
            }
        }
    }

    let mut conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] update_clarification_verdicts skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;

    let tuples: Vec<(String, Option<String>, Option<String>)> = updates
        .into_iter()
        .map(|u| (u.question_id, u.verdict, u.reason))
        .collect();

    db_artifacts::update_question_verdicts(&mut conn, &skill_id, &tuples).map_err(|e| {
        log::error!(
            "[workflow] update_clarification_verdicts skill_id={} write_failed: {}",
            skill_id,
            e
        );
        format!("Failed to update clarification verdicts: {}", e)
    })
}

/// Read the full refinements artifact for a skill.
#[tauri::command]
pub fn get_refinements(
    skill_id: String,
    db: tauri::State<'_, Db>,
) -> Result<Option<RefinementsDto>, String> {
    log::info!("[workflow] get_refinements skill_id={}", skill_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] get_refinements skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    match db_artifacts::read_refinements(&conn, &skill_id) {
        Ok(Some(record)) => Ok(Some(record.into())),
        Ok(None) => Ok(None),
        Err(e) => {
            log::error!(
                "[workflow] get_refinements skill_id={} read_failed: {}",
                skill_id,
                e
            );
            Err(format!("Failed to read refinements: {}", e))
        }
    }
}

/// Update a single refinement question's persisted answer.
#[tauri::command]
pub fn update_refinement_answer(
    skill_id: String,
    question_id: String,
    answer_choice: Option<String>,
    answer_text: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    log::info!(
        "[workflow] update_refinement_answer skill_id={} question_id={}",
        skill_id,
        question_id
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[workflow] update_refinement_answer skill_id={} lock_failed: {}",
            skill_id,
            e
        );
        e.to_string()
    })?;
    db_artifacts::update_refinement_question_answer(
        &conn,
        &skill_id,
        &question_id,
        answer_choice.as_deref(),
        answer_text.as_deref(),
    )
    .map_err(|e| {
        log::error!(
            "[workflow] update_refinement_answer skill_id={} question_id={} write_failed: {}",
            skill_id,
            question_id,
            e
        );
        format!("Failed to update refinement answer: {}", e)
    })
}
