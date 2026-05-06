use super::types::StartConversationRequest;
use reqwest::{Method, Request, StatusCode, Url};

#[derive(Debug, Clone)]
pub struct OpenHandsServerClient {
    http: reqwest::Client,
    base_url: Url,
    session_api_key: Option<String>,
}

impl OpenHandsServerClient {
    pub fn new(base_url: Url, session_api_key: Option<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            base_url,
            session_api_key,
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

    pub fn build_agent_final_response_request(
        &self,
        conversation_id: &str,
    ) -> Result<Request, reqwest::Error> {
        self.request(
            Method::GET,
            &format!("api/conversations/{conversation_id}/agent_final_response"),
        )
        .build()
    }

    pub fn build_search_events_request(
        &self,
        conversation_id: &str,
        page_id: Option<&str>,
        limit: u32,
    ) -> Result<Request, reqwest::Error> {
        let limit = limit.clamp(1, 100);
        let path = format!("api/conversations/{conversation_id}/events/search");
        let mut url = self
            .base_url
            .join(&path)
            .expect("static OpenHands Agent Server API path should be valid");
        {
            let mut pairs = url.query_pairs_mut();
            pairs.append_pair("limit", &limit.to_string());
            if let Some(page_id) = page_id {
                pairs.append_pair("page_id", page_id);
            }
        }
        let mut builder = self.http.request(Method::GET, url);
        if let Some(token) = &self.session_api_key {
            builder = builder.header("X-Session-API-Key", token);
        }
        builder.build()
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
        let response = self
            .http
            .execute(self.build_run_request(conversation_id)?)
            .await?;
        if response.status() == StatusCode::CONFLICT {
            return Ok(());
        }
        response.error_for_status()?;
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

    pub async fn agent_final_response(
        &self,
        conversation_id: &str,
    ) -> Result<serde_json::Value, reqwest::Error> {
        self.http
            .execute(self.build_agent_final_response_request(conversation_id)?)
            .await?
            .error_for_status()?
            .json()
            .await
    }

    /// Fetch every persisted event for the conversation in chronological order.
    ///
    /// The SDK emits SystemPromptEvent and the initial user MessageEvent during
    /// POST /api/conversations — before the WebSocket subscriber attaches — so
    /// the live stream alone misses those frames. This drains the REST page
    /// cursor so callers can backfill them deterministically before consuming
    /// the WebSocket.
    pub async fn list_all_events(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<serde_json::Value>, reqwest::Error> {
        // Hard cap on pages so a buggy server cursor that never returns
        // null cannot hang the WS-attach phase. 10 pages × 100 events =
        // 1000 events, far above what the SDK emits between
        // POST /api/conversations and WS subscribe (typically 2 — the
        // SystemPromptEvent + initial user MessageEvent). If we ever hit
        // the cap the warning makes it visible without breaking the run.
        const MAX_BACKFILL_PAGES: usize = 10;
        let mut events = Vec::new();
        let mut page_id: Option<String> = None;
        for page in 0..MAX_BACKFILL_PAGES {
            let response = self
                .http
                .execute(self.build_search_events_request(
                    conversation_id,
                    page_id.as_deref(),
                    100,
                )?)
                .await?
                .error_for_status()?
                .json::<serde_json::Value>()
                .await?;
            if let Some(items) = response.get("items").and_then(|value| value.as_array()) {
                events.reserve(items.len());
                events.extend(items.iter().cloned());
            }
            page_id = response
                .get("next_page_id")
                .and_then(|value| value.as_str())
                .map(str::to_string);
            if page_id.is_none() {
                return Ok(events);
            }
            if page + 1 == MAX_BACKFILL_PAGES {
                log::warn!(
                    "[openhands-agent-server] event backfill hit MAX_BACKFILL_PAGES={MAX_BACKFILL_PAGES}; \
                     stopping pagination — server returned non-null next_page_id beyond expected range"
                );
            }
        }
        Ok(events)
    }

    fn request(&self, method: Method, path: &str) -> reqwest::RequestBuilder {
        let url = self
            .base_url
            .join(path)
            .expect("static OpenHands Agent Server API path should be valid");
        let builder = self.http.request(method, url);
        match &self.session_api_key {
            Some(token) => builder.header("X-Session-API-Key", token),
            None => builder,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::OpenHandsOneShotRequest;
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
            output_format: Some(serde_json::json!({
                "type": "json_schema",
                "schema": {"type": "object"}
            })),
            prompt_suggestions: None,
            agent_name: Some("skill-creator".to_string()),
            required_plugins: None,
            setting_sources: None,
            conversation_history: None,
            skill_name: Some("lead-routing".to_string()),
            step_id: Some(2),
            workflow_session_id: Some("workflow-1".to_string()),
            usage_session_id: None,
            run_source: Some("workflow".to_string()),
            persistence_dir: None,
            plugin_slug: "default".to_string(),
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

        assert_eq!(json["workspace"]["kind"], "LocalWorkspace");
        assert_eq!(
            json["workspace"]["working_dir"],
            "/workspace-root/default/lead-routing"
        );
        assert_eq!(json["agent"]["llm"]["model"], "anthropic/claude-sonnet-4-5");
        assert_eq!(json["agent"]["llm"]["api_key"], "sk-test");
        assert_eq!(
            json["agent"]["tools"],
            serde_json::json!([
                {"name": "file_editor", "params": {}},
                {"name": "terminal", "params": {}}
            ])
        );
        assert_eq!(json["max_iterations"], 8);
        assert_eq!(json["tags"]["skill"], "lead-routing");
        assert_eq!(json["tags"]["step"], "2");
        assert_eq!(json["tags"]["source"], "workflow");
        assert_eq!(
            json["initial_message"]["content"][0]["text"],
            "Build the skill"
        );
    }

    #[test]
    fn conversation_payload_marks_opencode_go_models_as_openai_compatible_for_litellm() {
        let mut config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let llm = config.llm.as_mut().unwrap();
        llm.model = "opencode-go/minimax-m2.7".to_string();
        llm.base_url = Some("https://opencode.ai/zen/go/v1".to_string());

        let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_one_shot(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["agent"]["llm"]["model"], "openai/minimax-m2.7");
        assert_eq!(
            json["agent"]["llm"]["base_url"],
            "https://opencode.ai/zen/go/v1"
        );
    }

    #[test]
    fn scope_review_payload_uses_workspace_root_as_local_workspace() {
        let config = base_config("/workspace-root", "/workspace-root");
        let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_one_shot(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["workspace"]["working_dir"], "/workspace-root");
    }

    #[test]
    fn rest_client_builds_expected_endpoint_requests() {
        let client = OpenHandsServerClient::new(
            "http://127.0.0.1:43210".parse().unwrap(),
            Some("session-key".to_string()),
        );
        let config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let one_shot = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let create = client
            .build_create_conversation_request(&StartConversationRequest::from_one_shot(&one_shot))
            .unwrap();
        assert_eq!(create.method(), reqwest::Method::POST);
        assert_eq!(
            create.url().as_str(),
            "http://127.0.0.1:43210/api/conversations"
        );
        assert_eq!(
            create
                .headers()
                .get("X-Session-API-Key")
                .and_then(|value| value.to_str().ok()),
            Some("session-key")
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
        assert_eq!(
            client
                .build_agent_final_response_request("abc")
                .unwrap()
                .url()
                .path(),
            "/api/conversations/abc/agent_final_response"
        );
    }

    #[test]
    fn default_tool_set_includes_search_and_subagent_spawn() {
        let mut config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        config.allowed_tools = None;
        let request = OpenHandsOneShotRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_one_shot(&request);
        let json = serde_json::to_value(payload).unwrap();

        let names: Vec<String> = json["agent"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|tool| tool["name"].as_str().unwrap().to_string())
            .collect();

        for expected in [
            "file_editor",
            "glob",
            "grep",
            "task_tool_set",
            "task_tracker",
            "terminal",
        ] {
            assert!(
                names.iter().any(|n| n == expected),
                "expected `{expected}` in default tool set, got {names:?}"
            );
        }

        // Built-in tools must only resolve names in BUILT_IN_TOOL_CLASSES;
        // DelegateTool was removed because the SDK rejects it (and it's
        // deprecated). InvokeSkillTool auto-attaches via agent_context.
        let defaults: Vec<String> = json["agent"]["include_default_tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap().to_string())
            .collect();
        assert_eq!(defaults, vec!["FinishTool", "ThinkTool"]);
    }

    #[test]
    fn search_events_request_includes_pagination_query() {
        let client = OpenHandsServerClient::new(
            "http://127.0.0.1:43210".parse().unwrap(),
            Some("session-key".to_string()),
        );

        let first = client
            .build_search_events_request("conv-1", None, 100)
            .unwrap();
        assert_eq!(first.method(), reqwest::Method::GET);
        assert_eq!(
            first.url().path(),
            "/api/conversations/conv-1/events/search"
        );
        assert_eq!(first.url().query(), Some("limit=100"));
        assert_eq!(
            first
                .headers()
                .get("X-Session-API-Key")
                .and_then(|value| value.to_str().ok()),
            Some("session-key")
        );

        let next = client
            .build_search_events_request("conv-1", Some("page-2"), 50)
            .unwrap();
        let query = next.url().query().unwrap_or_default();
        assert!(query.contains("limit=50"), "query was {query}");
        assert!(query.contains("page_id=page-2"), "query was {query}");
    }
}
