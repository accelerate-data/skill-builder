mod dispatch;
mod pool;
mod process;
mod startup_error;

pub use pool::{SidecarPool, DEFAULT_SHUTDOWN_TIMEOUT_SECS};
pub use startup_error::SidecarStartupError;

// Re-export public items so existing `use crate::agents::sidecar_pool::*` paths keep working.
#[cfg(target_os = "windows")]
pub use super::node_resolver::find_git_bash;
pub use super::node_resolver::resolve_node_binary;
pub use super::sidecar_path::resolve_sidecar_path_public;
