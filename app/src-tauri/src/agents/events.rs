//! Re-export facade — preserves `use super::events` import paths
//! for existing callers while the real logic lives in focused modules.

pub use super::event_router::{
    emit_init_error, emit_runtime_error, handle_agent_shutdown, handle_sidecar_exit,
    handle_sidecar_exit_with_detail, handle_sidecar_message, is_authentication_error,
};
