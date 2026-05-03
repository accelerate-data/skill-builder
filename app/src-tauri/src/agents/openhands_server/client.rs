use super::types::StartConversationRequest;
use reqwest::{Method, Request, Url};

#[derive(Debug, Clone)]
pub struct OpenHandsServerClient {
    http: reqwest::Client,
    base_url: Url,
    bearer_token: Option<String>,
}

impl OpenHandsServerClient {
    pub fn new(base_url: Url, bearer_token: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url,
            bearer_token,
        }
    }

    pub fn build_create_conversation_request(
        &self,
        request: &StartConversationRequest,
    ) -> Result<Request, reqwest::Error> {
        self.request(Method::POST, "api/conversations")
            .json(request)
            .build()
    }

    pub fn build_run_request(&self, conversation_id: &str) -> Result<Request, reqwest::Error> {
        self.request(
            Method::POST,
            &format!("api/conversations/{conversation_id}/run"),
        )
        .build()
    }

    pub fn build_send_event_request(
        &self,
        conversation_id: &str,
        event: serde_json::Value,
    ) -> Result<Request, reqwest::Error> {
        self.request(
            Method::POST,
            &format!("api/conversations/{conversation_id}/events"),
        )
        .json(&event)
        .build()
    }

    pub fn build_pause_request(&self, conversation_id: &str) -> Result<Request, reqwest::Error> {
        self.request(
            Method::POST,
            &format!("api/conversations/{conversation_id}/pause"),
        )
        .build()
    }

    pub fn build_delete_request(&self, conversation_id: &str) -> Result<Request, reqwest::Error> {
        self.request(
            Method::DELETE,
            &format!("api/conversations/{conversation_id}"),
        )
        .build()
    }

    pub async fn create_conversation(
        &self,
        request: &StartConversationRequest,
    ) -> Result<serde_json::Value, reqwest::Error> {
        self.http
            .execute(self.build_create_conversation_request(request)?)
            .await?
            .error_for_status()?
            .json()
            .await
    }

    pub async fn run_conversation(&self, conversation_id: &str) -> Result<(), reqwest::Error> {
        self.http
            .execute(self.build_run_request(conversation_id)?)
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn send_event(
        &self,
        conversation_id: &str,
        event: serde_json::Value,
    ) -> Result<(), reqwest::Error> {
        self.http
            .execute(self.build_send_event_request(conversation_id, event)?)
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn pause_conversation(&self, conversation_id: &str) -> Result<(), reqwest::Error> {
        self.http
            .execute(self.build_pause_request(conversation_id)?)
            .await?
            .error_for_status()?;
        Ok(())
    }

    pub async fn delete_conversation(&self, conversation_id: &str) -> Result<(), reqwest::Error> {
        self.http
            .execute(self.build_delete_request(conversation_id)?)
            .await?
            .error_for_status()?;
        Ok(())
    }

    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        let url = self
            .base_url
            .join(path)
            .expect("static OpenHands Agent Server API path should be valid");
        let builder = self.http.request(method, url);
        match &self.bearer_token {
            Some(token) => builder.bearer_auth(token),
            None => builder,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::{ConversationMetadata, LocalWorkspace, OpenHandsOneShotRequest};
    use super::*;
    use crate::agents::sidecar::SidecarConfig;
    use crate::types::{SecretString, WorkflowLlmConfig};

    fn base_config(workspace_root_dir: &str, workspace_skill_dir: &str) -> SidecarConfig {
        SidecarConfig {
            mode: Some("one-shot".to_string()),
            prompt: "Build the skill".to_string(),
            system_prompt: None,
            model: None,
            llm: Some(WorkflowLlmConfig {
                model: "anthropic/claude-sonnet-4-5".to_string(),
                api_key: Some(SecretString::new("sk-test".to_string())),
                base_url: Some("https://llm.example.test".to_string()),
                api_version: None,
                temperature: Some(0.2),
                max_output_tokens: Some(4096),
                timeout_seconds: None,
                num_retries: None,
                reasoning_effort: Some("medium".to_string()),
                extra_headers: None,
                input_cost_per_token: None,
                output_cost_per_token: None,
                usage_id: Some("workflow".to_string()),
            }),
            model_base_url: None,
            api_key: SecretString::new("openhands-llm-config".to_string()),
            workspace_root_dir: workspace_root_dir.to_string(),
            workspace_skill_dir: workspace_skill_dir.to_string(),
            allowed_tools: Some(vec!["file_editor".to_string(), "terminal".to_string()]),
            max_turns: Some(8),
            permission_mode: None,
            betas: None,
            thinking: None,
            fallback_model: None,
            effort: None,
            output_format: Some(serde_json::json!({
                "type": "json_schema",
                "schema": {"type": "object"}
            })),
            prompt_suggestions: None,
            path_to_claude_code_executable: None,
            path_to_openhands_runner: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("lead-routing".to_string()),
            step_id: Some(2),
            workflow_session_id: Some("workflow-1".to_string()),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            transcript_log_dir: None,
            persistence_dir: None,
            plugin_slug: "default".to_string(),
            runtime_provider: Some("openhands".to_string()),
            task_kind: Some("workflow".to_string()),
            user_message_suffix: Some("Stay in scope.".to_string()),
        }
    }

    #[test]
    fn conversation_payload_contains_local_workspace_for_skill_directory() {
        let config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_one_shot(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["workspace"]["type"], "LocalWorkspace");
        assert_eq!(
            json["workspace"]["working_dir"],
            "/workspace-root/default/lead-routing"
        );
        assert_eq!(json["llm"]["model"], "anthropic/claude-sonnet-4-5");
        assert_eq!(
            json["allowedTools"],
            serde_json::json!(["file_editor", "terminal"])
        );
        assert_eq!(json["maxTurns"], 8);
        assert_eq!(json["metadata"]["skillName"], "lead-routing");
        assert_eq!(json["metadata"]["stepId"], 2);
        assert_eq!(json["metadata"]["runSource"], "workflow");
    }

    #[test]
    fn scope_review_payload_uses_workspace_root_as_local_workspace() {
        let config = base_config("/workspace-root", "/workspace-root");
        let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_one_shot(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["taskKind"], "workflow");
        assert_eq!(json["workspace"]["working_dir"], "/workspace-root");
    }

    #[test]
    fn rest_client_builds_expected_endpoint_requests() {
        let client = OpenHandsServerClient::new("http://127.0.0.1:43210".parse().unwrap(), None);
        let create = client
            .build_create_conversation_request(&StartConversationRequest {
                prompt: "prompt".to_string(),
                llm: serde_json::json!({"model": "test"}),
                workspace: LocalWorkspace::new("/tmp/workspace"),
                allowed_tools: vec![],
                max_turns: 4,
                agent_name: Some("skill-creator".to_string()),
                task_kind: Some("scope_review".to_string()),
                output_format: None,
                user_message_suffix: None,
                metadata: ConversationMetadata::default(),
            })
            .unwrap();
        assert_eq!(create.method(), reqwest::Method::POST);
        assert_eq!(
            create.url().as_str(),
            "http://127.0.0.1:43210/api/conversations"
        );

        assert_eq!(
            client.build_run_request("abc").unwrap().url().path(),
            "/api/conversations/abc/run"
        );
        assert_eq!(
            client
                .build_send_event_request("abc", serde_json::json!({"type": "message"}))
                .unwrap()
                .url()
                .path(),
            "/api/conversations/abc/events"
        );
        assert_eq!(
            client.build_pause_request("abc").unwrap().url().path(),
            "/api/conversations/abc/pause"
        );
        let delete = client.build_delete_request("abc").unwrap();
        assert_eq!(delete.method(), reqwest::Method::DELETE);
        assert_eq!(delete.url().path(), "/api/conversations/abc");
    }
}
