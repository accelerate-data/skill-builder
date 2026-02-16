use std::path::Path;

use git2::{DiffOptions, Repository, Signature, StatusOptions};

use crate::types::{FileDiff, SkillCommit, SkillDiff};

/// Standard .gitignore for the skills output folder.
const GITIGNORE_CONTENT: &str = "\
# macOS
.DS_Store
._*

# Windows
Thumbs.db
Desktop.ini

# IDEs
.idea/
.vscode/
*.swp
*.swo
*~

# Temp files
*.tmp
*.bak
";

/// Open an existing repo or initialize a new one at `path`.
pub fn ensure_repo(path: &Path) -> Result<Repository, String> {
    if path.join(".git").exists() {
        log::debug!("[git] Opening existing repo at {}", path.display());
        Repository::open(path).map_err(|e| format!("Failed to open git repo at {}: {}", path.display(), e))
    } else {
        log::debug!("[git] Initializing new repo at {}", path.display());
        let repo =
            Repository::init(path).map_err(|e| format!("Failed to init git repo at {}: {}", path.display(), e))?;

        // Write .gitignore for the skills output folder
        std::fs::write(path.join(".gitignore"), GITIGNORE_CONTENT)
            .map_err(|e| format!("Failed to write .gitignore: {}", e))?;

        // Stage .gitignore and create initial commit so HEAD exists
        {
            let mut index = repo.index()
                .map_err(|e| format!("Failed to get index: {}", e))?;
            index.add_path(Path::new(".gitignore"))
                .map_err(|e| format!("Failed to stage .gitignore: {}", e))?;
            index.write()
                .map_err(|e| format!("Failed to write index: {}", e))?;
            let tree_id = index.write_tree()
                .map_err(|e| format!("Failed to write initial tree: {}", e))?;
            let tree = repo
                .find_tree(tree_id)
                .map_err(|e| format!("Failed to find initial tree: {}", e))?;
            let sig = default_signature(&repo)?;
            repo.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])
                .map_err(|e| format!("Failed to create initial commit: {}", e))?;
        }

        log::debug!("[git] Created initial commit with .gitignore");
        Ok(repo)
    }
}

/// Stage all changes and commit. Returns the commit SHA, or Ok(None) if nothing to commit.
pub fn commit_all(path: &Path, message: &str) -> Result<Option<String>, String> {
    log::debug!("[git] commit_all at {} — \"{}\"", path.display(), message);
    let repo = ensure_repo(path)?;

    let mut index = repo
        .index()
        .map_err(|e| format!("Failed to get index: {}", e))?;

    // Stage all changes (add + modify + delete)
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| format!("Failed to stage files: {}", e))?;

    // Also remove deleted files from the index
    let mut opts = StatusOptions::new();
    opts.include_untracked(false);
    let statuses = repo
        .statuses(Some(&mut opts))
        .map_err(|e| format!("Failed to get statuses: {}", e))?;
    for entry in statuses.iter() {
        if entry.status().contains(git2::Status::WT_DELETED) {
            if let Some(p) = entry.path() {
                let _ = index.remove_path(Path::new(p));
            }
        }
    }

    index
        .write()
        .map_err(|e| format!("Failed to write index: {}", e))?;

    let tree_id = index
        .write_tree()
        .map_err(|e| format!("Failed to write tree: {}", e))?;
    let tree = repo
        .find_tree(tree_id)
        .map_err(|e| format!("Failed to find tree: {}", e))?;

    // Check if there are actual changes vs HEAD
    let head_commit = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    if let Some(ref parent) = head_commit {
        let parent_tree = parent
            .tree()
            .map_err(|e| format!("Failed to get parent tree: {}", e))?;
        let diff = repo
            .diff_tree_to_tree(Some(&parent_tree), Some(&tree), None)
            .map_err(|e| format!("Failed to compute diff: {}", e))?;
        if diff.deltas().count() == 0 {
            log::debug!("[git] No changes to commit — skipping");
            return Ok(None); // Nothing changed
        }
    }

    let sig = default_signature(&repo)?;
    let parents: Vec<&git2::Commit> = head_commit.as_ref().into_iter().collect();
    let oid = repo
        .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
        .map_err(|e| format!("Failed to commit: {}", e))?;

    log::info!("[git] Committed: {} ({})", message, &oid.to_string()[..8]);
    Ok(Some(oid.to_string()))
}

/// Get commit history for a specific skill (filtered by path prefix).
pub fn get_history(
    repo_path: &Path,
    skill_name: &str,
    limit: usize,
) -> Result<Vec<SkillCommit>, String> {
    log::debug!("[git] get_history for '{}' (limit {})", skill_name, limit);
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Failed to create revwalk: {}", e))?;
    revwalk
        .push_head()
        .map_err(|e| format!("Failed to push HEAD: {}", e))?;
    revwalk.set_sorting(git2::Sort::TIME).ok();

    let prefix = format!("{}/", skill_name);
    let mut commits = Vec::new();

    for oid_result in revwalk {
        if commits.len() >= limit {
            break;
        }
        let oid = oid_result.map_err(|e| format!("Revwalk error: {}", e))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Failed to find commit {}: {}", oid, e))?;

        // Check if this commit touches files under skill_name/
        if commit_touches_path(&repo, &commit, &prefix)? {
            let timestamp = chrono::DateTime::from_timestamp(commit.time().seconds(), 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default();

            commits.push(SkillCommit {
                sha: oid.to_string(),
                message: commit.message().unwrap_or("").to_string(),
                timestamp,
            });
        }
    }

    log::debug!("[git] Found {} commits for '{}'", commits.len(), skill_name);
    Ok(commits)
}

/// Get diff between two commits, filtered to a specific skill's files.
pub fn get_diff(
    repo_path: &Path,
    sha_a: &str,
    sha_b: &str,
    skill_name: &str,
) -> Result<SkillDiff, String> {
    log::debug!("[git] get_diff for '{}': {}..{}", skill_name, &sha_a[..8.min(sha_a.len())], &sha_b[..8.min(sha_b.len())]);
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let oid_a = git2::Oid::from_str(sha_a)
        .map_err(|e| format!("Invalid SHA {}: {}", sha_a, e))?;
    let oid_b = git2::Oid::from_str(sha_b)
        .map_err(|e| format!("Invalid SHA {}: {}", sha_b, e))?;

    let commit_a = repo
        .find_commit(oid_a)
        .map_err(|e| format!("Commit {} not found: {}", sha_a, e))?;
    let commit_b = repo
        .find_commit(oid_b)
        .map_err(|e| format!("Commit {} not found: {}", sha_b, e))?;

    let tree_a = commit_a
        .tree()
        .map_err(|e| format!("Failed to get tree for {}: {}", sha_a, e))?;
    let tree_b = commit_b
        .tree()
        .map_err(|e| format!("Failed to get tree for {}: {}", sha_b, e))?;

    let prefix = format!("{}/", skill_name);
    let mut opts = DiffOptions::new();
    opts.pathspec(&prefix);

    let diff = repo
        .diff_tree_to_tree(Some(&tree_a), Some(&tree_b), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    let mut files = Vec::new();
    diff.foreach(
        &mut |delta, _progress| {
            let path = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            let status = match delta.status() {
                git2::Delta::Added => "added",
                git2::Delta::Deleted => "deleted",
                git2::Delta::Modified => "modified",
                git2::Delta::Renamed => "modified",
                _ => "modified",
            };

            // Read file content from each tree
            let old_content = read_blob_content(&repo, &tree_a, &path);
            let new_content = read_blob_content(&repo, &tree_b, &path);

            files.push(FileDiff {
                path,
                status: status.to_string(),
                old_content,
                new_content,
            });
            true
        },
        None,
        None,
        None,
    )
    .map_err(|e| format!("Failed to iterate diff: {}", e))?;

    Ok(SkillDiff { files })
}

/// Restore a skill's files to the state at a given commit.
pub fn restore_version(
    repo_path: &Path,
    sha: &str,
    skill_name: &str,
) -> Result<(), String> {
    log::info!("[git] Restoring '{}' to commit {}", skill_name, &sha[..8.min(sha.len())]);
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let oid = git2::Oid::from_str(sha)
        .map_err(|e| format!("Invalid SHA {}: {}", sha, e))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Commit {} not found: {}", sha, e))?;
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree for {}: {}", sha, e))?;

    let prefix = format!("{}/", skill_name);
    let skill_dir = repo_path.join(skill_name);

    // First, remove current skill files (except .git-related)
    if skill_dir.exists() {
        remove_dir_contents(&skill_dir)?;
    }

    // Then restore files from the commit's tree
    tree.walk(git2::TreeWalkMode::PreOrder, |dir, entry| {
        let full_path = if dir.is_empty() {
            entry.name().unwrap_or("").to_string()
        } else {
            format!("{}{}", dir, entry.name().unwrap_or(""))
        };

        if !full_path.starts_with(&prefix) {
            return git2::TreeWalkResult::Ok;
        }

        if let Some(git2::ObjectType::Blob) = entry.kind() {
            if let Ok(blob) = repo.find_blob(entry.id()) {
                let file_path = repo_path.join(&full_path);
                if let Some(parent) = file_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&file_path, blob.content());
            }
        }

        git2::TreeWalkResult::Ok
    })
    .map_err(|e| format!("Failed to walk tree: {}", e))?;

    log::info!("[git] Restored '{}' to {}", skill_name, &sha[..8.min(sha.len())]);
    Ok(())
}

// --- Helpers ---

fn default_signature(repo: &Repository) -> Result<Signature<'static>, String> {
    // Try repo config first, fall back to a generic signature
    repo.signature()
        .or_else(|_| Signature::now("Skill Builder", "noreply@skillbuilder.local"))
        .map_err(|e| format!("Failed to create signature: {}", e))
}

/// Check if a commit touches any file under the given path prefix.
fn commit_touches_path(
    repo: &Repository,
    commit: &git2::Commit,
    prefix: &str,
) -> Result<bool, String> {
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {}", e))?;

    let parent_tree = commit
        .parent(0)
        .ok()
        .and_then(|p| p.tree().ok());

    let mut opts = DiffOptions::new();
    opts.pathspec(prefix);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    Ok(diff.deltas().count() > 0)
}

/// Read blob content from a tree by path (returns None if not found or binary).
fn read_blob_content(repo: &Repository, tree: &git2::Tree, path: &str) -> Option<String> {
    let entry = tree.get_path(Path::new(path)).ok()?;
    let blob = repo.find_blob(entry.id()).ok()?;
    if blob.is_binary() {
        return None;
    }
    Some(String::from_utf8_lossy(blob.content()).to_string())
}

/// Remove all files and subdirectories inside a directory (but not the directory itself).
fn remove_dir_contents(dir: &Path) -> Result<(), String> {
    if !dir.exists() {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir).map_err(|e| format!("Failed to read dir: {}", e))? {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.is_dir() {
            std::fs::remove_dir_all(&path)
                .map_err(|e| format!("Failed to remove dir {}: {}", path.display(), e))?;
        } else {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove file {}: {}", path.display(), e))?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_ensure_repo_creates_new() {
        let dir = tempdir().unwrap();
        let repo = ensure_repo(dir.path()).unwrap();
        assert!(!repo.is_bare());
        assert!(dir.path().join(".git").exists());

        // HEAD should exist with initial commit
        let head = repo.head().unwrap();
        assert!(head.peel_to_commit().is_ok());

        // .gitignore should be created and committed
        let gitignore = dir.path().join(".gitignore");
        assert!(gitignore.exists());
        let content = std::fs::read_to_string(&gitignore).unwrap();
        assert!(content.contains(".DS_Store"));
        assert!(content.contains("Thumbs.db"));
        assert!(content.contains(".idea/"));
    }

    #[test]
    fn test_ensure_repo_opens_existing() {
        let dir = tempdir().unwrap();
        let _repo1 = ensure_repo(dir.path()).unwrap();
        let repo2 = ensure_repo(dir.path()).unwrap();
        assert!(!repo2.is_bare());
    }

    #[test]
    fn test_commit_all_with_changes() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Create a file
        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("context")).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# My Skill").unwrap();

        let sha = commit_all(dir.path(), "my-skill: created").unwrap();
        assert!(sha.is_some());
        assert_eq!(sha.as_ref().unwrap().len(), 40); // SHA hex length
    }

    #[test]
    fn test_commit_all_no_changes() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let sha = commit_all(dir.path(), "nothing changed").unwrap();
        assert!(sha.is_none());
    }

    #[test]
    fn test_commit_all_tracks_deletions() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Create and commit a file
        let file = dir.path().join("my-skill").join("SKILL.md");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "# Skill").unwrap();
        commit_all(dir.path(), "add").unwrap();

        // Delete the file and commit
        std::fs::remove_file(&file).unwrap();
        let sha = commit_all(dir.path(), "delete").unwrap();
        assert!(sha.is_some());
    }

    #[test]
    fn test_get_history_filters_by_skill() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Create skill-a
        let a_dir = dir.path().join("skill-a");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::write(a_dir.join("SKILL.md"), "# A").unwrap();
        commit_all(dir.path(), "skill-a: created").unwrap();

        // Create skill-b
        let b_dir = dir.path().join("skill-b");
        std::fs::create_dir_all(&b_dir).unwrap();
        std::fs::write(b_dir.join("SKILL.md"), "# B").unwrap();
        commit_all(dir.path(), "skill-b: created").unwrap();

        // Modify skill-a
        std::fs::write(a_dir.join("SKILL.md"), "# A v2").unwrap();
        commit_all(dir.path(), "skill-a: step 5 completed").unwrap();

        // History for skill-a should have 2 commits
        let history_a = get_history(dir.path(), "skill-a", 50).unwrap();
        assert_eq!(history_a.len(), 2);
        assert_eq!(history_a[0].message, "skill-a: step 5 completed");
        assert_eq!(history_a[1].message, "skill-a: created");

        // History for skill-b should have 1 commit
        let history_b = get_history(dir.path(), "skill-b", 50).unwrap();
        assert_eq!(history_b.len(), 1);
        assert_eq!(history_b[0].message, "skill-b: created");
    }

    #[test]
    fn test_get_history_respects_limit() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        for i in 0..5 {
            std::fs::write(skill_dir.join("SKILL.md"), format!("v{}", i)).unwrap();
            commit_all(dir.path(), &format!("my-skill: step {}", i)).unwrap();
        }

        let history = get_history(dir.path(), "my-skill", 3).unwrap();
        assert_eq!(history.len(), 3);
    }

    #[test]
    fn test_get_diff_between_commits() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        // First commit
        std::fs::write(skill_dir.join("SKILL.md"), "# V1").unwrap();
        let sha_a = commit_all(dir.path(), "v1").unwrap().unwrap();

        // Second commit: modify + add
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();
        std::fs::write(skill_dir.join("references").join("guide.md"), "guide").unwrap();
        let sha_b = commit_all(dir.path(), "v2").unwrap().unwrap();

        let diff = get_diff(dir.path(), &sha_a, &sha_b, "my-skill").unwrap();
        assert_eq!(diff.files.len(), 2);

        let skill_diff = diff.files.iter().find(|f| f.path == "my-skill/SKILL.md").unwrap();
        assert_eq!(skill_diff.status, "modified");
        assert_eq!(skill_diff.old_content.as_deref(), Some("# V1"));
        assert_eq!(skill_diff.new_content.as_deref(), Some("# V2"));

        let guide_diff = diff
            .files
            .iter()
            .find(|f| f.path == "my-skill/references/guide.md")
            .unwrap();
        assert_eq!(guide_diff.status, "added");
    }

    #[test]
    fn test_restore_version() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();

        // V1: SKILL.md + ref
        std::fs::write(skill_dir.join("SKILL.md"), "# V1").unwrap();
        std::fs::write(skill_dir.join("references").join("guide.md"), "guide v1").unwrap();
        let sha_v1 = commit_all(dir.path(), "v1").unwrap().unwrap();

        // V2: modified SKILL.md, deleted ref, added new file
        std::fs::write(skill_dir.join("SKILL.md"), "# V2").unwrap();
        std::fs::remove_file(skill_dir.join("references").join("guide.md")).unwrap();
        std::fs::write(skill_dir.join("new-file.md"), "new").unwrap();
        commit_all(dir.path(), "v2").unwrap();

        // Current state is V2
        assert_eq!(
            std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap(),
            "# V2"
        );
        assert!(skill_dir.join("new-file.md").exists());
        assert!(!skill_dir.join("references").join("guide.md").exists());

        // Restore to V1
        restore_version(dir.path(), &sha_v1, "my-skill").unwrap();

        assert_eq!(
            std::fs::read_to_string(skill_dir.join("SKILL.md")).unwrap(),
            "# V1"
        );
        assert_eq!(
            std::fs::read_to_string(skill_dir.join("references").join("guide.md")).unwrap(),
            "guide v1"
        );
        // new-file.md should be gone (removed by restore)
        assert!(!skill_dir.join("new-file.md").exists());
    }

    #[test]
    fn test_corrupted_repo_handling() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Corrupt the repo by deleting HEAD
        std::fs::remove_file(dir.path().join(".git").join("HEAD")).unwrap();

        // ensure_repo should fail gracefully
        let result = ensure_repo(dir.path());
        assert!(result.is_err());
    }

    #[test]
    fn test_get_history_empty_repo() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // No skill files committed — only initial empty commit
        let history = get_history(dir.path(), "nonexistent-skill", 50).unwrap();
        assert!(history.is_empty());
    }

    #[test]
    fn test_commit_all_multiple_skills() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Create two skills at once
        let a_dir = dir.path().join("skill-a");
        let b_dir = dir.path().join("skill-b");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::create_dir_all(&b_dir).unwrap();
        std::fs::write(a_dir.join("SKILL.md"), "# A").unwrap();
        std::fs::write(b_dir.join("SKILL.md"), "# B").unwrap();

        let sha = commit_all(dir.path(), "batch: two skills created").unwrap();
        assert!(sha.is_some());

        // Both should show up in repo
        let repo = Repository::open(dir.path()).unwrap();
        let head = repo.head().unwrap().peel_to_commit().unwrap();
        let tree = head.tree().unwrap();
        assert!(tree.get_path(Path::new("skill-a/SKILL.md")).is_ok());
        assert!(tree.get_path(Path::new("skill-b/SKILL.md")).is_ok());
    }
}
