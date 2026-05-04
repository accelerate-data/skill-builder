//! Typed CRUD for workflow artifact tables (VU-1157).
//!
//! Two artifact families share this module:
//!
//! - **Clarifications:** `clarifications` (1:1 per skill) with normalized
//!   children for sections, questions (self-referential for refinements),
//!   choices, and notes.
//! - **Decisions:** `decisions` (1:1 per skill) with normalized child items.
//!
//! All mutations use bound parameters. `upsert_*` functions accept a borrowed
//! transaction so callers can wrap several artifact writes in a single atomic
//! step-completion boundary. The `read_*` functions take a `Connection`
//! reference and return `Option<FullRecord>` (None when the parent row is
//! absent).
//!
//! Booleans are stored as INTEGER 0/1. Timestamps are unix-ms INTEGER. Enum
//! columns (`eval_verdict`, `answer_verdict`, `decision_items.status`,
//! `contradictory_inputs_state`) are TEXT and validated at the unpack
//! boundary in higher-level code, not at the column.

// Task 2 of VU-1157 wires `read_*`, `update_question_answer`, and
// `update_question_verdicts` to Tauri commands. The remaining items
// (`upsert_*`, `delete_*`) only have callers from the post-step persistence
// hooks landing in later migration tasks; allow them per-item until then so
// the rest of the module surfaces unused-warnings naturally.
use rusqlite::{Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

// ---------------------------------------------------------------------------
// Clarification structs
// ---------------------------------------------------------------------------

/// Full clarifications record: parent row plus all normalized children.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClarificationsRecord {
    pub skill_id: String,
    pub version: String,
    pub refinement_count: i64,
    pub must_answer_count: i64,
    pub question_count: i64,
    pub section_count: i64,
    pub title: String,
    /// Tri-state: `None` = unset, `Some(false)` = not recommended,
    /// `Some(true)` = recommended.
    pub scope_recommendation: Option<bool>,
    pub scope_reason: Option<String>,
    pub scope_next_action: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub warning_code: Option<String>,
    pub warning_message: Option<String>,
    /// Enum: `'sufficient' | 'insufficient'`. TEXT in DB, validated upstream.
    pub eval_verdict: Option<String>,
    pub eval_reasoning: Option<String>,
    pub eval_at: Option<i64>,
    pub eval_answered_count: Option<i64>,
    pub eval_empty_count: Option<i64>,
    pub eval_vague_count: Option<i64>,
    pub eval_contradictory_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Display order matches ordinal, ascending.
    pub sections: Vec<ClarificationSection>,
    /// Top-level questions (parent_question_id = NULL). Refinements are
    /// nested under each question's `refinements` field.
    pub questions: Vec<ClarificationQuestion>,
    pub notes: Vec<ClarificationNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClarificationSection {
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClarificationQuestion {
    pub question_id: String,
    pub section_id: i64,
    /// Set to `Some(parent_id)` for refinements; `None` for top-level
    /// questions. Read paths populate this when reconstructing the tree.
    pub parent_question_id: Option<String>,
    pub ordinal: i64,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    pub answer_choice: Option<String>,
    pub answer_text: Option<String>,
    pub recommendation: Option<String>,
    /// Enum: `'clear' | 'vague' | 'not_answered' | 'needs_refinement' |
    /// 'contradictory'`. TEXT in DB.
    pub answer_verdict: Option<String>,
    pub answer_verdict_reason: Option<String>,
    pub choices: Vec<ClarificationChoice>,
    /// Recursive refinements. Each refinement is a question with
    /// `parent_question_id == Some(this.question_id)` in the row store.
    pub refinements: Vec<ClarificationQuestion>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClarificationChoice {
    pub choice_id: String,
    pub ordinal: i64,
    pub text: String,
    pub is_other: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ClarificationNote {
    /// Set when read back from DB. Ignored on insert (autoincrement).
    pub note_id: Option<i64>,
    pub ordinal: i64,
    pub note_type: String,
    pub title: String,
    pub body: String,
}

// ---------------------------------------------------------------------------
// Decision structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecisionsRecord {
    pub skill_id: String,
    pub version: String,
    pub round: i64,
    pub decision_count: i64,
    pub conflicts_resolved: i64,
    /// Enum: `'inactive' | 'active' | 'revised'`. TEXT in DB.
    pub contradictory_inputs_state: Option<String>,
    pub scope_recommendation: Option<bool>,
    pub created_at: i64,
    pub updated_at: i64,
    pub items: Vec<DecisionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DecisionItem {
    pub decision_id: String,
    pub ordinal: i64,
    pub title: String,
    pub original_question: String,
    pub decision: String,
    pub implication: String,
    /// Enum: `'resolved' | 'conflict-resolved' | 'needs-review' | 'revised'`.
    pub status: String,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn opt_bool_to_int(v: Option<bool>) -> Option<i64> {
    v.map(|b| if b { 1 } else { 0 })
}

fn opt_int_to_bool(v: Option<i64>) -> Option<bool> {
    v.map(|n| n != 0)
}

// ---------------------------------------------------------------------------
// Clarifications CRUD
// ---------------------------------------------------------------------------

/// Atomically replace the clarifications record (and all its children) for a
/// skill. Caller owns the transaction; commit on success.
///
/// The children are deleted before re-insert (idempotent replace) to avoid
/// constraint conflicts when the agent emits a different question/section
/// shape between runs.
pub fn upsert_clarifications(
    tx: &Transaction<'_>,
    record: &ClarificationsRecord,
) -> Result<(), rusqlite::Error> {
    let skill_id = &record.skill_id;

    // Wipe existing children. ON DELETE CASCADE on the parent would do this
    // for us if we were deleting the parent, but we're upserting the parent
    // row. Manual child delete keeps the parent's `created_at` stable across
    // re-writes (we only re-insert children).
    tx.execute(
        "DELETE FROM clarification_choices WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    tx.execute(
        "DELETE FROM clarification_questions WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    tx.execute(
        "DELETE FROM clarification_sections WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    tx.execute(
        "DELETE FROM clarification_notes WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;

    // Parent row: INSERT OR REPLACE keeps the schema simple (PK is skill_id).
    tx.execute(
        "INSERT INTO clarifications (
            skill_id, version, refinement_count, must_answer_count, question_count,
            section_count, title, scope_recommendation, scope_reason, scope_next_action,
            error_code, error_message, warning_code, warning_message,
            eval_verdict, eval_reasoning, eval_at,
            eval_answered_count, eval_empty_count, eval_vague_count, eval_contradictory_count,
            created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)
        ON CONFLICT(skill_id) DO UPDATE SET
            version = excluded.version,
            refinement_count = excluded.refinement_count,
            must_answer_count = excluded.must_answer_count,
            question_count = excluded.question_count,
            section_count = excluded.section_count,
            title = excluded.title,
            scope_recommendation = excluded.scope_recommendation,
            scope_reason = excluded.scope_reason,
            scope_next_action = excluded.scope_next_action,
            error_code = excluded.error_code,
            error_message = excluded.error_message,
            warning_code = excluded.warning_code,
            warning_message = excluded.warning_message,
            eval_verdict = excluded.eval_verdict,
            eval_reasoning = excluded.eval_reasoning,
            eval_at = excluded.eval_at,
            eval_answered_count = excluded.eval_answered_count,
            eval_empty_count = excluded.eval_empty_count,
            eval_vague_count = excluded.eval_vague_count,
            eval_contradictory_count = excluded.eval_contradictory_count,
            updated_at = excluded.updated_at",
        rusqlite::params![
            skill_id,
            record.version,
            record.refinement_count,
            record.must_answer_count,
            record.question_count,
            record.section_count,
            record.title,
            opt_bool_to_int(record.scope_recommendation),
            record.scope_reason,
            record.scope_next_action,
            record.error_code,
            record.error_message,
            record.warning_code,
            record.warning_message,
            record.eval_verdict,
            record.eval_reasoning,
            record.eval_at,
            record.eval_answered_count,
            record.eval_empty_count,
            record.eval_vague_count,
            record.eval_contradictory_count,
            record.created_at,
            record.updated_at,
        ],
    )?;

    // Sections.
    for section in &record.sections {
        tx.execute(
            "INSERT INTO clarification_sections (skill_id, section_id, ordinal, title, description)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![
                skill_id,
                section.section_id,
                section.ordinal,
                section.title,
                section.description,
            ],
        )?;
    }

    // Questions: walk the tree, top-level first, refinements after.
    for question in &record.questions {
        insert_question_recursive(tx, skill_id, None, question)?;
    }

    // Notes: ordinal preserved, note_id auto-assigned.
    for note in &record.notes {
        tx.execute(
            "INSERT INTO clarification_notes (skill_id, ordinal, type, title, body)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            rusqlite::params![skill_id, note.ordinal, note.note_type, note.title, note.body],
        )?;
    }

    Ok(())
}

fn insert_question_recursive(
    tx: &Transaction<'_>,
    skill_id: &str,
    parent_question_id: Option<&str>,
    question: &ClarificationQuestion,
) -> Result<(), rusqlite::Error> {
    tx.execute(
        "INSERT INTO clarification_questions (
            skill_id, question_id, section_id, parent_question_id, ordinal,
            title, text, must_answer, answer_choice, answer_text, recommendation,
            answer_verdict, answer_verdict_reason
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        rusqlite::params![
            skill_id,
            question.question_id,
            question.section_id,
            parent_question_id,
            question.ordinal,
            question.title,
            question.text,
            i64::from(question.must_answer),
            question.answer_choice,
            question.answer_text,
            question.recommendation,
            question.answer_verdict,
            question.answer_verdict_reason,
        ],
    )?;

    for choice in &question.choices {
        tx.execute(
            "INSERT INTO clarification_choices (skill_id, question_id, choice_id, ordinal, text, is_other)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            rusqlite::params![
                skill_id,
                question.question_id,
                choice.choice_id,
                choice.ordinal,
                choice.text,
                i64::from(choice.is_other),
            ],
        )?;
    }

    for refinement in &question.refinements {
        insert_question_recursive(tx, skill_id, Some(&question.question_id), refinement)?;
    }

    Ok(())
}

/// Read the full clarifications record for a skill. Returns `None` when the
/// parent row does not exist.
///
/// The tree is reconstructed: top-level questions hold their refinements
/// nested in `refinements`. Choices are attached to whichever question owns
/// them, regardless of depth.
pub fn read_clarifications(
    conn: &Connection,
    skill_id: &str,
) -> Result<Option<ClarificationsRecord>, rusqlite::Error> {
    let parent: Option<ClarificationsRecord> = conn
        .query_row(
            "SELECT skill_id, version, refinement_count, must_answer_count, question_count,
                    section_count, title, scope_recommendation, scope_reason, scope_next_action,
                    error_code, error_message, warning_code, warning_message,
                    eval_verdict, eval_reasoning, eval_at,
                    eval_answered_count, eval_empty_count, eval_vague_count, eval_contradictory_count,
                    created_at, updated_at
             FROM clarifications WHERE skill_id = ?1",
            rusqlite::params![skill_id],
            |row| {
                Ok(ClarificationsRecord {
                    skill_id: row.get(0)?,
                    version: row.get(1)?,
                    refinement_count: row.get(2)?,
                    must_answer_count: row.get(3)?,
                    question_count: row.get(4)?,
                    section_count: row.get(5)?,
                    title: row.get(6)?,
                    scope_recommendation: opt_int_to_bool(row.get(7)?),
                    scope_reason: row.get(8)?,
                    scope_next_action: row.get(9)?,
                    error_code: row.get(10)?,
                    error_message: row.get(11)?,
                    warning_code: row.get(12)?,
                    warning_message: row.get(13)?,
                    eval_verdict: row.get(14)?,
                    eval_reasoning: row.get(15)?,
                    eval_at: row.get(16)?,
                    eval_answered_count: row.get(17)?,
                    eval_empty_count: row.get(18)?,
                    eval_vague_count: row.get(19)?,
                    eval_contradictory_count: row.get(20)?,
                    created_at: row.get(21)?,
                    updated_at: row.get(22)?,
                    sections: Vec::new(),
                    questions: Vec::new(),
                    notes: Vec::new(),
                })
            },
        )
        .optional()?;

    let mut record = match parent {
        Some(r) => r,
        None => return Ok(None),
    };

    // Sections.
    let mut stmt = conn.prepare(
        "SELECT section_id, ordinal, title, description
         FROM clarification_sections WHERE skill_id = ?1 ORDER BY ordinal, section_id",
    )?;
    let sections = stmt
        .query_map(rusqlite::params![skill_id], |row| {
            Ok(ClarificationSection {
                section_id: row.get(0)?,
                ordinal: row.get(1)?,
                title: row.get(2)?,
                description: row.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    record.sections = sections;

    // Choices, grouped by question_id for attachment below.
    let mut stmt = conn.prepare(
        "SELECT question_id, choice_id, ordinal, text, is_other
         FROM clarification_choices WHERE skill_id = ?1 ORDER BY question_id, ordinal, choice_id",
    )?;
    let mut choices_by_question: std::collections::HashMap<String, Vec<ClarificationChoice>> =
        std::collections::HashMap::new();
    let choice_rows = stmt.query_map(rusqlite::params![skill_id], |row| {
        let qid: String = row.get(0)?;
        let choice = ClarificationChoice {
            choice_id: row.get(1)?,
            ordinal: row.get(2)?,
            text: row.get(3)?,
            is_other: row.get::<_, i64>(4)? != 0,
        };
        Ok((qid, choice))
    })?;
    for row in choice_rows {
        let (qid, choice) = row?;
        choices_by_question.entry(qid).or_default().push(choice);
    }

    // Questions (flat row list). Build a lookup, then attach refinements via
    // parent_question_id. Top-level questions go on `record.questions`.
    let mut stmt = conn.prepare(
        "SELECT question_id, section_id, parent_question_id, ordinal, title, text,
                must_answer, answer_choice, answer_text, recommendation,
                answer_verdict, answer_verdict_reason
         FROM clarification_questions WHERE skill_id = ?1 ORDER BY ordinal, question_id",
    )?;
    struct FlatQuestion {
        parent: Option<String>,
        question: ClarificationQuestion,
    }
    let flat_rows = stmt
        .query_map(rusqlite::params![skill_id], |row| {
            let parent: Option<String> = row.get(2)?;
            let question = ClarificationQuestion {
                question_id: row.get(0)?,
                section_id: row.get(1)?,
                parent_question_id: parent.clone(),
                ordinal: row.get(3)?,
                title: row.get(4)?,
                text: row.get(5)?,
                must_answer: row.get::<_, i64>(6)? != 0,
                answer_choice: row.get(7)?,
                answer_text: row.get(8)?,
                recommendation: row.get(9)?,
                answer_verdict: row.get(10)?,
                answer_verdict_reason: row.get(11)?,
                choices: Vec::new(),
                refinements: Vec::new(),
            };
            Ok(FlatQuestion { parent, question })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // Two-pass tree assembly: build all nodes first (with choices attached),
    // then drain refinements into their parents in reverse order so children
    // are owned by parents before parents move into the result.
    use std::collections::HashMap;
    let mut node_map: HashMap<String, ClarificationQuestion> = HashMap::new();
    let mut order: Vec<(String, Option<String>)> = Vec::with_capacity(flat_rows.len());
    for FlatQuestion { parent, mut question } in flat_rows {
        if let Some(choices) = choices_by_question.remove(&question.question_id) {
            question.choices = choices;
        }
        order.push((question.question_id.clone(), parent));
        node_map.insert(question.question_id.clone(), question);
    }

    // Walk children-first so each parent absorbs its refinements. Iterate in
    // reverse so deeper nodes (which appear later by ordinal in well-formed
    // data) are pulled before their parents.
    for (qid, parent) in order.iter().rev() {
        if let Some(parent_id) = parent {
            if let Some(child) = node_map.remove(qid) {
                if let Some(parent_node) = node_map.get_mut(parent_id) {
                    parent_node.refinements.insert(0, child);
                } else {
                    // Orphaned refinement (parent missing). Re-insert under
                    // its own id so it isn't silently dropped; surfaces as a
                    // top-level node in the read-back.
                    node_map.insert(qid.clone(), child);
                }
            }
        }
    }

    // Top-level questions, in original ordinal order.
    for (qid, parent) in &order {
        if parent.is_none() {
            if let Some(node) = node_map.remove(qid) {
                record.questions.push(node);
            }
        }
    }
    // Any remaining nodes are orphans; preserve them at top level.
    for (qid, _) in order {
        if let Some(node) = node_map.remove(&qid) {
            record.questions.push(node);
        }
    }

    // Notes.
    let mut stmt = conn.prepare(
        "SELECT note_id, ordinal, type, title, body
         FROM clarification_notes WHERE skill_id = ?1 ORDER BY ordinal, note_id",
    )?;
    let notes = stmt
        .query_map(rusqlite::params![skill_id], |row| {
            Ok(ClarificationNote {
                note_id: Some(row.get(0)?),
                ordinal: row.get(1)?,
                note_type: row.get(2)?,
                title: row.get(3)?,
                body: row.get(4)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    record.notes = notes;

    Ok(Some(record))
}

/// Per-question verdict update. Used by the answer-evaluator gate hook to
/// record the LLM's per-question verdict + rationale without rewriting any
/// answer fields. Rows whose `question_id` does not exist are silently
/// skipped (no-op match), matching the partial-update semantics.
pub fn update_question_verdicts(
    conn: &mut Connection,
    skill_id: &str,
    updates: &[(String, Option<String>, Option<String>)],
) -> Result<(), rusqlite::Error> {
    if updates.is_empty() {
        return Ok(());
    }
    let tx = conn.transaction()?;
    for (question_id, verdict, reason) in updates {
        tx.execute(
            "UPDATE clarification_questions
             SET answer_verdict = ?3, answer_verdict_reason = ?4
             WHERE skill_id = ?1 AND question_id = ?2",
            rusqlite::params![skill_id, question_id, verdict, reason],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// Editor-side update: persist an answer for a single question. `None`
/// values explicitly clear the column.
pub fn update_question_answer(
    conn: &Connection,
    skill_id: &str,
    question_id: &str,
    answer_choice: Option<&str>,
    answer_text: Option<&str>,
) -> Result<(), rusqlite::Error> {
    conn.execute(
        "UPDATE clarification_questions
         SET answer_choice = ?3, answer_text = ?4
         WHERE skill_id = ?1 AND question_id = ?2",
        rusqlite::params![skill_id, question_id, answer_choice, answer_text],
    )?;
    Ok(())
}

/// Delete clarifications and all child rows for a skill. Idempotent.
pub fn delete_clarifications(
    conn: &Connection,
    skill_id: &str,
) -> Result<(), rusqlite::Error> {
    // Children are CASCADE-deleted by FK, but we don't depend on FK
    // enforcement being on (see db/mod.rs comment). Delete explicitly so the
    // call works regardless of pragma state.
    conn.execute(
        "DELETE FROM clarification_choices WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM clarification_questions WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM clarification_sections WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM clarification_notes WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM clarifications WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Decisions CRUD
// ---------------------------------------------------------------------------

/// Atomically replace the decisions record (and all its items) for a skill.
pub fn upsert_decisions(
    tx: &Transaction<'_>,
    record: &DecisionsRecord,
) -> Result<(), rusqlite::Error> {
    let skill_id = &record.skill_id;

    tx.execute(
        "DELETE FROM decision_items WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;

    tx.execute(
        "INSERT INTO decisions (
            skill_id, version, round, decision_count, conflicts_resolved,
            contradictory_inputs_state, scope_recommendation, created_at, updated_at
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(skill_id) DO UPDATE SET
            version = excluded.version,
            round = excluded.round,
            decision_count = excluded.decision_count,
            conflicts_resolved = excluded.conflicts_resolved,
            contradictory_inputs_state = excluded.contradictory_inputs_state,
            scope_recommendation = excluded.scope_recommendation,
            updated_at = excluded.updated_at",
        rusqlite::params![
            skill_id,
            record.version,
            record.round,
            record.decision_count,
            record.conflicts_resolved,
            record.contradictory_inputs_state,
            opt_bool_to_int(record.scope_recommendation),
            record.created_at,
            record.updated_at,
        ],
    )?;

    for item in &record.items {
        tx.execute(
            "INSERT INTO decision_items (
                skill_id, decision_id, ordinal, title, original_question,
                decision, implication, status
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            rusqlite::params![
                skill_id,
                item.decision_id,
                item.ordinal,
                item.title,
                item.original_question,
                item.decision,
                item.implication,
                item.status,
            ],
        )?;
    }

    Ok(())
}

/// Read the full decisions record for a skill.
pub fn read_decisions(
    conn: &Connection,
    skill_id: &str,
) -> Result<Option<DecisionsRecord>, rusqlite::Error> {
    let parent: Option<DecisionsRecord> = conn
        .query_row(
            "SELECT skill_id, version, round, decision_count, conflicts_resolved,
                    contradictory_inputs_state, scope_recommendation, created_at, updated_at
             FROM decisions WHERE skill_id = ?1",
            rusqlite::params![skill_id],
            |row| {
                Ok(DecisionsRecord {
                    skill_id: row.get(0)?,
                    version: row.get(1)?,
                    round: row.get(2)?,
                    decision_count: row.get(3)?,
                    conflicts_resolved: row.get(4)?,
                    contradictory_inputs_state: row.get(5)?,
                    scope_recommendation: opt_int_to_bool(row.get(6)?),
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                    items: Vec::new(),
                })
            },
        )
        .optional()?;

    let mut record = match parent {
        Some(r) => r,
        None => return Ok(None),
    };

    let mut stmt = conn.prepare(
        "SELECT decision_id, ordinal, title, original_question, decision, implication, status
         FROM decision_items WHERE skill_id = ?1 ORDER BY ordinal, decision_id",
    )?;
    let items = stmt
        .query_map(rusqlite::params![skill_id], |row| {
            Ok(DecisionItem {
                decision_id: row.get(0)?,
                ordinal: row.get(1)?,
                title: row.get(2)?,
                original_question: row.get(3)?,
                decision: row.get(4)?,
                implication: row.get(5)?,
                status: row.get(6)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    record.items = items;

    Ok(Some(record))
}

/// Delete decisions and all child items for a skill. Idempotent.
pub fn delete_decisions(conn: &Connection, skill_id: &str) -> Result<(), rusqlite::Error> {
    conn.execute(
        "DELETE FROM decision_items WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    conn.execute(
        "DELETE FROM decisions WHERE skill_id = ?1",
        rusqlite::params![skill_id],
    )?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::create_test_db_for_tests;

    fn seed_skill(conn: &Connection, name: &str) {
        // Insert a skills row in the default 'skills' plugin so other code
        // paths that join through `skills` can resolve this skill_id. The
        // workflow-artifact tables themselves use `skill_id TEXT` with no FK
        // (see migration 44 comment), so the skill row is informational here.
        conn.execute(
            "INSERT INTO skills (name, skill_source, plugin_id)
             VALUES (?1, 'skill-builder', (SELECT id FROM plugins WHERE slug = 'skills'))",
            rusqlite::params![name],
        )
        .unwrap();
    }

    fn sample_record(skill_id: &str) -> ClarificationsRecord {
        ClarificationsRecord {
            skill_id: skill_id.to_string(),
            version: "1".to_string(),
            refinement_count: 0,
            must_answer_count: 2,
            question_count: 2,
            section_count: 1,
            title: "Initial Clarifications".to_string(),
            scope_recommendation: Some(true),
            scope_reason: Some("In scope".to_string()),
            scope_next_action: None,
            error_code: None,
            error_message: None,
            warning_code: None,
            warning_message: None,
            eval_verdict: None,
            eval_reasoning: None,
            eval_at: None,
            eval_answered_count: None,
            eval_empty_count: None,
            eval_vague_count: None,
            eval_contradictory_count: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            sections: vec![ClarificationSection {
                section_id: 1,
                ordinal: 0,
                title: "Scope".to_string(),
                description: Some("Section about scope".to_string()),
            }],
            questions: vec![
                ClarificationQuestion {
                    question_id: "q1".to_string(),
                    section_id: 1,
                    parent_question_id: None,
                    ordinal: 0,
                    title: "Question 1".to_string(),
                    text: "What is the scope?".to_string(),
                    must_answer: true,
                    answer_choice: Some("c1".to_string()),
                    answer_text: Some("custom answer".to_string()),
                    recommendation: None,
                    answer_verdict: None,
                    answer_verdict_reason: None,
                    choices: vec![
                        ClarificationChoice {
                            choice_id: "c1".to_string(),
                            ordinal: 0,
                            text: "Option A".to_string(),
                            is_other: false,
                        },
                        ClarificationChoice {
                            choice_id: "c2".to_string(),
                            ordinal: 1,
                            text: "Other".to_string(),
                            is_other: true,
                        },
                    ],
                    refinements: vec![],
                },
                ClarificationQuestion {
                    question_id: "q2".to_string(),
                    section_id: 1,
                    parent_question_id: None,
                    ordinal: 1,
                    title: "Question 2".to_string(),
                    text: "Anything else?".to_string(),
                    must_answer: true,
                    answer_choice: None,
                    answer_text: Some("yes".to_string()),
                    recommendation: None,
                    answer_verdict: None,
                    answer_verdict_reason: None,
                    choices: vec![],
                    refinements: vec![],
                },
            ],
            notes: vec![ClarificationNote {
                note_id: None,
                ordinal: 0,
                note_type: "context".to_string(),
                title: "Background".to_string(),
                body: "Some research context.".to_string(),
            }],
        }
    }

    #[test]
    fn roundtrip_clarifications_insert_and_read() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-a");

        let record = sample_record("skill-a");
        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();

        let read_back = read_clarifications(&conn, "skill-a").unwrap().unwrap();
        assert_eq!(read_back.skill_id, "skill-a");
        assert_eq!(read_back.version, "1");
        assert_eq!(read_back.scope_recommendation, Some(true));
        assert_eq!(read_back.sections.len(), 1);
        assert_eq!(read_back.sections[0].section_id, 1);
        assert_eq!(read_back.questions.len(), 2);
        assert_eq!(read_back.questions[0].choices.len(), 2);
        assert!(read_back.questions[0].choices[1].is_other);
        assert_eq!(read_back.questions[0].answer_choice.as_deref(), Some("c1"));
        assert_eq!(read_back.questions[1].answer_text.as_deref(), Some("yes"));
        assert_eq!(read_back.notes.len(), 1);
        assert_eq!(read_back.notes[0].note_type, "context");
        assert!(read_back.notes[0].note_id.is_some());
    }

    #[test]
    fn delete_clarifications_cascades_to_children() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-b");

        let record = sample_record("skill-b");
        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();

        delete_clarifications(&conn, "skill-b").unwrap();

        // All five tables must be empty for this skill_id.
        let parent_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarifications WHERE skill_id = ?1",
                rusqlite::params!["skill-b"],
                |row| row.get(0),
            )
            .unwrap();
        let section_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarification_sections WHERE skill_id = ?1",
                rusqlite::params!["skill-b"],
                |row| row.get(0),
            )
            .unwrap();
        let question_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarification_questions WHERE skill_id = ?1",
                rusqlite::params!["skill-b"],
                |row| row.get(0),
            )
            .unwrap();
        let choice_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarification_choices WHERE skill_id = ?1",
                rusqlite::params!["skill-b"],
                |row| row.get(0),
            )
            .unwrap();
        let note_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarification_notes WHERE skill_id = ?1",
                rusqlite::params!["skill-b"],
                |row| row.get(0),
            )
            .unwrap();

        assert_eq!(parent_count, 0);
        assert_eq!(section_count, 0);
        assert_eq!(question_count, 0);
        assert_eq!(choice_count, 0);
        assert_eq!(note_count, 0);

        assert!(read_clarifications(&conn, "skill-b").unwrap().is_none());
    }

    #[test]
    fn partial_verdict_update_preserves_answers() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-c");

        let record = sample_record("skill-c");
        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();

        // Update verdict on only q1; q2's answer + verdict must remain intact.
        update_question_verdicts(
            &mut conn,
            "skill-c",
            &[(
                "q1".to_string(),
                Some("clear".to_string()),
                Some("Answer is unambiguous.".to_string()),
            )],
        )
        .unwrap();

        let read_back = read_clarifications(&conn, "skill-c").unwrap().unwrap();
        let q1 = read_back
            .questions
            .iter()
            .find(|q| q.question_id == "q1")
            .unwrap();
        let q2 = read_back
            .questions
            .iter()
            .find(|q| q.question_id == "q2")
            .unwrap();

        assert_eq!(q1.answer_verdict.as_deref(), Some("clear"));
        assert_eq!(
            q1.answer_verdict_reason.as_deref(),
            Some("Answer is unambiguous.")
        );
        // Critical: original answer fields preserved.
        assert_eq!(q1.answer_choice.as_deref(), Some("c1"));
        assert_eq!(q1.answer_text.as_deref(), Some("custom answer"));

        // q2 untouched.
        assert!(q2.answer_verdict.is_none());
        assert!(q2.answer_verdict_reason.is_none());
        assert_eq!(q2.answer_text.as_deref(), Some("yes"));
    }

    #[test]
    fn recursive_refinement_insert_and_read() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-d");

        let mut record = sample_record("skill-d");
        // Add a refinement under q1.
        record.refinement_count = 1;
        record.questions[0].refinements.push(ClarificationQuestion {
            question_id: "q1.r1".to_string(),
            section_id: 1,
            parent_question_id: Some("q1".to_string()),
            ordinal: 0,
            title: "Refinement of q1".to_string(),
            text: "Can you clarify Option A?".to_string(),
            must_answer: true,
            answer_choice: None,
            answer_text: None,
            recommendation: None,
            answer_verdict: None,
            answer_verdict_reason: None,
            choices: vec![ClarificationChoice {
                choice_id: "rc1".to_string(),
                ordinal: 0,
                text: "Yes".to_string(),
                is_other: false,
            }],
            refinements: vec![],
        });

        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();

        // Verify both rows exist with correct parent_question_id linkage.
        let row_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM clarification_questions WHERE skill_id = ?1",
                rusqlite::params!["skill-d"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(row_count, 3); // q1, q2, q1.r1

        let parent_link: Option<String> = conn
            .query_row(
                "SELECT parent_question_id FROM clarification_questions
                 WHERE skill_id = ?1 AND question_id = ?2",
                rusqlite::params!["skill-d", "q1.r1"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(parent_link.as_deref(), Some("q1"));

        // q1's parent is NULL.
        let q1_parent: Option<String> = conn
            .query_row(
                "SELECT parent_question_id FROM clarification_questions
                 WHERE skill_id = ?1 AND question_id = ?2",
                rusqlite::params!["skill-d", "q1"],
                |row| row.get(0),
            )
            .unwrap();
        assert!(q1_parent.is_none());

        // Tree reconstruction places refinement under q1.
        let read_back = read_clarifications(&conn, "skill-d").unwrap().unwrap();
        let q1 = read_back
            .questions
            .iter()
            .find(|q| q.question_id == "q1")
            .unwrap();
        assert_eq!(q1.refinements.len(), 1);
        assert_eq!(q1.refinements[0].question_id, "q1.r1");
        assert_eq!(q1.refinements[0].choices.len(), 1);
        assert_eq!(q1.refinements[0].parent_question_id.as_deref(), Some("q1"));
    }

    #[test]
    fn decisions_roundtrip_and_delete() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-e");

        let record = DecisionsRecord {
            skill_id: "skill-e".to_string(),
            version: "1".to_string(),
            round: 0,
            decision_count: 2,
            conflicts_resolved: 1,
            contradictory_inputs_state: Some("inactive".to_string()),
            scope_recommendation: Some(false),
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            items: vec![
                DecisionItem {
                    decision_id: "d1".to_string(),
                    ordinal: 0,
                    title: "Decision 1".to_string(),
                    original_question: "Q?".to_string(),
                    decision: "Yes".to_string(),
                    implication: "Affects scope.".to_string(),
                    status: "resolved".to_string(),
                },
                DecisionItem {
                    decision_id: "d2".to_string(),
                    ordinal: 1,
                    title: "Decision 2".to_string(),
                    original_question: "Q2?".to_string(),
                    decision: "Maybe".to_string(),
                    implication: "Needs review.".to_string(),
                    status: "needs-review".to_string(),
                },
            ],
        };

        let tx = conn.transaction().unwrap();
        upsert_decisions(&tx, &record).unwrap();
        tx.commit().unwrap();

        let read_back = read_decisions(&conn, "skill-e").unwrap().unwrap();
        assert_eq!(read_back, record);

        delete_decisions(&conn, "skill-e").unwrap();
        assert!(read_decisions(&conn, "skill-e").unwrap().is_none());
        let item_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM decision_items WHERE skill_id = ?1",
                rusqlite::params!["skill-e"],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(item_count, 0);
    }

    #[test]
    fn update_question_answer_clears_and_sets_columns() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "skill-f");

        let record = sample_record("skill-f");
        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &record).unwrap();
        tx.commit().unwrap();

        // Replace q1's answer.
        update_question_answer(&conn, "skill-f", "q1", Some("c2"), Some("now other")).unwrap();
        let read_back = read_clarifications(&conn, "skill-f").unwrap().unwrap();
        let q1 = read_back
            .questions
            .iter()
            .find(|q| q.question_id == "q1")
            .unwrap();
        assert_eq!(q1.answer_choice.as_deref(), Some("c2"));
        assert_eq!(q1.answer_text.as_deref(), Some("now other"));

        // Clear it.
        update_question_answer(&conn, "skill-f", "q1", None, None).unwrap();
        let read_back = read_clarifications(&conn, "skill-f").unwrap().unwrap();
        let q1 = read_back
            .questions
            .iter()
            .find(|q| q.question_id == "q1")
            .unwrap();
        assert!(q1.answer_choice.is_none());
        assert!(q1.answer_text.is_none());
    }

    #[test]
    fn delete_skill_purges_artifact_rows() {
        let mut conn = create_test_db_for_tests();
        seed_skill(&conn, "purge-test-skill");

        // Write a clarifications row.
        let clar = sample_record("purge-test-skill");
        let tx = conn.transaction().unwrap();
        upsert_clarifications(&tx, &clar).unwrap();
        tx.commit().unwrap();

        // Write a decisions row.
        let decisions = DecisionsRecord {
            skill_id: "purge-test-skill".to_string(),
            version: "1".to_string(),
            round: 0,
            decision_count: 1,
            conflicts_resolved: 0,
            contradictory_inputs_state: None,
            scope_recommendation: None,
            created_at: 1_700_000_000_000,
            updated_at: 1_700_000_000_000,
            items: vec![DecisionItem {
                decision_id: "d1".to_string(),
                ordinal: 0,
                title: "D1".to_string(),
                original_question: "Q?".to_string(),
                decision: "Yes".to_string(),
                implication: "None".to_string(),
                status: "resolved".to_string(),
            }],
        };
        let tx = conn.transaction().unwrap();
        upsert_decisions(&tx, &decisions).unwrap();
        tx.commit().unwrap();

        // Confirm both rows exist.
        assert!(read_clarifications(&conn, "purge-test-skill").unwrap().is_some());
        assert!(read_decisions(&conn, "purge-test-skill").unwrap().is_some());

        // Delete via the skill-deletion DB hook.
        crate::commands::skill::delete_skill_db_records_inner(
            &conn,
            "purge-test-skill",
            crate::skill_paths::DEFAULT_PLUGIN_SLUG,
        )
        .unwrap();

        // Atomicity is guaranteed by the SAVEPOINT in delete_skill_db_records_inner:
        // if any downstream deletion fails, the ROLLBACK TO delete_skill restores both
        // artifact tables. The SAVEPOINT pattern mirrors create_skill_db_records_inner.

        // Both artifact families must be gone.
        assert!(
            read_clarifications(&conn, "purge-test-skill").unwrap().is_none(),
            "delete_skill must purge clarifications rows"
        );
        assert!(
            read_decisions(&conn, "purge-test-skill").unwrap().is_none(),
            "delete_skill must purge decisions rows"
        );
    }
}
