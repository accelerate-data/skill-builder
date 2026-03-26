use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::commands::imported_skills::validate_skill_name;

// --- Types ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TestCase {
    pub id: u32,
    pub eval_name: String,
    pub slug: String,
    pub prompt: String,
    pub files: Vec<String>,
    pub expectations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PendingEval {
    pub eval_name: String,
    pub slug: String,
    pub prompt: String,
    pub expectations: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillEvalContext {
    pub skill_content: String,
    pub existing_evals: Vec<TestCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalsFile {
    pub skill_name: String,
    pub evals: Vec<TestCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IterationMeta {
    pub iteration: u32,
    pub path: String,
}

// --- Benchmark types (Rust-computed, deterministic) ---

#[derive(Debug, Clone, Serialize)]
pub struct EvalBenchmark {
    pub skill_name: String,
    pub iteration: u32,
    pub run_count: u32,
    pub eval_ids: Vec<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub comparison_mode: Option<String>,
    pub runs: Vec<BenchmarkRun>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_runs: Option<Vec<BenchmarkRun>>,
    pub aggregate_summary: AggregateSummary,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_aggregate_summary: Option<AggregateSummary>,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkRun {
    pub run_index: u32,
    pub evals: Vec<BenchmarkEval>,
    pub run_summary: GradingSummary,
}

#[derive(Debug, Clone, Serialize)]
pub struct BenchmarkEval {
    pub eval_id: u32,
    pub eval_name: String,
    pub slug: String,
    pub grading_path: String,
    pub summary: GradingSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GradingSummary {
    pub passed: u32,
    pub failed: u32,
    pub total: u32,
    pub pass_rate: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct AggregateSummary {
    pub avg_pass_rate: f64,
    pub total_passed: u32,
    pub total_failed: u32,
    pub total_assertions: u32,
    pub has_failures: bool,
}

/// Shape of the `summary` field inside a grading.json file.
#[derive(Debug, Deserialize)]
struct GradingFile {
    #[serde(default)]
    summary: GradingSummary,
}

// --- Path helpers ---

fn evals_json_path(workspace_path: &str, skill_name: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(skill_name)
        .join("evals")
        .join("evals.json")
}

fn pending_eval_path(workspace_path: &str, skill_name: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(skill_name)
        .join("evals")
        .join("pending-eval.json")
}



fn evals_workspace_dir(workspace_path: &str, skill_name: &str) -> PathBuf {
    Path::new(workspace_path)
        .join(skill_name)
        .join("evals")
        .join("workspace")
}

// --- File I/O helpers ---

fn read_evals_file(workspace_path: &str, skill_name: &str) -> Result<EvalsFile, String> {
    let path = evals_json_path(workspace_path, skill_name);
    if !path.is_file() {
        return Ok(EvalsFile {
            skill_name: skill_name.to_string(),
            evals: vec![],
        });
    }
    let content = std::fs::read_to_string(&path).map_err(|e| {
        log::error!(
            "[evals] failed to read '{}': {}",
            path.display(),
            e
        );
        format!("Failed to read evals.json: {}", e)
    })?;
    serde_json::from_str(&content).map_err(|e| {
        log::error!(
            "[evals] failed to parse '{}': {}",
            path.display(),
            e
        );
        format!("Failed to parse evals.json: {}", e)
    })
}

fn write_evals_file(workspace_path: &str, skill_name: &str, data: &EvalsFile) -> Result<(), String> {
    let path = evals_json_path(workspace_path, skill_name);

    // Ensure parent directory exists
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            log::error!(
                "[evals] failed to create dir '{}': {}",
                parent.display(),
                e
            );
            format!("Failed to create evals directory: {}", e)
        })?;
    }

    let json = serde_json::to_string_pretty(data).map_err(|e| {
        log::error!("[evals] failed to serialize evals.json: {}", e);
        format!("Failed to serialize evals.json: {}", e)
    })?;

    // Atomic write: write to .tmp then rename
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &json).map_err(|e| {
        log::error!(
            "[evals] failed to write tmp file '{}': {}",
            tmp_path.display(),
            e
        );
        format!("Failed to write evals.json: {}", e)
    })?;
    std::fs::rename(&tmp_path, &path).map_err(|e| {
        log::error!(
            "[evals] failed to rename tmp to '{}': {}",
            path.display(),
            e
        );
        format!("Failed to finalize evals.json write: {}", e)
    })?;

    Ok(())
}

// --- Commands ---

/// List all test cases from `{workspace}/{skill}/evals/evals.json`.
/// Returns an empty list if the file does not exist.
#[tauri::command]
pub fn list_test_cases(
    skill_name: String,
    workspace_path: String,
) -> Result<Vec<TestCase>, String> {
    log::info!("[list_test_cases] skill={}", skill_name);
    validate_skill_name(&skill_name)?;
    let data = read_evals_file(&workspace_path, &skill_name)?;
    Ok(data.evals)
}

/// Create or update a test case in `{workspace}/{skill}/evals/evals.json`.
/// A `test_case.id` of `0` means create — a new id is assigned automatically.
/// Any other id updates the existing entry (or inserts if id not found).
#[tauri::command]
pub fn save_test_case(
    skill_name: String,
    workspace_path: String,
    test_case: TestCase,
) -> Result<TestCase, String> {
    log::info!(
        "[save_test_case] skill={} id={} name={}",
        skill_name,
        test_case.id,
        test_case.eval_name
    );
    validate_skill_name(&skill_name)?;

    let mut data = read_evals_file(&workspace_path, &skill_name)?;

    let mut tc = test_case;

    if tc.id == 0 {
        // Assign next id
        let next_id = data.evals.iter().map(|e| e.id).max().unwrap_or(0) + 1;
        tc.id = next_id;
        log::debug!("[save_test_case] assigned new id={}", tc.id);
        data.evals.push(tc.clone());
    } else {
        // Update existing or insert if not found
        if let Some(existing) = data.evals.iter_mut().find(|e| e.id == tc.id) {
            *existing = tc.clone();
        } else {
            log::debug!(
                "[save_test_case] id={} not found, inserting",
                tc.id
            );
            data.evals.push(tc.clone());
        }
    }

    // Ensure skill_name in file stays in sync
    if data.skill_name.is_empty() {
        data.skill_name = skill_name.clone();
    }

    write_evals_file(&workspace_path, &skill_name, &data)?;
    log::debug!("[save_test_case] saved id={} ok", tc.id);
    Ok(tc)
}

/// Delete a test case by id from `{workspace}/{skill}/evals/evals.json`.
#[tauri::command]
pub fn delete_test_case(
    skill_name: String,
    workspace_path: String,
    id: u32,
) -> Result<(), String> {
    log::info!("[delete_test_case] skill={} id={}", skill_name, id);
    validate_skill_name(&skill_name)?;

    let mut data = read_evals_file(&workspace_path, &skill_name)?;
    let before = data.evals.len();
    data.evals.retain(|e| e.id != id);
    let after = data.evals.len();

    if before == after {
        log::debug!("[delete_test_case] id={} not found, no-op", id);
        return Ok(());
    }

    write_evals_file(&workspace_path, &skill_name, &data)?;
    log::debug!("[delete_test_case] deleted id={} ok", id);
    Ok(())
}

/// List iteration directories under `{workspace}/{skill}/evals/workspace/`.
/// Returns metadata sorted by iteration number descending.
#[tauri::command]
pub fn list_iterations(
    skill_name: String,
    workspace_path: String,
) -> Result<Vec<IterationMeta>, String> {
    log::info!("[list_iterations] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    let dir = evals_workspace_dir(&workspace_path, &skill_name);
    if !dir.is_dir() {
        log::debug!(
            "[list_iterations] evals workspace dir does not exist: {}",
            dir.display()
        );
        return Ok(vec![]);
    }

    let entries = std::fs::read_dir(&dir).map_err(|e| {
        log::error!(
            "[list_iterations] failed to read dir '{}': {}",
            dir.display(),
            e
        );
        format!("Failed to read iterations directory: {}", e)
    })?;

    let mut iterations: Vec<IterationMeta> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            let n_str = name_str.strip_prefix("iteration-")?;
            let n: u32 = n_str.parse().ok()?;
            if !entry.path().is_dir() {
                return None;
            }
            Some(IterationMeta {
                iteration: n,
                path: entry.path().to_string_lossy().into_owned(),
            })
        })
        .collect();

    // Sort descending by iteration number
    iterations.sort_by(|a, b| b.iteration.cmp(&a.iteration));

    log::debug!("[list_iterations] found {} iterations", iterations.len());
    Ok(iterations)
}

/// Create the next iteration directory atomically.
/// Scans existing `iteration-*` dirs, computes max + 1, creates the directory,
/// and returns `(iteration_number, absolute_path)`.
/// This guarantees the agent cannot accidentally reuse an existing iteration.
#[tauri::command]
pub fn create_next_iteration_dir(
    skill_name: String,
    workspace_path: String,
) -> Result<(u32, String), String> {
    log::info!(
        "[create_next_iteration_dir] skill={} workspace={}",
        skill_name,
        workspace_path
    );
    validate_skill_name(&skill_name)?;

    let ws_dir = evals_workspace_dir(&workspace_path, &skill_name);

    // Scan existing iteration directories for the max number
    let max_iter = if ws_dir.is_dir() {
        std::fs::read_dir(&ws_dir)
            .map_err(|e| format!("Failed to read evals workspace: {}", e))?
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name();
                let n_str = name.to_string_lossy();
                let n = n_str.strip_prefix("iteration-")?.parse::<u32>().ok()?;
                if entry.path().is_dir() {
                    Some(n)
                } else {
                    None
                }
            })
            .max()
            .unwrap_or(0)
    } else {
        0
    };

    let next = max_iter + 1;
    let iter_dir = ws_dir.join(format!("iteration-{}", next));
    std::fs::create_dir_all(&iter_dir).map_err(|e| {
        log::error!(
            "[create_next_iteration_dir] failed to create '{}': {}",
            iter_dir.display(),
            e
        );
        format!("Failed to create iteration directory: {}", e)
    })?;

    let abs_path = iter_dir.to_string_lossy().into_owned();
    log::info!(
        "[create_next_iteration_dir] created iteration-{} at {}",
        next,
        abs_path
    );
    Ok((next, abs_path))
}

/// Deterministically compute `benchmark.json` from grading files written by the agent.
/// Reads all `grading.json` files in the iteration directory, aggregates pass/fail counts,
/// writes `benchmark.json`, and returns `(benchmark, analyst_notes)`.
/// This is pure math — no LLM involved.
#[tauri::command]
pub fn materialize_eval_benchmark(
    iter_dir: String,
    skill_name: String,
    iteration: u32,
    eval_ids: Vec<u32>,
    run_count: u32,
    comparison_mode: Option<String>,
) -> Result<(serde_json::Value, Vec<String>), String> {
    log::info!(
        "[materialize_eval_benchmark] iter_dir={} skill={} iteration={} evals={:?} runs={} mode={:?}",
        iter_dir, skill_name, iteration, eval_ids, run_count, comparison_mode
    );

    let iter_path = Path::new(&iter_dir);
    let is_comparison = comparison_mode.is_some();

    // Determine which variant subdirectories to read for primary vs baseline
    let (primary_variant, baseline_variant) = match comparison_mode.as_deref() {
        Some("with_without_skill") => (Some("with_skill"), Some("without_skill")),
        Some("current_vs_previous") => (Some("current"), Some("previous")),
        _ => (None, None), // single mode: grading.json is directly in eval_dir
    };

    let mut runs = Vec::new();
    let mut baseline_runs: Vec<BenchmarkRun> = Vec::new();

    for run_index in 0..run_count {
        let run_dir = iter_path.join(format!("run-{}", run_index));
        let mut primary_evals = Vec::new();
        let mut baseline_evals = Vec::new();

        for &eval_id in &eval_ids {
            // Find the eval directory by globbing eval-{id}-*
            let eval_dir = find_eval_dir(&run_dir, eval_id)?;
            let slug = extract_slug_from_dir(&eval_dir, eval_id);

            // Read primary grading
            let primary_grading_path = match primary_variant {
                Some(v) => eval_dir.join(v).join("grading.json"),
                None => eval_dir.join("grading.json"),
            };
            let primary_summary = read_grading_summary(&primary_grading_path)?;
            primary_evals.push(BenchmarkEval {
                eval_id,
                eval_name: read_eval_name_from_grading(&primary_grading_path)
                    .unwrap_or_else(|| format!("eval-{}", eval_id)),
                slug: slug.clone(),
                grading_path: primary_grading_path.to_string_lossy().into_owned(),
                summary: primary_summary,
            });

            // Read baseline grading (comparison modes only)
            if let Some(bv) = baseline_variant {
                let baseline_grading_path = eval_dir.join(bv).join("grading.json");
                let baseline_summary = read_grading_summary(&baseline_grading_path)?;
                baseline_evals.push(BenchmarkEval {
                    eval_id,
                    eval_name: read_eval_name_from_grading(&baseline_grading_path)
                        .unwrap_or_else(|| format!("eval-{}", eval_id)),
                    slug,
                    grading_path: baseline_grading_path.to_string_lossy().into_owned(),
                    summary: baseline_summary,
                });
            }
        }

        let run_summary = compute_run_summary(&primary_evals);
        runs.push(BenchmarkRun {
            run_index,
            evals: primary_evals,
            run_summary,
        });

        if is_comparison {
            let baseline_summary = compute_run_summary(&baseline_evals);
            baseline_runs.push(BenchmarkRun {
                run_index,
                evals: baseline_evals,
                run_summary: baseline_summary,
            });
        }
    }

    let aggregate_summary = compute_aggregate_summary(&runs);
    let baseline_aggregate_summary = if is_comparison {
        Some(compute_aggregate_summary(&baseline_runs))
    } else {
        None
    };

    let benchmark = EvalBenchmark {
        skill_name,
        iteration,
        run_count,
        eval_ids,
        comparison_mode,
        runs,
        baseline_runs: if is_comparison { Some(baseline_runs) } else { None },
        aggregate_summary,
        baseline_aggregate_summary,
    };

    // Serialize and write benchmark.json
    let benchmark_json = serde_json::to_value(&benchmark)
        .map_err(|e| format!("Failed to serialize benchmark: {}", e))?;
    let benchmark_path = iter_path.join("benchmark.json");
    let pretty = serde_json::to_string_pretty(&benchmark_json)
        .map_err(|e| format!("Failed to format benchmark: {}", e))?;
    std::fs::write(&benchmark_path, &pretty).map_err(|e| {
        log::error!(
            "[materialize_eval_benchmark] failed to write benchmark.json: {}",
            e
        );
        format!("Failed to write benchmark.json: {}", e)
    })?;
    log::info!(
        "[materialize_eval_benchmark] wrote benchmark.json to {}",
        benchmark_path.display()
    );

    // Read analyst-notes.json if the agent wrote it
    let notes_path = iter_path.join("analyst-notes.json");
    let notes: Vec<String> = if notes_path.exists() {
        let raw = std::fs::read_to_string(&notes_path).unwrap_or_default();
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };

    Ok((benchmark_json, notes))
}

// --- Benchmark computation helpers ---

/// Find the eval directory matching `eval-{id}-*` under the given run dir.
fn find_eval_dir(run_dir: &Path, eval_id: u32) -> Result<PathBuf, String> {
    let prefix = format!("eval-{}-", eval_id);
    if run_dir.is_dir() {
        if let Ok(entries) = std::fs::read_dir(run_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name_str = name.to_string_lossy();
                if name_str.starts_with(&prefix) && entry.path().is_dir() {
                    return Ok(entry.path());
                }
            }
        }
    }
    Err(format!(
        "Eval directory for eval-{} not found in {}",
        eval_id,
        run_dir.display()
    ))
}

/// Extract the slug from a directory name like `eval-3-dbt-snapshot-scd2-generation`.
fn extract_slug_from_dir(eval_dir: &Path, eval_id: u32) -> String {
    eval_dir
        .file_name()
        .and_then(|n| n.to_str())
        .and_then(|n| n.strip_prefix(&format!("eval-{}-", eval_id)))
        .unwrap_or("unknown")
        .to_string()
}

/// Read the `summary` field from a grading.json file.
fn read_grading_summary(path: &Path) -> Result<GradingSummary, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| {
        log::error!(
            "[materialize_eval_benchmark] failed to read grading: {} — {}",
            path.display(),
            e
        );
        format!("Failed to read {}: {}", path.display(), e)
    })?;
    let grading: GradingFile = serde_json::from_str(&raw).map_err(|e| {
        log::error!(
            "[materialize_eval_benchmark] failed to parse grading: {} — {}",
            path.display(),
            e
        );
        format!("Failed to parse {}: {}", path.display(), e)
    })?;
    Ok(grading.summary)
}

/// Try to read the eval_name from a grading.json file (optional field).
fn read_eval_name_from_grading(path: &Path) -> Option<String> {
    let raw = std::fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    v.get("eval_name").and_then(|n| n.as_str()).map(String::from)
}

/// Sum passed/failed/total across evals in a run.
fn compute_run_summary(evals: &[BenchmarkEval]) -> GradingSummary {
    let mut passed = 0u32;
    let mut failed = 0u32;
    let mut total = 0u32;
    for e in evals {
        passed += e.summary.passed;
        failed += e.summary.failed;
        total += e.summary.total;
    }
    let pass_rate = if total > 0 {
        passed as f64 / total as f64
    } else {
        0.0
    };
    GradingSummary {
        passed,
        failed,
        total,
        pass_rate,
    }
}

/// Compute aggregate summary across all runs.
fn compute_aggregate_summary(runs: &[BenchmarkRun]) -> AggregateSummary {
    if runs.is_empty() {
        return AggregateSummary {
            avg_pass_rate: 0.0,
            total_passed: 0,
            total_failed: 0,
            total_assertions: 0,
            has_failures: false,
        };
    }
    let mut total_passed = 0u32;
    let mut total_failed = 0u32;
    let mut total_assertions = 0u32;
    let mut pass_rate_sum = 0.0f64;

    for run in runs {
        total_passed += run.run_summary.passed;
        total_failed += run.run_summary.failed;
        total_assertions += run.run_summary.total;
        pass_rate_sum += run.run_summary.pass_rate;
    }

    AggregateSummary {
        avg_pass_rate: pass_rate_sum / runs.len() as f64,
        total_passed,
        total_failed,
        total_assertions,
        has_failures: total_failed > 0,
    }
}

/// Read the skill definition and existing evals to provide context to the eval generator agent.
/// Returns empty skill_content if SKILL.md does not exist yet.
#[tauri::command]
pub fn read_skill_context_for_eval_gen(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<SkillEvalContext, String> {
    log::info!("[read_skill_context_for_eval_gen] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    // Resolve skills_path from settings (may differ from workspace_path).
    let skills_path = super::refine::resolve_skills_path(&db, &workspace_path)?;
    let skill_md = std::path::Path::new(&skills_path)
        .join(&skill_name)
        .join("SKILL.md");
    let skill_content = if skill_md.is_file() {
        std::fs::read_to_string(&skill_md).map_err(|e| {
            log::error!(
                "[read_skill_context_for_eval_gen] failed to read '{}': {}",
                skill_md.display(),
                e
            );
            format!("Failed to read SKILL.md: {}", e)
        })?
    } else {
        log::debug!(
            "[read_skill_context_for_eval_gen] SKILL.md not found at '{}', using empty content",
            skill_md.display()
        );
        String::new()
    };

    let data = read_evals_file(&workspace_path, &skill_name)?;
    Ok(SkillEvalContext {
        skill_content,
        existing_evals: data.evals,
    })
}

/// Read a grading.json file from a completed eval run.
#[tauri::command]
pub fn read_grading(grading_path: String) -> Result<serde_json::Value, String> {
    log::info!("[read_grading] path={}", grading_path);
    let raw = std::fs::read_to_string(&grading_path).map_err(|e| {
        log::error!("[read_grading] failed: {}", e);
        format!("Failed to read grading: {}", e)
    })?;
    serde_json::from_str(&raw).map_err(|e| {
        log::error!("[read_grading] parse failed: {}", e);
        format!("Failed to parse grading: {}", e)
    })
}

/// Read benchmark.json and analyst-notes.json from a completed iteration directory.
#[tauri::command]
pub fn read_iteration_result(
    iteration_path: String,
) -> Result<(serde_json::Value, Vec<String>), String> {
    log::info!("[read_iteration_result] path={}", iteration_path);

    let benchmark_path = Path::new(&iteration_path).join("benchmark.json");
    let notes_path = Path::new(&iteration_path).join("analyst-notes.json");

    let benchmark_raw = std::fs::read_to_string(&benchmark_path).map_err(|e| {
        log::error!("[read_iteration_result] failed to read benchmark.json: {}", e);
        format!("Failed to read benchmark.json: {}", e)
    })?;
    let mut benchmark: serde_json::Value = serde_json::from_str(&benchmark_raw).map_err(|e| {
        log::error!("[read_iteration_result] failed to parse benchmark.json: {}", e);
        format!("Failed to parse benchmark.json: {}", e)
    })?;

    // Resolve relative grading_path values to absolute paths by prepending the
    // iteration directory. The evaluate-skill agent writes paths relative to its
    // iteration dir (e.g. "run-0/eval-3-.../with_skill/grading.json"), but the
    // frontend's readGrading() needs absolute paths. Eval history is immutable —
    // we resolve at read time rather than rewriting the stored benchmark.
    resolve_grading_paths(&mut benchmark, Path::new(&iteration_path));

    let notes: Vec<String> = if notes_path.exists() {
        let raw = std::fs::read_to_string(&notes_path).map_err(|e| {
            log::error!("[read_iteration_result] failed to read analyst-notes.json: {}", e);
            format!("Failed to read analyst-notes.json: {}", e)
        })?;
        serde_json::from_str(&raw).unwrap_or_default()
    } else {
        vec![]
    };

    Ok((benchmark, notes))
}

/// Walk a benchmark JSON value and resolve any relative `grading_path` strings
/// to absolute paths by joining them with the iteration directory.
/// Leaves already-absolute paths unchanged.
fn resolve_grading_paths(value: &mut serde_json::Value, iter_dir: &Path) {
    match value {
        serde_json::Value::Object(map) => {
            if let Some(serde_json::Value::String(gp)) = map.get("grading_path") {
                let p = Path::new(gp.as_str());
                if p.is_relative() {
                    let abs = iter_dir.join(p);
                    map.insert(
                        "grading_path".to_string(),
                        serde_json::Value::String(abs.to_string_lossy().into_owned()),
                    );
                }
            }
            for v in map.values_mut() {
                resolve_grading_paths(v, iter_dir);
            }
        }
        serde_json::Value::Array(arr) => {
            for v in arr.iter_mut() {
                resolve_grading_paths(v, iter_dir);
            }
        }
        _ => {}
    }
}

/// Read a pending generated eval from `{workspace}/{skill}/evals/pending-eval.json`.
/// Returns an error if the file does not exist (caller should only invoke after generation completes).
#[tauri::command]
pub fn read_pending_eval(
    skill_name: String,
    workspace_path: String,
) -> Result<PendingEval, String> {
    log::info!("[read_pending_eval] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    let path = pending_eval_path(&workspace_path, &skill_name);
    if !path.is_file() {
        return Err(format!(
            "pending-eval.json not found at '{}'",
            path.display()
        ));
    }
    let content = std::fs::read_to_string(&path).map_err(|e| {
        log::error!(
            "[read_pending_eval] failed to read '{}': {}",
            path.display(),
            e
        );
        format!("Failed to read pending-eval.json: {}", e)
    })?;
    serde_json::from_str(&content).map_err(|e| {
        log::error!(
            "[read_pending_eval] failed to parse '{}': {}",
            path.display(),
            e
        );
        format!("Failed to parse pending-eval.json: {}", e)
    })
}

/// Delete `{workspace}/{skill}/evals/pending-eval.json` if it exists.
/// No-op if the file is absent.
#[tauri::command]
pub fn discard_pending_eval(
    skill_name: String,
    workspace_path: String,
) -> Result<(), String> {
    log::info!("[discard_pending_eval] skill={}", skill_name);
    validate_skill_name(&skill_name)?;

    let path = pending_eval_path(&workspace_path, &skill_name);
    if path.is_file() {
        std::fs::remove_file(&path).map_err(|e| {
            log::error!(
                "[discard_pending_eval] failed to remove '{}': {}",
                path.display(),
                e
            );
            format!("Failed to discard pending-eval.json: {}", e)
        })?;
        log::debug!("[discard_pending_eval] removed pending-eval.json for skill={}", skill_name);
    }
    Ok(())
}

// --- Tests ---

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_test_case(id: u32, name: &str) -> TestCase {
        TestCase {
            id,
            eval_name: name.to_string(),
            slug: name.to_lowercase().replace(' ', "-"),
            prompt: format!("Prompt for {}", name),
            files: vec![],
            expectations: vec!["assertion one".to_string()],
        }
    }

    fn make_pending_eval(name: &str) -> PendingEval {
        PendingEval {
            eval_name: name.to_string(),
            slug: name.to_lowercase().replace(' ', "-"),
            prompt: format!("Prompt for {}", name),
            expectations: vec!["assertion one".to_string()],
        }
    }

    #[test]
    fn list_returns_empty_when_no_file() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let result = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn save_new_test_case_assigns_id() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let tc = make_test_case(0, "Test One");
        let saved = save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();
        assert_eq!(saved.id, 1);

        let cases = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].id, 1);
        assert_eq!(cases[0].eval_name, "Test One");
    }

    #[test]
    fn save_multiple_assigns_sequential_ids() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        for i in 0..3 {
            let tc = make_test_case(0, &format!("Test {}", i));
            let saved = save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();
            assert_eq!(saved.id, (i + 1) as u32);
        }
        let cases = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(cases.len(), 3);
    }

    #[test]
    fn update_existing_test_case() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let tc = make_test_case(0, "Original");
        let saved = save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();

        let mut updated = saved.clone();
        updated.eval_name = "Updated".to_string();
        save_test_case("my-skill".to_string(), workspace.to_string(), updated).unwrap();

        let cases = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(cases.len(), 1);
        assert_eq!(cases[0].eval_name, "Updated");
    }

    #[test]
    fn delete_test_case_removes_entry() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let tc = make_test_case(0, "To Delete");
        let saved = save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();

        delete_test_case("my-skill".to_string(), workspace.to_string(), saved.id).unwrap();

        let cases = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert!(cases.is_empty());
    }

    #[test]
    fn delete_nonexistent_id_is_noop() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let tc = make_test_case(0, "Keeper");
        save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();

        delete_test_case("my-skill".to_string(), workspace.to_string(), 999).unwrap();

        let cases = list_test_cases("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(cases.len(), 1);
    }

    #[test]
    fn list_iterations_returns_empty_when_no_dir() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let result = list_iterations("my-skill".to_string(), workspace.to_string()).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn list_iterations_returns_sorted_descending() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let evals_ws = tmp.path().join("my-skill").join("evals").join("workspace");
        for n in [1u32, 3, 2] {
            let dir = evals_ws.join(format!("iteration-{}", n));
            fs::create_dir_all(&dir).unwrap();
        }

        let result = list_iterations("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(result.len(), 3);
        assert_eq!(result[0].iteration, 3);
        assert_eq!(result[1].iteration, 2);
        assert_eq!(result[2].iteration, 1);
    }

    #[test]
    fn read_skill_context_returns_empty_content_when_no_skill_md() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let ctx = read_skill_context_for_eval_gen("my-skill".to_string(), workspace.to_string()).unwrap();
        assert!(ctx.skill_content.is_empty());
        assert!(ctx.existing_evals.is_empty());
    }

    #[test]
    fn read_skill_context_reads_skill_md_and_evals() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();

        // Write SKILL.md
        let skill_dir = tmp.path().join("my-skill");
        fs::create_dir_all(&skill_dir).unwrap();
        fs::write(skill_dir.join("SKILL.md"), "# My Skill\nDoes something.").unwrap();

        // Save an eval
        let tc = make_test_case(0, "Scenario One");
        save_test_case("my-skill".to_string(), workspace.to_string(), tc).unwrap();

        let ctx = read_skill_context_for_eval_gen("my-skill".to_string(), workspace.to_string()).unwrap();
        assert!(ctx.skill_content.contains("My Skill"));
        assert_eq!(ctx.existing_evals.len(), 1);
        assert_eq!(ctx.existing_evals[0].eval_name, "Scenario One");
    }

    #[test]
    fn read_pending_eval_returns_error_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        let result = read_pending_eval("my-skill".to_string(), workspace.to_string());
        assert!(result.is_err());
    }

    #[test]
    fn read_and_discard_pending_eval() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();

        // Write a pending-eval.json
        let evals_dir = tmp.path().join("my-skill").join("evals");
        fs::create_dir_all(&evals_dir).unwrap();
        let pending = make_pending_eval("Generated Eval");
        let json = serde_json::to_string(&pending).unwrap();
        fs::write(evals_dir.join("pending-eval.json"), json).unwrap();

        let result = read_pending_eval("my-skill".to_string(), workspace.to_string()).unwrap();
        assert_eq!(result.eval_name, "Generated Eval");

        discard_pending_eval("my-skill".to_string(), workspace.to_string()).unwrap();

        let after = read_pending_eval("my-skill".to_string(), workspace.to_string());
        assert!(after.is_err());
    }

    #[test]
    fn discard_pending_eval_is_noop_when_absent() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().to_str().unwrap();
        // Should not error
        discard_pending_eval("my-skill".to_string(), workspace.to_string()).unwrap();
    }
}
