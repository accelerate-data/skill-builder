use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Deserialize;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::types::RefineSessionInfo;

pub struct RefineSession {
    pub skill_name: String,
    pub plugin_slug: String,
    #[allow(dead_code)]
    pub usage_session_id: String,
    pub conversation_id: Option<String>,
    pub current_agent_id: Option<String>,
    pub dispatched_user_turn_count: usize,
    pub head_sha_at_start: Option<String>,
}

pub struct RefineSessionManager(pub Mutex<HashMap<String, RefineSession>>);

impl RefineSessionManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

pub(crate) fn refine_session_key(skill_name: &str, plugin_slug: &str) -> String {
    format!("{}::{}", plugin_slug, skill_name)
}

fn resolve_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    settings
        .skills_path
        .ok_or_else(|| "Skills path not configured in settings".to_string())
}

#[tauri::command]
pub async fn select_skill_openhands_session(
    app: tauri::AppHandle,
    skill_name: String,
    plugin_slug: String,
    _workspace_path: String,
    sessions: tauri::State<'_, RefineSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<RefineSessionInfo, String> {
    log::info!(
        "[select_skill_openhands_session] skill={} plugin={}",
        skill_name,
        plugin_slug
    );
    validate_skill_name(&skill_name)?;

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    crate::commands::workflow::ensure_workspace_prompts(&app, &runtime_ctx.workspace_path).await?;
    crate::commands::refine::protocol::ensure_skill_workspace_dir(
        &runtime_ctx.workspace_path,
        &plugin_slug,
        &skill_name,
    );

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
    let restored_messages = Vec::new();
    let restored_transcript_events = Vec::new();

    let mut map = sessions.0.lock().map_err(|e| {
        log::error!(
            "[select_skill_openhands_session] failed to acquire session lock: {}",
            e
        );
        e.to_string()
    })?;

    let session_key = refine_session_key(&skill_name, &plugin_slug);
    if let Some(stale_id) = map
        .iter()
        .find(|(_, s)| s.skill_name == skill_name && s.plugin_slug == plugin_slug)
        .map(|(id, _)| id.clone())
    {
        log::info!(
            "[select_skill_openhands_session] removing stale session for skill '{}' before restart",
            skill_name
        );
        map.remove(&stale_id);
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

    map.insert(
        session_key,
        RefineSession {
            skill_name: skill_name.clone(),
            plugin_slug: plugin_slug.clone(),
            usage_session_id: crate::commands::refine::protocol::new_refine_usage_session_id(
                &skill_name,
            ),
            conversation_id: Some(active_conversation_id.clone()),
            current_agent_id: None,
            dispatched_user_turn_count: 0,
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
    sessions: tauri::State<'_, RefineSessionManager>,
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

    let session_key = refine_session_key(&skill_name, &plugin_slug);
    if let Ok(mut map) = sessions.0.lock() {
        map.remove(&session_key);
    }

    Ok(())
}
