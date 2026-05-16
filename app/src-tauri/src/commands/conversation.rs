use serde::{Deserialize, Serialize};
use tauri::Manager;

use crate::agents::skill_creator::{build_skill_creator_config, SkillCreatorIntent, SkillCreatorRuntimeContext};
use crate::commands::skill_session::{ensure_skill_runtime_ready, resolve_skills_path, SkillSessionManager};
use crate::commands::workflow::guards::make_agent_id;
use crate::db::Db;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendConversationMessageInput {
    pub conversation_id: String,
    pub local_event_id: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationSendAck {
    pub accepted: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl ConversationSendAck {
    fn accepted() -> Self {
        Self {
            accepted: true,
            error: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ResolvedSkillConversationSession {
    skill_name: String,
    plugin_slug: String,
    conversation_id: String,
    usage_session_id: String,
    current_agent_id: Option<String>,
    dispatched_user_turn_count: usize,
}

fn resolve_session_for_conversation(
    sessions: &SkillSessionManager,
    conversation_id: &str,
) -> Result<ResolvedSkillConversationSession, String> {
    let map = sessions
        .0
        .lock()
        .map_err(|e| format!("failed to acquire skill session lock: {e}"))?;

    map.values()
        .find(|session| session.conversation_id.as_deref() == Some(conversation_id))
        .map(|session| ResolvedSkillConversationSession {
            skill_name: session.skill_name.clone(),
            plugin_slug: session.plugin_slug.clone(),
            conversation_id: conversation_id.to_string(),
            usage_session_id: session.usage_session_id.clone(),
            current_agent_id: session.current_agent_id.clone(),
            dispatched_user_turn_count: session.dispatched_user_turn_count,
        })
        .ok_or_else(|| {
            format!(
                "No active selected-skill session is bound to conversation '{}'",
                conversation_id
            )
        })
}

fn selected_skill_agent_id(
    session: &ResolvedSkillConversationSession,
) -> String {
    session
        .current_agent_id
        .clone()
        .unwrap_or_else(|| make_agent_id(&session.skill_name, "selected-skill"))
}

fn mark_session_message_dispatched(
    sessions: &SkillSessionManager,
    conversation_id: &str,
    agent_id: &str,
) -> Result<(), String> {
    let mut map = sessions
        .0
        .lock()
        .map_err(|e| format!("failed to acquire skill session lock: {e}"))?;

    let session = map
        .values_mut()
        .find(|session| session.conversation_id.as_deref() == Some(conversation_id))
        .ok_or_else(|| {
            format!(
                "No active selected-skill session is bound to conversation '{}'",
                conversation_id
            )
        })?;

    session.current_agent_id = Some(agent_id.to_string());
    session.dispatched_user_turn_count += 1;
    Ok(())
}

#[tauri::command]
pub async fn send_conversation_message(
    app: tauri::AppHandle,
    input: SendConversationMessageInput,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, SkillSessionManager>,
) -> Result<ConversationSendAck, String> {
    if input.conversation_id.trim().is_empty() {
        return Err("send_conversation_message requires a non-empty conversation_id".to_string());
    }
    if input.local_event_id.trim().is_empty() {
        return Err("send_conversation_message requires a non-empty local_event_id".to_string());
    }
    if input.message.trim().is_empty() {
        return Err("send_conversation_message requires a non-empty message".to_string());
    }

    let session = resolve_session_for_conversation(&sessions, &input.conversation_id)?;
    let runtime_ctx =
        ensure_skill_runtime_ready(&app, &db, &session.skill_name, &session.plugin_slug).await?;
    let skills_root = resolve_skills_path(&db)?;
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");

    let mut config = build_skill_creator_config(SkillCreatorRuntimeContext {
        app_data_root,
        skills_root,
        skill_name: session.skill_name.clone(),
        plugin_slug: session.plugin_slug.clone(),
        prompt: input.message,
        llm: runtime_ctx.llm,
        intent: SkillCreatorIntent::SelectedSkillSession,
        skill_dir_override: None,
    });
    config.usage_session_id = Some(session.usage_session_id.clone());

    let agent_id = selected_skill_agent_id(&session);

    crate::agents::tracked_openhands::send_tracked_openhands_message(
        &app,
        &agent_id,
        config,
        session.conversation_id.clone(),
    )
    .await?;

    mark_session_message_dispatched(&sessions, &session.conversation_id, &agent_id)?;

    log::info!(
        "[send_conversation_message] conversation_id={} local_event_id={} skill={} plugin={} turn_count={}",
        session.conversation_id,
        input.local_event_id,
        session.skill_name,
        session.plugin_slug,
        session.dispatched_user_turn_count + 1
    );

    Ok(ConversationSendAck::accepted())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::skill_session::{skill_session_key, SkillSession};
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn test_sessions() -> SkillSessionManager {
        let mut sessions = HashMap::new();
        sessions.insert(
            skill_session_key("sales-skill", "skills"),
            SkillSession {
                skill_name: "sales-skill".to_string(),
                plugin_slug: "skills".to_string(),
                usage_session_id: "usage-1".to_string(),
                conversation_id: Some("conv-1".to_string()),
                current_agent_id: None,
                dispatched_user_turn_count: 0,
                head_sha_at_start: None,
            },
        );
        SkillSessionManager(Mutex::new(sessions))
    }

    #[test]
    fn resolve_session_for_conversation_returns_selected_skill_session() {
        let sessions = test_sessions();

        let session = resolve_session_for_conversation(&sessions, "conv-1").unwrap();

        assert_eq!(session.skill_name, "sales-skill");
        assert_eq!(session.plugin_slug, "skills");
        assert_eq!(session.usage_session_id, "usage-1");
        assert_eq!(session.current_agent_id, None);
    }

    #[test]
    fn resolve_session_for_conversation_errors_for_unknown_conversation() {
        let sessions = test_sessions();

        let error = resolve_session_for_conversation(&sessions, "missing").unwrap_err();

        assert_eq!(
            error,
            "No active selected-skill session is bound to conversation 'missing'"
        );
    }

    #[test]
    fn mark_session_message_dispatched_sets_agent_id_and_increments_turn_count() {
        let sessions = test_sessions();

        mark_session_message_dispatched(&sessions, "conv-1", "agent-1").unwrap();

        let session = resolve_session_for_conversation(&sessions, "conv-1").unwrap();
        assert_eq!(session.current_agent_id.as_deref(), Some("agent-1"));
        assert_eq!(session.dispatched_user_turn_count, 1);
    }
}
