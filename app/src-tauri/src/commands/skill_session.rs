use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Deserialize;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::types::RefineSessionInfo;

pub struct SkillSession {
    pub skill_name: String,
    pub plugin_slug: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    pub conversation_id: Option<String>,
    pub current_agent_id: Option<String>,
    pub dispatched_user_turn_count: usize,
    pub head_sha_at_start: Option<String>,
}

pub struct SkillSessionManager(pub Mutex<HashMap<String, SkillSession>>);

impl SkillSessionManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

pub(crate) fn skill_session_key(skill_name: &str, plugin_slug: &str) -> String {
    format!("{}::{}", plugin_slug, skill_name)
}

fn upsert_skill_session(
    sessions: &mut HashMap<String, SkillSession>,
    session_key: String,
    session: SkillSession,
) {
    let skill_name = session.skill_name.clone();
    let plugin_slug = session.plugin_slug.clone();
    sessions.retain(|key, existing| {
        !(existing.skill_name == skill_name
            && existing.plugin_slug == plugin_slug
            && key != &session_key)
    });
    sessions.insert(session_key, session);
}

fn remove_skill_sessions(
    sessions: &mut HashMap<String, SkillSession>,
    skill_name: &str,
    plugin_slug: &str,
) {
    sessions.retain(|_, existing| {
        !(existing.skill_name == skill_name && existing.plugin_slug == plugin_slug)
    });
}

fn resolve_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    settings
        .skills_path
        .ok_or_else(|| "Skills path not configured in settings".to_string())
}

async fn restore_skill_conversation_state(
    config: &crate::agents::runtime_config::OpenHandsRuntimeConfig,
    conversation_id: &str,
) -> Result<
    (
        Vec<crate::types::ConversationMessage>,
        Vec<crate::types::RestoredConversationEvent>,
        usize,
    ),
    String,
> {
    let events = crate::agents::openhands_server::list_openhands_conversation_events(
        config,
        conversation_id,
    )
    .await?;
    let restored_messages = crate::commands::refine::extract_conversation_messages(&events);
    let restored_transcript_events =
        crate::commands::refine::extract_restored_conversation_events(&events);
    let dispatched_user_turn_count =
        crate::commands::refine::restored_conversation_user_turn_count(&restored_transcript_events);
    Ok((
        restored_messages,
        restored_transcript_events,
        dispatched_user_turn_count,
    ))
}

#[tauri::command]
pub async fn select_skill_openhands_session(
    app: tauri::AppHandle,
    skill_name: String,
    plugin_slug: String,
    _workspace_path: String,
    sessions: tauri::State<'_, SkillSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    log::info!(
        "[select_skill_openhands_session] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;

    let runtime_ctx =
        crate::commands::refine::ensure_refine_runtime_ready(&app, &db, &skill_name, &plugin_slug)
            .await?;

    let session_config = crate::commands::refine::build_refine_openhands_config(
        &skill_name,
        &plugin_slug,
        "",
        &runtime_ctx.workspace_path,
        runtime_ctx.llm.clone(),
    );
    crate::agents::openhands_server::ensure_openhands_server(&session_config).await?;

    let saved_conversation_id = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        crate::db::get_skill_conversation_id(&conn, &plugin_slug, &skill_name)?
    };
    let active_conversation_id = crate::agents::openhands_server::start_openhands_session(
        &app,
        session_config,
        saved_conversation_id.clone(),
    )
    .await?;
    let session_config = crate::commands::refine::build_refine_openhands_config(
        &skill_name,
        &plugin_slug,
        "",
        &runtime_ctx.workspace_path,
        runtime_ctx.llm.clone(),
    );
    let (restored_messages, restored_transcript_events, dispatched_user_turn_count) =
        restore_skill_conversation_state(&session_config, &active_conversation_id).await?;

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!(
            "[select_skill_openhands_session] failed to acquire session lock: {}",
            e
        );
        e.to_string()
    })?;

    let session_key = skill_session_key(&skill_name, &plugin_slug);
    if map.iter().any(|(key, session)| {
        key != &session_key
            && session.skill_name == skill_name
            && session.plugin_slug == plugin_slug
    }) {
        log::info!(
            "[select_skill_openhands_session] removing stale session for skill '{}' before restart",
            skill_name
        );
    }

    let created_at = chrono::Utc::now().to_rfc3339();
    log::debug!(
        "[select_skill_openhands_session] creating session [REDACTED] for skill '{}'",
        skill_name
    );

    let skills_path = resolve_skills_path(&db)?;
    let head_sha_at_start = git2::Repository::open(Path::new(&skills_path))
        .ok()
        .and_then(|repo| {
            let head = repo.head().ok()?;
            let commit = head.peel_to_commit().ok()?;
            Some(commit.id().to_string())
        });

    upsert_skill_session(
        &mut map,
        session_key,
        SkillSession {
            skill_name: skill_name.clone(),
            plugin_slug: plugin_slug.clone(),
            usage_session_id: crate::commands::refine::protocol::new_skill_usage_session_id(
                &skill_name,
            ),
            conversation_id: Some(active_conversation_id.clone()),
            current_agent_id: None,
            dispatched_user_turn_count,
            head_sha_at_start,
        },
    );

    Ok(RefineSessionInfo {
        conversation_id: active_conversation_id,
        skill_name,
        created_at,
        available_agents: vec!["skill-creator".to_string()],
        restored_messages,
        restored_transcript_events,
    })
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseOpenHandsSessionInput {
    pub skill_name: String,
    pub plugin_slug: String,
    pub conversation_id: String,
    pub agent_id: Option<String>,
}

#[tauri::command]
pub async fn pause_openhands_session(
    input: PauseOpenHandsSessionInput,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, SkillSessionManager>,
) -> Result<(), String> {
    let PauseOpenHandsSessionInput {
        skill_name,
        plugin_slug,
        conversation_id,
        agent_id,
    } = input;

    if conversation_id.trim().is_empty() {
        return Err("pause_openhands_session requires a non-empty conversation_id".to_string());
    }

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    crate::commands::refine::protocol::ensure_skill_workspace_dir(
        &runtime_ctx.workspace_path,
        &plugin_slug,
        &skill_name,
    );

    let config = crate::commands::refine::build_refine_openhands_config(
        &skill_name,
        &plugin_slug,
        "",
        &runtime_ctx.workspace_path,
        runtime_ctx.llm.clone(),
    );

    let local_closed = crate::agents::openhands_server::pause_openhands_conversation(
        config,
        &conversation_id,
        agent_id.as_deref(),
    )
    .await?;

    log::info!(
        "[pause_openhands_session] skill={} plugin={} conversation_id={} local_closed={}",
        skill_name,
        plugin_slug,
        conversation_id,
        local_closed
    );

    if let Ok(mut map) = sessions.0.lock() {
        remove_skill_sessions(&mut map, &skill_name, &plugin_slug);
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        remove_skill_sessions, skill_session_key, upsert_skill_session, SkillSession,
    };
    use std::collections::HashMap;

    fn session(skill_name: &str, plugin_slug: &str, usage_session_id: &str) -> SkillSession {
        SkillSession {
            skill_name: skill_name.to_string(),
            plugin_slug: plugin_slug.to_string(),
            usage_session_id: usage_session_id.to_string(),
            conversation_id: None,
            current_agent_id: None,
            dispatched_user_turn_count: 0,
            head_sha_at_start: None,
        }
    }

    #[test]
    fn upsert_skill_session_removes_stale_entries_for_same_skill() {
        let mut sessions = HashMap::new();
        sessions.insert(
            "legacy-key".to_string(),
            session("sales-skill", "default", "usage-legacy"),
        );
        sessions.insert(
            skill_session_key("other-skill", "default"),
            session("other-skill", "default", "usage-other"),
        );

        let new_key = skill_session_key("sales-skill", "default");
        upsert_skill_session(
            &mut sessions,
            new_key.clone(),
            session("sales-skill", "default", "usage-new"),
        );

        assert_eq!(sessions.len(), 2);
        assert!(!sessions.contains_key("legacy-key"));
        assert_eq!(
            sessions
                .get(&new_key)
                .map(|session| session.usage_session_id.as_str()),
            Some("usage-new")
        );
        assert!(sessions.contains_key(&skill_session_key("other-skill", "default")));
    }

    #[test]
    fn remove_skill_sessions_clears_matching_entries_only() {
        let mut sessions = HashMap::new();
        sessions.insert(
            skill_session_key("sales-skill", "default"),
            session("sales-skill", "default", "usage-current"),
        );
        sessions.insert(
            "legacy-key".to_string(),
            session("sales-skill", "default", "usage-legacy"),
        );
        sessions.insert(
            skill_session_key("sales-skill", "custom"),
            session("sales-skill", "custom", "usage-custom"),
        );

        remove_skill_sessions(&mut sessions, "sales-skill", "default");

        assert_eq!(sessions.len(), 1);
        assert!(sessions.contains_key(&skill_session_key("sales-skill", "custom")));
    }
}
