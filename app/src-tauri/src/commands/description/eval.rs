use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::AsyncBufReadExt;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

// ─── Types ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct EvalResult {
    pub query: String,
    pub should_trigger: bool,
    pub trigger_rate: f64,
    pub triggers: u32,
    pub runs: u32,
    pub pass: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvalSummary {
    pub total: usize,
    pub passed: usize,
    pub failed: usize,
}

#[derive(Debug, Clone, Serialize)]
pub struct EvalResults {
    pub results: Vec<EvalResult>,
    pub summary: EvalSummary,
}

// ─── Command file RAII guard ────────────────────────────────────────────────

struct CommandFileGuard {
    path: PathBuf,
}

impl Drop for CommandFileGuard {
    fn drop(&mut self) {
        if self.path.exists() {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

// ─── Streaming JSON trigger detection ───────────────────────────────────────

/// Parse streaming JSON lines from `claude -p --output-format stream-json`
/// and detect whether Claude triggers the skill (uses the Skill or Read tool
/// with the command file name).
fn process_stream_line(
    line: &str,
    clean_name: &str,
    pending_tool_name: &mut Option<String>,
    accumulated_json: &mut String,
    triggered: &mut bool,
) -> Option<bool> {
    let event: serde_json::Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(_) => return None, // skip non-JSON lines
    };

    if event.get("type").and_then(|v| v.as_str()) == Some("stream_event") {
        let stream_event = event.get("event").unwrap_or(&serde_json::Value::Null);
        let stream_type = stream_event
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("");

        match stream_type {
            "content_block_start" => {
                let content_block = stream_event
                    .get("content_block")
                    .unwrap_or(&serde_json::Value::Null);
                if content_block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                    let tool_name = content_block
                        .get("name")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    if tool_name == "Skill" || tool_name == "Read" {
                        *pending_tool_name = Some(tool_name.to_string());
                        *accumulated_json = String::new();
                    } else {
                        return Some(false); // wrong tool = no trigger
                    }
                }
            }
            "content_block_delta" => {
                if pending_tool_name.is_some() {
                    let delta = stream_event
                        .get("delta")
                        .unwrap_or(&serde_json::Value::Null);
                    if delta.get("type").and_then(|v| v.as_str()) == Some("input_json_delta") {
                        if let Some(partial) = delta.get("partial_json").and_then(|v| v.as_str()) {
                            accumulated_json.push_str(partial);
                            if accumulated_json.contains(clean_name) {
                                return Some(true); // early trigger detection
                            }
                        }
                    }
                }
            }
            "content_block_stop" => {
                if pending_tool_name.is_some() {
                    let result = accumulated_json.contains(clean_name);
                    *pending_tool_name = None;
                    return Some(result);
                }
            }
            "message_stop" => {
                if pending_tool_name.is_some() {
                    let result = accumulated_json.contains(clean_name);
                    *pending_tool_name = None;
                    return Some(result);
                }
                return Some(false);
            }
            _ => {}
        }
    } else if event.get("type").and_then(|v| v.as_str()) == Some("assistant") {
        // Fallback: full assistant message
        if let Some(content) = event
            .get("message")
            .and_then(|m| m.get("content"))
            .and_then(|c| c.as_array())
        {
            for item in content {
                if item.get("type").and_then(|v| v.as_str()) != Some("tool_use") {
                    continue;
                }
                let tool_name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
                let input = item.get("input").unwrap_or(&serde_json::Value::Null);
                if tool_name == "Skill" {
                    if let Some(skill) = input.get("skill").and_then(|v| v.as_str()) {
                        if skill.contains(clean_name) {
                            *triggered = true;
                        }
                    }
                } else if tool_name == "Read" {
                    if let Some(fp) = input.get("file_path").and_then(|v| v.as_str()) {
                        if fp.contains(clean_name) {
                            *triggered = true;
                        }
                    }
                }
                return Some(*triggered);
            }
        }
    } else if event.get("type").and_then(|v| v.as_str()) == Some("result") {
        return Some(*triggered);
    }

    None // continue reading
}

// ─── Single query execution ─────────────────────────────────────────────────

/// Run a single eval query against `claude -p` and detect whether the skill is triggered.
async fn run_single_query(
    query: String,
    skill_name: String,
    description: String,
    project_root: PathBuf,
    model: Option<String>,
    timeout_secs: u64,
) -> bool {
    let unique_id = &uuid::Uuid::new_v4().to_string()[..8];
    let clean_name = format!("{}-skill-{}", skill_name, unique_id);

    let commands_dir = project_root.join(".claude").join("commands");
    if let Err(e) = std::fs::create_dir_all(&commands_dir) {
        log::warn!("[run_single_query] failed to create commands dir: {}", e);
        return false;
    }

    let command_file = commands_dir.join(format!("{}.md", clean_name));

    // Build the command file content with YAML frontmatter
    let indented_desc = description
        .lines()
        .collect::<Vec<_>>()
        .join("\n  ");
    let command_content = format!(
        "---\ndescription: |\n  {}\n---\n\n# {}\n\nThis skill handles: {}\n",
        indented_desc, skill_name, description
    );

    if let Err(e) = std::fs::write(&command_file, &command_content) {
        log::warn!("[run_single_query] failed to write command file: {}", e);
        return false;
    }

    let _guard = CommandFileGuard {
        path: command_file.clone(),
    };

    // Build claude command
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd");
        c.arg("/C").arg("claude");
        c
    };
    #[cfg(not(windows))]
    let mut cmd = tokio::process::Command::new("claude");

    cmd.arg("-p")
        .arg(&query)
        .arg("--output-format")
        .arg("stream-json")
        .arg("--verbose")
        .arg("--include-partial-messages")
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .current_dir(&project_root)
        .env_remove("CLAUDECODE");

    if let Some(ref m) = model {
        cmd.arg("--model").arg(m);
    }

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            log::warn!("[run_single_query] failed to spawn claude: {}", e);
            return false;
        }
    };

    let stdout = match child.stdout.take() {
        Some(s) => s,
        None => return false,
    };

    let result = tokio::time::timeout(
        std::time::Duration::from_secs(timeout_secs),
        async {
            let mut reader = tokio::io::BufReader::new(stdout).lines();
            let mut pending_tool_name: Option<String> = None;
            let mut accumulated_json = String::new();
            let mut triggered = false;

            while let Ok(Some(line)) = reader.next_line().await {
                let line = line.trim().to_string();
                if line.is_empty() {
                    continue;
                }
                if let Some(result) = process_stream_line(
                    &line,
                    &clean_name,
                    &mut pending_tool_name,
                    &mut accumulated_json,
                    &mut triggered,
                ) {
                    // Kill child early on detection
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return result;
                }
            }

            triggered
        },
    )
    .await;

    // Ensure child is cleaned up
    if child.id().is_some() {
        let _ = child.kill().await;
    }
    let _ = child.wait().await;

    match result {
        Ok(triggered) => triggered,
        Err(_) => {
            log::debug!("[run_single_query] query timed out: {}", query);
            false
        }
    }
}

// ─── Parallel eval driver ───────────────────────────────────────────────────

#[allow(clippy::too_many_arguments)]
pub async fn run_eval(
    eval_set: &[super::EvalQuery],
    skill_name: &str,
    description: &str,
    project_root: &Path,
    model: Option<&str>,
    num_workers: usize,
    timeout_secs: u64,
    runs_per_query: u32,
    trigger_threshold: f64,
    cancel: &Arc<AtomicBool>,
) -> Result<EvalResults, String> {
    let semaphore = Arc::new(Semaphore::new(num_workers));
    let mut set = JoinSet::new();

    // Submit all tasks
    for item in eval_set {
        for _run_idx in 0..runs_per_query {
            let permit = semaphore.clone().acquire_owned().await.map_err(|e| {
                format!("Semaphore error: {}", e)
            })?;
            let query = item.query.clone();
            let sn = skill_name.to_string();
            let desc = description.to_string();
            let pr = project_root.to_path_buf();
            let m = model.map(|s| s.to_string());
            let cancel_flag = cancel.clone();

            set.spawn(async move {
                let _permit = permit;
                if cancel_flag.load(Ordering::SeqCst) {
                    return (query, false);
                }
                let result = run_single_query(query.clone(), sn, desc, pr, m, timeout_secs).await;
                (query, result)
            });
        }
    }

    // Collect results
    let mut query_triggers: HashMap<String, Vec<bool>> = HashMap::new();

    while let Some(join_result) = set.join_next().await {
        if cancel.load(Ordering::SeqCst) {
            set.abort_all();
            return Err("Optimization cancelled".to_string());
        }

        match join_result {
            Ok((query, triggered)) => {
                query_triggers
                    .entry(query)
                    .or_default()
                    .push(triggered);
            }
            Err(e) => {
                log::warn!("[run_eval] task join error: {}", e);
            }
        }
    }

    // Build lookup for should_trigger
    let should_trigger_map: HashMap<&str, bool> = eval_set
        .iter()
        .map(|item| (item.query.as_str(), item.should_trigger))
        .collect();

    // Aggregate results
    let mut results = Vec::new();
    for (query, triggers) in &query_triggers {
        let should_trigger = *should_trigger_map.get(query.as_str()).unwrap_or(&true);
        let trigger_count = triggers.iter().filter(|&&t| t).count() as u32;
        let total_runs = triggers.len() as u32;
        let trigger_rate = if total_runs > 0 {
            trigger_count as f64 / total_runs as f64
        } else {
            0.0
        };

        let pass = if should_trigger {
            trigger_rate >= trigger_threshold
        } else {
            trigger_rate < trigger_threshold
        };

        results.push(EvalResult {
            query: query.clone(),
            should_trigger,
            trigger_rate,
            triggers: trigger_count,
            runs: total_runs,
            pass,
        });
    }

    let passed = results.iter().filter(|r| r.pass).count();
    let total = results.len();

    Ok(EvalResults {
        results,
        summary: EvalSummary {
            total,
            passed,
            failed: total - passed,
        },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_process_stream_line_tool_use_skill_trigger() {
        let clean_name = "my-skill-skill-abc12345";
        let mut pending = None;
        let mut acc = String::new();
        let mut triggered = false;

        // content_block_start with Skill tool
        let start = r#"{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Skill"}}}"#;
        assert!(process_stream_line(start, clean_name, &mut pending, &mut acc, &mut triggered).is_none());
        assert_eq!(pending, Some("Skill".to_string()));

        // content_block_delta with partial JSON containing the clean_name
        let delta = [
            r#"{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\"skill\": \""#,
            clean_name,
            r#"\"}"}}}"#,
        ].join("");
        let result = process_stream_line(&delta, clean_name, &mut pending, &mut acc, &mut triggered);
        assert_eq!(result, Some(true));
    }

    #[test]
    fn test_process_stream_line_wrong_tool() {
        let clean_name = "my-skill-skill-abc12345";
        let mut pending = None;
        let mut acc = String::new();
        let mut triggered = false;

        let start = r#"{"type":"stream_event","event":{"type":"content_block_start","content_block":{"type":"tool_use","name":"Write"}}}"#;
        let result = process_stream_line(start, clean_name, &mut pending, &mut acc, &mut triggered);
        assert_eq!(result, Some(false));
    }

    #[test]
    fn test_process_stream_line_message_stop_no_trigger() {
        let clean_name = "my-skill-skill-abc12345";
        let mut pending = None;
        let mut acc = String::new();
        let mut triggered = false;

        let stop = r#"{"type":"stream_event","event":{"type":"message_stop"}}"#;
        let result = process_stream_line(stop, clean_name, &mut pending, &mut acc, &mut triggered);
        assert_eq!(result, Some(false));
    }

    #[test]
    fn test_process_stream_line_assistant_fallback_trigger() {
        let clean_name = "my-skill-skill-abc12345";
        let mut pending = None;
        let mut acc = String::new();
        let mut triggered = false;

        let msg = format!(
            r#"{{"type":"assistant","message":{{"content":[{{"type":"tool_use","name":"Skill","input":{{"skill":"{}"}}}}]}}}}"#,
            clean_name
        );
        let result = process_stream_line(&msg, clean_name, &mut pending, &mut acc, &mut triggered);
        assert_eq!(result, Some(true));
    }
}
