use std::net::TcpListener;
use std::process::Stdio;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OpenHandsServerCommand {
    pub program: String,
    pub args: Vec<String>,
}

impl OpenHandsServerCommand {
    pub fn new(port: u16) -> Self {
        Self {
            program: "python3".to_string(),
            args: vec![
                "-m".to_string(),
                "openhands.agent_server".to_string(),
                "--host".to_string(),
                "127.0.0.1".to_string(),
                "--port".to_string(),
                port.to_string(),
            ],
        }
    }

    pub fn tokio_command(&self) -> tokio::process::Command {
        let mut command = tokio::process::Command::new(&self.program);
        command
            .args(&self.args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::piped());
        command
    }
}

#[derive(Debug)]
pub struct OpenHandsAgentServerProcess {
    pub port: u16,
    pub command: OpenHandsServerCommand,
    child: tokio::process::Child,
}

impl OpenHandsAgentServerProcess {
    pub async fn start(timeout: Duration) -> Result<Self, String> {
        let port = select_random_local_port()?;
        let command = OpenHandsServerCommand::new(port);
        let child = command
            .tokio_command()
            .spawn()
            .map_err(|e| format!("Failed to spawn OpenHands Agent Server: {e}"))?;
        let process = Self {
            port,
            command,
            child,
        };
        process.wait_until_healthy(timeout).await?;
        Ok(process)
    }

    pub async fn wait_until_healthy(&self, timeout: Duration) -> Result<(), String> {
        wait_until_healthy(self.port, timeout).await
    }

    pub async fn shutdown(&mut self) -> Result<(), String> {
        if let Ok(Some(_)) = self.child.try_wait() {
            return Ok(());
        }
        self.child
            .start_kill()
            .map_err(|e| format!("Failed to stop OpenHands Agent Server: {e}"))?;
        self.child
            .wait()
            .await
            .map_err(|e| format!("Failed to wait for OpenHands Agent Server shutdown: {e}"))?;
        Ok(())
    }
}

pub fn select_random_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind(("127.0.0.1", 0))
        .map_err(|e| format!("Failed to reserve local OpenHands Agent Server port: {e}"))?;
    listener
        .local_addr()
        .map(|addr| addr.port())
        .map_err(|e| format!("Failed to read local OpenHands Agent Server port: {e}"))
}

pub fn redact_stderr(text: &str, secrets: &[String]) -> String {
    secrets
        .iter()
        .filter(|secret| !secret.trim().is_empty())
        .fold(text.to_string(), |redacted, secret| {
            redacted.replace(secret, "[REDACTED]")
        })
}

async fn wait_until_healthy(port: u16, timeout: Duration) -> Result<(), String> {
    let client = reqwest::Client::new();
    let deadline = Instant::now() + timeout;
    let urls = [
        format!("http://127.0.0.1:{port}/alive"),
        format!("http://127.0.0.1:{port}/health"),
    ];

    loop {
        for url in &urls {
            if let Ok(response) = client.get(url).send().await {
                if response.status().is_success() {
                    return Ok(());
                }
            }
        }

        if Instant::now() >= deadline {
            return Err(format!(
                "Timed out waiting for OpenHands Agent Server health on 127.0.0.1:{port}"
            ));
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_local_port_is_loopback_and_bindable_after_selection() {
        let port = select_random_local_port().unwrap();
        assert_ne!(port, 0);

        let listener = std::net::TcpListener::bind(("127.0.0.1", port)).unwrap();
        assert_eq!(listener.local_addr().unwrap().ip().to_string(), "127.0.0.1");
    }

    #[test]
    fn agent_server_command_uses_python_module_host_and_selected_port() {
        let command = OpenHandsServerCommand::new(54321);

        assert_eq!(command.program, "python3");
        assert_eq!(
            command.args,
            vec![
                "-m",
                "openhands.agent_server",
                "--host",
                "127.0.0.1",
                "--port",
                "54321"
            ]
        );
    }

    #[test]
    fn redact_stderr_replaces_known_secret_values() {
        let text = "failed with sk-test and bearer-token; sk-test again";
        let redacted = redact_stderr(text, &["sk-test".into(), "bearer-token".into()]);

        assert_eq!(
            redacted,
            "failed with [REDACTED] and [REDACTED]; [REDACTED] again"
        );
    }
}
