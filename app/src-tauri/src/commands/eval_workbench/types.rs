#![allow(dead_code)]

pub type DescriptionCandidate = crate::db::DescriptionCandidate;
pub type EvalPromptCase = crate::db::EvalPromptCase;
pub type EvalPromptSet = crate::db::EvalPromptSet;
pub type EvalRun = crate::db::EvalRun;
pub type EvalRunResult = crate::db::EvalRunResult;
pub type EvalWorkbenchMode = crate::db::EvalWorkbenchMode;
pub type SaveEvalPromptCase = crate::db::SaveEvalPromptCase;
pub type SaveEvalPromptSet = crate::db::SaveEvalPromptSet;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioAssertionDto {
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub value: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDto {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub prompt: String,
    pub should_trigger: Option<bool>,
    pub assertions: Vec<ScenarioAssertionDto>,
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
