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

    run_command(
        {
            let mut command = Command::new(&prisma);
            command.arg("generate").current_dir(&litellm_dir);
            command
        },
        "generate Prisma client for LiteLLM",
    )?;

    Ok(python)
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
