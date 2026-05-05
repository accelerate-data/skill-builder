use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::db::EvalWorkbenchMode;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioTag {
    Performance,
    Trigger,
    Both,
}

impl ScenarioTag {
    pub fn matches_mode(&self, mode: EvalWorkbenchMode) -> bool {
        matches!(
            (self, mode),
            (Self::Both, _)
                | (Self::Performance, EvalWorkbenchMode::Performance)
                | (Self::Trigger, EvalWorkbenchMode::Trigger)
        )
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioAssertion {
    #[serde(rename = "type")]
    pub assertion_type: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScenarioCase {
    pub id: String,
    pub prompt: String,
    #[serde(default)]
    pub expected_outcome: Option<String>,
    #[serde(default)]
    pub should_trigger: Option<bool>,
    #[serde(default)]
    pub assertions: Vec<ScenarioAssertion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub name: String,
    #[serde(default)]
    pub tags: Vec<ScenarioTag>,
    #[serde(default)]
    pub cases: Vec<ScenarioCase>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SaveScenario {
    pub original_name: Option<String>,
    #[serde(flatten)]
    pub scenario: Scenario,
}

pub fn validate_scenario_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Scenario name cannot be empty".to_string());
    }
    if name.contains('/') || name.contains('\\') || name.contains("..") {
        return Err("Scenario name contains invalid path characters".to_string());
    }
    Ok(())
}

pub fn validate_scenario(scenario: &Scenario) -> Result<(), String> {
    validate_scenario_name(&scenario.name)?;
    if scenario.tags.is_empty() {
        return Err("Scenario tags cannot be empty".to_string());
    }
    if scenario.tags.contains(&ScenarioTag::Both) && scenario.tags.len() > 1 {
        return Err("Scenario tag 'both' must not be combined with other tags".to_string());
    }
    if scenario.cases.is_empty() {
        return Err("Scenario cases cannot be empty".to_string());
    }

    for case in &scenario.cases {
        if case.id.trim().is_empty() {
            return Err("Scenario case id cannot be empty".to_string());
        }
        if case.id.contains('/') || case.id.contains('\\') || case.id.contains("..") {
            return Err("Scenario case id contains invalid path characters".to_string());
        }
        if case.prompt.trim().is_empty() {
            return Err(format!(
                "Scenario case '{}' prompt cannot be empty",
                case.id
            ));
        }
    }

    Ok(())
}

pub fn slugify_scenario_name(name: &str) -> String {
    let mut slug = String::new();
    let mut last_was_dash = false;
    for ch in name.trim().chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            slug.push(lower);
            last_was_dash = false;
        } else if !last_was_dash {
            slug.push('-');
            last_was_dash = true;
        }
    }
    slug.trim_matches('-').to_string()
}

pub fn scenario_file_name(scenario_name: &str) -> String {
    let slug = slugify_scenario_name(scenario_name);
    format!("{}.yaml", if slug.is_empty() { "scenario" } else { &slug })
}

pub fn scenario_file_path(eval_dir: &Path, scenario_name: &str) -> PathBuf {
    eval_dir.join(scenario_file_name(scenario_name))
}

pub fn read_scenario_file(path: &Path) -> Result<Scenario, String> {
    let content = fs::read_to_string(path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let scenario = serde_yaml::from_str(&content)
        .map_err(|error| format!("Failed to parse {}: {error}", path.display()))?;
    validate_scenario(&scenario)?;
    Ok(scenario)
}

pub fn write_scenario_file(path: &Path, scenario: &Scenario) -> Result<(), String> {
    validate_scenario(scenario)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "Failed to create scenario directory {}: {error}",
                parent.display()
            )
        })?;
    }

    let content = serde_yaml::to_string(scenario)
        .map_err(|error| format!("Failed to serialize scenario {}: {error}", scenario.name))?;
    fs::write(path, content)
        .map_err(|error| format!("Failed to write scenario file {}: {error}", path.display()))
}

pub fn list_scenarios(eval_dir: &Path) -> Result<Vec<Scenario>, String> {
    if !eval_dir.exists() {
        return Ok(vec![]);
    }

    let mut scenarios = Vec::new();
    for entry in fs::read_dir(eval_dir)
        .map_err(|error| format!("Failed to read eval dir {}: {error}", eval_dir.display()))?
    {
        let entry = entry.map_err(|error| format!("Failed to read eval dir entry: {error}"))?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("yaml") {
            continue;
        }
        if path.file_name().and_then(|value| value.to_str()) == Some("promptfooconfig.yaml") {
            continue;
        }
        scenarios.push(read_scenario_file(&path)?);
    }

    scenarios.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(scenarios)
}

pub fn delete_scenario_file(eval_dir: &Path, scenario_name: &str) -> Result<(), String> {
    validate_scenario_name(scenario_name)?;
    let path = scenario_file_path(eval_dir, scenario_name);
    if !path.exists() {
        return Ok(());
    }

    fs::remove_file(&path)
        .map_err(|error| format!("Failed to delete scenario {}: {error}", path.display()))
}

pub fn rename_scenario_file(
    eval_dir: &Path,
    original_name: &str,
    next_name: &str,
) -> Result<(), String> {
    if original_name == next_name {
        return Ok(());
    }

    let source = scenario_file_path(eval_dir, original_name);
    if !source.exists() {
        return Ok(());
    }

    let target = scenario_file_path(eval_dir, next_name);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Failed to prepare {}: {error}", parent.display()))?;
    }
    fs::rename(&source, &target).map_err(|error| {
        format!(
            "Failed to rename scenario file {} -> {}: {error}",
            source.display(),
            target.display()
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn sample_scenario() -> Scenario {
        Scenario {
            name: "Regression".into(),
            tags: vec![ScenarioTag::Both],
            cases: vec![ScenarioCase {
                id: "case-1".into(),
                prompt: "Show me Q3 booking trends".into(),
                expected_outcome: Some("Regional breakdown with trend direction".into()),
                should_trigger: Some(true),
                assertions: vec![ScenarioAssertion {
                    assertion_type: "contains".into(),
                    value: "region".into(),
                }],
            }],
        }
    }

    #[test]
    fn round_trips_yaml() {
        let tmp = tempdir().unwrap();
        let path = tmp.path().join("regression.yaml");
        let scenario = sample_scenario();

        write_scenario_file(&path, &scenario).unwrap();

        let loaded = read_scenario_file(&path).unwrap();
        assert_eq!(loaded, scenario);
    }

    #[test]
    fn lists_yaml_scenarios_and_skips_promptfoo_config() {
        let tmp = tempdir().unwrap();
        write_scenario_file(&tmp.path().join("a.yaml"), &sample_scenario()).unwrap();
        write_scenario_file(&tmp.path().join("b.yaml"), &sample_scenario()).unwrap();
        fs::write(tmp.path().join("promptfooconfig.yaml"), "tests: []").unwrap();

        let scenarios = list_scenarios(tmp.path()).unwrap();

        assert_eq!(scenarios.len(), 2);
    }

    #[test]
    fn slugifies_scenario_names() {
        assert_eq!(
            slugify_scenario_name("Revenue Regression"),
            "revenue-regression"
        );
    }

    #[test]
    fn rejects_both_tag_when_combined_with_other_tags() {
        let mut scenario = sample_scenario();
        scenario.tags = vec![ScenarioTag::Both, ScenarioTag::Trigger];

        let error = validate_scenario(&scenario).unwrap_err();

        assert!(error.contains("must not be combined"));
    }
}
