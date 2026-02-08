use crate::markdown::workflow_state;
use crate::types::SkillSummary;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skills(workspace_path: String) -> Result<Vec<SkillSummary>, String> {
    let base = Path::new(&workspace_path);
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
        });
    }

    skills.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
    Ok(skills)
}

#[tauri::command]
pub fn create_skill(
    workspace_path: String,
    name: String,
    domain: String,
) -> Result<(), String> {
    let base = Path::new(&workspace_path).join(&name);
    if base.exists() {
        return Err(format!("Skill '{}' already exists", name));
    }

    fs::create_dir_all(base.join("context")).map_err(|e| e.to_string())?;
    fs::create_dir_all(base.join("references")).map_err(|e| e.to_string())?;

    let workflow_content = format!(
        "## Workflow State\n- **Skill name**: {}\n- **Domain**: {}\n- **Current step**: Initialization\n- **Status**: pending\n- **Completed steps**: \n- **Timestamp**: {}\n- **Notes**: Skill created\n",
        name,
        domain,
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S")
    );

    fs::write(base.join("workflow.md"), workflow_content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_skill(workspace_path: String, name: String) -> Result<(), String> {
    let base = Path::new(&workspace_path).join(&name);
    if !base.exists() {
        return Err(format!("Skill '{}' not found", name));
    }

    // Verify this is inside the workspace path to prevent directory traversal
    let canonical_workspace = fs::canonicalize(&workspace_path).map_err(|e| e.to_string())?;
    let canonical_target = fs::canonicalize(&base).map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_workspace) {
        return Err("Invalid skill path".to_string());
    }

    fs::remove_dir_all(&base).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_create_and_list_skills() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap().to_string();

        create_skill(workspace.clone(), "my-skill".into(), "sales pipeline".into()).unwrap();

        let skills = list_skills(workspace).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "my-skill");
        assert_eq!(skills[0].domain.as_deref(), Some("sales pipeline"));
        assert_eq!(skills[0].status.as_deref(), Some("pending"));
    }

    #[test]
    fn test_create_duplicate_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap().to_string();

        create_skill(workspace.clone(), "dup-skill".into(), "domain".into()).unwrap();
        let result = create_skill(workspace, "dup-skill".into(), "domain".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("already exists"));
    }

    #[test]
    fn test_delete_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap().to_string();

        create_skill(workspace.clone(), "to-delete".into(), "domain".into()).unwrap();
        let skills = list_skills(workspace.clone()).unwrap();
        assert_eq!(skills.len(), 1);

        delete_skill(workspace.clone(), "to-delete".into()).unwrap();
        let skills = list_skills(workspace).unwrap();
        assert_eq!(skills.len(), 0);
    }

    #[test]
    fn test_list_empty_workspace() {
        // Use a path that does not exist — list_skills returns empty vec
        let skills = list_skills("/tmp/nonexistent-workspace-path-abc123".into()).unwrap();
        assert!(skills.is_empty());
    }

    #[test]
    fn test_delete_skill_directory_traversal() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap().to_string();

        // Create a legitimate skill so the traversal target resolves
        create_skill(workspace.clone(), "legit".into(), "domain".into()).unwrap();

        // Attempt to delete using ".." to escape the workspace
        let result = delete_skill(workspace.clone(), "../../../etc".into());
        assert!(result.is_err());

        // The legitimate skill should still exist
        let skills = list_skills(workspace).unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "legit");
    }

    #[test]
    fn test_delete_nonexistent_skill() {
        let dir = tempdir().unwrap();
        let workspace = dir.path().to_str().unwrap().to_string();

        let result = delete_skill(workspace, "no-such-skill".into());
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("not found"));
    }
}
