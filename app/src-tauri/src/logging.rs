use tauri_plugin_log::{Target, TargetKind};

/// The log file name written to the app log directory each session.
const LOG_FILE_NAME: &str = "skill-builder";

/// Truncate the log file before the Tauri builder starts so each session
/// gets a fresh log.
///
/// This must be called BEFORE `tauri::Builder::default()` because the
/// log plugin opens the file during builder construction.
pub fn truncate_log_file() {
    // On macOS the log dir is ~/Library/Logs/{identifier}.
    // On Linux it's $XDG_DATA_HOME/{identifier}/logs.
    // On Windows it's {FOLDERID_LocalAppData}/{identifier}/logs.
    //
    // We use the same identifier that Tauri resolves from tauri.conf.json.
    // The `dirs` crate (a transitive dependency) provides the base directories.
    #[cfg(target_os = "macos")]
    let base = dirs::home_dir().map(|h| h.join("Library").join("Logs"));
    #[cfg(target_os = "linux")]
    let base = dirs::data_local_dir().map(|d| d.join("logs"));
    #[cfg(target_os = "windows")]
    let base = dirs::data_local_dir().map(|d| d.join("logs"));

    if let Some(base_dir) = base {
        let log_dir = base_dir.join("com.skillbuilder.app");
        let log_file = log_dir.join(format!("{}.log", LOG_FILE_NAME));
        if log_file.exists() {
            let _ = std::fs::write(&log_file, "");
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
///   via `truncate_log_file()` called before the builder starts).
/// - **Stderr**: visible in terminals / dev consoles for CLI users.
pub fn build_log_plugin() -> tauri_plugin_log::Builder {
    tauri_plugin_log::Builder::new()
        .targets([
            Target::new(TargetKind::LogDir {
                file_name: Some(LOG_FILE_NAME.into()),
            }),
            Target::new(TargetKind::Stderr),
        ])
        .level(log::LevelFilter::Info)
        .max_file_size(50_000_000) // 50 MB safety cap
}

/// Switch the runtime log level between `Info` and `Debug`.
///
/// Called from the `set_log_level` Tauri command and during `.setup()` after
/// reading the persisted `debug_mode` setting.
pub fn set_log_level(verbose: bool) {
    let level = if verbose {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    log::set_max_level(level);
    log::info!("Log level set to {}", level);
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
