#![allow(dead_code)]

pub use crate::db::EvalWorkbenchMode;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioAssertionDto {
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioCaseDto {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub expected_outcome: Option<String>,
    #[serde(default)]
    pub should_trigger: Option<bool>,
    #[serde(default)]
    pub assertions: Vec<ScenarioAssertionDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDto {
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub cases: Vec<ScenarioCaseDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptionCandidate {
    pub id: String,
    #[serde(default)]
    pub run_id: String,
    pub label: String,
    pub description: String,
    #[serde(default)]
    pub rationale: Option<String>,
    #[serde(default)]
    pub rank: Option<i64>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunResult {
    pub id: String,
    pub run_id: String,
    pub case_id: String,
    pub candidate_id: String,
    pub passed: bool,
    pub score: f64,
    pub output: serde_json::Value,
    #[serde(default)]
    pub reason: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRun {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub mode: EvalWorkbenchMode,
    pub status: String,
    pub summary: serde_json::Value,
    pub created_at: String,
    #[serde(default)]
    pub completed_at: Option<String>,
    #[serde(default)]
    pub results: Vec<EvalRunResult>,
    #[serde(default)]
    pub description_candidates: Vec<DescriptionCandidate>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioAssertionDto {
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioCaseDto {
    pub id: String,
    pub prompt: String,
    pub expected_outcome: Option<String>,
    pub should_trigger: Option<bool>,
    pub assertions: Vec<ScenarioAssertionDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDto {
    pub name: String,
    pub tags: Vec<String>,
    pub cases: Vec<ScenarioCaseDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSummaryDto {
    pub name: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvalWorkbenchRequest {
    pub run_id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub mode: EvalWorkbenchMode,
    pub candidate_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestDescriptionCandidatesRequest {
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub baseline_description: String,
    #[serde(default)]
    pub candidate_count: Option<u32>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestAssertionsRequest {
    pub plugin_slug: String,
    pub skill_name: String,
    pub prompt: String,
    pub expected_outcome: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyDescriptionCandidateResponse {
    pub description: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineImprovementBrief {
    pub run_id: String,
    pub brief: String,
}
