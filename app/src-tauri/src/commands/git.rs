use git2::{Cred, FetchOptions, RemoteCallbacks, Repository};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CloneResult {
    pub path: String,
    pub created_readme: bool,
    pub created_gitignore: bool,
}

const DEFAULT_README: &str = r#"# Skills

Built with [Skill Builder](https://github.com/hbanerjee/skill-builder).

## Structure

Each skill lives in its own directory under `skills/`:

```
skills/
  my-skill/
    SKILL.md          # Main skill prompt
    references/       # Supporting reference files
    context/          # Research & decision artifacts
```

## Usage

Import a `.skill` file into Skill Builder or copy a skill directory into your Claude Code project.
"#;

const DEFAULT_GITIGNORE: &str = r#"# OS
.DS_Store
Thumbs.db

# Editor
.vscode/
.idea/
*.swp
*.swo

# Skill Builder working files
*.skill
skills/*/context/
"#;

#[tauri::command]
pub async fn clone_repo(
    repo_url: String,
    dest_path: String,
    token: String,
) -> Result<CloneResult, String> {
    let dest = Path::new(&dest_path);

    // If dest already exists and has a .git dir, just pull instead
    if dest.join(".git").exists() {
        return Err("Directory already contains a git repository. Choose a different folder.".into());
    }

    // Create parent directory if needed
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    // Clone with token auth
    let token_clone = token.clone();
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token_clone)
    });

    let mut fetch_opts = FetchOptions::new();
    fetch_opts.remote_callbacks(callbacks);

    let mut builder = git2::build::RepoBuilder::new();
    builder.fetch_options(fetch_opts);

    let repo = builder
        .clone(&repo_url, dest)
        .map_err(|e| format!("Clone failed: {}", e))?;

    // Seed README.md if missing
    let readme_path = dest.join("README.md");
    let created_readme = if !readme_path.exists() {
        fs::write(&readme_path, DEFAULT_README)
            .map_err(|e| format!("Failed to write README.md: {}", e))?;
        true
    } else {
        false
    };

    // Seed .gitignore if missing
    let gitignore_path = dest.join(".gitignore");
    let created_gitignore = if !gitignore_path.exists() {
        fs::write(&gitignore_path, DEFAULT_GITIGNORE)
            .map_err(|e| format!("Failed to write .gitignore: {}", e))?;
        true
    } else {
        false
    };

    // Commit seeded files if any were created
    if created_readme || created_gitignore {
        let mut index = repo.index().map_err(|e| e.to_string())?;

        if created_readme {
            index
                .add_path(Path::new("README.md"))
                .map_err(|e| e.to_string())?;
        }
        if created_gitignore {
            index
                .add_path(Path::new(".gitignore"))
                .map_err(|e| e.to_string())?;
        }

        index.write().map_err(|e| e.to_string())?;
        let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
        let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

        let sig = repo
            .signature()
            .or_else(|_| git2::Signature::now("Skill Builder", "noreply@skill-builder.app"))
            .map_err(|e| e.to_string())?;

        let parent = repo
            .head()
            .ok()
            .and_then(|h| h.peel_to_commit().ok());

        let parents: Vec<&git2::Commit> = parent.iter().collect();

        repo.commit(
            Some("HEAD"),
            &sig,
            &sig,
            "Initialize skill repo with README and .gitignore",
            &tree,
            &parents,
        )
        .map_err(|e| e.to_string())?;

        // Push the commit
        let token_push = token;
        let mut callbacks = RemoteCallbacks::new();
        callbacks.credentials(move |_url, _username, _allowed| {
            Cred::userpass_plaintext("x-access-token", &token_push)
        });

        let mut push_opts = git2::PushOptions::new();
        push_opts.remote_callbacks(callbacks);

        let mut remote = repo
            .find_remote("origin")
            .map_err(|e| e.to_string())?;

        // Determine the current branch name
        let head = repo.head().map_err(|e| e.to_string())?;
        let branch = head
            .shorthand()
            .unwrap_or("main");
        let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

        remote
            .push(&[&refspec], Some(&mut push_opts))
            .map_err(|e| format!("Push failed: {}", e))?;
    }

    Ok(CloneResult {
        path: dest_path,
        created_readme,
        created_gitignore,
    })
}

#[tauri::command]
pub async fn commit_and_push(
    repo_path: String,
    message: String,
    token: String,
) -> Result<String, String> {
    let repo = Repository::open(&repo_path)
        .map_err(|e| format!("Failed to open repo: {}", e))?;

    let mut index = repo.index().map_err(|e| e.to_string())?;

    // Stage all changes (new, modified, deleted)
    index
        .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
        .map_err(|e| e.to_string())?;
    index
        .update_all(["*"].iter(), None)
        .map_err(|e| e.to_string())?;
    index.write().map_err(|e| e.to_string())?;

    // Check if there's anything to commit
    let tree_oid = index.write_tree().map_err(|e| e.to_string())?;
    let tree = repo.find_tree(tree_oid).map_err(|e| e.to_string())?;

    let sig = repo
        .signature()
        .or_else(|_| git2::Signature::now("Skill Builder", "noreply@skill-builder.app"))
        .map_err(|e| e.to_string())?;

    let parent = repo
        .head()
        .ok()
        .and_then(|h| h.peel_to_commit().ok());

    // If there's a parent, check if tree actually changed
    if let Some(ref p) = parent {
        if p.tree_id() == tree_oid {
            return Ok("No changes to commit".into());
        }
    }

    let parents: Vec<&git2::Commit> = parent.iter().collect();

    repo.commit(Some("HEAD"), &sig, &sig, &message, &tree, &parents)
        .map_err(|e| e.to_string())?;

    // Push
    let mut callbacks = RemoteCallbacks::new();
    callbacks.credentials(move |_url, _username, _allowed| {
        Cred::userpass_plaintext("x-access-token", &token)
    });

    let mut push_opts = git2::PushOptions::new();
    push_opts.remote_callbacks(callbacks);

    let mut remote = repo
        .find_remote("origin")
        .map_err(|e| e.to_string())?;

    let head = repo.head().map_err(|e| e.to_string())?;
    let branch = head.shorthand().unwrap_or("main");
    let refspec = format!("refs/heads/{}:refs/heads/{}", branch, branch);

    remote
        .push(&[&refspec], Some(&mut push_opts))
        .map_err(|e| format!("Push failed: {}", e))?;

    Ok("Committed and pushed".into())
}

#[cfg(test)]
mod tests {
    use git2::{Repository, Signature};
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_no_changes_detection() {
        let dir = tempdir().unwrap();
        let repo = Repository::init(dir.path()).unwrap();

        // Create a file and make an initial commit
        let file_path = dir.path().join("hello.txt");
        fs::write(&file_path, "hello world").unwrap();

        let mut index = repo.index().unwrap();
        index
            .add_path(std::path::Path::new("hello.txt"))
            .unwrap();
        index.write().unwrap();
        let tree_oid = index.write_tree().unwrap();
        let tree = repo.find_tree(tree_oid).unwrap();

        let sig = Signature::now("Test", "test@example.com").unwrap();
        repo.commit(Some("HEAD"), &sig, &sig, "initial commit", &tree, &[])
            .unwrap();

        // Now re-stage the same content (no changes) and write a new tree
        let mut index = repo.index().unwrap();
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .unwrap();
        index.write().unwrap();
        let new_tree_oid = index.write_tree().unwrap();

        // Get the parent commit's tree id
        let head = repo.head().unwrap();
        let parent_commit = head.peel_to_commit().unwrap();
        let parent_tree_id = parent_commit.tree_id();

        // The tree OIDs should be equal, meaning "no changes to commit"
        assert_eq!(
            parent_tree_id, new_tree_oid,
            "Tree OIDs should match when there are no changes"
        );
    }
}
