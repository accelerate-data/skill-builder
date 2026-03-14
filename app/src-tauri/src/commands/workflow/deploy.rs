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

/// Resolve the path to the bundled skills directory.
/// In dev mode: `{CARGO_MANIFEST_DIR}/../../agent-sources/skills/`.
/// In production: Tauri resource directory `agent-sources/skills/`.
pub fn resolve_bundled_skills_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("skills"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("agent-sources").join("skills"))
            .unwrap_or_default(),
    }
}

/// Resolve the path to bundled plugins source directory.
/// In dev mode: `{CARGO_MANIFEST_DIR}/../../agent-sources/plugins/`.
/// In production: Tauri resource directory `agent-sources/plugins/`.
pub fn resolve_bundled_plugins_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    use tauri::Manager;

    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .map(|p| p.to_path_buf());

    let dev_path = repo_root
        .as_ref()
        .map(|r| r.join("agent-sources").join("plugins"));

    match dev_path {
        Some(ref p) if p.is_dir() => p.clone(),
        _ => app_handle
            .path()
            .resource_dir()
            .map(|r| r.join("agent-sources").join("plugins"))
            .unwrap_or_default(),
    }
}

/// Deploy a single skill into the workspace `.claude/skills/` directory.
///
/// Resolution order:
/// 1. If `purpose` is non-empty and an active workspace skill with that purpose exists in DB:
///    use `workspace_skill.disk_path` (copy from there).
/// 2. Otherwise: copy from `bundled_skills_dir / skill_name`.
///
/// This is called before running workflow steps so that purpose-overridden skills
/// (research, validate, skill-building) replace their bundled counterparts.
pub(crate) fn deploy_skill_for_workflow(
    conn: &rusqlite::Connection,
    workspace_path: &str,
    bundled_skills_dir: &std::path::Path,
    skill_name: &str,
    purpose: &str,
) {
    let dest_skills_dir = std::path::Path::new(workspace_path)
        .join(".claude")
        .join("skills");
    let dest = dest_skills_dir.join(skill_name);

    // Try purpose-based resolution first
    let source_dir: std::path::PathBuf = match crate::db::get_imported_skill_by_purpose(
        conn, purpose,
    ) {
        Ok(Some(ws)) => {
            // Bundled skills should always be copied from bundled sources.
            // Using ws.disk_path for bundled rows can point to the destination
            // itself and result in destructive self-overwrite.
            if ws.is_bundled {
                log::debug!(
                    "[deploy_skill_for_workflow] purpose='{}' → using bundled source for '{}' (workspace row is bundled)",
                    purpose, skill_name
                );
                bundled_skills_dir.join(skill_name)
            } else {
                log::debug!(
                    "[deploy_skill_for_workflow] purpose='{}' → using workspace skill '{}' from {}",
                    purpose,
                    ws.skill_name,
                    ws.disk_path
                );
                std::path::PathBuf::from(&ws.disk_path)
            }
        }
        Ok(None) => {
            log::debug!(
                "[deploy_skill_for_workflow] purpose='{}' → no workspace skill found, using bundled '{}'",
                purpose, skill_name
            );
            bundled_skills_dir.join(skill_name)
        }
        Err(e) => {
            log::warn!(
                "[deploy_skill_for_workflow] DB error looking up purpose '{}': {}; falling back to bundled",
                purpose, e
            );
            bundled_skills_dir.join(skill_name)
        }
    };

    if !source_dir.is_dir() {
        log::debug!(
            "[deploy_skill_for_workflow] source dir not found for '{}' ({}), skipping",
            skill_name,
            source_dir.display()
        );
        return;
    }

    if source_dir == dest {
        log::warn!(
            "[deploy_skill_for_workflow] source and destination are identical for '{}': {}; skipping copy to avoid self-overwrite",
            skill_name,
            source_dir.display()
        );
        return;
    }

    // Remove existing copy so we always get a fresh deployment
    if dest.exists() {
        let _ = std::fs::remove_dir_all(&dest);
    }
    if let Err(e) = std::fs::create_dir_all(&dest) {
        log::warn!(
            "[deploy_skill_for_workflow] failed to create dest dir for '{}': {}",
            skill_name,
            e
        );
        return;
    }
    if let Err(e) = crate::commands::imported_skills::copy_dir_recursive(&source_dir, &dest) {
        log::warn!(
            "[deploy_skill_for_workflow] failed to copy '{}': {}",
            skill_name,
            e
        );
    }
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

/// Copy bundled agent .md files and workspace CLAUDE.md into workspace.
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
    if workspace_already_copied(workspace_path) {
        return Ok(());
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

    tokio::task::spawn_blocking(move || copy_prompts_sync(&agents, &plugins, &cmd, &workspace))
        .await
        .map_err(|e| format!("Prompt copy task failed: {}", e))??;

    mark_workspace_copied(workspace_path);
    Ok(())
}

/// Synchronous inner copy logic shared by async and sync entry points.
/// Only copies agents — CLAUDE.md is rebuilt separately via `rebuild_claude_md`.
pub(crate) fn copy_prompts_sync(
    agents_dir: &Path,
    plugins_dir: &Path,
    _claude_md: &Path,
    workspace_path: &str,
) -> Result<(), String> {
    if agents_dir.is_dir() {
        copy_agents_to_claude_dir(agents_dir, workspace_path)?;
    }
    if plugins_dir.is_dir() {
        copy_managed_plugins_to_claude_dir(plugins_dir, workspace_path)?;
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
    if workspace_already_copied(workspace_path) {
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

/// Re-deploy only the bundled agents to `.claude/agents/`, preserving
/// other contents of the `.claude/` directory (skills, agents, etc.).
pub fn redeploy_agents(app_handle: &tauri::AppHandle, workspace_path: &str) -> Result<(), String> {
    let (agents_dir, _) = resolve_prompt_source_dirs(app_handle);
    let plugins_dir = resolve_bundled_plugins_dir(app_handle);
    if agents_dir.is_dir() {
        copy_agents_to_claude_dir(&agents_dir, workspace_path)?;
    }
    if plugins_dir.is_dir() {
        copy_managed_plugins_to_claude_dir(&plugins_dir, workspace_path)?;
    }
    Ok(())
}

/// Copy agent .md files from flat bundled agent source to <workspace>/.claude/agents/.
/// agent-sources/agents/{name}.md → .claude/agents/{name}.md
pub(crate) fn copy_agents_to_claude_dir(agents_src: &Path, workspace_path: &str) -> Result<(), String> {
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

// copy_directory_to and copy_md_files_recursive removed — no longer deploying
// agents tree to workspace root (only .claude/agents/ is used).

/// Recursively copy a directory and all its contents.
#[allow(dead_code)]
pub(crate) fn copy_directory_recursive(src: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest)
        .map_err(|e| format!("Failed to create dir {}: {}", dest.display(), e))?;

    let entries = std::fs::read_dir(src)
        .map_err(|e| format!("Failed to read dir {}: {}", src.display(), e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read dir entry: {}", e))?;
        let src_path = entry.path();
        let dest_path = dest.join(entry.file_name());

        if src_path.is_dir() {
            copy_directory_recursive(&src_path, &dest_path)?;
        } else {
            std::fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Failed to copy {}: {}", src_path.display(), e))?;
        }
    }

    Ok(())
}
