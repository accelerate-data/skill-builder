use serde::{Deserialize, Serialize};
use std::fmt;

/// A string wrapper that prevents accidental logging of sensitive values.
///
/// `Debug` and `Display` emit `[REDACTED]`; `Serialize` passes through the
/// inner value transparently so JSON IPC (e.g. sidecar stdin) still works.
#[derive(Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct SecretString(String);

impl SecretString {
    pub fn new(value: String) -> Self {
        Self(value)
    }

    /// Access the underlying value. Use only where the raw secret is required
    /// (e.g. HTTP headers, process IPC).
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

impl fmt::Display for SecretString {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("[REDACTED]")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn debug_and_display_redact() {
        let s = SecretString::new("sk-ant-super-secret".to_string());
        assert_eq!(format!("{:?}", s), "[REDACTED]");
        assert_eq!(format!("{}", s), "[REDACTED]");
    }

    #[test]
    fn expose_returns_inner_value() {
        let s = SecretString::new("sk-ant-super-secret".to_string());
        assert_eq!(s.expose(), "sk-ant-super-secret");
    }

    #[test]
    fn serde_roundtrip_is_transparent() {
        let s = SecretString::new("sk-ant-test".to_string());
        let json = serde_json::to_string(&s).unwrap();
        assert_eq!(json, "\"sk-ant-test\"");
        let deserialized: SecretString = serde_json::from_str(&json).unwrap();
        assert_eq!(deserialized.expose(), "sk-ant-test");
    }
}
