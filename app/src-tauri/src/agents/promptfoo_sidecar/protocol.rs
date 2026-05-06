use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvalMode {
    Performance,
    Trigger,
}

impl EvalMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Performance => "performance",
            Self::Trigger => "trigger",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum EvalAssertionType {
    Equals,
    Contains,
    Javascript,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalAssertion {
    #[serde(rename = "type")]
    pub assertion_type: EvalAssertionType,
    pub value: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalCase {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub expected: Option<String>,
    #[serde(default)]
    pub should_trigger: Option<bool>,
    #[serde(default)]
    pub assertions: Vec<EvalAssertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvalCandidate {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalExecution {
    pub case_id: String,
    pub candidate_id: String,
    pub output: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RequestType {
    RunEval,
    ListHistory,
    ReadHistory,
}

fn default_run_eval_request_type() -> RequestType {
    RequestType::RunEval
}

fn default_list_history_request_type() -> RequestType {
    RequestType::ListHistory
}

fn default_read_history_request_type() -> RequestType {
    RequestType::ReadHistory
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunEvalRequest {
    pub id: String,
    #[serde(rename = "type", default = "default_run_eval_request_type")]
    pub request_type: RequestType,
    pub mode: EvalMode,
    pub skill_name: String,
    pub plugin_slug: String,
    pub scenario_name: String,
    pub promptfoo_config_dir: String,
    pub candidates: Vec<EvalCandidate>,
    pub cases: Vec<EvalCase>,
    pub executions: Vec<EvalExecution>,
}

impl RunEvalRequest {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: impl Into<String>,
        mode: EvalMode,
        skill_name: impl Into<String>,
        plugin_slug: impl Into<String>,
        scenario_name: impl Into<String>,
        promptfoo_config_dir: impl Into<String>,
        candidates: Vec<EvalCandidate>,
        cases: Vec<EvalCase>,
        executions: Vec<EvalExecution>,
    ) -> Self {
        Self {
            id: id.into(),
            request_type: RequestType::RunEval,
            mode,
            skill_name: skill_name.into(),
            plugin_slug: plugin_slug.into(),
            scenario_name: scenario_name.into(),
            promptfoo_config_dir: promptfoo_config_dir.into(),
            candidates,
            cases,
            executions,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ListHistoryRequest {
    pub id: String,
    #[serde(rename = "type", default = "default_list_history_request_type")]
    pub request_type: RequestType,
    pub promptfoo_config_dir: String,
    pub plugin_slug: String,
    pub skill_name: String,
    #[serde(default)]
    pub scenario_name: Option<String>,
    pub mode: EvalMode,
    pub limit: i64,
}

impl ListHistoryRequest {
    pub fn new(
        id: impl Into<String>,
        promptfoo_config_dir: impl Into<String>,
        plugin_slug: impl Into<String>,
        skill_name: impl Into<String>,
        scenario_name: Option<String>,
        mode: EvalMode,
        limit: i64,
    ) -> Self {
        Self {
            id: id.into(),
            request_type: RequestType::ListHistory,
            promptfoo_config_dir: promptfoo_config_dir.into(),
            plugin_slug: plugin_slug.into(),
            skill_name: skill_name.into(),
            scenario_name,
            mode,
            limit,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReadHistoryRequest {
    pub id: String,
    #[serde(rename = "type", default = "default_read_history_request_type")]
    pub request_type: RequestType,
    pub promptfoo_config_dir: String,
    pub run_id: String,
}

impl ReadHistoryRequest {
    pub fn new(
        id: impl Into<String>,
        promptfoo_config_dir: impl Into<String>,
        run_id: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            request_type: RequestType::ReadHistory,
            promptfoo_config_dir: promptfoo_config_dir.into(),
            run_id: run_id.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalCaseResult {
    pub case_id: String,
    pub candidate_id: String,
    pub passed: bool,
    pub score: f64,
    pub output: Value,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunResult {
    pub mode: EvalMode,
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub results: Vec<EvalCaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEvalRunSummary {
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub pass_rate: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedEvalRun {
    pub id: String,
    pub promptfoo_eval_id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub mode: EvalMode,
    pub status: String,
    pub summary: PersistedEvalRunSummary,
    #[serde(default)]
    pub scenario_snapshot: Option<serde_json::Value>,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub results: Vec<EvalCaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum SidecarResultPayload {
    Eval { result: EvalRunResult },
    Runs { runs: Vec<PersistedEvalRun> },
    Run { run: Box<Option<PersistedEvalRun>> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    Progress {
        id: String,
        completed: u32,
        total: u32,
        #[serde(rename = "caseId", default)]
        case_id: Option<String>,
        #[serde(rename = "candidateId", default)]
        candidate_id: Option<String>,
    },
    Result {
        id: String,
        #[serde(flatten)]
        payload: SidecarResultPayload,
    },
    Error {
        id: String,
        message: String,
    },
}

pub fn serialize_request<T>(request: &T) -> Result<String, String>
where
    T: Serialize,
{
    serde_json::to_string(request)
        .map(|json| format!("{json}\n"))
        .map_err(|error| error.to_string())
}

pub fn parse_sidecar_event(line: &str) -> Result<SidecarEvent, String> {
    serde_json::from_str(line).map_err(|error| error.to_string())
}
