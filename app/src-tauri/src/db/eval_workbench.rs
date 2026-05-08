#![allow(dead_code)]

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EvalWorkbenchMode {
    Performance,
}

impl EvalWorkbenchMode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Performance => "performance",
        }
    }

    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "performance" => Ok(Self::Performance),
            _ => Err("mode must be 'performance'".to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Scenario {
    pub id: String,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub sort_order: i64,
    pub created_at: String,
    pub updated_at: String,
    pub assertions: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveScenario {
    pub id: Option<String>,
    pub plugin_slug: String,
    pub skill_name: String,
    pub name: String,
    pub mode: EvalWorkbenchMode,
    pub prompt: String,
    pub assertions: Vec<String>,
}

fn now() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub fn save_scenario(conn: &mut Connection, input: SaveScenario) -> Result<Scenario, String> {
    let scenario_id = input.id.unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let timestamp = now();
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO scenarios (
            id, plugin_slug, skill_name, name, mode, prompt, sort_order, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8)
        ON CONFLICT(id) DO UPDATE SET
            plugin_slug = excluded.plugin_slug,
            skill_name = excluded.skill_name,
            name = excluded.name,
            mode = excluded.mode,
            prompt = excluded.prompt,
            sort_order = excluded.sort_order,
            updated_at = excluded.updated_at",
        params![
            scenario_id,
            input.plugin_slug,
            input.skill_name,
            input.name,
            input.mode.as_str(),
            input.prompt,
            0i64,
            timestamp,
        ],
    )
    .map_err(|e| e.to_string())?;

    tx.execute(
        "DELETE FROM assertions WHERE scenario_id = ?1",
        params![scenario_id],
    )
    .map_err(|e| e.to_string())?;

    for (index, assertion) in input.assertions.iter().enumerate() {
        let assertion_id = format!("assert-{}", uuid::Uuid::new_v4());
        tx.execute(
            "INSERT INTO assertions (id, scenario_id, assertion, sort_order)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                assertion_id,
                scenario_id,
                assertion,
                index as i64,
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;
    read_scenario(conn, &input.plugin_slug, &input.skill_name, &input.name)?
        .ok_or_else(|| "Scenario not found".to_string())
}

pub fn list_scenarios(
    conn: &Connection,
    plugin_slug: &str,
    skill_name: &str,
) -> Result<Vec<Scenario>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, plugin_slug, skill_name, name, mode, prompt, sort_order, created_at, updated_at
             FROM scenarios
             WHERE plugin_slug = ?1 AND skill_name = ?2
             ORDER BY sort_order ASC, name ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![plugin_slug, skill_name], |row| {
            let mode_str: String = row.get(4)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                mode_str,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
            ))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;

    drop(stmt);

    let mut scenarios = Vec::with_capacity(rows.len());
    for (id, pslug, sname, name, mode_str, prompt, sort_order, created_at, updated_at) in rows
    {
        let assertions = read_assertions(conn, &id)?;
        scenarios.push(Scenario {
            id,
            plugin_slug: pslug,
            skill_name: sname,
            name,
            mode: EvalWorkbenchMode::parse(&mode_str)?,
            prompt,
            sort_order,
            created_at,
            updated_at,
            assertions,
        });
    }

    Ok(scenarios)
}

fn read_assertions(conn: &Connection, scenario_id: &str) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT assertion FROM assertions
             WHERE scenario_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )
        .map_err(|e| e.to_string())?;

    let result = stmt
        .query_map(params![scenario_id], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    Ok(result)
}

pub fn read_scenario(
    conn: &Connection,
    plugin_slug: &str,
    skill_name: &str,
    name: &str,
) -> Result<Option<Scenario>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT id, plugin_slug, skill_name, name, mode, prompt, sort_order, created_at, updated_at
             FROM scenarios
             WHERE plugin_slug = ?1 AND skill_name = ?2 AND name = ?3",
        )
        .map_err(|e| e.to_string())?;

    let mut rows = stmt.query(params![plugin_slug, skill_name, name]).map_err(|e| e.to_string())?;
    let Some(row) = rows.next().map_err(|e| e.to_string())? else {
        return Ok(None);
    };

    let mode_str: String = row.get(4).map_err(|e| e.to_string())?;
    let id: String = row.get(0).map_err(|e| e.to_string())?;
    let assertions = read_assertions(conn, &id)?;

    Ok(Some(Scenario {
        id,
        plugin_slug: row.get(1).map_err(|e| e.to_string())?,
        skill_name: row.get(2).map_err(|e| e.to_string())?,
        name: row.get(3).map_err(|e| e.to_string())?,
        mode: EvalWorkbenchMode::parse(&mode_str)?,
        prompt: row.get(5).map_err(|e| e.to_string())?,
        sort_order: row.get(6).map_err(|e| e.to_string())?,
        created_at: row.get(7).map_err(|e| e.to_string())?,
        updated_at: row.get(8).map_err(|e| e.to_string())?,
        assertions,
    }))
}

pub fn delete_scenario(
    conn: &mut Connection,
    plugin_slug: &str,
    skill_name: &str,
    name: &str,
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "DELETE FROM scenarios WHERE plugin_slug = ?1 AND skill_name = ?2 AND name = ?3",
        params![plugin_slug, skill_name, name],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_db() -> Connection {
        crate::db::create_test_db_for_tests()
    }

    fn save_scenario_input(
        plugin_slug: &str,
        skill_name: &str,
        name: &str,
        mode: EvalWorkbenchMode,
        prompt: &str,
        assertions: Vec<&str>,
    ) -> SaveScenario {
        SaveScenario {
            id: None,
            plugin_slug: plugin_slug.to_string(),
            skill_name: skill_name.to_string(),
            name: name.to_string(),
            mode,
            prompt: prompt.to_string(),
            assertions: assertions.into_iter().map(String::from).collect(),
        }
    }

    #[test]
    fn saves_and_reads_scenario() {
        let mut conn = test_db();
        let input = save_scenario_input(
            "skills",
            "forecast",
            "Smoke",
            EvalWorkbenchMode::Performance,
            "Summarize revenue",
            vec!["Explains the forecast assumptions."],
        );
        let saved = save_scenario(&mut conn, input).unwrap();

        let read = read_scenario(&conn, "skills", "forecast", "Smoke")
            .unwrap()
            .unwrap();

        assert_eq!(read.id, saved.id);
        assert_eq!(read.plugin_slug, "skills");
        assert_eq!(read.skill_name, "forecast");
        assert_eq!(read.name, "Smoke");
        assert_eq!(read.mode, EvalWorkbenchMode::Performance);
        assert_eq!(read.prompt, "Summarize revenue");
        assert_eq!(read.assertions, vec!["Explains the forecast assumptions."]);
    }

    #[test]
    fn lists_scenarios_for_skill() {
        let mut conn = test_db();
        save_scenario(
            &mut conn,
            save_scenario_input(
                "skills",
                "forecast",
                "Scenario A",
                EvalWorkbenchMode::Performance,
                "Prompt A",
                vec!["A1"],
            ),
        )
        .unwrap();
        save_scenario(
            &mut conn,
            save_scenario_input(
                "skills",
                "forecast",
                "Scenario B",
                EvalWorkbenchMode::Performance,
                "Prompt B",
                vec!["B1", "B2"],
            ),
        )
        .unwrap();
        save_scenario(
            &mut conn,
            save_scenario_input(
                "skills",
                "other",
                "Scenario C",
                EvalWorkbenchMode::Performance,
                "Prompt C",
                vec!["C1"],
            ),
        )
        .unwrap();

        let list = list_scenarios(&conn, "skills", "forecast").unwrap();
        assert_eq!(list.len(), 2);
        let names: Vec<String> = list.into_iter().map(|s| s.name).collect();
        assert!(names.contains(&"Scenario A".to_string()));
        assert!(names.contains(&"Scenario B".to_string()));
    }

    #[test]
    fn updates_scenario_replacing_assertions() {
        let mut conn = test_db();
        let input = save_scenario_input(
            "skills",
            "forecast",
            "Update me",
            EvalWorkbenchMode::Performance,
            "Original prompt",
            vec!["old assertion"],
        );
        let saved = save_scenario(&mut conn, input).unwrap();

        let updated = save_scenario(
            &mut conn,
            SaveScenario {
                id: Some(saved.id.clone()),
                plugin_slug: "skills".to_string(),
                skill_name: "forecast".to_string(),
                name: "Update me".to_string(),
                mode: EvalWorkbenchMode::Performance,
                prompt: "Updated prompt".to_string(),
                assertions: vec!["new assertion 1".to_string(), "new assertion 2".to_string()],
            },
        )
        .unwrap();

        assert_eq!(updated.prompt, "Updated prompt");
        assert_eq!(updated.assertions, vec!["new assertion 1", "new assertion 2"]);

        let read = read_scenario(&conn, "skills", "forecast", "Update me")
            .unwrap()
            .unwrap();
        assert_eq!(read.assertions, vec!["new assertion 1", "new assertion 2"]);
    }

    #[test]
    fn deletes_scenario_cascading_assertions() {
        let mut conn = test_db();
        let input = save_scenario_input(
            "skills",
            "forecast",
            "Delete me",
            EvalWorkbenchMode::Performance,
            "Prompt",
            vec!["assertion 1", "assertion 2"],
        );
        save_scenario(&mut conn, input).unwrap();

        delete_scenario(&mut conn, "skills", "forecast", "Delete me").unwrap();

        let read = read_scenario(&conn, "skills", "forecast", "Delete me").unwrap();
        assert!(read.is_none());

        let count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM assertions WHERE scenario_id IN (
                    SELECT id FROM scenarios WHERE plugin_slug = ?1 AND skill_name = ?2 AND name = ?3
                )",
                params!["skills", "forecast", "Delete me"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn saves_performance_scenario_without_trigger_metadata() {
        let mut conn = test_db();
        let input = save_scenario_input(
            "skills",
            "forecast",
            "Scenario smoke",
            EvalWorkbenchMode::Performance,
            "Forecast revenue",
            vec!["Explains the forecast"],
        );
        let saved = save_scenario(&mut conn, input).unwrap();

        assert_eq!(saved.mode, EvalWorkbenchMode::Performance);

        let read = read_scenario(&conn, "skills", "forecast", "Scenario smoke")
            .unwrap()
            .unwrap();
        assert_eq!(read.assertions, vec!["Explains the forecast"]);
    }
}
