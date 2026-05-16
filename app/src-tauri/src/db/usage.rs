use crate::types::{
    ConversationRunRecord, UsageByModel, UsageByStep, UsageSummary, WorkflowSessionRecord,
};
use rusqlite::Connection;

use super::workflow::get_workflow_run_id_by_skill_id;

pub(crate) fn step_name(step_id: i32) -> String {
    match step_id {
        -11 => "Test".to_string(),
        -10 => "Refine".to_string(),
        0 => "Research".to_string(),
        1 => "Detailed Research".to_string(),
        2 => "Confirm Decisions".to_string(),
        3 => "Generate Skill".to_string(),
        _ => format!("Step {}", step_id),
    }
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub fn persist_conversation_run(
    conn: &Connection,
    conversation_id: &str,
    skill_name: &str,
    plugin_slug: &str,
    step_id: i32,
    model: &str,
    status: &str,
    input_tokens: i32,
    output_tokens: i32,
    cache_read_tokens: i32,
    cache_write_tokens: i32,
    total_cost: f64,
    duration_ms: i64,
    num_turns: i32,
    stop_reason: Option<&str>,
    duration_api_ms: Option<i64>,
    tool_use_count: i32,
    compaction_count: i32,
    session_id: Option<&str>,
    workflow_session_id: Option<&str>,
) -> Result<(), String> {
    let skill_id =
        match super::skills::get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)? {
            Some(skill_id) => skill_id,
            None => {
                super::skills::upsert_skill(conn, skill_name, "skill-builder", "test purpose")?;
                super::skills::get_skill_master_id_in_plugin(conn, skill_name, plugin_slug)?
                    .ok_or_else(|| {
                        format!(
                            "Skill '{}' not found in plugin '{}'",
                            skill_name, plugin_slug
                        )
                    })?
            }
        };
    persist_conversation_run_with_skill_id(
        conn,
        conversation_id,
        skill_id,
        skill_name,
        plugin_slug,
        step_id,
        model,
        status,
        input_tokens,
        output_tokens,
        cache_read_tokens,
        cache_write_tokens,
        total_cost,
        duration_ms,
        num_turns,
        stop_reason,
        duration_api_ms,
        tool_use_count,
        compaction_count,
        session_id,
        workflow_session_id,
    )
}

#[allow(clippy::too_many_arguments)]
pub fn persist_conversation_run_with_skill_id(
    conn: &Connection,
    conversation_id: &str,
    skill_id: i64,
    skill_name: &str,
    plugin_slug: &str,
    step_id: i32,
    model: &str,
    status: &str,
    input_tokens: i32,
    output_tokens: i32,
    cache_read_tokens: i32,
    cache_write_tokens: i32,
    total_cost: f64,
    duration_ms: i64,
    num_turns: i32,
    stop_reason: Option<&str>,
    duration_api_ms: Option<i64>,
    tool_use_count: i32,
    compaction_count: i32,
    session_id: Option<&str>,
    workflow_session_id: Option<&str>,
) -> Result<(), String> {
    if status == "shutdown" {
        let existing_status: Option<String> = conn
            .query_row(
                "SELECT status FROM conversation_runs WHERE conversation_id = ?1 AND model = ?2",
                rusqlite::params![conversation_id, model],
                |row| row.get(0),
            )
            .ok();
        if matches!(
            existing_status.as_deref(),
            Some("completed") | Some("error")
        ) {
            return Ok(());
        }
    }

    if let Some(ws_id) = workflow_session_id {
        conn.execute(
            "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, skill_id, pid)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![ws_id, skill_name, skill_id, std::process::id() as i64],
        )
        .map_err(|e| e.to_string())?;

        if ws_id.starts_with("synthetic:") && matches!(status, "completed" | "error" | "shutdown") {
            conn.execute(
                "UPDATE workflow_sessions
                 SET ended_at = COALESCE(ended_at, datetime('now') || 'Z')
                 WHERE session_id = ?1",
                rusqlite::params![ws_id],
            )
            .map_err(|e| e.to_string())?;
        }
    }

    let workflow_run_id = get_workflow_run_id_by_skill_id(conn, skill_id)?;

    conn.execute(
        "INSERT INTO conversation_runs
         (conversation_id, skill_id, skill_name, plugin_slug, step_id, model, status,
          input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, total_cost,
          session_id, started_at, completed_at, duration_ms, workflow_session_id, num_turns,
          stop_reason, duration_api_ms, tool_use_count, compaction_count, workflow_run_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7,
                 ?8, ?9, ?10, ?11, ?12,
                 ?13, datetime('now') || 'Z', datetime('now') || 'Z', ?14, ?15, ?16,
                 ?17, ?18, ?19, ?20, ?21)
         ON CONFLICT(conversation_id, model) DO UPDATE SET
          skill_id = excluded.skill_id,
          skill_name = excluded.skill_name,
          plugin_slug = excluded.plugin_slug,
          step_id = excluded.step_id,
          status = excluded.status,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cache_read_tokens = excluded.cache_read_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          total_cost = excluded.total_cost,
          session_id = excluded.session_id,
          completed_at = excluded.completed_at,
          duration_ms = excluded.duration_ms,
          workflow_session_id = excluded.workflow_session_id,
          num_turns = excluded.num_turns,
          stop_reason = excluded.stop_reason,
          duration_api_ms = excluded.duration_api_ms,
          tool_use_count = excluded.tool_use_count,
          compaction_count = excluded.compaction_count,
          workflow_run_id = excluded.workflow_run_id",
        rusqlite::params![
            conversation_id,
            skill_id,
            skill_name,
            plugin_slug,
            step_id,
            model,
            status,
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_write_tokens,
            total_cost,
            session_id,
            duration_ms,
            workflow_session_id,
            num_turns,
            stop_reason,
            duration_api_ms,
            tool_use_count,
            compaction_count,
            workflow_run_id,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_usage_summary(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
) -> Result<UsageSummary, String> {
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND ws.started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        format!(" AND ws.skill_name = ?{p}")
    } else {
        String::new()
    };
    let having_clause = if hide_cancelled {
        " HAVING COALESCE(SUM(cr.total_cost), 0) > 0 OR COUNT(DISTINCT cr.conversation_id) = 0"
    } else {
        ""
    };
    let sql = format!(
        "SELECT COALESCE(SUM(sub.session_cost), 0.0),
                COUNT(*),
                COALESCE(AVG(sub.session_cost), 0.0)
         FROM (
           SELECT ws.session_id, COALESCE(SUM(cr.total_cost), 0.0) as session_cost
           FROM workflow_sessions ws
           LEFT JOIN conversation_runs cr ON cr.workflow_session_id = ws.session_id
           WHERE 1=1{date_clause}{skill_clause}
           GROUP BY ws.session_id{having_clause}
         ) sub"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    macro_rules! query {
        ($params:expr) => {
            stmt.query_row($params, |row| {
                Ok(UsageSummary {
                    total_cost: row.get(0)?,
                    total_runs: row.get(1)?,
                    avg_cost_per_run: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name) {
        (Some(sd), Some(sn)) => query!(rusqlite::params![sd, sn]),
        (Some(sd), None) => query!(rusqlite::params![sd]),
        (None, Some(sn)) => query!(rusqlite::params![sn]),
        (None, None) => query!([]),
    }
}

pub fn get_workflow_skill_names(conn: &Connection) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT DISTINCT skill_name FROM workflow_sessions
             ORDER BY skill_name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[cfg(test)]
pub fn get_recent_runs(
    conn: &Connection,
    limit: usize,
) -> Result<Vec<ConversationRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT conversation_id, skill_id, skill_name, plugin_slug, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM conversation_runs
             ORDER BY completed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit as i64], map_conversation_run_row)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_conversation_runs(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
    model_filter: Option<&str>,
    limit: usize,
) -> Result<Vec<ConversationRunRecord>, String> {
    let cost_clause = if hide_cancelled {
        " AND total_cost > 0"
    } else {
        ""
    };
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        let s = format!(" AND skill_name = ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let model_filter_clause = if model_filter.is_some() {
        let s = format!(" AND model = ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT conversation_id, skill_id, skill_name, plugin_slug, step_id, model, status,
                COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                session_id, started_at, completed_at
         FROM conversation_runs
         WHERE workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}{model_filter_clause}
         ORDER BY started_at DESC
         LIMIT ?{p}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let limit_i64 = limit as i64;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, map_conversation_run_row)
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name, model_filter) {
        (Some(sd), Some(sn), Some(mf)) => collect_rows!(rusqlite::params![sd, sn, mf, limit_i64]),
        (Some(sd), Some(sn), None) => collect_rows!(rusqlite::params![sd, sn, limit_i64]),
        (Some(sd), None, Some(mf)) => collect_rows!(rusqlite::params![sd, mf, limit_i64]),
        (Some(sd), None, None) => collect_rows!(rusqlite::params![sd, limit_i64]),
        (None, Some(sn), Some(mf)) => collect_rows!(rusqlite::params![sn, mf, limit_i64]),
        (None, Some(sn), None) => collect_rows!(rusqlite::params![sn, limit_i64]),
        (None, None, Some(mf)) => collect_rows!(rusqlite::params![mf, limit_i64]),
        (None, None, None) => collect_rows!(rusqlite::params![limit_i64]),
    }
}

pub fn get_recent_workflow_sessions(
    conn: &Connection,
    limit: usize,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
) -> Result<Vec<WorkflowSessionRecord>, String> {
    let having_clause = if hide_cancelled {
        " HAVING COALESCE(SUM(cr.total_cost), 0) > 0 OR COUNT(DISTINCT cr.conversation_id) = 0"
    } else {
        ""
    };
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND ws.started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        let s = format!(" AND ws.skill_name = ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let limit_param = format!("?{p}");
    let sql = format!(
        "SELECT ws.session_id,
                ws.skill_id,
                ws.skill_name,
                COALESCE(MIN(cr.step_id), 0),
                COALESCE(MAX(cr.step_id), 0),
                COALESCE(GROUP_CONCAT(DISTINCT cr.step_id), ''),
                COUNT(DISTINCT cr.conversation_id),
                COALESCE(SUM(cr.total_cost), 0.0),
                COALESCE(SUM(cr.input_tokens), 0),
                COALESCE(SUM(cr.output_tokens), 0),
                COALESCE(SUM(cr.cache_read_tokens), 0),
                COALESCE(SUM(cr.cache_write_tokens), 0),
                COALESCE(SUM(cr.duration_ms), 0),
                ws.started_at,
                ws.ended_at
         FROM workflow_sessions ws
         LEFT JOIN conversation_runs cr ON cr.workflow_session_id = ws.session_id
         WHERE 1=1{date_clause}{skill_clause}
         GROUP BY ws.session_id{having_clause}
         ORDER BY ws.started_at DESC
         LIMIT {limit_param}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, |row| {
                Ok(WorkflowSessionRecord {
                    session_id: row.get(0)?,
                    skill_id: row.get(1)?,
                    skill_name: row.get(2)?,
                    min_step: row.get(3)?,
                    max_step: row.get(4)?,
                    steps_csv: row.get(5)?,
                    conversation_count: row.get(6)?,
                    total_cost: row.get(7)?,
                    total_input_tokens: row.get(8)?,
                    total_output_tokens: row.get(9)?,
                    total_cache_read: row.get(10)?,
                    total_cache_write: row.get(11)?,
                    total_duration_ms: row.get(12)?,
                    started_at: row.get(13)?,
                    completed_at: row.get(14)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name) {
        (Some(sd), Some(sn)) => collect_rows!(rusqlite::params![sd, sn, limit as i64]),
        (Some(sd), None) => collect_rows!(rusqlite::params![sd, limit as i64]),
        (None, Some(sn)) => collect_rows!(rusqlite::params![sn, limit as i64]),
        (None, None) => collect_rows!(rusqlite::params![limit as i64]),
    }
}

#[cfg(test)]
pub fn get_session_conversation_runs(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<ConversationRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT conversation_id, skill_id, skill_name, plugin_slug, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM conversation_runs
             WHERE workflow_session_id = ?1
             ORDER BY started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![session_id], map_conversation_run_row)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_step_conversation_runs_by_skill_id(
    conn: &Connection,
    skill_id: i64,
    step_id: i32,
) -> Result<Vec<ConversationRunRecord>, String> {
    let wr_id = match get_workflow_run_id_by_skill_id(conn, skill_id)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let mut stmt = conn
        .prepare(
            "SELECT conversation_id, skill_id, skill_name, plugin_slug, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM conversation_runs
             WHERE workflow_run_id = ?1 AND step_id = ?2
               AND status IN ('completed', 'error')
             ORDER BY completed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![wr_id, step_id], map_conversation_run_row)
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[allow(dead_code)]
pub fn get_step_conversation_runs(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
) -> Result<Vec<ConversationRunRecord>, String> {
    let skill_id = match crate::db::get_skill_master_id_in_plugin(
        conn,
        skill_name,
        crate::skill_paths::DEFAULT_PLUGIN_SLUG,
    )? {
        Some(id) => id,
        None => return Ok(vec![]),
    };
    get_step_conversation_runs_by_skill_id(conn, skill_id, step_id)
}

pub fn get_usage_by_step(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
) -> Result<Vec<UsageByStep>, String> {
    let cost_clause = if hide_cancelled {
        " AND total_cost > 0"
    } else {
        ""
    };
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        format!(" AND skill_name = ?{p}")
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT step_id, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM conversation_runs
         WHERE workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}
         GROUP BY step_id
         ORDER BY SUM(total_cost) DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, |row| {
                let sid: i32 = row.get(0)?;
                Ok(UsageByStep {
                    step_id: sid,
                    step_name: step_name(sid),
                    total_cost: row.get(1)?,
                    run_count: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name) {
        (Some(sd), Some(sn)) => collect_rows!(rusqlite::params![sd, sn]),
        (Some(sd), None) => collect_rows!(rusqlite::params![sd]),
        (None, Some(sn)) => collect_rows!(rusqlite::params![sn]),
        (None, None) => collect_rows!([]),
    }
}

pub fn get_usage_by_model(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
) -> Result<Vec<UsageByModel>, String> {
    let cost_clause = if hide_cancelled {
        " AND total_cost > 0"
    } else {
        ""
    };
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        format!(" AND skill_name = ?{p}")
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT model, COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM conversation_runs
         WHERE workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}
         GROUP BY model
         ORDER BY SUM(total_cost) DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, |row| {
                Ok(UsageByModel {
                    model: row.get(0)?,
                    total_cost: row.get(1)?,
                    run_count: row.get(2)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name) {
        (Some(sd), Some(sn)) => collect_rows!(rusqlite::params![sd, sn]),
        (Some(sd), None) => collect_rows!(rusqlite::params![sd]),
        (None, Some(sn)) => collect_rows!(rusqlite::params![sn]),
        (None, None) => collect_rows!([]),
    }
}

pub fn get_usage_by_day(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
) -> Result<Vec<crate::types::UsageByDay>, String> {
    let mut p = 1usize;
    let date_clause = if start_date.is_some() {
        let s = format!(" AND ws.started_at >= ?{p}");
        p += 1;
        s
    } else {
        String::new()
    };
    let skill_clause = if skill_name.is_some() {
        format!(" AND ws.skill_name = ?{p}")
    } else {
        String::new()
    };
    let having_clause = if hide_cancelled {
        " HAVING COALESCE(SUM(cr.total_cost), 0) > 0"
    } else {
        ""
    };
    let sql = format!(
        "SELECT DATE(ws.started_at),
                COALESCE(SUM(cr.total_cost), 0.0),
                COALESCE(SUM(cr.input_tokens + cr.output_tokens), 0),
                COUNT(DISTINCT ws.session_id)
         FROM workflow_sessions ws
         LEFT JOIN conversation_runs cr ON cr.workflow_session_id = ws.session_id
         WHERE 1=1{date_clause}{skill_clause}
         GROUP BY DATE(ws.started_at){having_clause}
         ORDER BY DATE(ws.started_at) ASC"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, |row| {
                Ok(crate::types::UsageByDay {
                    date: row.get(0)?,
                    total_cost: row.get(1)?,
                    total_tokens: row.get(2)?,
                    run_count: row.get(3)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name) {
        (Some(sd), Some(sn)) => collect_rows!(rusqlite::params![sd, sn]),
        (Some(sd), None) => collect_rows!(rusqlite::params![sd]),
        (None, Some(sn)) => collect_rows!(rusqlite::params![sn]),
        (None, None) => collect_rows!([]),
    }
}

pub fn reset_usage(conn: &Connection) -> Result<(), String> {
    conn.execute("DELETE FROM conversation_runs", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM workflow_sessions", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn map_conversation_run_row(
    row: &rusqlite::Row<'_>,
) -> Result<ConversationRunRecord, rusqlite::Error> {
    Ok(ConversationRunRecord {
        conversation_id: row.get(0)?,
        skill_id: row.get(1)?,
        skill_name: row.get(2)?,
        plugin_slug: row.get(3)?,
        step_id: row.get(4)?,
        model: row.get(5)?,
        status: row.get(6)?,
        input_tokens: row.get(7)?,
        output_tokens: row.get(8)?,
        cache_read_tokens: row.get(9)?,
        cache_write_tokens: row.get(10)?,
        total_cost: row.get(11)?,
        duration_ms: row.get(12)?,
        num_turns: row.get(13)?,
        stop_reason: row.get(14)?,
        duration_api_ms: row.get(15)?,
        tool_use_count: row.get(16)?,
        compaction_count: row.get(17)?,
        session_id: row.get(18)?,
        started_at: row.get(19)?,
        completed_at: row.get(20)?,
    })
}
