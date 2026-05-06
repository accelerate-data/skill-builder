use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScenarioTag {
    Performance,
    Trigger,
    Both,
}

impl ScenarioTag {
    pub fn matches_mode(&self, mode: crate::db::EvalWorkbenchMode) -> bool {
        matches!(
            (self, mode),
            (Self::Both, _)
                | (Self::Performance, crate::db::EvalWorkbenchMode::Performance)
                | (Self::Trigger, crate::db::EvalWorkbenchMode::Trigger)
        )
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Scenario {
    pub id: String,
    pub name: String,
    pub tags: Vec<ScenarioTag>,
    pub prompt: String,
    pub should_trigger: Option<bool>,
    #[serde(default)]
    pub expectations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ScenarioSummary {
    pub name: String,
    pub tags: Vec<ScenarioTag>,
}

fn scenario_summary(scenario: &Scenario) -> ScenarioSummary {
    ScenarioSummary {
        name: scenario.name.clone(),
        tags: scenario.tags.clone(),
    }
}

fn scenario_file_entries(eval_dir: &Path) -> Result<Vec<PathBuf>, String> {
    if !eval_dir.exists() {
        return Ok(vec![]);
    }

    let mut paths = Vec::new();
    for entry in fs::read_dir(eval_dir)
        .map_err(|e| format!("Failed to read eval dir {}: {}", eval_dir.display(), e))?
    {
        let entry = entry.map_err(|e| format!("Failed to read eval dir entry: {}", e))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if !matches!(
            path.extension().and_then(|value| value.to_str()),
            Some("yaml") | Some("yml")
        ) {
            continue;
        }
        if path.file_stem().and_then(|value| value.to_str()) == Some("promptfooconfig") {
            continue;
        }
        paths.push(path);
    }
    paths.sort();
    Ok(paths)
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
    if scenario.id.trim().is_empty() {
        return Err("Scenario id cannot be empty".to_string());
    }
    if scenario.id.contains('/') || scenario.id.contains('\\') || scenario.id.contains("..") {
        return Err("Scenario id contains invalid path characters".to_string());
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

pub fn scenario_file_path(eval_dir: &Path, scenario_name: &str) -> PathBuf {
    eval_dir.join(format!("{}.yaml", slugify_scenario_name(scenario_name)))
}

pub fn read_scenario_file(path: &Path) -> Result<Scenario, String> {
    let content = fs::read_to_string(path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    let scenario: Scenario = serde_yaml::from_str(&content)
        .map_err(|e| format!("Failed to parse {}: {}", path.display(), e))?;
    validate_scenario(&scenario)?;
    Ok(scenario)
}

pub fn write_scenario_file(path: &Path, scenario: &Scenario) -> Result<(), String> {
    validate_scenario(scenario)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    let content = serde_yaml::to_string(scenario)
        .map_err(|e| format!("Failed to serialize scenario: {}", e))?;
    fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn read_all_scenarios_with_paths(eval_dir: &Path) -> Result<Vec<(PathBuf, Scenario)>, String> {
    let mut scenarios = Vec::new();
    for path in scenario_file_entries(eval_dir)? {
        let scenario = match read_scenario_file(&path) {
            Ok(scenario) => scenario,
            Err(_) => continue,
        };
        scenarios.push((path, scenario));
    }

    scenarios.sort_by(|left, right| {
        left.1
            .name
            .to_ascii_lowercase()
            .cmp(&right.1.name.to_ascii_lowercase())
            .then_with(|| left.1.name.cmp(&right.1.name))
            .then_with(|| left.0.cmp(&right.0))
    });
    Ok(scenarios)
}

fn read_all_scenarios(eval_dir: &Path) -> Result<Vec<Scenario>, String> {
    read_all_scenarios_with_paths(eval_dir)
        .map(|items| items.into_iter().map(|(_, scenario)| scenario).collect())
}

fn find_matching_scenarios(
    eval_dir: &Path,
    scenario_name: &str,
) -> Result<Vec<(PathBuf, Scenario)>, String> {
    let mut matches = Vec::new();
    for path in scenario_file_entries(eval_dir)? {
        let scenario = match read_scenario_file(&path) {
            Ok(scenario) => scenario,
            Err(_) => continue,
        };
        if scenario.name == scenario_name {
            matches.push((path, scenario));
        }
    }
    Ok(matches)
}

pub fn list_scenarios(eval_dir: &Path) -> Result<Vec<ScenarioSummary>, String> {
    read_all_scenarios(eval_dir).map(|items| {
        items
            .into_iter()
            .map(|scenario| scenario_summary(&scenario))
            .collect()
    })
}

pub fn load_scenario(eval_dir: &Path, scenario_name: &str) -> Result<Option<Scenario>, String> {
    validate_scenario_name(scenario_name)?;
    Ok(find_matching_scenarios(eval_dir, scenario_name)?
        .into_iter()
        .map(|(_, scenario)| scenario)
        .next())
}

pub fn delete_other_scenario_files(
    eval_dir: &Path,
    scenario_name: &str,
    keep_path: &Path,
) -> Result<(), String> {
    validate_scenario_name(scenario_name)?;
    for (path, _) in find_matching_scenarios(eval_dir, scenario_name)? {
        if path == keep_path {
            continue;
        }
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
    }
    Ok(())
}

pub fn delete_scenario_file(eval_dir: &Path, scenario_name: &str) -> Result<(), String> {
    validate_scenario_name(scenario_name)?;
    let mut deleted = false;
    for (path, _) in find_matching_scenarios(eval_dir, scenario_name)? {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
        deleted = true;
    }
    if !deleted {
        for path in [
            scenario_file_path(eval_dir, scenario_name),
            eval_dir.join(format!("{}.yml", slugify_scenario_name(scenario_name))),
        ] {
            if path.exists() {
                fs::remove_file(&path)
                    .map_err(|e| format!("Failed to delete {}: {}", path.display(), e))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_scenario() -> Scenario {
        Scenario {
            id: "case-1".into(),
            name: "Regression".into(),
            tags: vec![ScenarioTag::Both],
            prompt: "Show me Q3 booking trends".into(),
            should_trigger: Some(true),
            expectations: vec!["Explains the regional booking trends.".into()],
        }
    }

    #[test]
    fn round_trips_yaml() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("regression.yaml");
        let scenario = sample_scenario();
        write_scenario_file(&path, &scenario).unwrap();
        let loaded = read_scenario_file(&path).unwrap();
        assert_eq!(loaded, scenario);
    }

    #[test]
    fn lists_yaml_scenarios_only() {
        let tmp = tempfile::tempdir().unwrap();
        write_scenario_file(&tmp.path().join("a.yaml"), &sample_scenario()).unwrap();
        write_scenario_file(&tmp.path().join("b.yaml"), &sample_scenario()).unwrap();
        fs::write(tmp.path().join("promptfooconfig.yaml"), "ignore: true").unwrap();
        let scenarios = list_scenarios(tmp.path()).unwrap();
        assert_eq!(
            scenarios,
            vec![
                ScenarioSummary {
                    name: "Regression".into(),
                    tags: vec![ScenarioTag::Both],
                },
                ScenarioSummary {
                    name: "Regression".into(),
                    tags: vec![ScenarioTag::Both],
                },
            ]
        );
    }

    #[test]
    fn loads_scenario_by_name() {
        let tmp = tempfile::tempdir().unwrap();
        let scenario = sample_scenario();
        let path = scenario_file_path(tmp.path(), &scenario.name);
        write_scenario_file(&path, &scenario).unwrap();

        let loaded = load_scenario(tmp.path(), &scenario.name).unwrap();

        assert_eq!(loaded, Some(scenario));
    }

    #[test]
    fn returns_none_for_missing_scenario() {
        let tmp = tempfile::tempdir().unwrap();

        let loaded = load_scenario(tmp.path(), "Missing").unwrap();

        assert_eq!(loaded, None);
    }

    #[test]
    fn slugifies_scenario_name() {
        assert_eq!(slugify_scenario_name("Happy Path"), "happy-path");
    }

    #[test]
    fn deletes_slugified_scenario_file() {
        let tmp = tempfile::tempdir().unwrap();
        let path = scenario_file_path(tmp.path(), "Revenue Regression");
        write_scenario_file(&path, &sample_scenario()).unwrap();

        delete_scenario_file(tmp.path(), "Revenue Regression").unwrap();

        assert!(!path.exists());
    }

    #[test]
    fn rejects_both_tag_when_combined_with_other_tags() {
        let mut scenario = sample_scenario();
        scenario.tags = vec![ScenarioTag::Both, ScenarioTag::Trigger];

        let error = validate_scenario(&scenario).unwrap_err();

        assert!(error.contains("must not be combined"));
    }
}
