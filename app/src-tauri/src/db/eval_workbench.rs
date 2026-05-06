#![allow(dead_code)]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalWorkbenchMode {
    Performance,
    Trigger,
}

impl EvalWorkbenchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Performance => "performance",
            Self::Trigger => "trigger",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "performance" => Ok(Self::Performance),
            "trigger" => Ok(Self::Trigger),
            _ => Err("mode must be 'performance' or 'trigger'".to_string()),
        }
    }
}

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
#[allow(dead_code)]
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
#[allow(dead_code)]
pub struct NewDescriptionCandidate {
    pub id: Option<String>,
    pub label: String,
    pub description: String,
    pub rationale: Option<String>,
    pub rank: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[allow(dead_code)]
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

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

fn new_id(prefix: &str) -> String {
    format!("{prefix}-{}", uuid::Uuid::new_v4())
}

fn bool_to_i64(value: bool) -> i64 {
    if value {
        1
    } else {
        0
    }
}

#[cfg(test)]
fn row_to_prompt_case(row: &rusqlite::Row<'_>) -> rusqlite::Result<EvalPromptCase> {
    let assertions_json: String = row.get(4)?;
    Ok(EvalPromptCase {
        id: row.get(0)?,
        prompt: row.get(1)?,
        expected: row.get(2)?,
        should_trigger: row.get::<_, Option<i64>>(3)?.map(|value| value != 0),
        assertions: serde_json::from_str(&assertions_json).unwrap_or(Value::Array(vec![])),
        sort_order: row.get(5)?,
    })
}

#[cfg(test)]
pub fn save_eval_prompt_set(
    conn: &mut Connection,
    input: SaveEvalPromptSet,
) -> Result<EvalPromptSet, String> {
    let prompt_set_id = input.id.unwrap_or_else(|| new_id("prompt-set"));
    let timestamp = now();
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO eval_prompt_sets (
            id, plugin_slug, skill_name, mode, name, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
        ON CONFLICT(id) DO UPDATE SET
            plugin_slug = excluded.plugin_slug,
            skill_name = excluded.skill_name,
            mode = excluded.mode,
            name = excluded.name,
            updated_at = excluded.updated_at",
        params![
            prompt_set_id,
            input.plugin_slug,
            input.skill_name,
            input.mode.as_str(),
            input.name,
            timestamp,
        ],
    )
    .map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM eval_prompt_cases WHERE prompt_set_id = ?1",
        params![prompt_set_id],
    )
    .map_err(|e| e.to_string())?;

    for (index, case) in input.cases.into_iter().enumerate() {
        let case_id = case.id.unwrap_or_else(|| new_id("prompt-case"));
        let assertions_json = serde_json::to_string(&case.assertions).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO eval_prompt_cases (
                id, prompt_set_id, prompt, expected, should_trigger, assertions_json, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                case_id,
                prompt_set_id,
                case.prompt,
                case.expected,
                case.should_trigger.map(bool_to_i64),
                assertions_json,
                case.sort_order.unwrap_or(index as i64),
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    read_eval_prompt_set(conn, &prompt_set_id)?.ok_or_else(|| "Prompt set not found".to_string())
}

#[cfg(test)]
pub fn list_eval_prompt_sets(
    conn: &Connection,
    plugin_slug: &str,
    skill_name: &str,
    mode: Option<EvalWorkbenchMode>,
) -> Result<Vec<EvalPromptSet>, String> {
    let mut sets = Vec::new();
    let sql = if mode.is_some() {
        "SELECT id FROM eval_prompt_sets
         WHERE plugin_slug = ?1 AND skill_name = ?2 AND mode = ?3
         ORDER BY updated_at DESC, name ASC"
    } else {
        "SELECT id FROM eval_prompt_sets
         WHERE plugin_slug = ?1 AND skill_name = ?2
         ORDER BY updated_at DESC, name ASC"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let ids = if let Some(mode) = mode {
        stmt.query_map(params![plugin_slug, skill_name, mode.as_str()], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![plugin_slug, skill_name], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    for id in ids {
        if let Some(set) = read_eval_prompt_set(conn, &id)? {
            sets.push(set);
        }
    }
    Ok(sets)
}

#[cfg(test)]
pub fn read_eval_prompt_set(
    conn: &Connection,
    prompt_set_id: &str,
) -> Result<Option<EvalPromptSet>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, plugin_slug, skill_name, mode, name, created_at, updated_at
             FROM eval_prompt_sets WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![prompt_set_id])
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let mode_string: String = row.get(3).map_err(|e| e.to_string())?;
    let mut set = EvalPromptSet {
        id: row.get(0).map_err(|e| e.to_string())?,
        plugin_slug: row.get(1).map_err(|e| e.to_string())?,
        skill_name: row.get(2).map_err(|e| e.to_string())?,
        mode: EvalWorkbenchMode::parse(&mode_string)?,
        name: row.get(4).map_err(|e| e.to_string())?,
        created_at: row.get(5).map_err(|e| e.to_string())?,
        updated_at: row.get(6).map_err(|e| e.to_string())?,
        cases: vec![],
    };
    drop(rows);
    drop(stmt);

    let mut case_stmt = conn
        .prepare(
            "SELECT id, prompt, expected, should_trigger, assertions_json, sort_order
             FROM eval_prompt_cases
             WHERE prompt_set_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;
    set.cases = case_stmt
        .query_map(params![prompt_set_id], row_to_prompt_case)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(set))
}

#[allow(dead_code)]
pub fn record_eval_run(conn: &mut Connection, input: NewEvalRun) -> Result<EvalRun, String> {
    let run_id = input.id.unwrap_or_else(|| new_id("eval-run"));
    let timestamp = now();
    let summary_json = serde_json::to_string(&input.summary).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO eval_runs (
            id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            run_id,
            input.prompt_set_id,
            input.plugin_slug,
            input.skill_name,
            input.scenario_name,
            input.mode.as_str(),
            input.status,
            summary_json,
            timestamp,
            input.completed_at,
        ],
    )
    .map_err(|e| e.to_string())?;

    for result in input.results {
        let result_id = result.id.unwrap_or_else(|| new_id("eval-result"));
        let output_json = serde_json::to_string(&result.output).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO eval_run_results (
                id, run_id, case_id, candidate_id, passed, score, output_json, reason
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                result_id,
                run_id,
                result.case_id,
                result.candidate_id,
                bool_to_i64(result.passed),
                result.score,
                output_json,
                result.reason,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for candidate in input.description_candidates {
        let candidate_id = candidate.id.unwrap_or_else(|| new_id("desc-candidate"));
        tx.execute(
            "INSERT INTO description_candidates (
                id, run_id, label, description, rationale, rank
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                candidate_id,
                run_id,
                candidate.label,
                candidate.description,
                candidate.rationale,
                candidate.rank,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    read_eval_run(conn, &run_id)?.ok_or_else(|| "Eval run not found".to_string())
}

#[allow(dead_code)]
pub fn list_eval_runs(
    conn: &Connection,
    plugin_slug: &str,
    skill_name: &str,
    mode: Option<EvalWorkbenchMode>,
    limit: i64,
) -> Result<Vec<EvalRun>, String> {
    let limit = limit.clamp(1, 200);
    let sql = if mode.is_some() {
        "SELECT r.id
         FROM eval_runs r
         WHERE r.plugin_slug = ?1 AND r.skill_name = ?2 AND r.mode = ?3
         ORDER BY r.created_at DESC
         LIMIT ?4"
    } else {
        "SELECT r.id
         FROM eval_runs r
         WHERE r.plugin_slug = ?1 AND r.skill_name = ?2
         ORDER BY r.created_at DESC
         LIMIT ?3"
    };
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let ids = if let Some(mode) = mode {
        stmt.query_map(
            params![plugin_slug, skill_name, mode.as_str(), limit],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(params![plugin_slug, skill_name, limit], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    };

    ids.into_iter()
        .map(|id| read_eval_run(conn, &id)?.ok_or_else(|| "Eval run not found".to_string()))
        .collect()
}

pub fn read_eval_run(conn: &Connection, run_id: &str) -> Result<Option<EvalRun>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
             FROM eval_runs WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt.query(params![run_id]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    let mode_string: String = row.get(5).map_err(|e| e.to_string())?;
    let summary_json: String = row.get(7).map_err(|e| e.to_string())?;
    let mut run = EvalRun {
        id: row.get(0).map_err(|e| e.to_string())?,
        prompt_set_id: row.get(1).map_err(|e| e.to_string())?,
        plugin_slug: row.get(2).map_err(|e| e.to_string())?,
        skill_name: row.get(3).map_err(|e| e.to_string())?,
        scenario_name: row.get(4).map_err(|e| e.to_string())?,
        mode: EvalWorkbenchMode::parse(&mode_string)?,
        status: row.get(6).map_err(|e| e.to_string())?,
        summary: serde_json::from_str(&summary_json).unwrap_or(Value::Object(Default::default())),
        created_at: row.get(8).map_err(|e| e.to_string())?,
        completed_at: row.get(9).map_err(|e| e.to_string())?,
        results: vec![],
        description_candidates: vec![],
    };
    drop(rows);
    drop(stmt);

    let mut result_stmt = conn
        .prepare(
            "SELECT id, run_id, case_id, candidate_id, passed, score, output_json, reason
             FROM eval_run_results WHERE run_id = ?1
             ORDER BY case_id ASC, candidate_id ASC",
        )
        .map_err(|e| e.to_string())?;
    run.results = result_stmt
        .query_map(params![run_id], |row| {
            let output_json: String = row.get(6)?;
            Ok(EvalRunResult {
                id: row.get(0)?,
                run_id: row.get(1)?,
                case_id: row.get(2)?,
                candidate_id: row.get(3)?,
                passed: row.get::<_, i64>(4)? != 0,
                score: row.get(5)?,
                output: serde_json::from_str(&output_json).unwrap_or(Value::Null),
                reason: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    let mut candidate_stmt = conn
        .prepare(
            "SELECT id, run_id, label, description, rationale, rank
             FROM description_candidates WHERE run_id = ?1
             ORDER BY rank IS NULL, rank ASC, label ASC",
        )
        .map_err(|e| e.to_string())?;
    run.description_candidates = candidate_stmt
        .query_map(params![run_id], |row| {
            Ok(DescriptionCandidate {
                id: row.get(0)?,
                run_id: row.get(1)?,
                label: row.get(2)?,
                description: row.get(3)?,
                rationale: row.get(4)?,
                rank: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    Ok(Some(run))
}

pub fn read_description_candidate(
    conn: &Connection,
    candidate_id: &str,
) -> Result<Option<DescriptionCandidate>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, run_id, label, description, rationale, rank
             FROM description_candidates WHERE id = ?1",
        )
        .map_err(|e| e.to_string())?;
    let mut rows = stmt
        .query(params![candidate_id])
        .map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };
    Ok(Some(DescriptionCandidate {
        id: row.get(0).map_err(|e| e.to_string())?,
        run_id: row.get(1).map_err(|e| e.to_string())?,
        label: row.get(2).map_err(|e| e.to_string())?,
        description: row.get(3).map_err(|e| e.to_string())?,
        rationale: row.get(4).map_err(|e| e.to_string())?,
        rank: row.get(5).map_err(|e| e.to_string())?,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        crate::db::create_test_db_for_tests()
    }

    fn prompt_case(prompt: &str, should_trigger: Option<bool>) -> SaveEvalPromptCase {
        SaveEvalPromptCase {
            id: None,
            prompt: prompt.to_string(),
            expected: Some("expected".to_string()),
            should_trigger,
            assertions: serde_json::json!([{ "type": "contains", "value": "expected" }]),
            sort_order: None,
        }
    }

    #[test]
    fn creates_performance_prompt_set() {
        let mut conn = test_db();
        let saved = save_eval_prompt_set(
            &mut conn,
            SaveEvalPromptSet {
                id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                mode: EvalWorkbenchMode::Performance,
                name: "Performance smoke".to_string(),
                cases: vec![prompt_case("Summarize revenue", None)],
            },
        )
        .unwrap();

        assert_eq!(saved.mode, EvalWorkbenchMode::Performance);
        assert_eq!(saved.cases.len(), 1);
        assert_eq!(saved.cases[0].should_trigger, None);
    }

    #[test]
    fn creates_trigger_prompt_set_with_should_trigger_cases() {
        let mut conn = test_db();
        let saved = save_eval_prompt_set(
            &mut conn,
            SaveEvalPromptSet {
                id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                name: "Trigger smoke".to_string(),
                cases: vec![
                    prompt_case("Forecast revenue", Some(true)),
                    prompt_case("Explain the weather", Some(false)),
                ],
            },
        )
        .unwrap();

        assert_eq!(saved.mode, EvalWorkbenchMode::Trigger);
        assert_eq!(saved.cases[0].should_trigger, Some(true));
        assert_eq!(saved.cases[1].should_trigger, Some(false));
    }

    #[test]
    fn reads_scenario_backed_run_without_prompt_set_join() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO eval_runs (
                id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
            ) VALUES (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)",
            rusqlite::params![
                "run-file-backed",
                "skills",
                "forecast",
                "Regression",
                "performance",
                "completed",
                "{\"passRate\":1.0}",
                "2026-05-05T00:00:00Z",
            ],
        )
        .unwrap();

        let run = read_eval_run(&conn, "run-file-backed").unwrap().unwrap();
        let serialized = serde_json::to_value(&run).unwrap();

        assert_eq!(serialized.get("scenarioName").and_then(Value::as_str), Some("Regression"));
        assert_eq!(serialized.get("pluginSlug").and_then(Value::as_str), Some("skills"));
        assert_eq!(serialized.get("skillName").and_then(Value::as_str), Some("forecast"));
        assert_eq!(serialized.get("promptSetId"), Some(&Value::Null));
    }

    #[test]
    fn records_run_with_candidate_results_and_description_candidates() {
        let mut conn = test_db();
        let prompt_set = save_eval_prompt_set(
            &mut conn,
            SaveEvalPromptSet {
                id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                name: "Trigger smoke".to_string(),
                cases: vec![prompt_case("Forecast revenue", Some(true))],
            },
        )
        .unwrap();

        let run = record_eval_run(
            &mut conn,
            NewEvalRun {
                id: None,
                prompt_set_id: Some(prompt_set.id),
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Trigger smoke".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "completed".to_string(),
                summary: serde_json::json!({ "passRate": 1.0 }),
                completed_at: Some("2026-05-03T00:00:00Z".to_string()),
                results: vec![NewEvalRunResult {
                    id: None,
                    case_id: "case-1".to_string(),
                    candidate_id: "candidate-a".to_string(),
                    passed: true,
                    score: 1.0,
                    output: serde_json::json!({ "triggered": true }),
                    reason: None,
                }],
                description_candidates: vec![NewDescriptionCandidate {
                    id: None,
                    label: "Best".to_string(),
                    description: "Forecasts revenue trends.".to_string(),
                    rationale: Some("Highest trigger precision".to_string()),
                    rank: Some(1),
                }],
            },
        )
        .unwrap();

        assert_eq!(run.status, "completed");
        assert_eq!(run.results.len(), 1);
        assert_eq!(run.results[0].passed, true);
        assert_eq!(run.description_candidates.len(), 1);
        assert_eq!(run.description_candidates[0].rank, Some(1));
    }

    #[test]
    fn lists_scenario_backed_runs_by_skill_and_mode_without_prompt_set_join() {
        let conn = test_db();
        conn.execute(
            "INSERT INTO eval_runs (
                id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
            ) VALUES
                (?1, NULL, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL),
                (?9, NULL, ?10, ?11, ?12, ?13, ?14, ?15, ?16, NULL)",
            rusqlite::params![
                "run-trigger",
                "skills",
                "forecast",
                "Routing checks",
                "trigger",
                "completed",
                "{}",
                "2026-05-05T00:00:01Z",
                "run-performance",
                "skills",
                "forecast",
                "Regression",
                "performance",
                "completed",
                "{}",
                "2026-05-05T00:00:00Z",
            ],
        )
        .unwrap();

        let trigger_runs = list_eval_runs(
            &conn,
            "skills",
            "forecast",
            Some(EvalWorkbenchMode::Trigger),
            20,
        )
        .unwrap();
        let serialized = serde_json::to_value(&trigger_runs[0]).unwrap();

        assert_eq!(trigger_runs.len(), 1);
        assert_eq!(trigger_runs[0].id, "run-trigger");
        assert_eq!(
            serialized.get("scenarioName").and_then(Value::as_str),
            Some("Routing checks")
        );
    }

    #[test]
    fn lists_latest_runs_by_skill_and_mode() {
        let mut conn = test_db();
        let performance_set = save_eval_prompt_set(
            &mut conn,
            SaveEvalPromptSet {
                id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                mode: EvalWorkbenchMode::Performance,
                name: "Performance".to_string(),
                cases: vec![prompt_case("Summarize revenue", None)],
            },
        )
        .unwrap();
        let trigger_set = save_eval_prompt_set(
            &mut conn,
            SaveEvalPromptSet {
                id: None,
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                name: "Trigger".to_string(),
                cases: vec![prompt_case("Forecast revenue", Some(true))],
            },
        )
        .unwrap();

        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("run-performance".to_string()),
                prompt_set_id: Some(performance_set.id),
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Performance".to_string(),
                mode: EvalWorkbenchMode::Performance,
                status: "completed".to_string(),
                summary: serde_json::json!({}),
                completed_at: None,
                results: vec![],
                description_candidates: vec![],
            },
        )
        .unwrap();
        record_eval_run(
            &mut conn,
            NewEvalRun {
                id: Some("run-trigger".to_string()),
                prompt_set_id: Some(trigger_set.id),
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                scenario_name: "Trigger".to_string(),
                mode: EvalWorkbenchMode::Trigger,
                status: "completed".to_string(),
                summary: serde_json::json!({}),
                completed_at: None,
                results: vec![],
                description_candidates: vec![],
            },
        )
        .unwrap();

        let trigger_runs = list_eval_runs(
            &conn,
            "skills",
            "forecast",
            Some(EvalWorkbenchMode::Trigger),
            20,
        )
        .unwrap();
        assert_eq!(trigger_runs.len(), 1);
        assert_eq!(trigger_runs[0].id, "run-trigger");
    }
}
