pub mod types;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{
    delete_eval_prompt_set as db_delete_eval_prompt_set,
    list_eval_prompt_sets as db_list_eval_prompt_sets, list_eval_runs as db_list_eval_runs,
    read_description_candidate, read_eval_prompt_set as db_read_eval_prompt_set,
    read_eval_run as db_read_eval_run, save_eval_prompt_set as db_save_prompt_set,
    set_skill_behaviour, Db, EvalRun, EvalWorkbenchMode, SaveEvalPromptSet,
};
pub use types::{
    ApplyDescriptionCandidateResponse, RefineImprovementBrief, RunEvalWorkbenchRequest,
    SuggestDescriptionCandidatesRequest,
};

fn validate_plugin_slug(plugin_slug: &str) -> Result<(), String> {
    if plugin_slug.trim().is_empty() {
        return Err("Plugin slug cannot be empty".to_string());
    }
    if plugin_slug.starts_with('.') || plugin_slug.contains('/') || plugin_slug.contains('\\') {
        return Err("Plugin slug must not contain path separators or start with '.'".to_string());
    }
    if plugin_slug.contains("..") {
        return Err("Plugin slug must not contain '..'".to_string());
    }
    Ok(())
}

fn parse_optional_mode(mode: Option<String>) -> Result<Option<EvalWorkbenchMode>, String> {
    mode.as_deref().map(EvalWorkbenchMode::parse).transpose()
}

fn validate_prompt_set_input(input: &SaveEvalPromptSet) -> Result<(), String> {
    validate_plugin_slug(&input.plugin_slug)?;
    validate_skill_name(&input.skill_name)?;
    if input.name.trim().is_empty() {
        return Err("Prompt set name cannot be empty".to_string());
    }
    for case in &input.cases {
        if case.prompt.trim().is_empty() {
            return Err("Prompt case prompt cannot be empty".to_string());
        }
        if input.mode == EvalWorkbenchMode::Performance && case.should_trigger.is_some() {
            return Err("shouldTrigger is only valid for trigger prompt sets".to_string());
        }
        if input.mode == EvalWorkbenchMode::Trigger && case.should_trigger.is_none() {
            return Err("Trigger prompt cases must include shouldTrigger".to_string());
        }
        if !case.assertions.is_array() {
            return Err("Prompt case assertions must be an array".to_string());
        }
    }
    Ok(())
}

fn validate_id(label: &str, value: &str) -> Result<(), String> {
    if value.trim().is_empty() {
        return Err(format!("{label} cannot be empty"));
    }
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err(format!("{label} contains invalid path characters"));
    }
    Ok(())
}

#[tauri::command]
pub fn list_eval_prompt_sets(
    plugin_slug: String,
    skill_name: String,
    mode: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::EvalPromptSet>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let mode = parse_optional_mode(mode)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_list_eval_prompt_sets(&conn, &plugin_slug, &skill_name, mode)
}

#[tauri::command]
pub fn save_eval_prompt_set(
    prompt_set: SaveEvalPromptSet,
    db: tauri::State<'_, Db>,
) -> Result<crate::db::EvalPromptSet, String> {
    validate_prompt_set_input(&prompt_set)?;
    let mut conn = db.0.lock().map_err(|e| e.to_string())?;
    db_save_prompt_set(&mut conn, prompt_set)
}

#[tauri::command]
pub fn delete_eval_prompt_set(
    prompt_set_id: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    validate_id("Prompt set id", &prompt_set_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_delete_eval_prompt_set(&conn, &prompt_set_id)
}

#[tauri::command]
pub async fn run_eval_workbench(
    request: RunEvalWorkbenchRequest,
    db: tauri::State<'_, Db>,
) -> Result<EvalRun, String> {
    validate_id("Prompt set id", &request.prompt_set_id)?;
    if request.candidate_ids.iter().any(|id| id.trim().is_empty()) {
        return Err("Candidate ids cannot be empty".to_string());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if db_read_eval_prompt_set(&conn, &request.prompt_set_id)?.is_none() {
        return Err("Prompt set not found".to_string());
    }
    Err(
        "Eval Workbench execution is not yet implemented; Promptfoo sidecar integration is pending"
            .to_string(),
    )
}

#[tauri::command]
pub async fn cancel_eval_workbench_run(run_id: String) -> Result<(), String> {
    validate_id("Run id", &run_id)?;
    Err("Eval Workbench cancellation is not yet implemented; Promptfoo sidecar integration is pending".to_string())
}

#[tauri::command]
pub fn list_eval_runs(
    plugin_slug: String,
    skill_name: String,
    mode: Option<String>,
    limit: Option<i64>,
    db: tauri::State<'_, Db>,
) -> Result<Vec<EvalRun>, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    let mode = parse_optional_mode(mode)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_list_eval_runs(&conn, &plugin_slug, &skill_name, mode, limit.unwrap_or(50))
}

#[tauri::command]
pub fn read_eval_run(run_id: String, db: tauri::State<'_, Db>) -> Result<Option<EvalRun>, String> {
    validate_id("Run id", &run_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_read_eval_run(&conn, &run_id)
}

#[tauri::command]
pub async fn suggest_description_candidates(
    request: SuggestDescriptionCandidatesRequest,
    db: tauri::State<'_, Db>,
) -> Result<Vec<crate::db::DescriptionCandidate>, String> {
    validate_id("Prompt set id", &request.prompt_set_id)?;
    if request.baseline_description.trim().is_empty() {
        return Err("Baseline description cannot be empty".to_string());
    }
    if request.candidate_count.unwrap_or(3) == 0 {
        return Err("Candidate count must be greater than zero".to_string());
    }
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    if db_read_eval_prompt_set(&conn, &request.prompt_set_id)?.is_none() {
        return Err("Prompt set not found".to_string());
    }
    Err("Description candidate generation is not yet implemented; Promptfoo sidecar integration is pending".to_string())
}

#[tauri::command]
pub fn apply_description_candidate(
    plugin_slug: String,
    skill_name: String,
    candidate_id: String,
    db: tauri::State<'_, Db>,
) -> Result<ApplyDescriptionCandidateResponse, String> {
    validate_plugin_slug(&plugin_slug)?;
    validate_skill_name(&skill_name)?;
    validate_id("Candidate id", &candidate_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let candidate = read_description_candidate(&conn, &candidate_id)?
        .ok_or_else(|| "Description candidate not found".to_string())?;
    set_skill_behaviour(
        &conn,
        &skill_name,
        Some(&candidate.description),
        None,
        None,
        None,
        None,
        None,
    )?;
    log::info!(
        "[apply_description_candidate] skill={} plugin={} candidate={}",
        skill_name,
        plugin_slug,
        candidate_id
    );
    Ok(ApplyDescriptionCandidateResponse {
        description: candidate.description,
    })
}

#[tauri::command]
pub fn build_refine_improvement_brief(
    run_id: String,
    db: tauri::State<'_, Db>,
) -> Result<RefineImprovementBrief, String> {
    validate_id("Run id", &run_id)?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let run = db_read_eval_run(&conn, &run_id)?.ok_or_else(|| "Eval run not found".to_string())?;
    Ok(RefineImprovementBrief {
        run_id: run.id.clone(),
        brief: build_refine_improvement_brief_inner(&run),
    })
}

fn build_refine_improvement_brief_inner(run: &EvalRun) -> String {
    let failed = run.results.iter().filter(|result| !result.passed).count();
    let total = run.results.len();
    let mut lines = vec![
        format!("Eval Workbench run: {}", run.id),
        format!("Mode: {}", run.mode.as_str()),
        format!("Status: {}", run.status),
        format!("Results: {}/{} failed", failed, total),
    ];
    for result in run.results.iter().filter(|result| !result.passed).take(10) {
        lines.push(format!(
            "- case={} candidate={} score={} reason={}",
            result.case_id,
            result.candidate_id,
            result.score,
            result.reason.as_deref().unwrap_or("No reason recorded")
        ));
    }
    lines.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_prompt_set(mode: EvalWorkbenchMode) -> SaveEvalPromptSet {
        SaveEvalPromptSet {
            id: None,
            plugin_slug: "skills".to_string(),
            skill_name: "forecast".to_string(),
            mode,
            name: "Smoke".to_string(),
            cases: vec![crate::db::SaveEvalPromptCase {
                id: None,
                prompt: "Forecast revenue".to_string(),
                expected: None,
                should_trigger: if mode == EvalWorkbenchMode::Trigger {
                    Some(true)
                } else {
                    None
                },
                assertions: serde_json::json!([]),
                sort_order: None,
            }],
        }
    }

    #[test]
    fn rejects_should_trigger_on_performance_prompt_sets() {
        let mut input = valid_prompt_set(EvalWorkbenchMode::Performance);
        input.cases[0].should_trigger = Some(true);

        let err = validate_prompt_set_input(&input).unwrap_err();

        assert!(err.contains("shouldTrigger is only valid"));
    }

    #[test]
    fn rejects_trigger_cases_without_should_trigger() {
        let mut input = valid_prompt_set(EvalWorkbenchMode::Trigger);
        input.cases[0].should_trigger = None;

        let err = validate_prompt_set_input(&input).unwrap_err();

        assert!(err.contains("must include shouldTrigger"));
    }

    #[test]
    fn rejects_unsafe_plugin_slug() {
        let err = validate_plugin_slug("../skills").unwrap_err();

        assert!(err.contains("must not contain"));
    }

    #[test]
    fn builds_refine_brief_from_failed_results() {
        let run = EvalRun {
            id: "run-1".to_string(),
            prompt_set_id: "prompt-set-1".to_string(),
            mode: EvalWorkbenchMode::Performance,
            status: "completed".to_string(),
            summary: serde_json::json!({}),
            created_at: "2026-05-03T00:00:00Z".to_string(),
            completed_at: None,
            results: vec![crate::db::EvalRunResult {
                id: "result-1".to_string(),
                run_id: "run-1".to_string(),
                case_id: "case-1".to_string(),
                candidate_id: "candidate-a".to_string(),
                passed: false,
                score: 0.25,
                output: serde_json::json!({}),
                reason: Some("Missing required detail".to_string()),
            }],
            description_candidates: vec![],
        };

        let brief = build_refine_improvement_brief_inner(&run);

        assert!(brief.contains("Results: 1/1 failed"));
        assert!(brief.contains("Missing required detail"));
    }
}
