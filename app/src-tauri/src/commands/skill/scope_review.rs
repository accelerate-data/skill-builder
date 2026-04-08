use crate::db::Db;
use serde::Serialize;

#[derive(Serialize)]
pub struct ScopeReviewSuggestion {
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct ScopeReviewResult {
    pub status: String, // "focused" | "too-broad" | "name-needs-improvement" | "description-needs-improvement" | "both-need-improvement"
    pub reason: String,
    pub suggested_skills: Vec<ScopeReviewSuggestion>,
}

#[tauri::command]
pub async fn review_skill_scope(
    skill_name: String,
    description: String,
    purpose: String,
    context_questions: Option<String>,
    industry: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScopeReviewResult, String> {
    log::info!(
        "[review_skill_scope] skill={} purpose={}",
        skill_name,
        purpose
    );

    let (api_key, model, documents) = {
        let conn = db.0.lock().map_err(|e| {
            log::error!("[review_skill_scope] Failed to acquire DB lock: {}", e);
            e.to_string()
        })?;
        let settings = crate::db::read_settings(&conn).map_err(|e| {
            log::error!("[review_skill_scope] Failed to read settings: {}", e);
            e
        })?;
        let key = match settings.anthropic_api_key {
            Some(k) => crate::types::SecretString::new(k),
            None => {
                log::error!("[review_skill_scope] API key not configured");
                return Err("API key not configured".to_string());
            }
        };
        let model = crate::commands::workflow::resolve_model_id(
            settings.preferred_model.as_deref().filter(|s| !s.is_empty()).unwrap_or("sonnet"),
        );
        let docs = crate::db::db_list_documents(&conn)
            .unwrap_or_default()
            .into_iter()
            .filter(|d| d.scope == "all")
            .filter_map(|d| {
                std::fs::read_to_string(&d.file_path)
                    .ok()
                    .map(|content| (d.name, content))
            })
            .collect::<Vec<_>>();
        (key, model, docs)
    };

    let doc_context = if documents.is_empty() {
        String::new()
    } else {
        let parts: Vec<String> = documents
            .iter()
            .map(|(name, content)| {
                let end = content.floor_char_boundary(2000);
                let snippet = &content[..end];
                format!("### {}\n{}", name, snippet)
            })
            .collect();
        format!("\n\n## Reference Documents\n\n{}", parts.join("\n\n---\n\n"))
    };

    let industry_context = industry
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("\nIndustry context: {}", s))
        .unwrap_or_default();

    let context_questions_line = context_questions
        .as_deref()
        .filter(|s| !s.is_empty())
        .map(|s| format!("\n- What Claude needs to know: {}", s))
        .unwrap_or_default();

    let prompt = format!(
        "You are evaluating whether a Claude skill is well-defined. \
         Evaluate BOTH the name and the description independently.\n\n\
         ## Name rules\n\
         A good name uses the gerund pattern: verb-ing + specific object (kebab-case).\n\
         - Pass: forecasting-churned-customers, processing-purchase-orders, analyzing-salesforce-opportunities\n\
         - Fail: sales-analysis (not gerund), analyzing-data (object too vague)\n\n\
         ## Description rules\n\
         A good description acts on exactly ONE specific noun.\n\
         - The noun must be specific (\"churned customers\", \"purchase orders\") — not generic (\"sales data\", \"customers\")\n\
         - The data source is optional — adds clarity but not required to pass\n\
         - Multiple actions on one noun are fine (fetch + validate + update = still focused)\n\
         - Multiple nouns always fail, even if related or from the same system\n\n\
         ## Passing examples\n\
         - Name: forecasting-churned-customers | Description: \"Forecasts which customers are at risk of churning\" → focused\n\
         - Name: processing-purchase-orders | Description: \"Fetches, validates, and updates purchase orders\" → focused\n\n\
         ## Failing examples\n\
         - Description: \"Analyzes revenue, pipeline health, and rep performance\" → too-broad (three nouns)\n\
         - Name: analyzing-data | Description: \"Analyzes Salesforce opportunities\" → name-needs-improvement\n\
         - Description: \"Analyzes sales metrics\" → description-needs-improvement (noun too vague)\n\n\
         Use industry and document context to override a generic breadth signal. If documents show \
         that a topic in this company is one tightly scoped workflow, it may be focused — not broad.\n\n\
         Skill to evaluate:\n\
         - Name: {skill_name}\n\
         - Description: {description}\n\
         - Purpose: {purpose}{context_questions_line}{industry_context}{doc_context}\n\n\
         ## Status values\n\
         Return exactly one of:\n\
         - \"focused\": both name and description pass\n\
         - \"too-broad\": description covers multiple distinct nouns → suggest 3-5 decomposed skills\n\
         - \"name-needs-improvement\": description is focused, name fails gerund/specificity rules\n\
         - \"description-needs-improvement\": name is fine, description noun is too vague or generic\n\
         - \"both-need-improvement\": both name and description have issues (but not too-broad)\n\n\
         For all non-focused statuses, suggest 3-5 alternatives. All suggested names MUST use \
         the gerund pattern: verb-ing + specific object (kebab-case).\n\n\
         Gerund naming examples (correct vs incorrect):\n\
         - forecasting-churned-customers ✓ vs churn-forecast ✗\n\
         - calculating-opportunity-mrr ✓ vs opportunity-mrr-calculation ✗\n\
         - analyzing-rep-performance ✓ vs rep-performance-analysis ✗\n\
         - segmenting-enterprise-accounts ✓ vs enterprise-account-segmentation ✗\n\n\
         Rules for names:\n\
         - Start with a present-participle verb (forecasting, calculating, analyzing, segmenting, tracking, reporting)\n\
         - Follow with a specific object — not a generic noun like data, metrics, analysis\n\
         - Kebab-case throughout\n\
         - No acronyms unless industry-standard (e.g. mrr, arr, crm)\n\n\
         Rules for suggested descriptions:\n\
         - Write in third person (\"Extracts...\", \"Forecasts...\" — never \"I can\" or \"You can\")\n\
         - State what the skill does AND when to use it (triggers/contexts)\n\
         - Be specific — include key terms that appear in real user requests\n\
         - Avoid vague nouns: data, metrics, analysis, stuff, things\n\
         Good: \"Forecasts which customers are at risk of churning based on CRM activity signals. \
Use when the customer success team needs a prioritized list of at-risk accounts.\"\n\
         Avoid: \"Helps with customer data\"\n\n\
         Respond in English only.\n\n\
         Respond with JSON only (no markdown fences, no extra text):\n\
         {{\"status\": string, \"reason\": string, \"suggested_skills\": [{{\"name\": string, \"description\": string}}]}}",
        skill_name = skill_name,
        description = description,
        purpose = purpose,
        context_questions_line = context_questions_line,
        industry_context = industry_context,
        doc_context = doc_context,
    );

    log::debug!("[review_skill_scope] prompt length={}", prompt.len());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key.expose())
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": model,
                "max_tokens": 1024,
                "messages": [{"role": "user", "content": prompt}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| {
            log::error!("[review_skill_scope] API request failed: {}", e);
            format!("API request failed: {}", e)
        })?;

    if !resp.status().is_success() {
        let status = resp.status().as_u16();
        let body = resp.text().await.unwrap_or_default();
        log::error!("[review_skill_scope] API error ({}): {}", status, body);
        return Err(format!("Anthropic API error ({})", status));
    }

    let body: serde_json::Value = resp.json().await.map_err(|e| {
        log::error!(
            "[review_skill_scope] Failed to parse response JSON: {}",
            e
        );
        e.to_string()
    })?;

    let text = body["content"][0]["text"].as_str().ok_or_else(|| {
        log::error!("[review_skill_scope] No text in API response");
        "No text in API response".to_string()
    })?;

    log::debug!("[review_skill_scope] raw response={}", text);

    let cleaned = text.trim();
    let cleaned = cleaned
        .strip_prefix("```json")
        .or_else(|| cleaned.strip_prefix("```"))
        .unwrap_or(cleaned);
    let cleaned = cleaned.strip_suffix("```").unwrap_or(cleaned).trim();

    let parsed: serde_json::Value = serde_json::from_str(cleaned).map_err(|e| {
        log::error!(
            "[review_skill_scope] Failed to parse result: raw text={}",
            text
        );
        format!("Failed to parse result: {}", e)
    })?;

    let valid_statuses = ["focused", "too-broad", "name-needs-improvement", "description-needs-improvement", "both-need-improvement"];
    let status = parsed["status"]
        .as_str()
        .filter(|s| valid_statuses.contains(s))
        .unwrap_or("focused")
        .to_string();
    let reason = parsed["reason"].as_str().unwrap_or("").to_string();
    let suggested_skills: Vec<ScopeReviewSuggestion> = parsed["suggested_skills"]
        .as_array()
        .map(|arr| {
            arr.iter()
                .filter_map(|s| {
                    let name = s["name"].as_str()?.to_string();
                    let description = s["description"].as_str()?.to_string();
                    Some(ScopeReviewSuggestion { name, description })
                })
                .collect()
        })
        .unwrap_or_default();

    log::info!(
        "[review_skill_scope] result: status={} suggestions={}",
        status,
        suggested_skills.len()
    );

    Ok(ScopeReviewResult {
        status,
        reason,
        suggested_skills,
    })
}
