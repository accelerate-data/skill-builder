mod startup_error;
mod process;
mod pool;
mod dispatch;

pub use startup_error::SidecarStartupError;
pub use pool::{SidecarPool, DEFAULT_SHUTDOWN_TIMEOUT_SECS};

// Re-export public items so existing `use crate::agents::sidecar_pool::*` paths keep working.
pub use super::node_resolver::resolve_node_binary;
pub use super::sidecar_path::resolve_sidecar_path_public;
#[cfg(target_os = "windows")]
pub use super::node_resolver::find_git_bash;
