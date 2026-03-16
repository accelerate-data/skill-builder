use crate::db::Db;
use serde::Serialize;

#[derive(Serialize)]
pub struct FieldSuggestions {
    pub description: String,
    pub domain: String,
    pub audience: String,
    pub challenges: String,
    pub scope: String,
    pub unique_setup: String,
    pub claude_mistakes: String,
    pub context_questions: String,
}

/// Call Haiku to generate field suggestions in cascading groups.
/// The `fields` param controls which fields to generate; context params provide
/// prior field values so each group builds on the last.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn generate_suggestions(
    skill_name: String,
    purpose: String,
    industry: Option<String>,
    function_role: Option<String>,
    domain: Option<String>,
    scope: Option<String>,
    audience: Option<String>,
    challenges: Option<String>,
    fields: Option<Vec<String>>,
    db: tauri::State<'_, Db>,
) -> Result<FieldSuggestions, String> {
    log::info!(
        "[generate_suggestions] skill={} purpose={} fields={:?}",
        skill_name,
        purpose,
        fields
    );

    let api_key = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[generate_suggestions] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings_hydrated(&conn).map_err(|e| {
            log::error!("[generate_suggestions] Failed to read settings: {}", e);
            e
        })?;
        match settings.anthropic_api_key {
            Some(k) => crate::types::SecretString::new(k),
            None => {
                log::error!("[generate_suggestions] API key not configured");
                return Err("API key not configured".to_string());
            }
        }
    };

    let readable_name = skill_name.replace('-', " ");

    let context_parts: Vec<String> = [
        industry
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Industry: {}", s)),
        function_role
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Role: {}", s)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let context = if context_parts.is_empty() {
        String::new()
    } else {
        format!(" User context: {}.", context_parts.join(", "))
    };

    // Build skill detail context from prior fields
    let detail_parts: Vec<String> = [
        domain
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Domain: {}", s)),
        scope
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Scope: {}", s)),
        audience
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Target audience: {}", s)),
        challenges
            .as_deref()
            .filter(|s| !s.is_empty())
            .map(|s| format!("Key challenges: {}", s)),
    ]
    .into_iter()
    .flatten()
    .collect();

    let detail_context = if detail_parts.is_empty() {
        String::new()
    } else {
        format!(" Skill details: {}.", detail_parts.join("; "))
    };

    let framing = match purpose.as_str() {
        "data-engineering" | "source" | "platform" => {
            "Skills are loaded into Claude Code to help engineers build data pipelines. \
             Claude already knows standard methodologies from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that Claude gets wrong or misses when working without the skill."
        }
        _ => {
            "Skills are loaded into Claude Code to help users work effectively in their specific domain. \
             Claude already has broad general knowledge from its training data. \
             A skill must encode the delta -- the customer-specific and domain-specific knowledge \
             that Claude gets wrong or misses when working without the skill."
        }
    };

    // Determine which fields to generate (default: all)
    let all_fields = vec![
        "description",
        "domain",
        "scope",
        "audience",
        "challenges",
        "unique_setup",
        "claude_mistakes",
        "context_questions",
    ];
    let requested: Vec<&str> = fields
        .as_ref()
        .map(|f| f.iter().map(|s| s.as_str()).collect())
        .unwrap_or_else(|| all_fields.clone());

    // Build JSON schema for requested fields only
    let field_schemas: Vec<String> = requested.iter().filter_map(|f| {
        match *f {
            "description" => Some(format!(
                "\"description\": \"<1-2 sentence description of what this skill does for {}>\"",
                readable_name
            )),
            "domain" => Some("\"domain\": \"<2-5 word domain name, e.g. Sales operations or Revenue recognition>\"".to_string()),
            "scope" => Some("\"scope\": \"<short phrase, e.g. Focus on revenue analytics and reporting>\"".to_string()),
            "audience" => Some("\"audience\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Senior data engineers\\n• Analytics leads owning pipeline architecture>\"".to_string()),
            "challenges" => Some("\"challenges\": \"<2-3 short bullet points starting with • on separate lines, e.g. • Late-arriving dimensions\\n• Schema drift across environments>\"".to_string()),
            "unique_setup" => Some(format!(
                "\"unique_setup\": \"<2-3 short bullet points starting with • on separate lines describing what makes a typical {} setup for {} different from standard implementations>\"",
                purpose, readable_name
            )),
            "claude_mistakes" => Some(format!(
                "\"claude_mistakes\": \"<2-3 short bullet points starting with • on separate lines describing what Claude gets wrong when working with {} in the {} domain>\"",
                readable_name, purpose
            )),
            "context_questions" => {
                let purpose_label = match purpose.as_str() {
                    "domain" => "Business process knowledge",
                    "source" => "Source system customizations",
                    "data-engineering" => "Organization specific data engineering standards",
                    "platform" => "Organization specific Azure or Fabric standards",
                    _ => &purpose,
                };
                Some(format!(
                    "\"context_questions\": \"<exactly 2 bullets starting with \u{2022} on separate lines, 2-4 words each. Bullet 1: what is unique about this {} setup. Bullet 2: what does Claude usually miss. Be specific to {}.>\"",
                    purpose_label, readable_name
                ))
            }
            _ => None,
        }
    }).collect();

    let prompt = format!(
        "{framing}\n\n\
         Given a Claude skill named \"{readable_name}\" of type \"{purpose}\".{context}{detail_context}\n\n\
         Suggest brief values for these fields. Be specific and practical, not generic.\n\n\
         Respond in exactly this JSON format (no markdown, no extra text):\n\
         {{{}}}", field_schemas.join(", ")
    );

    log::debug!("[generate_suggestions] prompt={}", prompt);

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.expose())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": "claude-haiku-4-5",
                "max_tokens": 500,
                "messages": [{"role": "user", "content": prompt}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| {
            log::error!("[generate_suggestions] API request failed: {}", e);
            format!("API request failed: {}", e)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        log::error!("[generate_suggestions] API error ({}): {}", status, body);
        return Err(format!("Anthropic API error ({})", status));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!(
            "[generate_suggestions] Failed to parse response JSON: {}",
            e
        );
        e.to_string()
    })?;
    let text = body["content"][0]["text"].as_str().ok_or_else(|| {
        log::error!("[generate_suggestions] No text in API response");
        "No text in API response".to_string()
    })?;

    log::debug!("[generate_suggestions] raw response={}", text);

    // Strip markdown fences if the model wrapped its response (e.g. ```json\n...\n```)
    let cleaned = text.trim();
    let cleaned = cleaned
        .strip_prefix("```json")
        .or_else(|| cleaned.strip_prefix("```"))
        .unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();

    let suggestions: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        log::error!(
            "[generate_suggestions] Failed to parse suggestions: raw text={}",
            text
        );
        format!("Failed to parse suggestions: {}", e)
    })?;

    let field = |key: &str| -> String { suggestions[key].as_str().unwrap_or("").to_string() };

    Ok(FieldSuggestions {
        description: field("description"),
        domain: field("domain"),
        audience: field("audience"),
        challenges: field("challenges"),
        scope: field("scope"),
        unique_setup: field("unique_setup"),
        claude_mistakes: field("claude_mistakes"),
        context_questions: field("context_questions"),
    })
}
