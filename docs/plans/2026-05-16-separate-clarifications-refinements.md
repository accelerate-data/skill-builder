# Separate Clarifications and Refinements Tables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate clarifications (step 0 output) and refinements (step 1 output) into independent database tables so step 1 can be re-run without re-running step 0, and step 1 reset stays on step 1.

**Architecture:** Add a new `refinements` table family (parent + sections + questions + choices + notes) owned by step 1. Step 0 writes only to `clarifications`. Step 1 writes refinements to the new table and appends any new top-level questions to `clarifications` (append-only, never deletes existing clarifications). The frontend loads both tables and merges them for display.

**Tech Stack:** Rust (rusqlite, Tauri, Specta codegen), TypeScript (React, Zustand), SQLite migrations

---

### Task 1: DB Migration 57 — Create refinements table family

**Files:**
- Modify: `app/src-tauri/src/db/migrations.rs:2892-2903`

Add migration 57 that creates the `refinements` table family. This mirrors the clarifications schema but with its own parent table:

```rust
pub(super) fn run_refinements_tables_migration(
    conn: &Connection,
) -> Result<(), rusqlite::Error> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS refinements (
            skill_id                  INTEGER PRIMARY KEY REFERENCES skills(id) ON DELETE CASCADE,
            version                   TEXT NOT NULL,
            refinement_count          INTEGER NOT NULL DEFAULT 0,
            must_answer_count         INTEGER NOT NULL DEFAULT 0,
            question_count            INTEGER NOT NULL DEFAULT 0,
            section_count             INTEGER NOT NULL DEFAULT 0,
            title                     TEXT NOT NULL,
            scope_recommendation      INTEGER,
            scope_reason              TEXT,
            scope_next_action         TEXT,
            error_code                TEXT,
            error_message             TEXT,
            warning_code              TEXT,
            warning_message           TEXT,
            eval_verdict              TEXT,
            eval_reasoning             TEXT,
            eval_at                   INTEGER,
            eval_answered_count       INTEGER,
            eval_empty_count          INTEGER,
            eval_vague_count          INTEGER,
            eval_contradictory_count  INTEGER,
            created_at                INTEGER NOT NULL,
            updated_at                INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS refinement_sections (
            skill_id    INTEGER NOT NULL REFERENCES refinements(skill_id) ON DELETE CASCADE,
            section_id  INTEGER NOT NULL,
            ordinal     INTEGER NOT NULL,
            title       TEXT NOT NULL,
            description TEXT,
            PRIMARY KEY (skill_id, section_id)
        );

        CREATE TABLE IF NOT EXISTS refinement_questions (
            skill_id              INTEGER NOT NULL REFERENCES refinements(skill_id) ON DELETE CASCADE,
            question_id           TEXT NOT NULL,
            section_id            INTEGER NOT NULL,
            ordinal               INTEGER NOT NULL,
            title                 TEXT NOT NULL,
            text                  TEXT NOT NULL,
            must_answer           INTEGER NOT NULL DEFAULT 0,
            answer_choice         TEXT,
            answer_text           TEXT,
            recommendation        TEXT,
            answer_verdict        TEXT,
            answer_verdict_reason TEXT,
            PRIMARY KEY (skill_id, question_id)
        );

        CREATE TABLE IF NOT EXISTS refinement_choices (
            skill_id    INTEGER NOT NULL REFERENCES refinements(skill_id) ON DELETE CASCADE,
            question_id TEXT NOT NULL,
            choice_id   TEXT NOT NULL,
            ordinal     INTEGER NOT NULL,
            text        TEXT NOT NULL,
            is_other    INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (skill_id, question_id, choice_id)
        );

        CREATE TABLE IF NOT EXISTS refinement_notes (
            note_id  INTEGER PRIMARY KEY AUTOINCREMENT,
            skill_id INTEGER NOT NULL REFERENCES refinements(skill_id) ON DELETE CASCADE,
            ordinal  INTEGER NOT NULL,
            type     TEXT NOT NULL,
            title    TEXT NOT NULL,
            body     TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_refinement_questions_section
            ON refinement_questions(skill_id, section_id);
        CREATE INDEX IF NOT EXISTS idx_refinement_choices_question
            ON refinement_choices(skill_id, question_id);
        "#,
    )?;
    log::info!("migration 57: created refinements tables");
    Ok(())
}
```

Key differences from clarifications:
- **NO `parent_question_id` column** — refinements are flat questions, no self-referential tree
- Separate table names: `refinements`, `refinement_sections`, `refinement_questions`, `refinement_choices`, `refinement_notes`
- Same column types and FK pattern as clarifications

Also update the migration dispatcher in `migrations.rs` to call this new function at migration 57.

- [x] **Step 1: Add the migration function and wire it into the dispatcher**

Run: `cd app/src-tauri && cargo build`
Expected: Compiles without errors

- [ ] **Step 2: Commit**

```bash
git add app/src-tauri/src/db/migrations.rs
git commit -m "feat(db): add migration 57 for refinements table family"
```

---

### Task 2: DB CRUD — Add refinements read/write/delete functions

**Files:**
- Modify: `app/src-tauri/src/db/workflow_artifacts.rs`

Add the refinements CRUD functions parallel to the existing clarifications ones. Follow the same patterns:

**New structs:**

```rust
/// Full refinements record: parent row plus all normalized children.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefinementsRecord {
    pub skill_id: String,
    pub version: String,
    pub refinement_count: i64,
    pub must_answer_count: i64,
    pub question_count: i64,
    pub section_count: i64,
    pub title: String,
    pub scope_recommendation: Option<bool>,
    pub scope_reason: Option<String>,
    pub scope_next_action: Option<String>,
    pub error_code: Option<String>,
    pub error_message: Option<String>,
    pub warning_code: Option<String>,
    pub warning_message: Option<String>,
    pub eval_verdict: Option<String>,
    pub eval_reasoning: Option<String>,
    pub eval_at: Option<i64>,
    pub eval_answered_count: Option<i64>,
    pub eval_empty_count: Option<i64>,
    pub eval_vague_count: Option<i64>,
    pub eval_contradictory_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub sections: Vec<RefinementSection>,
    pub questions: Vec<RefinementQuestion>,
    pub notes: Vec<RefinementNote>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefinementSection {
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    pub description: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefinementQuestion {
    pub question_id: String,
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    pub answer_choice: Option<String>,
    pub answer_text: Option<String>,
    pub recommendation: Option<String>,
    pub answer_verdict: Option<String>,
    pub answer_verdict_reason: Option<String>,
    pub choices: Vec<RefinementChoice>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefinementChoice {
    pub choice_id: String,
    pub ordinal: i64,
    pub text: String,
    pub is_other: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RefinementNote {
    pub note_id: Option<i64>,
    pub ordinal: i64,
    pub note_type: String,
    pub title: String,
    pub body: String,
}
```

**New functions (follow existing clarifications patterns exactly):**

- `upsert_refinements(tx, record)` — full delete-and-replace like `upsert_clarifications`
- `read_refinements(conn, skill_identifier)` — reads parent + children, returns `Option<RefinementsRecord>`
- `delete_refinements(conn, skill_identifier)` — deletes all refinements rows for a skill
- `update_refinement_question_answer(conn, skill_identifier, question_id, answer_choice, answer_text)` — mirrors `update_question_answer`
- `update_refinement_question_verdicts(conn, skill_identifier, updates)` — mirrors `update_question_verdicts`

- [x] **Step 1: Add structs and CRUD functions to `workflow_artifacts.rs`**

Use the same patterns as the clarifications functions. The key difference: no recursive tree assembly (no `parent_question_id`), so `read_refinements` is simpler — just read questions flat and attach choices.

- [x] **Step 2: Add tests for refinements CRUD**

```rust
#[test]
fn roundtrip_refinements_insert_and_read() {
    let mut conn = create_test_db_for_tests();
    let skill_id = seed_skill(&conn, "skill-refine-a");
    let identifier = skill_identifier(skill_id);

    let record = RefinementsRecord {
        skill_id: identifier.clone(),
        version: "1".to_string(),
        refinement_count: 1,
        must_answer_count: 1,
        question_count: 2,
        section_count: 1,
        title: "Refinements".to_string(),
        scope_recommendation: None,
        scope_reason: None,
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
        sections: vec![RefinementSection {
            section_id: 1,
            ordinal: 0,
            title: "Scope".to_string(),
            description: None,
        }],
        questions: vec![
            RefinementQuestion {
                question_id: "rq1".to_string(),
                section_id: 1,
                ordinal: 0,
                title: "Refinement Q1".to_string(),
                text: "What about X?".to_string(),
                must_answer: true,
                answer_choice: None,
                answer_text: None,
                recommendation: None,
                answer_verdict: None,
                answer_verdict_reason: None,
                choices: vec![RefinementChoice {
                    choice_id: "a".to_string(),
                    ordinal: 0,
                    text: "Yes".to_string(),
                    is_other: false,
                }],
            },
        ],
        notes: vec![],
    };

    let tx = conn.transaction().unwrap();
    upsert_refinements(&tx, &record).unwrap();
    tx.commit().unwrap();

    let read_back = read_refinements(&conn, &identifier).unwrap().unwrap();
    assert_eq!(read_back.skill_id, identifier);
    assert_eq!(read_back.questions.len(), 1);
    assert_eq!(read_back.questions[0].choices.len(), 1);
}

#[test]
fn delete_refinements_cascades_to_children() {
    let mut conn = create_test_db_for_tests();
    let skill_id = seed_skill(&conn, "skill-refine-b");
    let identifier = skill_identifier(skill_id);

    let record = RefinementsRecord {
        skill_id: identifier.clone(),
        version: "1".to_string(),
        refinement_count: 0,
        must_answer_count: 0,
        question_count: 1,
        section_count: 1,
        title: "Test".to_string(),
        scope_recommendation: None,
        scope_reason: None,
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
        sections: vec![RefinementSection {
            section_id: 1,
            ordinal: 0,
            title: "S".to_string(),
            description: None,
        }],
        questions: vec![RefinementQuestion {
            question_id: "rq1".to_string(),
            section_id: 1,
            ordinal: 0,
            title: "Q".to_string(),
            text: "T".to_string(),
            must_answer: false,
            answer_choice: None,
            answer_text: None,
            recommendation: None,
            answer_verdict: None,
            answer_verdict_reason: None,
            choices: vec![],
        }],
        notes: vec![],
    };

    let tx = conn.transaction().unwrap();
    upsert_refinements(&tx, &record).unwrap();
    tx.commit().unwrap();

    delete_refinements(&conn, &identifier).unwrap();
    assert!(read_refinements(&conn, &identifier).unwrap().is_none());
}
```

- [ ] **Step 3: Run tests**

Run: `cd app/src-tauri && cargo test workflow_artifacts`
Expected: All tests pass including the new refinements tests

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/db/workflow_artifacts.rs
git commit -m "feat(db): add refinements CRUD (upsert, read, delete, update)"
```

---

### Task 3: Contracts — Remove recursive refinements, add RefinementsDto

**Files:**
- Modify: `app/src-tauri/src/contracts/clarifications.rs` — remove `refinements: Vec<Question>` from `Question`
- Modify: `app/src-tauri/src/contracts/workflow_artifacts.rs` — remove `refinements` from `ClarificationQuestionDto`, add `RefinementsDto` + child DTOs + conversions

**Step 3a: Remove recursive `refinements` from `Question` in `contracts/clarifications.rs`**

Change the `Question` struct from:
```rust
pub struct Question {
    pub id: String,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consolidated_from: Option<Vec<String>>,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
    #[serde(default)]
    pub refinements: Vec<Question>,  // REMOVE THIS
}
```

To:
```rust
pub struct Question {
    pub id: String,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub consolidated_from: Option<Vec<String>>,
    #[serde(default)]
    pub choices: Vec<Choice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
}
```

Update all tests in this file that construct `Question` with `refinements: vec![]` — remove that field from all test constructors.

**Step 3b: Remove `refinements` from `ClarificationQuestionDto` and add `RefinementsDto` in `contracts/workflow_artifacts.rs`**

Remove `refinements: Vec<ClarificationQuestionDto>` from `ClarificationQuestionDto`.

Add new DTO types:

```rust
/// Full refinements artifact for a skill.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct RefinementsDto {
    pub skill_id: String,
    pub version: String,
    pub refinement_count: i64,
    pub must_answer_count: i64,
    pub question_count: i64,
    pub section_count: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_recommendation: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scope_next_action: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_code: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning_message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_answered_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_empty_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_vague_count: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub eval_contradictory_count: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub sections: Vec<RefinementSectionDto>,
    pub questions: Vec<RefinementQuestionDto>,
    pub notes: Vec<RefinementNoteDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct RefinementSectionDto {
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct RefinementQuestionDto {
    pub question_id: String,
    pub section_id: i64,
    pub ordinal: i64,
    pub title: String,
    pub text: String,
    pub must_answer: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_choice: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_text: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub recommendation: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub answer_verdict_reason: Option<String>,
    pub choices: Vec<RefinementChoiceDto>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct RefinementChoiceDto {
    pub choice_id: String,
    pub ordinal: i64,
    pub text: String,
    pub is_other: bool,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, specta::Type, schemars::JsonSchema)]
pub struct RefinementNoteDto {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note_id: Option<i64>,
    pub ordinal: i64,
    pub note_type: String,
    pub title: String,
    pub body: String,
}
```

Add `From` impls from DB row types to DTO types (mirror the clarifications pattern).

Update the `From<db_artifacts::ClarificationQuestion> for ClarificationQuestionDto` impl to remove the `.refinements` mapping.

- [x] **Step 1: Remove `refinements` field from `Question` in clarifications.rs**

Remove the field and update all test constructors.

- [x] **Step 2: Remove `refinements` from `ClarificationQuestionDto`, add `RefinementsDto` + child DTOs + From impls**

- [x] **Step 3: Update tests in workflow_artifacts.rs contracts**

Remove `refinements: vec![]` from `ClarificationQuestionDto` test constructors. Add a basic `RefinementsDto` round-trip test.

- [ ] **Step 4: Run tests**

Run: `cd app/src-tauri && cargo test contracts`
Expected: All contract tests pass

- [ ] **Step 5: Commit**

```bash
git add app/src-tauri/src/contracts/clarifications.rs app/src-tauri/src/contracts/workflow_artifacts.rs
git commit -m "feat(contracts): remove recursive refinements from Question, add RefinementsDto"
```

---

### Task 4: Tauri Commands — Add refinements commands, modify clarifications

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/clarifications.rs` — add refinements commands
- Modify: `app/src-tauri/src/lib.rs` — register new commands

Add new Tauri commands for refinements, mirroring the existing clarifications commands:

```rust
#[tauri::command]
#[specta::specta]
pub fn get_refinements(
    state: tauri::State<'_, crate::db::Db>,
    skill_id: String,
) -> Result<Option<RefinementsDto>, String> {
    let conn = state.0.lock().map_err(|e| format!("Failed to lock DB: {}", e))?;
    match db_artifacts::read_refinements(&conn, &skill_id) {
        Ok(Some(record)) => Ok(Some(RefinementsDto::from(record))),
        Ok(None) => Ok(None),
        Err(e) => Err(format!("Failed to read refinements: {}", e)),
    }
}

#[tauri::command]
#[specta::specta]
pub fn update_refinement_answer(
    state: tauri::State<'_, crate::db::Db>,
    skill_id: String,
    question_id: String,
    answer_choice: Option<String>,
    answer_text: Option<String>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| format!("Failed to lock DB: {}", e))?;
    db_artifacts::update_refinement_question_answer(
        &conn,
        &skill_id,
        &question_id,
        answer_choice.as_deref(),
        answer_text.as_deref(),
    )
    .map_err(|e| format!("Failed to update refinement answer: {}", e))
}
```

Register in `lib.rs`:
```rust
commands::workflow::clarifications::get_refinements,
commands::workflow::clarifications::update_refinement_answer,
```

- [x] **Step 1: Add `get_refinements` and `update_refinement_answer` commands**

Add to `app/src-tauri/src/commands/workflow/clarifications.rs`.

- [x] **Step 2: Register commands in `lib.rs`**

- [ ] **Step 3: Build**

Run: `cd app/src-tauri && cargo build`
Expected: Compiles

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/commands/workflow/clarifications.rs app/src-tauri/src/lib.rs
git commit -m "feat(commands): add get_refinements and update_refinement_answer Tauri commands"
```

---

### Task 5: Output Format — Step 1 writes refinements + appends clarifications

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/output_format.rs`
- Modify: `app/src-tauri/src/contracts/workflow_outputs.rs` — add `refinements_json` to `DetailedResearchOutput`

**Step 5a: Update `DetailedResearchOutput` contract**

Add `refinements_json: ClarificationsFile` field to `DetailedResearchOutput`:

```rust
pub struct DetailedResearchOutput {
    pub status: String,
    pub refinement_count: i64,
    pub section_count: i64,
    pub clarifications_json: ClarificationsFile,
    pub refinements_json: ClarificationsFile,  // NEW
}
```

**Step 5b: Update step 1 materialization in `output_format.rs`**

Change the step 1 branch from calling `persist_clarifications` (which does full delete-and-replace) to:

1. Parse `clarifications_json` from the agent output — extract only the **new top-level questions** that don't already exist in the DB
2. Append those new questions to the existing `clarifications` table (no delete)
3. Parse `refinements_json` from the agent output — write to the `refinements` table via `upsert_refinements` (full replace)

The logic:

```rust
1 => {
    let parsed = serde_json::from_value::<DetailedResearchOutput>(workflow_result_payload.clone())
        .map_err(|e| format!("invalid detailed research output: {}", e))?;

    if parsed.status != "detailed_research_complete" {
        return Err("...".to_string());
    }

    let conn = db.0.lock().map_err(|e| format!("..."))?;

    // 1. Read existing clarifications to know which question_ids already exist
    let existing = db_artifacts::read_clarifications(&conn, &canonical_id)?;
    let existing_qids: HashSet<String> = existing
        .iter()
        .flat_map(|c| c.questions.iter().map(|q| q.question_id.clone()))
        .collect();

    // 2. Extract new top-level questions from clarifications_json
    let new_questions: Vec<_> = parsed.clarifications_json.sections
        .iter()
        .flat_map(|s| &s.questions)
        .filter(|q| !existing_qids.contains(&q.id))
        .cloned()
        .collect();

    // 3. If there are new questions, append them to clarifications
    if !new_questions.is_empty() {
        // Build a minimal ClarificationsRecord with only the new questions
        // grouped by section, then upsert. Since upsert_clarifications does
        // delete-and-replace, we need to merge with existing data.
        // Instead, use a targeted insert approach: insert new questions
        // directly into clarification_questions + clarification_choices.
        append_new_clarification_questions(&conn, &canonical_id, &new_questions)?;
    }

    // 4. Write refinements (full replace)
    let refinements_record = agent_json_to_refinements_record(
        &canonical_id,
        parsed.refinement_count,
        parsed.refinements_json,
        now_ms(),
    );
    let tx = conn.transaction().map_err(|e| format!("..."))?;
    db_artifacts::upsert_refinements(&tx, &refinements_record)
        .map_err(|e| format!("..."))?;
    tx.commit().map_err(|e| format!("..."))?;

    Ok(())
}
```

Add a helper function `append_new_clarification_questions` that inserts new questions and their choices into the existing `clarification_questions` and `clarification_choices` tables without touching existing rows.

Also add `agent_json_to_refinements_record` — mirrors `agent_json_to_clarifications_record` but produces a `RefinementsRecord`.

- [x] **Step 1: Add `refinements_json` field to `DetailedResearchOutput` in `workflow_outputs.rs`**

Update the test `test_detailed_research_output_round_trip` to include `refinements_json`.

- [x] **Step 2: Add `agent_json_to_refinements_record` helper to `output_format.rs`**

Mirror `agent_json_to_clarifications_record` but produces `RefinementsRecord`.

- [x] **Step 3: Add `append_new_clarification_questions` helper to `output_format.rs`**

This inserts new questions + choices into the clarifications tables without deleting existing data.

- [x] **Step 4: Rewrite step 1 branch in `materialize_workflow_step_output_value`**

Implement the logic described above.

- [ ] **Step 5: Run tests**

Run: `cd app/src-tauri && cargo test output_format`
Expected: Tests pass

- [ ] **Step 6: Commit**

```bash
git add app/src-tauri/src/contracts/workflow_outputs.rs app/src-tauri/src/commands/workflow/output_format.rs
git commit -m "feat(output-format): step 1 writes refinements table, appends new clarifications"
```

---

### Task 6: Reset Logic — Step 1 reset clears only refinements

**Files:**
- Modify: `app/src-tauri/src/commands/workflow/evaluation.rs` — `clear_artifacts_for_step_reset`

Change the `clear_artifacts_for_step_reset` function:

```rust
match from_step_id {
    0 => {
        // Step 0 reset: clear everything (clarifications + decisions + refinements)
        crate::db::workflow_artifacts::delete_clarifications(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
        crate::db::workflow_artifacts::delete_decisions(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
        crate::db::workflow_artifacts::delete_refinements(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
    }
    1 => {
        // Step 1 reset: clear only refinements, leave clarifications intact
        crate::db::workflow_artifacts::delete_refinements(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
        // Decisions may also be stale after step 1 re-run
        crate::db::workflow_artifacts::delete_decisions(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
    }
    2 => {
        crate::db::workflow_artifacts::delete_decisions(conn, &skill_id_str)
            .map_err(|e| e.to_string())?;
    }
    _ => {}
}
```

Also update `navigate_back_to_step_impl` if it has similar step 1 → step 0 mapping logic.

- [x] **Step 1: Update `clear_artifacts_for_step_reset` to separate step 0 and step 1 cases**

- [x] **Step 2: Check `navigate_back_to_step_impl` for similar logic and update if needed**

- [ ] **Step 3: Run tests**

Run: `cd app/src-tauri && cargo test evaluation`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add app/src-tauri/src/commands/workflow/evaluation.rs
git commit -m "feat(reset): step 1 reset clears only refinements, not clarifications"
```

---

### Task 7: Frontend Contracts — Regenerate TypeScript types

**Files:**
- Regenerate: `app/src/generated/contracts.ts`
- Modify: `app/src/lib/clarifications-types.ts`

- [x] **Step 1: Regenerate contracts**

Run: `cd app/src-tauri && cargo run --bin codegen`

This will regenerate `app/src/generated/contracts.ts` with the updated types (no `refinements` on `Question`, new `RefinementsDto` type).

- [x] **Step 2: Update `clarifications-types.ts`**

Remove recursive `refinements` handling from:
- `getSectionCounts` — remove `for (const r of q.refinements ?? []) countQuestion(r)`
- `normalizeQuestion` — remove `.refinements` mapping
- `dtoToQuestion` — remove `refinements` mapping

Add a new helper for merging clarifications + refinements for display:

```typescript
export function mergeClarificationsAndRefinements(
  clarifications: ClarificationsFile | null,
  refinements: ClarificationsFile | null,
): ClarificationsFile | null {
  if (!clarifications && !refinements) return null;
  if (!clarifications) return refinements;
  if (!refinements) return clarifications;

  // Merge sections: take clarifications sections, append refinement questions
  // as a separate "Refinements" section at the end
  const mergedSections: Section[] = [
    ...clarifications.sections.map(s => ({ ...s })),
  ];

  if (refinements.sections.length > 0) {
    mergedSections.push({
      id: Date.now(), // unique id for the refinements section
      title: "Refinements",
      description: "Detailed follow-up questions from step 1",
      questions: refinements.sections.flatMap(s => s.questions),
    });
  }

  return {
    ...clarifications,
    sections: mergedSections,
    notes: [...(clarifications.notes ?? []), ...(refinements.notes ?? [])],
    metadata: {
      ...clarifications.metadata,
      refinement_count: refinements.metadata?.refinement_count ?? 0,
    },
  };
}
```

- [ ] **Step 3: Run frontend tests**

Run: `cd app && npm run test:unit`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add app/src/generated/contracts.ts app/src/lib/clarifications-types.ts
git commit -m "feat(frontend): regenerate contracts, remove recursive refinements, add merge helper"
```

---

### Task 8: Frontend — Change step 1 reset to stay on step 1

**Files:**
- Modify: `app/src/hooks/use-workflow-state-machine.ts:778-826`
- Modify: `app/src/pages/workflow.tsx:368-369`

**Step 8a: Remove step 1 → step 0 mapping in `use-workflow-state-machine.ts`**

Change:
```typescript
const performStepReset = async (stepId: number) => {
    const effectiveStepId = stepId === 1 ? 0 : stepId;
    // ...
```

To:
```typescript
const performStepReset = async (stepId: number) => {
    const effectiveStepId = stepId;  // No more mapping to step 0
    // ...
```

**Step 8b: Update reset button targets in `workflow.tsx`**

Change:
```tsx
onReset={!reviewMode && stepConfig?.clarificationsEditable && currentStep !== 0 ? () => setResetTarget(currentStep === 1 ? 0 : currentStep) : undefined}
onResetStep={!reviewMode ? () => performStepReset(currentStep === 1 ? 0 : currentStep) : undefined}
```

To:
```tsx
onReset={!reviewMode && stepConfig?.clarificationsEditable && currentStep !== 0 ? () => setResetTarget(currentStep) : undefined}
onResetStep={!reviewMode ? () => performStepReset(currentStep) : undefined}
```

- [x] **Step 1: Update `performStepReset` in `use-workflow-state-machine.ts`**

- [x] **Step 2: Update reset button handlers in `workflow.tsx`**

- [ ] **Step 3: Run frontend tests**

Run: `cd app && npm run test:unit`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add app/src/hooks/use-workflow-state-machine.ts app/src/pages/workflow.tsx
git commit -m "feat(frontend): step 1 reset stays on step 1 instead of jumping to step 0"
```

---

### Task 9: Frontend — Load refinements and merge with clarifications in editor

**Files:**
- Modify: `app/src/lib/queries/clarifications.ts` — add `useRefinements` query
- Modify: ClarificationsEditor component (find via grep for `ClarificationsEditor`) — load both clarifications and refinements, merge for display

- [x] **Step 1: Add `useRefinements` React Query hook**

Add to `app/src/lib/queries/clarifications.ts`, mirroring the existing `useClarifications` hook but calling `get_refinements` Tauri command.

- [x] **Step 2: Update ClarificationsEditor to load refinements**

Wherever the editor currently loads clarifications, also load refinements and merge them using `mergeClarificationsAndRefinements`.

- [ ] **Step 3: Run frontend tests**

Run: `cd app && npm run test:unit`
Expected: Tests pass

- [ ] **Step 4: Commit**

```bash
git add app/src/lib/queries/clarifications.ts app/src/components/  # adjust path as needed
git commit -m "feat(frontend): load refinements and merge with clarifications in editor"
```

---

### Task 10: Step Configs — Add refinements output file for step 1

**Files:**
- Modify: `app/src/lib/workflow-step-configs.ts`

Step 1 currently outputs `context/clarifications.json`. With the new model, step 1 should also produce a refinements file. Update:

```typescript
1: { type: "agent", outputFiles: ["context/clarifications.json", "context/refinements.json"], clarificationsEditable: true },
```

- [x] **Step 1: Update step 1 config**

- [ ] **Step 2: Commit**

```bash
git add app/src/lib/workflow-step-configs.ts
git commit -m "feat(config): add refinements.json to step 1 output files"
```

---

### Task 11: Agent Prompts — Update step 1 to produce separate outputs

**Files:**
- Find step 1 agent SKILL.md (search for step 1 prompt in `agent-sources/` or `commands/workflow/prompt.rs`)
- Modify: step 1 agent prompt to output `refinements_json` as a separate artifact

The step 1 agent currently outputs a single `clarifications_json` with recursive refinements. Update the prompt to:
- Output `clarifications_json` with only **new top-level questions** (append-only additions to step 0's work)
- Output `refinements_json` with the detailed follow-up questions (flat, no recursive refinements)

- [x] **Step 1: Find and update step 1 agent prompt**

- [ ] **Step 2: Run agent structural tests**

Run: `cd app && npm run test:agents:structural`
Expected: Tests pass

- [ ] **Step 3: Commit**

```bash
git add agent-sources/  # or wherever the prompt lives
git commit -m "feat(agent): update step 1 prompt to produce separate clarifications and refinements outputs"
```

---

### Task 12: Full test pass and verification

- [ ] **Step 1: Run all Rust tests**

Run: `cd app/src-tauri && cargo test`
Expected: All tests pass

- [ ] **Step 2: Run all frontend tests**

Run: `cd app && npm run test:unit`
Expected: All tests pass

- [ ] **Step 3: Run agent structural tests**

Run: `cd app && npm run test:agents:structural`
Expected: All tests pass

- [ ] **Step 4: Run codegen and verify contracts**

Run: `cd app && npm run codegen && cd src-tauri && cargo test contracts::`
Expected: Codegen succeeds, contract tests pass

- [ ] **Step 5: Manual verification in Tauri dev mode**

Run: `cd app && npm run dev`

Verify:
1. Run step 0 → clarifications appear in editor
2. Run step 1 → refinements appear as a separate section in editor
3. Reset step 1 → stays on step 1, clarifications remain, refinements cleared
4. Re-run step 1 → refinements regenerated, clarifications preserved
5. New top-level questions from step 1 appear in clarifications table
