#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type EvalWorkbenchMode = crate::db::EvalWorkbenchMode;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalPromptCase {
    pub id: String,
    pub prompt: String,
    pub expected: Option<String>,
    pub should_trigger: Option<bool>,
    pub assertions: Value,
    pub sort_order: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalPromptSet {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub mode: EvalWorkbenchMode,
    pub name: String,
    pub cases: Vec<EvalPromptCase>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEvalPromptCase {
    pub id: Option<String>,
    pub prompt: String,
    pub expected: Option<String>,
    pub should_trigger: Option<bool>,
    pub assertions: Value,
    pub sort_order: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEvalPromptSet {
    pub id: Option<String>,
    pub plugin_slug: String,
    pub skill_name: String,
    pub mode: EvalWorkbenchMode,
    pub name: String,
    pub cases: Vec<SaveEvalPromptCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRunResult {
    pub id: String,
    pub run_id: String,
    pub case_id: String,
    pub candidate_id: String,
    pub passed: bool,
    pub score: f64,
    pub output: Value,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DescriptionCandidate {
    pub id: String,
    pub run_id: String,
    pub label: String,
    pub description: String,
    pub rationale: Option<String>,
    pub rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvalRun {
    pub id: String,
    pub prompt_set_id: Option<String>,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub mode: EvalWorkbenchMode,
    pub status: String,
    pub summary: Value,
    pub created_at: String,
    pub completed_at: Option<String>,
    pub results: Vec<EvalRunResult>,
    pub description_candidates: Vec<DescriptionCandidate>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvalRunResult {
    pub id: Option<String>,
    pub case_id: String,
    pub candidate_id: String,
    pub passed: bool,
    pub score: f64,
    pub output: Value,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewDescriptionCandidate {
    pub id: Option<String>,
    pub label: String,
    pub description: String,
    pub rationale: Option<String>,
    pub rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvalRun {
    pub id: Option<String>,
    pub prompt_set_id: Option<String>,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: String,
    pub mode: EvalWorkbenchMode,
    pub status: String,
    pub summary: Value,
    pub completed_at: Option<String>,
    pub results: Vec<NewEvalRunResult>,
    pub description_candidates: Vec<NewDescriptionCandidate>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDto {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub prompt: String,
    pub expectations: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSummaryDto {
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RunEvalWorkbenchRequest {
    pub run_id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub scenario_name: Option<String>,
    pub mode: crate::db::EvalWorkbenchMode,
    pub candidate_ids: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefineImprovementBrief {
    pub run_id: String,
    pub brief: String,
}
