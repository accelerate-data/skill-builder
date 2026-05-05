use sha2::Digest;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// Per-workspace SHA-gated deployment cache state.
///
/// Tracks two tiers:
/// - `source_sha`: SHA-256 over `agent-sources/workspace/{agents,skills}/` at
///   the time of the last copy from source → `<workspace>/.agents/`.
/// - `per_skill_sha`: SHA-256 of `<workspace>/.agents/` at the time of the
///   last copy from workspace root → `<workspace>/<plugin>/<skill>/.agents/`.
///   Keyed by absolute skill_dir path.
#[derive(Default, Debug, Clone)]
struct WorkspaceDeployCache {
    /// SHA over the source dirs at the last successful tier-1 copy.
    /// `None` until the first call for this workspace.
    source_sha: Option<String>,
    /// SHA of `<workspace>/.agents/` per skill_dir at last successful tier-2 copy.
    per_skill_sha: HashMap<String, String>,
}

/// Session-scoped per-workspace deployment cache. Replaces the older
/// `COPIED_WORKSPACES` boolean cache: instead of a one-shot "copied" flag,
/// each workspace now tracks SHA-256 fingerprints so source edits during
/// development are picked up on the next dispatch without restart.
static DEPLOY_CACHE: OnceLock<Mutex<HashMap<String, WorkspaceDeployCache>>> = OnceLock::new();

fn deploy_cache() -> &'static Mutex<HashMap<String, WorkspaceDeployCache>> {
    DEPLOY_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Compute a deterministic SHA-256 over the union of files reachable from
/// `roots`, walked in sorted order. Each file contributes its relative-by-walk
/// path (lossy stringified), a NUL separator, and its raw bytes.
///
/// Missing roots are treated as empty (skipped silently). This makes the hash
/// robust to the case where `agent-sources/workspace/agents` exists but
/// `agent-sources/workspace/skills` does not, etc.
fn compute_dir_sha(roots: &[&Path]) -> Result<String, String> {
    let mut paths: Vec<PathBuf> = Vec::new();
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
            let entry = entry
                .map_err(|e| format!("walkdir error under {}: {}", root.display(), e))?;
            if entry.file_type().is_file() {
                paths.push(entry.into_path());
            }
        }
    }
    paths.sort();
    let mut hasher = sha2::Sha256::new();
    for path in paths {
        hasher.update(path.to_string_lossy().as_bytes());
        hasher.update(b"\0");
        let bytes = std::fs::read(&path)
            .map_err(|e| format!("read {}: {}", path.display(), e))?;
        hasher.update(&bytes);
    }
    Ok(hex::encode(hasher.finalize()))
}

/// Resolve the path to a bundled agent-sources subdirectory.
/// In dev mode: `{CARGO_MANIFEST_DIR}/../../agent-sources/{subdir}/`.
/// In production: Tauri resource directory `agent-sources/{subdir}/`.
fn resolve_bundled_agent_sources_subdir(app_handle: &tauri::AppHandle, subdir: &str) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join(subdir));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("agent-sources").join(subdir))
            .unwrap_or_default(),
    }
}

pub fn resolve_bundled_skills_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    resolve_bundled_agent_sources_subdir(app_handle, "skills")
}

/// Resolve the bundled OpenHands workspace agent source directory from the app handle.
/// Returns an empty path when no bundled agents directory exists.
pub(crate) fn resolve_prompt_source_dirs(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let agents_src = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace").join("agents"));

    match agents_src {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("workspace").join("agents"))
                .unwrap_or_default();
            if resource.is_dir() {
                resource
            } else {
                PathBuf::new()
            }
        }
    }
}

fn resolve_workspace_skills_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace").join("skills"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("workspace").join("skills"))
                .unwrap_or_default();
            if resource.is_dir() {
                resource
            } else {
                PathBuf::new()
            }
        }
    }
}

/// Remove a workspace from the session cache so the next
/// `ensure_workspace_prompts*` call will re-deploy OpenHands agent sources.
/// Used by `clear_workspace` after removing legacy artifacts or `.agents/`.
pub fn invalidate_workspace_cache(workspace_path: &str) {
    let mut cache = deploy_cache().lock().unwrap_or_else(|e| e.into_inner());
    cache.remove(workspace_path);
}

/// Copy bundled workflow agent artifacts into workspace skill directories.
/// Creates the directories if they don't exist. Overwrites existing files
/// to keep them in sync with the app version.
///
/// Copies once per workspace per session — prompts are bundled with the app
/// and don't change at runtime.
///
/// File I/O is offloaded to `spawn_blocking` to avoid blocking the tokio runtime.
///
/// Resolution order:
/// 1. Dev mode: repo root from `CARGO_MANIFEST_DIR` (compile-time path)
/// 2. Production: Tauri resource directory (bundled in the app)
pub async fn ensure_workspace_prompts(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    // Extract paths from AppHandle before moving into the blocking closure
    // (AppHandle is !Send so it cannot cross the spawn_blocking boundary)
    let agents_dir = resolve_prompt_source_dirs(app_handle);
    let workspace_skills_dir = resolve_workspace_skills_dir(app_handle);

    if !agents_dir.is_dir() && !workspace_skills_dir.is_dir() {
        return Ok(()); // No sources found anywhere — skip silently
    }

    let workspace = workspace_path.to_string();
    let agents = agents_dir.clone();
    let workspace_skills = workspace_skills_dir.clone();

    let result = tokio::task::spawn_blocking(move || {
        ensure_workspace_prompts_inner(&agents, &workspace_skills, &workspace)
    })
    .await
    .map_err(|e| format!("Prompt copy task failed: {}", e))?;

    if let Err(ref e) = result {
        log::error!(
            "[ensure_workspace_prompts] deploy failed, clearing cache: {}",
            e
        );
        invalidate_workspace_cache(workspace_path);
    }

    result
}

/// Two-tier SHA-gated deploy. Used by both async and sync entry points and is
/// exposed to tests so callers can pass explicit source paths instead of
/// resolving them through `tauri::AppHandle`.
///
/// Tier 1: source dirs → `<workspace>/.agents/`. Fires when the SHA over the
/// source directories differs from the cached `source_sha` for this workspace.
/// On invalidation, the per-skill cache for this workspace is cleared so every
/// skill gets refreshed from the new root.
///
/// Tier 2: `<workspace>/.agents/` → `<workspace>/<plugin>/<skill>/.agents/`.
/// Fires per skill_dir when the SHA over the workspace-root `.agents/` differs
/// from the cached `per_skill_sha[skill_dir]`. Skill dirs are discovered fresh
/// on every call so newly created skills get covered.
pub(crate) fn ensure_workspace_prompts_inner(
    agents_src: &Path,
    workspace_skills_src: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    // ---- Tier 1: source → <workspace>/.agents/ ---------------------------
    let current_source_sha = compute_dir_sha(&[agents_src, workspace_skills_src])?;
    let workspace_key = workspace_path.to_string();
    let workspace_root = Path::new(workspace_path);

    let tier_1_changed = {
        let mut cache_lock = deploy_cache().lock().unwrap_or_else(|e| e.into_inner());
        let entry = cache_lock.entry(workspace_key.clone()).or_default();
        let layout_ok = crate::skill_paths::workspace_agent_files_dir(workspace_root).is_dir()
            && crate::skill_paths::workspace_agent_skills_dir(workspace_root).is_dir();
        let changed =
            entry.source_sha.as_deref() != Some(current_source_sha.as_str()) || !layout_ok;
        if changed {
            // Optimistically update so a concurrent caller sees the new SHA
            // and skips the redundant copy. Cleared by `invalidate_workspace_cache`
            // on copy failure (see async wrapper).
            entry.source_sha = Some(current_source_sha.clone());
            // Tier-1 invalidation wipes ALL per-skill SHA entries — every
            // skill is now stale relative to the freshly-rewritten root.
            entry.per_skill_sha.clear();
        }
        changed
    };

    if tier_1_changed && (agents_src.is_dir() || workspace_skills_src.is_dir()) {
        copy_workspace_sources_to_openhands_dir(
            agents_src,
            workspace_skills_src,
            workspace_root,
        )?;
    }

    // ---- Tier 2: <workspace>/.agents/ → per-skill .agents/ ---------------
    let workspace_root_agents_dir = crate::skill_paths::workspace_agent_files_dir(workspace_root);
    let workspace_root_skills_dir = crate::skill_paths::workspace_agent_skills_dir(workspace_root);
    if !workspace_root_agents_dir.is_dir() && !workspace_root_skills_dir.is_dir() {
        return Ok(());
    }

    let current_root_sha =
        compute_dir_sha(&[&workspace_root_agents_dir, &workspace_root_skills_dir])?;

    for skill_dir in discover_workspace_skill_dirs(workspace_root)? {
        let skill_key = skill_dir.to_string_lossy().to_string();
        let needs_copy = {
            let mut cache_lock = deploy_cache().lock().unwrap_or_else(|e| e.into_inner());
            let entry = cache_lock.entry(workspace_key.clone()).or_default();
            let layout_ok = crate::skill_paths::workspace_agent_files_dir(&skill_dir).is_dir()
                && crate::skill_paths::workspace_agent_skills_dir(&skill_dir).is_dir();
            entry
                .per_skill_sha
                .get(&skill_key)
                .map(String::as_str)
                != Some(current_root_sha.as_str())
                || !layout_ok
        };
        if needs_copy {
            copy_workspace_sources_to_openhands_dir(
                &workspace_root_agents_dir,
                &workspace_root_skills_dir,
                &skill_dir,
            )?;
            let mut cache_lock = deploy_cache().lock().unwrap_or_else(|e| e.into_inner());
            let entry = cache_lock.entry(workspace_key.clone()).or_default();
            entry
                .per_skill_sha
                .insert(skill_key, current_root_sha.clone());
        }
    }

    Ok(())
}

/// Synchronous variant of `ensure_workspace_prompts` for callers that cannot be async
/// (e.g. `init_workspace` called from Tauri's synchronous `setup` hook).
/// Uses the same SHA-gated cache to skip redundant copies and to pick up
/// source edits during development without an app restart.
pub fn ensure_workspace_prompts_sync(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    let agents_dir = resolve_prompt_source_dirs(app_handle);
    let workspace_skills_dir = resolve_workspace_skills_dir(app_handle);

    if !agents_dir.is_dir() && !workspace_skills_dir.is_dir() {
        return Ok(());
    }

    ensure_workspace_prompts_inner(&agents_dir, &workspace_skills_dir, workspace_path)
}

/// Re-deploy only the bundled workflow agents/skills under `.agents/`,
/// preserving other workspace contents.
pub fn redeploy_agents(app_handle: &tauri::AppHandle, workspace_path: &str) -> Result<(), String> {
    let agents_dir = resolve_prompt_source_dirs(app_handle);
    let workspace_skills_dir = resolve_workspace_skills_dir(app_handle);
    if agents_dir.is_dir() || workspace_skills_dir.is_dir() {
        copy_workspace_sources_to_openhands_layout(
            &agents_dir,
            &workspace_skills_dir,
            Path::new(workspace_path),
        )?;
    }
    Ok(())
}

fn copy_workspace_sources_to_openhands_layout(
    agents_src: &Path,
    workspace_skills_src: &Path,
    workspace: &Path,
) -> Result<(), String> {
    copy_workspace_sources_to_openhands_dir(agents_src, workspace_skills_src, workspace)?;
    for workspace_skill_dir in discover_workspace_skill_dirs(workspace)? {
        copy_workspace_sources_to_openhands_dir(
            agents_src,
            workspace_skills_src,
            &workspace_skill_dir,
        )?;
    }
    Ok(())
}

fn copy_workspace_sources_to_openhands_dir(
    agents_src: &Path,
    workspace_skills_src: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    copy_workspace_agents_to_openhands_layout(agents_src, target_dir)?;
    copy_workspace_agent_skills_to_openhands_layout(workspace_skills_src, target_dir)?;
    Ok(())
}

fn discover_workspace_skill_dirs(workspace: &Path) -> Result<Vec<PathBuf>, String> {
    if !workspace.is_dir() {
        return Ok(Vec::new());
    }

    let mut dirs = Vec::new();
    for plugin_entry in
        std::fs::read_dir(workspace).map_err(|e| format!("Failed to read workspace dir: {}", e))?
    {
        let plugin_entry =
            plugin_entry.map_err(|e| format!("Failed to read workspace entry: {}", e))?;
        let plugin_path = plugin_entry.path();
        if !plugin_path.is_dir() || plugin_entry.file_name().to_string_lossy().starts_with('.') {
            continue;
        }

        let canonical_skills_dir = plugin_path.join("skills");
        if canonical_skills_dir.is_dir() {
            for skill_entry in std::fs::read_dir(&canonical_skills_dir).map_err(|e| {
                format!(
                    "Failed to read workspace plugin skills dir {}: {}",
                    canonical_skills_dir.display(),
                    e
                )
            })? {
                let skill_entry = skill_entry
                    .map_err(|e| format!("Failed to read workspace skill entry: {}", e))?;
                let skill_path = skill_entry.path();
                if skill_path.is_dir()
                    && !skill_entry.file_name().to_string_lossy().starts_with('.')
                {
                    dirs.push(skill_path);
                }
            }
        }

        for skill_entry in std::fs::read_dir(&plugin_path).map_err(|e| {
            format!(
                "Failed to read workspace plugin dir {}: {}",
                plugin_path.display(),
                e
            )
        })? {
            let skill_entry =
                skill_entry.map_err(|e| format!("Failed to read workspace skill entry: {}", e))?;
            let skill_path = skill_entry.path();
            let file_name = skill_entry.file_name().to_string_lossy().to_string();
            if file_name.starts_with('.') || file_name == "skills" || !skill_path.is_dir() {
                continue;
            }
            dirs.push(skill_path);
        }
    }

    dirs.sort();
    dirs.dedup();
    Ok(dirs)
}

fn copy_workspace_agents_to_openhands_layout(
    agents_src: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    let agents_dir = crate::skill_paths::workspace_agent_files_dir(target_dir);
    if agents_dir.is_dir() {
        std::fs::remove_dir_all(&agents_dir)
            .map_err(|e| format!("Failed to clear .agents/agents dir: {}", e))?;
    }
    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create .agents/agents dir: {}", e))?;

    if !agents_src.is_dir() {
        return Ok(());
    }

    for agent_entry in
        std::fs::read_dir(agents_src).map_err(|e| format!("Failed to read agents dir: {}", e))?
    {
        let agent_entry = agent_entry.map_err(|e| format!("Failed to read agent entry: {}", e))?;
        let agent_path = agent_entry.path();
        if agent_path.extension().and_then(|e| e.to_str()) != Some("md") {
            continue;
        }
        let dest = agents_dir.join(agent_entry.file_name());
        std::fs::copy(&agent_path, &dest).map_err(|e| {
            format!(
                "Failed to copy {} to .agents/agents: {}",
                agent_path.display(),
                e
            )
        })?;
    }
    Ok(())
}

fn copy_workspace_agent_skills_to_openhands_layout(
    workspace_skills_src: &Path,
    target_dir: &Path,
) -> Result<(), String> {
    let skills_dir = crate::skill_paths::workspace_agent_skills_dir(target_dir);
    if skills_dir.is_dir() {
        std::fs::remove_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to clear .agents/skills dir: {}", e))?;
    }
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create .agents/skills dir: {}", e))?;

    if workspace_skills_src.is_dir() {
        for skill_entry in std::fs::read_dir(workspace_skills_src)
            .map_err(|e| format!("Failed to read workspace skills dir: {}", e))?
        {
            let skill_entry =
                skill_entry.map_err(|e| format!("Failed to read workspace skill entry: {}", e))?;
            let skill_path = skill_entry.path();
            if !skill_path.is_dir() {
                continue;
            }
            copy_directory_recursive(&skill_path, &skills_dir.join(skill_entry.file_name()))?;
        }
    }

    Ok(())
}

/// Recursively copy a directory and all its contents (delegates to shared fs_utils).
pub(crate) fn copy_directory_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    crate::fs_utils::copy_dir_recursive(src, dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_file(path: &Path, contents: &str) {
        std::fs::create_dir_all(path.parent().expect("test path has parent")).unwrap();
        std::fs::write(path, contents).unwrap();
    }

    fn bundled_workspace_agents_fixture(root: &Path) -> PathBuf {
        let agents = root.join("sources").join("workspace").join("agents");
        write_file(
            &agents.join("skill-creator.md"),
            "---\nname: skill-creator\n---\nCreate and validate skills.",
        );
        agents
    }

    fn bundled_workspace_skills_fixture(root: &Path) -> PathBuf {
        let skills = root.join("sources").join("workspace").join("skills");
        write_file(
            &skills.join("researching-skill-requirements/SKILL.md"),
            "# Researching Skill Requirements",
        );
        write_file(
            &skills.join("creating-skills/SKILL.md"),
            "# Creating Skills",
        );
        skills
    }

    #[test]
    fn copy_workspace_sources_populates_openhands_layout_for_root_and_discovered_skill_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let agents = bundled_workspace_agents_fixture(tmp.path());
        let skills = bundled_workspace_skills_fixture(tmp.path());
        let workspace = tmp.path().join("workspace");
        let skill_dir = workspace.join("plugin/new-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        copy_workspace_sources_to_openhands_layout(&agents, &skills, &workspace).unwrap();

        assert!(workspace.join(".agents/agents/skill-creator.md").is_file());
        assert!(workspace
            .join(".agents/skills/researching-skill-requirements/SKILL.md")
            .is_file());
        assert!(workspace
            .join(".agents/skills/creating-skills/SKILL.md")
            .is_file());
        assert!(skill_dir.join(".agents/agents/skill-creator.md").is_file());
        assert!(skill_dir
            .join(".agents/skills/researching-skill-requirements/SKILL.md")
            .is_file());
        assert!(skill_dir
            .join(".agents/skills/creating-skills/SKILL.md")
            .is_file());
    }

    // ---- compute_dir_sha tests --------------------------------------------

    #[test]
    fn compute_dir_sha_is_stable_across_calls() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), b"hello").unwrap();
        std::fs::write(dir.path().join("b.md"), b"world").unwrap();
        let sha1 = compute_dir_sha(&[dir.path()]).unwrap();
        let sha2 = compute_dir_sha(&[dir.path()]).unwrap();
        assert_eq!(sha1, sha2, "SHA must be stable across invocations");
    }

    #[test]
    fn compute_dir_sha_changes_when_byte_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), b"hello").unwrap();
        let sha_before = compute_dir_sha(&[dir.path()]).unwrap();
        std::fs::write(dir.path().join("a.md"), b"hellx").unwrap();
        let sha_after = compute_dir_sha(&[dir.path()]).unwrap();
        assert_ne!(sha_before, sha_after, "SHA must reflect content changes");
    }

    #[test]
    fn compute_dir_sha_changes_when_file_added() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), b"hello").unwrap();
        let before = compute_dir_sha(&[dir.path()]).unwrap();
        std::fs::write(dir.path().join("b.md"), b"new").unwrap();
        let after = compute_dir_sha(&[dir.path()]).unwrap();
        assert_ne!(before, after);
    }

    #[test]
    fn compute_dir_sha_changes_when_file_removed() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("a.md"), b"hello").unwrap();
        std::fs::write(dir.path().join("b.md"), b"world").unwrap();
        let before = compute_dir_sha(&[dir.path()]).unwrap();
        std::fs::remove_file(dir.path().join("b.md")).unwrap();
        let after = compute_dir_sha(&[dir.path()]).unwrap();
        assert_ne!(before, after);
    }

    #[test]
    fn compute_dir_sha_handles_missing_dir() {
        let nonexistent = std::path::Path::new("/nonexistent-path-for-test-do-not-create");
        let sha = compute_dir_sha(&[nonexistent]).unwrap();
        let empty_dir = tempfile::tempdir().unwrap();
        let empty_sha = compute_dir_sha(&[empty_dir.path()]).unwrap();
        assert_eq!(
            sha, empty_sha,
            "missing dir and empty dir should hash the same way"
        );
    }

    // ---- two-tier cache tests ---------------------------------------------
    //
    // These exercise `ensure_workspace_prompts_inner` directly with explicit
    // source paths so we don't need a `tauri::AppHandle`.

    /// Build a fresh source tree with one agent .md and one skill SKILL.md.
    /// Returns (agents_dir, skills_dir).
    fn fresh_sources(root: &Path) -> (PathBuf, PathBuf) {
        let agents = root.join("src/agents");
        let skills = root.join("src/skills");
        write_file(&agents.join("skill-creator.md"), "v1");
        write_file(&skills.join("creating-skills/SKILL.md"), "skill v1");
        (agents, skills)
    }

    #[test]
    fn cache_hit_when_source_unchanged_does_not_rewrite() {
        let tmp = tempfile::tempdir().unwrap();
        let (agents, skills) = fresh_sources(tmp.path());
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        invalidate_workspace_cache(&workspace_str);

        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        let deployed = workspace.join(".agents/agents/skill-creator.md");
        assert!(deployed.is_file());
        let mtime_before = std::fs::metadata(&deployed).unwrap().modified().unwrap();

        // Sleep slightly so any rewrite would produce a distinct mtime.
        std::thread::sleep(std::time::Duration::from_millis(20));

        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        let mtime_after = std::fs::metadata(&deployed).unwrap().modified().unwrap();

        assert_eq!(
            mtime_before, mtime_after,
            "cache hit must not rewrite the deployed file"
        );
        invalidate_workspace_cache(&workspace_str);
    }

    #[test]
    fn cache_invalidates_when_source_changes() {
        let tmp = tempfile::tempdir().unwrap();
        let (agents, skills) = fresh_sources(tmp.path());
        let workspace = tmp.path().join("workspace");
        std::fs::create_dir_all(&workspace).unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        invalidate_workspace_cache(&workspace_str);

        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        let deployed = workspace.join(".agents/agents/skill-creator.md");
        assert_eq!(std::fs::read_to_string(&deployed).unwrap(), "v1");

        // Mutate a source byte.
        std::fs::write(agents.join("skill-creator.md"), "v2-updated").unwrap();

        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        assert_eq!(
            std::fs::read_to_string(&deployed).unwrap(),
            "v2-updated",
            "source change must propagate to the deployed file"
        );
        invalidate_workspace_cache(&workspace_str);
    }

    #[test]
    fn tier_1_invalidation_clears_per_skill_cache() {
        let tmp = tempfile::tempdir().unwrap();
        let (agents, skills) = fresh_sources(tmp.path());
        let workspace = tmp.path().join("workspace");
        let skill_dir = workspace.join("plugin/skill-a");
        std::fs::create_dir_all(&skill_dir).unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        invalidate_workspace_cache(&workspace_str);

        // First deploy: tier-1 copies source → root, tier-2 copies root → skill.
        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        let skill_deployed = skill_dir.join(".agents/agents/skill-creator.md");
        assert_eq!(std::fs::read_to_string(&skill_deployed).unwrap(), "v1");

        // Mutate a source byte. Tier-1 SHA changes → per_skill cache wiped →
        // tier-2 must re-copy to skill_dir.
        std::fs::write(agents.join("skill-creator.md"), "v2").unwrap();

        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        assert_eq!(
            std::fs::read_to_string(&skill_deployed).unwrap(),
            "v2",
            "tier-1 invalidation must propagate through tier-2 to every skill"
        );
        invalidate_workspace_cache(&workspace_str);
    }

    #[test]
    fn tier_2_caches_per_skill_after_first_copy() {
        let tmp = tempfile::tempdir().unwrap();
        let (agents, skills) = fresh_sources(tmp.path());
        let workspace = tmp.path().join("workspace");
        let skill_a = workspace.join("plugin/skill-a");
        let skill_b = workspace.join("plugin/skill-b");
        std::fs::create_dir_all(&skill_a).unwrap();
        std::fs::create_dir_all(&skill_b).unwrap();
        let workspace_str = workspace.to_string_lossy().to_string();
        invalidate_workspace_cache(&workspace_str);

        // First deploy: both skills get their .agents/.
        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        let a_file = skill_a.join(".agents/agents/skill-creator.md");
        let b_file = skill_b.join(".agents/agents/skill-creator.md");
        assert!(a_file.is_file());
        assert!(b_file.is_file());
        let a_mtime = std::fs::metadata(&a_file).unwrap().modified().unwrap();
        let b_mtime = std::fs::metadata(&b_file).unwrap().modified().unwrap();

        std::thread::sleep(std::time::Duration::from_millis(20));

        // Second deploy with no changes: per-skill SHAs match → no rewrite.
        ensure_workspace_prompts_inner(&agents, &skills, &workspace_str).unwrap();
        assert_eq!(
            a_mtime,
            std::fs::metadata(&a_file).unwrap().modified().unwrap(),
            "skill-a should not be rewritten when nothing changed"
        );
        assert_eq!(
            b_mtime,
            std::fs::metadata(&b_file).unwrap().modified().unwrap(),
            "skill-b should not be rewritten when nothing changed"
        );
        invalidate_workspace_cache(&workspace_str);
    }
}
