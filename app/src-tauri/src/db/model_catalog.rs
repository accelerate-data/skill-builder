use std::collections::HashMap;

use rusqlite::{Connection, Transaction};

use crate::types::{ModelCatalogEntry, ProviderCatalogRow};

/// Replace the entire provider/model snapshot in one transaction.
pub fn replace_model_catalog_snapshot(
    conn: &Connection,
    providers: &[crate::types::CatalogProvider],
) -> Result<(), rusqlite::Error> {
    let tx = conn.unchecked_transaction()?;

    // Clear existing data (CASCADE deletes child rows)
    tx.execute("DELETE FROM model_catalog", [])?;
    tx.execute("DELETE FROM provider_env", [])?;
    tx.execute("DELETE FROM provider_catalog", [])?;

    for provider in providers {
        tx.execute(
            "INSERT INTO provider_catalog (provider_id, name, npm, api_base_url, doc_url)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                provider.id,
                provider.name,
                provider.npm,
                provider.api,
                provider.doc,
            ],
        )?;

        for env_var in &provider.env {
            tx.execute(
                "INSERT INTO provider_env (provider_id, env_var) VALUES (?1, ?2)",
                rusqlite::params![provider.id, env_var],
            )?;
        }

        for (model_id, model) in &provider.models {
            let full_id = format!("{}:{}", provider.id, model_id);
            let (input_cost, output_cost) = match &model.cost {
                Some(cost) => (cost.input, cost.output),
                None => (None, None),
            };
            let context_limit = model.limit.context;

            let interleaved_json = model
                .interleaved
                .as_ref()
                .map(|v| serde_json::to_string(v))
                .transpose()
                .map_err(|e| rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))))?;

            let experimental_flag = match &model.experimental {
                Some(serde_json::Value::Bool(value)) => Some(*value as i32),
                _ => None,
            };

            tx.execute(
                "INSERT INTO model_catalog (
                    full_id, provider_id, model_id, name, family,
                    attachment, reasoning, tool_call, structured_output,
                    temperature, knowledge, release_date, last_updated,
                    open_weights, input_cost_per_token, output_cost_per_token,
                    context_limit, interleaved, status, experimental
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)",
                rusqlite::params![
                    full_id,
                    provider.id,
                    model_id,
                    model.name,
                    model.family,
                    model.attachment as i32,
                    model.reasoning as i32,
                    model.tool_call as i32,
                    model.structured_output.map(|v| v as i32),
                    model.temperature.map(|v| v as i32),
                    model.knowledge,
                    model.release_date,
                    model.last_updated,
                    model.open_weights as i32,
                    input_cost,
                    output_cost,
                    context_limit,
                    interleaved_json,
                    model.status,
                    experimental_flag,
                ],
            )?;

            for modality in &model.modalities.input {
                tx.execute(
                    "INSERT INTO model_input_modalities (full_id, modality) VALUES (?1, ?2)",
                    rusqlite::params![full_id, modality],
                )?;
            }

            for modality in &model.modalities.output {
                tx.execute(
                    "INSERT INTO model_output_modalities (full_id, modality) VALUES (?1, ?2)",
                    rusqlite::params![full_id, modality],
                )?;
            }
        }
    }

    tx.commit()
}

/// Read the cached model vector back.
pub fn read_cached_model_catalog(conn: &Connection) -> Result<Vec<ModelCatalogEntry>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT
            m.full_id, m.provider_id, m.model_id, m.name, m.family,
            m.attachment, m.reasoning, m.tool_call, m.structured_output,
            m.temperature, m.knowledge, m.release_date, m.last_updated,
            m.open_weights, m.input_cost_per_token, m.output_cost_per_token,
            m.context_limit, m.interleaved, m.status, m.experimental
         FROM model_catalog m
         ORDER BY m.provider_id, m.model_id",
    )?;

    let rows = stmt.query_map([], |row| {
        let interleaved: Option<String> = row.get(17)?;
        let interleaved_parsed = interleaved
            .and_then(|s| serde_json::from_str(&s).ok());

        Ok(ModelCatalogEntry {
            full_id: row.get(0)?,
            provider_id: row.get(1)?,
            model_id: row.get(2)?,
            name: row.get(3)?,
            family: row.get(4)?,
            attachment: row.get::<_, i32>(5)? != 0,
            reasoning: row.get::<_, i32>(6)? != 0,
            tool_call: row.get::<_, i32>(7)? != 0,
            structured_output: row.get::<_, Option<i32>>(8)?.map(|v| v != 0),
            temperature: row.get::<_, Option<i32>>(9)?.map(|v| v != 0),
            knowledge: row.get(10)?,
            release_date: row.get(11)?,
            last_updated: row.get(12)?,
            open_weights: row.get::<_, i32>(13)? != 0,
            input_cost_per_token: row.get(14)?,
            output_cost_per_token: row.get(15)?,
            context_limit: row.get(16)?,
            interleaved: interleaved_parsed,
            status: row.get(18)?,
            experimental: row.get::<_, Option<i32>>(19)?.map(|v| v != 0),
            input_modalities: Vec::new(),
            output_modalities: Vec::new(),
        })
    })?;

    let mut entries: Vec<ModelCatalogEntry> = rows.collect::<Result<Vec<_>, _>>()?;

    // Batch-fetch all modalities in two queries instead of N+1
    let mut input_stmt = conn.prepare(
        "SELECT full_id, modality FROM model_input_modalities ORDER BY full_id, modality",
    )?;
    let input_modalities: HashMap<String, Vec<String>> = input_stmt
        .query_map([], |row| {
            let full_id: String = row.get(0)?;
            let modality: String = row.get(1)?;
            Ok((full_id, modality))
        })?
        .filter_map(|r| r.ok())
        .fold(HashMap::new(), |mut acc, (full_id, modality)| {
            acc.entry(full_id).or_default().push(modality);
            acc
        });

    let mut output_stmt = conn.prepare(
        "SELECT full_id, modality FROM model_output_modalities ORDER BY full_id, modality",
    )?;
    let output_modalities: HashMap<String, Vec<String>> = output_stmt
        .query_map([], |row| {
            let full_id: String = row.get(0)?;
            let modality: String = row.get(1)?;
            Ok((full_id, modality))
        })?
        .filter_map(|r| r.ok())
        .fold(HashMap::new(), |mut acc, (full_id, modality)| {
            acc.entry(full_id).or_default().push(modality);
            acc
        });

    for entry in &mut entries {
        if let Some(m) = input_modalities.get(&entry.full_id) {
            entry.input_modalities = m.clone();
        }
        if let Some(m) = output_modalities.get(&entry.full_id) {
            entry.output_modalities = m.clone();
        }
    }

    Ok(entries)
}

/// Read the cached provider vector.
pub fn read_cached_providers(conn: &Connection) -> Result<Vec<ProviderCatalogRow>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT provider_id, name, npm, api_base_url, doc_url
         FROM provider_catalog
         ORDER BY name",
    )?;

    let rows = stmt.query_map([], |row| {
        Ok(ProviderCatalogRow {
            provider_id: row.get(0)?,
            name: row.get(1)?,
            npm: row.get(2)?,
            api_base_url: row.get(3)?,
            doc_url: row.get(4)?,
        })
    })?;

    rows.collect::<Result<Vec<_>, _>>()
}
