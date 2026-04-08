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
         These skills are used to build data warehouses and lakehouses — OLAP systems, not OLTP. \
         The data source is valuable context but not compulsory.\n\n\
         CORE TEST: Does the description describe exactly the process named by the skill? \
         If yes → focused. If the description wanders into a second process → fail.\n\n\
         ## Name rule\n\
         A good name uses the gerund pattern: verb-ing + specific object (kebab-case).\n\
         Pass: forecasting-churned-customers, validating-grain-feed-compliance\n\
         Fail: sales-analysis (not gerund), analyzing-data (object too vague)\n\n\
         ## Description rule\n\
         A good description serves ONE overarching process — the same process named by the skill.\n\
         Number of nouns does not matter — many nouns are fine if they all fall under one process.\n\
         Pass: validating-grain-feed-compliance covers quality testing + traceability docs + supplier audits → all serve one process → pass\n\
         Fail: description spans two distinct processes (e.g. vendor selection + cost analysis) → split\n\
         Always fail: nouns from different business functions → split\n\
         Use general business knowledge for process boundaries. Uploaded documents can override.\n\n\
         ## Four cases — pick exactly one status and follow its action\n\n\
         CASE 1 — name too broad/vague, description fits one process → status: \"name-needs-improvement\"\n\
         Example: name=sales-analysis, description=\"Forecasts which customers are at risk of churning\"\n\
         Action: derive the correct gerund name DIRECTLY from the description. Return exactly 1 suggestion (correct name + existing description).\n\
         Reason: explain the name does not reflect the process already in the description.\n\n\
         CASE 2 — both name and description span multiple distinct processes → status: \"too-broad\"\n\
         Example: name=sales-analysis, description=\"Analyzes revenue, pipeline health, and rep performance\"\n\
         Action: split into 3-5 focused skills. Anchor suggested names to the original name where possible.\n\
         Reason: name the distinct processes found.\n\n\
         CASE 3 — both name and description too vague to identify a clear process → status: \"both-need-improvement\"\n\
         Example: name=analyzing-data, description=\"Analyzes sales metrics for the team\"\n\
         Action: make 3-5 best-guess suggestions.\n\
         Reason: be transparent — state that both are too vague and suggestions may not match intent.\n\n\
         CASE 4 — name is focused, description wanders into one or more extra processes → status: \"description-needs-improvement\"\n\
         Example: name=forecasting-churned-customers, description=\"Forecasts churn risk and tracks renewal pipeline health\"\n\
         Action: produce 1 suggestion per process found — (1) original name + description trimmed to match, then one additional suggestion per stray process (new gerund name + description for each).\n\
         Reason: name each stray process found.\n\n\
         Use industry and document context to override a generic breadth signal.\n\n\
         Skill to evaluate:\n\
         - Name: {skill_name}\n\
         - Description: {description}\n\
         - Purpose: {purpose}{context_questions_line}{industry_context}{doc_context}\n\n\
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
         - State what the skill does AND when to use it (one trigger, not a list)\n\
         - Be specific — include key terms that appear in real user requests\n\
         - Avoid vague nouns: data, metrics, analysis, stuff, things\n\
         - CRITICAL: each suggested description must itself pass the same evaluation criteria — \
one specific noun, no listing of multiple contexts or scenarios with \"or\". \
If the \"Use when...\" clause would list multiple scenarios, split them into separate suggestions instead.\n\
         Good: \"Forecasts which customers are at risk of churning based on health scores. \
Use when the customer success team needs a prioritized list of at-risk accounts.\"\n\
         Bad: \"Forecasts churn risk using health scores or activity signals or NPS data.\" \
(multiple sources listed with or)\n\
         Bad: \"Use when sourcing grain vendors or pricing trends or quality specs.\" \
(multiple contexts listed with or — split into separate suggestions)\n\n\
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
