use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const LITELLM_DIR: &str = "litellm";
const VENV_DIR: &str = "venv";

pub fn venv_root(app_data_root: &Path) -> PathBuf {
    app_data_root.join(LITELLM_DIR).join(VENV_DIR)
}

#[cfg(unix)]
fn python_path(venv_root: &Path) -> PathBuf {
    venv_root.join("bin").join("python")
}

#[cfg(windows)]
fn python_path(venv_root: &Path) -> PathBuf {
    venv_root.join("Scripts").join("python.exe")
}

#[cfg(unix)]
fn prisma_path(venv_root: &Path) -> PathBuf {
    venv_root.join("bin").join("prisma")
}

#[cfg(windows)]
fn prisma_path(venv_root: &Path) -> PathBuf {
    venv_root.join("Scripts").join("prisma.exe")
}

fn venv_bin_dir(venv_root: &Path) -> PathBuf {
    prisma_path(venv_root)
        .parent()
        .expect("prisma path should have a parent")
        .to_path_buf()
}

pub fn venv_exists(app_data_root: &Path) -> bool {
    let venv_root = venv_root(app_data_root);
    python_path(&venv_root).exists() && prisma_path(&venv_root).exists()
}

pub fn ensure_venv(app_data_root: &Path) -> Result<PathBuf, String> {
    let litellm_dir = app_data_root.join(LITELLM_DIR);
    fs::create_dir_all(&litellm_dir)
        .map_err(|e| format!("Failed to create LiteLLM directory: {e}"))?;

    let venv_root = venv_root(app_data_root);
    let python = python_path(&venv_root);
    let prisma = prisma_path(&venv_root);

    if venv_exists(app_data_root) {
        log::info!(
            "[litellm-proxy] reusing LiteLLM venv at {}",
            venv_root.display()
        );
        return Ok(python);
    }

    log::info!(
        "[litellm-proxy] bootstrapping LiteLLM venv at {}",
        venv_root.display()
    );

    run_command(
        {
            let mut command = Command::new("uv");
            command
                .arg("venv")
                .arg(&venv_root)
                .current_dir(&litellm_dir);
            command
        },
        "create LiteLLM venv",
    )?;

    if !python.exists() {
        return Err(format!(
            "LiteLLM venv bootstrap completed without a Python executable at {}",
            python.display()
        ));
    }

    run_command(
        {
            let mut command = Command::new("uv");
            command
                .args(["pip", "install", "--python"])
                .arg(&python)
                .args(["litellm[proxy]", "prisma"])
                .current_dir(&litellm_dir);
            command
        },
        "install LiteLLM proxy dependencies",
    )?;

    if !prisma.exists() {
        return Err(format!(
            "LiteLLM venv is missing Prisma after dependency install at {}",
            prisma.display()
        ));
    }

    let schema_path = resolve_litellm_schema_path(&python)?;

    run_command(
        {
            let mut command = Command::new(&prisma);
            let path = prepend_env_path(&venv_bin_dir(&venv_root));
            command
                .arg("generate")
                .arg("--schema")
                .arg(&schema_path)
                .current_dir(schema_path.parent().unwrap_or(&litellm_dir))
                .env("PATH", path);
            command
        },
        "generate Prisma client for LiteLLM",
    )?;

    Ok(python)
}

fn prepend_env_path(dir: &Path) -> std::ffi::OsString {
    let mut value = std::ffi::OsString::new();
    value.push(dir.as_os_str());
    if let Some(existing) = std::env::var_os("PATH") {
        let sep = if cfg!(windows) { ";" } else { ":" };
        value.push(sep);
        value.push(existing);
    }
    value
}

fn resolve_litellm_schema_path(python: &Path) -> Result<PathBuf, String> {
    let output = Command::new(python)
        .args([
            "-c",
            "import litellm, os; print(os.path.join(os.path.dirname(litellm.__file__), 'proxy', 'schema.prisma'))",
        ])
        .output()
        .map_err(|e| format!("Failed to resolve LiteLLM schema path: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(format!(
            "Failed to resolve LiteLLM schema path: {}",
            if stderr.is_empty() {
                format!("python exited with status {}", output.status)
            } else {
                stderr
            }
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        return Err(
            "Failed to resolve LiteLLM schema path: python returned an empty path".to_string(),
        );
    }

    let schema_path = PathBuf::from(stdout);
    if !schema_path.exists() {
        return Err(format!(
            "Failed to resolve LiteLLM schema path: {} does not exist",
            schema_path.display()
        ));
    }

    Ok(schema_path)
}

fn run_command(mut command: Command, action: &str) -> Result<(), String> {
    let program = command.get_program().to_string_lossy().into_owned();
    let output = command.output().map_err(|e| {
        if e.kind() == std::io::ErrorKind::NotFound {
            if program == "uv" {
                "Python uv tool is required. Install uv from https://docs.astral.sh/uv/".to_string()
            } else {
                format!("Required executable not found while trying to {action}: {program}")
            }
        } else {
            format!("Failed to {action}: {e}")
        }
    })?;

    if output.status.success() {
        return Ok(());
    }

    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let mut details = Vec::new();
    if !stdout.is_empty() {
        details.push(format!("stdout: {stdout}"));
    }
    if !stderr.is_empty() {
        details.push(format!("stderr: {stderr}"));
    }
    if details.is_empty() {
        Err(format!(
            "Failed to {action}: process exited with status {}",
            output.status
        ))
    } else {
        Err(format!(
            "Failed to {action}: process exited with status {}; {}",
            output.status,
            details.join("; ")
        ))
    }
}
