use std::path::{Path, PathBuf};

use crate::db::{
    db_delete_document, db_get_document, db_insert_document, db_list_documents,
    db_set_document_skills, db_update_document_scope, Db, DocumentRecord,
};
use crate::DataDir;

/// Lightweight skill id+name pair with plugin metadata for the document assignment UI.
#[derive(Debug, serde::Serialize)]
pub struct SkillIdName {
    pub id: i64,
    pub name: String,
    pub plugin_slug: String,
    pub plugin_display_name: String,
    pub is_default_plugin: bool,
}

/// List all non-deleted skills with plugin metadata for document assignment.
/// Default plugin ("skills") is returned first; within each plugin skills are sorted by name.
#[tauri::command]
pub fn list_skills_for_documents(db: tauri::State<'_, Db>) -> Result<Vec<SkillIdName>, String> {
    log::info!("list_skills_for_documents");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT s.id, s.name, p.slug, p.display_name, (p.slug = 'skills') AS is_default
             FROM skills s
             JOIN plugins p ON s.plugin_id = p.id
             WHERE COALESCE(s.deleted_at, '') = ''
             ORDER BY (p.slug != 'skills'), s.name ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |r| {
            let is_default: i64 = r.get(4)?;
            Ok(SkillIdName {
                id: r.get(0)?,
                name: r.get(1)?,
                plugin_slug: r.get(2)?,
                plugin_display_name: r.get(3)?,
                is_default_plugin: is_default != 0,
            })
        })
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();
    Ok(rows)
}

/// Sanitise a document name into a safe filename segment.
fn sanitise_filename(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '-'
            }
        })
        .collect::<String>()
        .to_lowercase()
}

/// Resolve the documents storage directory, creating it if absent.
fn documents_dir(data_dir: &Path) -> std::io::Result<PathBuf> {
    let dir = data_dir.join("documents");
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_documents(db: tauri::State<'_, Db>) -> Result<Vec<DocumentRecord>, String> {
    log::info!("list_documents");
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_list_documents(&conn).map_err(|e| {
        log::error!("list_documents: {}", e);
        e.to_string()
    })
}

// ---------------------------------------------------------------------------
// Add document from file bytes
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn add_document_file(
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, DataDir>,
    name: String,
    content: String,
    scope: String,
    skill_ids: Vec<i64>,
) -> Result<DocumentRecord, String> {
    log::info!("add_document_file: name={} scope={}", name, scope);

    let dir = documents_dir(&data_dir.0).map_err(|e| {
        log::error!("add_document_file: failed to create documents dir: {}", e);
        e.to_string()
    })?;

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Use a placeholder id pattern: insert first to get the id, then rename
    // For simplicity, insert with temp path then update.
    let temp_path = dir.join(format!("tmp-{}.md", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &content).map_err(|e| {
        log::error!("add_document_file: write failed: {}", e);
        e.to_string()
    })?;

    let doc_id = db_insert_document(
        &conn,
        &name,
        "file",
        None,
        temp_path.to_str().unwrap_or(""),
        &scope,
    )
    .map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        log::error!("add_document_file: db insert failed: {}", e);
        e.to_string()
    })?;

    // Rename to stable path incorporating the id
    let final_path = dir.join(format!("{}-{}.md", doc_id, sanitise_filename(&name)));
    if let Err(e) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        log::error!("add_document_file: rename failed: {}", e);
        return Err(e.to_string());
    }

    conn.execute(
        "UPDATE documents SET file_path = ?1 WHERE id = ?2",
        rusqlite::params![final_path.to_str().unwrap_or(""), doc_id],
    )
    .map_err(|e| e.to_string())?;

    if scope == "skill" && !skill_ids.is_empty() {
        db_set_document_skills(&conn, doc_id, &skill_ids).map_err(|e| e.to_string())?;
    }

    db_get_document(&conn, doc_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found after insert".to_string())
}

// ---------------------------------------------------------------------------
// Add document from URL (fetch + convert HTML to Markdown)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn add_document_url(
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, DataDir>,
    name: String,
    url: String,
    scope: String,
    skill_ids: Vec<i64>,
) -> Result<DocumentRecord, String> {
    log::info!(
        "add_document_url: name={} url={} scope={}",
        name,
        url,
        scope
    );

    let dir = documents_dir(&data_dir.0).map_err(|e| {
        log::error!("add_document_url: failed to create documents dir: {}", e);
        e.to_string()
    })?;

    // Fetch the URL
    let response = reqwest::get(&url).await.map_err(|e| {
        log::error!("add_document_url: fetch failed for {}: {}", url, e);
        format!("Failed to fetch URL: {}", e)
    })?;

    let body = response.text().await.map_err(|e| {
        log::error!("add_document_url: failed to read response body: {}", e);
        e.to_string()
    })?;

    // Convert HTML to Markdown
    let markdown = htmd::convert(&body).unwrap_or_else(|_| body.clone());

    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let temp_path = dir.join(format!("tmp-{}.md", uuid::Uuid::new_v4()));
    std::fs::write(&temp_path, &markdown).map_err(|e| {
        log::error!("add_document_url: write failed: {}", e);
        e.to_string()
    })?;

    let doc_id = db_insert_document(
        &conn,
        &name,
        "url",
        Some(&url),
        temp_path.to_str().unwrap_or(""),
        &scope,
    )
    .map_err(|e| {
        let _ = std::fs::remove_file(&temp_path);
        log::error!("add_document_url: db insert failed: {}", e);
        e.to_string()
    })?;

    let final_path = dir.join(format!("{}-{}.md", doc_id, sanitise_filename(&name)));
    if let Err(e) = std::fs::rename(&temp_path, &final_path) {
        let _ = std::fs::remove_file(&temp_path);
        log::error!("add_document_url: rename failed: {}", e);
        return Err(e.to_string());
    }

    conn.execute(
        "UPDATE documents SET file_path = ?1 WHERE id = ?2",
        rusqlite::params![final_path.to_str().unwrap_or(""), doc_id],
    )
    .map_err(|e| e.to_string())?;

    if scope == "skill" && !skill_ids.is_empty() {
        db_set_document_skills(&conn, doc_id, &skill_ids).map_err(|e| e.to_string())?;
    }

    log::info!(
        "add_document_url: saved {} chars of markdown to {} (doc_id={})",
        markdown.len(),
        final_path.display(),
        doc_id
    );

    db_get_document(&conn, doc_id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found after insert".to_string())
}

// ---------------------------------------------------------------------------
// Add documents from folder (walk, ingest .md, .txt, .pdf text layer)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn add_document_folder(
    db: tauri::State<'_, Db>,
    data_dir: tauri::State<'_, DataDir>,
    name: String,
    folder_path: String,
    scope: String,
    skill_ids: Vec<i64>,
) -> Result<Vec<DocumentRecord>, String> {
    log::info!(
        "add_document_folder: name={} path={} scope={}",
        name,
        folder_path,
        scope
    );

    let folder = Path::new(&folder_path);
    if !folder.is_dir() {
        return Err(format!("'{}' is not a directory", folder_path));
    }

    let dir = documents_dir(&data_dir.0).map_err(|e| e.to_string())?;
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    let mut records = Vec::new();
    let entries: Vec<_> = walkdir::WalkDir::new(folder)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
        .collect();

    for entry in entries {
        let path = entry.path();
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();
        if !["md", "txt", "pdf"].contains(&ext.as_str()) {
            continue;
        }

        let file_name = path
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("document");
        let doc_name = format!("{}/{}", name, file_name);

        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) => {
                log::warn!(
                    "add_document_folder: skipping unreadable file {}: {}",
                    path.display(),
                    e
                );
                continue;
            }
        };

        let temp_path = dir.join(format!("tmp-{}.md", uuid::Uuid::new_v4()));
        if let Err(e) = std::fs::write(&temp_path, &content) {
            log::warn!(
                "add_document_folder: failed to write {}: {}",
                temp_path.display(),
                e
            );
            continue;
        }

        let doc_id = match db_insert_document(
            &conn,
            &doc_name,
            "folder",
            None,
            temp_path.to_str().unwrap_or(""),
            &scope,
        ) {
            Ok(id) => id,
            Err(e) => {
                let _ = std::fs::remove_file(&temp_path);
                log::error!(
                    "add_document_folder: db insert failed for {}: {}",
                    doc_name,
                    e
                );
                continue;
            }
        };

        let final_path = dir.join(format!("{}-{}.md", doc_id, sanitise_filename(&doc_name)));
        if let Err(e) = std::fs::rename(&temp_path, &final_path) {
            let _ = std::fs::remove_file(&temp_path);
            log::error!("add_document_folder: rename failed: {}", e);
            continue;
        }

        let _ = conn.execute(
            "UPDATE documents SET file_path = ?1 WHERE id = ?2",
            rusqlite::params![final_path.to_str().unwrap_or(""), doc_id],
        );

        if scope == "skill" && !skill_ids.is_empty() {
            let _ = db_set_document_skills(&conn, doc_id, &skill_ids);
        }

        if let Ok(Some(rec)) = db_get_document(&conn, doc_id) {
            records.push(rec);
        }
    }

    log::info!(
        "add_document_folder: ingested {} files from {}",
        records.len(),
        folder_path
    );
    Ok(records)
}

// ---------------------------------------------------------------------------
// Update assignment
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn update_document(
    db: tauri::State<'_, Db>,
    id: i64,
    scope: String,
    skill_ids: Vec<i64>,
) -> Result<DocumentRecord, String> {
    log::info!("update_document: id={} scope={}", id, scope);
    let conn = db.0.lock().map_err(|e| e.to_string())?;
    db_update_document_scope(&conn, id, &scope, &skill_ids).map_err(|e| {
        log::error!("update_document: {}", e);
        e.to_string()
    })?;
    db_get_document(&conn, id)
        .map_err(|e| e.to_string())?
        .ok_or_else(|| "Document not found".to_string())
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn delete_document(db: tauri::State<'_, Db>, id: i64) -> Result<(), String> {
    log::info!("delete_document: id={}", id);
    let conn = db.0.lock().map_err(|e| e.to_string())?;

    // Remove the file from disk before deleting the DB record
    if let Ok(Some(doc)) = db_get_document(&conn, id) {
        if !doc.file_path.is_empty() {
            if let Err(e) = std::fs::remove_file(&doc.file_path) {
                log::warn!(
                    "delete_document: could not remove file {}: {}",
                    doc.file_path,
                    e
                );
            }
        }
    }

    db_delete_document(&conn, id).map_err(|e| {
        log::error!("delete_document: {}", e);
        e.to_string()
    })
}
