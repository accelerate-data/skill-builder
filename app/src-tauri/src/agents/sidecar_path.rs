/// Public accessor for startup dependency checks.
pub fn resolve_sidecar_path_public(app_handle: &tauri::AppHandle) -> Result<String, String> {
    resolve_sidecar_path(app_handle)
}

pub(crate) fn resolve_sidecar_path(app_handle: &tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    // Prefer bootstrap.js (catches module-load errors) with agent-runner.js as fallback.
    let entry_files = ["bootstrap.js", "agent-runner.js"];

    if let Ok(resource_dir) = app_handle.path().resource_dir() {
        for entry in &entry_files {
            let sidecar = resource_dir.join("sidecar").join("dist").join(entry);
            if sidecar.exists() {
                return sidecar
                    .to_str()
                    .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

    if let Ok(exe_dir) = std::env::current_exe() {
        if let Some(dir) = exe_dir.parent() {
            for entry in &entry_files {
                let sidecar = dir.join("sidecar").join("dist").join(entry);
                if sidecar.exists() {
                    return sidecar
                        .to_str()
                        .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                        .ok_or_else(|| "Invalid sidecar path".to_string());
                }
            }
        }
    }

    let dev_base = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(|p| p.join("sidecar").join("dist"));
    if let Some(base) = dev_base {
        for entry in &entry_files {
            let path = base.join(entry);
            if path.exists() {
                return path
                    .to_str()
                    .map(|s| s.strip_prefix("\\\\?\\").unwrap_or(s).replace('\\', "/"))
                    .ok_or_else(|| "Invalid sidecar path".to_string());
            }
        }
    }

    Err("Could not find bootstrap.js or agent-runner.js -- run 'npm run build' in app/sidecar/ first".to_string())
}
