use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Session-scoped set of workspaces whose prompts have already been copied.
/// Prompts are bundled with the app and don't change during a session,
/// so we only need to copy once per workspace.
///
/// **Dev-mode caveat:** In development, prompts are read from the repo root.
/// Edits to `agent-sources/agents/` or `workspace/` while the app is running won't be
/// picked up until the app is restarted.
pub(crate) static COPIED_WORKSPACES: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Public wrapper for `resolve_prompt_source_dirs` — used by `workspace.rs`
/// to pass the bundled CLAUDE.md path into `rebuild_claude_md`.
pub fn resolve_prompt_source_dirs_public(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf) {
    resolve_prompt_source_dirs(app_handle)
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

pub fn resolve_bundled_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    resolve_bundled_agent_sources_subdir(app_handle, "plugins")
}

/// Resolve source paths for agents and workspace CLAUDE.md from the app handle.
/// Returns `(agents_dir, claude_md)` as owned PathBufs. Either may be empty
/// if not found (caller should check `.is_dir()` / `.is_file()` before using).
pub(crate) fn resolve_prompt_source_dirs(app_handle: &tauri::AppHandle) -> (PathBuf, PathBuf) {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let agents_src = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("agents"));
    let claude_md_src = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("workspace").join("CLAUDE.md"));

    let agents_dir = match agents_src {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("agent-sources").join("agents"))
                .unwrap_or_default();
            if resource.is_dir() {
                resource
            } else {
                PathBuf::new()
            }
        }
    };

    let claude_md = match claude_md_src {
        Some(ref p) if p.is_file() => p.clone(),
        _ => {
            let resource = app_handle
                .path()
                .resource_dir()
                .map(|r| r.join("workspace").join("CLAUDE.md"))
                .unwrap_or_default();
            if resource.is_file() {
                resource
            } else {
                PathBuf::new()
            }
        }
    };

    (agents_dir, claude_md)
}

/// Returns true if this workspace has already been initialized this session.
pub(crate) fn workspace_already_copied(workspace_path: &str) -> bool {
    let cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    cache
        .as_ref()
        .is_some_and(|set| set.contains(workspace_path))
}

fn workspace_openhands_layout_complete(workspace_path: &str) -> bool {
    let Ok(skill_dirs) = discover_workspace_skill_dirs(Path::new(workspace_path)) else {
        return false;
    };
    skill_dirs.iter().all(|skill_dir| {
        crate::skill_paths::workspace_agent_files_dir(skill_dir).is_dir()
            && crate::skill_paths::workspace_agent_skills_dir(skill_dir).is_dir()
    })
}

/// Mark a workspace as initialized for this session.
pub(crate) fn mark_workspace_copied(workspace_path: &str) {
    let mut cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    cache
        .get_or_insert_with(HashSet::new)
        .insert(workspace_path.to_string());
}

/// Remove a workspace from the session cache so the next
/// `ensure_workspace_prompts*` call will re-deploy agents and CLAUDE.md.
/// Used by `clear_workspace` after deleting `.claude/`.
pub fn invalidate_workspace_cache(workspace_path: &str) {
    let mut cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(set) = cache.as_mut() {
        set.remove(workspace_path);
    }
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
    // Atomically check-and-mark to prevent TOCTOU races: two concurrent
    // run_workflow_step calls for the same workspace would both pass a
    // separate check, then race on remove_dir_all + create_dir_all inside
    // copy_agents_to_claude_dir.  By marking *before* the copy, the second
    // caller sees the flag and skips.  If the copy fails, we clear the flag
    // so a retry will attempt the copy again.
    {
        let mut cache = COPIED_WORKSPACES.lock().unwrap_or_else(|e| e.into_inner());
        let set = cache.get_or_insert_with(HashSet::new);
        if set.contains(workspace_path) && workspace_openhands_layout_complete(workspace_path) {
            return Ok(());
        }
        set.insert(workspace_path.to_string());
    }

    // Extract paths from AppHandle before moving into the blocking closure
    // (AppHandle is !Send so it cannot cross the spawn_blocking boundary)
    let (agents_dir, claude_md) = resolve_prompt_source_dirs(app_handle);
    let plugins_dir = resolve_bundled_plugins_dir(app_handle);

    if !agents_dir.is_dir() && !claude_md.is_file() && !plugins_dir.is_dir() {
        return Ok(()); // No sources found anywhere — skip silently
    }

    let workspace = workspace_path.to_string();
    let agents = agents_dir.clone();
    let plugins = plugins_dir.clone();
    let cmd = claude_md.clone();

    let result =
        tokio::task::spawn_blocking(move || copy_prompts_sync(&agents, &plugins, &cmd, &workspace))
            .await
            .map_err(|e| format!("Prompt copy task failed: {}", e))?;

    if let Err(ref e) = result {
        // Copy failed — clear the optimistic flag so a retry will re-attempt.
        log::error!(
            "[ensure_workspace_prompts] copy failed, clearing cache: {}",
            e
        );
        invalidate_workspace_cache(workspace_path);
    }

    result
}

/// Synchronous inner copy logic shared by async and sync entry points.
/// Workflow agents use OpenHands' `.agents/` layout under each workspace skill
/// directory. Workspace `CLAUDE.md` and Claude plugin manifests are maintained
/// by non-workflow import/marketplace paths.
pub(crate) fn copy_prompts_sync(
    _agents_dir: &Path,
    plugins_dir: &Path,
    _claude_md: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    if plugins_dir.is_dir() {
        copy_workflow_plugins_to_openhands_layout(plugins_dir, Path::new(workspace_path))?;
    }
    Ok(())
}

/// Synchronous variant of `ensure_workspace_prompts` for callers that cannot be async
/// (e.g. `init_workspace` called from Tauri's synchronous `setup` hook).
/// Uses the same session-scoped cache to skip redundant copies.
pub fn ensure_workspace_prompts_sync(
    app_handle: &tauri::AppHandle,
    workspace_path: &str,
) -> Result<(), String> {
    if workspace_already_copied(workspace_path)
        && workspace_openhands_layout_complete(workspace_path)
    {
        return Ok(());
    }

    let (agents_dir, claude_md) = resolve_prompt_source_dirs(app_handle);
    let plugins_dir = resolve_bundled_plugins_dir(app_handle);

    if !agents_dir.is_dir() && !claude_md.is_file() && !plugins_dir.is_dir() {
        return Ok(());
    }

    copy_prompts_sync(&agents_dir, &plugins_dir, &claude_md, workspace_path)?;
    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Re-deploy only the bundled workflow agents/skills under `.agents/`,
/// preserving other workspace contents.
pub fn redeploy_agents(app_handle: &tauri::AppHandle, workspace_path: &str) -> Result<(), String> {
    let (_agents_dir, _) = resolve_prompt_source_dirs(app_handle);
    let plugins_dir = resolve_bundled_plugins_dir(app_handle);
    if plugins_dir.is_dir() {
        copy_workflow_plugins_to_openhands_layout(&plugins_dir, Path::new(workspace_path))?;
    }
    Ok(())
}

fn copy_workflow_plugins_to_openhands_layout(
    plugins_src: &Path,
    workspace: &Path,
) -> Result<(), String> {
    for workspace_skill_dir in discover_workspace_skill_dirs(workspace)? {
        copy_workflow_agents_to_openhands_layout(plugins_src, &workspace_skill_dir)?;
        copy_workflow_agent_skills_to_openhands_layout(plugins_src, &workspace_skill_dir)?;
    }
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
            if skill_path.is_dir() && !skill_entry.file_name().to_string_lossy().starts_with('.') {
                dirs.push(skill_path);
            }
        }
    }

    dirs.sort();
    Ok(dirs)
}

fn copy_workflow_agents_to_openhands_layout(
    plugins_src: &Path,
    workspace_skill_dir: &Path,
) -> Result<(), String> {
    let agents_dir = crate::skill_paths::workspace_agent_files_dir(workspace_skill_dir);
    if agents_dir.is_dir() {
        std::fs::remove_dir_all(&agents_dir)
            .map_err(|e| format!("Failed to clear .agents/agents dir: {}", e))?;
    }
    std::fs::create_dir_all(&agents_dir)
        .map_err(|e| format!("Failed to create .agents/agents dir: {}", e))?;

    for plugin_entry in
        std::fs::read_dir(plugins_src).map_err(|e| format!("Failed to read plugins dir: {}", e))?
    {
        let plugin_entry =
            plugin_entry.map_err(|e| format!("Failed to read plugins entry: {}", e))?;
        let plugin_agents = plugin_entry.path().join("agents");
        if !plugin_agents.is_dir() {
            continue;
        }

        for agent_entry in std::fs::read_dir(&plugin_agents)
            .map_err(|e| format!("Failed to read plugin agents dir: {}", e))?
        {
            let agent_entry =
                agent_entry.map_err(|e| format!("Failed to read plugin agent entry: {}", e))?;
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
    }
    Ok(())
}

fn copy_workflow_agent_skills_to_openhands_layout(
    plugins_src: &Path,
    workspace_skill_dir: &Path,
) -> Result<(), String> {
    let skills_dir = crate::skill_paths::workspace_agent_skills_dir(workspace_skill_dir);
    if skills_dir.is_dir() {
        std::fs::remove_dir_all(&skills_dir)
            .map_err(|e| format!("Failed to clear .agents/skills dir: {}", e))?;
    }
    std::fs::create_dir_all(&skills_dir)
        .map_err(|e| format!("Failed to create .agents/skills dir: {}", e))?;

    for plugin_entry in
        std::fs::read_dir(plugins_src).map_err(|e| format!("Failed to read plugins dir: {}", e))?
    {
        let plugin_entry =
            plugin_entry.map_err(|e| format!("Failed to read plugins entry: {}", e))?;
        let plugin_skills = plugin_entry.path().join("skills");
        if !plugin_skills.is_dir() {
            continue;
        }

        for skill_entry in std::fs::read_dir(&plugin_skills)
            .map_err(|e| format!("Failed to read plugin skills dir: {}", e))?
        {
            let skill_entry =
                skill_entry.map_err(|e| format!("Failed to read plugin skill entry: {}", e))?;
            let skill_path = skill_entry.path();
            if !skill_path.is_dir() {
                continue;
            }
            copy_directory_recursive(&skill_path, &skills_dir.join(skill_entry.file_name()))?;
        }
    }
    Ok(())
}

/// Copy top-level agent .md files from flat bundled agent source to
/// <workspace>/.claude/agents/.
/// agent-sources/agents/{name}.md → .claude/agents/{name}.md
#[allow(dead_code)]
pub(crate) fn copy_agents_to_claude_dir(
    agents_src: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    let claude_agents_dir = Path::new(workspace_path).join(".claude").join("agents");
    if claude_agents_dir.is_dir() {
        std::fs::remove_dir_all(&claude_agents_dir)
            .map_err(|e| format!("Failed to clear .claude/agents dir: {}", e))?;
    }
    std::fs::create_dir_all(&claude_agents_dir)
        .map_err(|e| format!("Failed to create .claude/agents dir: {}", e))?;

    let entries =
        std::fs::read_dir(agents_src).map_err(|e| format!("Failed to read agents dir: {}", e))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("md") {
            let dest = claude_agents_dir.join(entry.file_name());
            std::fs::copy(&path, &dest).map_err(|e| {
                format!("Failed to copy {} to .claude/agents: {}", path.display(), e)
            })?;
        }
    }
    Ok(())
}

/// Replace only app-managed plugins in `.claude/plugins` from bundled source.
/// User-added plugins are preserved when they do not have the managed marker.
#[allow(dead_code)]
pub(crate) fn copy_managed_plugins_to_claude_dir(
    plugins_src: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    const MANAGED_MARKER: &str = ".skill-builder-managed";
    let claude_plugins_dir = Path::new(workspace_path).join(".claude").join("plugins");
    std::fs::create_dir_all(&claude_plugins_dir)
        .map_err(|e| format!("Failed to create .claude/plugins dir: {}", e))?;

    let source_entries =
        std::fs::read_dir(plugins_src).map_err(|e| format!("Failed to read plugins dir: {}", e))?;
    let mut source_plugin_names = std::collections::HashSet::new();
    for entry in source_entries {
        let entry = entry.map_err(|e| format!("Failed to read plugins entry: {}", e))?;
        let src_path = entry.path();
        if !src_path.is_dir() {
            continue;
        }
        let plugin_name = entry.file_name().to_string_lossy().to_string();
        source_plugin_names.insert(plugin_name);
    }

    // Remove stale managed plugins that are no longer present in source.
    for entry in std::fs::read_dir(&claude_plugins_dir)
        .map_err(|e| format!("Failed to read .claude/plugins dir: {}", e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read .claude/plugins entry: {}", e))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let is_managed = path.join(MANAGED_MARKER).is_file();
        if is_managed && !source_plugin_names.contains(&name) {
            std::fs::remove_dir_all(&path).map_err(|e| {
                format!(
                    "Failed to remove stale managed plugin {}: {}",
                    path.display(),
                    e
                )
            })?;
        }
    }

    // Replace each managed plugin from source.
    for plugin_name in source_plugin_names {
        let src_plugin = plugins_src.join(&plugin_name);
        let dst_plugin = claude_plugins_dir.join(&plugin_name);
        if dst_plugin.exists() {
            std::fs::remove_dir_all(&dst_plugin).map_err(|e| {
                format!(
                    "Failed to replace managed plugin {}: {}",
                    dst_plugin.display(),
                    e
                )
            })?;
        }
        copy_directory_recursive(&src_plugin, &dst_plugin)?;
        std::fs::write(
            dst_plugin.join(MANAGED_MARKER),
            "managed by skill-builder startup\n",
        )
        .map_err(|e| {
            format!(
                "Failed to write managed plugin marker for {}: {}",
                plugin_name, e
            )
        })?;
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

    fn bundled_plugins_fixture(root: &Path) -> PathBuf {
        let plugins = root.join("plugins");
        write_file(
            &plugins.join("skill-content-researcher/agents/research-agent.md"),
            "---\nname: research-agent\n---\nRun research.",
        );
        write_file(
            &plugins.join("skill-content-researcher/skills/research/SKILL.md"),
            "# Research",
        );
        plugins
    }

    #[test]
    fn cached_workspace_with_new_skill_dir_is_not_considered_complete() {
        let tmp = tempfile::tempdir().unwrap();
        let workspace = tmp.path().join("workspace");
        let workspace_str = workspace.to_string_lossy().to_string();

        std::fs::create_dir_all(workspace.join("plugin/new-skill")).unwrap();
        mark_workspace_copied(&workspace_str);

        assert!(workspace_already_copied(&workspace_str));
        assert!(!workspace_openhands_layout_complete(&workspace_str));
        invalidate_workspace_cache(&workspace_str);
    }

    #[test]
    fn copy_workflow_plugins_populates_openhands_layout_for_discovered_skill_dirs() {
        let tmp = tempfile::tempdir().unwrap();
        let plugins = bundled_plugins_fixture(tmp.path());
        let workspace = tmp.path().join("workspace");
        let skill_dir = workspace.join("plugin/new-skill");
        std::fs::create_dir_all(&skill_dir).unwrap();

        copy_workflow_plugins_to_openhands_layout(&plugins, &workspace).unwrap();

        assert!(skill_dir.join(".agents/agents/research-agent.md").is_file());
        assert!(skill_dir.join(".agents/skills/research/SKILL.md").is_file());
        assert!(workspace_openhands_layout_complete(
            workspace.to_string_lossy().as_ref()
        ));
    }
}
