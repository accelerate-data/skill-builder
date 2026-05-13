/// Windows-only helper for locating Git Bash, which the agent runtime uses for
/// shell-compatible tool execution on Windows.
#[cfg(target_os = "windows")]
pub fn find_git_bash() -> Option<String> {
    use std::path::PathBuf;

    if let Ok(output) = std::process::Command::new("where").arg("bash.exe").output() {
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout);
            for line in stdout.lines() {
                let trimmed = line.trim();
                if trimmed.contains("Git") && PathBuf::from(trimmed).exists() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }

    for path in &[
        r"C:\Program Files\Git\bin\bash.exe",
        r"C:\Program Files (x86)\Git\bin\bash.exe",
    ] {
        if PathBuf::from(path).exists() {
            return Some(path.to_string());
        }
    }

    None
}
