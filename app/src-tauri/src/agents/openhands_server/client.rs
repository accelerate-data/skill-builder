use super::types::StartConversationRequest;
use reqwest::{Method, Request, Response, StatusCode, Url};

#[derive(Debug, Clone)]
pub struct OpenHandsServerClient {
    http: reqwest::Client,
    base_url: Url,
    session_api_key: Option<String>,
}

impl OpenHandsServerClient {
    fn request_error(error: reqwest::Error) -> String {
        format!("failed to build OpenHands API request: {error}")
    }

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

    pub fn build_get_conversation_request(
        &self,
        conversation_id: &str,
    ) -> Result<Request, reqwest::Error> {
        self.request(Method::GET, &format!("api/conversations/{conversation_id}"))
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

    #[cfg_attr(not(test), allow(dead_code))]
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
    ) -> Result<serde_json::Value, String> {
        let request = self
            .build_create_conversation_request(request)
            .map_err(Self::request_error)?;
        self.execute_json(request).await
    }

    pub async fn run_conversation(&self, conversation_id: &str) -> Result<(), String> {
        let request = self
            .build_run_request(conversation_id)
            .map_err(Self::request_error)?;
        let response = self.execute(request).await?;
        if response.status() == StatusCode::CONFLICT {
            return Ok(());
        }
        Self::ensure_success(response).await?;
        Ok(())
    }

    pub async fn get_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Option<serde_json::Value>, String> {
        let request = self
            .build_get_conversation_request(conversation_id)
            .map_err(Self::request_error)?;
        let response = self.execute(request).await?;
        if response.status() == StatusCode::NOT_FOUND {
            return Ok(None);
        }
        Ok(Some(Self::json_success(response).await?))
    }

    pub async fn pause_conversation(&self, conversation_id: &str) -> Result<(), String> {
        let request = self
            .build_pause_request(conversation_id)
            .map_err(Self::request_error)?;
        let response = self.execute(request).await?;
        Self::ensure_success(response).await?;
        Ok(())
    }

    pub async fn send_event(
        &self,
        conversation_id: &str,
        event: serde_json::Value,
    ) -> Result<(), String> {
        let request = self
            .build_send_event_request(conversation_id, event)
            .map_err(Self::request_error)?;
        let response = self.execute(request).await?;
        Self::ensure_success(response).await?;
        Ok(())
    }

    pub async fn agent_final_response(
        &self,
        conversation_id: &str,
    ) -> Result<serde_json::Value, String> {
        let request = self
            .build_agent_final_response_request(conversation_id)
            .map_err(Self::request_error)?;
        self.execute_json(request).await
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
    ) -> Result<Vec<serde_json::Value>, String> {
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
            let request = self
                .build_search_events_request(conversation_id, page_id.as_deref(), 100)
                .map_err(Self::request_error)?;
            let response = self.execute(request).await?;
            let response = Self::json_success(response).await?;
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

    async fn execute(&self, request: Request) -> Result<Response, String> {
        self.http
            .execute(request)
            .await
            .map_err(|e| format!("request failed: {e}"))
    }

    async fn execute_json(&self, request: Request) -> Result<serde_json::Value, String> {
        let response = self.execute(request).await?;
        Self::json_success(response).await
    }

    async fn json_success(response: Response) -> Result<serde_json::Value, String> {
        let response = Self::ensure_success(response).await?;
        response
            .json()
            .await
            .map_err(|e| format!("failed to decode OpenHands API response body: {e}"))
    }

    async fn ensure_success(response: Response) -> Result<Response, String> {
        let status = response.status();
        if status.is_success() {
            return Ok(response);
        }

        let body = response.text().await.map_err(|e| {
            format!("OpenHands API returned {status} and the response body could not be read: {e}")
        })?;
        let body = body.trim();
        if body.is_empty() {
            Err(format!(
                "OpenHands API returned {status} with an empty response body"
            ))
        } else {
            Err(format!("OpenHands API returned {status}: {body}"))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::super::types::OpenHandsRuntimeRequest;
    use super::*;
    use crate::agents::sidecar::SidecarConfig;
    use crate::types::{SecretString, WorkflowLlmConfig};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    fn base_config(workspace_root_dir: &str, workspace_skill_dir: &str) -> SidecarConfig {
        SidecarConfig {
            mode: None,
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
            system_message_suffix: Some("# Skill Creator Agent".to_string()),
        }
    }

    #[test]
    fn conversation_payload_contains_local_workspace_for_skill_directory() {
        let config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_runtime_request(&request);
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
                {"name": "task_tool_set", "params": {}},
                {"name": "terminal", "params": {}}
            ])
        );
        assert_eq!(
            json["agent"]["agent_context"]["system_message_suffix"],
            "# Skill Creator Agent"
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
    fn persistent_session_create_payload_omits_initial_message() {
        let config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload =
            StartConversationRequest::from_runtime_request_with_initial_message(&request, false);
        let json = serde_json::to_value(payload).unwrap();

        assert!(json.get("initial_message").is_none());
    }

    #[test]
    fn conversation_payload_marks_opencode_zen_models_as_openai_compatible_for_litellm() {
        let mut config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let llm = config.llm.as_mut().unwrap();
        llm.model = "opencode/minimax-m2.7".to_string();
        llm.base_url = Some("https://opencode.ai/zen/go/v1".to_string());

        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_runtime_request(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["agent"]["llm"]["model"], "openai/minimax-m2.7");
        assert_eq!(
            json["agent"]["llm"]["base_url"],
            "https://opencode.ai/zen/go/v1"
        );
    }

    #[test]
    fn conversation_payload_keeps_legacy_opencode_go_models_openai_compatible() {
        let mut config = base_config("/workspace-root", "/workspace-root/default/lead-routing");
        let llm = config.llm.as_mut().unwrap();
        llm.model = "opencode-go/minimax-m2.7".to_string();
        llm.base_url = Some("https://opencode.ai/zen/go/v1".to_string());

        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_runtime_request(&request);
        let json = serde_json::to_value(payload).unwrap();

        assert_eq!(json["agent"]["llm"]["model"], "openai/minimax-m2.7");
    }

    #[test]
    fn scope_review_payload_uses_workspace_root_as_local_workspace() {
        let config = base_config("/workspace-root", "/workspace-root");
        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_runtime_request(&request);
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
        let runtime_request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let create = client
            .build_create_conversation_request(&StartConversationRequest::from_runtime_request(
                &runtime_request,
            ))
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
                .build_get_conversation_request("abc")
                .unwrap()
                .url()
                .path(),
            "/api/conversations/abc"
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
        let request = OpenHandsRuntimeRequest::try_from_sidecar_config(&config).unwrap();
        let payload = StartConversationRequest::from_runtime_request(&request);
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

    #[tokio::test]
    async fn pause_conversation_surfaces_status_and_body_for_api_errors() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = stream.read(&mut request).await.unwrap();
            stream
                .write_all(
                    b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 12\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\npause failed",
                )
                .await
                .unwrap();
        });

        let client = OpenHandsServerClient::new(
            format!("http://{addr}").parse().unwrap(),
            Some("session-key".to_string()),
        );

        let error = client.pause_conversation("conv-1").await.unwrap_err();
        assert!(error.contains("500 Internal Server Error"), "{error}");
        assert!(error.contains("pause failed"), "{error}");

        server.await.unwrap();
    }
}
