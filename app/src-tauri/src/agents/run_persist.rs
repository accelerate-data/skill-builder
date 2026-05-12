use super::event_types::RuntimeRunSummary;

fn persist_run_summary_to_conn(
    conn: &rusqlite::Connection,
    agent_id: &str,
    summary: &RuntimeRunSummary,
) {
    let effective_session_id = summary.usage_session_id.as_deref();

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
                &summary.plugin_slug,
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
            &summary.plugin_slug,
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
    summary: &RuntimeRunSummary,
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
}

#[cfg(test)]
mod tests {
    use super::super::event_types::RuntimeModelUsageEntry;
    use super::*;

    #[test]
    fn persist_run_summary_writes_aggregate_row_for_workflow_session() {
        let conn = crate::db::create_test_db_for_tests();
        crate::db::save_workflow_run(&conn, "demo-skill", 2, "in_progress", "domain").unwrap();
        let demo_skill_id = crate::db::get_skill_master_id(&conn, "demo-skill").unwrap().unwrap();
        crate::db::create_workflow_session_by_skill_id(&conn, "wf-aggregate", demo_skill_id, 1000).unwrap();

        let summary = RuntimeRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: 2,
            usage_session_id: Some("wf-aggregate".to_string()),
            run_source: Some("workflow".to_string()),
            session_id: Some("sdk-session".to_string()),
            model: "settings-model-a".to_string(),
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
            plugin_slug: "skills".to_string(),
        };

        persist_run_summary_to_conn(&conn, "agent-aggregate", &summary);

        let runs = crate::db::get_session_agent_runs(&conn, "wf-aggregate").unwrap();
        assert_eq!(runs.len(), 1);
        let run = &runs[0];
        assert_eq!(run.agent_id, "agent-aggregate");
        assert_eq!(run.skill_name, "demo-skill");
        assert_eq!(run.step_id, 2);
        assert_eq!(run.model, "settings-model-a");
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

        let summary = RuntimeRunSummary {
            skill_name: "demo-skill".to_string(),
            step_id: -10,
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
                RuntimeModelUsageEntry {
                    model: "settings-model-a".to_string(),
                    input_tokens: 100,
                    output_tokens: 20,
                    cache_read_tokens: 5,
                    cache_write_tokens: 1,
                    cost: 0.10,
                },
                RuntimeModelUsageEntry {
                    model: "settings-model-b".to_string(),
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
            plugin_slug: "skills".to_string(),
        };

        persist_run_summary_to_conn(&conn, "agent-breakdown", &summary);

        let runs =
            crate::db::get_session_agent_runs(&conn, "synthetic:refine:demo-skill:sess-1").unwrap();
        assert_eq!(runs.len(), 2);
        let models: Vec<_> = runs.iter().map(|run| run.model.as_str()).collect();
        assert!(models.contains(&"settings-model-a"));
        assert!(models.contains(&"settings-model-b"));
        assert!(runs.iter().all(|run| run.skill_name == "demo-skill"));
        assert!(runs.iter().all(|run| run.step_id == -10));
    }
}
