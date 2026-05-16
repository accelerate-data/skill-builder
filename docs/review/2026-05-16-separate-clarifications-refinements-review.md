# Adversarial Review: Separate Clarifications and Refinements Tables

**Plan:** [docs/plans/2026-05-16-separate-clarifications-refinements.md](../plans/2026-05-16-separate-clarifications-refinements.md)
**Linear Issue:** [VU-1193](https://linear.app/acceleratedata/issue/VU-1193)
**Date:** 2026-05-16
**Reviewers:** Skeptic, Minimalist (Claude CLI) — Architect timed out (empty output)
**Reviewer CLI:** `claude -p`

---

## Intent

Separate clarifications (step 0 output) and refinements (step 1 output) into independent database tables so step 1 can be re-run without re-running step 0, and step 1 reset stays on step 1 instead of jumping back to step 0.

---

## Verdict: REJECT

Two high-severity consensus findings block ship: `verify_step_output` for step 1 reads the wrong table, and refinement answers have no persistence path from the UI. A third high-severity finding (hardcoded `section_id = 0` in the append helper) means the append-only clarifications feature does not work at all.

---

## Findings

### 1. [HIGH] `verify_step_output` for step 1 checks `clarifications.refinement_count` instead of the `refinements` table

- **File:** `app/src-tauri/src/commands/workflow/evaluation.rs:760-764`
- **Lens:** Skeptic (prove-it-works) + Minimalist (outcome-oriented)
- **Details:** After the refactor, step 1 writes to the `refinements` table. The verification still reads `clarifications.refinement_count`, which is set by step 0's output and never updated by the new step 1 path. If step 0 had `refinement_count > 0`, step 1 appears complete before running. If step 0 had `refinement_count == 0`, step 1 never appears complete.
- **Recommendation:** Change to `read_refinements(&conn, &skill_id_str).map(|opt| opt.is_some()).unwrap_or(false)`. Add a test.

### 2. [HIGH] No `useUpdateRefinementAnswer` mutation hook — refinement answers cannot be saved from the UI

- **Files:** `app/src/hooks/use-workflow-autosave.ts:84`, `app/src/lib/queries/clarifications.ts`
- **Lens:** Skeptic (prove-it-works) + Minimalist (outcome-oriented)
- **Details:** `update_refinement_answer` Tauri command exists and is registered. `useRefinements` query hook exists. But no mutation hook calls `update_refinement_answer`. The autosave hook (`use-workflow-autosave.ts:84`) fires `update_clarification_answer` for all changed question IDs, which targets the `clarification_questions` table — refinement question IDs live in `refinement_questions`, so the UPDATE matches zero rows silently.
- **Recommendation:** Add `useUpdateRefinementAnswer` mutation in `queries/clarifications.ts`. Wire the autosave hook to route refinement question answers to the correct command (needs a way to distinguish refinement vs clarification question IDs in the merged display).

### 3. [HIGH] `append_new_clarification_questions` hardcodes `section_id = 0`

- **File:** `app/src-tauri/src/commands/workflow/output_format.rs:735`
- **Lens:** Skeptic (fix-root-causes)
- **Details:** New questions from step 1 are inserted with `section_id = 0` regardless of their actual section. Step 0 populates `clarification_sections` with IDs like 1, 2, etc. Section 0 never exists. Questions are orphaned — invisible in the editor. The function also never creates a new section row.
- **Recommendation:** Extract the `section_id` from the incoming question's source section, or create the section row if it doesn't exist. Read max ordinal in the target section and start new questions after it.

### 4. [MEDIUM] Step 1 branch is non-atomic — partial write on refinements failure

- **File:** `app/src-tauri/src/commands/workflow/output_format.rs:1013-1030`
- **Lens:** Skeptic (serialize-shared-state-mutations)
- **Details:** `append_new_clarification_questions` uses auto-commit per statement. Then a separate transaction wraps refinements upsert. If refinements fails, new clarification questions are already committed with no way to roll back.
- **Recommendation:** Wrap both operations in a single transaction.

### 5. [MEDIUM] `Date.now()` as synthetic section ID is non-deterministic

- **File:** `app/src/lib/clarifications-types.ts:238`
- **Lens:** Skeptic (prove-it-works)
- **Details:** Each call to `mergeClarificationsAndRefinements` produces a different integer ID for the "Refinements" section, breaking memoization and causing unnecessary re-renders.
- **Recommendation:** Use a stable sentinel value like `-1`.

### 6. [MEDIUM] `navigate_back_to_step_impl` does not call `clear_artifacts_for_step_reset`

- **File:** `app/src-tauri/src/commands/workflow/evaluation.rs:140-211`
- **Lens:** Skeptic (fix-root-causes)
- **Details:** Navigating back from step 2 to step 1 deletes output files but leaves refinements in the DB. If the agent errors before completing, stale refinements persist and are displayed.
- **Recommendation:** Call `clear_artifacts_for_step_reset` in the navigate-back path for step 1.

### 7. [MEDIUM] `repair_missing_research_section_closers` targets dead JSON pattern

- **File:** `app/src-tauri/src/commands/workflow/output_format.rs:217`
- **Lens:** Minimalist (subtract-before-you-add)
- **Details:** The repair searches for `"refinements":[]` inside question objects — a pattern that no longer exists after removing the `refinements` field from `Question`. Dead code.
- **Recommendation:** Delete the repair function or update it for the new format.

### 8. [MEDIUM] Plan pseudocode is stale relative to actual implementation

- **File:** Plan Tasks 5 and 7
- **Lens:** Minimalist (outcome-oriented)
- **Details:** Task 5 pseudocode shows 4 arguments to `agent_json_to_refinements_record` but the actual function takes 3. Task 7 types `mergeClarificationsAndRefinements` second arg as `ClarificationsFile` but actual code uses `RefinementsDto`.
- **Recommendation:** Update the plan to match implementation, or mark as post-hoc documentation.

### 9. [LOW] Migration number mismatch: plan says 57, implementation uses 58

- **File:** Plan Task 1 vs `migrations.rs:63`
- **Lens:** Skeptic (prove-it-works)
- **Details:** The plan consistently references "migration 57" but the dispatcher has `run_refinements_tables_migration` at slot 58. The function itself is correctly defined at line 2915.
- **Recommendation:** Update plan text to say "migration 58".

### 10. [LOW] `useRefinements` query key not registered in `queryKeys`

- **File:** `app/src/lib/queries/clarifications.ts:17`
- **Lens:** Skeptic (fix-root-causes)
- **Details:** Uses bare `["refinements", skillId]` instead of `queryKeys.refinements.bySkill(...)`. Makes cache invalidation impossible from mutations.
- **Recommendation:** Add `refinements` entry to `query-keys.ts` and use it.

### 11. [LOW] Stale doc comment on `ClarificationsDto`

- **File:** `app/src-tauri/src/contracts/workflow_artifacts.rs:23`
- **Lens:** Minimalist (subtract-before-you-add)
- **Details:** Comment mentions `refinements` nested inside `ClarificationQuestionDto.refinements` — field was removed.
- **Recommendation:** Update or delete the comment.

### 12. [LOW] Old `parent_question_id` rows in `clarification_questions` are silently orphaned

- **Lens:** Skeptic (fix-root-causes)
- **Details:** Existing child-question rows remain after migration. Frontend filters them out, but they're never deleted.
- **Recommendation:** Consider a one-time cleanup in the migration: `DELETE FROM clarification_questions WHERE parent_question_id IS NOT NULL`.

---

## What Went Well

- **CRUD symmetry:** The refinements CRUD functions in `workflow_artifacts.rs` closely mirror the clarifications pattern — consistent, readable, and well-structured.
- **Reset logic separation:** `clear_artifacts_for_step_reset` correctly distinguishes step 0 (clear all) from step 1 (clear refinements + decisions only). This is the core behavioral change and it's clean.
- **Contract layer cleanup:** Removing `refinements` from `Question` and `ClarificationQuestionDto` while adding separate `RefinementsDto` + child DTOs + `From` impls is a well-scoped boundary change.

---

## Lead Judgment

| # | Finding | Judgment | Rationale |
|---|---------|----------|-----------|
| 1 | `verify_step_output` checks wrong table | **ACCEPT** | Clear bug — step 1 verification reads stale data from the wrong table. Blocks ship. |
| 2 | No `useUpdateRefinementAnswer` hook | **ACCEPT** | Without this, users cannot save answers to refinement questions. Core functionality broken. |
| 3 | `append_new_clarification_questions` hardcodes `section_id = 0` | **ACCEPT** | New questions are orphaned in the DB. The append-only clarifications feature doesn't work. |
| 4 | Non-atomic step 1 branch | **ACCEPT** | Partial writes on failure leave the DB in an inconsistent state. Easy fix with a single transaction. |
| 5 | `Date.now()` as section ID | **ACCEPT** | Non-deterministic IDs in a merge function called on every render. Real React performance/correctness issue. |
| 6 | `navigate_back_to_step_impl` inconsistency | **ACCEPT** | Stale refinements after navigate-back is a real user-facing bug. |
| 7 | Dead `repair_missing_research_section_closers` | **ACCEPT** | Dead code that misleads future maintainers. Delete it. |
| 8 | Stale plan pseudocode | **ACCEPT** | Plan is an execution guide — wrong pseudocode causes implementation errors. |
| 9 | Migration number mismatch | **ACCEPT** | Documentation accuracy matters for future maintainers. |
| 10 | Bare query key | **ACCEPT** | Real cache invalidation gap, though lower priority since the mutation hook doesn't exist yet. |
| 11 | Stale doc comment | **ACCEPT** | Misleading comment, easy fix. |
| 12 | Orphaned `parent_question_id` rows | **REJECT** | Frontend already filters these out. Cleanup is nice-to-have but not required for correctness. Can be deferred. |
