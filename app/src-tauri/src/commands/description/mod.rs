use serde::{Deserialize, Serialize};
use std::path::Path;
use std::process::Stdio;
use tauri::Emitter;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EvalQuery {
    pub query: String,
    pub should_trigger: bool,
}

fn resolve_skill_creator_scripts(app: &tauri::AppHandle) -> std::path::PathBuf {
    super::workflow::resolve_bundled_plugins_dir(app)
        .join("skill-creator")
        .join("skills")
        .join("skill-creator")
        .join("scripts")
}

#[tauri::command]
pub async fn generate_eval_queries(
    skill_name: String,
    workspace_path: String,
    model: Option<String>,
    app: tauri::AppHandle,
) -> Result<Vec<EvalQuery>, String> {
    log::info!("[generate_eval_queries] skill={}", skill_name);
    let scripts_dir = resolve_skill_creator_scripts(&app);
    let skill_path = Path::new(&workspace_path).join(&skill_name);

    let mut cmd = tokio::process::Command::new("uv");
    cmd.arg("run")
        .arg("--quiet")
        .arg(scripts_dir.join("generate_eval_queries.py"))
        .arg("--skill-path")
        .arg(&skill_path);

    if let Some(ref m) = model {
        cmd.arg("--model").arg(m);
    }

    let output = cmd.output().await.map_err(|e| {
        log::error!("[generate_eval_queries] failed to spawn uv: {}", e);
        format!("Failed to run generate_eval_queries.py: {}", e)
    })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        log::error!("[generate_eval_queries] script failed: {}", stderr);
        return Err(format!("generate_eval_queries.py failed: {}", stderr));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let parsed: serde_json::Value = serde_json::from_str(&stdout).map_err(|e| {
        log::error!("[generate_eval_queries] failed to parse output: {}", e);
        format!("Failed to parse output: {}", e)
    })?;

    if parsed.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        let error = parsed
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        log::error!("[generate_eval_queries] script returned ok=false: {}", error);
        return Err(format!("generate_eval_queries.py error: {}", error));
    }

    let queries = parsed
        .get("queries")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "Missing 'queries' array in response".to_string())?;

    let result: Vec<EvalQuery> = serde_json::from_value(serde_json::Value::Array(queries.clone()))
        .map_err(|e| {
            log::error!("[generate_eval_queries] failed to deserialize queries: {}", e);
            format!("Failed to deserialize queries: {}", e)
        })?;

    Ok(result)
}

#[tauri::command]
pub async fn run_optimization_loop(
    skill_name: String,
    workspace_path: String,
    model: String,
    eval_queries: Vec<EvalQuery>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    log::info!(
        "[run_optimization_loop] skill={} queries={}",
        skill_name,
        eval_queries.len()
    );

    // Write eval_queries to a temp file
    let queries_json = serde_json::to_vec(&eval_queries).map_err(|e| {
        log::error!("[run_optimization_loop] failed to serialize queries: {}", e);
        format!("Failed to serialize eval queries: {}", e)
    })?;

    let mut tmp = tempfile::NamedTempFile::new().map_err(|e| {
        log::error!("[run_optimization_loop] failed to create temp file: {}", e);
        format!("Failed to create temp file: {}", e)
    })?;

    use std::io::Write;
    tmp.write_all(&queries_json).map_err(|e| {
        log::error!("[run_optimization_loop] failed to write temp file: {}", e);
        format!("Failed to write eval queries to temp file: {}", e)
    })?;
    tmp.flush().map_err(|e| format!("Failed to flush temp file: {}", e))?;

    let tmp_path = tmp.path().to_path_buf();
    let scripts_dir = resolve_skill_creator_scripts(&app);
    let skill_path = Path::new(&workspace_path).join(&skill_name);

    let mut child = tokio::process::Command::new("uv")
        .arg("run")
        .arg("--quiet")
        .arg(scripts_dir.join("run_loop.py"))
        .arg("--eval-set")
        .arg(&tmp_path)
        .arg("--skill-path")
        .arg(&skill_path)
        .arg("--project-root")
        .arg(&workspace_path)
        .arg("--model")
        .arg(&model)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| {
            log::error!("[run_optimization_loop] failed to spawn uv: {}", e);
            format!("Failed to run run_loop.py: {}", e)
        })?;

    let stdout = child.stdout.take().expect("stdout piped");
    let stderr_handle = child.stderr.take().unwrap();
    let mut reader = BufReader::new(stdout).lines();

    let mut final_result: Option<serde_json::Value> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        log::debug!("[run_optimization_loop] stdout line: {}", line);
        match serde_json::from_str::<serde_json::Value>(&line) {
            Ok(payload) => {
                let type_field = payload.get("type").and_then(|v| v.as_str()).unwrap_or("");
                if type_field == "progress" {
                    if let Err(e) = app.emit("description:progress", &payload) {
                        log::debug!("[run_optimization_loop] emit error: {}", e);
                    }
                } else if type_field == "result"
                    || type_field == "error"
                    || payload.get("ok").and_then(|v| v.as_bool()).is_some()
                {
                    final_result = Some(payload);
                }
            }
            Err(_) => {
                log::debug!("[run_optimization_loop] non-JSON line (skipped): {}", line);
            }
        }
    }

    let exit_status = child.wait().await.map_err(|e| {
        log::error!("[run_optimization_loop] wait error: {}", e);
        format!("Failed to wait for run_loop.py: {}", e)
    })?;

    if !exit_status.success() || final_result.is_none() {
        let mut stderr_buf = String::new();
        tokio::io::AsyncReadExt::read_to_string(
            &mut tokio::io::BufReader::new(stderr_handle),
            &mut stderr_buf,
        )
        .await
        .ok();

        if !exit_status.success() {
            if let Some(result) = final_result {
                // Return error payload from script
                let script_err = result
                    .get("error")
                    .and_then(|v| v.as_str())
                    .unwrap_or("run_loop.py exited with error")
                    .to_string();
                log::error!(
                    "[run_optimization_loop] run_loop.py error: {} stderr: {}",
                    script_err,
                    stderr_buf.trim()
                );
                return Err(if stderr_buf.trim().is_empty() {
                    script_err
                } else {
                    format!("{}\nstderr: {}", script_err, stderr_buf.trim())
                });
            }
            log::error!(
                "[run_optimization_loop] run_loop.py exited with status: {} stderr: {}",
                exit_status,
                stderr_buf.trim()
            );
            return Err(format!(
                "run_loop.py exited with non-zero status: {}\nstderr: {}",
                exit_status,
                stderr_buf.trim()
            ));
        }
    }

    // Keep the temp file alive until after process exits
    drop(tmp);

    final_result.ok_or_else(|| {
        log::error!("[run_optimization_loop] no result received from run_loop.py");
        "No result received from run_loop.py".to_string()
    })
}

#[tauri::command]
pub fn save_eval_queries(
    skill_name: String,
    workspace_path: String,
    eval_queries: Vec<EvalQuery>,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    log::info!(
        "[save_eval_queries] skill={} count={}",
        skill_name,
        eval_queries.len()
    );
    let skills_path = super::refine::resolve_skills_path(&db, &workspace_path)?;
    let path = Path::new(&skills_path)
        .join(&skill_name)
        .join("description-evals.json");
    let json = serde_json::to_string_pretty(&eval_queries)
        .map_err(|e| format!("Failed to serialize eval queries: {}", e))?;
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, &json)
        .map_err(|e| format!("Failed to write description-evals.json: {}", e))?;
    std::fs::rename(&tmp, &path)
        .map_err(|e| format!("Failed to finalize description-evals.json: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn load_eval_queries(
    skill_name: String,
    workspace_path: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<Vec<EvalQuery>, String> {
    log::info!("[load_eval_queries] skill={}", skill_name);
    let skills_path = super::refine::resolve_skills_path(&db, &workspace_path)?;
    let path = Path::new(&skills_path)
        .join(&skill_name)
        .join("description-evals.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read description-evals.json: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse description-evals.json: {}", e))
}

#[tauri::command]
pub async fn apply_description(
    skill_name: String,
    workspace_path: String,
    description: String,
    db: tauri::State<'_, crate::db::Db>,
) -> Result<(), String> {
    log::info!("[apply_description] skill={}", skill_name);

    // Resolve skills_path from settings (may differ from workspace_path).
    let skills_path = super::refine::resolve_skills_path(&db, &workspace_path)?;
    let skill_md_path = Path::new(&skills_path)
        .join(&skill_name)
        .join("SKILL.md");

    let content = std::fs::read_to_string(&skill_md_path).map_err(|e| {
        log::error!("[apply_description] failed to read SKILL.md: {}", e);
        format!("Failed to read SKILL.md: {}", e)
    })?;

    let updated = update_skill_description(&content, &description)?;

    std::fs::write(&skill_md_path, updated).map_err(|e| {
        log::error!("[apply_description] failed to write SKILL.md: {}", e);
        format!("Failed to write SKILL.md: {}", e)
    })?;

    Ok(())
}

/// Replace or insert the `description:` field in SKILL.md YAML frontmatter.
fn update_skill_description(content: &str, description: &str) -> Result<String, String> {
    // Normalize CRLF
    let content = content.replace("\r\n", "\n");

    if !content.starts_with("---") {
        return Err("SKILL.md is missing YAML frontmatter (does not start with ---)".to_string());
    }

    // Find the closing \n---
    let after_first = &content[3..];
    let end_pos = after_first
        .find("\n---")
        .ok_or_else(|| "SKILL.md has an unclosed YAML frontmatter block".to_string())?;

    let yaml_block = &after_first[..end_pos];
    // body_part is everything from closing --- onwards (including the \n--- itself)
    let body_part = &after_first[end_pos..];

    let quoted = crate::commands::imported_skills::frontmatter::yaml_quote_scalar(description);
    let new_description_line = format!("description: {}", quoted);

    let mut new_yaml: Vec<String> = Vec::new();
    let mut found_description = false;
    let mut skip_continuation = false;
    let mut found_name = false;

    for line in yaml_block.lines() {
        let trimmed = line.trim();
        let is_indented = line.starts_with(' ') || line.starts_with('\t');

        // Skip continuation lines of a folded scalar description
        if skip_continuation {
            if is_indented && !trimmed.is_empty() {
                continue;
            }
            skip_continuation = false;
        }

        if !is_indented && trimmed.starts_with("description:") {
            // Check if folded scalar (description: > or description: |)
            let val = trimmed["description:".len()..].trim();
            if val == ">" || val == "|" || val == ">-" || val == "|-" {
                skip_continuation = true;
            }
            new_yaml.push(new_description_line.clone());
            found_description = true;
            continue;
        }

        new_yaml.push(line.to_string());

        // If this is the name: line and we haven't found description yet,
        // note the position to insert after (we'll insert at end if name found)
        if !is_indented && trimmed.starts_with("name:") {
            found_name = true;
        }
    }

    if !found_description {
        // Insert after name: line if present, otherwise at beginning of yaml block
        if found_name {
            // Find position of name: line in new_yaml and insert after it
            let pos = new_yaml
                .iter()
                .position(|l| l.trim().starts_with("name:"))
                .map(|i| i + 1)
                .unwrap_or(0);
            new_yaml.insert(pos, new_description_line);
        } else {
            new_yaml.insert(0, new_description_line);
        }
    }

    Ok(format!("---\n{}{}", new_yaml.join("\n"), body_part))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn update_skill_description_replaces_existing() {
        let content = "---\nname: My Skill\ndescription: old description\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "new description").unwrap();
        assert!(
            result.contains("description: \"new description\""),
            "Expected updated description, got: {}",
            result
        );
        assert!(
            !result.contains("old description"),
            "Old description should be removed"
        );
        assert!(result.contains("name: My Skill"), "name field preserved");
        assert!(result.contains("author: dev"), "author field preserved");
        assert!(result.contains("# Body"), "body preserved");
    }

    #[test]
    fn update_skill_description_handles_folded_scalar() {
        let content =
            "---\nname: Folded\ndescription: >\n  This is a long\n  multi-line description.\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "compact replacement").unwrap();
        assert!(
            result.contains("description: \"compact replacement\""),
            "Expected replacement, got: {}",
            result
        );
        assert!(
            !result.contains("This is a long"),
            "Old folded content should be removed"
        );
        assert!(result.contains("author: dev"), "author field preserved");
    }

    #[test]
    fn update_skill_description_inserts_when_missing() {
        let content = "---\nname: No Desc\nauthor: dev\n---\n# Body\n";
        let result = update_skill_description(content, "inserted description").unwrap();
        assert!(
            result.contains("description: \"inserted description\""),
            "Expected inserted description, got: {}",
            result
        );
        // description should come after name:
        let name_pos = result.find("name:").unwrap();
        let desc_pos = result.find("description:").unwrap();
        assert!(
            desc_pos > name_pos,
            "description should be inserted after name"
        );
        assert!(result.contains("author: dev"), "author field preserved");
    }
}
