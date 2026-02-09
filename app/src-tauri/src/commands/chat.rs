use crate::agents::sidecar::{self, AgentRegistry, SidecarConfig};
use crate::db::{self, Db};
use crate::types::*;
use uuid::Uuid;

#[tauri::command]
pub fn create_chat_session(
    skill_name: String,
    mode: String,
    db_state: tauri::State<'_, Db>,
) -> Result<ChatSessionRow, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    db::create_chat_session_row(&conn, &id, &skill_name, &mode)
}

#[tauri::command]
pub fn list_chat_sessions(
    skill_name: String,
    db_state: tauri::State<'_, Db>,
) -> Result<Vec<ChatSessionRow>, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    db::get_chat_sessions(&conn, &skill_name)
}

#[tauri::command]
pub fn add_chat_message(
    session_id: String,
    role: String,
    content: String,
    db_state: tauri::State<'_, Db>,
) -> Result<ChatMessageRow, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    db::add_chat_message_row(&conn, &id, &session_id, &role, &content)
}

#[tauri::command]
pub fn get_chat_messages(
    session_id: String,
    db_state: tauri::State<'_, Db>,
) -> Result<Vec<ChatMessageRow>, String> {
    let conn = db_state.0.lock().map_err(|e| e.to_string())?;
    db::get_chat_messages(&conn, &session_id)
}

#[tauri::command]
pub async fn run_chat_agent(
    skill_name: String,
    session_id: String,
    message: String,
    workspace_path: String,
    db_state: tauri::State<'_, Db>,
    registry: tauri::State<'_, AgentRegistry>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let api_key = {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let settings = db::read_settings(&conn)?;
        settings
            .anthropic_api_key
            .ok_or_else(|| "API key not configured".to_string())?
    };

    let conversation_context = {
        let conn = db_state.0.lock().map_err(|e| e.to_string())?;
        let messages = db::get_chat_messages(&conn, &session_id)?;
        messages
            .iter()
            .map(|m| format!("{}: {}", m.role, m.content))
            .collect::<Vec<_>>()
            .join("\n\n")
    };

    let cwd = format!("{}/{}", workspace_path, skill_name);
    let prompt = format!(
        "You are a skill editor helping modify and improve a skill definition.\n\
        The skill files are in the current directory.\n\
        \n\
        Previous conversation:\n{}\n\
        \n\
        User's request:\n{}",
        if conversation_context.is_empty() {
            "(none)".to_string()
        } else {
            conversation_context
        },
        message,
    );

    let agent_id = format!("chat-{}", Uuid::new_v4());

    let config = SidecarConfig {
        prompt,
        model: "claude-sonnet-4-5-20250929".to_string(),
        api_key,
        cwd,
        allowed_tools: Some(vec![
            "Read".into(),
            "Write".into(),
            "Edit".into(),
            "Glob".into(),
            "Grep".into(),
            "Bash".into(),
        ]),
        max_turns: Some(30),
        permission_mode: Some("bypassPermissions".into()),
        session_id: None,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        registry.inner().clone(),
        app,
    )
    .await?;

    Ok(agent_id)
}
