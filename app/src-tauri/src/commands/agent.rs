use crate::agents::sidecar::{self, SidecarConfig};
use crate::agents::sidecar_pool::SidecarPool;
use crate::db::Db;

#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn start_agent(
    app: tauri::AppHandle,
    pool: tauri::State<'_, SidecarPool>,
    db: tauri::State<'_, Db>,
    agent_id: String,
    prompt: String,
    model: String,
    cwd: String,
    allowed_tools: Option<Vec<String>>,
    max_turns: Option<u32>,
    session_id: Option<String>,
    skill_name: String,
    _step_label: String,
    agent_name: Option<String>,
) -> Result<String, String> {
    log::info!(
        "[start_agent] agent_id={} model={} skill_name={} agent_name={:?}",
        agent_id, model, skill_name, agent_name
    );
    let (api_key, extended_context, extended_thinking) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[start_agent] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn)?;
        let key = settings
            .anthropic_api_key
            .ok_or_else(|| "Anthropic API key not configured".to_string())?;
        (key, settings.extended_context, settings.extended_thinking)
    };

    let thinking_budget: Option<u32> = if extended_thinking {
        Some(16_000)
    } else {
        None
    };

    let config = SidecarConfig {
        prompt,
        model: Some(model.clone()),
        api_key,
        cwd,
        allowed_tools,
        max_turns,
        permission_mode: None,
        session_id,
        betas: crate::commands::workflow::build_betas(extended_context, thinking_budget, &model),
        max_thinking_tokens: thinking_budget,
        path_to_claude_code_executable: None,
        agent_name,
    };

    sidecar::spawn_sidecar(
        agent_id.clone(),
        config,
        pool.inner().clone(),
        app,
        skill_name,
    )
    .await?;

    Ok(agent_id)
}
