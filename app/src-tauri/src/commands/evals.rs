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
    let benchmark: serde_json::Value = serde_json::from_str(&benchmark_raw).map_err(|e| {
        log::error!("[read_iteration_result] failed to parse benchmark.json: {}", e);
        format!("Failed to parse benchmark.json: {}", e)
    })?;

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
