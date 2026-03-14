use crate::types::{AgentRunRecord, UsageByModel, UsageByStep, UsageSummary, WorkflowSessionRecord};
use rusqlite::Connection;

use super::skills::{get_skill_master_id, get_workflow_run_id};

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

/// Normalize model aliases to canonical full IDs so all storage is consistent.
/// Short names ("sonnet", "Haiku") and bare partial IDs ("claude-haiku-4-5") are
/// mapped to the current canonical ID for each model family.  Full IDs that are
/// already canonical pass through unchanged.
fn normalize_model_name(model: &str) -> String {
    let lower = model.to_lowercase();
    if lower == "haiku" || lower == "claude-haiku-4-5" {
        return "claude-haiku-4-5-20251001".to_string();
    }
    if lower == "sonnet" || lower == "claude-sonnet-4-6" {
        return "claude-sonnet-4-6".to_string();
    }
    if lower == "opus" || lower == "claude-opus-4-6" {
        return "claude-opus-4-6".to_string();
    }
    model.to_string()
}

#[allow(clippy::too_many_arguments)]
pub fn persist_agent_run(
    conn: &Connection,
    agent_id: &str,
    skill_name: &str,
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
    let model_owned = normalize_model_name(model);
    let model = model_owned.as_str();

    // Don't overwrite a completed/error run with shutdown status — the completed
    // data is more valuable than the partial shutdown snapshot.
    if status == "shutdown" {
        let existing_status: Option<String> = conn
            .query_row(
                "SELECT status FROM agent_runs WHERE agent_id = ?1 AND model = ?2",
                rusqlite::params![agent_id, model],
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

    // Ensure session-backed usage views include this run. For workflow runs this is
    // idempotent with create_workflow_session; for refine/test synthetic IDs this
    // creates the required session row on first persist.
    if let Some(ws_id) = workflow_session_id {
        let skill_master_id = get_skill_master_id(conn, skill_name)?;
        conn.execute(
            "INSERT OR IGNORE INTO workflow_sessions (session_id, skill_name, skill_id, pid)
             VALUES (?1, ?2, ?3, ?4)",
            rusqlite::params![
                ws_id,
                skill_name,
                skill_master_id,
                std::process::id() as i64
            ],
        )
        .map_err(|e| e.to_string())?;

        // Synthetic sessions are one run per session; mark them ended on terminal status
        // so recent sessions show completion timing.
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

    conn.execute(
        "INSERT INTO agent_runs
         (agent_id, skill_name, step_id, model, status, input_tokens, output_tokens,
          cache_read_tokens, cache_write_tokens, total_cost, duration_ms,
          num_turns, stop_reason, duration_api_ms, tool_use_count, compaction_count,
          session_id, workflow_session_id, started_at, completed_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
                 ?12, ?13, ?14, ?15, ?16,
                 ?17, ?18,
                 datetime('now') || 'Z',
                 datetime('now') || 'Z')
         ON CONFLICT(agent_id, model) DO UPDATE SET
          skill_name = excluded.skill_name,
          step_id = excluded.step_id,
          status = excluded.status,
          input_tokens = excluded.input_tokens,
          output_tokens = excluded.output_tokens,
          cache_read_tokens = excluded.cache_read_tokens,
          cache_write_tokens = excluded.cache_write_tokens,
          total_cost = excluded.total_cost,
          duration_ms = excluded.duration_ms,
          num_turns = excluded.num_turns,
          stop_reason = excluded.stop_reason,
          duration_api_ms = excluded.duration_api_ms,
          tool_use_count = excluded.tool_use_count,
          compaction_count = excluded.compaction_count,
          session_id = excluded.session_id,
          workflow_session_id = excluded.workflow_session_id,
          completed_at = excluded.completed_at",
        rusqlite::params![
            agent_id,
            skill_name,
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
        " HAVING COALESCE(SUM(ar.total_cost), 0) > 0 OR COUNT(DISTINCT ar.agent_id) = 0"
    } else {
        ""
    };
    let sql = format!(
        "SELECT COALESCE(SUM(sub.session_cost), 0.0),
                COUNT(*),
                COALESCE(AVG(sub.session_cost), 0.0)
         FROM (
           SELECT ws.session_id, COALESCE(SUM(ar.total_cost), 0.0) as session_cost
           FROM workflow_sessions ws
           LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                  AND ar.reset_marker IS NULL
           WHERE ws.reset_marker IS NULL{date_clause}{skill_clause}
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
         WHERE reset_marker IS NULL
         ORDER BY skill_name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_recent_runs(conn: &Connection, limit: usize) -> Result<Vec<AgentRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE reset_marker IS NULL
             ORDER BY completed_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![limit as i64], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_agent_runs(
    conn: &Connection,
    hide_cancelled: bool,
    start_date: Option<&str>,
    skill_name: Option<&str>,
    model_family: Option<&str>,
    limit: usize,
) -> Result<Vec<AgentRunRecord>, String> {
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
    let model_family_clause = if model_family.is_some() {
        let s = format!(
            " AND CASE \
              WHEN lower(model) LIKE '%haiku%'  THEN 'Haiku' \
              WHEN lower(model) LIKE '%opus%'   THEN 'Opus' \
              WHEN lower(model) LIKE '%sonnet%' THEN 'Sonnet' \
              ELSE model END = ?{p}"
        );
        p += 1;
        s
    } else {
        String::new()
    };
    let sql = format!(
        "SELECT agent_id, skill_name, step_id, model, status,
                COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                session_id, started_at, completed_at
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}{model_family_clause}
         ORDER BY started_at DESC
         LIMIT ?{p}"
    );
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let limit_i64 = limit as i64;
    macro_rules! collect_rows {
        ($params:expr) => {
            stmt.query_map($params, |row| {
                Ok(AgentRunRecord {
                    agent_id: row.get(0)?,
                    skill_name: row.get(1)?,
                    step_id: row.get(2)?,
                    model: row.get(3)?,
                    status: row.get(4)?,
                    input_tokens: row.get(5)?,
                    output_tokens: row.get(6)?,
                    cache_read_tokens: row.get(7)?,
                    cache_write_tokens: row.get(8)?,
                    total_cost: row.get(9)?,
                    duration_ms: row.get(10)?,
                    num_turns: row.get(11)?,
                    stop_reason: row.get(12)?,
                    duration_api_ms: row.get(13)?,
                    tool_use_count: row.get(14)?,
                    compaction_count: row.get(15)?,
                    session_id: row.get(16)?,
                    started_at: row.get(17)?,
                    completed_at: row.get(18)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
        };
    }
    match (start_date, skill_name, model_family) {
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
        " HAVING COALESCE(SUM(ar.total_cost), 0) > 0 OR COUNT(DISTINCT ar.agent_id) = 0"
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
                ws.skill_name,
                COALESCE(MIN(ar.step_id), 0),
                COALESCE(MAX(ar.step_id), 0),
                COALESCE(GROUP_CONCAT(DISTINCT ar.step_id), ''),
                COUNT(DISTINCT ar.agent_id),
                COALESCE(SUM(ar.total_cost), 0.0),
                COALESCE(SUM(ar.input_tokens), 0),
                COALESCE(SUM(ar.output_tokens), 0),
                COALESCE(SUM(ar.cache_read_tokens), 0),
                COALESCE(SUM(ar.cache_write_tokens), 0),
                COALESCE(SUM(ar.duration_ms), 0),
                ws.started_at,
                ws.ended_at
         FROM workflow_sessions ws
         LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                AND ar.reset_marker IS NULL
         WHERE ws.reset_marker IS NULL{date_clause}{skill_clause}
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
                    skill_name: row.get(1)?,
                    min_step: row.get(2)?,
                    max_step: row.get(3)?,
                    steps_csv: row.get(4)?,
                    agent_count: row.get(5)?,
                    total_cost: row.get(6)?,
                    total_input_tokens: row.get(7)?,
                    total_output_tokens: row.get(8)?,
                    total_cache_read: row.get(9)?,
                    total_cache_write: row.get(10)?,
                    total_duration_ms: row.get(11)?,
                    started_at: row.get(12)?,
                    completed_at: row.get(13)?,
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

pub fn get_session_agent_runs(
    conn: &Connection,
    session_id: &str,
) -> Result<Vec<AgentRunRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE workflow_session_id = ?1
             ORDER BY started_at ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![session_id], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_step_agent_runs(
    conn: &Connection,
    skill_name: &str,
    step_id: i32,
) -> Result<Vec<AgentRunRecord>, String> {
    let wr_id = match get_workflow_run_id(conn, skill_name)? {
        Some(id) => id,
        None => return Ok(vec![]),
    };

    let mut stmt = conn
        .prepare(
            "SELECT agent_id, skill_name, step_id, model, status,
                    COALESCE(input_tokens, 0), COALESCE(output_tokens, 0),
                    COALESCE(cache_read_tokens, 0), COALESCE(cache_write_tokens, 0),
                    COALESCE(total_cost, 0.0), COALESCE(duration_ms, 0),
                    COALESCE(num_turns, 0), stop_reason, duration_api_ms,
                    COALESCE(tool_use_count, 0), COALESCE(compaction_count, 0),
                    session_id, started_at, completed_at
             FROM agent_runs
             WHERE workflow_run_id = ?1 AND step_id = ?2
               AND status IN ('completed', 'error')
               AND reset_marker IS NULL
             ORDER BY completed_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(rusqlite::params![wr_id, step_id], |row| {
            Ok(AgentRunRecord {
                agent_id: row.get(0)?,
                skill_name: row.get(1)?,
                step_id: row.get(2)?,
                model: row.get(3)?,
                status: row.get(4)?,
                input_tokens: row.get(5)?,
                output_tokens: row.get(6)?,
                cache_read_tokens: row.get(7)?,
                cache_write_tokens: row.get(8)?,
                total_cost: row.get(9)?,
                duration_ms: row.get(10)?,
                num_turns: row.get(11)?,
                stop_reason: row.get(12)?,
                duration_api_ms: row.get(13)?,
                tool_use_count: row.get(14)?,
                compaction_count: row.get(15)?,
                session_id: row.get(16)?,
                started_at: row.get(17)?,
                completed_at: row.get(18)?,
            })
        })
        .map_err(|e| e.to_string())?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
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
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}
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
        "SELECT
           CASE
             WHEN lower(model) LIKE '%haiku%' THEN 'Haiku'
             WHEN lower(model) LIKE '%opus%'  THEN 'Opus'
             WHEN lower(model) LIKE '%sonnet%' THEN 'Sonnet'
             ELSE model
           END AS model_family,
           COALESCE(SUM(total_cost), 0.0), COUNT(*)
         FROM agent_runs
         WHERE reset_marker IS NULL
           AND workflow_session_id IS NOT NULL{cost_clause}{date_clause}{skill_clause}
         GROUP BY model_family
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
        " HAVING COALESCE(SUM(ar.total_cost), 0) > 0"
    } else {
        ""
    };
    let sql = format!(
        "SELECT DATE(ws.started_at),
                COALESCE(SUM(ar.total_cost), 0.0),
                COALESCE(SUM(ar.input_tokens + ar.output_tokens), 0),
                COUNT(DISTINCT ws.session_id)
         FROM workflow_sessions ws
         LEFT JOIN agent_runs ar ON ar.workflow_session_id = ws.session_id
                                AND ar.reset_marker IS NULL
         WHERE ws.reset_marker IS NULL{date_clause}{skill_clause}
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
    conn.execute(
        "UPDATE agent_runs SET reset_marker = datetime('now') || 'Z' WHERE reset_marker IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE workflow_sessions SET reset_marker = datetime('now') || 'Z' WHERE reset_marker IS NULL",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
