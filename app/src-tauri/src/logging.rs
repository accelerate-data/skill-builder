use tauri_plugin_log::{Target, TargetKind};

/// Base prefix for per-process log files written to the app log directory.
const LOG_FILE_PREFIX: &str = "app";

fn log_file_stem(pid: u32) -> String {
    format!("{LOG_FILE_PREFIX}-{pid}")
}

fn log_file_path_for_pid(log_dir: &std::path::Path, pid: u32) -> std::path::PathBuf {
    log_dir.join(format!("{}.log", log_file_stem(pid)))
}

/// Build the `tauri-plugin-log` plugin instance.
///
/// The plugin is registered in the Tauri builder chain (before `.setup()`),
/// so we start with `Info` level. The actual level is adjusted later in
/// `set_log_level()` once settings have been read from the database.
///
/// Targets:
/// - **LogDir**: persistent file in the app log directory. The plugin appends
///   across restarts and rotates the file once it exceeds `max_file_size`.
/// - **Stderr**: visible in terminals / dev consoles for CLI users.
pub fn build_log_plugin(pid: u32) -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(log_file_stem(pid)),
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
    let log_file = log_file_path_for_pid(&log_dir, std::process::id());
    log_file
        .to_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Log file path contains invalid UTF-8".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_log_file_stem_uses_pid() {
        assert_eq!(log_file_stem(4242), "app-4242");
    }

    #[test]
    fn test_log_file_path_for_pid_uses_pid_specific_name() {
        let path = log_file_path_for_pid(Path::new("/tmp/logs"), 4242);
        assert_eq!(path, Path::new("/tmp/logs/app-4242.log"));
    }
}
