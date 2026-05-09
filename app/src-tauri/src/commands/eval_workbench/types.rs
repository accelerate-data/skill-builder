#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioDto {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    pub prompt: String,
    pub assertions: Vec<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioSummaryDto {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
}
