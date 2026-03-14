use crate::db::Db;
use crate::types::{
    AgentRunRecord, UsageByDay, UsageByModel, UsageByStep, UsageSummary, WorkflowSessionRecord,
};

#[tauri::command]
pub fn get_usage_summary(
    db: tauri::State<'_, Db>,
    hide_cancelled: bool,
    start_date: Option<String>,
    skill_name: Option<String>,
) -> Result<UsageSummary, String> {
    log::info!(
        "[get_usage_summary] hide_cancelled={} start_date={:?} skill_name={:?}",
        hide_cancelled,
        start_date,
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_summary] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_summary(
        &conn,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
    )
}

#[tauri::command]
pub fn get_workflow_skill_names(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    log::info!("[get_workflow_skill_names]");
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[get_workflow_skill_names] Failed to acquire DB lock: {}",
            e
        );
        e.to_string()
    })?;
    crate::db::get_workflow_skill_names(&conn)
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
pub fn get_usage_by_step(
    db: tauri::State<'_, Db>,
    hide_cancelled: bool,
    start_date: Option<String>,
    skill_name: Option<String>,
) -> Result<Vec<UsageByStep>, String> {
    log::info!(
        "[get_usage_by_step] hide_cancelled={} start_date={:?} skill_name={:?}",
        hide_cancelled,
        start_date,
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_by_step] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_by_step(
        &conn,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
    )
}

#[tauri::command]
pub fn get_usage_by_model(
    db: tauri::State<'_, Db>,
    hide_cancelled: bool,
    start_date: Option<String>,
    skill_name: Option<String>,
) -> Result<Vec<UsageByModel>, String> {
    log::info!(
        "[get_usage_by_model] hide_cancelled={} start_date={:?} skill_name={:?}",
        hide_cancelled,
        start_date,
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_by_model] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_by_model(
        &conn,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
    )
}

#[tauri::command]
pub fn get_usage_by_day(
    db: tauri::State<'_, Db>,
    hide_cancelled: bool,
    start_date: Option<String>,
    skill_name: Option<String>,
) -> Result<Vec<UsageByDay>, String> {
    log::info!(
        "[get_usage_by_day] hide_cancelled={} start_date={:?} skill_name={:?}",
        hide_cancelled,
        start_date,
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_usage_by_day] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_usage_by_day(
        &conn,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
    )
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
    start_date: Option<String>,
    skill_name: Option<String>,
) -> Result<Vec<WorkflowSessionRecord>, String> {
    log::info!(
        "[get_recent_workflow_sessions] limit={} hide_cancelled={} start_date={:?} skill_name={:?}",
        limit,
        hide_cancelled,
        start_date,
        skill_name
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!(
            "[get_recent_workflow_sessions] Failed to acquire DB lock: {}",
            e
        );
        e.to_string()
    })?;
    crate::db::get_recent_workflow_sessions(
        &conn,
        limit,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
    )
}

#[tauri::command]
pub fn get_session_agent_runs(
    db: tauri::State<'_, Db>,
    session_id: String,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!("[get_session_agent_runs] session=[REDACTED]");
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_session_agent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_session_agent_runs(&conn, &session_id)
}

#[tauri::command]
pub fn get_agent_runs(
    db: tauri::State<'_, Db>,
    hide_cancelled: bool,
    start_date: Option<String>,
    skill_name: Option<String>,
    model_family: Option<String>,
    limit: usize,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!("[get_agent_runs] hide_cancelled={} start_date={:?} skill_name={:?} model_family={:?} limit={}", hide_cancelled, start_date, skill_name, model_family, limit);
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_agent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_agent_runs(
        &conn,
        hide_cancelled,
        start_date.as_deref(),
        skill_name.as_deref(),
        model_family.as_deref(),
        limit,
    )
}

#[tauri::command]
pub fn get_step_agent_runs(
    db: tauri::State<'_, Db>,
    skill_name: String,
    step_id: i32,
) -> Result<Vec<AgentRunRecord>, String> {
    log::info!(
        "[get_step_agent_runs] skill={} step={} step_id={}",
        skill_name,
        crate::db::step_name(step_id),
        step_id
    );
    let conn = db.0.lock().map_err(|e| {
        log::error!("[get_step_agent_runs] Failed to acquire DB lock: {}", e);
        e.to_string()
    })?;
    crate::db::get_step_agent_runs(&conn, &skill_name, step_id)
}

#[cfg(test)]
mod tests {
    use crate::db::create_test_db_for_tests;

    /// Insert a minimal agent_run that appears in session-based queries.
    /// Creates the skill master and workflow_session rows as side effects.
    fn insert_session_run(
        conn: &rusqlite::Connection,
        agent_id: &str,
        skill_name: &str,
        step_id: i32,
        status: &str,
        total_cost: f64,
        workflow_session_id: &str,
    ) {
        // Ensure skill master row exists (required by persist_agent_run FK)
        crate::db::upsert_skill(conn, skill_name, "skill-builder", "test purpose").unwrap();
        crate::db::persist_agent_run(
            conn,
            agent_id,
            skill_name,
            step_id,
            "claude-sonnet-4-6",
            status,
            1000,
            200,
            0,
            0,
            total_cost,
            5000,
            3,
            Some("end_turn"),
            Some(4500),
            1,
            0,
            None,
            Some(workflow_session_id),
        )
        .unwrap();
    }

    /// Insert an agent_run without a session (shows in get_recent_runs only).
    fn insert_run(
        conn: &rusqlite::Connection,
        agent_id: &str,
        skill_name: &str,
        step_id: i32,
        status: &str,
        total_cost: f64,
    ) {
        crate::db::persist_agent_run(
            conn,
            agent_id,
            skill_name,
            step_id,
            "claude-sonnet-4-6",
            status,
            1000,
            200,
            0,
            0,
            total_cost,
            5000,
            3,
            Some("end_turn"),
            Some(4500),
            1,
            0,
            None,
            None,
        )
        .unwrap();
    }

    #[test]
    fn test_persist_and_read_recent_runs() {
        let conn = create_test_db_for_tests();
        insert_run(&conn, "run-1", "my-skill", 0, "completed", 0.05);

        let runs = crate::db::get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].agent_id, "run-1");
        assert_eq!(runs[0].skill_name, "my-skill");
        assert_eq!(runs[0].step_id, 0);
        assert!((runs[0].total_cost - 0.05).abs() < 0.001);
    }

    #[test]
    fn test_get_recent_runs_respects_limit() {
        let conn = create_test_db_for_tests();
        for i in 0..5 {
            insert_run(&conn, &format!("run-{i}"), "skill-a", 0, "completed", 0.01);
        }
        let runs = crate::db::get_recent_runs(&conn, 3).unwrap();
        assert_eq!(runs.len(), 3);
    }

    #[test]
    fn test_reset_usage_clears_agent_runs() {
        let conn = create_test_db_for_tests();
        insert_run(&conn, "run-1", "skill-a", 0, "completed", 0.05);
        insert_run(&conn, "run-2", "skill-b", 0, "completed", 0.10);

        crate::db::reset_usage(&conn).unwrap();

        let runs = crate::db::get_recent_runs(&conn, 10).unwrap();
        assert!(runs.is_empty());
    }

    #[test]
    fn test_get_usage_summary_empty() {
        let conn = create_test_db_for_tests();
        let summary = crate::db::get_usage_summary(&conn, false, None, None).unwrap();
        assert_eq!(summary.total_runs, 0);
        assert_eq!(summary.total_cost, 0.0);
    }

    #[test]
    fn test_get_usage_summary_counts_sessions() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.10, "ws-1");
        insert_session_run(&conn, "run-2", "skill-b", 0, "completed", 0.05, "ws-2");

        let summary = crate::db::get_usage_summary(&conn, false, None, None).unwrap();
        assert_eq!(summary.total_runs, 2);
        assert!((summary.total_cost - 0.15).abs() < 0.001);
    }

    #[test]
    fn test_get_usage_summary_filters_by_skill() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.10, "ws-1");
        insert_session_run(&conn, "run-2", "skill-b", 0, "completed", 0.05, "ws-2");

        let summary = crate::db::get_usage_summary(&conn, false, None, Some("skill-a")).unwrap();
        assert_eq!(summary.total_runs, 1);
        assert!((summary.total_cost - 0.10).abs() < 0.001);
    }

    #[test]
    fn test_get_workflow_skill_names_distinct() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.05, "ws-1");
        insert_session_run(&conn, "run-2", "skill-a", 1, "completed", 0.10, "ws-2");
        insert_session_run(&conn, "run-3", "skill-b", 0, "completed", 0.05, "ws-3");

        let names = crate::db::get_workflow_skill_names(&conn).unwrap();
        assert_eq!(names.len(), 2);
        assert!(names.contains(&"skill-a".to_string()));
        assert!(names.contains(&"skill-b".to_string()));
    }

    #[test]
    fn test_get_usage_by_step_groups_correctly() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.10, "ws-1");
        insert_session_run(&conn, "run-2", "skill-a", 0, "completed", 0.05, "ws-2");
        insert_session_run(&conn, "run-3", "skill-a", 2, "completed", 0.20, "ws-3");

        let by_step = crate::db::get_usage_by_step(&conn, false, None, None).unwrap();
        let step0 = by_step.iter().find(|s| s.step_id == 0).unwrap();
        assert_eq!(step0.run_count, 2);
        assert!((step0.total_cost - 0.15).abs() < 0.001);
        let step2 = by_step.iter().find(|s| s.step_id == 2).unwrap();
        assert_eq!(step2.run_count, 1);
    }

    #[test]
    fn test_get_usage_by_model_groups_correctly() {
        let conn = create_test_db_for_tests();
        crate::db::upsert_skill(&conn, "skill-a", "skill-builder", "test").unwrap();
        // Insert two sonnet runs and one opus run
        crate::db::persist_agent_run(
            &conn, "run-1", "skill-a", 0, "claude-sonnet-4-6", "completed",
            1000, 200, 0, 0, 0.10, 5000, 3, Some("end_turn"), None, 1, 0, None, Some("ws-1"),
        ).unwrap();
        crate::db::persist_agent_run(
            &conn, "run-2", "skill-a", 1, "claude-opus-4-6", "completed",
            2000, 400, 0, 0, 0.50, 8000, 5, Some("end_turn"), None, 2, 0, None, Some("ws-2"),
        ).unwrap();
        crate::db::persist_agent_run(
            &conn, "run-3", "skill-a", 0, "claude-sonnet-4-6", "completed",
            500, 100, 0, 0, 0.05, 2000, 1, Some("end_turn"), None, 0, 0, None, Some("ws-3"),
        ).unwrap();

        let by_model = crate::db::get_usage_by_model(&conn, false, None, None).unwrap();
        assert_eq!(by_model.len(), 2);
        // The query normalizes model names to "Sonnet", "Opus", "Haiku" families (capitalized)
        let sonnet = by_model.iter().find(|m| m.model.to_lowercase().contains("sonnet")).unwrap();
        assert_eq!(sonnet.run_count, 2);
        assert!((sonnet.total_cost - 0.15).abs() < 0.001);
        let opus = by_model.iter().find(|m| m.model.to_lowercase().contains("opus")).unwrap();
        assert_eq!(opus.run_count, 1);
    }

    #[test]
    fn test_get_usage_by_day_groups_today() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.10, "ws-1");
        insert_session_run(&conn, "run-2", "skill-b", 0, "completed", 0.05, "ws-2");

        let by_day = crate::db::get_usage_by_day(&conn, false, None, None).unwrap();
        // Both runs inserted today — should be 1 day bucket
        assert_eq!(by_day.len(), 1);
        assert_eq!(by_day[0].run_count, 2);
        assert!((by_day[0].total_cost - 0.15).abs() < 0.001);
    }

    #[test]
    fn test_get_session_agent_runs_filters_by_session() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.05, "ws-sess-1");
        insert_session_run(&conn, "run-2", "skill-a", 0, "completed", 0.05, "ws-sess-2");

        let runs = crate::db::get_session_agent_runs(&conn, "ws-sess-1").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].agent_id, "run-1");
    }

    #[test]
    fn test_get_step_agent_runs_filters_by_skill_and_step() {
        let conn = create_test_db_for_tests();
        // get_step_agent_runs queries agent_runs by workflow_run_id (not skill_name directly).
        // We must create a workflow_run row for "skill-a" and backfill workflow_run_id.
        crate::db::save_workflow_run(&conn, "skill-a", 0, "in_progress", "test").unwrap();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.05, "ws-1");
        insert_session_run(&conn, "run-2", "skill-a", 2, "completed", 0.10, "ws-2");
        // Backfill workflow_run_id on agent_runs (mirrors the run_fk_columns_migration backfill)
        conn.execute_batch(
            "UPDATE agent_runs
             SET workflow_run_id = (
                 SELECT wr.id FROM workflow_runs wr WHERE wr.skill_name = agent_runs.skill_name
             )
             WHERE workflow_run_id IS NULL;"
        ).unwrap();

        let runs = crate::db::get_step_agent_runs(&conn, "skill-a", 0).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].agent_id, "run-1");
    }

    #[test]
    fn test_get_recent_workflow_sessions_returns_sessions() {
        let conn = create_test_db_for_tests();
        insert_session_run(&conn, "run-1", "skill-a", 0, "completed", 0.10, "ws-1");
        insert_session_run(&conn, "run-2", "skill-b", 0, "completed", 0.05, "ws-2");

        let sessions = crate::db::get_recent_workflow_sessions(&conn, 10, false, None, None).unwrap();
        assert_eq!(sessions.len(), 2);
    }

    #[test]
    fn test_shutdown_status_does_not_overwrite_completed() {
        let conn = create_test_db_for_tests();
        // Insert a completed run
        insert_run(&conn, "run-1", "skill-a", 0, "completed", 0.10);

        // Attempt to overwrite with shutdown status (should be a no-op)
        crate::db::persist_agent_run(
            &conn, "run-1", "skill-a", 0, "claude-sonnet-4-6", "shutdown",
            0, 0, 0, 0, 0.0, 0, 0, None, None, 0, 0, None, None,
        ).unwrap();

        let runs = crate::db::get_recent_runs(&conn, 10).unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0].status, "completed");
        assert!((runs[0].total_cost - 0.10).abs() < 0.001);
    }
}
