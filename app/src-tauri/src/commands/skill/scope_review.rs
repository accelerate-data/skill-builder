use crate::db::Db;
use serde::Serialize;

#[derive(Serialize)]
pub struct ScopeReviewSuggestion {
    pub name: String,
    pub description: String,
}

#[derive(Serialize)]
pub struct ScopeReviewResult {
    pub is_too_broad: bool,
    pub reason: String,
    pub suggested_skills: Vec<ScopeReviewSuggestion>,
}

#[tauri::command]
pub async fn review_skill_scope(
    skill_name: String,
    description: String,
    purpose: String,
    industry: Option<String>,
    db: tauri::State<'_, Db>,
) -> Result<ScopeReviewResult, String> {
    log::info!(
        "[review_skill_scope] skill={} purpose={}",
        skill_name,
        purpose
    );

    let (api_key, documents) = {
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
        (key, docs)
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

    let prompt = format!(
        "You are evaluating whether a Claude skill is too broad.\n\n\
         A skill is too broad when its description touches more than one distinct domain object.\n\n\
         Examples:\n\
         - \"analyzes revenue, headcount, and marketing spend\" → three unrelated domain objects → too broad\n\
         - \"forecasts churned customers using CRM data\" → one domain object → focused\n\n\
         Use industry and document context to override a generic breadth signal. If the documents show \
         that a topic in this company is one tightly scoped workflow, it may be focused — not broad.\n\n\
         Skill to evaluate:\n\
         - Name: {skill_name}\n\
         - Description: {description}\n\
         - Purpose: {purpose}{industry_context}{doc_context}\n\n\
         When is_too_broad is true, suggest 3-5 focused replacements. All suggested names MUST use \
         the gerund pattern: verb-ing + object (kebab-case).\n\n\
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
         Respond in English only.\n\n\
         Respond with JSON only (no markdown fences, no extra text):\n\
         {{\"is_too_broad\": boolean, \"reason\": string, \"suggested_skills\": [{{\"name\": string, \"description\": string}}]}}",
        skill_name = skill_name,
        description = description,
        purpose = purpose,
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
                "model": "claude-sonnet-4-5",
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

    let is_too_broad = parsed["is_too_broad"].as_bool().unwrap_or(false);
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
        "[review_skill_scope] result: is_too_broad={} suggestions={}",
        is_too_broad,
        suggested_skills.len()
    );

    Ok(ScopeReviewResult {
        is_too_broad,
        reason,
        suggested_skills,
    })
}
