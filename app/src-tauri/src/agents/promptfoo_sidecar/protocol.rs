use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EvalMode {
    Performance,
    Trigger,
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
    pub assertions: Vec<EvalAssertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EvalCandidate {
    pub id: String,
    pub label: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunEvalRequest {
    pub run_id: String,
    pub mode: EvalMode,
    pub target_skill_name: String,
    pub candidates: Vec<EvalCandidate>,
    pub cases: Vec<EvalCase>,
}

impl RunEvalRequest {
    pub fn new(
        run_id: impl Into<String>,
        mode: EvalMode,
        target_skill_name: impl Into<String>,
        candidates: Vec<EvalCandidate>,
        cases: Vec<EvalCase>,
    ) -> Self {
        Self {
            run_id: run_id.into(),
            mode,
            target_skill_name: target_skill_name.into(),
            candidates,
            cases,
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
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunResult {
    pub run_id: String,
    pub mode: EvalMode,
    pub results: Vec<EvalCaseResult>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    Progress {
        run_id: String,
        completed: u32,
        total: u32,
        message: String,
    },
    Result {
        result: EvalRunResult,
    },
    Error {
        run_id: String,
        message: String,
    },
}
