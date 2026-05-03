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
pub struct RunEvalWorkbenchRequest {
    pub prompt_set_id: String,
    pub candidate_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SuggestDescriptionCandidatesRequest {
    pub prompt_set_id: String,
    pub baseline_description: String,
    pub candidate_count: Option<u32>,
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
