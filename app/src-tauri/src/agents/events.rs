//! Re-export facade — preserves `use super::events` import paths
//! for existing callers while the real logic lives in focused modules.

pub use super::event_router::{handle_sidecar_exit_with_detail, handle_sidecar_message};
