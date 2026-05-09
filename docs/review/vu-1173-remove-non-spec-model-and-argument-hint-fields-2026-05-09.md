# PR Review: Remove non-spec model and argument-hint fields from UI and backend

- **PR:** Branch `feature/vu-1173-remove-non-spec-model-and-argument-hint-fields-from-ui-and-backend` (no open PR yet)
- **Branch:** feature/vu-1173-remove-non-spec-model-and-argument-hint-fields-from-ui-and-backend
- **Review Date:** 2026-05-09
- **Reviewer:** pr-code-reviewer agent

## Intent

Remove the `model` and `argument_hint` fields from the full stack because neither is part of the Agent Skills specification. These fields are parsed from `SKILL.md` frontmatter, persisted in both `skills` and `imported_skills` database tables, threaded through Rust types, Tauri commands, TypeScript types, and displayed/edited in React UI components. The PR aims to eliminate all of that surface area.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| PR Claim | Remove `model` and `argument_hint` fields from Rust types, DB operations, Tauri commands, frontend types, UI components, and add a DB migration to drop the columns |
| Linear Issue (VU-1173) | Backend (Rust): remove from structs, DB ops, commands, parser. Frontend: remove from types, Tauri command types, UI. Database: migration to drop columns. Six acceptance criteria listed. |
| Design Doc | None linked |
| Plan | None linked |
| Functional Spec | None linked |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Fields removed from all Rust types, DB operations, and Tauri commands | **Open** — `model` and `argument_hint` removed from `SkillSummary`, `ImportedSkill`, `SkillFileMeta`, `AvailableSkill`, `SkillMetadataOverride`, `SkillMasterRow`, `WorkflowSettings`, `Frontmatter`. DB SELECT/INSERT/UPDATE statements updated. Migration 49 drops columns. **But**: Rust test `test_rewrite_skill_md_preserves_unoverridden_fields` in `github_import/mod.rs:880-930` still asserts that `model: "claude-3-haiku"` is preserved in rewritten frontmatter — this test will panic because `parse_frontmatter_full` no longer parses `model:` and `render_frontmatter_yaml` no longer writes it. | 
| DB migration drops the columns without data loss for other fields | **Proven** — Migration 49 uses `ALTER TABLE … DROP COLUMN` which only removes the specified columns. SQLite `DROP COLUMN` (3.35.0+) preserves all other columns. | 
| Frontend types and UI no longer reference these fields | **Open** — TypeScript `types.ts` `SkillFileMeta` and other types correctly remove the fields. UI components (`skill-dialog.tsx`, `import-skill-dialog.tsx`) remove the form inputs and state. Tauri command wrapper (`tauri.ts`, `tauri-command-types.ts`) removes the params. **But**: `frontmatter.ts` still has `model?: string` in `SkillFrontmatter` interface. Multiple test fixtures still reference `model`/`argumentHint`/`argument_hint` (see Findings). |
| Marketplace import no longer parses or stores them | **Open** — Rust frontmatter parser (`frontmatter.rs`) no longer parses `model:` or `argument-hint:`. Marketplace catalog/commands no longer pass them through. **But**: the `test_rewrite_skill_md_preserves_unoverridden_fields` test includes `model: claude-3-haiku` in its test input and asserts its preservation, which will now fail. |
| `npm run test:unit` passes | **Blocked** — 16 test suites fail due to a pre-existing React version mismatch (`react@19.2.6` vs `react-dom@19.2.5`), not this PR. The frontmatter test passes (17/17). The PR-specific test fixtures that still reference removed fields cannot execute due to the React mismatch. |
| `cargo clippy` passes | **Blocked** — Pre-existing compilation errors in `eval_workbench/mod.rs` (unrelated `should_trigger` field and missing function argument) prevent compilation. No new clippy warnings are introduced by this PR. |

## Findings

### High

1. **[Skeptic]** Stale Rust test asserts `model` field preservation after removal from `Frontmatter` struct. `github_import/mod.rs:888-919` — `test_rewrite_skill_md_preserves_unoverridden_fields` creates a SKILL.md containing `model: claude-3-haiku`, parses it with `parse_frontmatter_full`, and then asserts `result.contains("model: \"claude-3-haiku\"")`. After this PR, `parse_frontmatter_full` no longer captures `model:`, and `render_frontmatter_yaml` no longer emits it. This test will fail at runtime. **Recommendation**: Remove or update the `model`-related lines from this test (lines 887-888 input, line 893 comment, lines 918-922 assertion). Consider testing that a non-spec field like `model:` in input frontmatter is silently dropped rather than preserved.

2. **[Skeptic]** TypeScript `SkillFrontmatter` interface in `frontmatter.ts:8` still declares `model?: string`. The Rust-side parser was updated to stop parsing `model:`, but the TypeScript-side parser still accepts it. This is the parser used by the frontend to read `SKILL.md` files for import previews. While the field is harmlessly ignored by consumers now (the `SkillFileMeta` type no longer includes it), keeping `model` in the frontmatter interface creates a misleading seam between what Rust validates and what TypeScript accepts. **Recommendation**: Remove `model?: string` from `SkillFrontmatter` in `frontmatter.ts` and update the test at `frontmatter.test.ts:154,162` that asserts `argument_hint` parsing (since `argument_hint` was also removed from the Rust parser but still tested in TS).

3. **[Skeptic]** Eight test fixture files still reference removed fields (`model`, `argumentHint`, `argument_hint`). These will cause TypeScript type errors or test failures once the React version mismatch is resolved:
   - `import-skill-dialog.test.tsx:37-38` — `model: "claude-sonnet-4-6"` and `argument_hint: "[target-org]"` in `SAMPLE_META`
   - `import-skill-dialog.test.tsx:92` — test "does not render a model selector from meta" (no longer meaningful)
   - `workspace-overview.test.tsx:46,66` — `argumentHint` and `argument_hint` in mock data
   - `skill-list-panel.test.tsx:63,88` — `argumentHint` and `argument_hint` in mock data
   - `edit-tags-dialog.test.tsx:212` — `argumentHint: null` in mock skill
   - `new-skill-dialog.test.tsx:451` — `argumentHint: null` in mock data
   - `imported-skills-tab.test.tsx:98` — `model: null, argument_hint: null` in mock return
   - `queries/skills.test.tsx:33-34` — `model: null, argument_hint: null` in mock data
   **Recommendation**: Remove all `model`, `argumentHint`, and `argument_hint` properties from test fixtures across these files.

4. **[Skeptic]** Stale doc comment in `evaluation.rs:86-89` lists the removed fields as metadata that `set_skill_behaviour` owns: `"description, version, model, argument_hint, user_invocable, disable_model_invocation"`. This note is now inaccurate. **Recommendation**: Update the comment to remove `model` and `argument_hint`.

### Medium

5. **[Architect]** Migration 49 uses `ALTER TABLE … DROP COLUMN` which is supported in SQLite 3.35.0+ (2021-03-12). The app ships with a bundled SQLite, so this should be safe. However, there is no downgrade path documented — if a user's database is migrated and then they roll back to an older app version, the older Rust code will attempt to read `model`/`argument_hint` columns that no longer exist. **Recommendation**: Confirm that the bundled SQLite version is ≥ 3.35.0. If rollback compatibility is a concern, consider noting in the migration comment that rollback requires a database restore.

6. **[Architect]** The `Frontmatter` struct's `render_frontmatter_yaml` function no longer writes `model` or `argument-hint`, which means when a user imports a skill that had these fields in its `SKILL.md`, the rewrite step will silently strip them. This is the intended behavior (non-spec fields should be dropped), but the test at `github_import/mod.rs:880` explicitly validates the opposite behavior — that `model` is preserved. This is a direct contradiction between the code change and the test. **Recommendation**: Update the test to verify that `model:` is *not* in the rewritten output, confirming the field is intentionally dropped.

7. **[Minimalist]** `db/tests.rs` contains multiple struct literals with blank lines where `model` and `argument_hint` were removed (e.g., lines 2584-2585, 3038-3039, 3148-3149, etc.). The diff replaces the field assignments with empty lines rather than removing the whitespace. This is cosmetic but makes the tests harder to read. **Recommendation**: Remove the stray blank lines left by deleted fields to keep the test fixtures clean.

### Low

8. **[Minimalist]** Historical migration functions in `migrations.rs` still reference `model` and `argument_hint` in their SQL strings (e.g., migrations 24, 35, 46). This is correct — historical migrations must preserve their original SQL. No action needed, but worth noting for clarity.

9. **[Minimalist]** The `db/tests.rs` test `test_workflow_runs_has_no_metadata_columns` (line ~4140) lists empty lines in `banned` array where `model`/`argument_hint` were removed. The blank entries are harmless string comparisons that won't match, but the array is now harder to read. **Recommendation**: Clean up the empty entries.

## What Went Well

1. **Systematic sweep** — The PR removes the fields across the entire stack: Rust types → DB operations → Tauri commands → TypeScript types → React components → test call sites. The coverage is thorough for production code.

2. **Migration approach** — Using `ALTER TABLE DROP COLUMN` is the correct migration strategy. It's atomic, non-destructive to other columns, and the migration number (49) is properly sequenced.

3. **Parameter reduction** — The PR reduces the parameter count of functions like `create_skill_inner`, `set_skill_behaviour`, `format_user_context`, and `update_skill_metadata`, making them easier to read and maintain. The test call sites are updated accordingly (many going from 15 args to 13).

## Verdict

**REQUEST_CHANGES** — Two blocking issues prevent approval:

1. **The Rust test `test_rewrite_skill_md_preserves_unoverridden_fields` will fail** because it asserts `model: "claude-3-haiku"` is preserved, but `parse_frontmatter_full` no longer captures `model:` and `render_frontmatter_yaml` no longer writes it. This is a compile-time or runtime blocker once the pre-existing `eval_workbench` compilation errors are fixed.

2. **Eight TypeScript test files contain stale `model`/`argumentHint`/`argument_hint` properties** that reference removed type members, which will cause TypeScript compilation errors when the React version mismatch is resolved and type-checking runs.

## Next Steps

1. Fix `test_rewrite_skill_md_preserves_unoverridden_fields` in `github_import/mod.rs` — remove the `model:` input from the test string and update the assertion to verify that the non-spec field is *not* present in the rewritten output.

2. Remove `model?: string` from the `SkillFrontmatter` interface in `frontmatter.ts` and update the `argument_hint` test in `frontmatter.test.ts`.

3. Remove `model`, `argumentHint`, and `argument_hint` from all 8 test fixture files listed in Finding 3.

4. Update the stale doc comment in `evaluation.rs:86-89`.

5. Clean up the empty-line deletions in `db/tests.rs` (cosmetic, not blocking).

6. After fixes, verify `cargo test` passes for the affected modules and `npm run test:unit` passes for the affected test files.