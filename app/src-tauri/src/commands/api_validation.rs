use crate::types::ApiKey;

#[tauri::command]
pub async fn test_api_key(api_key: ApiKey) -> Result<bool, String> {
    log::info!("[test_api_key]");
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key.as_ref())
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let status = resp.status().as_u16();
    match status {
        200..=299 => Ok(true),
        400 | 401 => Err("Invalid API key".to_string()),
        403 => Err("API key is disabled".to_string()),
        429 => Err("Rate limited — please try again in a moment".to_string()),
        500..=599 => Err("Anthropic API is unavailable — please try again later".to_string()),
        _ => Err(format!("Unexpected API response (HTTP {})", status)),
    }
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
}

#[derive(serde::Deserialize)]
struct ModelsApiResponse {
    data: Vec<ModelsApiItem>,
}

#[derive(serde::Deserialize)]
struct ModelsApiItem {
    id: String,
    display_name: String,
}

/// Fetch the list of models available for the given API key from the Anthropic API.
/// Returns models sorted as returned by the API (newest first).
#[tauri::command]
pub async fn list_models(api_key: ApiKey) -> Result<Vec<ModelInfo>, String> {
    log::info!("[list_models]");
    let client = reqwest::Client::new();
    let resp = client
        .get("https://api.anthropic.com/v1/models")
        .header("x-api-key", api_key.as_ref())
        .header("anthropic-version", "2023-06-01")
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("API error: {}", resp.status()));
    }

    let body: ModelsApiResponse = resp
        .json()
        .await
        .map_err(|e| format!("Parse error: {}", e))?;
    let models = body
        .data
        .into_iter()
        .filter(|m| m.id.starts_with("claude-"))
        .map(|m| ModelInfo {
            id: m.id,
            display_name: m.display_name,
        })
        .collect();

    Ok(models)
}
