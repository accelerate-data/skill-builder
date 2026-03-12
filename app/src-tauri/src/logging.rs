use tauri_plugin_log::{Target, TargetKind};

/// The log file name written to the app log directory each session.
const LOG_FILE_NAME: &str = "app";

/// Truncate the log file so each session starts fresh.
///
/// Called from `.setup()` after the log plugin has already opened the file.
/// We use the Tauri path resolver to guarantee the path matches the plugin's
/// target — the old approach of guessing the path via `dirs` could diverge
/// from what `tauri-plugin-log` actually resolves (especially in dev builds).
pub fn truncate_log_file(app: &tauri::AppHandle) {
    use tauri::Manager;
    match app.path().app_log_dir() {
        Ok(log_dir) => {
            let log_file = log_dir.join(format!("{}.log", LOG_FILE_NAME));
            if log_file.exists() {
                // Truncate to zero — the log plugin holds an append-mode handle,
                // so subsequent writes land at offset 0 in the now-empty file.
                if let Err(e) = std::fs::write(&log_file, "") {
                    eprintln!("Failed to truncate log file {:?}: {}", log_file, e);
                }
            }
        }
        Err(e) => {
            eprintln!("Failed to resolve app log dir for truncation: {}", e);
        }
    }
}

/// Build the `tauri-plugin-log` plugin instance.
///
/// The plugin is registered in the Tauri builder chain (before `.setup()`),
/// so we start with `Info` level. The actual level is adjusted later in
/// `set_log_level()` once settings have been read from the database.
///
/// Targets:
/// - **LogDir**: persistent file in the app log directory (fresh each session
///   via `truncate_log_file()` called during `.setup()`).
/// - **Stderr**: visible in terminals / dev consoles for CLI users.
pub fn build_log_plugin() -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            }),
            Target::new(TargetKind::Stderr),
        ])
        // Set the plugin filter wide open — actual filtering is done by
        // `log::set_max_level()` in `set_log_level()`, which is called
        // during setup and whenever the user changes the setting.
        .level(log::LevelFilter::Debug)
        .max_file_size(50_000_000) // 50 MB safety cap
}

/// Set the runtime log level.
///
/// Accepts one of `"error"`, `"warn"`, `"info"`, `"debug"` (case-insensitive).
/// Falls back to `Info` for unrecognized values.
///
/// Called from the `set_log_level` Tauri command and during `.setup()` after
/// reading the persisted setting.
pub fn set_log_level(level: &str) {
    let filter = match level.to_lowercase().as_str() {
        "error" => log::LevelFilter::Error,
        "warn" => log::LevelFilter::Warn,
        "info" => log::LevelFilter::Info,
        "debug" => log::LevelFilter::Debug,
        _ => log::LevelFilter::Info,
    };
    log::set_max_level(filter);
    log::info!("Log level set to {}", filter);
}

/// Return the absolute path to the log file.
///
/// The log directory is the standard Tauri app log directory. The file name
/// matches what we configured in `build_log_plugin()`.
pub fn get_log_file_path(app: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;
    let log_dir = app.path().app_log_dir().map_err(|e| e.to_string())?;
    let log_file = log_dir.join(format!("{}.log", LOG_FILE_NAME));
    log_file
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Log file path contains invalid UTF-8".to_string())
}

/// Delete `.jsonl` transcript files older than today from all `{skill}/logs/`
/// directories under the workspace path.
///
/// Called early in the startup sequence (inside `.setup()`) after the workspace
/// path is known. Errors are non-fatal: each failure is logged as a warning
/// and cleanup continues.
pub fn prune_transcript_files(workspace_path: &str) {
    use chrono::Local;
    use std::path::Path;

    let workspace = Path::new(workspace_path);
    if !workspace.exists() {
        return;
    }

    let today = Local::now().date_naive();
    let mut pruned: u32 = 0;
    let mut skills_affected: u32 = 0;

    // Infrastructure directories to skip (all live under .claude/)
    const SKIP_DIRS: &[&str] = &[".claude"];

    let entries = match std::fs::read_dir(workspace) {
        Ok(e) => e,
        Err(e) => {
            log::warn!("Transcript pruning: failed to read workspace dir: {}", e);
            return;
        }
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if SKIP_DIRS.contains(&name_str.as_ref()) {
            continue;
        }

        let logs_dir = path.join("logs");
        if !logs_dir.is_dir() {
            continue;
        }

        let mut skill_pruned: u32 = 0;

        let log_entries = match std::fs::read_dir(&logs_dir) {
            Ok(e) => e,
            Err(e) => {
                log::warn!(
                    "Transcript pruning: failed to read logs dir for '{}': {}",
                    name_str,
                    e
                );
                continue;
            }
        };

        for log_entry in log_entries.flatten() {
            let log_path = log_entry.path();

            // Only target .jsonl files
            if log_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }

            // Check modification time
            let metadata = match std::fs::metadata(&log_path) {
                Ok(m) => m,
                Err(e) => {
                    log::warn!(
                        "Transcript pruning: failed to read metadata for '{}': {}",
                        log_path.display(),
                        e
                    );
                    continue;
                }
            };

            let modified = match metadata.modified() {
                Ok(t) => t,
                Err(e) => {
                    log::warn!(
                        "Transcript pruning: failed to get mtime for '{}': {}",
                        log_path.display(),
                        e
                    );
                    continue;
                }
            };

            let modified_date: chrono::NaiveDate =
                chrono::DateTime::<Local>::from(modified).date_naive();

            if modified_date < today {
                if let Err(e) = std::fs::remove_file(&log_path) {
                    log::warn!(
                        "Transcript pruning: failed to delete '{}': {}",
                        log_path.display(),
                        e
                    );
                } else {
                    skill_pruned += 1;
                }
            }
        }

        if skill_pruned > 0 {
            pruned += skill_pruned;
            skills_affected += 1;
        }
    }

    if pruned > 0 {
        log::info!(
            "Pruned {} transcript files from {} skills",
            pruned,
            skills_affected
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    /// Helper: create a `.jsonl` file inside `{workspace}/{skill}/logs/` with
    /// the given name and set its modification time to `days_ago` days in the past.
    fn create_jsonl(workspace: &Path, skill: &str, filename: &str, days_ago: i64) {
        let logs_dir = workspace.join(skill).join("logs");
        fs::create_dir_all(&logs_dir).unwrap();
        let file_path = logs_dir.join(filename);
        fs::write(&file_path, r#"{"type":"test"}"#).unwrap();

        if days_ago > 0 {
            let past = std::time::SystemTime::now()
                - std::time::Duration::from_secs(days_ago as u64 * 86400);
            let file = fs::File::options().write(true).open(&file_path).unwrap();
            file.set_times(fs::FileTimes::new().set_accessed(past).set_modified(past))
                .unwrap();
        }
    }

    #[test]
    fn test_prune_deletes_old_jsonl_files() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path();

        // Old file (2 days ago) should be pruned
        create_jsonl(workspace, "my-skill", "step0-research-2025-01-01.jsonl", 2);
        // Today's file should be kept
        create_jsonl(workspace, "my-skill", "step0-research-today.jsonl", 0);

        prune_transcript_files(workspace.to_str().unwrap());

        let logs_dir = workspace.join("my-skill").join("logs");
        assert!(
            !logs_dir.join("step0-research-2025-01-01.jsonl").exists(),
            "Old JSONL file should be pruned"
        );
        assert!(
            logs_dir.join("step0-research-today.jsonl").exists(),
            "Today's JSONL file should be kept"
        );
    }

    #[test]
    fn test_prune_skips_non_jsonl_files() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path();

        // Create an old .log file (not .jsonl) — should NOT be deleted
        let logs_dir = workspace.join("my-skill").join("logs");
        fs::create_dir_all(&logs_dir).unwrap();
        fs::write(logs_dir.join("step0.log"), "old log").unwrap();

        // Create an old .json chat file — should NOT be deleted
        fs::write(logs_dir.join("reasoning-chat.json"), "{}").unwrap();

        prune_transcript_files(workspace.to_str().unwrap());

        assert!(
            logs_dir.join("step0.log").exists(),
            ".log files should not be pruned"
        );
        assert!(
            logs_dir.join("reasoning-chat.json").exists(),
            ".json files should not be pruned"
        );
    }

    #[test]
    fn test_prune_skips_infrastructure_dirs() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path();

        // Create a logs/ dir inside .claude/ infrastructure directory (should be skipped)
        let claude_logs = workspace.join(".claude").join("logs");
        fs::create_dir_all(&claude_logs).unwrap();
        fs::write(claude_logs.join("old.jsonl"), "{}").unwrap();

        prune_transcript_files(workspace.to_str().unwrap());

        assert!(
            claude_logs.join("old.jsonl").exists(),
            "Files in infrastructure dirs should not be touched"
        );
    }

    #[test]
    fn test_prune_multiple_skills() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path();

        create_jsonl(workspace, "skill-a", "old.jsonl", 3);
        create_jsonl(workspace, "skill-b", "old.jsonl", 5);
        create_jsonl(workspace, "skill-b", "today.jsonl", 0);

        prune_transcript_files(workspace.to_str().unwrap());

        assert!(!workspace
            .join("skill-a")
            .join("logs")
            .join("old.jsonl")
            .exists());
        assert!(!workspace
            .join("skill-b")
            .join("logs")
            .join("old.jsonl")
            .exists());
        assert!(workspace
            .join("skill-b")
            .join("logs")
            .join("today.jsonl")
            .exists());
    }

    #[test]
    fn test_prune_empty_workspace() {
        let tmp = tempdir().unwrap();
        // Should not panic or error on an empty workspace
        prune_transcript_files(tmp.path().to_str().unwrap());
    }

    #[test]
    fn test_prune_nonexistent_workspace() {
        // Should not panic on a nonexistent path
        prune_transcript_files("/nonexistent/workspace/path");
    }

    #[test]
    fn test_prune_skill_without_logs_dir() {
        let tmp = tempdir().unwrap();
        let workspace = tmp.path();

        // Skill directory exists but has no logs/ subdirectory
        fs::create_dir_all(workspace.join("my-skill").join("context")).unwrap();

        prune_transcript_files(workspace.to_str().unwrap());
        // Should complete without error
    }

    #[test]
    fn test_log_file_name_is_app() {
        assert_eq!(LOG_FILE_NAME, "app");
    }
}
