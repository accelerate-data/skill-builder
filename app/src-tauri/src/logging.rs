use tauri_plugin_log::{Target, TargetKind};

/// The log file name written to the app log directory each session.
const LOG_FILE_NAME: &str = "skill-builder";

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
