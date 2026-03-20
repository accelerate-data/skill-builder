use std::path::Path;

use git2::{DiffOptions, Repository, Signature, StatusOptions};

use crate::types::SkillCommit;

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
        Repository::open(path)
            .map_err(|e| format!("Failed to open git repo at {}: {}", path.display(), e))
    } else {
        log::debug!("[git] Initializing new repo at {}", path.display());
        let repo = Repository::init(path)
            .map_err(|e| format!("Failed to init git repo at {}: {}", path.display(), e))?;

        // Write .gitignore for the skills output folder
        std::fs::write(path.join(".gitignore"), GITIGNORE_CONTENT)
            .map_err(|e| format!("Failed to write .gitignore: {}", e))?;

        // Stage .gitignore and create initial commit so HEAD exists
        {
            let mut index = repo
                .index()
                .map_err(|e| format!("Failed to get index: {}", e))?;
            index
                .add_path(Path::new(".gitignore"))
                .map_err(|e| format!("Failed to stage .gitignore: {}", e))?;
            index
                .write()
                .map_err(|e| format!("Failed to write index: {}", e))?;
            let tree_id = index
                .write_tree()
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

    // Stage all changes (add + modify + delete), including dotfiles like .skill-builder
    index
        .add_all(["*", ".*"].iter(), git2::IndexAddOption::DEFAULT, None)
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
    let head_commit = repo.head().ok().and_then(|h| h.peel_to_commit().ok());

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

/// Return names of top-level directories that exist on disk but are not in the HEAD tree.
/// Skips dotfile/hidden directories.
pub fn get_untracked_dirs(path: &Path) -> Result<Vec<String>, String> {
    if !path.join(".git").exists() {
        return Ok(vec![]);
    }
    let repo = Repository::open(path).map_err(|e| format!("Failed to open git repo: {}", e))?;

    let head_tree = repo.head().ok().and_then(|h| h.peel_to_tree().ok());

    let entries = std::fs::read_dir(path).map_err(|e| format!("Failed to read dir: {e}"))?;

    let mut untracked = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }

        let is_tracked = head_tree
            .as_ref()
            .map(|tree| tree.get_name(&name).is_some())
            .unwrap_or(false);

        if !is_tracked {
            untracked.push(name);
        }
    }

    Ok(untracked)
}

/// Get commit history for a specific skill (filtered by path prefix).
/// Populates `version` on commits that have a `{skill_name}/vX.Y.Z` tag.
pub fn get_history(
    repo_path: &Path,
    skill_name: &str,
    limit: usize,
) -> Result<Vec<SkillCommit>, String> {
    log::debug!("[git] get_history for '{}' (limit {})", skill_name, limit);
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    // Build tag→commit lookup for this skill's version tags
    let tag_prefix = format!("{}/v", skill_name);
    let mut tag_map = std::collections::HashMap::new();
    if let Ok(tags) = repo.tag_names(Some(&format!("{}/*", skill_name))) {
        for tag_name in tags.iter().flatten() {
            if let Some(version) = tag_name.strip_prefix(&tag_prefix) {
                // Resolve tag to its target commit OID via revparse
                if let Ok(obj) = repo.revparse_single(&format!("refs/tags/{}", tag_name)) {
                    // Peel to commit in case of annotated tags
                    let commit_oid = obj
                        .peel(git2::ObjectType::Commit)
                        .map(|c| c.id())
                        .unwrap_or_else(|_| obj.id());
                    tag_map.insert(commit_oid, version.to_string());
                }
            }
        }
    }

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
                version: tag_map.get(&oid).cloned(),
            });
        }
    }

    log::debug!("[git] Found {} commits for '{}'", commits.len(), skill_name);
    Ok(commits)
}

/// Restore a skill's files to the state at a given commit.
pub fn restore_version(repo_path: &Path, sha: &str, skill_name: &str) -> Result<(), String> {
    log::info!(
        "[git] Restoring '{}' to commit {}",
        skill_name,
        &sha[..8.min(sha.len())]
    );
    let repo = Repository::open(repo_path).map_err(|e| format!("Failed to open repo: {}", e))?;

    let oid = git2::Oid::from_str(sha).map_err(|e| format!("Invalid SHA {}: {}", sha, e))?;
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

    log::info!(
        "[git] Restored '{}' to {}",
        skill_name,
        &sha[..8.min(sha.len())]
    );
    Ok(())
}

// --- Semver helpers ---

/// Parse a semver string "X.Y.Z" into (major, minor, patch).
/// Returns (0, 0, 0) for unparseable strings.
fn parse_semver(version: &str) -> (u32, u32, u32) {
    let parts: Vec<&str> = version.split('.').collect();
    if parts.len() != 3 {
        return (0, 0, 0);
    }
    let major = parts[0].parse::<u32>().unwrap_or(0);
    let minor = parts[1].parse::<u32>().unwrap_or(0);
    let patch = parts[2].parse::<u32>().unwrap_or(0);
    (major, minor, patch)
}

// --- Skill version tagging ---

/// Find the highest existing semver tag for a skill (`<skill-name>/vX.Y.Z`).
/// Returns "0.0.0" if no valid semver tags exist.
pub fn latest_skill_semver(path: &Path, skill_name: &str) -> Result<String, String> {
    log::debug!(
        "[git] latest_skill_semver: skill='{}' repo={}",
        skill_name,
        path.display()
    );
    let repo = Repository::open(path)
        .map_err(|e| format!("Failed to open repo at {}: {}", path.display(), e))?;
    let prefix = format!("{}/v", skill_name);
    let mut best: (u32, u32, u32) = (0, 0, 0);

    repo.tag_names(Some(&format!("{}/*", skill_name)))
        .map_err(|e| format!("Failed to list tags: {}", e))?
        .iter()
        .flatten()
        .for_each(|tag_name| {
            if let Some(suffix) = tag_name.strip_prefix(&prefix) {
                let parsed = parse_semver(suffix);
                // Only accept valid X.Y.Z (all three parts present)
                if suffix.matches('.').count() == 2 && parsed > best {
                    best = parsed;
                }
            }
        });

    let result = format!("{}.{}.{}", best.0, best.1, best.2);
    log::debug!(
        "[git] latest_skill_semver: skill='{}' result=v{}",
        skill_name,
        result
    );
    Ok(result)
}

/// Return the second-highest semver tag for a skill (the version before the latest).
/// Returns `None` if fewer than 2 valid tags exist.
pub fn prior_skill_tag(path: &Path, skill_name: &str) -> Option<String> {
    let repo = Repository::open(path).ok()?;
    let prefix = format!("{}/v", skill_name);
    let mut versions: Vec<(u32, u32, u32, String)> = Vec::new();

    if let Ok(tags) = repo.tag_names(Some(&format!("{}/*", skill_name))) {
        for tag_name in tags.iter().flatten() {
            if let Some(suffix) = tag_name.strip_prefix(&prefix) {
                if suffix.matches('.').count() == 2 {
                    let parsed = parse_semver(suffix);
                    if parsed != (0, 0, 0) {
                        versions.push((parsed.0, parsed.1, parsed.2, tag_name.to_string()));
                    }
                }
            }
        }
    }

    versions.sort_by(|a, b| (b.0, b.1, b.2).cmp(&(a.0, a.1, a.2)));
    if versions.len() >= 2 {
        Some(versions[1].3.clone())
    } else {
        None
    }
}

/// Extract a skill's files at a given tag into `dest_dir`.
/// Uses git2 tree walk to read blobs without touching the working directory.
pub fn extract_skill_at_tag(
    repo_path: &Path,
    skill_name: &str,
    tag_name: &str,
    dest_dir: &Path,
) -> Result<(), String> {
    log::debug!(
        "[git] extract_skill_at_tag: skill='{}' tag='{}' dest={}",
        skill_name,
        tag_name,
        dest_dir.display()
    );
    let repo = Repository::open(repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let reference = repo
        .find_reference(&format!("refs/tags/{}", tag_name))
        .map_err(|e| format!("Tag '{}' not found: {}", tag_name, e))?;
    let commit = reference
        .peel(git2::ObjectType::Commit)
        .map_err(|e| format!("Failed to peel tag '{}' to commit: {}", tag_name, e))?;
    let tree = commit
        .as_commit()
        .ok_or_else(|| format!("Tag '{}' does not point to a commit", tag_name))?
        .tree()
        .map_err(|e| format!("Failed to get tree for tag '{}': {}", tag_name, e))?;

    let prefix = format!("{}/", skill_name);

    // Remove stale destination
    if dest_dir.exists() {
        std::fs::remove_dir_all(dest_dir)
            .map_err(|e| format!("Failed to clean dest dir: {}", e))?;
    }

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
                // Strip the skill_name/ prefix for the destination path
                let relative = &full_path[prefix.len()..];
                let file_path = dest_dir.join(relative);
                if let Some(parent) = file_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&file_path, blob.content());
            }
        }

        git2::TreeWalkResult::Ok
    })
    .map_err(|e| format!("Failed to walk tree: {}", e))?;

    log::info!(
        "[git] Extracted '{}' at tag '{}' to {}",
        skill_name,
        tag_name,
        dest_dir.display()
    );
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

    let parent_tree = commit.parent(0).ok().and_then(|p| p.tree().ok());

    let mut opts = DiffOptions::new();
    opts.pathspec(prefix);

    let diff = repo
        .diff_tree_to_tree(parent_tree.as_ref(), Some(&tree), Some(&mut opts))
        .map_err(|e| format!("Failed to compute diff: {}", e))?;

    Ok(diff.deltas().count() > 0)
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

    #[test]
    fn test_get_untracked_dirs_detects_new_folders() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Commit one skill
        let a_dir = dir.path().join("skill-a");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::write(a_dir.join("SKILL.md"), "# A").unwrap();
        commit_all(dir.path(), "add skill-a").unwrap();

        // Add two new folders without committing
        let b_dir = dir.path().join("skill-b");
        let c_dir = dir.path().join("skill-c");
        std::fs::create_dir_all(&b_dir).unwrap();
        std::fs::create_dir_all(&c_dir).unwrap();
        std::fs::write(b_dir.join("SKILL.md"), "# B").unwrap();
        std::fs::write(c_dir.join("SKILL.md"), "# C").unwrap();

        let mut untracked = get_untracked_dirs(dir.path()).unwrap();
        untracked.sort();
        assert_eq!(untracked, vec!["skill-b", "skill-c"]);
    }

    #[test]
    fn test_get_untracked_dirs_skips_dotfiles() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Add a dotfile directory (should be skipped)
        let hidden = dir.path().join(".claude");
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::write(hidden.join("config.json"), "{}").unwrap();

        let untracked = get_untracked_dirs(dir.path()).unwrap();
        assert!(untracked.is_empty());
    }

    #[test]
    fn test_get_untracked_dirs_empty_when_all_tracked() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        // Commit a skill
        let a_dir = dir.path().join("skill-a");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::write(a_dir.join("SKILL.md"), "# A").unwrap();
        commit_all(dir.path(), "add skill-a").unwrap();

        let untracked = get_untracked_dirs(dir.path()).unwrap();
        assert!(untracked.is_empty());
    }

    // --- latest_skill_semver ---

    /// Helper: create a lightweight tag on HEAD
    fn create_tag(dir: &Path, tag_name: &str) {
        let repo = Repository::open(dir).unwrap();
        let head = repo.head().unwrap().peel(git2::ObjectType::Commit).unwrap();
        repo.tag_lightweight(tag_name, &head, false).unwrap();
    }

    #[test]
    fn test_latest_skill_semver_no_tags() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let version = latest_skill_semver(dir.path(), "my-skill").unwrap();
        assert_eq!(version, "0.0.0");
    }

    #[test]
    fn test_latest_skill_semver_with_tags() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
        commit_all(dir.path(), "v1").unwrap();
        create_tag(dir.path(), "my-skill/v1.0.0");

        std::fs::write(skill_dir.join("SKILL.md"), "# v2").unwrap();
        commit_all(dir.path(), "v2").unwrap();
        create_tag(dir.path(), "my-skill/v1.1.0");

        let version = latest_skill_semver(dir.path(), "my-skill").unwrap();
        assert_eq!(version, "1.1.0");
    }

    #[test]
    fn test_latest_skill_semver_ignores_old_integer_tags() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
        commit_all(dir.path(), "v1").unwrap();
        create_tag(dir.path(), "my-skill/v1");

        let version = latest_skill_semver(dir.path(), "my-skill").unwrap();
        assert_eq!(version, "0.0.0");
    }

    #[test]
    fn test_tags_are_skill_scoped() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let a_dir = dir.path().join("skill-a");
        let b_dir = dir.path().join("skill-b");
        std::fs::create_dir_all(&a_dir).unwrap();
        std::fs::create_dir_all(&b_dir).unwrap();

        std::fs::write(a_dir.join("SKILL.md"), "# A").unwrap();
        std::fs::write(b_dir.join("SKILL.md"), "# B").unwrap();
        commit_all(dir.path(), "both skills").unwrap();
        create_tag(dir.path(), "skill-a/v1.0.0");
        create_tag(dir.path(), "skill-b/v1.0.0");

        assert_eq!(latest_skill_semver(dir.path(), "skill-a").unwrap(), "1.0.0");
        assert_eq!(latest_skill_semver(dir.path(), "skill-b").unwrap(), "1.0.0");

        std::fs::write(a_dir.join("SKILL.md"), "# A v2").unwrap();
        commit_all(dir.path(), "skill-a v2").unwrap();
        create_tag(dir.path(), "skill-a/v2.0.0");

        assert_eq!(latest_skill_semver(dir.path(), "skill-a").unwrap(), "2.0.0");
        assert_eq!(latest_skill_semver(dir.path(), "skill-b").unwrap(), "1.0.0");
    }

    // --- get_history version field ---

    #[test]
    fn test_get_history_populates_version_from_tags() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
        commit_all(dir.path(), "my-skill: created").unwrap();
        create_tag(dir.path(), "my-skill/v1.0.0");

        std::fs::write(skill_dir.join("SKILL.md"), "# v2").unwrap();
        commit_all(dir.path(), "my-skill: updated").unwrap();
        // No tag on second commit

        std::fs::write(skill_dir.join("SKILL.md"), "# v3").unwrap();
        commit_all(dir.path(), "my-skill: refined").unwrap();
        create_tag(dir.path(), "my-skill/v1.1.0");

        let history = get_history(dir.path(), "my-skill", 50).unwrap();
        assert_eq!(history.len(), 3);

        // Find commits by message and verify version tags
        let created = history.iter().find(|c| c.message.contains("created")).unwrap();
        let updated = history.iter().find(|c| c.message.contains("updated")).unwrap();
        let refined = history.iter().find(|c| c.message.contains("refined")).unwrap();

        assert_eq!(created.version.as_deref(), Some("1.0.0"));
        assert_eq!(updated.version, None);
        assert_eq!(refined.version.as_deref(), Some("1.1.0"));
    }

    // --- prior_skill_tag ---

    #[test]
    fn test_prior_skill_tag_returns_second_highest() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
        commit_all(dir.path(), "v1").unwrap();
        create_tag(dir.path(), "my-skill/v1.0.0");

        std::fs::write(skill_dir.join("SKILL.md"), "# v2").unwrap();
        commit_all(dir.path(), "v2").unwrap();
        create_tag(dir.path(), "my-skill/v1.1.0");

        std::fs::write(skill_dir.join("SKILL.md"), "# v3").unwrap();
        commit_all(dir.path(), "v3").unwrap();
        create_tag(dir.path(), "my-skill/v2.0.0");

        let prior = prior_skill_tag(dir.path(), "my-skill");
        assert_eq!(prior.as_deref(), Some("my-skill/v1.1.0"));
    }

    #[test]
    fn test_prior_skill_tag_none_for_single_tag() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# v1").unwrap();
        commit_all(dir.path(), "v1").unwrap();
        create_tag(dir.path(), "my-skill/v1.0.0");

        assert!(prior_skill_tag(dir.path(), "my-skill").is_none());
    }

    #[test]
    fn test_prior_skill_tag_none_for_no_tags() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        assert!(prior_skill_tag(dir.path(), "my-skill").is_none());
    }

    // --- extract_skill_at_tag ---

    #[test]
    fn test_extract_skill_at_tag() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let skill_dir = dir.path().join("my-skill");
        std::fs::create_dir_all(skill_dir.join("references")).unwrap();
        std::fs::write(skill_dir.join("SKILL.md"), "# V1 content").unwrap();
        std::fs::write(skill_dir.join("references").join("guide.md"), "guide v1").unwrap();
        commit_all(dir.path(), "v1").unwrap();
        create_tag(dir.path(), "my-skill/v1.0.0");

        // Modify files for v2
        std::fs::write(skill_dir.join("SKILL.md"), "# V2 content").unwrap();
        commit_all(dir.path(), "v2").unwrap();
        create_tag(dir.path(), "my-skill/v2.0.0");

        // Extract v1 to a separate directory
        let dest = dir.path().join("snapshot");
        extract_skill_at_tag(dir.path(), "my-skill", "my-skill/v1.0.0", &dest).unwrap();

        // Verify v1 content was extracted
        assert_eq!(
            std::fs::read_to_string(dest.join("SKILL.md")).unwrap(),
            "# V1 content"
        );
        assert_eq!(
            std::fs::read_to_string(dest.join("references").join("guide.md")).unwrap(),
            "guide v1"
        );
    }

    #[test]
    fn test_extract_skill_at_tag_nonexistent_tag() {
        let dir = tempdir().unwrap();
        ensure_repo(dir.path()).unwrap();

        let dest = dir.path().join("snapshot");
        let result = extract_skill_at_tag(dir.path(), "my-skill", "my-skill/v99.0.0", &dest);
        assert!(result.is_err());
    }
}
