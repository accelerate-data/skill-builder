use super::eval::{EvalResult, EvalResults};

// ─── Anthropic API call ─────────────────────────────────────────────────────

/// Call the Anthropic Messages API directly via reqwest.
/// Returns the text content of the first content block.
pub async fn call_anthropic(prompt: &str, model: &str, api_key: &str) -> Result<String, String> {
    let client = reqwest::Client::new();
    let resp = client
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("content-type", "application/json")
        .body(
            serde_json::json!({
                "model": model,
                "max_tokens": 4096,
                "messages": [{"role": "user", "content": prompt}]
            })
            .to_string(),
        )
        .send()
        .await
        .map_err(|e| format!("Anthropic API request failed: {}", e))?;

    let status = resp.status().as_u16();
    let body: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse Anthropic API response: {}", e))?;

    if !(200..300).contains(&status) {
        let error_msg = body
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("unknown error");
        return Err(format!(
            "Anthropic API error (HTTP {}): {}",
            status, error_msg
        ));
    }

    body.get("content")
        .and_then(|c| c.as_array())
        .and_then(|arr| arr.first())
        .and_then(|item| item.get("text"))
        .and_then(|t| t.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "Anthropic API returned empty content".to_string())
}

// ─── Tag extraction ─────────────────────────────────────────────────────────

/// Extract text between `<new_description>` and `</new_description>` tags.
/// Falls back to the full response if tags are not found.
fn extract_new_description(text: &str) -> String {
    let open_tag = "<new_description>";
    let close_tag = "</new_description>";

    if let Some(start) = text.find(open_tag) {
        let after_open = start + open_tag.len();
        if let Some(end) = text[after_open..].find(close_tag) {
            return text[after_open..after_open + end].trim().to_string();
        }
    }

    // Fallback: use full response stripped
    text.trim().to_string()
}

// ─── Prompt construction ────────────────────────────────────────────────────

/// History entry passed to improve_description.
/// Records a previous candidate and its test score so the model can see the
/// trajectory of attempts and avoid repeating descriptions.
pub struct HistoryEntry {
    pub iteration: u32,
    pub description: String,
    pub test_passed: usize,
    pub test_total: usize,
}

/// Build the improvement prompt and call the Anthropic API.
/// Returns the new description (guaranteed ≤ 1024 characters).
///
/// `train_eval` contains the fresh train-set results for `current_description` —
/// these drive the prompt (what failed, what passed).
/// `history` records previous candidates and their test scores for context.
pub async fn improve_description(
    skill_name: &str,
    skill_content: &str,
    current_description: &str,
    train_eval: &EvalResults,
    history: &[HistoryEntry],
    model: &str,
    api_key: &str,
) -> Result<String, String> {
    let prompt = build_improve_prompt(
        skill_name,
        skill_content,
        current_description,
        train_eval,
        history,
    );

    log::info!(
        "[improve_description] skill={} prompt_len={}",
        skill_name,
        prompt.len()
    );

    let response = call_anthropic(&prompt, model, api_key).await?;
    let mut description = extract_new_description(&response);

    // Re-call if over 1024 chars
    if description.len() > 1024 {
        log::info!(
            "[improve_description] description too long ({} chars), requesting shorten",
            description.len()
        );
        let shorten_prompt = format!(
            "The following skill description is too long ({} characters). \
             Rewrite it to be under 1024 characters while preserving the key information. \
             Respond with only the new description in <new_description> tags.\n\n\
             <description>\n{}\n</description>",
            description.len(),
            description,
        );
        let shortened = call_anthropic(&shorten_prompt, model, api_key).await?;
        description = extract_new_description(&shortened);
    }

    Ok(description)
}

fn build_improve_prompt(
    skill_name: &str,
    skill_content: &str,
    current_description: &str,
    train_eval: &EvalResults,
    history: &[HistoryEntry],
) -> String {
    let mut prompt = String::with_capacity(8192);

    // Header
    prompt.push_str(&format!(
        "You are optimizing a skill description for a Claude Code skill called \"{}\".\n\n",
        skill_name
    ));

    // Current description
    prompt.push_str(&format!(
        "<current_description>\n{}\n</current_description>\n\n",
        current_description
    ));

    // Train scores and failures
    prompt.push_str(&format!(
        "Train score: {}/{}\n\n",
        train_eval.summary.passed, train_eval.summary.total
    ));

    let failed_triggers: Vec<&EvalResult> = train_eval
        .results
        .iter()
        .filter(|r| r.should_trigger && !r.pass)
        .collect();
    let false_triggers: Vec<&EvalResult> = train_eval
        .results
        .iter()
        .filter(|r| !r.should_trigger && !r.pass)
        .collect();

    prompt.push_str("<scores_summary>\n");

    if !failed_triggers.is_empty() {
        prompt.push_str("Failed triggers (should have triggered but didn't):\n");
        for r in &failed_triggers {
            prompt.push_str(&format!(
                "  - query: \"{}\" ({}/{})\n",
                r.query, r.triggers, r.runs
            ));
        }
    }

    if !false_triggers.is_empty() {
        prompt.push_str("False triggers (triggered but shouldn't have):\n");
        for r in &false_triggers {
            prompt.push_str(&format!(
                "  - query: \"{}\" ({}/{})\n",
                r.query, r.triggers, r.runs
            ));
        }
    }

    // Previous candidates and their test scores
    if !history.is_empty() {
        prompt.push_str("\nPrevious candidates:\n");
        for entry in history {
            prompt.push_str(&format!(
                "<attempt iteration={} test={}/{}>\n{}\n</attempt>\n",
                entry.iteration, entry.test_passed, entry.test_total, entry.description
            ));
        }
    }

    prompt.push_str("</scores_summary>\n\n");

    // Skill content
    prompt.push_str(&format!(
        "<skill_content>\n{}\n</skill_content>\n\n",
        skill_content
    ));

    // Instruction
    prompt.push_str(
        "Write a new description that generalizes from the failures rather than listing \
         specific prompts. Keep it under 1024 characters and ideally around 100-200 words. \
         Respond with only the new description text in <new_description> tags.",
    );

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_new_description_with_tags() {
        let text = "Here is the result:\n\n<new_description>\nA great skill description.\n</new_description>\n\nDone.";
        assert_eq!(extract_new_description(text), "A great skill description.");
    }

    #[test]
    fn test_extract_new_description_fallback() {
        let text = "Just a plain description without tags.";
        assert_eq!(
            extract_new_description(text),
            "Just a plain description without tags."
        );
    }

    #[test]
    fn test_build_improve_prompt_contains_key_sections() {
        let eval_results = EvalResults {
            results: vec![EvalResult {
                query: "test query".to_string(),
                should_trigger: true,
                trigger_rate: 0.0,
                triggers: 0,
                runs: 3,
                pass: false,
            }],
            summary: super::super::eval::EvalSummary {
                total: 1,
                passed: 0,
                failed: 1,
            },
        };

        let prompt = build_improve_prompt(
            "my-skill",
            "# My Skill\nDoes stuff",
            "old description",
            &eval_results,
            &[],
        );

        assert!(prompt.contains("my-skill"));
        assert!(prompt.contains("<current_description>"));
        assert!(prompt.contains("old description"));
        assert!(prompt.contains("Train score: 0/1"));
        assert!(prompt.contains("test query"));
        assert!(prompt.contains("<skill_content>"));
        assert!(prompt.contains("<new_description>"));
    }
}
