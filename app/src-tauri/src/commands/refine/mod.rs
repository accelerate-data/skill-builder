pub mod content;
pub mod diff;
pub(crate) mod events;
pub mod output;
pub(crate) mod protocol;

use serde::Deserialize;
use tauri::Manager;

use crate::db::{self, Db};
use crate::skill_paths::resolve_skill_dir;
use crate::types::RefineDispatchResult;

use protocol::*;

pub(crate) use crate::commands::skill_session::skill_session_key;
pub use crate::commands::skill_session::{SkillSession, SkillSessionManager};

// ─── Shared helper ───────────────────────────────────────────────────────────

pub(crate) fn resolve_skills_path(db: &Db) -> Result<String, String> {
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let settings = db::read_settings(&conn)?;
    settings
        .skills_path
        .ok_or_else(|| "Skills path not configured in settings".to_string())
}

/// Resolve the directory that contains SKILL.md for the given skill.
pub(super) fn resolve_skill_output_dir(
    plugin_slug: &str,
    skill_name: &str,
    skills_path: &str,
) -> Result<std::path::PathBuf, String> {
    Ok(resolve_skill_dir(
        std::path::Path::new(skills_path),
        plugin_slug,
        skill_name,
    ))
}

fn load_refine_prompt_context(
    db: &Db,
    skill_name: &str,
    workspace_path: &str,
) -> Result<(String, String, String), String> {
    let settings = crate::commands::workflow::settings::read_workflow_settings(
        db,
        skill_name,
        0,
        workspace_path,
    )?;

    let user_context_block = crate::commands::workflow::prompt::format_user_context(
        Some(skill_name),
        &settings.tags,
        settings.author_login.as_deref(),
        settings.industry.as_deref(),
        settings.function_role.as_deref(),
        settings.intake_json.as_deref(),
        settings.description.as_deref(),
        Some(&settings.purpose),
        settings.version.as_deref(),
        settings.user_invocable,
        settings.disable_model_invocation,
        &settings.documents,
    )
    .unwrap_or_else(|| "No additional user context available.".to_string());

    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let clarifications_json =
        match crate::db::workflow_artifacts::read_clarifications(&conn, skill_name) {
            Ok(Some(record)) => {
                crate::commands::workflow::prompt::clarifications_record_to_json_string(&record)
            }
            Ok(None) => "{}".to_string(),
            Err(error) => {
                log::warn!(
                    "[load_refine_prompt_context] failed to load clarifications for skill='{}': {}",
                    skill_name,
                    error
                );
                "{}".to_string()
            }
        };
    let decisions_json = match crate::db::workflow_artifacts::read_decisions(&conn, skill_name) {
        Ok(Some(record)) => {
            crate::commands::workflow::prompt::decisions_record_to_json_string(&record)
        }
        Ok(None) => "{}".to_string(),
        Err(error) => {
            log::warn!(
                "[load_refine_prompt_context] failed to load decisions for skill='{}': {}",
                skill_name,
                error
            );
            "{}".to_string()
        }
    };

    Ok((user_context_block, clarifications_json, decisions_json))
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum RefineConversationDispatchPlan {
    ReuseExisting(String),
}

fn normalize_conversation_id(value: Option<String>) -> Option<String> {
    value.and_then(|candidate| {
        let trimmed = candidate.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    })
}

fn plan_refine_conversation_dispatch(
    session: &SkillSession,
    requested_conversation_id: Option<String>,
) -> Result<RefineConversationDispatchPlan, String> {
    let requested_conversation_id = normalize_conversation_id(requested_conversation_id);

    let active_conversation_id = session.conversation_id.clone().ok_or_else(|| {
        format!(
            "Refine session for skill '{}' plugin '{}' has no active conversation",
            session.skill_name, session.plugin_slug
        )
    })?;

    if let Some(requested_conversation_id) = requested_conversation_id {
        if requested_conversation_id != active_conversation_id {
            return Err(format!(
                "Refine conversation mismatch for skill '{}' plugin '{}'",
                session.skill_name, session.plugin_slug
            ));
        }
    }

    Ok(RefineConversationDispatchPlan::ReuseExisting(
        active_conversation_id,
    ))
}

// ─── send_refine_message ─────────────────────────────────────────────────────

/// Send a user message to the refine agent and stream responses back.
///
/// The selected skill already owns a persistent OpenHands conversation.
/// This command only dispatches the next user turn into that conversation.
///
/// Returns both the `agent_id` and the active `conversation_id` so the
/// frontend can keep its Refine session store aligned with the backend.
#[tauri::command]
pub async fn send_refine_message(
    input: SendRefineMessageInput,
    sessions: tauri::State<'_, SkillSessionManager>,
    db: tauri::State<'_, Db>,
    app: tauri::AppHandle,
    instance: tauri::State<'_, crate::InstanceInfo>,
) -> Result<RefineDispatchResult, String> {
    let SendRefineMessageInput {
        skill_name,
        plugin_slug,
        conversation_id,
        user_message,
        target_files,
    } = input;

    {
        let conn = db.0.lock().map_err(|e| e.to_string())?;
        let skill_id =
            crate::db::get_skill_master_id_in_plugin(&conn, &skill_name, &plugin_slug)?
                .ok_or_else(|| {
                    format!(
                        "Skill '{}' in plugin '{}' was not found in the skills master",
                        skill_name, plugin_slug
                    )
                })?;
        crate::commands::skill_session::acquire_or_verify_skill_lock(
            &conn,
            skill_id,
            &instance.id,
            instance.pid,
        )?;
    }

    let session_key = skill_session_key(&skill_name, &plugin_slug);
    let (is_first_turn, dispatch_plan) = {
        let map = sessions.0.lock().map_err(|e| {
            log::error!(
                "[send_refine_message] failed to acquire session lock: {}",
                e
            );
            e.to_string()
        })?;
        let session = map.get(&session_key).ok_or_else(|| {
            let active: Vec<String> = map.values().map(|s| s.skill_name.clone()).collect();
            let msg = format!(
                "No refine session found. Active sessions ({}): [{}]",
                map.len(),
                active.join(", ")
            );
            log::error!("[send_refine_message] {}", msg);
            msg
        })?;
        let dispatch_plan = plan_refine_conversation_dispatch(session, conversation_id)?;
        (session.dispatched_user_turn_count == 0, dispatch_plan)
    };

    let runtime_ctx = crate::commands::skill_session::ensure_skill_runtime_ready(
        &app,
        &db,
        &skill_name,
        &plugin_slug,
    )
    .await?;

    let prompt = if is_first_turn {
        let skills_path = resolve_skills_path(&db)?;
        let (user_context_block, clarifications_json, decisions_json) =
            load_refine_prompt_context(&db, &skill_name, &runtime_ctx.workspace_path)?;
        build_refine_prompt_with_output_dir(RefinePromptRequest {
            skill_name: &skill_name,
            workspace_path: &runtime_ctx.workspace_path,
            plugin_slug: &plugin_slug,
            skill_output_dir: &resolve_skill_output_dir(&plugin_slug, &skill_name, &skills_path)?,
            user_message: &user_message,
            target_files: target_files.as_deref(),
            context: RefinePromptContext {
                user_context_block: &user_context_block,
                clarifications_json: &clarifications_json,
                decisions_json: &decisions_json,
            },
        })
    } else {
        user_message.clone()
    };

    let skills_path = resolve_skills_path(&db)?;
    let app_data_root = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("failed to resolve app data dir: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");
    let config = crate::commands::skill_session::build_skill_session_config(
        &skill_name,
        &plugin_slug,
        &prompt,
        &app_data_root,
        &skills_path,
        runtime_ctx.llm.clone(),
    );
    let agent_id = format!(
        "refine-{}-{}",
        skill_name,
        chrono::Utc::now().timestamp_millis()
    );

    let RefineConversationDispatchPlan::ReuseExisting(active_conversation_id) = dispatch_plan;

    log::info!(
        "[send_refine_message] skill={} plugin={} conversation_id={}",
        skill_name,
        plugin_slug,
        active_conversation_id
    );

    let returned_conversation_id = crate::agents::openhands_server::send_openhands_message(
        &app,
        &agent_id,
        config,
        active_conversation_id,
    )
    .await?;

    {
        let mut map = sessions.0.lock().map_err(|e| e.to_string())?;
        if let Some(session) = map.get_mut(&session_key) {
            session.conversation_id = Some(returned_conversation_id.clone());
            session.current_agent_id = Some(agent_id.clone());
            session.dispatched_user_turn_count += 1;
        }
    }

    Ok(RefineDispatchResult {
        agent_id,
        conversation_id: returned_conversation_id,
    })
}

#[cfg(test)]
mod tests;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRefineMessageInput {
    pub skill_name: String,
    pub plugin_slug: String,
    pub conversation_id: Option<String>,
    pub user_message: String,
    pub target_files: Option<Vec<String>>,
}
