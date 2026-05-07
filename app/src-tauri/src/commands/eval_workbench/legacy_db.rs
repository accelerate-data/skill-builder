#![allow(dead_code)]

use crate::commands::eval_workbench::types::{
    DescriptionCandidate, EvalPromptCase, EvalPromptSet, EvalRun, EvalRunResult, EvalWorkbenchMode,
    NewEvalRun, SaveEvalPromptSet,
};
use rusqlite::Connection;
use serde_json::Value;

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
        rusqlite::params![
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
        rusqlite::params![prompt_set_id],
    )
    .map_err(|e| e.to_string())?;

    for (index, case) in input.cases.into_iter().enumerate() {
        let case_id = case.id.unwrap_or_else(|| new_id("prompt-case"));
        let assertions_json = serde_json::to_string(&case.assertions).map_err(|e| e.to_string())?;
        tx.execute(
            "INSERT INTO eval_prompt_cases (
                id, prompt_set_id, prompt, expected, should_trigger, assertions_json, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
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
        stmt.query_map(rusqlite::params![plugin_slug, skill_name, mode.as_str()], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(rusqlite::params![plugin_slug, skill_name], |row| {
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
        .query(rusqlite::params![prompt_set_id])
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
        .query_map(rusqlite::params![prompt_set_id], row_to_prompt_case)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(Some(set))
}

pub fn record_eval_run(conn: &mut Connection, input: NewEvalRun) -> Result<EvalRun, String> {
    let run_id = input.id.unwrap_or_else(|| new_id("eval-run"));
    let timestamp = now();
    let summary_json = serde_json::to_string(&input.summary).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "INSERT INTO eval_runs (
            id, prompt_set_id, plugin_slug, skill_name, scenario_name, mode, status, summary_json, created_at, completed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        rusqlite::params![
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
            rusqlite::params![
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
            rusqlite::params![
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
            rusqlite::params![plugin_slug, skill_name, mode.as_str(), limit],
            |row| row.get::<_, String>(0),
        )
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?
    } else {
        stmt.query_map(rusqlite::params![plugin_slug, skill_name, limit], |row| {
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
    let mut rows = stmt.query(rusqlite::params![run_id]).map_err(|e| e.to_string())?;
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
        .query_map(rusqlite::params![run_id], |row| {
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
        .query_map(rusqlite::params![run_id], |row| {
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
        .query(rusqlite::params![candidate_id])
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
