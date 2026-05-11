use reqwest::Client;
use url::Url;

use crate::agents::litellm_proxy::types::{
    CreateUserRequest, CreateUserResponse, GenerateKeyRequest, GenerateKeyResponse,
    HealthResponse, KeyInfoResponse,
};

pub struct LiteLLMAdminClient {
    client: Client,
    base_url: Url,
    master_key: String,
}

impl LiteLLMAdminClient {
    pub fn new(base_url: Url, master_key: String) -> Self {
        Self {
            client: Client::new(),
            base_url,
            master_key,
        }
    }

    pub async fn health_check(&self) -> Result<HealthResponse, String> {
        let url = self.base_url.join("/health").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("LiteLLM health check failed: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("LiteLLM health check returned {}", resp.status()));
        }
        resp.json::<HealthResponse>()
            .await
            .map_err(|e| format!("Failed to parse health response: {e}"))
    }

    pub async fn create_user(&self, req: &CreateUserRequest) -> Result<CreateUserResponse, String> {
        let url = self.base_url.join("/user/new").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .json(req)
            .send()
            .await
            .map_err(|e| format!("LiteLLM create user failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM create user returned {status}: {body}"));
        }
        resp.json::<CreateUserResponse>()
            .await
            .map_err(|e| format!("Failed to parse create user response: {e}"))
    }

    pub async fn generate_key(&self, req: &GenerateKeyRequest) -> Result<GenerateKeyResponse, String> {
        let url = self.base_url.join("/key/generate").map_err(|e| e.to_string())?;
        let resp = self
            .client
            .post(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .json(req)
            .send()
            .await
            .map_err(|e| format!("LiteLLM generate key failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM generate key returned {status}: {body}"));
        }
        resp.json::<GenerateKeyResponse>()
            .await
            .map_err(|e| format!("Failed to parse generate key response: {e}"))
    }

    pub async fn key_info(&self, key: &str) -> Result<KeyInfoResponse, String> {
        let url = self.base_url
            .join(&format!("/key/info?key={}", key))
            .map_err(|e| e.to_string())?;
        let resp = self
            .client
            .get(url)
            .header("Authorization", format!("Bearer {}", self.master_key))
            .send()
            .await
            .map_err(|e| format!("LiteLLM key info failed: {e}"))?;
        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("LiteLLM key info returned {status}: {body}"));
        }
        resp.json::<KeyInfoResponse>()
            .await
            .map_err(|e| format!("Failed to parse key info response: {e}"))
    }
}
