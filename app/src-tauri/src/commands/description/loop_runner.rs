use super::eval::{self, EvalResults};
use super::improve::{self, HistoryEntry};
use super::EvalQuery;
use crate::agents::sidecar_pool::SidecarPool;
use crate::types::SecretString;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use std::collections::HashSet;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;

// ─── File-based logging helper ─────────────────────────────────────────────

/// Append a timestamped line to a log file. Failures are silently ignored
/// (file logging must never break the optimization loop).
fn write_log_line(log_file: &Path, msg: &str) {
    let timestamp = chrono::Local::now().format("%Y-%m-%dT%H:%M:%S%.3f");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
    {
        let _ = writeln!(f, "[{}] {}", timestamp, msg);
    }
}

/// Create the log directory and return a timestamped log file path.
fn init_log_file(log_dir: &Path, prefix: &str) -> std::path::PathBuf {
    let _ = std::fs::create_dir_all(log_dir);
    let ts = chrono::Local::now().format("%Y-%m-%dT%H-%M-%S");
    log_dir.join(format!("{}-{}.log", prefix, ts))
}

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_ITERATIONS: u32 = 5;
const HOLDOUT: f64 = 0.4;
const RUNS_PER_QUERY: u32 = 3;
const TRIGGER_THRESHOLD: f64 = 0.5;
const NUM_WORKERS: usize = 10;
const TIMEOUT_SECS: u64 = 30;

// ─── SKILL.md parsing ───────────────────────────────────────────────────────

pub struct SkillMdInfo {
    pub name: String,
    pub description: String,
    pub content: String,
}

/// Parse SKILL.md to extract name, description, and full content.
pub fn parse_skill_md(skill_path: &Path) -> Result<SkillMdInfo, String> {
    let skill_md_path = skill_path.join("SKILL.md");
    let content = std::fs::read_to_string(&skill_md_path).map_err(|e| {
        format!("Failed to read SKILL.md at {}: {}", skill_md_path.display(), e)
    })?;

    // Normalize CRLF
    let normalized = content.replace("\r\n", "\n");

    if !normalized.starts_with("---") {
        return Err("SKILL.md is missing YAML frontmatter (does not start with ---)".to_string());
    }

    let after_first = &normalized[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md has unclosed YAML frontmatter".to_string())?;

    let yaml_block = &after_first[..end_pos];

    let mut name = String::new();
    let mut description = String::new();
    let mut in_description_block = false;
    let mut description_lines: Vec<&str> = Vec::new();

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        let is_indented = line.starts_with(' ') || line.starts_with('\t');

        if in_description_block {
            if is_indented && !trimmed.is_empty() {
                description_lines.push(trimmed);
                continue;
            }
            // End of block scalar
            description = description_lines.join(" ");
            in_description_block = false;
        }

        if !is_indented && trimmed.starts_with("name:") {
            let val = trimmed["name:".len()..].trim();
            name = val.trim_matches(|c| c == '\'' || c == '"').to_string();
        } else if !is_indented && trimmed.starts_with("description:") {
            let val = trimmed["description:".len()..].trim();
            if val == ">" || val == "|" || val == ">-" || val == "|-" {
                in_description_block = true;
                description_lines.clear();
            } else {
                description = val.trim_matches(|c| c == '\'' || c == '"').to_string();
            }
        }
    }

    // Handle block scalar that extends to end of frontmatter
    if in_description_block && !description_lines.is_empty() {
        description = description_lines.join(" ");
    }

    if name.is_empty() {
        return Err("SKILL.md frontmatter is missing 'name:' field".to_string());
    }

    Ok(SkillMdInfo {
        name,
        description,
        content: normalized,
    })
}

// ─── Train/test split ───────────────────────────────────────────────────────

/// Stratified train/test split. Separates by should_trigger,
/// shuffles each group with fixed seed, takes holdout fraction as test.
pub fn split_eval_set(
    eval_set: &[EvalQuery],
    holdout: f64,
) -> (Vec<EvalQuery>, Vec<EvalQuery>) {
    let mut rng = rand::rngs::SmallRng::seed_from_u64(42);

    let mut trigger: Vec<EvalQuery> = eval_set
        .iter()
        .filter(|q| q.should_trigger)
        .cloned()
        .collect();
    let mut no_trigger: Vec<EvalQuery> = eval_set
        .iter()
        .filter(|q| !q.should_trigger)
        .cloned()
        .collect();

    trigger.shuffle(&mut rng);
    no_trigger.shuffle(&mut rng);

    let n_trigger_test = 1.max((trigger.len() as f64 * holdout) as usize);
    let n_no_trigger_test = 1.max((no_trigger.len() as f64 * holdout) as usize);

    let mut test_set = Vec::new();
    let mut train_set = Vec::new();

    // Split trigger queries
    for (i, q) in trigger.into_iter().enumerate() {
        if i < n_trigger_test {
            test_set.push(q);
        } else {
            train_set.push(q);
        }
    }

    // Split no-trigger queries
    for (i, q) in no_trigger.into_iter().enumerate() {
        if i < n_no_trigger_test {
            test_set.push(q);
        } else {
            train_set.push(q);
        }
    }

    (train_set, test_set)
}

// ─── Main loop ──────────────────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn run_loop(
    eval_queries: Vec<EvalQuery>,
    skill_path: &Path,
    workspace_path: &Path,
    plugin_slug: &str,
    // skill_slug is the filesystem directory name, distinct from skill_info.name (YAML display name)
    skill_slug: &str,
    model: &str,
    api_key: &SecretString,
    cancel: Arc<AtomicBool>,
    app: &tauri::AppHandle,
    pool: SidecarPool,
    log_dir: &Path,
) -> Result<serde_json::Value, String> {
    let loop_log = init_log_file(log_dir, "desc-opt-loop");
    let eval_log = init_log_file(log_dir, "desc-opt-eval");
    let improve_log = init_log_file(log_dir, "desc-opt-improve");

    log::info!(
        "[run_loop] skill_path={} plugin={} queries={} model={}",
        skill_path.display(),
        plugin_slug,
        eval_queries.len(),
        model
    );
    write_log_line(&loop_log, &format!(
        "RUN_START skill_path={} plugin={} queries={} model={}",
        skill_path.display(), plugin_slug, eval_queries.len(), model
    ));

    let skill_info = parse_skill_md(skill_path)?;
    let mut current_description = skill_info.description.clone();
    let original_description = skill_info.description.clone();

    let (train_set, test_set) = if HOLDOUT > 0.0 {
        split_eval_set(&eval_queries, HOLDOUT)
    } else {
        (eval_queries, vec![])
    };

    log::info!(
        "[run_loop] split: {} train, {} test (holdout={})",
        train_set.len(),
        test_set.len(),
        HOLDOUT
    );
    write_log_line(&loop_log, &format!(
        "SPLIT train={} test={} holdout={}",
        train_set.len(), test_set.len(), HOLDOUT
    ));

    let all_queries: Vec<EvalQuery> = train_set
        .iter()
        .chain(test_set.iter())
        .cloned()
        .collect();

    let train_query_set: HashSet<String> = train_set.iter().map(|q| q.query.clone()).collect();

    let mut history: Vec<IterationRecord> = Vec::new();
    let mut exit_reason = String::new();

    for iteration in 1..=MAX_ITERATIONS {
        if cancel.load(Ordering::SeqCst) {
            write_log_line(&loop_log, "CANCELLED before iteration start");
            return Err("Optimization cancelled".to_string());
        }

        log::info!(
            "[run_loop] iteration {}/{} description=\"{}\"",
            iteration,
            MAX_ITERATIONS,
            &current_description[..current_description.len().min(80)]
        );
        write_log_line(&loop_log, &format!(
            "ITERATION_START iteration={}/{} description=\"{}\"",
            iteration, MAX_ITERATIONS,
            &current_description[..current_description.len().min(80)]
        ));

        // Write candidate description to eval sandbox before running eval.
        // Use `skill_slug` (the filesystem directory name) — not `skill_info.name`
        // (the YAML display name) — so the sandbox path matches what the sidecar resolves.
        let sandbox_root = eval::eval_sandbox_root(workspace_path);
        if let Err(e) = eval::write_sandbox_skill_md(
            &sandbox_root,
            plugin_slug,
            skill_slug,
            &skill_info.content,
            &current_description,
        ) {
            write_log_line(&eval_log, &format!("SANDBOX_WRITE_FAIL iteration={} error={}", iteration, e));
            return Err(e);
        }
        write_log_line(&eval_log, &format!("SANDBOX_WRITE_OK iteration={}", iteration));

        // Run eval on all queries via sidecar pool
        let all_results = eval::run_eval(
            &all_queries,
            skill_slug,
            plugin_slug,
            &current_description,
            workspace_path,
            model,
            api_key,
            app,
            &pool,
            NUM_WORKERS,
            TIMEOUT_SECS,
            RUNS_PER_QUERY,
            TRIGGER_THRESHOLD,
            &cancel,
            log_dir,
        )
        .await?;

        // Split results by train/test
        let train_results: Vec<_> = all_results
            .results
            .iter()
            .filter(|r| train_query_set.contains(&r.query))
            .cloned()
            .collect();
        let test_results: Vec<_> = all_results
            .results
            .iter()
            .filter(|r| !train_query_set.contains(&r.query))
            .cloned()
            .collect();

        let train_passed = train_results.iter().filter(|r| r.pass).count();
        let train_total = train_results.len();
        let test_passed = test_results.iter().filter(|r| r.pass).count();
        let test_total = test_results.len();

        let train_eval = EvalResults {
            results: train_results.clone(),
            summary: eval::EvalSummary {
                total: train_total,
                passed: train_passed,
                failed: train_total - train_passed,
            },
        };

        let test_eval = if !test_set.is_empty() {
            Some(EvalResults {
                results: test_results.clone(),
                summary: eval::EvalSummary {
                    total: test_total,
                    passed: test_passed,
                    failed: test_total - test_passed,
                },
            })
        } else {
            None
        };

        // Record iteration
        history.push(IterationRecord {
            iteration,
            description: current_description.clone(),
            train_passed,
            train_total,
            train_results: train_results.clone(),
            test_passed: if !test_set.is_empty() { Some(test_passed) } else { None },
            test_total: if !test_set.is_empty() { Some(test_total) } else { None },
        });

        // Emit progress event
        let progress_payload = serde_json::json!({
            "type": "progress",
            "iteration": iteration,
            "description": current_description,
            "train_passed": train_passed,
            "train_total": train_total,
            "test_passed": if !test_set.is_empty() { Some(test_passed) } else { None },
            "test_total": if !test_set.is_empty() { Some(test_total) } else { None },
        });
        if let Err(e) = app.emit("description:progress", &progress_payload) {
            log::debug!("[run_loop] emit error: {}", e);
        }

        log::info!(
            "[run_loop] iteration {} scores: train={}/{} test={}/{}",
            iteration,
            train_passed,
            train_total,
            test_passed,
            test_total
        );
        write_log_line(&eval_log, &format!(
            "EVAL_COMPLETE iteration={} train={}/{} test={}/{}",
            iteration, train_passed, train_total, test_passed, test_total
        ));

        // Early exit if all train pass
        if train_total > 0 && train_passed == train_total {
            exit_reason = format!("all_passed (iteration {})", iteration);
            write_log_line(&loop_log, &format!("EARLY_EXIT reason={}", exit_reason));
            break;
        }

        // Last iteration
        if iteration == MAX_ITERATIONS {
            exit_reason = format!("max_iterations ({})", MAX_ITERATIONS);
            write_log_line(&loop_log, &format!("MAX_ITERATIONS_REACHED reason={}", exit_reason));
            break;
        }

        // Improve description
        if cancel.load(Ordering::SeqCst) {
            write_log_line(&loop_log, "CANCELLED before improve step");
            return Err("Optimization cancelled".to_string());
        }

        // Build blinded history (no test keys)
        let blinded_history: Vec<HistoryEntry> = history
            .iter()
            .map(|h| HistoryEntry {
                iteration: h.iteration,
                description: h.description.clone(),
                train_passed: h.train_passed,
                train_total: h.train_total,
                train_results: h.train_results.clone(),
            })
            .collect();

        write_log_line(&improve_log, &format!(
            "IMPROVE_START iteration={} model={} skill={}",
            iteration, model, skill_info.name
        ));

        match improve::improve_description(
            &skill_info.name,
            &skill_info.content,
            &current_description,
            &train_eval,
            &blinded_history,
            model,
            api_key.expose(),
            test_eval.as_ref(),
        )
        .await
        {
            Ok(new_desc) => {
                write_log_line(&improve_log, &format!(
                    "IMPROVE_OK iteration={} chars={} description=\"{}\"",
                    iteration, new_desc.len(),
                    &new_desc[..new_desc.len().min(80)]
                ));
                current_description = new_desc;
            }
            Err(e) => {
                write_log_line(&improve_log, &format!(
                    "IMPROVE_FAIL iteration={} error={}", iteration, e
                ));
                return Err(e);
            }
        }

        log::info!(
            "[run_loop] new description ({} chars): \"{}\"",
            current_description.len(),
            &current_description[..current_description.len().min(80)]
        );
    }

    // Select best
    let best = if !test_set.is_empty() {
        history
            .iter()
            .max_by_key(|h| h.test_passed.unwrap_or(0))
            .unwrap()
    } else {
        history.iter().max_by_key(|h| h.train_passed).unwrap()
    };

    let best_score = if !test_set.is_empty() {
        format!(
            "{}/{}",
            best.test_passed.unwrap_or(0),
            best.test_total.unwrap_or(0)
        )
    } else {
        format!("{}/{}", best.train_passed, best.train_total)
    };

    // Build history for output
    let history_output: Vec<serde_json::Value> = history
        .iter()
        .map(|h| {
            serde_json::json!({
                "iteration": h.iteration,
                "description": h.description,
                "train_passed": h.train_passed,
                "train_total": h.train_total,
                "test_passed": h.test_passed,
                "test_total": h.test_total,
            })
        })
        .collect();

    write_log_line(&loop_log, &format!(
        "RUN_COMPLETE exit_reason={} iterations={} best_score={} best_train={}/{}",
        exit_reason, history.len(), best_score, best.train_passed, best.train_total
    ));

    Ok(serde_json::json!({
        "ok": true,
        "exit_reason": exit_reason,
        "original_description": original_description,
        "best_description": best.description,
        "best_score": best_score,
        "best_train_score": format!("{}/{}", best.train_passed, best.train_total),
        "best_test_score": if !test_set.is_empty() {
            Some(format!("{}/{}", best.test_passed.unwrap_or(0), best.test_total.unwrap_or(0)))
        } else {
            None
        },
        "final_description": current_description,
        "iterations_run": history.len(),
        "holdout": HOLDOUT,
        "train_size": train_set.len(),
        "test_size": test_set.len(),
        "history": history_output,
    }))
}

// ─── Internal types ─────────────────────────────────────────────────────────

struct IterationRecord {
    iteration: u32,
    description: String,
    train_passed: usize,
    train_total: usize,
    train_results: Vec<eval::EvalResult>,
    test_passed: Option<usize>,
    test_total: Option<usize>,
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_split_eval_set_stratified() {
        let queries = vec![
            EvalQuery { query: "trigger1".to_string(), should_trigger: true },
            EvalQuery { query: "trigger2".to_string(), should_trigger: true },
            EvalQuery { query: "trigger3".to_string(), should_trigger: true },
            EvalQuery { query: "trigger4".to_string(), should_trigger: true },
            EvalQuery { query: "trigger5".to_string(), should_trigger: true },
            EvalQuery { query: "no1".to_string(), should_trigger: false },
            EvalQuery { query: "no2".to_string(), should_trigger: false },
            EvalQuery { query: "no3".to_string(), should_trigger: false },
        ];

        let (train, test) = split_eval_set(&queries, 0.4);

        // Check total
        assert_eq!(train.len() + test.len(), queries.len());

        // Check both categories are represented in test
        let test_triggers = test.iter().filter(|q| q.should_trigger).count();
        let test_no_triggers = test.iter().filter(|q| !q.should_trigger).count();
        assert!(test_triggers >= 1, "test should have trigger queries");
        assert!(test_no_triggers >= 1, "test should have no-trigger queries");
    }

    #[test]
    fn test_split_eval_set_deterministic() {
        let queries = vec![
            EvalQuery { query: "a".to_string(), should_trigger: true },
            EvalQuery { query: "b".to_string(), should_trigger: true },
            EvalQuery { query: "c".to_string(), should_trigger: false },
            EvalQuery { query: "d".to_string(), should_trigger: false },
        ];

        let (train1, test1) = split_eval_set(&queries, 0.4);
        let (train2, test2) = split_eval_set(&queries, 0.4);

        let t1: Vec<String> = train1.iter().map(|q| q.query.clone()).collect();
        let t2: Vec<String> = train2.iter().map(|q| q.query.clone()).collect();
        assert_eq!(t1, t2, "splits should be deterministic with same seed");

        let s1: Vec<String> = test1.iter().map(|q| q.query.clone()).collect();
        let s2: Vec<String> = test2.iter().map(|q| q.query.clone()).collect();
        assert_eq!(s1, s2);
    }

    #[test]
    fn test_parse_skill_md_inline_description() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_md = tmp.path().join("SKILL.md");
        std::fs::write(&skill_md, "---\nname: My Skill\ndescription: \"A test skill\"\n---\n# Body\n").unwrap();

        let info = parse_skill_md(tmp.path()).unwrap();
        assert_eq!(info.name, "My Skill");
        assert_eq!(info.description, "A test skill");
    }

    #[test]
    fn test_parse_skill_md_block_scalar() {
        let tmp = tempfile::tempdir().unwrap();
        let skill_md = tmp.path().join("SKILL.md");
        std::fs::write(
            &skill_md,
            "---\nname: My Skill\ndescription: >\n  A long description\n  that spans lines\nauthor: dev\n---\n# Body\n",
        )
        .unwrap();

        let info = parse_skill_md(tmp.path()).unwrap();
        assert_eq!(info.name, "My Skill");
        assert_eq!(info.description, "A long description that spans lines");
    }
}
