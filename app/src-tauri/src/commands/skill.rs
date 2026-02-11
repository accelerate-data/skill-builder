use crate::db::Db;
use crate::markdown::workflow_state;
use crate::types::SkillSummary;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skills(
    workspace_path: String,
    db: tauri::State<'_, Db>,
) -> Result<Vec<SkillSummary>, String> {
    let conn = db.0.lock().ok();
    list_skills_inner(&workspace_path, conn.as_deref())
}

fn list_skills_inner(
    workspace_path: &str,
    conn: Option<&rusqlite::Connection>,
) -> Result<Vec<SkillSummary>, String> {
    let base = Path::new(workspace_path);
    if !base.exists() {
        return Ok(vec![]);
    }

    let mut skills = Vec::new();

    let entries = fs::read_dir(base).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        // Check for workflow-state.md or workflow.md
        let state_file = path.join("workflow-state.md");
        let alt_state_file = path.join("workflow.md");
        let found_file = if state_file.exists() {
            Some(state_file)
        } else if alt_state_file.exists() {
            Some(alt_state_file)
        } else {
            None
        };

        let name = entry
            .file_name()
            .to_string_lossy()
            .to_string();

        let (domain, current_step, status) = if let Some(ref f) = found_file {
            let content = fs::read_to_string(f).unwrap_or_default();
            let state = workflow_state::parse_workflow_state(&content);
            (state.domain, state.current_step, state.status)
        } else {
            // Include directories even without workflow state - they might be skill dirs
            // with context/ and skill/ subdirs
            let has_context = path.join("context").is_dir();
            let has_skill = path.join("skill").is_dir();
            if !has_context && !has_skill {
                continue;
            }
            (None, None, None)
        };

        let last_modified = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .map(|t| {
                let dt: chrono::DateTime<chrono::Local> = t.into();
                dt.format("%Y-%m-%d %H:%M:%S").to_string()
            });

        skills.push(SkillSummary {
            name,
            domain,
            current_step,
            status,
            last_modified,
            tags: vec![],
            skill_type: None,
        });
    }

    // Overlay SQLite workflow state (preferred over filesystem workflow.md)
    if let Some(conn) = conn {
        for skill in &mut skills {
            if let Ok(Some(run)) = crate::db::get_workflow_run(conn, &skill.name) {
                skill.current_step = Some(format!("Step {}", run.current_step));
                skill.status = Some(run.status);
                skill.skill_type = Some(run.skill_type.clone());
                if skill.domain.is_none() {
                    skill.domain = Some(run.domain);
                }
            }
        }

        // Batch-fetch tags for all skills
        let names: Vec<String> = skills.iter().map(|s| s.name.clone()).collect();
        if let Ok(tags_map) = crate::db::get_tags_for_skills(conn, &names) {
            for skill in &mut skills {
                if let Some(tags) = tags_map.get(&skill.name) {
                    skill.tags = tags.clone();
                }
            }
        }
    }

    skills.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(skills)
}

#[tauri::command]
pub fn create_skill(
    workspace_path: String,
    name: String,
    domain: String,
    tags: Option<Vec<String>>,
    skill_type: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().ok();
    create_skill_inner(
        &workspace_path,
        &name,
        &domain,
        tags.as_deref(),
        skill_type.as_deref(),
        conn.as_deref(),
    )
}

fn create_skill_inner(
    workspace_path: &str,
    name: &str,
    domain: &str,
    tags: Option<&[String]>,
    skill_type: Option<&str>,
    conn: Option<&rusqlite::Connection>,
) -> Result<(), String> {
    let base = Path::new(workspace_path).join(name);
    if base.exists() {
        return Err(format!("Skill '{}' already exists", name));
    }

    fs::create_dir_all(base.join("context")).map_err(|e| e.to_string())?;

    let skill_type = skill_type.unwrap_or("domain");

    let workflow_content = format!(
        "## Workflow State\n- **Skill name**: {}\n- **Domain**: {}\n- **Current step**: Initialization\n- **Status**: pending\n- **Completed steps**: \n- **Timestamp**: {}\n- **Notes**: Skill created\n",
        name,
        domain,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );

    fs::write(base.join("workflow.md"), workflow_content).map_err(|e| e.to_string())?;

    if let Some(conn) = conn {
        crate::db::save_workflow_run(conn, name, domain, 0, "pending", skill_type)?;

        if let Some(tags) = tags {
            if !tags.is_empty() {
                crate::db::set_skill_tags(conn, name, tags)?;
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn delete_skill(
    workspace_path: String,
    name: String,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().ok();
    delete_skill_inner(&workspace_path, &name, conn.as_deref())
}

fn delete_skill_inner(
    workspace_path: &str,
    name: &str,
    conn: Option<&rusqlite::Connection>,
) -> Result<(), String> {
    let base = Path::new(workspace_path).join(name);
    if !base.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    // Verify this is inside the workspace path to prevent directory traversal
    let canonical_workspace = fs::canonicalize(workspace_path).map_err(|e| e.to_string())?;
    let canonical_target = fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_workspace) {
        return Err("Invalid skill path".to_string());
    }

    // Clean up tags from the database
    if let Some(conn) = conn {
        let _ = crate::db::set_skill_tags(conn, name, &[]);
    }

    fs::remove_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn update_skill_tags(
    skill_name: String,
    tags: Vec<String>,
    db: tauri::State<'_, Db>,
) -> Result<(), String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::set_skill_tags(&conn, &skill_name, &tags)
}

#[tauri::command]
pub fn get_all_tags(db: tauri::State<'_, Db>) -> Result<Vec<String>, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    crate::db::get_all_tags(&conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_create_and_list_skills() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        create_skill_inner(workspace, "my-skill", "sales pipeline", None, None, None).unwrap();

        let skills = list_skills_inner(workspace, None).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        assert_eq!(skills[0].domain.as_deref(), Some("sales pipeline"));
        assert_eq!(skills[0].status.as_deref(), Some("pending"));
    }

    #[test]
    fn test_create_duplicate_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        create_skill_inner(workspace, "dup-skill", "domain", None, None, None).unwrap();
        let result = create_skill_inner(workspace, "dup-skill", "domain", None, None, None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_delete_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        create_skill_inner(workspace, "to-delete", "domain", None, None, None).unwrap();
        let skills = list_skills_inner(workspace, None).unwrap();
        assert_eq!(skills.len(), 1);

        delete_skill_inner(workspace, "to-delete", None).unwrap();
        let skills = list_skills_inner(workspace, None).unwrap();
        assert_eq!(skills.len(), 0);
    }

    #[test]
    fn test_list_empty_workspace() {
        // Use a path that does not exist — list_skills returns empty vec
        let skills = list_skills_inner("/tmp/nonexistent-workspace-path-abc123", None).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_delete_skill_directory_traversal() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        // Create a legitimate skill so the traversal target resolves
        create_skill_inner(workspace, "legit", "domain", None, None, None).unwrap();

        // Attempt to delete using ".." to escape the workspace
        let result = delete_skill_inner(workspace, "../../../etc", None);
        assert!(result.is_err());

        // The legitimate skill should still exist
        let skills = list_skills_inner(workspace, None).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "legit");
    }

    #[test]
    fn test_delete_nonexistent_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        let result = delete_skill_inner(workspace, "no-such-skill", None);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn test_delete_skill_removes_logs_directory() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap();

        // Create a skill
        create_skill_inner(workspace, "skill-with-logs", "analytics", None, None, None).unwrap();

        // Add a logs/ subdirectory with a fake log file inside the skill directory
        let skill_dir = dir.path().join("skill-with-logs");
        let logs_dir = skill_dir.join("logs");
        fs::create_dir_all(&logs_dir).unwrap();
        fs::write(logs_dir.join("step-0.log"), "fake log content for step 0").unwrap();
        fs::write(logs_dir.join("step-1.log"), "fake log content for step 1").unwrap();

        // Verify the logs directory and files exist before deletion
        assert!(logs_dir.exists());
        assert!(logs_dir.join("step-0.log").exists());
        assert!(logs_dir.join("step-1.log").exists());

        // Delete the skill
        delete_skill_inner(workspace, "skill-with-logs", None).unwrap();

        // Verify the entire skill directory (including logs/) is gone
        assert!(!skill_dir.exists(), "skill directory should be removed");
        assert!(!logs_dir.exists(), "logs directory should be removed");

        // Verify no skills remain in the workspace
        let skills = list_skills_inner(workspace, None).unwrap();
        assert!(skills.is_empty());
    }
}
