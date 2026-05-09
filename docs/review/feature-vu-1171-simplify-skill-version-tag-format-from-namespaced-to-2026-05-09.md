# Review: feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to

- **Branch:** `feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to`
- **PR:** not applicable
- **Review Date:** 2026-05-09
- **Reviewer:** code-reviewer agent

## Intent

Simplify skill version tags from the old namespaced format to plain
`v{version}`.

## Scope Comparison

| Source | Claim / Requirement |
|--------|---------------------|
| Claim (commits) | `da3bccde` simplifies tag format to `v{version}`. `282ed3a8` repairs Eval Workbench compile drift after `VU-1174`. |
| Linear Issue | `VU-1171` is titled `Simplify skill version tag format from namespaced to v{version}`. |
| Design Doc | not_applicable |
| Plan | not_applicable |
| Functional Spec | not_applicable |

## Acceptance Criteria

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Tag format is simplified from namespaced tags to plain `v{version}` | Proven | [app/plugin-paths.json](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/plugin-paths.json:6), [app/src-tauri/src/skill_paths.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/skill_paths.rs:66), [app/src-tauri/src/skill_paths.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/skill_paths.rs:449) |
| Legacy startup migration still recognizes old tag layouts | Partially proven | Single-skill migration test passes in [app/src-tauri/src/commands/settings.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/commands/settings.rs:663), but there is no regression test for multi-skill shared-root legacy tag collisions |
| Branch stays within VU-1171 scope | Blocked | `282ed3a8` changes Eval Workbench runtime wiring in [app/src-tauri/src/commands/eval_workbench/mod.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/commands/eval_workbench/mod.rs:317) and [app/src-tauri/src/lib.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/lib.rs:407), which is unrelated to tag format |
| Full AC proof from current Linear issue body | Blocked | The visible `VU-1171` description is currently a prior quality-gate summary, not the original AC list, so original AC wording cannot be independently re-verified from Linear alone |

## Findings

### High

1. **[Architect]** The branch is not cleanly scoped to `VU-1171`. Commit `282ed3a8` changes Eval Workbench runtime wiring in [app/src-tauri/src/commands/eval_workbench/mod.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/commands/eval_workbench/mod.rs:317) and [app/src-tauri/src/lib.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/lib.rs:407). Recommendation: split or drop that commit from this branch, then review the pure tag-format change separately.

2. **[Skeptic]** Coverage is missing for the riskiest migration edge case. The branch flattens current-format tags to `v{version}` in [app/plugin-paths.json](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/plugin-paths.json:6) and [app/src-tauri/src/skill_paths.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/skill_paths.rs:66), while the legacy startup migration in [app/src-tauri/src/commands/settings.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/commands/settings.rs:115) still operates at shared `skills_root`, and [app/src-tauri/src/git.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/git.rs:334) ignores `tag_lightweight` collisions before deleting old tags. Recommendation: add a regression test for two legacy skills both carrying `1.0.0` in a shared-root repo and prove they do not collapse onto the same `refs/tags/v1.0.0`.

### Medium

1. **[Skeptic]** The extra Eval Workbench repair commit is effectively untested at the Rust/runtime seam. The branch changes `define_eval_scenario` behavior in [app/src-tauri/src/commands/eval_workbench/mod.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/commands/eval_workbench/mod.rs:448), but current coverage is wrapper/mock-level rather than direct behavior coverage. Recommendation: if that commit stays, add direct Rust tests for the `run_throwaway_openhands_session` path and `conversation_state` parsing.

### Low

1. **[Minimalist]** The tag helper API is now misleading. [app/src-tauri/src/skill_paths.rs](/Users/hbanerjee/src/worktrees/feature/vu-1171-simplify-skill-version-tag-format-from-namespaced-to/app/src-tauri/src/skill_paths.rs:66) keeps `plugin_slug` and `skill_name` parameters even though both are ignored. Recommendation: either rename these to zero-argument helpers/constants or add a brief comment that the signature is intentionally preserved for compatibility.

## What Went Well

- The intended `VU-1171` change is internally consistent across the template source and Rust helpers.
- The tag-related Rust checks that were run all passed.
- The worktree stayed clean throughout review.

## Verdict

REQUEST_CHANGES

The tag-format simplification itself looks correct, but the branch does not pass the implementation quality gates yet because it includes unrelated Eval Workbench runtime changes and lacks a regression test for the highest-risk legacy tag migration edge case.

## Next Steps

1. Split or drop `282ed3a8` from this branch.
2. Add a Rust regression test for multi-skill shared-root legacy tag migration collision behavior.
3. Re-run the independent gates after that cleanup.
4. If the Eval Workbench repair must remain here, add direct backend behavior tests for it.

## Verification

- `cargo test --manifest-path app/src-tauri/Cargo.toml --lib`
- `cargo test --manifest-path app/src-tauri/Cargo.toml test_startup_migration_migrates_legacy_tags_for_versioned_skill -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml skill_tag_prefix_is_plain_v -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml test_latest_skill_semver_with_tags -- --nocapture`
- `cargo test --manifest-path app/src-tauri/Cargo.toml test_finalize_creates_exactly_one_tag_after_fixup -- --nocapture`
- `cd app && npx tsc --noEmit`
- `cd app && npm run test:repo-map`

Ambient failures observed during gate reruns:

- `cd app && npm run test:unit` failed due repo-wide `react` / `react-dom` version mismatch (`19.2.6` vs `19.2.5`)
- `cd app && bash tests/run.sh e2e --tag @evals` also failed for the same ambient React mismatch before the app rendered
