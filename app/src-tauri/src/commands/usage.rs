use crate::db::Db;
use crate::types::{AgentRunRecord, UsageByModel, UsageByStep, UsageSummary, WorkflowSessionRecord};

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn persist_agent_run(
    db: tauri::State<'_, Db>,
    agent_id: String,
    skill_name: String,
    step_id: i32,
    model: String,
    status: String,
    input_tokens: i32,
    output_tokens: i32,
    cache_read_tokens: i32,
    cache_write_tokens: i32,
    total_cost: f64,
    duration_ms: i64,
    num_turns: i32,
    stop_reason: Option<String>,
    duration_api_ms: Option<i64>,
    tool_use_count: i32,
    compaction_count: i32,
    session_id: Option<String>,
    workflow_session_id: Option<String>,
) -> Result<(), String> {
    log::info!("[persist_agent_run] agent={} skill={} step={} model={} status={}", agent_id, skill_name, step_id, model, status);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[persist_agent_run] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::persist_agent_run(
        &conn, &agent_id, &skill_name, step_id, &model, &status,
        input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
        total_cost, duration_ms, num_turns, stop_reason.as_deref(), duration_api_ms,
        tool_use_count, compaction_count,
        session_id.as_deref(), workflow_session_id.as_deref(),
    )
}

#[tauri::command]
pub fn get_usage_summary(db: tauri::State<'_, Db>, hide_cancelled: bool) -> Result<UsageSummary, String> {
    log::info!("[get_usage_summary] hide_cancelled={}", hide_cancelled);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_summary] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_summary(&conn, hide_cancelled)
}

#[tauri::command]
pub fn get_recent_runs(
    db: tauri::State<'_, Db>,
    limit: usize,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!("[get_recent_runs] limit={}", limit);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_recent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_recent_runs(&conn, limit)
}

#[tauri::command]
pub fn get_usage_by_step(db: tauri::State<'_, Db>, hide_cancelled: bool) -> Result<Vec<UsageByStep>, String> {
    log::info!("[get_usage_by_step] hide_cancelled={}", hide_cancelled);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_by_step] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_by_step(&conn, hide_cancelled)
}

#[tauri::command]
pub fn get_usage_by_model(db: tauri::State<'_, Db>, hide_cancelled: bool) -> Result<Vec<UsageByModel>, String> {
    log::info!("[get_usage_by_model] hide_cancelled={}", hide_cancelled);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_by_model] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_by_model(&conn, hide_cancelled)
}

#[tauri::command]
pub fn reset_usage(db: tauri::State<'_, Db>) -> Result<(), String> {
    log::info!("[reset_usage]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[reset_usage] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::reset_usage(&conn)
}

#[tauri::command]
pub fn get_recent_workflow_sessions(
    db: tauri::State<'_, Db>,
    limit: usize,
    hide_cancelled: bool,
) -> Result<Vec<WorkflowSessionRecord>, String> {
    log::info!("[get_recent_workflow_sessions] limit={} hide_cancelled={}", limit, hide_cancelled);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_recent_workflow_sessions] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_recent_workflow_sessions(&conn, limit, hide_cancelled)
}

#[tauri::command]
pub fn get_session_agent_runs(
    db: tauri::State<'_, Db>,
    session_id: String,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!("[get_session_agent_runs] session={}", session_id); // codeql[rust/cleartext-logging]
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_session_agent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_session_agent_runs(&conn, &session_id)
}

#[tauri::command]
pub fn get_step_agent_runs(
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: i32,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!("[get_step_agent_runs] skill={} step={}", skill_name, step_id);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_step_agent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_step_agent_runs(&conn, &skill_name, step_id)
}
