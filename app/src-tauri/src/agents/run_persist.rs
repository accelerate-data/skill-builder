use std::path::Path;
use tauri::Emitter;

use super::event_types::SidecarRunSummary;
use crate::commands::description::{write_eval_queries_to_file, EvalQuery};

/// step_id assigned to generate-skill-description-evals agent runs.
const STEP_ID_GENERATE_DESCRIPTION_EVALS: i32 = -12;

fn persist_run_summary_to_conn(
    conn: &rusqlite::Connection,
    agent_id: &str,
    summary: &SidecarRunSummary,
) {
    // Determine the effective workflow_session_id (prefer workflowSessionId, fallback to usageSessionId)
    let effective_session_id = summary
        .workflow_session_id
        .as_deref()
        .or(summary.usage_session_id.as_deref());

    // Persist one row per model entry or one aggregate row
    if !summary.model_usage_breakdown.is_empty() {
        for entry in &summary.model_usage_breakdown {
            log::info!(
                "[persist_run_summary] agent={} skill={} step={} step_id={} model={} status={} cost={:.4}",
                agent_id,
                summary.skill_name,
                crate::db::step_name(summary.step_id),
                summary.step_id,
                entry.model,
                summary.status,
                entry.cost
            );
            if let Err(e) = crate::db::persist_agent_run(
                conn,
                agent_id,
                &summary.skill_name,
                summary.step_id,
                &entry.model,
                &summary.status,
                entry.input_tokens,
                entry.output_tokens,
                entry.cache_read_tokens,
                entry.cache_write_tokens,
                entry.cost,
                summary.duration_ms,
                summary.num_turns,
                summary.stop_reason.as_deref(),
                summary.duration_api_ms,
                summary.tool_use_count,
                summary.compaction_count,
                summary.session_id.as_deref(),
                effective_session_id,
            ) {
                log::error!(
                    "[persist_run_summary] Failed to persist for agent={} model={}: {}",
                    agent_id,
                    entry.model,
                    e
                );
            }
        }
    } else {
        // Single aggregate row
        log::info!(
            "[persist_run_summary] agent={} skill={} step={} step_id={} model={} status={} cost={:.4}",
            agent_id,
            summary.skill_name,
            crate::db::step_name(summary.step_id),
            summary.step_id,
            summary.model,
            summary.status,
            summary.total_cost_usd
        );
        if let Err(e) = crate::db::persist_agent_run(
            conn,
            agent_id,
            &summary.skill_name,
            summary.step_id,
            &summary.model,
            &summary.status,
            summary.input_tokens,
            summary.output_tokens,
            summary.cache_read_tokens,
            summary.cache_write_tokens,
            summary.total_cost_usd,
            summary.duration_ms,
            summary.num_turns,
            summary.stop_reason.as_deref(),
            summary.duration_api_ms,
            summary.tool_use_count,
            summary.compaction_count,
            summary.session_id.as_deref(),
            effective_session_id,
        ) {
            log::error!(
                "[persist_run_summary] Failed to persist aggregate for agent={}: {}",
                agent_id,
                e
            );
        }
    }
}

/// Persist a run summary directly to SQLite (fire-and-forget from the caller's perspective).
pub fn persist_run_summary(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    summary: &SidecarRunSummary,
) {
    use tauri::Manager;

    let db = match app_handle.try_state::<crate::db::Db>() {
        Some(db) => db,
        None => {
            log::error!(
                "[persist_run_summary] DB state not available for agent={}",
                agent_id
            );
            return;
        }
    };

    let conn = match db.0.lock() {
        Ok(c) => c,
        Err(e) => {
            log::error!(
                "[persist_run_summary] Failed to acquire DB lock for agent={}: {}",
                agent_id,
                e
            );
            return;
        }
    };

    persist_run_summary_to_conn(&conn, agent_id, summary);
    drop(conn);

    if summary.step_id == STEP_ID_GENERATE_DESCRIPTION_EVALS && summary.status == "completed" {
        persist_description_evals(app_handle, agent_id, summary);
    }
}

/// Parse eval queries from `run_result.resultText`, write to the description_optimization
/// subfolder, and emit `description:eval-queries-generated` to the frontend.
fn persist_description_evals(
    app_handle: &tauri::AppHandle,
    agent_id: &str,
    summary: &SidecarRunSummary,
) {
    let (result_text, workspace_path) = match (&summary.result_text, &summary.workspace_path) {
        (Some(rt), Some(wp)) => (rt, wp),
        _ => {
            log::error!(
                "[persist_description_evals] agent={} skill={} missing resultText or workspacePath",
                agent_id,
                summary.skill_name,
            );
            return;
        }
    };

    let parsed: serde_json::Value = match serde_json::from_str(result_text) {
        Ok(v) => v,
        Err(e) => {
            log::error!(
                "[persist_description_evals] agent={} skill={} failed to parse resultText: {}",
                agent_id,
                summary.skill_name,
                e,
            );
            return;
        }
    };

    let queries_val = match parsed.get("queries") {
        Some(v) => v.clone(),
        None => {
            log::error!(
                "[persist_description_evals] agent={} skill={} resultText missing 'queries' field",
                agent_id,
                summary.skill_name,
            );
            return;
        }
    };

    let queries: Vec<EvalQuery> = match serde_json::from_value(queries_val) {
        Ok(q) => q,
        Err(e) => {
            log::error!(
                "[persist_description_evals] agent={} skill={} failed to deserialize queries: {}",
                agent_id,
                summary.skill_name,
                e,
            );
            return;
        }
    };

    let plugin_slug = summary.plugin_slug.as_deref()
        .unwrap_or(crate::skill_paths::DEFAULT_PLUGIN_SLUG);
    // description-evals.json lives in the workspace skill dir under description-optimization/,
    // not in the skills source directory.
    let eval_path = crate::skill_paths::workspace_skill_dir(
        Path::new(workspace_path),
        plugin_slug,
        &summary.skill_name,
    ).join("description-optimization").join("description-evals.json");
    if let Err(e) = write_eval_queries_to_file(&eval_path, &queries) {
        log::error!(
            "[persist_description_evals] agent={} skill={} failed to write file: {}",
            agent_id,
            summary.skill_name,
            e,
        );
        return;
    }

    log::info!(
        "[persist_description_evals] agent={} skill={} wrote {} queries to {}",
        agent_id,
        summary.skill_name,
        queries.len(),
        eval_path.display(),
    );

    if let Err(e) = app_handle.emit(
        "description:eval-queries-generated",
        serde_json::json!({
            "skillName": summary.skill_name,
            "queries": queries,
        }),
    ) {
        log::error!(
            "[persist_description_evals] agent={} skill={} failed to emit event: {}",
            agent_id,
            summary.skill_name,
            e,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::event_types::SidecarModelUsageEntry;

    #[test]
    fn persist_run_summary_writes_aggregate_row_for_workflow_session() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::save_workflow_run(&conn, "demo-skill", 2, "in_progress", "domain").unwrap();
        crate::db::create_workflow_session(&conn, "wf-aggregate", "demo-skill", 1000).unwrap();

        let summary = SidecarRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: 2,
            workflow_session_id: Some("wf-aggregate".to_string()),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            session_id: Some("sdk-session".to_string()),
            model: "sonnet".to_string(),
            input_tokens: 120,
            output_tokens: 45,
            cache_read_tokens: 6,
            cache_write_tokens: 2,
            total_cost_usd: 0.12,
            model_usage_breakdown: vec![],
            context_window: 200_000,
            result_subtype: None,
            result_errors: None,
            stop_reason: Some("end_turn".to_string()),
            num_turns: 3,
            duration_ms: 4_000,
            duration_api_ms: Some(3_500),
            tool_use_count: 2,
            compaction_count: 1,
            status: "completed".to_string(),
            result_text: None,
            workspace_path: None,
            plugin_slug: None,
        };

        persist_run_summary_to_conn(&conn, "agent-aggregate", &summary);

        let runs = crate::db::get_session_agent_runs(&conn, "wf-aggregate").unwrap();
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.agent_id, "agent-aggregate");
        assert_eq!(run.skill_name, "demo-skill");
        assert_eq!(run.step_id, 2);
        assert_eq!(run.model, "claude-sonnet-4-6");
        assert_eq!(run.input_tokens, 120);
        assert_eq!(run.output_tokens, 45);
        assert_eq!(run.cache_read_tokens, 6);
        assert_eq!(run.cache_write_tokens, 2);
        assert!((run.total_cost - 0.12).abs() < 1e-10);
        assert_eq!(run.session_id.as_deref(), Some("sdk-session"));
    }

    #[test]
    fn persist_run_summary_writes_breakdown_rows_and_falls_back_to_usage_session() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::save_workflow_run(&conn, "demo-skill", -10, "in_progress", "domain").unwrap();

        let summary = SidecarRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: -10,
            workflow_session_id: None,
            usage_session_id: Some("synthetic:refine:demo-skill:sess-1".to_string()),
            run_source: Some("refine".to_string()),
            session_id: Some("sdk-session".to_string()),
            model: "unknown".to_string(),
            input_tokens: 0,
            output_tokens: 0,
            cache_read_tokens: 0,
            cache_write_tokens: 0,
            total_cost_usd: 0.0,
            model_usage_breakdown: vec![
                SidecarModelUsageEntry {
                    model: "sonnet".to_string(),
                    input_tokens: 100,
                    output_tokens: 20,
                    cache_read_tokens: 5,
                    cache_write_tokens: 1,
                    cost: 0.10,
                },
                SidecarModelUsageEntry {
                    model: "opus".to_string(),
                    input_tokens: 50,
                    output_tokens: 10,
                    cache_read_tokens: 0,
                    cache_write_tokens: 0,
                    cost: 0.25,
                },
            ],
            context_window: 200_000,
            result_subtype: Some("completed".to_string()),
            result_errors: None,
            stop_reason: Some("end_turn".to_string()),
            num_turns: 2,
            duration_ms: 2_000,
            duration_api_ms: Some(1_500),
            tool_use_count: 1,
            compaction_count: 0,
            status: "completed".to_string(),
            result_text: None,
            workspace_path: None,
            plugin_slug: None,
        };

        persist_run_summary_to_conn(&conn, "agent-breakdown", &summary);

        let runs =
            crate::db::get_session_agent_runs(&conn, "synthetic:refine:demo-skill:sess-1").unwrap();
        assert_eq!(runs.len(), 2);
        let models: Vec<_> = runs.iter().map(|run| run.model.as_str()).collect();
        assert!(models.contains(&"claude-sonnet-4-6"));
        assert!(models.contains(&"claude-opus-4-6"));
        assert!(runs.iter().all(|run| run.skill_name == "demo-skill"));
        assert!(runs.iter().all(|run| run.step_id == -10));
    }
}
