use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::Manager;

use crate::commands::imported_skills::validate_skill_name;
use crate::db::{self, Db};
use crate::types::SkillSessionInfo;

pub fn build_skill_session_config(
    skill_name: &str,
    plugin_slug: &str,
    prompt: &str,
    app_data_root: &str,
    skills_root: &str,
    llm: crate::types::WorkflowLlmConfig,
) -> crate::agents::runtime_config::OpenHandsRuntimeConfig {
    crate::agents::skill_creator::build_skill_creator_config(
        crate::agents::skill_creator::SkillCreatorConfigParams {
            app_data_root,
            skill_name,
            prompt,
            skills_root,
            plugin_slug,
            llm,
            task_kind: "refine",
            run_source: "refine",
            allowed_tools: vec!["file_editor".to_string(), "terminal".to_string()],
            max_turns: 500,
            step_id: -10,
            output_format: None,
        },
    )
}

pub(crate) async fn ensure_skill_runtime_ready(
    app: &tauri::AppHandle,
    db: &crate::db::Db,
    skill_name: &str,
    plugin_slug: &str,
) -> Result<crate::commands::workflow::settings::InitializedRuntimeContext, String> {
    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(db)?;
    let skill_dir = crate::skill_paths::ensure_nested_skill_dir(
        Path::new(&runtime_ctx.workspace_path),
        plugin_slug,
        skill_name,
    )?;
    if !skill_dir.exists() {
        std::fs::create_dir_all(&skill_dir).map_err(|e| {
            format!(
                "Failed to create skill directory '{}': {}",
                skill_dir.display(),
                e
            )
        })?;
    }
    crate::commands::workflow::deploy::seed_skill_agents_dir(app, &skill_dir)?;
    Ok(runtime_ctx)
}

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

fn restore_skill_conversation_state(
    events: &[serde_json::Value],
) -> (
    Vec<crate::types::ConversationMessage>,
    Vec<crate::types::RestoredConversationEvent>,
    usize,
) {
    let restored_messages = crate::commands::refine::events::extract_conversation_messages(events);
    let restored_transcript_events =
        crate::commands::refine::events::extract_restored_conversation_events(events);
    let dispatched_user_turn_count =
        crate::commands::refine::events::restored_conversation_user_turn_count(&restored_transcript_events);
    (
        restored_messages,
        restored_transcript_events,
        dispatched_user_turn_count,
    )
}

pub(crate) fn acquire_or_verify_skill_lock(
    conn: &rusqlite::Connection,
    skill_id: i64,
    instance_id: &str,
    pid: u32,
) -> Result<crate::types::SkillMasterRow, String> {
    crate::db::acquire_skill_lock_by_skill_id(conn, skill_id, instance_id, pid)?;
    crate::db::get_skill_master_by_id(conn, skill_id)?
        .ok_or_else(|| format!("Skill id {} was not found in the skills master", skill_id))
}

#[tauri::command]
pub async fn select_skill_openhands_session(
    app: tauri::AppHandle,
    skill_id: i64,
    instance: tauri::State<'_, crate::InstanceInfo>,
    sessions: tauri::State<'_, SkillSessionManager>,
    db: tauri::State<'_, Db>,
) -> Result<SkillSessionInfo, String> {
    let (skill_name, plugin_slug, saved_conversation_id) = {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let skill = acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            &instance.id,
            instance.pid,
        )?;
        let saved_conversation_id =
            crate::db::get_skill_conversation_id(&conn, &skill.plugin_slug, &skill.name)?;
        (skill.name, skill.plugin_slug, saved_conversation_id)
    };

    log::info!(
        "[select_skill_openhands_session] skill_id={} skill={} plugin={}",
        skill_id,
        skill_name,
        plugin_slug
    );

    // Run all post-lock-acquisition work in an async block so we can release
    // the lock on any failure — the frontend no longer has a releaseLock in its
    // error path, so the backend must clean up after itself.
    let result = async {
        validate_skill_name(&skill_name)?;

        let runtime_ctx = ensure_skill_runtime_ready(&app, &db, &skill_name, &plugin_slug).await?;

        let skills_path = resolve_skills_path(&db)?;
        let app_data_root = app
            .path()
            .app_data_dir()
            .map_err(|e| format!("failed to resolve app data dir: {e}"))?
            .to_string_lossy()
            .replace('\\', "/");
        let session_config = build_skill_session_config(
            &skill_name,
            &plugin_slug,
            "",
            &app_data_root,
            &skills_path,
            runtime_ctx.llm.clone(),
        );
        let started_session = crate::agents::skill_creator::ensure_skill_session(
            &app,
            session_config,
            saved_conversation_id,
        )
        .await?;
        let active_conversation_id = started_session.conversation_id.clone();
        let (restored_messages, restored_transcript_events, dispatched_user_turn_count) =
            restore_skill_conversation_state(&started_session.restored_events);

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

        Ok(SkillSessionInfo {
            conversation_id: active_conversation_id,
            skill_name,
            created_at,
            available_agents: vec!["skill-creator".to_string()],
            restored_messages,
            restored_transcript_events,
        })
    }
    .await;

    // Release the lock if any post-acquisition step failed.
    if result.is_err() {
        if let Ok(conn) = db.0.lock() {
            let _ = crate::db::release_skill_lock_by_skill_id(&conn, skill_id, &instance.id);
        }
    }

    result
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PauseOpenHandsSessionInput {
    pub skill_name: String,
    pub plugin_slug: String,
    pub conversation_id: String,
    pub agent_id: Option<String>,
    /// When provided, the skill lock is released after pausing.
    /// Used by `leaveCurrentSkill` to keep lock ownership in the backend.
    pub skill_id: Option<i64>,
}

#[tauri::command]
pub async fn pause_openhands_session(
    app: tauri::AppHandle,
    input: PauseOpenHandsSessionInput,
    db: tauri::State<'_, Db>,
    sessions: tauri::State<'_, SkillSessionManager>,
    instance: tauri::State<'_, crate::InstanceInfo>,
) -> Result<(), String> {
    let PauseOpenHandsSessionInput {
        skill_name,
        plugin_slug,
        conversation_id,
        agent_id,
        skill_id,
    } = input;

    if conversation_id.trim().is_empty() {
        return Err("pause_openhands_session requires a non-empty conversation_id".to_string());
    }

    let runtime_ctx = crate::commands::workflow::read_initialized_runtime_context(&db)?;
    let skills_root = resolve_skills_path(&db)?;
    let skill_dir = crate::skill_paths::resolve_skill_dir(
        Path::new(&skills_root),
        &plugin_slug,
        &skill_name,
    );
    if !skill_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(&skill_dir) {
            log::warn!(
                "[pause_openhands_session] failed to create skill dir '{}': {}",
                skill_dir.display(),
                e
            );
        }
    }

    let skills_path = resolve_skills_path(&db)?;
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");
    let config = build_skill_session_config(
        &skill_name,
        &plugin_slug,
        "",
        &app_data_root,
        &skills_path,
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

    // Release the skill lock when the caller explicitly provides the skill ID.
    // This keeps lock ownership entirely in the backend — the frontend no longer
    // calls `release_lock` directly.
    if let Some(sid) = skill_id {
        if let Ok(conn) = db.0.lock() {
            let _ = crate::db::release_skill_lock_by_skill_id(&conn, sid, &instance.id);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        acquire_or_verify_skill_lock, remove_skill_sessions, skill_session_key, upsert_skill_session,
        SkillSession,
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
    fn acquire_or_verify_skill_lock_acquires_missing_lock_for_current_instance() {
        let conn = crate::db::create_test_db_for_tests();
        let skill_id =
            crate::db::upsert_skill(&conn, "locked-skill", "skill-builder", "domain").unwrap();

        let skill =
            acquire_or_verify_skill_lock(&conn, skill_id, "instance-a", std::process::id())
                .unwrap();

        assert_eq!(skill.id, skill_id);

        let lock = crate::db::get_skill_lock_by_skill_id(&conn, skill_id)
            .unwrap()
            .expect("lock row");
        assert_eq!(lock.instance_id, "instance-a");
    }

    #[test]
    fn acquire_or_verify_skill_lock_rejects_other_instance_lease() {
        let conn = crate::db::create_test_db_for_tests();
        let skill_id =
            crate::db::upsert_skill(&conn, "locked-skill", "skill-builder", "domain").unwrap();
        crate::db::acquire_skill_lock_by_skill_id(
            &conn,
            skill_id,
            "instance-b",
            std::process::id(),
        )
        .unwrap();

        let error =
            acquire_or_verify_skill_lock(&conn, skill_id, "instance-a", std::process::id())
                .unwrap_err();

        assert_eq!(
            error,
            "Skill 'locked-skill' is being edited in another instance"
        );
    }

    #[test]
    fn acquire_then_release_lock_allows_other_instance_to_acquire() {
        let conn = crate::db::create_test_db_for_tests();
        let skill_id =
            crate::db::upsert_skill(&conn, "release-test", "skill-builder", "domain").unwrap();

        acquire_or_verify_skill_lock(&conn, skill_id, "instance-a", std::process::id()).unwrap();

        let lock = crate::db::get_skill_lock_by_skill_id(&conn, skill_id)
            .unwrap()
            .expect("lock row exists");
        assert_eq!(lock.instance_id, "instance-a");

        crate::db::release_skill_lock_by_skill_id(&conn, skill_id, "instance-a").unwrap();

        let lock_after = crate::db::get_skill_lock_by_skill_id(&conn, skill_id).unwrap();
        assert!(
            lock_after.is_none(),
            "lock should be gone after release"
        );

        let skill =
            acquire_or_verify_skill_lock(&conn, skill_id, "instance-b", std::process::id())
                .unwrap();
        assert_eq!(skill.id, skill_id);
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
