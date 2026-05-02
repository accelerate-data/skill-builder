use rusqlite::{params, Connection};

/// A document record from the `documents` table.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct DocumentRecord {
    pub id: i64,
    pub name: String,
    pub source_type: String,
    pub source_url: Option<String>,
    pub file_path: String,
    pub scope: String,
    /// Populated from `document_skills` — only meaningful when scope = "skill".
    pub skill_ids: Vec<i64>,
    pub created_at: String,
    pub updated_at: String,
}

/// Lightweight document content used for injecting into user-context.md.
#[derive(Debug, Clone)]
pub struct DocumentContent {
    pub name: String,
    pub file_path: String,
    pub content: String,
}

const MAX_DOCUMENT_CHARS: usize = 50_000;

pub fn db_insert_document(
    conn: &Connection,
    name: &str,
    source_type: &str,
    source_url: Option<&str>,
    file_path: &str,
    scope: &str,
) -> Result<i64, rusqlite::Error> {
    conn.execute(
        "INSERT INTO documents (name, source_type, source_url, file_path, scope)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![name, source_type, source_url, file_path, scope],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn db_set_document_skills(
    conn: &Connection,
    document_id: i64,
    skill_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM document_skills WHERE document_id = ?1",
        params![document_id],
    )?;
    for &sid in skill_ids {
        conn.execute(
            "INSERT OR IGNORE INTO document_skills (document_id, skill_id) VALUES (?1, ?2)",
            params![document_id, sid],
        )?;
    }
    Ok(())
}

pub fn db_get_document(
    conn: &Connection,
    id: i64,
) -> Result<Option<DocumentRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, source_type, source_url, file_path, scope, created_at, updated_at
         FROM documents WHERE id = ?1",
    )?;
    let row = stmt.query_row(params![id], |r| {
        Ok(DocumentRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            source_type: r.get(2)?,
            source_url: r.get(3)?,
            file_path: r.get(4)?,
            scope: r.get(5)?,
            skill_ids: vec![],
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    });
    match row {
        Ok(mut doc) => {
            doc.skill_ids = db_get_skill_ids_for_document(conn, doc.id)?;
            Ok(Some(doc))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(e) => Err(e),
    }
}

pub fn db_list_documents(conn: &Connection) -> Result<Vec<DocumentRecord>, rusqlite::Error> {
    let mut stmt = conn.prepare(
        "SELECT id, name, source_type, source_url, file_path, scope, created_at, updated_at
         FROM documents ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(DocumentRecord {
            id: r.get(0)?,
            name: r.get(1)?,
            source_type: r.get(2)?,
            source_url: r.get(3)?,
            file_path: r.get(4)?,
            scope: r.get(5)?,
            skill_ids: vec![],
            created_at: r.get(6)?,
            updated_at: r.get(7)?,
        })
    })?;
    let mut docs: Vec<DocumentRecord> = rows.filter_map(|r| r.ok()).collect();
    for doc in &mut docs {
        doc.skill_ids = db_get_skill_ids_for_document(conn, doc.id).unwrap_or_default();
    }
    Ok(docs)
}

pub fn db_get_skill_ids_for_document(
    conn: &Connection,
    document_id: i64,
) -> Result<Vec<i64>, rusqlite::Error> {
    let mut stmt = conn.prepare("SELECT skill_id FROM document_skills WHERE document_id = ?1")?;
    let ids = stmt
        .query_map(params![document_id], |r| r.get(0))?
        .filter_map(|r| r.ok())
        .collect();
    Ok(ids)
}

pub fn db_update_document_scope(
    conn: &Connection,
    id: i64,
    scope: &str,
    skill_ids: &[i64],
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE documents SET scope = ?1, updated_at = datetime('now') || 'Z' WHERE id = ?2",
        params![scope, id],
    )?;
    db_set_document_skills(conn, id, skill_ids)?;
    Ok(())
}

pub fn db_delete_document(conn: &Connection, id: i64) -> Result<(), rusqlite::Error> {
    conn.execute("DELETE FROM documents WHERE id = ?1", params![id])?;
    Ok(())
}

/// Return document contents applicable for a given skill (scope=all OR skill_id in junction table).
/// Truncates each document at MAX_DOCUMENT_CHARS and warns if truncated.
/// If a document file is missing on disk, logs a warning and skips it.
pub fn db_documents_for_skill(
    conn: &Connection,
    skill_id: i64,
) -> Result<Vec<DocumentContent>, rusqlite::Error> {
    // Query documents that are either scoped to 'all' or explicitly assigned to this skill.
    let mut stmt = conn.prepare(
        "SELECT d.name, d.file_path
         FROM documents d
         WHERE d.scope = 'all'
            OR EXISTS (
                SELECT 1 FROM document_skills ds
                WHERE ds.document_id = d.id AND ds.skill_id = ?1
            )
         ORDER BY d.created_at ASC",
    )?;
    let rows: Vec<(String, String)> = stmt
        .query_map(params![skill_id], |r| Ok((r.get(0)?, r.get(1)?)))?
        .filter_map(|r| r.ok())
        .collect();

    let mut contents = Vec::new();
    for (name, file_path) in rows {
        match std::fs::read_to_string(&file_path) {
            Ok(raw) => {
                let content = if raw.len() > MAX_DOCUMENT_CHARS {
                    log::warn!(
                        "[documents] document '{}' truncated at {} chars (was {} chars): {}",
                        name,
                        MAX_DOCUMENT_CHARS,
                        raw.len(),
                        file_path
                    );
                    let mut truncated = raw[..MAX_DOCUMENT_CHARS].to_string();
                    truncated.push_str("\n\n[Document truncated at 50,000 characters]");
                    truncated
                } else {
                    raw
                };
                contents.push(DocumentContent {
                    name,
                    file_path,
                    content,
                });
            }
            Err(e) => {
                log::warn!(
                    "[documents] skipping missing/unreadable document '{}' at {}: {}",
                    name,
                    file_path,
                    e
                );
            }
        }
    }
    Ok(contents)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;

    fn insert_test_skill(conn: &Connection, name: &str) -> i64 {
        let plugin_id: i64 = conn
            .query_row("SELECT id FROM plugins WHERE slug = 'skills'", [], |r| {
                r.get(0)
            })
            .unwrap();
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id) VALUES (?1, 'skill-builder', ?2)",
            rusqlite::params![name, plugin_id],
        )
        .unwrap();
        conn.last_insert_rowid()
    }

    #[test]
    fn test_documents_crud() {
        let conn = db::create_test_db_for_tests();

        let skill_id = insert_test_skill(&conn, "test-skill");

        // Insert document scoped to all
        let doc_id =
            db_insert_document(&conn, "My Doc", "file", None, "/tmp/my-doc.md", "all").unwrap();
        assert!(doc_id > 0);

        // List — should include it
        let docs = db_list_documents(&conn).unwrap();
        assert_eq!(docs.len(), 1);
        assert_eq!(docs[0].name, "My Doc");
        assert_eq!(docs[0].scope, "all");
        assert!(docs[0].skill_ids.is_empty());

        // Update to skill-scoped
        db_update_document_scope(&conn, doc_id, "skill", &[skill_id]).unwrap();
        let doc = db_get_document(&conn, doc_id).unwrap().unwrap();
        assert_eq!(doc.scope, "skill");
        assert_eq!(doc.skill_ids, vec![skill_id]);

        // Delete
        db_delete_document(&conn, doc_id).unwrap();
        assert!(db_get_document(&conn, doc_id).unwrap().is_none());
    }

    #[test]
    fn test_documents_for_skill_all_scope() {
        let conn = db::create_test_db_for_tests();
        let skill_id = insert_test_skill(&conn, "skill-a");

        // Write a temp file with known content
        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("doc.md");
        std::fs::write(&file_path, "Hello document").unwrap();

        db_insert_document(
            &conn,
            "Doc A",
            "file",
            None,
            file_path.to_str().unwrap(),
            "all",
        )
        .unwrap();

        let contents = db_documents_for_skill(&conn, skill_id).unwrap();
        assert_eq!(contents.len(), 1);
        assert_eq!(contents[0].content, "Hello document");
        assert_eq!(contents[0].file_path, file_path.to_str().unwrap());
    }

    #[test]
    fn test_documents_for_skill_specific_scope_excluded() {
        let conn = db::create_test_db_for_tests();
        let skill_b = insert_test_skill(&conn, "skill-b");
        let skill_c = insert_test_skill(&conn, "skill-c");

        let dir = tempfile::tempdir().unwrap();
        let file_path = dir.path().join("doc.md");
        std::fs::write(&file_path, "Scoped content").unwrap();

        let doc_id = db_insert_document(
            &conn,
            "Scoped Doc",
            "file",
            None,
            file_path.to_str().unwrap(),
            "skill",
        )
        .unwrap();
        db_set_document_skills(&conn, doc_id, &[skill_b]).unwrap();

        // skill_b sees the doc
        let contents_b = db_documents_for_skill(&conn, skill_b).unwrap();
        assert_eq!(contents_b.len(), 1);

        // skill_c does not
        let contents_c = db_documents_for_skill(&conn, skill_c).unwrap();
        assert!(contents_c.is_empty());
    }
}
