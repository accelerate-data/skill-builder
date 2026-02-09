use crate::types::SkillFileEntry;
use std::fs;
use std::path::Path;

#[tauri::command]
pub fn list_skill_files(
    workspace_path: String,
    skill_name: String,
) -> Result<Vec<SkillFileEntry>, String> {
    let skill_dir = Path::new(&workspace_path).join(&skill_name);
    if !skill_dir.exists() {
        return Ok(vec![]);
    }

    let mut entries = Vec::new();
    collect_entries(&skill_dir, &skill_dir, &mut entries)?;
    entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(entries)
}

fn collect_entries(
    base: &Path,
    current: &Path,
    entries: &mut Vec<SkillFileEntry>,
) -> Result<(), String> {
    let dir_entries = fs::read_dir(current).map_err(|e| e.to_string())?;
    for entry in dir_entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let metadata = entry.metadata().map_err(|e| e.to_string())?;

        let relative = path
            .strip_prefix(base)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .to_string();

        let absolute = fs::canonicalize(&path)
            .unwrap_or_else(|_| path.clone())
            .to_string_lossy()
            .to_string();

        let name = entry.file_name().to_string_lossy().to_string();
        let is_directory = metadata.is_dir();
        let is_readonly = relative == "workflow.md";
        let size_bytes = if is_directory { 0 } else { metadata.len() };

        entries.push(SkillFileEntry {
            name,
            relative_path: relative,
            absolute_path: absolute,
            is_directory,
            is_readonly,
            size_bytes,
        });

        if is_directory {
            collect_entries(base, &path, entries)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub fn read_file(file_path: String) -> Result<String, String> {
    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn setup_skill_dir(base: &Path) {
        let skill = base.join("my-skill");
        fs::create_dir_all(skill.join("context")).unwrap();
        fs::create_dir_all(skill.join("skill").join("references")).unwrap();
        fs::write(skill.join("skill").join("SKILL.md"), "# My Skill").unwrap();
        fs::write(skill.join("workflow.md"), "## Workflow State").unwrap();
        fs::write(skill.join("skill").join("references").join("ref1.md"), "# Ref 1").unwrap();
        fs::write(
            skill.join("context").join("clarifications.md"),
            "# Clarifications",
        )
        .unwrap();
    }

    #[test]
    fn test_list_skill_files_returns_all_entries() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let entries = list_skill_files(
            dir.path().to_str().unwrap().to_string(),
            "my-skill".to_string(),
        )
        .unwrap();

        // Should have: workflow.md, context/, context/clarifications.md,
        //              skill/, skill/SKILL.md, skill/references/, skill/references/ref1.md
        assert_eq!(entries.len(), 7);

        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        assert!(paths.contains(&"skill/SKILL.md"));
        assert!(paths.contains(&"workflow.md"));
        assert!(paths.contains(&"context"));
        assert!(paths.contains(&"context/clarifications.md"));
        assert!(paths.contains(&"skill"));
        assert!(paths.contains(&"skill/references"));
        assert!(paths.contains(&"skill/references/ref1.md"));
    }

    #[test]
    fn test_list_skill_files_sorted_by_relative_path() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let entries = list_skill_files(
            dir.path().to_str().unwrap().to_string(),
            "my-skill".to_string(),
        )
        .unwrap();

        let paths: Vec<&str> = entries.iter().map(|e| e.relative_path.as_str()).collect();
        let mut sorted = paths.clone();
        sorted.sort();
        assert_eq!(paths, sorted);
    }

    #[test]
    fn test_only_workflow_md_is_readonly() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let entries = list_skill_files(
            dir.path().to_str().unwrap().to_string(),
            "my-skill".to_string(),
        )
        .unwrap();

        for entry in &entries {
            if entry.relative_path == "workflow.md" {
                assert!(
                    entry.is_readonly,
                    "workflow.md should be readonly",
                );
            } else {
                assert!(
                    !entry.is_readonly,
                    "{} should be editable",
                    entry.relative_path
                );
            }
        }
    }

    #[test]
    fn test_directory_entries() {
        let dir = tempdir().unwrap();
        setup_skill_dir(dir.path());

        let entries = list_skill_files(
            dir.path().to_str().unwrap().to_string(),
            "my-skill".to_string(),
        )
        .unwrap();

        let context_entry = entries
            .iter()
            .find(|e| e.relative_path == "context")
            .unwrap();
        assert!(context_entry.is_directory);
        assert_eq!(context_entry.size_bytes, 0);

        let skill_md = entries
            .iter()
            .find(|e| e.relative_path == "skill/SKILL.md")
            .unwrap();
        assert!(!skill_md.is_directory);
        assert!(skill_md.size_bytes > 0);
    }

    #[test]
    fn test_nonexistent_skill_returns_empty() {
        let dir = tempdir().unwrap();
        let entries = list_skill_files(
            dir.path().to_str().unwrap().to_string(),
            "nonexistent".to_string(),
        )
        .unwrap();
        assert!(entries.is_empty());
    }

    #[test]
    fn test_read_file_success() {
        let dir = tempdir().unwrap();
        let file = dir.path().join("test.txt");
        fs::write(&file, "hello world").unwrap();

        let content = read_file(file.to_str().unwrap().to_string()).unwrap();
        assert_eq!(content, "hello world");
    }

    #[test]
    fn test_read_file_not_found() {
        let result = read_file("/tmp/nonexistent-file-abc123xyz".to_string());
        assert!(result.is_err());
    }
}
