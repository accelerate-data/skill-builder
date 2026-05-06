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
pub struct EvalDescriptionCandidate {
    pub id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub rationale: Option<String>,
    #[serde(default)]
    pub rank: Option<i64>,
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
            request_type: "run_eval",
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
pub struct ListEvalHistoryFilter {
    pub config_dir: String,
    pub plugin_slug: String,
    pub skill_name: String,
    #[serde(default)]
    pub scenario_name: Option<String>,
    #[serde(default)]
    pub mode: Option<EvalMode>,
    #[serde(default)]
    pub limit: Option<u32>,
    #[serde(default)]
    pub offset: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ListEvalHistoryRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: &'static str,
    pub filter: ListEvalHistoryFilter,
}

impl ListEvalHistoryRequest {
    pub fn new(id: impl Into<String>, filter: ListEvalHistoryFilter) -> Self {
        Self {
            id: id.into(),
            request_type: "list_eval_history",
            filter,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReadEvalHistoryRequest {
    pub id: String,
    #[serde(rename = "type")]
    pub request_type: &'static str,
    pub config_dir: String,
    pub eval_id: String,
}

impl ReadEvalHistoryRequest {
    pub fn new(
        id: impl Into<String>,
        config_dir: impl Into<String>,
        eval_id: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            request_type: "read_eval_history",
            config_dir: config_dir.into(),
            eval_id: eval_id.into(),
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
pub struct EvalRunHistory {
    pub persisted: bool,
    #[serde(default)]
    pub config_dir: Option<String>,
    #[serde(default)]
    pub eval_id: Option<String>,
    #[serde(default)]
    pub metadata: Option<EvalHistoryMetadata>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunResult {
    pub mode: EvalMode,
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub results: Vec<EvalCaseResult>,
    #[serde(default)]
    pub history: Option<EvalRunHistory>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryListItem {
    pub eval_id: String,
    pub created_at: i64,
    #[serde(default)]
    pub description: Option<String>,
    pub total: u32,
    pub passed: u32,
    pub failed: u32,
    pub metadata: EvalHistoryMetadata,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryListResult {
    pub items: Vec<EvalHistoryListItem>,
    pub limit: u32,
    pub offset: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryCaseDetail {
    #[serde(default)]
    pub case_id: Option<String>,
    #[serde(default)]
    pub candidate_id: Option<String>,
    #[serde(default)]
    pub prompt: Option<String>,
    pub test_idx: u32,
    pub prompt_idx: u32,
    pub success: bool,
    pub score: f64,
    #[serde(default)]
    pub response: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub latency_ms: Option<f64>,
    #[serde(default)]
    pub cost: Option<f64>,
    #[serde(default)]
    pub failure_reason: Option<Value>,
    #[serde(default)]
    pub grading_result: Option<Value>,
    #[serde(default)]
    pub metadata: Option<Value>,
    #[serde(default)]
    pub provider_id: Option<String>,
    #[serde(default)]
    pub provider_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryEntry {
    #[serde(flatten)]
    pub header: EvalHistoryListItem,
    #[serde(default)]
    pub config: Option<Value>,
    pub cases: Vec<EvalHistoryCaseDetail>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalHistoryReadResult {
    pub entry: EvalHistoryEntry,
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
    HistoryListResult {
        id: String,
        result: EvalHistoryListResult,
    },
    HistoryReadResult {
        id: String,
        result: EvalHistoryReadResult,
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
